'use strict';

// Publish selected sensor-ble-decoders/ files as secret, single-file gists and
// print their raw URLs (the install URL for Sensor Logger / the sensor-ble tab).
// Re-publishing updates the same gist, so the unpinned raw URL stays stable.
//
// The name -> gist id map lives in the untracked .gists.json; when an entry is
// missing, the gist is looked up by its description tag.
//
// Usage: node scripts/publish-gist.js <name|path>...   (requires `gh auth login`)

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DECODERS = path.join(ROOT, 'sensor-ble-decoders');
const MAP_FILE = path.join(ROOT, '.gists.json');

// Generated decoders are rebuilt before publishing.
const GENERATORS = {
  'theengs.js': () => require('./build-sensorble-theengs.js').build(),
};

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const describe = (name) => `sensor-ble decoder: ${name} (theengs-online-decoder)`;

function loadMap() {
  try { return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')); } catch { return {}; }
}

function findByDescription(name) {
  const rows = gh('api', 'gists', '--paginate', '--jq', '.[] | [.id, .description] | @tsv');
  const hit = rows.split('\n').map((r) => r.split('\t')).find(([, d]) => d === describe(name));
  return hit ? hit[0] : null;
}

function publish(arg, map) {
  const name = path.basename(arg);
  const file = path.join(DECODERS, name);
  if (GENERATORS[name]) GENERATORS[name]();
  if (!fs.existsSync(file)) throw new Error(`no such decoder: sensor-ble-decoders/${name}`);

  let id = map[name] ?? findByDescription(name);
  if (id) {
    gh('gist', 'edit', id, '-f', name, file);
  } else {
    // gh gist create is secret by default and prints the gist URL.
    id = gh('gist', 'create', '--desc', describe(name), file).split('/').pop();
  }
  map[name] = id;

  const [owner, rev] = gh('api', `gists/${id}`, '--jq', '[.owner.login, .history[0].version] | @tsv').split('\t');
  const base = `https://gist.githubusercontent.com/${owner}/${id}/raw`;
  console.log(`${name}\n  raw:    ${base}/${name}\n  pinned: ${base}/${rev}/${name}`);
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('usage: publish-gist <name|path>...   e.g. publish-gist theengs.js');
    process.exit(2);
  }
  const map = loadMap();
  try {
    for (const arg of args) publish(arg, map);
  } catch (e) {
    console.error(`publish-gist: ${e.message}`);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2) + '\n');
  }
}

main();
