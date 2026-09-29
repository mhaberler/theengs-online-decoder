'use strict';

import { BleClient } from '@capacitor-community/bluetooth-le';
import * as bleConn from './ble-conn.js';
import { preferencesStorage } from './storage.js';
import { setStorage as setDecoderStorage } from '../web/sensorble-custom.js';
import { setStorage as setExprStorage, init as initExprs } from '../web/jsonata-exprs.js';
import { initSerialSensorble } from '../web/serial-sensorble.js';
import { initSerialJsonata } from '../web/serial-jsonata.js';
import { initDecodersTab } from '../web/decoders-tab.js';

// Storage must be set before the tabs restore cached decoders, catalogs and
// expressions (decoder-catalog.js shares sensorble-custom's store).
setDecoderStorage(preferencesStorage);
setExprStorage(preferencesStorage);
await initExprs();

// Both tabs subscribe to the one phone scan, like the web app's serial tabs
// share one dongle.
const panel = (name) => document.querySelector(`[data-panel="${name}"]`);
initSerialSensorble(panel('serial-sensorble'), { conn: bleConn, readyMessage: 'Tap Start scan.' });
initSerialJsonata(panel('serial-jsonata'), { conn: bleConn, readyMessage: 'Tap Start scan.' });
initDecodersTab(panel('decoders'));

const tabBtns = document.querySelectorAll('.tab-btn');
for (const btn of tabBtns) {
  btn.addEventListener('click', () => {
    for (const b of tabBtns) b.classList.toggle('active', b === btn);
    for (const p of document.querySelectorAll('.tab-panel')) {
      p.classList.toggle('active', p.dataset.panel === btn.dataset.tab);
    }
  });
}

const locBtn = document.querySelector('#sbl-location');
bleConn.setLocationOffHandler(() => { locBtn.hidden = false; });
locBtn.addEventListener('click', async () => {
  locBtn.hidden = true;
  await BleClient.openLocationSettings();
});
