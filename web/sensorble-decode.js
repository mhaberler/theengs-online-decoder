'use strict';

// Browser-side sensor-ble decoding: the counterpart of decoder.js (TheengsDecoder)
// for the Serial/sensor-ble tab. Only advertising-based decoders are used — the
// streaming ones (hrs, cps, cscs, rscs, muse_v3, witmotion) need a GATT
// connection, which a passive scanner dongle cannot provide.
//
// The bundled decoders come from the `sensor-ble` dependency; custom decoders
// installed at runtime (sensorble-custom.js) are layered on top by decoderName.

import './buffer-shim.js'; // installs globalThis.Buffer — must precede the decoders
import { Buffer } from './buffer-shim.js';
import { decoders as allDecoders } from './sensor-ble/main.js';

// A decoder is advertisement-based iff it can decode without connecting.
export const builtinDecoders = allDecoders.filter((d) => typeof d.advertisementDecode === 'function');

const customDecoders = new Map(); // decoderName -> decoder

export function setCustomDecoders(list) {
  customDecoders.clear();
  for (const d of list) customDecoders.set(d.decoderName, d);
}

// Custom decoders override built-ins of the same decoderName (the rule the
// Sensor Logger app uses), so they are matched first.
export function activeDecoders() {
  const custom = [...customDecoders.values()];
  const shadowed = new Set(customDecoders.keys());
  return custom.concat(builtinDecoders.filter((d) => !shadowed.has(d.decoderName)));
}

export function isBuiltinName(name) {
  return builtinDecoders.some((d) => d.decoderName === name);
}

// Normalize a 16-bit service UUID to bare lowercase hex: the dongles report
// '0xfe95' / 'fe95' / a full 128-bit UUID, sensor-ble decoders declare 'fcd2'.
function normalizeUuid(u) {
  if (!u) return '';
  let s = String(u).toLowerCase();
  if (s.startsWith('0x')) s = s.slice(2);
  // 128-bit Bluetooth Base UUID: the 16-bit alias lives in chars 4..8.
  if (s.length === 36) s = s.slice(4, 8);
  return s;
}

// Advertisement entries arrive in the OMG shape produced by web/drivers/ad.js:
// hex strings, manufacturerdata including the 2-byte company ID. File-tab-style
// camelCase spellings are accepted too, as decoder.js's buildDecoderInput does.
function readEntry(entry) {
  let sd = entry.serviceData ?? entry.servicedata ?? '';
  const colon = sd.indexOf(':');
  if (colon >= 0) sd = sd.slice(colon + 1);
  const md = entry.manufacturerData ?? entry.manufacturerdata ?? '';
  const uuid = normalizeUuid(entry.serviceDataUuid ?? entry.servicedatauuid);
  return {
    manufacturerData: md ? Buffer.from(md, 'hex') : undefined,
    serviceDataMap: sd && uuid ? { [uuid]: Buffer.from(sd, 'hex') } : {},
    serviceUuids: uuid ? [uuid] : [],
    localName: entry.name ?? entry.localName ?? '',
  };
}

// Port of isDecoderValid() from sensor-ble/harness/main.js — same priority
// (name, then manufacturer, then serviceUUID) and same early-return semantics,
// so a decoder matches here exactly as it does under the Node harness.
export function isDecoderValid(decoder, adv) {
  if (decoder.name && adv.localName) {
    return adv.localName.indexOf(decoder.name) !== -1;
  }
  if (decoder.manufacturer && adv.manufacturerData) {
    const manufacturerId = adv.manufacturerData.subarray(0, 2).toString('hex');
    return decoder.manufacturer.toLowerCase() === manufacturerId;
  }
  if (decoder.serviceUUID) {
    const want = normalizeUuid(decoder.serviceUUID);
    if (adv.serviceUuids.includes(want)) return true;
    if (Object.keys(adv.serviceDataMap).includes(want)) return true;
  }
  return false;
}

// Returns a decoded object for serial-core (model_id drives the row header), or
// null when nothing matches or the matching decoder rejects the payload.
export function decodeEntry(entry) {
  const adv = readEntry(entry);
  if (!adv.manufacturerData && !Object.keys(adv.serviceDataMap).length) return null;

  for (const decoder of activeDecoders()) {
    if (!isDecoderValid(decoder, adv)) continue;
    const values = decoder.advertisementDecode(adv.manufacturerData, adv.serviceDataMap);
    // Decoders re-validate their own payloads and return null on a mismatch;
    // keep trying so one company ID shared by several devices still resolves.
    if (!values || !Object.keys(values).length) continue;
    return {
      model_id: decoder.decoderName,
      ...(entry.id ? { id: entry.id } : {}),
      ...(entry.rssi !== undefined ? { rssi: entry.rssi } : {}),
      ...values,
    };
  }
  return null;
}
