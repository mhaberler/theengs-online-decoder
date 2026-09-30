'use strict';

// Connected-sensor sessions: runs a sensor-ble streaming decoder
// (start / notify / stop) against a device over @capacitor-community/bluetooth-le,
// the way sensor-ble's Node harness does with noble: subscribe to every notify
// characteristic first, then call start() (it may write commands and wait for
// replies on those characteristics), and stop() before disconnecting.

import { BleClient } from '@capacitor-community/bluetooth-le';
import { ensureInitialized } from './ble-conn.js';
import { uuid128 } from './scan-entry.js';


// DataView from the plugin -> the Buffer (shim) decoders expect. The shim's
// Buffer.from() copies via Uint8Array.from, which needs a typed array, not a
// bare ArrayBuffer.
const toBuffer = (dv) => Buffer.from(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

// The bleApi object sensor-ble decoders receive in onConnect()/start()/stop().
// Writes are counted on the session (diagnostics shown in the Connected tab).
function bleApiFor(deviceId, s) {
  return {
    write: async (id, service, characteristic, data) => {
      const bytes = Uint8Array.from(data);
      try {
        await BleClient.write(id ?? deviceId, uuid128(service), uuid128(characteristic), new DataView(bytes.buffer));
        if (s) { s.diag.writes++; s.diag.lastWrite = hex(bytes); }
      } catch (e) {
        if (s) s.diag.writeError = `${e?.message ?? e} (write ${hex(bytes)})`;
        throw e;
      }
    },
  };
}

// Reject if a decoder step doesn't finish (e.g. waits for a reply that never
// comes), so the session shows an error instead of "starting" forever.
function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what}: no reply from the device within ${ms / 1000} s`)), ms); }),
  ]);
}

const STEP_TIMEOUT_MS = 10_000;

// sessions: deviceId -> { deviceId, name, decoder, state, values, updatedAt, error, count }
const sessions = new Map();
const listeners = new Set();

export function onSessionsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  for (const fn of listeners) { try { fn(sessions); } catch {} }
}

export function sessionList() {
  return [...sessions.values()];
}

export async function connect(deviceId, name, decoder) {
  if (sessions.has(deviceId)) return sessions.get(deviceId);
  const s = {
    deviceId, name, decoder, state: 'connecting', values: {}, updatedAt: 0, error: null, count: 0,
    info: null,
    // Per notify characteristic: notifications seen, last size, and how many
    // decoded to nothing — tells which step stalls without a debugger.
    diag: { writes: 0, lastWrite: '', writeError: null, chars: decoder.notify.map((n) => ({ characteristic: n.characteristic, n: 0, bytes: 0, empty: 0, last: '' })) },
  };
  sessions.set(deviceId, s);
  changed();
  const api = bleApiFor(deviceId, s);
  try {
    await ensureInitialized();
    await BleClient.connect(deviceId, () => {
      // Dropped by the device or the OS.
      if (s.state !== 'disconnecting') {
        s.state = 'disconnected';
        s.error = 'connection lost';
        changed();
      }
    });
    for (const [i, n] of decoder.notify.entries()) {
      const d = s.diag.chars[i];
      await BleClient.startNotifications(deviceId, uuid128(n.service), uuid128(n.characteristic), (dv) => {
        d.n++;
        d.bytes = dv.byteLength;
        d.last = hex(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
        let out = null;
        try {
          out = n.onNotification(deviceId, toBuffer(dv));
        } catch (e) {
          s.error = `decoder error: ${e.message}`;
        }
        if (!out) d.empty++;
        if (out) {
          // Merge: devices may report different fields on different
          // characteristics (e.g. TESS pressure vs battery).
          Object.assign(s.values, out);
          s.updatedAt = Date.now();
          s.count++;
        }
      });
    }
    // Optional info exchange before start(), as sensor-ble's harness does
    // (Muse: firmware, battery, sensors).
    if (typeof decoder.onConnect === 'function') {
      s.state = 'identifying';
      changed();
      // Informational only: a failure is shown but doesn't stop streaming.
      try {
        s.info = await withTimeout(decoder.onConnect(deviceId, api), STEP_TIMEOUT_MS, 'onConnect()');
      } catch (e) {
        s.error = e?.message ?? String(e);
      }
    }
    s.state = 'starting';
    changed();
    // isPreview = false: full rate (e.g. Muse at 100 Hz); the UI throttles.
    await withTimeout(decoder.start(deviceId, false, api), STEP_TIMEOUT_MS, 'start()');
    s.state = 'streaming';
  } catch (e) {
    s.state = 'failed';
    s.error = e?.message ?? String(e);
    try { await BleClient.disconnect(deviceId); } catch {}
  }
  changed();
  return s;
}

export async function disconnect(deviceId) {
  const s = sessions.get(deviceId);
  if (!s) return;
  s.state = 'disconnecting';
  changed();
  try { await s.decoder.stop?.(deviceId, bleApiFor(deviceId)); } catch {}
  for (const n of s.decoder.notify) {
    try { await BleClient.stopNotifications(deviceId, uuid128(n.service), uuid128(n.characteristic)); } catch {}
  }
  try { await BleClient.disconnect(deviceId); } catch {}
  sessions.delete(deviceId);
  changed();
}

// Forget a failed or lost session so the device can be connected again.
export function dismiss(deviceId) {
  const s = sessions.get(deviceId);
  if (s && (s.state === 'failed' || s.state === 'disconnected')) {
    sessions.delete(deviceId);
    changed();
  }
}
