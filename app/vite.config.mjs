import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

// The shared modules in ../web import sensor-ble by the relative URL
// './sensor-ble/…'; map it into the repo root's node_modules as
// web/vite.config.mjs does. The sensor-ble tab needs no wasm or jsonata.
export default defineConfig({
  root: __dirname,
  base: './',
  resolve: {
    alias: {
      './sensor-ble': resolve(REPO, 'node_modules', 'sensor-ble'),
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
