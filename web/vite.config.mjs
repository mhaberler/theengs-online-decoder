import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The decoder wasm glue is shipped by the theengs-decoder dependency. The
// browser code imports it by the relative URL './theengs_decoder_wasm.mjs';
// map that to the artifact inside node_modules so nothing is copied or
// committed locally.
const WASM = resolve(
  __dirname,
  '..',
  'node_modules',
  'theengs-decoder',
  'dist',
  'theengs_decoder_wasm.mjs',
);

export default defineConfig({
  root: __dirname,
  base: './',
  resolve: {
    alias: {
      './theengs_decoder_wasm.mjs': WASM,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
