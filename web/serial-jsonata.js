'use strict';

import { initSerialCore } from './serial-core.js';
import { bindExprPanes, evaluateAdv } from './jsonata-exprs.js';

export function initSerialJsonata(root) {
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
  });
  if (!core.available) return;
  core.setStatus('Ready. Connect a port.');
}
