import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

// The shared modules in ../web import sensor-ble ('./sensor-ble/…') and the
// jsonata UMD build ('./jsonata.min.js', via web/jsonata-shim.js) by relative
// URL; map both into the repo root's node_modules as web/vite.config.mjs does.
// Neither tab needs the theengs wasm.
export default defineConfig({
  root: __dirname,
  base: './',
  resolve: {
    alias: {
      './sensor-ble': resolve(REPO, 'node_modules', 'sensor-ble'),
      './jsonata.min.js': resolve(REPO, 'node_modules', 'jsonata', 'jsonata.min.js'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    fs: { allow: [REPO] },
  },
});
