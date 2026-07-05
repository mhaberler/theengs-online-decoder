'use strict';

import * as conn from './serial-conn.js';

const MAX_ROWS = 2000;

const ADV_ABBR = {
  ADV_IND: 'IND', ADV_NONCONN_IND: 'NCONN', SCAN_RSP: 'SCAN_RSP',
  ADV_SCAN_IND: 'SCAN_IND', ADV_DIRECT_IND: 'DIRECT', ADV_EXT_IND: 'EXT',
};
const LAST_SEEN_TTL_MS = 60_000;

// Per-tab serial view over the shared connection (serial-conn.js): renders the
// advert stream into this tab's log with the tab's `decode(advJson)` strategy
// (sync or async, returning a decoded object or null; a throw renders an error
// row and scanning continues). Connection and scan state are shared — buttons
// in any tab drive the same dongle, and all tabs mirror its state.
export function initSerialCore(root, { prefix, decode }) {
  const q = (id) => root.querySelector(`#${prefix}-${id}`);
  const els = {
    connect:    q('connect'),
    disconnect: q('disconnect'),
    scan:       q('scan'),
    clear:      q('clear'),
    showAll:    q('showall'),
    onlyDecoded: q('onlydecoded'),
    profile:    q('profile'),
    status:     q('status'),
    indicator:  q('indicator'),
    log:        q('log'),
    portInfo:   q('portinfo'),
    kind:       q('kind'),
    controls:   q('driver-controls'),
    counters:   q('counters'),
  };

  let seen = 0;
  let decoded = 0;
  let autoScroll = true;
  let controlsRendered = false;
  let decodeChain = Promise.resolve();
  const lastSeen = new Map();

  if (els.profile && !els.profile.dataset.populated) {
    for (const p of conn.PROFILES) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      els.profile.appendChild(opt);
    }
    els.profile.value = 'auto';
    els.profile.dataset.populated = '1';
  }

  if (!('serial' in navigator)) {
    setStatus('WebSerial unavailable in this browser. Use Chrome/Edge on https or localhost.');
    els.connect.disabled = true;
    if (els.profile) els.profile.disabled = true;
    return { setStatus, available: false };
  }

  els.log.addEventListener('scroll', () => {
    const nearBottom = els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 40;
    autoScroll = nearBottom;
  });

  els.connect.addEventListener('click', () => conn.connect(els.profile?.value ?? 'auto'));
  els.disconnect.addEventListener('click', () => conn.disconnect());
  els.scan.addEventListener('click', () => conn.toggleScan());
  els.clear.addEventListener('click', () => {
    els.log.replaceChildren();
    seen = 0; decoded = 0; lastSeen.clear(); updateCounters();
  });
  els.onlyDecoded?.addEventListener('change', () => {
    els.log.classList.toggle('only-decoded', els.onlyDecoded.checked);
  });

  function applyState(st) {
    els.connect.disabled = st.connected || st.connecting;
    els.disconnect.disabled = !st.connected;
    els.scan.disabled = !st.connected;
    if (els.profile) els.profile.disabled = st.connected || st.connecting;
    if (els.kind) els.kind.textContent = st.driverLabel;
    els.portInfo.textContent = st.portInfo;
    const label = els.scan.querySelector('span:last-child');
    if (label) label.textContent = st.scanning ? 'Stop scan' : 'Start scan';
    setIndicator(st.scanning ? 'scanning' : st.connected ? 'connected' : 'idle');
    if (els.controls) {
      if (st.connected && !controlsRendered) {
        conn.renderDriverControls(els.controls);
        controlsRendered = true;
      } else if (!st.connected) {
        els.controls.replaceChildren();
        controlsRendered = false;
      }
    }
  }

  conn.subscribe({
    onChange: applyState,
    onStatus: setStatus,
    onAdvert: (advJson) => {
      seen++;
      // Serialize possibly-async decodes so rows keep arrival order.
      decodeChain = decodeChain.then(async () => {
        let dec = null;
        let err = null;
        try {
          dec = await decode(advJson);
        } catch (e) {
          err = e;
        }
        if (dec) decoded++;
        appendBtRow(advJson, dec, err);
        updateCounters();
      });
    },
    onLine: (line) => {
      if (els.showAll?.checked) appendRawRow(line, 'omg');
    },
  });
  applyState(conn.getState());

  function appendBtRow(raw, dec, err) {
    const row = document.createElement('div');
    row.className = 'log-row ' + (err ? 'log-error' : dec ? 'log-decoded' : 'log-undecoded');
    const nowMs = Date.now();
    const t = new Date(nowMs).toISOString().slice(11, 23);
    const id = raw.id || '?';
    const rssi = raw.rssi !== undefined ? `${raw.rssi}dBm` : '';
    const ch = raw.channel !== undefined ? ` ch${raw.channel}` : '';
    const advAbbr = ADV_ABBR[raw.advType] ? ` ${ADV_ABBR[raw.advType]}` : '';
    const randomMark = raw.addrType === 'random' ? '(R)' : '';
    let dt = '';
    if (raw.mac) {
      const prev = lastSeen.get(raw.mac);
      if (prev !== undefined) dt = ` Δ${nowMs - prev}ms`;
      lastSeen.set(raw.mac, nowMs);
      if (lastSeen.size > 1024) {
        const cutoff = nowMs - LAST_SEEN_TTL_MS;
        for (const [k, v] of lastSeen) if (v < cutoff) lastSeen.delete(k);
      }
    }
    const model = dec?.model_id || dec?.model || '';
    const tail = err ? '⚠ ' + err.message : model ? '→ ' + model : '(undecoded)';
    const header = document.createElement('div');
    header.className = 'log-head';
    header.textContent = `[${t}] ${id}${randomMark} ${rssi}${ch}${advAbbr}${dt} ${tail}`;
    row.appendChild(header);

    if (dec) {
      const decPre = document.createElement('pre');
      decPre.className = 'log-decoded-json';
      decPre.textContent = JSON.stringify(dec, null, 2);
      row.appendChild(decPre);
    }

    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = 'raw';
    det.appendChild(sum);
    const rawPre = document.createElement('pre');
    rawPre.className = 'log-raw-json';
    rawPre.textContent = JSON.stringify(raw, null, 2);
    det.appendChild(rawPre);
    row.appendChild(det);

    pushRow(row);
  }

  function appendRawRow(line, cls) {
    const row = document.createElement('div');
    row.className = 'log-row log-' + cls;
    row.textContent = line;
    pushRow(row);
  }

  function pushRow(row) {
    els.log.appendChild(row);
    while (els.log.childElementCount > MAX_ROWS) els.log.firstElementChild.remove();
    if (autoScroll) els.log.scrollTop = els.log.scrollHeight;
  }

  function setStatus(msg) { els.status.textContent = msg; }
  function setIndicator(state) { els.indicator.dataset.state = state; }
  function updateCounters() {
    if (els.counters) els.counters.textContent = `decoded: ${decoded} / seen: ${seen}`;
  }

  return { setStatus, available: true };
}
