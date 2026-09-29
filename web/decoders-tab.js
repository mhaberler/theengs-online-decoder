'use strict';

// The Decoders tab (web app and Sensor-BLE app): installed decoders and the
// built-in toggles, Browse (decoders from learned catalogs, suggested ones
// first), the catalog list, and install-from-URL. The sensor-ble tab itself
// only scans and logs.

import { builtinDecoders, isBuiltinName, isBuiltinEnabled, seenSignals } from './sensorble-decode.js';
import * as custom from './sensorble-custom.js';
import * as catalogs from './decoder-catalog.js';
import { compareVersions, matchesSeen } from './catalog-util.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const button = (label, onClick) => {
  const b = el('button', '', label);
  b.addEventListener('click', onClick);
  return b;
};

const matcherText = (m = {}) =>
  Object.entries(m).map(([k, v]) => `${k}: ${v}`).join(', ') || 'matchAll';

export function initDecodersTab(root) {
  const q = (id) => root.querySelector(`#dec-${id}`);
  const els = {
    installed: q('installed'),
    builtins: q('builtins'),
    browse: q('browse'),
    search: q('search'),
    refresh: q('refresh'),
    catalogs: q('catalogs'),
    catalogUrl: q('catalog-url'),
    catalogAdd: q('catalog-add'),
    catalogError: q('catalog-error'),
    url: q('custom-url'),
    install: q('custom-install'),
    error: q('custom-error'),
    status: q('status'),
  };
  let searchTerm = '';
  let lastSuggestKey = '';

  const setStatus = (msg) => { if (els.status) els.status.textContent = msg; };

  function installedFor(entry) {
    return custom.list().find((r) => r.decoderName === entry.decoderName && !r.error);
  }

  // --- Installed + built-ins -------------------------------------------------

  function renderBuiltins() {
    els.builtins.replaceChildren();
    for (const d of builtinDecoders) {
      const label = el('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = isBuiltinEnabled(d.decoderName);
      box.addEventListener('change', () => custom.setBuiltinEnabled(d.decoderName, box.checked));
      label.append(box, ' ' + d.decoderName);
      els.builtins.appendChild(label);
    }
  }

  function renderInstalled() {
    const entries = custom.list();
    const byName = new Map(catalogs.allEntries().map((e) => [e.decoderName + '\u0000' + e.catalogUrl, e]));
    els.installed.replaceChildren();
    if (!entries.length) {
      els.installed.appendChild(el('div', 'decoder-empty', 'No custom decoders installed.'));
      return;
    }
    for (const r of entries) {
      const row = el('div', 'decoder-row' + (r.error ? ' decoder-broken' : ''));
      const head = el('div', 'decoder-name', r.decoderName || '(failed to load)');
      if (r.version) head.appendChild(el('span', 'decoder-ver', ' v' + r.version));
      if (!r.error && isBuiltinName(r.decoderName)) head.appendChild(el('span', 'decoder-badge', 'overrides built-in'));
      const latest = r.catalogUrl && byName.get(r.decoderName + '\u0000' + r.catalogUrl);
      const update = latest && compareVersions(latest.version, r.version) > 0 ? latest : null;
      if (update) head.appendChild(el('span', 'decoder-badge decoder-update', `update: v${update.version}`));
      row.appendChild(head);

      const link = el('a', 'decoder-url', r.url);
      link.href = r.url; link.target = '_blank'; link.rel = 'noopener';
      row.appendChild(link);
      if (r.catalogUrl) row.appendChild(el('div', 'decoder-meta', 'from catalog ' + r.catalogUrl));
      if (r.error) row.appendChild(el('div', 'decoder-error', r.error));

      const actions = el('div', 'decoder-actions');
      if (update) actions.appendChild(button('Update', () => installEntry(update)));
      // Reload re-fetches the same URL; catalog installs are re-verified
      // against the sha256 they were installed with.
      actions.appendChild(button('Reload', () => runInstall(r.url, r.catalogUrl ? r : null)));
      actions.appendChild(button('Remove', () => { custom.remove(r.url); renderAll(); }));
      row.appendChild(actions);
      els.installed.appendChild(row);
    }
  }

  // --- Browse ----------------------------------------------------------------

  function renderBrowse() {
    const seen = seenSignals();
    const entries = catalogs.allEntries().filter((e) => {
      if (!searchTerm) return true;
      return [e.title, e.decoderName, e.description, ...(e.tags ?? [])]
        .join(' ').toLowerCase().includes(searchTerm);
    });
    const suggested = new Set(entries.filter((e) => matchesSeen(e.matchers, seen)));
    entries.sort((a, b) => (suggested.has(b) - suggested.has(a)) || a.title.localeCompare(b.title));
    lastSuggestKey = [...suggested].map((e) => e.decoderName).join(',');

    els.browse.replaceChildren();
    if (!entries.length) {
      els.browse.appendChild(el('div', 'decoder-empty',
        catalogs.catalogList().length ? (searchTerm ? 'No decoders match.' : 'No decoders loaded — press Refresh.') : 'No catalogs — add one below.'));
      return;
    }
    for (const e of entries) {
      const row = el('div', 'decoder-row catalog-entry');
      const head = el('div', 'decoder-name', e.title || e.decoderName);
      head.appendChild(el('span', 'decoder-ver', ' v' + e.version));
      if (suggested.has(e)) head.appendChild(el('span', 'decoder-badge decoder-suggested', 'matches a device seen'));
      row.appendChild(head);
      if (e.description) row.appendChild(el('div', 'decoder-desc', e.description));
      row.appendChild(el('div', 'decoder-meta',
        `${e.decoderName} · ${matcherText(e.matchers)}${e.license ? ' · ' + e.license : ''} · ${e.catalogTitle}`));

      const actions = el('div', 'decoder-actions');
      const have = installedFor(e);
      if (!have) actions.appendChild(button('Install', () => installEntry(e)));
      else if (compareVersions(e.version, have.version) > 0) actions.appendChild(button(`Update to v${e.version}`, () => installEntry(e)));
      else actions.appendChild(el('span', 'decoder-meta', `installed${have.version ? ' v' + have.version : ''}`));
      row.appendChild(actions);
      els.browse.appendChild(row);
    }
  }

  // --- Catalogs --------------------------------------------------------------

  function renderCatalogs() {
    els.catalogs.replaceChildren();
    const list = catalogs.catalogList();
    if (!list.length) {
      els.catalogs.appendChild(el('div', 'decoder-empty', 'No catalogs.'));
      return;
    }
    for (const c of list) {
      const row = el('div', 'decoder-row' + (c.error ? ' decoder-broken' : ''));
      const head = el('div', 'decoder-name', c.title || c.url);
      if (c.url === catalogs.PRESET_CATALOG) head.appendChild(el('span', 'decoder-badge', 'preset'));
      row.appendChild(head);
      const link = el('a', 'decoder-url', c.url);
      link.href = c.url; link.target = '_blank'; link.rel = 'noopener';
      row.appendChild(link);
      row.appendChild(el('div', 'decoder-meta',
        `${(c.entries ?? []).length} decoder(s)${c.fetchedAt ? ' · fetched ' + c.fetchedAt.slice(0, 16).replace('T', ' ') : ''}`));
      if (c.error) row.appendChild(el('div', 'decoder-error', c.error));
      const actions = el('div', 'decoder-actions');
      actions.appendChild(button('Remove', () => { catalogs.removeCatalog(c.url); renderAll(); }));
      row.appendChild(actions);
      els.catalogs.appendChild(row);
    }
  }

  function renderAll() {
    renderBuiltins();
    renderInstalled();
    renderBrowse();
    renderCatalogs();
  }

  // --- Actions ---------------------------------------------------------------

  async function runInstall(url, from) {
    els.error.textContent = '';
    try {
      const rec = await custom.install(url, from ? { catalogUrl: from.catalogUrl, version: from.version, sha256: from.sha256 } : null);
      setStatus(`Installed decoder "${rec.decoderName}"${rec.version ? ' v' + rec.version : ''}.`);
      return rec;
    } catch (e) {
      els.error.textContent = e.message;
      setStatus(`Install failed: ${e.message}`);
      return null;
    } finally {
      renderAll();
    }
  }

  const installEntry = (entry) => runInstall(entry.url, entry);

  async function addCatalog(url) {
    els.catalogError.textContent = '';
    els.catalogAdd.disabled = true;
    try {
      const c = await catalogs.addCatalog(url);
      els.catalogUrl.value = '';
      setStatus(`Added catalog "${c.title}" (${c.entries.length} decoders).`);
      return c;
    } catch (e) {
      els.catalogError.textContent = e.message;
      return null;
    } finally {
      els.catalogAdd.disabled = false;
      renderAll();
    }
  }

  async function refresh() {
    els.refresh.disabled = true;
    setStatus('Refreshing catalogs…');
    await catalogs.refreshCatalogs();
    const errors = catalogs.catalogList().filter((c) => c.error).length;
    setStatus(errors ? `Refreshed; ${errors} catalog(s) failed.` : 'Catalogs refreshed.');
    els.refresh.disabled = false;
    renderAll();
  }

  els.install.addEventListener('click', async () => {
    if (await runInstall(els.url.value, null)) els.url.value = '';
  });
  els.url.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') els.install.click(); });
  els.catalogAdd.addEventListener('click', () => addCatalog(els.catalogUrl.value));
  els.catalogUrl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') els.catalogAdd.click(); });
  els.refresh.addEventListener('click', refresh);
  els.search.addEventListener('input', () => {
    searchTerm = els.search.value.trim().toLowerCase();
    renderBrowse();
  });

  // Suggestions follow the scan: re-rank Browse when the set of matching
  // decoders changes, but only while the tab is visible.
  setInterval(() => {
    if (!root.offsetParent) return;
    const seen = seenSignals();
    const key = catalogs.allEntries().filter((e) => matchesSeen(e.matchers, seen)).map((e) => e.decoderName).join(',');
    if (key !== lastSuggestKey) renderBrowse();
  }, 3000);

  // Restore installed decoders and toggles (no network), then catalogs; fetch
  // catalogs that have never been fetched (e.g. the preset on first run).
  const ready = Promise.all([custom.restore(), catalogs.restoreCatalogs()])
    .catch(() => {})
    .then(() => {
      renderAll();
      if (catalogs.catalogList().some((c) => !c.fetchedAt)) return refresh();
    });

  return { addCatalog: async (url) => { await ready; return addCatalog(url); }, render: renderAll };
}
