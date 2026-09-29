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

// The bleApi object sensor-ble decoders receive in start()/stop().
function bleApiFor(deviceId) {
  return {
    write: async (id, service, characteristic, data) => {
      const bytes = Uint8Array.from(data);
      await BleClient.write(id ?? deviceId, uuid128(service), uuid128(characteristic), new DataView(bytes.buffer));
    },
  };
}

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
  const s = { deviceId, name, decoder, state: 'connecting', values: {}, updatedAt: 0, error: null, count: 0 };
  sessions.set(deviceId, s);
  changed();
  const api = bleApiFor(deviceId);
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
    for (const n of decoder.notify) {
      await BleClient.startNotifications(deviceId, uuid128(n.service), uuid128(n.characteristic), (dv) => {
        let out = null;
        try {
          out = n.onNotification(deviceId, toBuffer(dv));
        } catch (e) {
          s.error = `decoder error: ${e.message}`;
        }
        if (out) {
          // Merge: devices may report different fields on different
          // characteristics (e.g. TESS pressure vs battery).
          Object.assign(s.values, out);
          s.updatedAt = Date.now();
          s.count++;
        }
      });
    }
    s.state = 'starting';
    changed();
    // isPreview = false: full rate (e.g. Muse at 100 Hz); the UI throttles.
    await decoder.start(deviceId, false, api);
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
