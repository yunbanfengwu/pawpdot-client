// User-delegated directory/mobile direct access. This endpoint never publishes
// conversation bodies to the legacy gateway/outbox.
import crypto from 'node:crypto';
import { JsonStore } from './store.mjs';
import { readSessionEvents } from './session-read.mjs';
import path from 'node:path';
import fs from 'node:fs';

export const DIRECT_PROTOCOL = 'teamseek.direct.v1';
const token = () => crypto.randomBytes(32).toString('base64url');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export class DirectFault extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const text = (value, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new DirectFault(400, '参数无效');
  return value.trim();
};
const id = value => { const result = text(value, 100); if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new DirectFault(400, '标识无效'); return result; };
export function connectionRoutes(input) {
  if (!Array.isArray(input) || !input.length || input.length > 8) throw new DirectFault(400, '填写1至8个连接地址');
  const routes = input.map(value => {
    const u = new URL(text(value.base, 1000));
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || !u.pathname.endsWith('/') || !['direct', 'relay'].includes(value.kind)) throw new DirectFault(400, '地址须为HTTP或HTTPS并以/结束');
    return { base: u.href, kind: value.kind };
  });
  return routes;
}

const menuIcons = new Set(['home', 'folder', 'robot', 'chart', 'clock', 'doc', 'cloud', 'star', 'link', 'terminal']);
// 侧栏菜单是白名单元数据（MOBILE-SIDEBAR-MENU-001）：id/title/icon/url 仅此四项；
// url 必须是以 / 开头的实例相对路径（无 scheme/authority/..），App 解析为实例同源页面并仅传 Bearer。
export function sidebarMenus(input) {
  if (!Array.isArray(input) || input.length > 6) throw new DirectFault(400, '侧栏菜单须为不超过6项的数组');
  const ids = new Set();
  return input.map(value => {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const menuId = id(row.id);
    if (ids.has(menuId)) throw new DirectFault(400, '侧栏菜单标识重复');
    ids.add(menuId);
    const icon = menuIcons.has(row.icon) ? row.icon : 'link';
    const url = text(row.url, 500);
    if (!url.startsWith('/') || url.includes('\\') || url.split(/[?#]/)[0].split('/').some(part => part === '.' || part === '..')) {
      throw new DirectFault(400, '菜单地址须为以/开头的实例相对路径');
    }
    let resolved;
    try { resolved = new URL(url, 'https://menu.invalid'); } catch { throw new DirectFault(400, '菜单地址无效'); }
    if (resolved.origin !== 'https://menu.invalid') {
      throw new DirectFault(400, '菜单地址须为以/开头的实例相对路径');
    }
    return { id: menuId, title: text(row.title, 24), icon, url };
  });
}

export function pairingLink(offer) {
  // Bootstrap through the public relay when configured, so first pairing also
  // works outside the LAN. This does not grant permission to use that route.
  const base = new URL((offer.routes.find(r => r.kind === 'relay') || offer.routes[0]).base);
  const suffix = base.pathname === '/api/teamseek/direct/' ? '' : base.pathname;
  return (base.protocol === 'https:' ? 'seeks:' : 'seek:') + base.host + suffix + '?code=' + offer.code;
}

export class HarnessDirectoryAdapter {
  constructor(ctx) { this.ctx = ctx; }
  get canTranscribe() {
    if (!this.speech) return false;
    try {
      const {providers,selection}=this.speech.snapshot();
      // SenseVoice releases its worker while idle. Its documented standby
      // state is prepared and wakes on the next transcribe(), not unsupported.
      return providers.some(provider=>provider.id===selection.providerId && provider.languages.includes(selection.language) && ['ready','standby'].includes(provider.preparation?.phase));
    } catch { return false; }
  }
  async directory() {
    const signal = AbortSignal.timeout(10000);
    const result = await this.ctx.sessionController.list({}, signal);
    if (!Array.isArray(result.items)) throw new DirectFault(503, '宿主会话目录接口不兼容');
    let workspaces = [], archived = new Set();
    if (this.ctx.workspaceController) {
      const iterator = this.ctx.workspaceController.follow(signal)[Symbol.asyncIterator]();
      try {
        const first = await iterator.next();
        if (first.value?.type !== 'baseline') throw new DirectFault(503, '宿主项目目录接口不兼容');
        workspaces = first.value.value.items;
        archived = new Set(first.value.value.archivedSessionIds);
      } finally { await iterator.return?.(); }
    }
    const visible = result.items.filter(s => !s.parentSessionId && !archived.has(s.sessionId));
    const ids = new Set(visible.map(s => s.sessionId));
    const groups = workspaces.map(w => ({ id: id(w.workspaceId), title: text(w.title) }));
    const groupFor = new Map();
    for (const workspace of workspaces) for (const session of workspace.sessionIds) if (ids.has(session)) groupFor.set(session, workspace.workspaceId);
    const sessions = visible.map(s => ({ id: id(s.sessionId), title: String(s.projections?.values?.title || '未命名会话').slice(0, 160), groupId: groupFor.get(s.sessionId) || null,
      ...(Number.isSafeInteger(s.updatedAt) && s.updatedAt >= 0 && s.updatedAt <= 8640000000000000 ? { updatedAt: s.updatedAt } : {}) }));
    if (groups.length > 200 || sessions.length > 2000) throw new DirectFault(503, '目录超过手机当前支持上限');
    return { groups, sessions };
  }
  async history(sessionId) {
    const events = await readSessionEvents(this.ctx, sessionId);
    const lastStart = events.findLast(e => e.type === 'turn/start');
    const lastEnd = events.findLast(e => e.type === 'turn/end');
    const state = lastStart && (!lastEnd || lastStart.seq > lastEnd.seq) ? 'running' : 'idle';
    const reason = lastEnd?.data?.reason;
    const failure = typeof reason === 'string' && /error|fail/i.test(reason) ? '目标实例执行失败，请在桌面检查模型配置、登录或权限。' : '';
    return { sessionId, state, failure, messages: events.flatMap(event => {
      const role = event.type === 'user/message' ? 'user' : event.type === 'assistant/message' ? 'assistant' : null;
      if (!role || (role === 'user' && event.data?.source?.kind !== 'user')) return [];
      const content = role === 'user' ? event.data.content : event.data?.message?.content;
      const value = (Array.isArray(content) ? content : []).filter(p => p.type === 'text').map(p => p.text).join('\n');
      return value.trim() ? [{ id: `${sessionId}:${event.seq}`, role, text: value.slice(0, 100000), at: event.time }] : [];
    }).slice(-200) };
  }
  async *follow(sessionId, signal) {
    if (!this.ctx.sessionController.follow) throw new DirectFault(503, '宿主不支持实时流');
    for await (const value of this.ctx.sessionController.follow({ address: { kind: 'session', sessionId }, assistantStream: true, maxMessages: 20 }, signal)) {
      if (value.type === 'assistant-stream') {
        const frame = value.frame;
        if (frame.type === 'chunk' && frame.chunk?.type === 'text-delta') yield { type: 'delta', text: String(frame.chunk.text || '').slice(0, 24000) };
        if (frame.type === 'start' || frame.type === 'end') yield { type: 'reset' };
      } else if (value.type === 'event' && ['user/message', 'assistant/message', 'turn/start', 'turn/end', 'session/title'].includes(value.event?.type)) {
        yield { type: 'changed' };
      }
    }
  }
  async prompt(sessionId, value, requestId) {
    return this.ctx.sessionController.prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: value }], clientTimeZone: 'Asia/Shanghai' }, AbortSignal.timeout(15000));
  }
  async startVoiceTask(instruction, requestId, isCurrent) {
    const value = await this.ctx.workspaceController.initializeDefault(AbortSignal.timeout(10000));
    if (!isCurrent()) throw Error('通话已结束');
    const workspaceId = value.workspace?.workspaceId;
    if (!workspaceId) throw Error('无法打开终端默认工作区');
    const { sessionId } = await this.ctx.sessionController.create({ workspaceId });
    const title = instruction.split(/\s*\r?\n/u, 1)[0].slice(0, 64);
    if (!sessionId) throw Error('新对话未创建');
    if (!isCurrent()) throw Error('通话已结束，任务未发送');
    const receipt = await this.prompt(sessionId, instruction, requestId);
    if (receipt?.accepted !== true) throw Error('执行会话没有受理任务');
    return { sessionId, title };
  }
  async cancel(sessionId) { return this.ctx.sessionController.cancel({ sessionId }); }
  async transcribe(audio) {
    if (!this.speech) throw new DirectFault(503, '此实例尚未配置语音转写');
    const spec = this.speech.resolve({ audio });
    const result = await this.speech.transcribe(spec, AbortSignal.timeout(75000));
    return text(result.text, 24000);
  }
}

export class DirectHost {
  constructor(home, adapter) {
    this.adapter = adapter;
    this.store = new JsonStore(path.join(home, 'direct-devices.json'), {
      version: 1, instanceId: 'instance-' + crypto.randomUUID(), label: '我的 AuDoter',
      routes: [], devices: [], commands: [], sidebarMenus: [], revision: 0, directoryHash: ''
    }, s => s?.version === 1 && Array.isArray(s.devices) && Array.isArray(s.commands));
    if (!fs.existsSync(this.store.file)) this.store.change(() => {});
    if (!Array.isArray(this.store.snapshot().sidebarMenus)) this.store.change(s => { s.sidebarMenus = []; });
    this.pairs = new Map(); this.tickets = new Map(); this.webSessions = new Map(); this.locks = new Map();
    this.revocationListeners = new Set();
  }
  identity() { const s = this.store.snapshot(); return { protocol: DIRECT_PROTOCOL, instanceId: s.instanceId, label: s.label, capabilities: { voiceTranscription: this.adapter.canTranscribe === true } }; }
  view() { const s = this.store.snapshot(); return { ...this.identity(), routes: s.routes, devices: s.devices.map(({ id, label, createdAt, revoked }) => ({ id, label, createdAt, revoked })), sidebarMenus: Array.isArray(s.sidebarMenus) ? s.sidebarMenus : [] }; }
  configure(input) {
    const routes = connectionRoutes(input.routes), label = text(input.label);
    this.store.change(s => { s.routes = routes; s.label = label; });
    return this.view();
  }
  // 终端注册侧栏菜单（MOBILE-SIDEBAR-MENU-001）：持久化到 direct-devices.json，
  // 随 GET config 的 sidebar.menus 下发；空数组即清空。
  setSidebarMenus(input) {
    const value = sidebarMenus(input);
    this.store.change(s => { s.sidebarMenus = value; });
    return value;
  }
  offer({ harness = false } = {}) {
    const s = this.store.snapshot();
    if (!s.routes.length) throw new DirectFault(400, '先填写手机可访问的直连或中继地址');
    if (this.pairs.size > 100) this.pairs.clear();
    const code = crypto.randomBytes(16).toString('base64url'), expiresAt = Date.now() + 5 * 60000;
    const offer = { ...this.identity(), code, routes: s.routes, ...(harness ? { access: 'harness-control' } : {}), expiresAt: new Date(expiresAt).toISOString() };
    this.pairs.set(hash(code), { expiresAt, access: harness ? 'harness-control' : undefined, offer });
    return offer;
  }
  resolveOffer(code) {
    code = text(code, 200);
    const entry = this.pairs.get(hash(code));
    if (!entry?.offer || entry.expiresAt < Date.now()) throw new DirectFault(401, '配对码失效，请在电脑重新生成');
    return { ...entry.offer, code };
  }
  pair(input) {
    const code = text(input.code, 200), entry = this.pairs.get(hash(code));
    const expires = typeof entry === 'object' ? entry.expiresAt : entry;
    if (!expires || expires < Date.now()) throw new DirectFault(401, '配对码失效，请在电脑重新生成');
    this.pairs.delete(hash(code));
    const deviceToken = token(), device = { id: 'device-' + crypto.randomUUID(), tokenHash: hash(deviceToken), label: text(input.deviceName), createdAt: new Date().toISOString(), revoked: false,
      ...(entry?.access === 'harness-control' ? { access: 'harness-control' } : {}) };
    this.store.change(s => { if (s.devices.filter(d => !d.revoked).length >= 50) throw new DirectFault(400, '绑定设备过多'); s.devices.push(device); });
    return { instanceId: this.identity().instanceId, deviceId: device.id, deviceToken };
  }
  authorize(bearer) {
    if (typeof bearer !== 'string' || bearer.length > 1000) throw new DirectFault(401, '设备未授权');
    const device = this.trustedTokens?.get(hash(bearer)) || this.store.snapshot().devices.find(d => !d.revoked && d.tokenHash === hash(bearer));
    if (!device) throw new DirectFault(401, '设备已撤销或未授权');
    return device;
  }
  authorizeDevice(deviceId) {
    const device = this.trustedDevices?.get(deviceId) || this.store.snapshot().devices.find(d => !d.revoked && d.id === deviceId);
    if (!device) throw new DirectFault(401, '设备已撤销');
    return device;
  }
  revoke(deviceId) {
    this.store.change(s => { const row = s.devices.find(d => d.id === deviceId); if (!row) throw new DirectFault(404, '设备不存在'); row.revoked = true; });
    for (const [key, value] of this.webSessions) if (value.deviceId === deviceId) this.webSessions.delete(key);
    for (const listener of this.revocationListeners) listener(deviceId);
  }
  harnessConfig(device) {
    if (device.access !== 'harness-control') throw new DirectFault(403, '此设备是旧版目录授权，请重新扫码授予 Harness 控制权限');
    const s = this.store.snapshot();
    return { ...this.identity(), protocol: 'teamseek.harness.v1',
      webEntry: 'harness/', bridgeVersion: 1,
      sidebar: { renderer: 'sessions.v1', grouping: ['project', 'time'], menus: Array.isArray(s.sidebarMenus) ? s.sidebarMenus : [] },
      panels: { conversation: true, input: true, workspace: 'responsive' } };
  }
  async harnessTicket(device, sessionId) {
    this.harnessConfig(device);
    if (sessionId != null) await this.session(sessionId);
    this.prune();
    if (this.tickets.size > 1000) throw new DirectFault(429, '网页连接过多');
    const ticket = token();
    this.tickets.set(hash(ticket), { deviceId: device.id, sessionId: sessionId || null, kind: 'harness', expiresAt: Date.now() + 60000 });
    return { ticket };
  }
  async directory(activity = false) {
    const result = await this.adapter.directory();
    const fingerprint = hash(JSON.stringify(result));
    if (this.store.snapshot().directoryHash !== fingerprint) this.store.change(s => { s.directoryHash = fingerprint; s.revision++; });
    return { revision: this.store.snapshot().revision, groups: result.groups,
      sessions: activity ? result.sessions : result.sessions.map(({ updatedAt, ...metadata }) => metadata) };
  }
  async session(sessionId) {
    id(sessionId);
    const directory = await this.directory();
    if (!directory.sessions.some(s => s.id === sessionId)) throw new DirectFault(403, '会话不在当前授权目录');
    return sessionId;
  }
  async webTicket(device, sessionId) {
    await this.session(sessionId);
    this.prune();
    if (this.tickets.size > 1000) throw new DirectFault(429, '网页连接过多');
    const ticket = token();
    this.tickets.set(hash(ticket), { deviceId: device.id, sessionId, expiresAt: Date.now() + 60000 });
    return { ticket };
  }
  exchange(ticket) {
    const key = hash(text(ticket, 1000)), value = this.tickets.get(key);
    this.tickets.delete(key);
    if (!value || value.expiresAt < Date.now()) throw new DirectFault(401, '网页票据已过期，请从App重新打开会话');
    this.authorizeDevice(value.deviceId);
    const cookie = token();
    this.webSessions.set(hash(cookie), { ...value, expiresAt: Date.now() + (value.kind === 'harness' ? 8 * 60 : 30) * 60000 });
    return { cookie, sessionId: value.sessionId, kind: value.kind };
  }
  web(cookie) {
    const value = this.webSessions.get(hash(cookie || ''));
    if (!value || value.expiresAt < Date.now()) throw new DirectFault(401, '网页连接已过期，请从App重新打开');
    this.authorizeDevice(value.deviceId);
    return value;
  }
  prune() {
    for (const collection of [this.tickets, this.webSessions]) for (const [key, row] of collection) if (row.expiresAt < Date.now()) collection.delete(key);
  }
  async command(device, sessionId, requestId, payload, execute) {
    await this.session(sessionId);
    const key = device.id + ':' + id(requestId), fingerprint = hash(JSON.stringify({ sessionId, payload }));
    if (this.locks.has(key)) {
      const active = this.locks.get(key);
      if (active.fingerprint !== fingerprint) throw new DirectFault(409, '同一请求ID不能发送不同内容');
      return active.promise;
    }
    const old = this.store.snapshot().commands.find(c => c.key === key);
    if (old) {
      if (old.fingerprint !== fingerprint) throw new DirectFault(409, '同一请求ID不能发送不同内容');
      if (old.status !== 'accepted') throw new DirectFault(409, '上次结果未知，请先查看会话，勿重复发送');
      return old.result;
    }
    if (this.store.snapshot().commands.length >= 20000) throw new DirectFault(503, '本实例请求账本已满，请维护后再发送');
    this.store.change(s => { s.commands.push({ key, fingerprint, status: 'unknown' }); });
    const promise = (async () => {
      const result = await execute();
      this.store.change(s => Object.assign(s.commands.find(c => c.key === key), { status: 'accepted', result }));
      return result;
    })();
    this.locks.set(key, { fingerprint, promise });
    try { return await promise; } finally { this.locks.delete(key); }
  }
  async prompt(device, input) {
    const sessionId = id(input.sessionId), value = text(input.text, 24000);
    return this.command(device, sessionId, input.requestId, value, async () => {
      const result = await this.adapter.prompt(sessionId, value, input.requestId);
      return { accepted: result.accepted === true, sessionId };
    });
  }
  async voice(device, input) {
    if (input.transcribeOnly !== undefined && typeof input.transcribeOnly !== 'boolean') throw new DirectFault(400, '转写模式无效');
    if (typeof input.audioBase64 !== 'string' || input.audioBase64.length > 2700000) throw new DirectFault(400, '录音过大');
    const audio = Buffer.from(input.audioBase64, 'base64');
    if (audio.toString('base64') !== input.audioBase64 || audio.length < 45 || audio.length > 2000000 ||
        audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE' ||
        audio.toString('ascii', 12, 16) !== 'fmt ' || audio.toString('ascii', 36, 40) !== 'data' ||
        audio.readUInt32LE(16) !== 16 || audio.readUInt16LE(20) !== 1 || (audio.length - 44) % 2 !== 0 ||
        audio.readUInt32LE(24) !== 16000 || audio.readUInt16LE(22) !== 1 || audio.readUInt16LE(34) !== 16 ||
        audio.readUInt32LE(40) !== audio.length - 44) throw new DirectFault(400, '录音格式无效');
    const transcribeOnly = input.transcribeOnly === true;
    // Keep old normal-voice fingerprints compatible; transcription must never
    // replay as a prompt (or collide with a normal voice request).
    return this.command(device, id(input.sessionId), input.requestId, (transcribeOnly ? 'transcribe:' : '') + hash(audio), async () => {
      const value = await this.adapter.transcribe(audio);
      if (transcribeOnly) return { accepted: true, transcribeOnly: true, text: value, sessionId: input.sessionId };
      const result = await this.adapter.prompt(input.sessionId, value, input.requestId);
      return { accepted: result.accepted === true, sessionId: input.sessionId };
    });
  }
  close() { this.pairs.clear(); this.tickets.clear(); this.webSessions.clear(); }
}
