import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openStore, readJson, sendJson } from './storage.mjs';
import { createCompanionService } from './core.mjs';

export const inject = ['profileContext', 'webServer', 'connection'];

export async function apply(ctx) {
  const store = await openStore(join(ctx.profileContext.dir, 'pawpdot-pet.json'), { version: 2, selected: null, companions: [] });
  const companion = await createCompanionService(store);
  ctx.provide('pawpdotPet', {
    ...companion,
    http: { readJson, sendJson },
    async openGameStore(gameId, initial) {
      if (!/^[a-z][a-z0-9-]{0,60}$/.test(gameId)) throw Error('Invalid pet game ID');
      return openStore(join(ctx.profileContext.dir, 'pawpdot-pet-game-' + gameId + '.json'), initial);
    },
  });
  ctx.effect(() => () => store.flush());
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/api/pawpdot/pet',
    async handler(req, res) {
      if (!ctx.connection.authorizeIndex(req, res)) return;
      if (req.method === 'GET') return sendJson(res, 200, companion.getSnapshot());
      if (req.method !== 'POST') return res.writeHead(405, { Allow: 'GET, POST' }).end();
      if (req.headers.origin !== 'http://' + req.headers.host || !req.headers['content-type']?.startsWith('application/json')) {
        return sendJson(res, 403, { error: '请求来源不匹配' });
      }
      try {
        const input = await readJson(req, 1024);
        sendJson(res, 200, await companion.adopt(input.selected));
      } catch (error) {
        console.warn('PawPdot pet:', error.message);
        sendJson(res, error.status ?? 503, { error: error.status ? error.message : '宠物未保存，请重试' });
      }
    },
  }));
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
  // Register only packaged public files. Source and user data never enter the asset route.
  for (const file of await readdir(new URL('.', import.meta.url))) {
    const extension = file.slice(file.lastIndexOf('.'));
    if (!types[extension] || ['package.json', 'package-lock.json', 'client.js'].includes(file)) continue;
    const content = await readFile(new URL(file, import.meta.url));
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact', path: '/pawpdot/pet/' + file,
      async handler(req, res) {
        if (!ctx.connection.authorizeIndex(req, res)) return;
        if (req.method !== 'GET') return res.writeHead(405, { Allow: 'GET' }).end();
        res.writeHead(200, { 'content-type': types[extension], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(extension === '.png' ? await readFile(new URL(file, import.meta.url)) : content);
      },
    }));
  }
}
