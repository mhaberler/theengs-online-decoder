'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () =>
  import(pathToFileURL(path.join(__dirname, '..', 'app', 'scan-entry.js')).href)
    .then((m) => m.scanResultToEntry);

const dv = (hex) => new DataView(Uint8Array.from(Buffer.from(hex, 'hex')).buffer);

test('prefixes manufacturer data with the company ID, little-endian', async () => {
  const toEntry = await load();
  // Ruuvi: company 0x0499, plugin key is the decimal ID.
  const e = toEntry({ device: { deviceId: 'AA:BB:CC:DD:EE:FF' }, rssi: -70, manufacturerData: { 1177: dv('0512fc') } });
  assert.strictEqual(e.manufacturerdata, '99040512fc');
  assert.strictEqual(e.id, 'AA:BB:CC:DD:EE:FF');
  assert.strictEqual(e.mac, 'AA:BB:CC:DD:EE:FF');
  assert.strictEqual(e.rssi, -70);
});

test('keeps every service-data element in serviceDataMap', async () => {
  const toEntry = await load();
  const e = toEntry({
    device: { deviceId: 'x' },
    serviceData: {
      '0000fcd2-0000-1000-8000-00805f9b34fb': dv('40010a'),
      '0000fe95-0000-1000-8000-00805f9b34fb': dv('7120'),
    },
  });
  assert.deepStrictEqual(e.serviceDataMap, {
    '0000fcd2-0000-1000-8000-00805f9b34fb': '40010a',
    '0000fe95-0000-1000-8000-00805f9b34fb': '7120',
  });
  assert.strictEqual(e.servicedata, '40010a');
  assert.strictEqual(e.servicedatauuid, '0xfcd2');
});

test('prefers localName over device.name', async () => {
  const toEntry = await load();
  assert.strictEqual(toEntry({ device: { deviceId: 'x', name: 'gap' }, localName: 'adv' }).name, 'adv');
  assert.strictEqual(toEntry({ device: { deviceId: 'x', name: 'gap' } }).name, 'gap');
});

test('an advert without payloads yields a bare entry', async () => {
  const toEntry = await load();
  const e = toEntry({ device: { deviceId: 'x' }, rssi: -90 });
  assert.deepStrictEqual(e, { id: 'x', mac: 'x', rssi: -90 });
});

test('shortens only Bluetooth Base UUIDs to the dongle form', async () => {
  const { shortUuid } = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'scan-entry.js')).href);
  assert.strictEqual(shortUuid('0000FE95-0000-1000-8000-00805F9B34FB'), '0xfe95');
  const custom = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  assert.strictEqual(shortUuid(custom), custom);
});
