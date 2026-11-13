import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const inject = ['profileContext', 'webServer', 'connection', 'workspaceRegistry', 'workspaceController', 'sessionController'];

async function getPrimaryId(directory) {
  const file = join(directory, 'pawpdot-primary-session');
  try {
    await writeFile(file, randomUUID(), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const id = await readFile(file, 'utf8');
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid primary session ID');
  return id;
}

export async function apply(ctx) {
  const id = await getPrimaryId(ctx.profileContext.dir);
  const assets = [
    ['/pawpdot/desktop.css', './desktop.css', 'text/css'],
    ['/pawpdot/tokens.css', './tokens.css', 'text/css'],
    ['/pawpdot/brand.svg', '../../assets/brand/pawpdot-mark.svg', 'image/svg+xml'],
  ];
  for (const [path, file, type] of assets) {
    const content = await readFile(new URL(file, import.meta.url));
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact', path,
      handler(req, res) {
        if (!ctx.connection.authorizeIndex(req, res)) return;
        if (req.method !== 'GET') return res.writeHead(405, { Allow: 'GET' }).end();
        res.writeHead(200, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store' });
        res.end(content);
      },
    }));
  }
  let prepared;
  const prepare = () => prepared ??= (async () => {
    const signal = AbortSignal.timeout(12000);
    if (!ctx.workspaceRegistry.list().length) await ctx.workspaceController.initializeDefault(signal);
    const workspace = await ctx.workspaceRegistry.create(process.cwd(), '主对话');
    if (!workspace.sessionIds.includes(id)) {
      const { items } = await ctx.sessionController.list({}, signal);
      if (items.some(session => session.sessionId === id)) await workspace.attachSession(id);
      else {
        const result = await ctx.sessionController.create({ sessionId: id, workspaceId: workspace.id });
        if (result.sessionId !== id) throw new Error('Could not create primary session');
      }
    }
    return { id, workspaceId: workspace.id };
  })().catch(error => { prepared = undefined; throw error; });
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/pawpdot/primary-session',
    async handler(req, res) {
      if (!ctx.connection.authorizeIndex(req, res)) return;
      if (req.method !== 'POST') return res.writeHead(405, { Allow: 'POST' }).end();
      if (req.headers.origin !== 'http://' + req.headers.host) return res.writeHead(403).end();
      try {
        const target = await prepare();
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(target));
      } catch (error) {
        console.warn('PawPdot primary conversation:', error.message);
        res.writeHead(503).end();
      }
    },
  }));
}
