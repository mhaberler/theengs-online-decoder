'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'web', 'catalog-util.js')).href);

test('compareVersions orders dotted versions numerically', async () => {
  const { compareVersions } = await load();
  assert.strictEqual(compareVersions('1.10.0', '1.9.2'), 1);
  assert.strictEqual(compareVersions('1.0', '1.0.0'), 0);
  assert.strictEqual(compareVersions('0.9.9', '1.0.0'), -1);
});

test('normalizeUuid shortens only Base UUIDs', async () => {
  const { normalizeUuid } = await load();
  assert.strictEqual(normalizeUuid('0xFCD2'), 'fcd2');
  assert.strictEqual(normalizeUuid('0000fe95-0000-1000-8000-00805f9b34fb'), 'fe95');
  assert.strictEqual(normalizeUuid('6e400001-b5a3-f393-e0a9-e50e24dcca9e'), '6e400001-b5a3-f393-e0a9-e50e24dcca9e');
});

test('matchesSeen uses manufacturer, service UUID and name; never matchAll', async () => {
  const { matchesSeen } = await load();
  const seen = { manufacturers: new Set(['9904']), serviceUUIDs: new Set(['fcd2']), names: new Set(['ATC_1234']) };
  assert.ok(matchesSeen({ manufacturer: '9904' }, seen));
  assert.ok(matchesSeen({ serviceUUID: '0xFCD2' }, seen));
  assert.ok(matchesSeen({ name: 'ATC' }, seen));
  assert.ok(!matchesSeen({ manufacturer: '4c00' }, seen));
  assert.ok(!matchesSeen({ matchAll: true }, seen));
});

test('resolveCatalog: JSON index directly, or the page\'s alternate link, or decoders.json', async () => {
  const { resolveCatalog } = await load();
  assert.deepStrictEqual(resolveCatalog('{"schema":1,"decoders":[]}', 'https://x/', null), { index: { schema: 1, decoders: [] } });
  const doc = (links) => ({ querySelectorAll: () => links.map((l) => ({ getAttribute: (k) => l[k] })) });
  const withLink = doc([{ rel: 'alternate', type: 'application/vnd.sensorble.catalog+json', href: 'cat/index.json' }]);
  assert.deepStrictEqual(resolveCatalog('<html>', 'https://a.b/c/', () => withLink), { next: 'https://a.b/c/cat/index.json' });
  assert.deepStrictEqual(resolveCatalog('<html>', 'https://a.b/c/', () => doc([])), { next: 'https://a.b/c/decoders.json' });
});

test('normalizeIndex resolves relative URLs and rejects unknown schemas', async () => {
  const { normalizeIndex } = await load();
  const n = normalizeIndex({ schema: 1, title: 'T', decoders: [{ decoderName: 'a', url: 'decoders/a.js', sha256: 'ab' }, { decoderName: 'nohash', url: 'x.js' }] }, 'https://h/cat/decoders.json');
  assert.strictEqual(n.entries.length, 1);
  assert.strictEqual(n.entries[0].url, 'https://h/cat/decoders/a.js');
  assert.throws(() => normalizeIndex({ schema: 2, decoders: [] }, 'https://h/'), /schema 2/);
  assert.throws(() => normalizeIndex({ schema: 1 }, 'https://h/'), /not a decoder catalog/);
});

test('sha256Hex matches node crypto', async () => {
  const { sha256Hex } = await load();
  const expect = require('node:crypto').createHash('sha256').update('héllo').digest('hex');
  assert.strictEqual(await sha256Hex('héllo'), expect);
});
