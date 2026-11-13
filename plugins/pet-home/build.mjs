import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: [fileURLToPath(new URL('./src/main.mjs', import.meta.url))],
  outfile: fileURLToPath(new URL('./public/game.js', import.meta.url)),
  alias: {
    'three/addons': fileURLToPath(new URL('./node_modules/three/examples/jsm', import.meta.url)),
    three: fileURLToPath(new URL('./node_modules/three/build/three.module.js', import.meta.url)),
  },
  bundle: true, minify: true, target: ['chrome100'], legalComments: 'eof',
});
