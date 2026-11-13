import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: [fileURLToPath(new URL('./src/player.mjs', import.meta.url))],
  outfile: fileURLToPath(new URL('./pet.js', import.meta.url)),
  bundle: true,
  minify: true,
  target: ['chrome100'],
  legalComments: 'eof',
});
