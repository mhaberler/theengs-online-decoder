'use strict';

// Regenerate sensor-ble-decoders/theengs.js and copy it into a decoder
// catalog checkout (a repo made from the sensor-ble-decoder-catalog template),
// then run that catalog's build to check it. Committing and pushing the
// catalog repo (which publishes it to GitHub Pages) is left to you.
//
// Usage: node scripts/publish-catalog.js [--catalog-dir ../sensor-ble-decoders-custom]

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { build } = require('./build-sensorble-theengs.js');

const args = process.argv.slice(2);
const at = args.indexOf('--catalog-dir');
const catalogDir = path.resolve(at >= 0 ? args[at + 1] : path.join(__dirname, '..', '..', 'sensor-ble-decoders-custom'));

try {
  const buildScript = path.join(catalogDir, 'scripts', 'build-catalog.js');
  if (!fs.existsSync(buildScript)) {
    throw new Error(`${catalogDir} is not a catalog checkout (no scripts/build-catalog.js)`);
  }
  const src = build();
  const dest = path.join(catalogDir, 'decoders', 'theengs.js');
  fs.copyFileSync(src, dest);
  console.log(`copied ${path.relative(process.cwd(), src)} -> ${dest}`);
  execFileSync(process.execPath, [buildScript], { cwd: catalogDir, stdio: 'inherit' });
  console.log(`\nnext: review, then commit and push in ${catalogDir}`);
} catch (e) {
  console.error(`publish-catalog: ${e.message}`);
  process.exit(1);
}
