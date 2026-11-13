import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Serialize changes before publishing them so concurrent windows never lose a purchase or adoption.
export async function openStore(file, initial) {
  let state;
  try { state = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = structuredClone(initial);
  }
  let pending = Promise.resolve();
  return {
    snapshot: () => structuredClone(state),
    update(change) {
      const operation = pending.then(async () => {
        const next = structuredClone(state);
        const result = await change(next);
        if (JSON.stringify(next) === JSON.stringify(state)) return result;
        const temporary = file + '.' + randomUUID() + '.tmp';
        try {
          await writeFile(temporary, JSON.stringify(next) + '\n', { flag: 'wx', mode: 0o600 });
          await rename(temporary, file);
          state = next;
        } finally {
          await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
        return result;
      });
      pending = operation.catch(() => {});
      return operation;
    },
    flush: () => pending,
  };
}

export function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

export async function readJson(req, maximum = 32768) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maximum) throw Object.assign(Error('请求过大'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch { throw Object.assign(Error('请求格式无效'), { status: 400 }); }
}
