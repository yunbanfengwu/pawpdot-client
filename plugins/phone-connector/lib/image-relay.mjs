import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';

const limit = 12 * 1024 * 1024;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml']);
const fault = (status, message) => Object.assign(Error(message), { status });
export function publicIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c)))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}

// Only external images: no local paths, browser cookies, model credentials or
// private network addresses. Pin the validated DNS answer for every hop.
export async function readPublicImage(input, { signal, lookup = dns.lookup, dial } = {}) {
  if (typeof input !== 'string' || input.length > 16384) throw fault(400, '图片地址无效');
  let url;
  try { url = new URL(input); } catch { throw fault(400, '图片地址无效'); }
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw fault(400, '仅支持标准 HTTP(S) 图片地址');
    const addresses = await lookup(url.hostname, { family: 4, all: true });
    if (!addresses.length || !addresses.every(row => row.family === 4 && publicIPv4(row.address))) throw fault(403, '图片转发不访问本机或内网地址');
    const open = dial || ((url, options) => new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? https : http).get(url, options, resolve);
      request.on('error', reject);
      request.setTimeout(12000, () => request.destroy(fault(504, '图片读取超时')));
    }));
    const response = await open(url, {
      signal,
      headers: { accept: 'image/*', 'user-agent': 'TeamSeek-Mobile-Image/1' },
      lookup: (_host, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, 4),
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
      response.resume(); url = new URL(response.headers.location, url); continue;
    }
    const type = (response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (response.statusCode !== 200 || !imageTypes.has(type)) { response.destroy(); throw fault(502, '来源没有返回可显示的图片'); }
    if (Number(response.headers['content-length']) > limit) { response.destroy(); throw fault(413, '图片超过12MB'); }
    const chunks = []; let bytes = 0;
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > limit) { response.destroy(); throw fault(413, '图片超过12MB'); }
      chunks.push(chunk);
    }
    return { type, body: Buffer.concat(chunks) };
  }
  throw fault(502, '图片重定向次数过多');
}
