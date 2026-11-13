import {canonical, terminalId} from '../relay/envelope.mjs';
import {UI_PROTOCOL, UI_SERVICE, UiFault, validateExtension, validateSnapshot, validateInvocation, validateResult} from './contract.mjs';

// A trusted host SDK, not a sandbox. An authenticated routing identity is supplied
// by RelayHub; each host must independently implement business authorization.
export class TerminalUiRegistry {
  constructor({terminalId: target, authorize, now = Date.now, maxInvocations = 1024, invocationTtl = 600000}) {
    if (!terminalId(target) || typeof authorize !== 'function') throw Error('终端标识及业务授权函数必填');
    Object.assign(this, {terminalId: target, authorize, now, maxInvocations, invocationTtl});
    this.extensions = new Map(); this.invocations = new Map(); this.views = new Map(); this.revision = 0;
  }
  snapshot() { return structuredClone(validateSnapshot({protocol: UI_PROTOCOL, terminalId: this.terminalId, revision: this.revision, extensions: [...this.extensions.values()].map(e => e.manifest)})); }
  register(manifest, handlers) {
    manifest = structuredClone(validateExtension(manifest));
    if (this.extensions.has(manifest.id)) throw new UiFault('CONFLICT', '扩展已注册');
    if (!handlers || manifest.actions.some(a => typeof handlers[a.id] !== 'function') || Object.keys(handlers).some(key => !manifest.actions.some(a => a.id === key))) throw new UiFault('INVALID_UI', '动作实现必须与声明一致');
    const entry = {manifest, handlers: {...handlers}, abort: new AbortController()};
    this.extensions.set(manifest.id, entry);
    try { this.snapshot(); } catch (error) { this.extensions.delete(manifest.id); throw error; }
    this.revision++;
    let disposed = false;
    return () => { if (disposed) return; disposed = true; if (this.extensions.get(manifest.id) === entry) { this.extensions.delete(manifest.id); this.revision++; entry.abort.abort(); } };
  }
  async visible(identity) {
    for (let retry = 0; retry < 3; retry++) {
      const snapshot = this.snapshot(), allowed = [];
      for (const manifest of snapshot.extensions) if (await this.authorize({operation: 'discover', extensionId: manifest.id, identity})) allowed.push(manifest);
      // Never label an old manifest with a revision read after asynchronous
      // authorization. That would let a button invoke a replacement handler.
      if (snapshot.revision !== this.revision) continue;
      const fingerprint = canonical(allowed), key = identity.terminalId, previous = this.views.get(key);
      if (previous && previous.fingerprint !== fingerprint && previous.revision === this.revision) this.revision++;
      if (!this.views.has(key) && this.views.size >= 256) this.views.delete(this.views.keys().next().value);
      this.views.set(key, {fingerprint, revision: this.revision});
      return {...snapshot, revision: this.revision, extensions: allowed};
    }
    throw new UiFault('STALE_UI', '界面正在更新，请稍后同步');
  }
  async request(message, identity) {
    try {
      if (message.type !== 'request' || message.to !== this.terminalId || !terminalId(message.from) || !identity || ![identity.userId, identity.tenantId, identity.spaceId].every(terminalId)) throw new UiFault('DENIED', '未认证的界面请求');
      if (message.service !== UI_SERVICE) throw new UiFault('UNSUPPORTED', '终端未提供该业务服务');
      if (message.method === 'discover') {
        const input = message.payload;
        if (!input || Object.keys(input).length !== 1 || input.protocol !== UI_PROTOCOL) throw new UiFault('INVALID_UI', '发现协议无效');
        return await this.visible({...identity, terminalId: message.from});
      }
      if (message.method !== 'invoke') throw new UiFault('UNSUPPORTED', '界面方法不支持');
      const input = validateInvocation(message.payload), entry = this.extensions.get(input.extensionId), actor = {...identity, terminalId: message.from};
      if (!entry || !entry.manifest.permissions.includes('ui.invoke') || !Object.hasOwn(entry.handlers, input.actionId) || !await this.authorize({operation: 'discover', extensionId: input.extensionId, identity: actor}) || !await this.authorize({operation: 'invoke', extensionId: input.extensionId, actionId: input.actionId, identity: actor})) throw new UiFault('DENIED', '动作不可用或没有权限');
      if (this.extensions.get(input.extensionId) !== entry || entry.abort.signal.aborted) throw new UiFault('STALE_UI', '扩展已更新，请同步后操作');
      const key = message.from + ':' + input.invocationId, fingerprint = canonical(input), old = this.invocations.get(key);
      if (old && old.expiresAt > this.now()) {
        if (old.fingerprint !== fingerprint) throw new UiFault('CONFLICT', '同一动作ID不能对应不同内容');
        return await old.promise;
      }
      if (input.revision !== this.revision) throw new UiFault('STALE_UI', '界面已更新，请刷新后操作');
      for (const [id, row] of this.invocations) if (row.done && row.expiresAt <= this.now()) this.invocations.delete(id);
      if (this.invocations.size >= this.maxInvocations) throw new UiFault('BUSY', '动作账本已满，请稍后重试');
      const row = {fingerprint, expiresAt: Infinity, done: false};
      // Publish the ledger before yielding to a handler. Duplicate concurrent
      // delivery joins this exact promise and cannot execute a side effect twice.
      row.promise = Promise.resolve().then(async () => {
        if (entry.abort.signal.aborted) throw new UiFault('STALE_UI', '扩展已停用');
        const output = await entry.handlers[input.actionId]({input: structuredClone(input.input), identity: actor, invocationId: input.invocationId, signal: entry.abort.signal});
        if (entry.abort.signal.aborted) throw new UiFault('UNKNOWN', '扩展已停用，操作结果需向业务端核对');
        const snapshot = await this.visible(actor);
        if (output && Object.keys(output).some(key => !['result', 'overlay'].includes(key))) throw new UiFault('INVALID_UI', '处理器只可返回result或overlay');
        const result = {ok: true, ...(output || {}), ...(this.revision !== input.revision ? {snapshot} : {})};
        return validateResult(result, snapshot, input.extensionId);
      }).catch(error => this.failure(error)).finally(() => { row.done = true; row.expiresAt = this.now() + this.invocationTtl; });
      this.invocations.set(key, row);
      return await row.promise;
    } catch (error) { return this.failure(error); }
  }
  failure(error) { return {error: {code: error instanceof UiFault ? error.code : 'BUSINESS_ERROR', message: error instanceof UiFault ? error.message : '业务操作失败，请核对结果后重试'}}; }
  close() { for (const entry of this.extensions.values()) entry.abort.abort(); if (this.extensions.size) this.revision++; this.extensions.clear(); this.invocations.clear(); this.views.clear(); }
}
