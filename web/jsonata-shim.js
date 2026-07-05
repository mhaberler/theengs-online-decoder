// jsonata ships UMD only (no ESM export). The './jsonata.min.js' URL maps to
// node_modules/jsonata/jsonata.min.js: vite via resolve.alias, serve.js via a
// route in resolveFile.
//
// Served raw (serve.js, vite dev) the UMD wrapper sees no `module`/`exports`
// and attaches `window.jsonata`. In the production bundle vite/rolldown wraps
// the file as CommonJS, so the UMD takes the `module.exports` branch instead
// and the namespace's interop `default` carries the function. Support both.
import * as umd from './jsonata.min.js';

export default umd.default ?? globalThis.jsonata;
