'use strict';

import { BleClient } from '@capacitor-community/bluetooth-le';
import * as bleConn from './ble-conn.js';
import { preferencesStorage } from './storage.js';
import { setStorage } from '../web/sensorble-custom.js';
import { initSerialSensorble } from '../web/serial-sensorble.js';

// Must precede initSerialSensorble, which restores cached decoders.
setStorage(preferencesStorage);

const root = document.querySelector('[data-panel="serial-sensorble"]');
initSerialSensorble(root, { conn: bleConn, readyMessage: 'Tap Start scan.' });

const locBtn = document.querySelector('#sbl-location');
bleConn.setLocationOffHandler(() => { locBtn.hidden = false; });
locBtn.addEventListener('click', async () => {
  locBtn.hidden = true;
  await BleClient.openLocationSettings();
});
