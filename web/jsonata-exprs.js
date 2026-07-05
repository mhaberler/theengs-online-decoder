'use strict';

// Shared JSONata trigger/decoder expression pair: one localStorage-backed pair
// used by both the Serial/JSONata tab and the File tab's JSONata mode. Every
// tab binds its own textarea panes via bindExprPanes(); saving in one tab
// updates all bound panes and the compiled expressions used for decoding.

import jsonata from './jsonata-shim.js';

const KEY_TRIGGER = 'jsonata-trigger';
const KEY_DECODER = 'jsonata-decoder';

const DEFAULT_TRIGGER = '$substring(manufacturerdata, 0, 4) = "9904"';

const DEFAULT_DECODER = `(
  $md := manufacturerdata;
  $payload := $substring($md, 4, 48);
  $temp_raw := $number("0x" & $substring($payload, 2, 4));
  $tempc := (($temp_raw > 32767) ? $temp_raw - 65536 : $temp_raw) * 0.005;
  $tempf := $tempc * 1.8 + 32;
  $accx_raw := $number("0x" & $substring($payload, 14, 4));
  $accx := (($accx_raw > 32767) ? $accx_raw - 65536 : $accx_raw) / 1000;
  $accy_raw := $number("0x" & $substring($payload, 18, 4));
  $accy := (($accy_raw > 32767) ? $accy_raw - 65536 : $accy_raw) / 1000;
  $accz_raw := $number("0x" & $substring($payload, 22, 4));
  $accz := (($accz_raw > 32767) ? $accz_raw - 65536 : $accz_raw) / 1000;
  $power_raw := $number("0x" & $substring($payload, 26, 4));
  $volt := ($floor($power_raw / 32) + 1600) / 1000;
  $tx := ($power_raw % 32) * 2 - 40;
  $mov := $number("0x" & $substring($payload, 30, 2));
  $seq := $number("0x" & $substring($payload, 32, 4));
  $mac_hex := $substring($payload, 36, 12);
  $mac_arr := $map([0,2,4,6,8,10], function($i){ $uppercase($substring($mac_hex, $i, 2)) });
  $mac := $join($mac_arr, ":");
  $name := "Ruuvi " & $uppercase($substring($mac_hex, 8, 4));
  {
    "id": $mac,
    "name": $name,
    "rssi": rssi,
    "brand": "Ruuvi",
    "model": "RuuviTag",
    "model_id": "RuuviTag_RAWv2",
    "type": "ACEL",
    "tempc": $round($tempc, 3),
    "tempf": $round($tempf, 3),
    "accx": $round($accx, 6),
    "accy": $round($accy, 6),
    "accz": $round($accz, 6),
    "volt": $round($volt, 3),
    "tx": $tx,
    "mov": $mov,
    "seq": $seq,
    "mac": $mac
  }
)`;

let sources = {
  trigger: localStorage.getItem(KEY_TRIGGER) ?? DEFAULT_TRIGGER,
  decoder: localStorage.getItem(KEY_DECODER) ?? DEFAULT_DECODER,
};

function compileOne(src) {
  try {
    return { expr: jsonata(src), error: null };
  } catch (e) {
    const pos = e.position !== undefined ? ` (position ${e.position})` : '';
    return { expr: null, error: e.message + pos };
  }
}

// Compile whatever was stored; a corrupt saved expression surfaces its error
// in every bound pane so the failure is visible without pressing Save.
const initial = { trigger: compileOne(sources.trigger), decoder: compileOne(sources.decoder) };
let compiled = { trigger: initial.trigger.expr, decoder: initial.decoder.expr };
let lastErrors = { trigger: initial.trigger.error, decoder: initial.decoder.error };

const panes = new Set();

function showErrors(p, errs) {
  if (p.triggerError) p.triggerError.textContent = errs.trigger ?? '';
  if (p.decoderError) p.decoderError.textContent = errs.decoder ?? '';
}

function refreshPane(p) {
  p.trigger.value = sources.trigger;
  p.decoder.value = sources.decoder;
  showErrors(p, lastErrors);
}

// els: { trigger, decoder, save, triggerError, decoderError }
export function bindExprPanes(els) {
  panes.add(els);
  refreshPane(els);
  els.save.addEventListener('click', () => {
    const trig = compileOne(els.trigger.value);
    const dec = compileOne(els.decoder.value);
    showErrors(els, { trigger: trig.error, decoder: dec.error });
    if (trig.error || dec.error) return;
    sources = { trigger: els.trigger.value, decoder: els.decoder.value };
    compiled = { trigger: trig.expr, decoder: dec.expr };
    lastErrors = { trigger: null, decoder: null };
    localStorage.setItem(KEY_TRIGGER, sources.trigger);
    localStorage.setItem(KEY_DECODER, sources.decoder);
    for (const p of panes) if (p !== els) refreshPane(p);
  });
}

// Trigger truthy → decoder result (undefined mapped to null); falsy → null.
// Throws on evaluation errors (caller renders/records them).
export async function evaluateAdv(adv) {
  if (!compiled.trigger || !compiled.decoder) {
    throw new Error('No valid saved expressions — fix and Save first.');
  }
  const trig = await compiled.trigger.evaluate(adv);
  if (!trig) return null;
  const dec = await compiled.decoder.evaluate(adv);
  return dec === undefined ? null : dec;
}
