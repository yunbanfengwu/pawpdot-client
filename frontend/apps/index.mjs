import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { installedApps } from './manifest.mjs';
import { createWorkspaceStore } from './store.mjs';
import { openView } from './view.mjs';

const prefix = '/api/pawpdot/apps';
const css = await readFile(new URL('./apps.css', import.meta.url));
const windowScript = await readFile(new URL('./window.js', import.meta.url));
const methods = new Set(['context.get', 'data.get', 'data.batch', 'data.assetPut', 'data.assetGet']);
const viewLifetime = 120_000;

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

function appWindow(res, app) {
  const title = app?.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') ?? '应用';
  const frameSource = app?.entry.type === 'external' ? 'https: http:' : 'http://localhost:*';
  const status = !app ? '应用未安装' : !app.enabled ? '应用已停用' : '';
  res.writeHead(!app ? 404 : !app.enabled ? 403 : 200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src ${frameSource}; base-uri 'none'; frame-ancestors 'none'`
  });
  res.end(`<!doctype html>
<html lang="zh-CN" class="aua-window">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="${prefix}/style.css">
  ${status ? '' : `<script defer src="${prefix}/window.js"></script>`}
</head>
<body class="aua-app">
  <p role="status">${status || '正在打开应用…'}</p>
</body>
</html>`);
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw Error('应用请求超过大小限制');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('应用请求格式无效');
  return input;
}

export const inject = ['pluginManager', 'profileContext', 'webServer', 'connection', 'storageDomain'];
export async function apply(ctx) {
  const profile = ctx.profileContext;
  const require = createRequire(profile.installAnchor);
  const domainModule = require.resolve('@deepseek-ai/dsh-storage-domain');
  const [{ resolveBundleDir }, { defineDomain, domainTable }, { z }] = await Promise.all([
    import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href),
    import(pathToFileURL(domainModule).href),
    import(pathToFileURL(createRequire(domainModule).resolve('zod')).href)
  ]);
  const collections = domainTable(z.object({ items: z.array(z.object({ id: z.string(), revision: z.number().int().positive(), value: z.json() })) }));
  const store = createWorkspaceStore({
    workspace: profile.cwd,
    openDomain: name => ctx.storageDomain.open(defineDomain({ name, version: 1, layout: 'per-record', tables: { collections } }))
  });
  const inventory = () => installedApps(ctx.pluginManager, id => resolveBundleDir('dsh', id, profile.installAnchor, profile.dir));
  const views = new Map();
  let disposed = false;
  const drop = id => {
    const view = views.get(id);
    if (!view) return;
    views.delete(id);
    view.close();
  };
  const timer = setInterval(() => {
    for (const view of views.values()) if (view.expires <= Date.now()) drop(view.id);
  }, 10000).unref();
  ctx.effect(() => async () => {
    disposed = true;
    clearInterval(timer);
    for (const id of views.keys()) drop(id);
    await store.close();
  });
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: prefix, handler: async (req, res) => {
    if (!ctx.connection.authorizeIndex(req, res)) return;
    const path = new URL(req.url, 'http://localhost').pathname.slice(prefix.length);
    try {
      if (req.method === 'GET' && path === '/style.css') {
        res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(css);
      }
      if (req.method === 'GET' && path === '/window.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return res.end(windowScript);
      }
      const windowMatch = req.method === 'GET' && /^\/window\/([^/]+)$/.exec(path);
      if (windowMatch) {
        const id = decodeURIComponent(windowMatch[1]);
        return appWindow(res, (await inventory()).find(item => item.id === id));
      }
      if (req.method === 'GET' && path === '') {
        const apps = (await inventory()).map(({ id, title, version, description, enabled, removable, icon, entry }) => (
          { id, title, version, description, enabled, removable, icon, entryType: entry.type }
        ));
        return json(res, 200, { apps });
      }
      if (req.method !== 'POST') return json(res, 404, { error: '应用接口不存在' });
      if (req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) {
        return json(res, 403, { error: '应用请求来源不匹配' });
      }
      const input = await body(req);
      if (path === '/close') {
        drop(input.view);
        return json(res, 200, { ok: true });
      }
      const view = views.get(input.view);
      const id = path === '/rpc' || path === '/keepalive' ? view?.appId : input.id;
      const app = (await inventory()).find(item => item.id === id);
      if (!app) return json(res, 404, { error: '应用未安装或视图已关闭' });
      if (path === '/enable' || path === '/remove') {
        if (path === '/enable' && typeof input.enabled !== 'boolean') throw Error('应用启用状态无效');
        if (path === '/remove' && !app.removable) throw Error('应用包不可卸载');
        const result = path === '/remove' ? await ctx.pluginManager.removeBundle(id) : await ctx.pluginManager.setBundleEnabled(id, input.enabled);
        if (!input.enabled || path === '/remove') for (const current of views.values()) if (current.appId === id) drop(current.id);
        if (result.application !== 'applied') return json(res, 409, { error: result.application === 'restart-required' ? '已保存设置，需重载开发版后生效' : '原生插件管理器未完成操作' });
        return json(res, 200, { ok: true });
      }
      if (!app.enabled) return json(res, 403, { error: '应用已停用' });
      if (path === '/open') {
        if (app.entry.type === 'external') return json(res, 200, { url: app.entry.url, type: 'external' });
        if (typeof input.parentOrigin !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(input.parentOrigin)) throw Error('应用容器来源无效');
        if (views.size >= 8) throw Error('打开的应用太多，请先关闭其他应用');
        const opened = await openView(app, input.parentOrigin);
        if (disposed || views.size >= 8) {
          opened.close();
          throw Error('应用宿主已重载或打开的应用太多');
        }
        views.set(opened.id, { ...opened, expires: Date.now() + viewLifetime });
        return json(res, 200, { url: opened.url, view: opened.id, type: 'package' });
      }
      if (!view || view.expires <= Date.now() || view.appVersion !== app.version) return json(res, 410, { error: '应用视图已失效，请重新打开' });
      if (path === '/keepalive') {
        view.expires = Date.now() + viewLifetime;
        return json(res, 200, { ok: true });
      }
      if (path !== '/rpc' || !methods.has(input.method)) return json(res, 404, { error: '应用接口未开放' });
      if (input.method === 'context.get') return json(res, 200, { locale: 'zh-CN', app: { key: app.id } });
      if (!input.params || typeof input.params !== 'object' || Array.isArray(input.params)) throw Error('应用参数无效');
      const result = await store.request(app, input.method, input.params);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 400, { error: error instanceof SyntaxError ? '应用请求格式无效' : error.message });
    }
  } }));
}
