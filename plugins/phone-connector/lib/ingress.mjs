import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from './store.mjs';
import { DirectFault } from './direct-host.mjs';
import { directPrefix } from './direct-http.mjs';

export function localAddresses() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, rows]) => rows
    .filter(row => row.family === 'IPv4' && !row.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(row.address))
    .map(row => ({ address: row.address, name })));
}
export class PhoneIngress {
  constructor(home, handler, core, { addresses = localAddresses } = {}) {
    this.handler = handler; this.core = core; this.addresses = addresses;
    this.store = new JsonStore(path.join(home, 'listener.json'),
      { version: 1, enabled: false, address: '', port: 0 }, value => value?.version === 1 && typeof value.enabled === 'boolean');
    this.server = null; this.error = ''; this.disposed = false; this.pending = Promise.resolve();
  }
  view() {
    const config = this.store.snapshot(), live = this.server?.listening;
    return { ...config, running: !!live, error: this.error, addresses: this.addresses(),
      base: live ? `http://${config.address}:${this.server.address().port}${directPrefix}` : '' };
  }
  configure(input) {
    const work = this.pending.then(() => this.change(input));
    this.pending = work.catch(() => {}); return work;
  }
  async resume() {
    const config = this.store.snapshot();
    if (config.enabled) try { await this.configure(config); }
    catch { this.error = '手机连接未启动，请检查网卡地址和端口后重新开启。'; }
  }
  async change(input) {
    if (this.disposed) throw new DirectFault(503, '手机连接插件已停止');
    if (typeof input.enabled !== 'boolean') throw new DirectFault(400, '连接开关无效');
    if (!input.enabled) {
      this.store.change(s => { s.enabled = false; }); await this.stop(); this.error = ''; return this.view();
    }
    const address = input.address, port = Number(input.port || 0);
    if (address !== '127.0.0.1' && !this.addresses().some(row => row.address === address)) throw new DirectFault(400, '请选择当前电脑的局域网地址');
    if (!Number.isInteger(port) || port < 0 || port > 65535 || port > 0 && port < 1024) throw new DirectFault(400, '端口须为1024至65535，留空自动分配');
    const old = this.store.snapshot();
    if (this.server?.listening && old.address === address && (!port || old.port === port)) return this.view();
    await this.stop();
    const server = http.createServer((req, res) => {
      const allowed = new Set([`${address}:${server.address()?.port}`,
        ...this.core.view().routes.map(row => new URL(row.base).host)]);
      if (!allowed.has(req.headers.host) || !req.url?.startsWith(directPrefix)) {
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        return res.end(JSON.stringify({ error: '接口不存在' }));
      }
      void this.handler(req, res);
    });
    server.headersTimeout = 10000; server.requestTimeout = 30000;
    this.server = server;
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, address, resolve); });
      if (this.disposed) { await this.stop(); throw new DirectFault(503, '手机连接插件已停止'); }
      this.store.change(s => { s.enabled = true; s.address = address; s.port = server.address().port; });
      server.on('error', () => { this.error = '手机连接服务暂不可用，请重新开启。'; });
      this.error = ''; return this.view();
    } catch (error) {
      await this.stop();
      if (error instanceof DirectFault) throw error;
      throw new DirectFault(400, '无法启动手机连接，请检查网卡地址或更换端口');
    }
  }
  async stop() {
    const server = this.server; this.server = null;
    this.core.close(); this.core.harnessHttp?.disconnect?.();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
  async dispose() {
    this.disposed = true; await this.pending; await this.stop();
  }
}
