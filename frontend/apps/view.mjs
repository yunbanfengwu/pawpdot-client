import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, posix } from 'node:path';
import { within } from './manifest.mjs';

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'],
  ['.webp', 'image/webp'], ['.jpg', 'image/jpeg'], ['.woff2', 'font/woff2']
]);

export async function openView(app, parentOrigin) {
  const id = randomUUID();
  const bridge = await readFile(new URL('./package-bridge.js', import.meta.url), 'utf8');
  await within(app.root, app.entry.path);
  let port;
  const base = '/' + id + '/';
  const bridgePath = base + 'bridge.js';
  const server = createServer(async (req, res) => {
    if (req.headers.host !== `localhost:${port}` || req.method !== 'GET' || !req.url.startsWith(base)) {
      res.writeHead(404).end();
      return;
    }
    const headers = {
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; worker-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors ${parentOrigin}`
    };
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === bridgePath) {
        res.writeHead(200, { ...headers, 'content-type': 'text/javascript; charset=utf-8' });
        res.end(bridge.replace('__AUDOTER_PARENT_ORIGIN__', JSON.stringify(parentOrigin)));
        return;
      }
      const path = pathname.slice(base.length);
      const type = mime.get(extname(path));
      if (!pathname.startsWith(base) || !/^ui\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(path) || !type) {
        res.writeHead(404, headers).end();
        return;
      }
      const contents = await readFile(await within(app.root, path));
      const html = type.startsWith('text/html');
      const script = `<script src="${bridgePath}"></script>`;
      res.writeHead(200, { ...headers, 'content-type': type });
      res.end(html ? contents.toString('utf8').replace(/<head(?:\s[^>]*)?>/i, tag => tag + script) : contents);
    } catch {
      if (!res.headersSent) res.writeHead(404, headers);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
  server.unref();
  const origin = `http://localhost:${port}`;
  return {
    id, appId: app.id, appVersion: app.version, origin, url: origin + base + app.entry.path,
    close() { server.close(); server.closeAllConnections(); }
  };
}
