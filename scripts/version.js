'use strict';

// One shared version for the web app and the Sensor-BLE app, kept in the root
// package.json "version" (mirrored into app/package.json).
//
//   node scripts/version.js bump <major|minor|patch>
//       bump the version, write both package.json files, commit them
//   node scripts/version.js tag <web|app>
//       create and push the annotated tag v<version> (web: GitHub Pages
//       deploy) or app-v<version> (app: signed builds + TestFlight)
//
// Tagging refuses a dirty tree, an existing tag, or a HEAD that isn't pushed,
// so the tag always points at a published commit carrying that version.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FILES = [path.join(ROOT, 'package.json'), path.join(ROOT, 'app', 'package.json')];
const PREFIX = { web: 'v', app: 'app-v' };
const LABEL = { web: 'theengs-online-decoder', app: 'Sensor-BLE' };

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function readVersion() {
  return JSON.parse(fs.readFileSync(FILES[0], 'utf8')).version;
}

function writeVersion(file, version) {
  // Replace only the version value, so the file's formatting is preserved.
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  if (out === src && !src.includes(`"version": "${version}"`)) {
    throw new Error(`no "version" field in ${path.relative(ROOT, file)}`);
  }
  fs.writeFileSync(file, out);
}

function bump(part) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(readVersion());
  if (!m) throw new Error(`version "${readVersion()}" is not X.Y.Z`);
  let [maj, min, pat] = m.slice(1).map(Number);
  if (part === 'major') [maj, min, pat] = [maj + 1, 0, 0];
  else if (part === 'minor') [min, pat] = [min + 1, 0];
  else if (part === 'patch') pat += 1;
  else throw new Error('bump needs major, minor or patch');
  const next = `${maj}.${min}.${pat}`;
  for (const f of FILES) writeVersion(f, next);
  git('add', ...FILES);
  git('commit', '-q', '-m', `chore: version ${next}`);
  console.log(`version ${next} (committed; push, then tag with release:web / release:app)`);
}

function tag(kind) {
  if (!PREFIX[kind]) throw new Error('tag needs web or app');
  const version = readVersion();
  const name = PREFIX[kind] + version;
  if (git('status', '--porcelain')) throw new Error('working tree not clean');
  if (git('tag', '-l', name)) throw new Error(`tag ${name} already exists — bump first`);
  git('fetch', '-q', 'origin');
  if (!git('branch', '-r', '--contains', 'HEAD')) {
    throw new Error('HEAD is not pushed to origin — push first');
  }
  git('tag', '-a', name, '-m', `${LABEL[kind]} ${version}`);
  execFileSync('git', ['push', 'origin', name], { cwd: ROOT, stdio: 'inherit' });
  console.log(`pushed ${name}`);
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === 'bump') bump(arg);
  else if (cmd === 'tag') tag(arg);
  else throw new Error('usage: version.js bump <major|minor|patch> | tag <web|app>');
} catch (e) {
  console.error(`version: ${e.message}`);
  process.exit(1);
}
