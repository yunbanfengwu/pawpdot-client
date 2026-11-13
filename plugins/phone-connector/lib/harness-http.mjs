// Reuse the actual Harness frontend and official Connection/Gateway adapters.
// New pairing explicitly grants this owner's Harness control, never a root login cookie.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { DirectFault } from './direct-host.mjs';
import { createLeanEntry } from './lean-entry.mjs';
import { browserDiagnostics } from './browser-diagnostics.mjs';
import { fsList } from './fs-bridge.mjs';
import { processDetail, slimFollowValue } from './process-detail.mjs';
import { queueNow, goalCommand } from './queue-now.mjs';
import { engineControl } from './engine.mjs';
import { readSessionEvents } from './session-read.mjs';
import { readPublicImage } from './image-relay.mjs';

const prefix = '/api/teamseek/direct/';
import { serveFont } from '../../../shared/fonts/http.mjs';
const publicFile = name => fs.readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
export function createHarnessHttp(ctx, core, readBody, options = {}) {
  const pages = new Map(), streams = new Map(), diagnosticWindows = new Map();
  let imagesReading = 0;
  const lean = createLeanEntry(ctx);
  const diagnostics = browserDiagnostics(path.join(path.dirname(core.store.file), 'browser-diagnostics.json'));
  function logDiagnostic(deviceId, input) {
    const now = Date.now();
    let rate = diagnosticWindows.get(deviceId);
    if (!rate || now - rate.at > 60000) { rate = { at: now, count: 0 }; diagnosticWindows.set(deviceId, rate); }
    if (++rate.count > 60) throw new DirectFault(429, '诊断日志过于频繁');
    diagnostics.append(deviceId, input);
  }
  const handler = ctx.connection.createSharedFetchHandler('/api');
  const send = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  function release(key, page) {
    pages.delete(key);
    for (const row of streams.values()) if (row.page === page) row.abort.abort();
    void page.peer.dispose();
  }
  const revoke = id => { diagnosticWindows.delete(id); for (const [key, page] of pages) if (page.deviceId === id) release(key, page); };
  core.revocationListeners.add(revoke);
  const timer = setInterval(() => { for (const [key, page] of pages) if (page.expiresAt < Date.now()) release(key, page); }, 30000);
  timer.unref();
  async function authenticated(req) {
    // Do not accept the browser owner's cookies as mobile authorization.
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const web = core.web(token);
    if (web.kind !== 'harness') throw new DirectFault(403, '需要 Harness 网页授权');
    core.harnessConfig(core.authorizeDevice(web.deviceId));
    let page = pages.get(web);
    if (!page) {
      if (pages.size >= 100) throw new DirectFault(429, '网页连接过多');
      page = { ...web, peer: ctx.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'answer' }) };
      pages.set(web, page);
    }
    return page;
  }
  const api = async (suffix, req, res) => {
    if (suffix.startsWith('fonts/') && serveFont(suffix.slice('fonts/'.length), req, res)) return true;
    if (suffix === 'diagnostics' && req.method === 'POST') {
      const device = core.authorize((req.headers.authorization || '').replace(/^Bearer /, ''));
      logDiagnostic(device.id, await readBody(req)); send(res, 200, { ok: true }); return true;
    }
    if (req.method === 'GET' && ['harness/', 'harness/index.html'].includes(suffix)) {
      const bearer = req.headers.authorization;
      if (bearer?.startsWith('Bearer ')) core.harnessConfig(core.authorize(bearer.slice(7)));
      else throw new DirectFault(401, '请从已绑定手机打开终端');
      let html;
      try { html = lean.html(); }
      catch (error) { console.error('[teamseek-lean] entry unavailable:', error.message); throw error; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
        'content-security-policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" });
      res.end(html); return true;
    }
    if (req.method === 'GET' && suffix === 'harness/tokens.css') {
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(new URL('../../../shared/design/tokens.css', import.meta.url))); return true;
    }
    if (req.method === 'GET' && ['harness/boot.js', 'harness/embed.css'].includes(suffix)) {
      res.writeHead(200, { 'content-type': suffix.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'cache-control': 'no-store' });
      res.end(publicFile(suffix.endsWith('.js') ? 'harness-boot.js' : 'harness-embed.css')); return true;
    }
    if (req.method === 'GET' && suffix === 'harness/desktop.js') {
      throw new DirectFault(503, 'AuDoter 尚未接入电脑画面控制插件');
    }
    if (req.method === 'GET' && /^harness\/(?:modules|view)-[a-f0-9]{20}\.js$/.test(suffix)) {
      const script = await lean.bundle(prefix + suffix);
      if (script === null) throw new DirectFault(410, '组件已更新，请重新打开终端');
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
      res.end(script); return true;
    }
    if (req.method === 'GET' && suffix.startsWith('harness/lean/')) {
      const asset = suffix.slice('harness/lean/'.length);
      if (!/^assets\/[a-zA-Z0-9_./-]+\.(?:js|css|woff2?|ttf)$/.test(asset) || asset.split('/').includes('..')) throw new DirectFault(404, '资源不存在');
      const file = new URL('../public/lean/' + asset, import.meta.url);
      const type = asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : asset.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
      if (!fs.existsSync(file)) throw new DirectFault(404, '资源不存在');
      res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
      res.end(fs.readFileSync(file)); return true;
    }
    if (suffix === 'harness/exchange' && req.method === 'POST') {
      const result = core.exchange((await readBody(req)).ticket);
      if (result.kind !== 'harness') throw new DirectFault(403, '需要 Harness 票据');
      send(res, 200, { webToken: result.cookie, sessionId: result.sessionId, instanceId: core.identity().instanceId }); return true;
    }
    if (!suffix.startsWith('harness/')) return false;
    const page = await authenticated(req);
    if (suffix === 'harness/native-file' && req.method === 'POST') {
      const input = await readBody(req);
      await core.session(input.sessionId);
      // 0.2.2 移除了 inspect()：经 session-read 分页快照读取同一份事件日志。
      const historyEvents = await readSessionEvents(ctx, input.sessionId);
      // Never trust a filename or attachment descriptor submitted by the phone.
      // Resolve the exact durable reference from this authorized Session's log.
      let reference;
      for (const event of historyEvents) {
        const content = event.type === 'user/message' ? event.data?.content
          : event.type === 'assistant/message' ? event.data?.message?.content : [];
        for (const part of Array.isArray(content) ? content : []) {
          if (part.type === 'file' && part.attachment?.attachmentId === input.attachmentId) reference = part.attachment;
        }
      }
      if (!reference) throw new DirectFault(403, '文件未关联到当前会话');
      if (!Number.isSafeInteger(reference.bytes) || reference.bytes < 0 || reference.bytes > 32 * 1024 * 1024) throw new DirectFault(413, '文件超过手机当前32MB读取上限');
      const attachments = ctx.get?.('attachments') || ctx.attachments;
      if (!attachments?.readFileStream) throw new DirectFault(503, '此实例尚未接入文件附件读取');
      const abort = new AbortController();
      res.on('close', () => { if (!res.writableFinished) abort.abort(); });
      const revokeRead = deviceId => { if (deviceId === page.deviceId) abort.abort(); };
      core.revocationListeners.add(revokeRead);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': reference.bytes,
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      try { await pipeline(Readable.from(attachments.readFileStream(reference, abort.signal)), res, { signal: abort.signal }); }
      finally { core.revocationListeners.delete(revokeRead); }
      return true;
    }
    if (suffix === 'harness/media-image' && req.method === 'POST') {
      if (imagesReading >= 8) throw new DirectFault(429, '图片加载较多，请稍后重试');
      const input = await readBody(req), abort = new AbortController();
      res.on('close', () => abort.abort());
      imagesReading++;
      try {
        const image = await (options.readPublicImage || readPublicImage)(input.url, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]) });
        res.writeHead(200, { 'content-type': image.type, 'content-length': image.body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(image.body);
      } finally { imagesReading--; }
      return true;
    }
    if (suffix === 'harness/desktop' && req.method === 'POST') {
      const input = await readBody(req);
      if (!core.desktop) throw new DirectFault(503, '此终端尚未安装画面组件');
      let value;
      try {
      if (input.action === 'open') {
        await core.session(input.sessionId);
        value = await core.desktop.open(page.deviceId, input.sessionId, input.mode);
      } else if (input.action === 'frame') value = await core.desktop.frame(page.deviceId, input.id);
      else if (input.action === 'input') value = await core.desktop.input(page.deviceId, input.id, input.input);
      else if (input.action === 'close') value = core.desktop.close(page.deviceId, input.id);
      else throw new DirectFault(400, '画面动作无效');
      } catch (error) {
        const message = String(error.message || '画面连接失败').split('\n')[0].slice(0,240);
        send(res, error.status || 503, { error: message.includes('锁屏') ? '本机已锁屏，请在电脑上解锁后重试' : message }); return true;
      }
      send(res, 200, value); return true;
    }
    if (suffix === 'harness/diagnostics' && req.method === 'POST') {
      logDiagnostic(page.deviceId, await readBody(req));
      send(res, 200, { ok: true }); return true;
    }
    if (suffix === 'harness/graph' && req.method === 'GET') {
      send(res, 200, lean.graph(new URL(req.url, 'http://localhost').searchParams.get('workspace') === '1')); return true;
    }
    if (suffix === 'harness/directory' && req.method === 'GET') { send(res, 200, await core.directory(true)); return true; }
    if (suffix === 'harness/engine' && req.method === 'GET') {
      const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId');
      await core.session(sessionId);
      send(res, 200, await engineControl(ctx, { action: 'engine-state', sessionId })); return true;
    }
    if (suffix === 'harness/command' && req.method === 'POST') {
      const body = await readBody(req), device = core.authorizeDevice(page.deviceId);
      if (body.action === 'prompt') send(res, 200, await core.prompt(device, body));
      else if (body.action === 'cancel') {
        await core.session(body.sessionId);
        const result = await core.adapter.cancel(body.sessionId);
        const agent = ctx.agents.get(body.sessionId), goals = ctx.get('goals');
        const goal = agent && goals?.get(agent);
        if (goal?.phase === 'active') goals.pause(agent, { id: goal.id, revision: goal.revision });
        send(res, 200, result);
      }
      else if (body.action === 'fs-list') send(res, 200, await fsList(body));
      else if (body.action === 'process-detail') {
        await core.session(body.sessionId);
        send(res, 200, await processDetail(ctx, body));
      }
      else if (body.action === 'queue-now') {
        await core.session(body.sessionId);
        send(res, 200, await queueNow(ctx, body));
      }
      else if (['goal-state', 'goal-pause', 'goal-resume'].includes(body.action)) {
        await core.session(body.sessionId);
        send(res, 200, await goalCommand(ctx, body));
      }
      else if (['engine-state', 'set-engine'].includes(body.action)) {
        await core.session(body.sessionId);
        send(res, 200, await engineControl(ctx, body));
      }
      else throw new DirectFault(400, '不支持的操作');
      return true;
    }
    if (suffix.startsWith('harness/rpc/') && req.method === 'POST') {
      const abort = new AbortController(); res.on('close', () => abort.abort());
      const body = await readBody(req);
      const endpoint = suffix.slice('harness/rpc/'.length);
      if (!/^[A-Za-z0-9_$.-]+(?:\/[A-Za-z0-9_$.-]+)*$/.test(endpoint)) throw new DirectFault(400, '无效接口');
      const request = new Request('http://localhost/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal });
      const response = await handler.fetch(request, page.peer);
      res.writeHead(response.status, { ...Object.fromEntries(response.headers), 'cache-control': 'no-store' });
      if (response.body) await pipeline(Readable.fromWeb(response.body), res); else res.end();
      return true;
    }
    if (suffix === 'harness/uplink' && req.method === 'POST') {
      const body = await readBody(req), row = streams.get(body.streamId);
      if (!row || row.page !== page) throw new DirectFault(404, '流已关闭');
      if (body.end) row.queue.end(); else row.queue.push(body.value);
      send(res, 200, { ok: true }); return true;
    }
    if (suffix === 'harness/stream' && req.method === 'POST') {
      const body = await readBody(req);
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(body.streamId || '') || streams.has(body.streamId) || streams.size >= 300) throw new DirectFault(429, '流标识重复或连接过多');
      const abort = new AbortController(), queue = new Inbox(abort);
      const row = { page, abort, queue }; streams.set(body.streamId, row);
      res.on('close', () => { abort.abort(); queue.end(); });
      const pulse = setInterval(() => { try { core.authorizeDevice(page.deviceId); if (res.writableLength > 1048576) abort.abort(); else res.write('{"kind":"ping"}\n'); } catch { abort.abort(); } }, 10000);
      pulse.unref();
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      res.flushHeaders();
      try {
        const source = await ctx.typertGateway.wireStream.open(body.endpoint, body.payload, queue, page.peer, abort.signal);
        // Clients that ask for the lazy profile only receive slimmed journal
        // frames; full details come back per-seq through harness/command.
        const slim = body.detail === 'lazy' && body.endpoint === 'session/follow';
        for await (const value of source) {
          core.authorizeDevice(page.deviceId);
          const output = slim ? slimFollowValue(value) : value;
          if (!res.write(JSON.stringify({ kind: 'value', value: output }) + '\n')) await once(res, 'drain', { signal: abort.signal });
        }
        res.write('{"kind":"end"}\n');
      } catch (error) {
        if (!res.destroyed) res.write(JSON.stringify({ kind: 'error', error: ctx.typertGateway.wireStream.failure(error) }) + '\n');
      } finally { clearInterval(pulse); streams.delete(body.streamId); abort.abort(); queue.end(); res.end(); }
      return true;
    }
    throw new DirectFault(404, '接口不存在');
  };
  api.disconnect = () => { for (const [key, page] of pages) release(key, page); };
  api.dispose = () => { clearInterval(timer); core.revocationListeners.delete(revoke); api.disconnect(); };
  api.diagnostics = () => diagnostics.read();
  return api;
}

class Inbox {
  constructor(abort) { this.items = []; this.waiters = []; this.closed = false; this.abort = abort; }
  push(value) {
    if (this.closed) throw new DirectFault(409, '输入流已结束');
    if (this.items.length >= 32 || typeof value === 'undefined' || JSON.stringify(value).length > 262144) { this.abort.abort(); this.end(); throw new DirectFault(413, '流输入过大'); }
    const resolve = this.waiters.shift(); if (resolve) resolve({ value, done: false }); else this.items.push(value);
  }
  end() { this.closed = true; for (const resolve of this.waiters.splice(0)) resolve({ done: true }); }
  [Symbol.asyncIterator]() { return this; }
  next() { if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false }); if (this.closed) return Promise.resolve({ done: true }); return new Promise(resolve => this.waiters.push(resolve)); }
  return() { this.end(); return Promise.resolve({ done: true }); }
}
