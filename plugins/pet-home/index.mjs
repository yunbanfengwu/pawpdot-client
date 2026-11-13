import { readFile, readdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { createHomeGame } from './game.mjs';

export const inject = ['profileContext', 'webServer', 'connection', 'pawpdotPet'];

export async function apply(ctx) {
  const { readJson, sendJson } = ctx.pawpdotPet.http;
  const store = await ctx.pawpdotPet.openGameStore('home', { version: 1, homes: {} });
  const game = createHomeGame(store, ctx.pawpdotPet);
  ctx.provide('pawpdotPetHome', game);
  ctx.effect(() => () => store.flush());
  ctx.effect(() => ctx.pawpdotPet.registerGame({ id: '@pawpdot/pet-home', title: '家园与旅行', href: '/pawpdot/pet-home/index.html' }));
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/api/pawpdot/pet-home',
    async handler(req, res) {
      if (!ctx.connection.authorizeIndex(req, res)) return;
      try {
        if (req.method === 'GET') return sendJson(res, 200, await game.snapshot());
        if (req.method !== 'POST') return res.writeHead(405, { Allow: 'GET, POST' }).end();
        if (req.headers.origin !== 'http://' + req.headers.host || !req.headers['content-type']?.startsWith('application/json')) {
          return sendJson(res, 403, { error: '请求来源不匹配' });
        }
        sendJson(res, 200, await game.act(await readJson(req)));
      } catch (error) {
        console.warn('PawPdot pet home:', error.message);
        sendJson(res, error.status ?? 503, { error: error.status ? error.message : '家园暂时无法保存，请重试' });
      }
    },
  }));
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.webp': 'image/webp' };
  for (const directory of ['public', 'public/assets']) {
    const root = new URL('./' + directory + '/', import.meta.url);
    for (const file of await readdir(root)) {
      const type = types[extname(file)];
      if (!type) continue;
      const content = await readFile(new URL(file, root));
      const route = '/pawpdot/pet-home/' + (directory.endsWith('/assets') ? 'assets/' : '') + file;
      ctx.effect(() => ctx.webServer.register({
        kind: 'exact', path: route,
        handler(req, res) {
          if (!ctx.connection.authorizeIndex(req, res)) return;
          if (req.method !== 'GET') return res.writeHead(405, { Allow: 'GET' }).end();
          res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
          res.end(content);
        },
      }));
    }
  }
}
