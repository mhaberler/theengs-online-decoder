'use strict';

import { App } from '@capacitor/app';
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
const decodersTab = initDecodersTab(panel('decoders'));

const tabBtns = document.querySelectorAll('.tab-btn');
for (const btn of tabBtns) {
  btn.addEventListener('click', () => {
    for (const b of tabBtns) b.classList.toggle('active', b === btn);
    for (const p of document.querySelectorAll('.tab-panel')) {
      p.classList.toggle('active', p.dataset.panel === btn.dataset.tab);
    }
  });
}

// Deep link sensorble://catalog?url=<catalog URL> (a catalog page's QR code
// with qrTarget "deeplink"): like the web app's ?catalog= — confirm, add the
// catalog, show the Decoders tab. Arrives via getLaunchUrl() on a cold start
// and appUrlOpen while running; a repeat of the same URL is ignored, since
// some platforms report a cold-start URL through both.
let lastDeepLink = '';
function handleDeepLink(link) {
  if (!link || link === lastDeepLink) return;
  lastDeepLink = link;
  let u;
  try { u = new URL(link); } catch { return; }
  const target = u.host || u.pathname.replace(/^\/+/, ''); // sensorble://catalog or sensorble:catalog
  if (u.protocol !== 'sensorble:' || target !== 'catalog') return;
  const catalogUrl = u.searchParams.get('url');
  if (!catalogUrl) return;
  document.querySelector('.tab-btn[data-tab="decoders"]')?.click();
  if (confirm(`Add this decoder catalog?\n\n${catalogUrl}\n\nOnly add catalogs you trust — their decoders run in the app.`)) {
    decodersTab.addCatalog(catalogUrl);
  }
}
App.addListener('appUrlOpen', ({ url }) => handleDeepLink(url));
App.getLaunchUrl().then((r) => handleDeepLink(r?.url)).catch(() => {});

const locBtn = document.querySelector('#sbl-location');
bleConn.setLocationOffHandler(() => { locBtn.hidden = false; });
locBtn.addEventListener('click', async () => {
  locBtn.hidden = true;
  await BleClient.openLocationSettings();
});
