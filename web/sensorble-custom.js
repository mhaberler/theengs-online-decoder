'use strict';

// Runtime-installable sensor-ble decoders, following the same contract as
// Sensor Logger's "Custom Decoders" (see the sensor-ble README): a URL serving
// a self-contained ES module that exports a `decoder` object. The source is
// cached in localStorage and re-registered on every load, so installed decoders
// keep working offline; Reload re-fetches from the original URL.
//
// The fetched source is imported as a module (via a blob URL) rather than
// eval'd. Gist raw URLs serve text/plain, which import() would reject on MIME
// grounds, so the source is fetched first and re-wrapped locally.

import { setCustomDecoders, setDisabledBuiltins } from './sensorble-decode.js';

const KEY = 'sensorble-custom-decoders';
const KEY_DISABLED = 'sensorble-disabled-builtins';

let installed = []; // [{ url, source, decoderName, installedAt, decoder, error }]
let disabled = new Set(); // built-in decoderNames switched off

// Async key/value store for the cache. localStorage by default; the Capacitor
// app swaps in @capacitor/preferences, since iOS may evict WebView storage.
let storage = {
  get: async (key) => localStorage.getItem(key),
  set: async (key, value) => localStorage.setItem(key, value),
};

export function setStorage(s) {
  storage = s;
}

async function load() {
  try {
    const raw = await storage.get(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persist() {
  const plain = installed.map(({ url, source, decoderName, installedAt }) => ({
    url, source, decoderName, installedAt,
  }));
  storage.set(KEY, JSON.stringify(plain))
    .catch((e) => console.error('sensorble-custom: persist failed', e));
}

function republish() {
  setCustomDecoders(installed.filter((e) => e.decoder).map((e) => e.decoder));
}

// Evaluate module source and pull out the decoder it exports.
async function importDecoder(source) {
  const blob = new Blob([source], { type: 'text/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const mod = await import(/* @vite-ignore */ blobUrl);
    const decoder = mod.decoder ?? mod.default;
    if (!decoder || typeof decoder !== 'object') {
      throw new Error('module does not export a `decoder` object');
    }
    if (!decoder.decoderName || typeof decoder.decoderName !== 'string') {
      throw new Error('decoder.decoderName missing or not a string');
    }
    if (typeof decoder.advertisementDecode !== 'function') {
      throw new Error(
        `decoder "${decoder.decoderName}" has no advertisementDecode() — ` +
        'streaming (GATT) decoders are not supported in this tab',
      );
    }
    return decoder;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function fetchSource(url) {
  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (e) {
    throw new Error(`fetch failed (${e.message}) — check the URL and CORS`);
  }
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error('URL returned HTML, not JavaScript — use the raw file URL');
  }
  return text;
}

// Built-in decoders switched off in the UI, persisted with the same storage.
async function loadDisabled() {
  try {
    const raw = await storage.get(KEY_DISABLED);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function setBuiltinEnabled(name, on) {
  if (on) disabled.delete(name); else disabled.add(name);
  setDisabledBuiltins(disabled);
  storage.set(KEY_DISABLED, JSON.stringify([...disabled]))
    .catch((e) => console.error('sensorble-custom: persist failed', e));
}

// Restore cached decoders (and the built-in toggles) without touching the network.
export async function restore() {
  disabled = await loadDisabled();
  setDisabledBuiltins(disabled);
  installed = [];
  for (const entry of await load()) {
    const rec = { ...entry, decoder: null, error: null };
    try {
      rec.decoder = await importDecoder(entry.source);
      rec.decoderName = rec.decoder.decoderName;
    } catch (e) {
      rec.error = e.message;
    }
    installed.push(rec);
  }
  republish();
  return installed;
}

export async function install(url) {
  const trimmed = url.trim();
  if (!trimmed) throw new Error('Enter a decoder URL');
  const source = await fetchSource(trimmed);
  const decoder = await importDecoder(source);
  const rec = {
    url: trimmed,
    source,
    decoderName: decoder.decoderName,
    installedAt: new Date().toISOString(),
    decoder,
    error: null,
  };
  // Re-installing the same URL, or a decoder of the same name, replaces it
  // rather than stacking duplicates.
  const at = installed.findIndex((e) => e.url === trimmed || e.decoderName === decoder.decoderName);
  if (at >= 0) installed[at] = rec;
  else installed.push(rec);
  persist();
  republish();
  return rec;
}

export function remove(url) {
  installed = installed.filter((e) => e.url !== url);
  persist();
  republish();
}

export function list() {
  return installed;
}
