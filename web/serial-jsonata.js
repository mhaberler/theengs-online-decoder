'use strict';

import { initSerialCore } from './serial-core.js';
import { bindExprPanes, evaluateAdv } from './jsonata-exprs.js';

// `conn` and `readyMessage` let the Capacitor app reuse this tab over the
// phone's BLE radio; the web app passes neither and gets the dongle.
export function initSerialJsonata(root, { conn, readyMessage } = {}) {
  bindExprPanes({
    trigger:      root.querySelector('#jso-trigger'),
    decoder:      root.querySelector('#jso-decoder'),
    save:         root.querySelector('#jso-save'),
    triggerError: root.querySelector('#jso-trigger-error'),
    decoderError: root.querySelector('#jso-decoder-error'),
  });

  const core = initSerialCore(root, {
    prefix: 'jso',
    decode: evaluateAdv,
    conn,
  });
  if (!core.available) return;
  core.setStatus(`Ready. ${readyMessage ?? 'Connect a port.'}`);
}
