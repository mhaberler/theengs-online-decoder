'use strict';

import { initSerialCore } from './serial-core.js';
import { decodeEntry, decoderOf, builtinDecoders } from './sensorble-decode.js';

// The Serial/sensor-ble tab: scanning and the log. Installed decoders, the
// built-in toggles and catalogs live in the Decoders tab (decoders-tab.js).
//
// `conn` and `readyMessage` let the Capacitor app reuse this tab over the
// phone's BLE radio; the web app passes neither and gets the dongle.
export function initSerialSensorble(root, { conn, readyMessage } = {}) {
  const core = initSerialCore(root, { prefix: 'sbl', decode: decodeEntry, decoderName: decoderOf, conn });
  if (!core.available) return;
  core.setStatus(`sensor-ble ready (${builtinDecoders.length} built-in decoders). ${readyMessage ?? 'Connect a port.'}`);
}
