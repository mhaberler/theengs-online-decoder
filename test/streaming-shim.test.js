'use strict';

// The Capacitor app runs sensor-ble's streaming decoders in a WebView with the
// Buffer shim (web/buffer-shim.js) instead of Node's Buffer. Run their own
// test vectors through the shim, the way sensor-ble's harness/test.js does:
// start() with a no-op bleApi, feed each message to its notify handler, and
// compare the most recent non-null result.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const devices = path.join(__dirname, '..', 'node_modules', 'sensor-ble', 'devices');
const shimUrl = pathToFileURL(path.join(__dirname, '..', 'web', 'buffer-shim.js')).href;

for (const file of fs.readdirSync(devices).filter((f) => f.endsWith('.js'))) {
  test(`streaming decoder ${file} passes its tests with the Buffer shim`, async (t) => {
    const mod = await import(pathToFileURL(path.join(devices, file)).href);
    const d = mod.decoder;
    if (typeof d.start !== 'function' || !Array.isArray(d.notify)) return t.skip('not a streaming decoder');
    const { Buffer: Shim } = await import(shimUrl);
    const realBuffer = globalThis.Buffer;
    globalThis.Buffer = Shim; // decoders may use the Buffer global (e.g. concat)
    try {
      for (const tc of mod.tests.filter((x) => x.given.data)) {
        d.start('test-device', false, { write: () => {} });
        let last;
        for (const m of tc.given.data) {
          const h = d.notify.find((n) => n.service === m.service && n.characteristic === m.characteristic);
          assert.ok(h, `no handler for ${m.service} ${m.characteristic}`);
          const out = h.onNotification('test-device', Shim.from(m.data, 'hex'));
          if (out) last = out;
        }
        assert.strictEqual(JSON.stringify(last), JSON.stringify(tc.expected));
      }
    } finally {
      globalThis.Buffer = realBuffer;
    }
  });
}
