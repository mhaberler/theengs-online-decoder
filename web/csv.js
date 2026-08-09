'use strict';

// Minimal RFC4180-ish CSV parser. Values stay strings, matching the JSON export.

function parseRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let started = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') { quoted = true; started = true; continue; }
    if (c === ',') { row.push(field); field = ''; started = true; continue; }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field);
      if (started || row.length > 1 || row[0] !== '') rows.push(row);
      row = []; field = ''; started = false;
      continue;
    }
    field += c;
    started = true;
  }
  if (started || field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * @param {string} text
 * @returns {Array<Record<string, string>>}
 */
export function parseCsv(text) {
  const rows = parseRows(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const obj = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = cells[j] ?? '';
    out.push(obj);
  }
  return out;
}
