'use strict';

// The Connected tab: devices from the running scan that match a streaming
// decoder (by serviceUUID / name / manufacturer), Connect, and a live card per
// connected device. Rendering is throttled; streams can be 100 Hz or more.

import { streamingCandidates } from '../web/sensorble-decode.js';
import * as gatt from './gatt.js';

const CANDIDATE_TTL_MS = 30_000;
const RENDER_MS = 250;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const fmt = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e4) / 1e4);
  if (v === null || v === undefined) return '—';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};

export function initConnectedTab(root, conn) {
  const q = (id) => root.querySelector(`#con-${id}`);
  const els = {
    scan: q('scan'),
    status: q('status'),
    candidates: q('candidates'),
    sessions: q('sessions'),
  };
  // deviceId -> { id, name, rssi, lastSeen, decoders: [decoder] }
  const candidates = new Map();
  let dirty = true;

  conn.subscribe({
    onAdvert: (entry) => {
      const decoders = streamingCandidates(entry);
      if (!decoders.length) return;
      const prev = candidates.get(entry.id);
      candidates.set(entry.id, {
        id: entry.id,
        name: entry.name || prev?.name || '',
        rssi: entry.rssi,
        lastSeen: Date.now(),
        decoders,
      });
      dirty = true;
    },
    onChange: (st) => {
      const label = els.scan.querySelector('span:last-child');
      if (label) label.textContent = st.scanning ? 'Stop scan' : 'Start scan';
      els.scan.querySelector('.scan-indicator').dataset.state = st.scanning ? 'scanning' : 'idle';
      els.status.textContent = st.scanning
        ? 'Scanning — connectable sensors appear below.'
        : 'Start a scan to find connectable sensors.';
    },
  });
  els.scan.addEventListener('click', () => conn.toggleScan());
  gatt.onSessionsChanged(() => { dirty = true; });

  function renderCandidates() {
    const now = Date.now();
    for (const [id, c] of candidates) if (now - c.lastSeen > CANDIDATE_TTL_MS) candidates.delete(id);
    els.candidates.replaceChildren();
    const list = [...candidates.values()].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
    if (!list.length) {
      els.candidates.appendChild(el('div', 'decoder-empty', 'No connectable sensors seen yet.'));
      return;
    }
    for (const c of list) {
      const row = el('div', 'decoder-row');
      row.appendChild(el('div', 'decoder-name', c.name || c.id));
      row.appendChild(el('div', 'decoder-meta',
        `${c.id} · ${c.rssi ?? '?'} dBm · ${Math.round((now - c.lastSeen) / 1000)} s ago`));
      const actions = el('div', 'decoder-actions');
      const busy = gatt.sessionList().some((s) => s.deviceId === c.id);
      // One Connect button per matching decoder (usually one).
      for (const d of c.decoders) {
        const b = el('button', '', c.decoders.length > 1 ? `Connect (${d.decoderName})` : `Connect · ${d.decoderName}`);
        b.disabled = busy;
        b.addEventListener('click', () => gatt.connect(c.id, c.name, d));
        actions.appendChild(b);
      }
      row.appendChild(actions);
      els.candidates.appendChild(row);
    }
  }

  function renderSessions() {
    els.sessions.replaceChildren();
    const list = gatt.sessionList();
    if (!list.length) {
      els.sessions.appendChild(el('div', 'decoder-empty', 'No sensors connected.'));
      return;
    }
    for (const s of list) {
      const card = el('div', 'decoder-row con-card' + (s.error ? ' decoder-broken' : ''));
      const head = el('div', 'decoder-name', s.name || s.deviceId);
      head.appendChild(el('span', 'decoder-badge', s.decoder.decoderName));
      head.appendChild(el('span', 'decoder-badge con-state con-' + s.state, s.state));
      card.appendChild(head);
      const age = s.updatedAt ? `${((Date.now() - s.updatedAt) / 1000).toFixed(1)} s ago` : 'no data yet';
      card.appendChild(el('div', 'decoder-meta', `${s.deviceId} · ${s.count} readings · last ${age}`));
      if (s.error) card.appendChild(el('div', 'decoder-error', s.error));
      const keys = Object.keys(s.values);
      if (keys.length) {
        const table = el('table', 'con-values');
        for (const k of keys) {
          const tr = el('tr');
          tr.append(el('th', '', k), el('td', '', fmt(s.values[k])));
          table.appendChild(tr);
        }
        card.appendChild(table);
      }
      const actions = el('div', 'decoder-actions');
      if (s.state === 'failed' || s.state === 'disconnected') {
        const b = el('button', '', 'Dismiss');
        b.addEventListener('click', () => gatt.dismiss(s.deviceId));
        actions.appendChild(b);
      } else {
        const b = el('button', '', 'Disconnect');
        b.disabled = s.state === 'disconnecting';
        b.addEventListener('click', () => gatt.disconnect(s.deviceId));
        actions.appendChild(b);
      }
      card.appendChild(actions);
      els.sessions.appendChild(card);
    }
  }

  // Throttled redraw; values and "s ago" labels change continuously, so
  // sessions redraw every tick while visible, candidates when changed.
  setInterval(() => {
    if (!root.offsetParent) return;
    if (dirty) { renderCandidates(); dirty = false; }
    if (gatt.sessionList().length) renderSessions();
  }, RENDER_MS);
  setInterval(() => { dirty = true; }, 2000); // refresh "s ago" / expiry
  renderCandidates();
  renderSessions();
  gatt.onSessionsChanged(() => renderSessions());
}
