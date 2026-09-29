'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { OUT } = require('../scripts/build-sensorble-theengs.js');
const { ready, decodeBLE } = require('..');

const ROPOT_PAYLOAD = '71205d0183d20c6d8d7cc40d08100103';
const ECHOES = ['servicedata', 'manufacturerdata', 'servicedatauuid', 'name', 'id'];

// Tests the committed file; `bun run build-sensorble-theengs` regenerates it.
const load = () => import(pathToFileURL(OUT).href).then((m) => m.decoder);

test('generated decoder is self-contained (no import/require)', () => {
  const body = fs.readFileSync(OUT, 'utf8');
  assert.deepStrictEqual(body.match(/\bimport\b|\brequire\b/g), null);
});

test('exports a matchAll, variableFormat sensor-ble decoder', async () => {
  const decoder = await load();
  assert.strictEqual(decoder.decoderName, 'theengs');
  assert.strictEqual(decoder.matchAll, true);
  assert.strictEqual(decoder.variableFormat, true);
  assert.strictEqual(decoder.manufacturer, undefined);
  assert.strictEqual(decoder.serviceUUID, undefined);
});

test('decodes like index.js decodeBLE, minus echoed input', async () => {
  const decoder = await load();
  await ready();
  const got = decoder.advertisementDecode(
    undefined,
    { fe95: Buffer.from(ROPOT_PAYLOAD, 'hex') },
    { name: 'x', id: 'AA:BB:CC:DD:EE:FF' },
  );
  const want = await decodeBLE({
    servicedata: ROPOT_PAYLOAD, servicedatauuid: '0xfe95', name: 'x', id: 'AA:BB:CC:DD:EE:FF',
  });
  for (const k of ECHOES) delete want[k];
  assert.deepStrictEqual(got, want);
  assert.strictEqual(got.model_id, 'HHCCPOT002');
});

test('returns null for unknown payloads', async () => {
  const decoder = await load();
  assert.strictEqual(decoder.advertisementDecode(Buffer.from('ffff00', 'hex'), {}, {}), null);
  assert.strictEqual(decoder.advertisementDecode(undefined, {}, undefined), null);
});

test('carries catalog metadata and passing embedded tests', async () => {
  const mod = await import(pathToFileURL(OUT).href);
  const d = mod.decoder;
  assert.match(d.version, /^\d+\.\d+\.\d+\.\d+$/);
  assert.strictEqual(d.license, 'GPL-3.0-only');
  assert.ok(d.title && d.description);
  assert.ok(mod.tests.length >= 2);
  // Same call shape as the catalog build (hex -> Buffer, meta passed through).
  for (const t of mod.tests) {
    const md = t.given.manufacturerData ? Buffer.from(t.given.manufacturerData, 'hex') : undefined;
    const sd = Object.fromEntries(Object.entries(t.given.serviceData ?? {}).map(([u, h]) => [u, Buffer.from(h, 'hex')]));
    assert.deepStrictEqual(d.advertisementDecode(md, sd, t.given.meta ?? {}), t.expected);
  }
});
