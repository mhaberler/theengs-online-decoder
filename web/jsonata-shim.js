// jsonata ships UMD only (no ESM export). Importing it for its side effect
// makes the UMD wrapper attach `window.jsonata`; re-export that as default.
// The './jsonata.min.js' URL maps to node_modules/jsonata/jsonata.min.js:
// vite via resolve.alias, serve.js via a route in resolveFile.
import './jsonata.min.js';

export default window.jsonata;
