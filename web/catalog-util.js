'use strict';

// Pure helpers for decoder catalogs (no DOM, no storage), shared by
// decoder-catalog.js and sensorble-decode.js and testable under Node.

// Normalize a service UUID to bare lowercase hex: dongles report '0xfe95' /
// 'fe95' / a full 128-bit UUID, sensor-ble decoders declare 'fcd2'.
export function normalizeUuid(u) {
  if (!u) return '';
  let s = String(u).toLowerCase();
  if (s.startsWith('0x')) s = s.slice(2);
  // 128-bit Bluetooth Base UUID: the 16-bit alias lives in chars 4..8.
  if (s.length === 36 && s.endsWith('-0000-1000-8000-00805f9b34fb')) s = s.slice(4, 8);
  return s;
}

// Numeric compare of dotted versions ('1.10.0' > '1.9.2'); missing parts are 0,
// non-numeric parts compare as 0. Returns -1, 0 or 1.
export function compareVersions(a, b) {
  const pa = String(a ?? '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b ?? '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Does a catalog entry's matchers fit anything seen in recent adverts?
// seen: { manufacturers: Set<'9904'>, serviceUUIDs: Set<'fcd2'>, names: Set<string> }
// matchAll decoders match everything, so they are never "suggested".
export function matchesSeen(matchers, seen) {
  if (!matchers || matchers.matchAll) return false;
  if (matchers.manufacturer && seen.manufacturers.has(String(matchers.manufacturer).toLowerCase())) return true;
  if (matchers.serviceUUID && seen.serviceUUIDs.has(normalizeUuid(matchers.serviceUUID))) return true;
  if (matchers.name) {
    for (const n of seen.names) if (n.includes(matchers.name)) return true;
  }
  return false;
}

export const CATALOG_TYPE = 'application/vnd.sensorble.catalog+json';

// Given a fetched document, return either the catalog index (JSON) or the URL
// of the index to fetch next (HTML page with <link rel="alternate">, else
// decoders.json next to the page). `parseHtml` returns a Document (DOMParser
// in browsers; injectable for tests).
export function resolveCatalog(text, baseUrl, parseHtml) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    const index = JSON.parse(trimmed);
    return { index };
  }
  const doc = parseHtml(text);
  const link = [...doc.querySelectorAll('link[rel~="alternate"]')]
    .find((l) => (l.getAttribute('type') || '').toLowerCase() === CATALOG_TYPE);
  const href = link ? link.getAttribute('href') : 'decoders.json';
  return { next: new URL(href, baseUrl).href };
}

// Validate an index and resolve its entry URLs against the index URL.
export function normalizeIndex(index, jsonUrl) {
  if (!index || typeof index !== 'object' || !Array.isArray(index.decoders)) {
    throw new Error('not a decoder catalog (no "decoders" list)');
  }
  if (index.schema !== 1) {
    throw new Error(`unsupported catalog schema ${index.schema} — update the app`);
  }
  return {
    title: index.title || new URL(jsonUrl).host,
    description: index.description || '',
    homepage: index.homepage || '',
    entries: index.decoders
      .filter((e) => e && e.decoderName && e.url && e.sha256)
      .map((e) => ({ ...e, url: new URL(e.url, jsonUrl).href })),
  };
}

// Lowercase hex sha256 of a string (UTF-8), via WebCrypto.
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
