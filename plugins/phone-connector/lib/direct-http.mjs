import fs from 'node:fs';
import { DirectFault } from './direct-host.mjs';

export const directPrefix = '/api/teamseek/direct/';
const publicFile = name => fs.readFileSync(new URL('../public/' + name, import.meta.url));
export async function jsonBody(req) {
  const chunks = []; let size = 0;
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new DirectFault(400, '需要JSON请求');
  for await (const part of req) { size += part.length; if (size > 2800000) throw new DirectFault(413, '请求过大'); chunks.push(part); }
  const value = JSON.parse(Buffer.concat(chunks).toString());
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DirectFault(400, '需要对象');
  return value;
}
export function directHandler(core) {
  const attempts = new Map(), live = new Set();
  const send = (res, status, value, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    res.end(JSON.stringify(value));
  };
  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, 'https://localhost');
      const suffix = url.pathname.slice(directPrefix.length);
      if (!url.pathname.startsWith(directPrefix)) return send(res, 404, { error: '接口不存在' });
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new DirectFault(403, '来源不匹配');
      if (suffix.startsWith('harness/') && req.method !== 'GET' && !origin) throw new DirectFault(403, '网页操作需要同源请求');
      if (core.harnessHttp && await core.harnessHttp(suffix, req, res)) return;
      if (req.method === 'GET' && suffix === 'identity') return send(res, 200, core.identity());
      if (req.method === 'POST' && ['offer', 'pair'].includes(suffix)) {
        const key = req.socket.remoteAddress, minute = Math.floor(Date.now() / 60000);
        const old = attempts.get(key), count = old?.minute === minute ? old.count + 1 : 1;
        attempts.set(key, { minute, count });
        if (attempts.size > 2000) for (const [ip, row] of attempts) if (row.minute < minute) attempts.delete(ip);
        if (count > 12) throw new DirectFault(429, '配对尝试过多');
        const input = await jsonBody(req);
        return send(res, 200, suffix === 'offer' ? core.resolveOffer(input.code) : core.pair(input));
      }
      if (req.method === 'GET' && ['mobile/', 'mobile/index.html', 'mobile/bridge.js', 'mobile/chat.js'].includes(suffix)) {
        const script = suffix.endsWith('.js');
        res.writeHead(200, { 'content-type': script ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
          'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
        return res.end(publicFile(script ? suffix.slice(7) : 'mobile.html'));
      }
      if (req.method === 'POST' && suffix === 'mobile/session') {
        const exchange = core.exchange((await jsonBody(req)).ticket);
        return send(res, 200, { sessionId: exchange.sessionId, webToken: exchange.cookie });
      }
      const mobile = suffix.startsWith('mobile/api/');
      let device, session;
      if (mobile) {
        const auth = req.headers.authorization || '';
        const web = core.web(auth.startsWith('Bearer ') ? auth.slice(7) : ''); device = core.authorizeDevice(web.deviceId); session = web.sessionId;
        if (req.method !== 'GET' && !origin) throw new DirectFault(403, '网页写入需要同源请求');
      } else {
        const auth = req.headers.authorization || '';
        device = core.authorize(auth.startsWith('Bearer ') ? auth.slice(7) : '');
      }
      const action = mobile ? suffix.slice('mobile/api/'.length) : suffix;
      if (!mobile && core.inbox && ['messages', 'messages/ack', 'messages/open'].includes(action)) {
        try {
          if (req.method === 'GET' && action === 'messages') return send(res, 200, core.inbox.list(device));
          if (req.method === 'POST' && action === 'messages/ack') return send(res, 200, core.inbox.ack(device, await jsonBody(req)));
          if (req.method === 'POST' && action === 'messages/open') return send(res, 200, await core.inbox.open(device, await jsonBody(req)));
          return send(res, 405, { error: '不支持的请求方法' });
        } catch (error) { return send(res, error.status || 503, { error: error.status ? error.message : '消息服务暂不可用' }); }
      }
      if (req.method === 'GET' && action === 'config' && !mobile) return send(res, 200, core.harnessConfig(device));
      if (req.method === 'POST' && action === 'image-message' && !mobile) {
        if (!core.mobileImages) return send(res, 503, { error: '电脑图片接入组件尚未就绪', definitelyNotAccepted: true });
        try { return send(res, 200, await core.mobileImages.send(device, await jsonBody(req))); }
        catch (error) { return send(res, error.status || 503, { error: error.status ? error.message : '图片发送未确认，请先查看会话，避免重复发送', definitelyNotAccepted: error.definitelyNotAccepted === true }); }
      }
      if (req.method === 'POST' && action === 'harness-ticket' && !mobile) return send(res, 200, await core.harnessTicket(device, (await jsonBody(req)).sessionId));
      if (req.method === 'GET' && action === 'directory') return send(res, 200, await core.directory(url.searchParams.get('activity') === '1'));
      if (req.method === 'POST' && action === 'web-ticket' && !mobile) return send(res, 200, await core.webTicket(device, (await jsonBody(req)).sessionId));
      if (req.method === 'GET' && action === 'history' && mobile) {
        await core.session(session);
        return send(res, 200, await core.adapter.history(session));
      }
      if (req.method === 'GET' && action === 'events' && mobile && core.adapter.follow) {
        await core.session(session);
        if (live.size >= 100) throw new DirectFault(429, '实时连接过多');
        const abort = new AbortController(); live.add(abort);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
        res.on('close', () => abort.abort());
        const timer = setInterval(() => {
          try { core.web((req.headers.authorization || '').slice(7)); res.write(': keepalive\n\n'); }
          catch { abort.abort(); res.end(); }
        }, 10000); timer.unref();
        try {
          for await (const value of core.adapter.follow(session, abort.signal)) {
            core.authorizeDevice(device.id);
            const output = `data: ${JSON.stringify(value)}\n\n`;
            if (res.writableLength > 1024 * 1024) break;
            res.write(output);
          }
        } catch { if (!res.destroyed) res.write('event: unavailable\ndata: {}\n\n'); }
        finally { clearInterval(timer); live.delete(abort); abort.abort(); res.end(); }
        return;
      }
      if (req.method === 'POST' && action === 'prompt') {
        const input = await jsonBody(req);
        if (mobile && input.sessionId !== session) throw new DirectFault(403, '网页不能切换到票据外的会话');
        return send(res, 200, await core.prompt(device, input));
      }
      if (req.method === 'POST' && action === 'cancel') {
        const target = mobile ? session : (await jsonBody(req)).sessionId;
        await core.session(target); return send(res, 200, await core.adapter.cancel(target));
      }
      if (req.method === 'POST' && action === 'voice' && !mobile) return send(res, 200, await core.voice(device, await jsonBody(req)));
      throw new DirectFault(404, '接口不存在');
    } catch (error) {

      if (res.headersSent) return res.end();
      send(res, error instanceof DirectFault ? error.status : 503,
        { error: error instanceof DirectFault ? error.message : '实例暂时无法完成请求，请检查宿主状态' });
    }
  };
  handler.dispose = () => { for (const abort of live) abort.abort(); live.clear(); core.close(); };
  return handler;
}
