'use strict';

// Learned decoder catalogs: websites (built from the sensor-ble-decoder-catalog
// template) that list decoders in a decoders.json. The user adds a catalog by
// its page or JSON URL; the list and each catalog's last fetched index are
// kept in the same store as installed decoders, so Browse works offline.

import { kvGet, kvSet } from './sensorble-custom.js';
import { resolveCatalog, normalizeIndex } from './catalog-util.js';

const KEY = 'sensorble-catalogs';

// Shipped preset (first run only), removable.
export const PRESET_CATALOG = 'https://mhaberler.github.io/sensor-ble-decoders-custom/';

// [{ url, jsonUrl, title, description, homepage, entries, fetchedAt, error }]
let catalogs = [];

function persist() {
  kvSet(KEY, JSON.stringify(catalogs))
    .catch((e) => console.error('decoder-catalog: persist failed', e));
}

export async function restoreCatalogs() {
  let raw = null;
  try { raw = await kvGet(KEY); } catch {}
  if (raw == null) {
    // First run: start with the preset (fetched on first refresh).
    catalogs = [{ url: PRESET_CATALOG, entries: [] }];
    persist();
  } else {
    try { catalogs = JSON.parse(raw); } catch { catalogs = []; }
  }
  return catalogs;
}

export function catalogList() {
  return catalogs;
}

async function fetchText(url) {
  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (e) {
    throw new Error(`fetch failed (${e.message}) — check the URL, and that the site allows CORS`);
  }
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status} ${res.statusText}`);
  return { text: await res.text(), url: res.url || url };
}

const parseHtml = (text) => new DOMParser().parseFromString(text, 'text/html');

// Fetch a catalog by page or JSON URL (page → <link rel="alternate"> → JSON).
async function fetchCatalog(url) {
  let { text, url: finalUrl } = await fetchText(url);
  let step = resolveCatalog(text, finalUrl, parseHtml);
  if (step.next) {
    ({ text, url: finalUrl } = await fetchText(step.next));
    step = resolveCatalog(text, finalUrl, parseHtml);
    if (!step.index) throw new Error('no decoders.json found for this page');
  }
  return { jsonUrl: finalUrl, ...normalizeIndex(step.index, finalUrl) };
}

function normalizeUrl(url) {
  const u = new URL(url.trim()); // throws on garbage
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    throw new Error('catalogs must be served over https');
  }
  return u.href;
}

export async function addCatalog(url) {
  const href = normalizeUrl(url);
  const fetched = await fetchCatalog(href);
  const rec = { url: href, ...fetched, fetchedAt: new Date().toISOString(), error: null };
  const at = catalogs.findIndex((c) => c.url === href || c.jsonUrl === fetched.jsonUrl);
  if (at >= 0) catalogs[at] = rec; else catalogs.push(rec);
  persist();
  return rec;
}

export function removeCatalog(url) {
  catalogs = catalogs.filter((c) => c.url !== url);
  persist();
}

// Re-fetch every catalog; a failure keeps the cached entries and records the error.
export async function refreshCatalogs() {
  await Promise.all(catalogs.map(async (c, i) => {
    try {
      catalogs[i] = { url: c.url, ...(await fetchCatalog(c.url)), fetchedAt: new Date().toISOString(), error: null };
    } catch (e) {
      catalogs[i] = { ...c, error: e.message };
    }
  }));
  persist();
  return catalogs;
}

// All entries across catalogs, each tagged with its catalog.
export function allEntries() {
  return catalogs.flatMap((c) => (c.entries ?? []).map((e) => ({
    ...e, catalogUrl: c.url, catalogTitle: c.title || c.url,
  })));
}
