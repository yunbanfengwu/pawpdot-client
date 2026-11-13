import { readFileSync } from 'node:fs';

// Font assets are public, immutable product resources; never resolve arbitrary paths.
const names = new Set(['fonts.css', ...['45-Light', '55-Regular', '65-Medium', '75-SemiBold']
  .map(weight => `AlibabaPuHuiTi-3-${weight}.woff2`)]);
export function serveFont(name, req, res) {
  if (!names.has(name) || !['GET', 'HEAD'].includes(req.method)) return false;
  const data = readFileSync(new URL(name, import.meta.url));
  const css = name.endsWith('.css');
  res.writeHead(200, { 'content-type': css ? 'text/css; charset=utf-8' : 'font/woff2',
    'content-length': data.length, 'cache-control': css ? 'no-cache' : 'public, max-age=86400', 'x-content-type-options': 'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : data);
  return true;
}
