'use strict';

// Convert a @capacitor-community/bluetooth-le ScanResult into the advertisement
// entry shape the sensor-ble tab decodes (see readEntry in
// web/sensorble-decode.js). Kept free of plugin imports so node tests can load it.

function bytesToHex(dv) {
  let s = '';
  for (let i = 0; i < dv.byteLength; i++) s += dv.getUint8(i).toString(16).padStart(2, '0');
  return s;
}

// Bluetooth Base UUID 0000xxxx-0000-1000-8000-00805f9b34fb → '0xxxxx', the form
// the dongle drivers (web/drivers/ad.js) emit, so JSONata expressions written
// against dongle traffic match phone scans too. Other UUIDs pass through.
const BASE_UUID = /^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i;

export function shortUuid(uuid) {
  const m = BASE_UUID.exec(uuid);
  return m ? '0x' + m[1].toLowerCase() : uuid;
}

// sensor-ble decoders use 16-bit ('180d'), 32-bit or full 128-bit UUIDs; the
// plugin wants 128-bit. Full UUIDs pass through unchanged (WitMotion's
// '…-00805f9a34fb' is deliberately not the Bluetooth Base UUID).
export function uuid128(u) {
  let s = String(u).toLowerCase();
  if (s.startsWith('0x')) s = s.slice(2);
  if (/^[0-9a-f]{4}$/.test(s)) return `0000${s}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}$/.test(s)) return `${s}-0000-1000-8000-00805f9b34fb`;
  return s;
}

export function scanResultToEntry(result) {
  const id = result.device?.deviceId || '?';
  // deviceId is the MAC on Android and a per-phone UUID on iOS; either way it
  // identifies the device, which is all the row's Δ-time needs.
  const e = { id, mac: id, rssi: result.rssi };
  const name = result.localName ?? result.device?.name;
  if (name) e.name = name;

  // The plugin keys manufacturer data by company ID (decimal) and strips it
  // from the payload; the entry format carries it as the first 2 bytes, LE.
  // Several manufacturer-data elements in one advert are rare: keep the first.
  for (const [key, dv] of Object.entries(result.manufacturerData ?? {})) {
    const cid = Number(key);
    const lo = (cid & 0xff).toString(16).padStart(2, '0');
    const hi = ((cid >> 8) & 0xff).toString(16).padStart(2, '0');
    e.manufacturerdata = lo + hi + bytesToHex(dv);
    break;
  }

  // Advertised service UUIDs: how connectable sensors (heart-rate straps,
  // TESS, …) announce themselves; used to offer streaming decoders.
  if (result.uuids?.length) e.serviceUuids = result.uuids.map(shortUuid);

  // Service data: keep every element (readEntry accepts the map); the first
  // one is also exposed in the flat fields so the raw view reads as usual.
  const sd = Object.entries(result.serviceData ?? {});
  if (sd.length) {
    e.serviceDataMap = Object.fromEntries(sd.map(([uuid, dv]) => [uuid, bytesToHex(dv)]));
    const [uuid, hex] = Object.entries(e.serviceDataMap)[0];
    e.servicedata = hex;
    e.servicedatauuid = shortUuid(uuid);
  }
  return e;
}
