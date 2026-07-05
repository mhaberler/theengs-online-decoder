'use strict';

import { driverFactories, detectDongle } from './drivers/index.js';

// Shared dongle connection — a singleton owned by no tab. Both serial tabs
// subscribe: Connect/Disconnect/Start scan in either tab drives the same port,
// and every subscriber receives the advert stream (each tab decodes with its
// own strategy). Connection and scan state are dongle state, so they are
// global by design.

export const PROFILES = [
  { id: 'auto', label: 'Auto-detect', baud: null, flow: null },
  { id: 'nrf', label: 'nRF Sniffer (1 Mbaud)', baud: 1000000, flow: 'hardware', driverName: 'nRF Sniffer' },
  { id: 'adv2uart', label: 'adv2uart (ESP32-C3)', baud: 115200, flow: 'none', driverName: 'adv2uart' },
  { id: 'omg-115k', label: 'OMG @ 115200', baud: 115200, flow: 'none', driverName: 'OMG' },
  { id: 'omg-921k', label: 'OMG @ 921600', baud: 921600, flow: 'none', driverName: 'OMG' },
  { id: 'omg-9600', label: 'OMG @ 9600',   baud: 9600,   flow: 'none', driverName: 'OMG' },
];

const subs = new Set();

let port = null;
let reader = null;
let readLoop = null;
let writer = null;
let writerLock = Promise.resolve();
let driver = null;
let pingTimer = null;
let closing = false;
let scanning = false;
let connecting = false;
let driverLabel = '';
let portInfo = '';

function emit(fn, ...args) {
  for (const s of subs) { try { s[fn]?.(...args); } catch {} }
}
function emitChange() { emit('onChange', getState()); }
function status(msg) { emit('onStatus', msg); }

export function getState() {
  return {
    connected: !!port && !!driver,
    connecting,
    scanning,
    driverName: driver?.name ?? '',
    driverLabel,
    portInfo,
  };
}

// handlers: { onChange(state), onStatus(msg), onAdvert(advJson), onLine(line) }
export function subscribe(handlers) {
  subs.add(handlers);
  return () => subs.delete(handlers);
}

export function renderDriverControls(container) {
  if (driver && typeof driver.renderControls === 'function') {
    driver.renderControls(container);
  }
}

async function safeWrite(bytes) {
  if (!writer) return;
  writerLock = writerLock.then(() => writer.write(bytes)).catch(() => {});
  return writerLock;
}

async function openPort(p, baudRate, flowControl) {
  const opts = { baudRate };
  if (flowControl) opts.flowControl = flowControl;
  await p.open(opts);
  // Note: do NOT toggle DTR/RTS — ESP32-based dongles (OMG) reset on those edges.
}

export async function connect(profileId) {
  if (port || connecting) return;
  connecting = true;
  emitChange();
  try {
    port = await navigator.serial.requestPort();
    const profile = PROFILES.find((p) => p.id === profileId) ?? PROFILES[0];

    const attempts = profile.id === 'auto'
      ? [
          { baud: 115200,  flow: 'none',     forceDriverName: null, timeoutMs: 1500 },
          { baud: 1000000, flow: 'hardware', forceDriverName: null, timeoutMs: 800 },
        ]
      : [{ baud: profile.baud, flow: profile.flow, forceDriverName: profile.driverName, timeoutMs: 1500 }];

    let chosen = null;
    for (const a of attempts) {
      try {
        await openPort(port, a.baud, a.flow);
      } catch (e) {
        status(`Open ${a.baud}/${a.flow} failed: ${e.message}`);
        continue;
      }

      if (a.forceDriverName) {
        const factory = driverFactories.find((f) => f().name === a.forceDriverName);
        chosen = { driver: factory ? factory() : null, baud: a.baud, flow: a.flow, buffered: [] };
        if (chosen.driver) {
          writer = port.writable.getWriter();
          reader = port.readable.getReader();
          break;
        }
      } else {
        writer = port.writable.getWriter();
        reader = port.readable.getReader();
        status(`Probing dongle at ${a.baud}…`);
        const det = await detectDongle({ reader, write: safeWrite, timeoutMs: a.timeoutMs ?? 700 });
        if (det.driver) {
          chosen = { driver: det.driver, baud: a.baud, flow: a.flow, buffered: det.buffered };
          break;
        }
        // No match — tear down and try next baud
        try { await reader.cancel(); } catch {}
        try { reader.releaseLock(); } catch {}
        reader = null;
        try { writer.releaseLock(); } catch {}
        writer = null;
        writerLock = Promise.resolve();
        try { await port.close(); } catch (e) { status('close failed: ' + e.message); }
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (!chosen || !chosen.driver) {
      status('Could not detect a known dongle. Pick a profile manually and reconnect.');
      try { await port?.close(); } catch {}
      port = null;
      return;
    }

    driver = chosen.driver;

    const info = port.getInfo?.() ?? {};
    portInfo = `usbVendorId=0x${(info.usbVendorId ?? 0).toString(16)} usbProductId=0x${(info.usbProductId ?? 0).toString(16)} @ ${chosen.baud}${chosen.flow !== 'none' ? ' ' + chosen.flow : ''}`;
    driverLabel = driver.name;
    status(`Connected (${driver.name}).`);

    closing = false;
    startReadLoop(chosen.buffered ?? []);
  } catch (e) {
    status('Connect failed: ' + e.message);
    await cleanup();
  } finally {
    connecting = false;
    emitChange();
  }
}

export async function disconnect() {
  await setScanning(false);
  await cleanup();
  status('Disconnected.');
}

async function cleanup() {
  closing = true;
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (reader) {
    try { await reader.cancel(); } catch {}
  }
  try { await readLoop; } catch {}
  reader = null;
  readLoop = null;
  if (writer) {
    try { await writer.close(); } catch {}
    try { writer.releaseLock(); } catch {}
    writer = null;
  }
  if (port) {
    try { await port.close(); } catch {}
  }
  port = null;
  driver = null;
  driverLabel = '';
  portInfo = '';
  scanning = false;
  emitChange();
}

export async function toggleScan() {
  await setScanning(!scanning);
}

export async function setScanning(on) {
  if (on === scanning) return;
  if (on) {
    if (!driver) return;
    if (driver.start) await driver.start(safeWrite);
    if (driver.sendPing && driver.pingInterval) {
      pingTimer = setInterval(() => { driver?.sendPing(safeWrite); }, driver.pingInterval);
    }
    scanning = true;
    status(`Scanning (${driver.name}).`);
  } else {
    scanning = false;
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (driver?.stop) await driver.stop(safeWrite);
    if (port) status('Idle.');
  }
  emitChange();
}

function startReadLoop(buffered) {
  const cbs = {
    onAdvert: (advJson) => { if (scanning) emit('onAdvert', advJson); },
    onLine: (line) => { if (scanning) emit('onLine', line); },
    onInfo: (info) => {
      if (info?.version && driver) {
        driverLabel = `${driver.name} (${info.version.trim()})`;
        emitChange();
      }
    },
  };

  readLoop = (async () => {
    for (const b of buffered) driver.ingest(b, cbs);
    // Non-fatal UART conditions (break, framing/parity error, overrun) error
    // the readable stream but leave the port open — re-acquire a reader and
    // keep going. Fatal errors null out port.readable, ending the loop.
    while (!closing && port) {
      if (!reader) {
        if (!port.readable) break;
        try { reader = port.readable.getReader(); } catch { break; }
      }
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) { closing = true; break; }
          if (value?.length) driver.ingest(value, cbs);
        }
      } catch (e) {
        if (!closing) status(`Read error (${e.message}) — recovering.`);
      } finally {
        try { reader.releaseLock(); } catch {}
        reader = null;
      }
    }
  })();
}
