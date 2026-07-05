'use strict';

import { loadDecoder, decodeEntry } from './decoder.js';
import { initSerial } from './serial.js';
import { initSerialJsonata } from './serial-jsonata.js';
import { initRadio } from './radio.js';
import { bindExprPanes, evaluateAdv } from './jsonata-exprs.js';

// --- Tabs ---
const tabBtns = document.querySelectorAll('.tab-btn');
const panels = document.querySelectorAll('.tab-panel');
tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.tab;
    tabBtns.forEach((b) => b.classList.toggle('active', b === btn));
    panels.forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  });
});

// --- File tab ---
const fileEl = document.getElementById('file');
const runEl = document.getElementById('run');
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const downloadEl = document.getElementById('download');
const dlEl = document.getElementById('dl');
const modeEl = document.getElementById('file-mode');
const exprsEl = document.getElementById('file-exprs');

let decoder = null;
let lastBlobUrl = null;

bindExprPanes({
  trigger:      document.getElementById('file-trigger'),
  decoder:      document.getElementById('file-decoder'),
  save:         document.getElementById('file-save'),
  triggerError: document.getElementById('file-trigger-error'),
  decoderError: document.getElementById('file-decoder-error'),
});

function updateRunEnabled() {
  runEl.disabled = modeEl.value === 'theengs' && !decoder;
}

modeEl.addEventListener('change', () => {
  exprsEl.style.display = modeEl.value === 'jsonata' ? '' : 'none';
  updateRunEnabled();
});

loadDecoder().then((d) => {
  decoder = d;
  statusEl.textContent = 'Decoder ready. Select a file.';
  updateRunEnabled();
}).catch((err) => {
  statusEl.textContent = 'Failed to load decoder: ' + err.message;
});

function nextTick() {
  return new Promise((r) => setTimeout(r, 0));
}

async function processEntries(entries, decodeFn) {
  const out = new Array(entries.length);
  const byModel = {};
  let decoded = 0;
  let errors = 0;
  const CHUNK = 500;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    let d = null;
    try {
      d = await decodeFn(e);
    } catch {
      errors++;
    }
    out[i] = { ...e, decoded: d };
    if (d) {
      decoded++;
      const k = d.model_id || d.model || '?';
      byModel[k] = (byModel[k] || 0) + 1;
    }
    if ((i + 1) % CHUNK === 0) {
      statusEl.textContent = `Decoding ${i + 1} / ${entries.length}…`;
      await nextTick();
    }
  }
  return { out, total: entries.length, decoded, byModel, errors };
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

runEl.addEventListener('click', async () => {
  const file = fileEl.files && fileEl.files[0];
  if (!file) {
    statusEl.textContent = 'Pick a file first.';
    return;
  }
  const jsonataMode = modeEl.value === 'jsonata';
  if (!jsonataMode && !decoder) {
    statusEl.textContent = 'Decoder not ready yet.';
    return;
  }
  const decodeFn = jsonataMode ? evaluateAdv : (e) => decodeEntry(decoder, e);
  runEl.disabled = true;
  downloadEl.style.display = 'none';
  summaryEl.textContent = '(processing…)';
  statusEl.textContent = 'Reading file…';

  try {
    const text = await readFile(file);
    const entries = JSON.parse(text);
    if (!Array.isArray(entries)) throw new Error('Expected a JSON array at the top level.');

    const { out, total, decoded, byModel, errors } = await processEntries(entries, decodeFn);

    summaryEl.textContent =
      `file:       ${file.name}\n` +
      `decoder:    ${jsonataMode ? 'JSONata' : 'theengs'}\n` +
      `total:      ${total}\n` +
      `decoded:    ${decoded}\n` +
      (errors ? `errors:     ${errors}\n` : '') +
      `by_model:   ${JSON.stringify(byModel, null, 2)}`;

    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = URL.createObjectURL(blob);
    dlEl.href = lastBlobUrl;
    const base = file.name.replace(/\.json$/i, '');
    dlEl.download = `${base}.decoded.json`;
    downloadEl.style.display = 'block';
    statusEl.textContent = `Done. ${decoded} of ${total} entries decoded.`;
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    summaryEl.textContent = '(no file processed yet)';
  } finally {
    updateRunEnabled();
  }
});

// --- Serial tabs ---
initSerial(document.querySelector('[data-panel="serial"]'));
initSerialJsonata(document.querySelector('[data-panel="serial-jsonata"]'));

// --- BLE radio tab (opt-in via ?webble=true) ---
const webbleEnabled = new URLSearchParams(location.search).get('webble') === 'true';
if (webbleEnabled) {
  initRadio(document.querySelector('[data-panel="radio"]'));
} else {
  document.querySelector('.tab-btn[data-tab="radio"]')?.remove();
  document.querySelector('.tab-panel[data-panel="radio"]')?.remove();
}
