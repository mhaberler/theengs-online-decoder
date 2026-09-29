'use strict';

// The phone's BLE radio behind the connection interface web/serial-core.js
// drives (same shape as web/serial-conn.js, minus ports/drivers): there is
// nothing to connect, so the state is always "connected" and only scanning
// toggles.

import { Capacitor } from '@capacitor/core';
import { BleClient, ScanMode } from '@capacitor-community/bluetooth-le';
import { scanResultToEntry } from './scan-entry.js';

const subs = new Set();
let scanning = false;
let initialized = false;
let onLocationOff = null;

function emit(fn, ...args) {
  for (const s of subs) { try { s[fn]?.(...args); } catch {} }
}
function emitChange() { emit('onChange', getState()); }
function status(msg) { emit('onStatus', msg); }

export const unavailableMessage = 'Bluetooth LE scanning needs the native app.';

export function available() {
  return Capacitor.isNativePlatform();
}

export function getState() {
  return {
    connected: true,
    connecting: false,
    scanning,
    driverName: 'phone',
    driverLabel: 'Phone BLE',
    portInfo: '',
  };
}

// handlers: { onChange(state), onStatus(msg), onAdvert(entry) }
export function subscribe(handlers) {
  subs.add(handlers);
  return () => subs.delete(handlers);
}

// Called with no arguments when Android reports system location off — scans
// return nothing then, even with permission granted.
export function setLocationOffHandler(fn) {
  onLocationOff = fn;
}

export async function toggleScan() {
  await setScanning(!scanning);
}

export async function setScanning(on) {
  if (on === scanning) return;
  if (!on) {
    scanning = false;
    try { await BleClient.stopLEScan(); } catch {}
    emitChange();
    status('Idle.');
    return;
  }
  try {
    if (!initialized) {
      // Location permission is requested too (no androidNeverForLocation):
      // asserting neverForLocation makes Android filter some beacon adverts.
      await BleClient.initialize();
      initialized = true;
    }
    if (Capacitor.getPlatform() === 'android' && !(await BleClient.isLocationEnabled())) {
      status('Location is off — Android returns no scan results without it.');
      onLocationOff?.();
      return;
    }
    await BleClient.requestLEScan(
      { allowDuplicates: true, scanMode: ScanMode.SCAN_MODE_LOW_LATENCY },
      (result) => { if (scanning) emit('onAdvert', scanResultToEntry(result)); },
    );
  } catch (e) {
    status('Scan failed: ' + (e?.message ?? e));
    return;
  }
  scanning = true;
  emitChange();
  status('Scanning phone BLE radio.');
}
