import { readFile } from 'node:fs/promises';

export const inject = ['webServer', 'connection'];

export async function apply(ctx) {
  const css = await readFile(new URL('./account.css', import.meta.url));
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/pawpdot/account.css',
    handler(req, res) {
      if (!ctx.connection.authorizeIndex(req, res)) return;
      if (req.method !== 'GET') return res.writeHead(405, { Allow: 'GET' }).end();
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
      res.end(css);
    },
  }));
}
