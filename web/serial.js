'use strict';

import { loadDecoder, decodeEntry } from './decoder.js';
import { initSerialCore } from './serial-core.js';

export function initSerial(root) {
  let decoder = null;
  const core = initSerialCore(root, {
    prefix: 'ser',
    decode: (advJson) => (decoder ? decodeEntry(decoder, advJson) : null),
  });
  if (!core.available) return;
  loadDecoder().then((d) => {
    decoder = d;
    core.setStatus('Decoder ready. Connect a port.');
  }).catch((e) => core.setStatus('Decoder load failed: ' + e.message));
}
