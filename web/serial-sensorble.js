'use strict';

import { initSerialCore } from './serial-core.js';
import { decodeEntry, decoderOf, builtinDecoders, isBuiltinName, isBuiltinEnabled } from './sensorble-decode.js';
import * as custom from './sensorble-custom.js';

// `conn` and `readyMessage` let the Capacitor app reuse this tab over the
// phone's BLE radio; the web app passes neither and gets the dongle.
export function initSerialSensorble(root, { conn, readyMessage } = {}) {
  const core = initSerialCore(root, { prefix: 'sbl', decode: decodeEntry, decoderName: decoderOf, conn });

  const urlEl = root.querySelector('#sbl-custom-url');
  const installEl = root.querySelector('#sbl-custom-install');
  const listEl = root.querySelector('#sbl-custom-list');
  const errEl = root.querySelector('#sbl-custom-error');
  const builtinEl = root.querySelector('#sbl-builtins');

  // One checkbox per built-in decoder; unchecking skips it from the next
  // advert on (persisted by sensorble-custom).
  function renderBuiltins() {
    if (!builtinEl) return;
    builtinEl.replaceChildren();
    for (const d of builtinDecoders) {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = isBuiltinEnabled(d.decoderName);
      box.addEventListener('change', () => custom.setBuiltinEnabled(d.decoderName, box.checked));
      label.append(box, ' ' + d.decoderName);
      builtinEl.appendChild(label);
    }
  }

  function renderList() {
    const entries = custom.list();
    listEl.replaceChildren();
    if (!entries.length) {
      const p = document.createElement('div');
      p.className = 'decoder-empty';
      p.textContent = 'No custom decoders installed.';
      listEl.appendChild(p);
      return;
    }
    for (const e of entries) {
      const row = document.createElement('div');
      row.className = 'decoder-row' + (e.error ? ' decoder-broken' : '');

      const head = document.createElement('div');
      head.className = 'decoder-name';
      head.textContent = e.decoderName || '(failed to load)';
      if (!e.error && isBuiltinName(e.decoderName)) {
        const badge = document.createElement('span');
        badge.className = 'decoder-badge';
        badge.textContent = 'overrides built-in';
        head.appendChild(badge);
      }
      row.appendChild(head);

      const link = document.createElement('a');
      link.className = 'decoder-url';
      link.href = e.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = e.url;
      row.appendChild(link);

      if (e.error) {
        const err = document.createElement('div');
        err.className = 'decoder-error';
        err.textContent = e.error;
        row.appendChild(err);
      }

      const actions = document.createElement('div');
      actions.className = 'decoder-actions';
      const reload = document.createElement('button');
      reload.textContent = 'Reload';
      reload.addEventListener('click', () => runInstall(e.url));
      const del = document.createElement('button');
      del.textContent = 'Remove';
      del.addEventListener('click', () => {
        custom.remove(e.url);
        renderList();
      });
      actions.append(reload, del);
      row.appendChild(actions);

      listEl.appendChild(row);
    }
  }

  async function runInstall(url) {
    errEl.textContent = '';
    installEl.disabled = true;
    try {
      const rec = await custom.install(url);
      urlEl.value = '';
      errEl.textContent = '';
      core.setStatus(`Installed decoder "${rec.decoderName}".`);
    } catch (e) {
      errEl.textContent = e.message;
    } finally {
      installEl.disabled = false;
      renderList();
    }
  }

  installEl.addEventListener('click', () => runInstall(urlEl.value));
  urlEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') runInstall(urlEl.value);
  });

  // Re-register cached decoders and built-in toggles (no network), then show them.
  const show = () => { renderBuiltins(); renderList(); };
  renderBuiltins();
  custom.restore().then(show).catch(show);

  if (!core.available) return;
  core.setStatus(`sensor-ble ready (${builtinDecoders.length} built-in decoders). ${readyMessage ?? 'Connect a port.'}`);
}
