'use strict';

// Browser-side sensor-ble decoding: the counterpart of decoder.js (TheengsDecoder)
// for the Serial/sensor-ble tab, which uses the advertising-based decoders.
// Streaming decoders (hrs, cps, cscs, rscs, muse_v3, witmotion, and custom
// ones with start + notify) need a GATT connection: the Capacitor app's
// Connected tab uses them via streamingCandidates()/streamingDecoders().
//
// The bundled decoders come from the `sensor-ble` dependency; custom decoders
// installed at runtime (sensorble-custom.js) are layered on top by decoderName.

import './buffer-shim.js'; // installs globalThis.Buffer — must precede the decoders
import { Buffer } from './buffer-shim.js';
import { decoders as allDecoders } from './sensor-ble/main.js';
import { normalizeUuid } from './catalog-util.js';

const isAdvertising = (d) => typeof d.advertisementDecode === 'function';
const isStreaming = (d) => typeof d.start === 'function' && Array.isArray(d.notify);

// A decoder is advertisement-based iff it can decode without connecting.
export const builtinDecoders = allDecoders.filter(isAdvertising);
export const builtinStreamingDecoders = allDecoders.filter(isStreaming);

const customDecoders = new Map(); // decoderName -> decoder
const disabledBuiltins = new Set(); // built-in decoderNames switched off in the UI

export function setDisabledBuiltins(names) {
  disabledBuiltins.clear();
  for (const n of names) disabledBuiltins.add(n);
}

export function isBuiltinEnabled(name) {
  return !disabledBuiltins.has(name);
}

export function setCustomDecoders(list) {
  customDecoders.clear();
  for (const d of list) customDecoders.set(d.decoderName, d);
}

// Custom decoders override built-ins of the same decoderName (the rule the
// Sensor Logger app uses), so they are matched first. `matchAll` decoders
// (catch-alls like the theengs wrapper) go last, as a fallback. Disabled
// built-ins are skipped; the toggles never affect custom decoders.
export function activeDecoders() {
  const custom = [...customDecoders.values()].filter(isAdvertising);
  const shadowed = new Set(customDecoders.keys());
  const builtins = builtinDecoders.filter((d) => !shadowed.has(d.decoderName) && !disabledBuiltins.has(d.decoderName));
  const all = custom.concat(builtins);
  return all.filter((d) => !d.matchAll).concat(all.filter((d) => d.matchAll));
}

// Streaming decoders for connected sensors: custom first (overriding
// built-ins by decoderName), disabled built-ins skipped.
export function streamingDecoders() {
  const custom = [...customDecoders.values()].filter(isStreaming);
  const shadowed = new Set(customDecoders.keys());
  return custom.concat(builtinStreamingDecoders.filter((d) => !shadowed.has(d.decoderName) && !disabledBuiltins.has(d.decoderName)));
}

// Streaming decoders whose matchers fit an advertisement entry — the devices
// the Connected tab offers to connect to.
export function streamingCandidates(entry) {
  const adv = readEntry(entry);
  return streamingDecoders().filter((d) => isDecoderValid(d, adv));
}

export function isBuiltinName(name) {
  return allDecoders.some((d) => d.decoderName === name);
}

// Advertisement entries arrive in the OMG shape produced by web/drivers/ad.js:
// hex strings, manufacturerdata including the 2-byte company ID. File-tab-style
// camelCase spellings are accepted too, as decoder.js's buildDecoderInput does.
// An entry may instead carry every service-data element as `serviceDataMap`
// ({ uuid: hex }) — the phone BLE scan in the Capacitor app reports them all,
// plus the advertised service-UUID list as `serviceUuids` (how heart-rate
// straps and other connectable sensors announce themselves).
// UUIDs are normalized with catalog-util's normalizeUuid: Bluetooth Base UUIDs
// shorten to 4 hex digits, other 128-bit UUIDs stay whole.
function readEntry(entry) {
  const md = entry.manufacturerData ?? entry.manufacturerdata ?? '';
  const serviceDataMap = {};
  if (entry.serviceDataMap) {
    for (const [u, hex] of Object.entries(entry.serviceDataMap)) {
      const uuid = normalizeUuid(u);
      if (uuid && hex) serviceDataMap[uuid] = Buffer.from(hex, 'hex');
    }
  } else {
    let sd = entry.serviceData ?? entry.servicedata ?? '';
    const colon = sd.indexOf(':');
    if (colon >= 0) sd = sd.slice(colon + 1);
    const uuid = normalizeUuid(entry.serviceDataUuid ?? entry.servicedatauuid);
    if (sd && uuid) serviceDataMap[uuid] = Buffer.from(sd, 'hex');
  }
  const advertised = (entry.serviceUuids ?? []).map(normalizeUuid).filter(Boolean);
  return {
    manufacturerData: md ? Buffer.from(md, 'hex') : undefined,
    serviceDataMap,
    serviceUuids: [...new Set([...advertised, ...Object.keys(serviceDataMap)])],
    localName: entry.name ?? entry.localName ?? '',
  };
}

// Port of isDecoderValid() from sensor-ble/harness/main.js — same priority
// (name, then manufacturer, then serviceUUID) and same early-return semantics,
// so a decoder matches here exactly as it does under the Node harness.
// Extension: `matchAll: true` matches every advertisement.
export function isDecoderValid(decoder, adv) {
  if (decoder.matchAll) return true;
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

// What recent adverts looked like, for suggesting catalog decoders that would
// match them (decoders-tab.js). Bounded: cleared when it grows too large.
const seen = { manufacturers: new Set(), serviceUUIDs: new Set(), names: new Set() };
const SEEN_MAX = 500;

function remember(set, value) {
  if (!value) return;
  if (set.size >= SEEN_MAX) set.clear();
  set.add(value);
}

export function seenSignals() {
  return seen;
}

// Which decoder produced a decodeEntry() result — kept beside the result, not
// in it, so the decoded JSON stays exactly what the decoder returned.
const producedBy = new WeakMap();

export function decoderOf(result) {
  return producedBy.get(result) ?? '';
}

// Returns a decoded object for serial-core (model_id drives the row header), or
// null when nothing matches or the matching decoder rejects the payload.
export function decodeEntry(entry) {
  const adv = readEntry(entry);
  if (adv.manufacturerData?.length >= 2) remember(seen.manufacturers, adv.manufacturerData.subarray(0, 2).toString('hex'));
  for (const u of adv.serviceUuids) remember(seen.serviceUUIDs, u);
  remember(seen.names, adv.localName);
  if (!adv.manufacturerData && !Object.keys(adv.serviceDataMap).length) return null;

  const meta = { name: adv.localName, id: entry.id };
  for (const decoder of activeDecoders()) {
    if (!isDecoderValid(decoder, adv)) continue;
    const values = decoder.advertisementDecode(adv.manufacturerData, adv.serviceDataMap, meta);
    // Decoders re-validate their own payloads and return null on a mismatch;
    // keep trying so one company ID shared by several devices still resolves.
    if (!values || !Object.keys(values).length) continue;
    const result = {
      model_id: decoder.decoderName,
      ...(entry.id ? { id: entry.id } : {}),
      ...(entry.rssi !== undefined ? { rssi: entry.rssi } : {}),
      ...values,
    };
    producedBy.set(result, decoder.decoderName);
    return result;
  }
  return null;
}
