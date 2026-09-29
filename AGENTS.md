# AGENTS.md

Guidance for coding agents (Claude Code, Codex, Cursor, …) working in this
repository. Claude Code loads it through the `@AGENTS.md` import in CLAUDE.md —
edit this file, not CLAUDE.md.

## What this is

`theengs-online-decoder` — a standalone Node.js + browser app for decoding BLE
advertisements from consumer sensors/devices, built on
[TheengsDecoder](https://decoder.theengs.io/).

It is **pure JS** — no C++, no CMake, no Emscripten. The compiled WebAssembly
comes from the [`theengs-decoder`](https://www.npmjs.com/package/theengs-decoder)
npm dependency: `node_modules/theengs-decoder/dist/theengs_decoder_wasm.mjs`, an
ES module with a `default` createModule export and base64-embedded wasm (single
file, no sidecar `.wasm`, built for both `web` and `node`). That one artifact
backs both the Node API and the browser web app; nothing is copied into the repo
(sole exception: the generated `sensor-ble-decoders/theengs.js`, which inlines it).

> Use **bun** for installs (`bun install`) — the npm registry mirror in this
> environment can't resolve the `theengs-decoder` dependency.

## Commands

```sh
bun install                # pulls theengs-decoder (provides the wasm)
bun run test               # node --test test/*.test.js
node --test test/decode.test.js   # single test file
bun run decode-log <file>  # decode a sensorlogs-style JSON file from the CLI
bun run decode-sensorlogs  # decode everything in sensorlogs/*.json
bun run build-sensorble-theengs  # regenerate sensor-ble-decoders/theengs.js
bun run publish-gist <name>...   # publish sensor-ble-decoders/<name> as secret gist(s), print raw URLs

cd app && bun run sync          # mobile app: vite build + cap sync (bun install in root and app/ first)
cd app && bun run run-android   # / run-ios — install on the configured device
scripts/sync-app-secrets.sh     # push app-signing secrets (from env) to repo Actions secrets

bun run web                # zero-dep static server (serve.js) on :8000
bun run web:dev            # vite dev server on :5173
bun run web:build          # production build -> web/dist/
bun run deploy-web         # vite build + rsync to host (configured via .env, see README.md)

bun run version:patch      # / version:minor / version:major: bump the shared version
                           # (package.json + app/package.json), commit
bun run release:web        # tag + push v<version>     (GitHub Pages deploy)
bun run release:app        # tag + push app-v<version> (signed app builds, TestFlight)
```

## Architecture

**Node API.** [index.js](index.js) lazy-loads the wasm module via dynamic
`import()` of `theengs-decoder/dist/theengs_decoder_wasm.mjs` (singleton promise +
singleton decoder instance), parses/stringifies JSON at the boundary, and returns
`null` instead of empty strings. `ready()` pre-warms the module. The wasm exposes
three string-in/string-out methods — `decodeBLE`, `getProperties`,
`getAttribute` — and all cross-language data is JSON strings. This is the package
`main`; [index.d.ts](index.d.ts) is the type surface.

**Web app** ([web/](web/)). Static, build-stepless-capable, runs the same wasm
in-page. Tabs in [web/app.js](web/app.js): **File** (decode a sensorlogs
JSON array — theengs or JSONata mode — annotate each entry with a `decoded` field,
offer download), **Serial/theengs** ([web/serial.js](web/serial.js), Web Serial API),
**Serial/JSONata** ([web/serial-jsonata.js](web/serial-jsonata.js), same dongle
stack but decodes via user-pasted JSONata trigger/decoder expressions),
**Serial/sensor-ble** ([web/serial-sensorble.js](web/serial-sensorble.js), same
dongle stack decoding via the `sensor-ble` library), **Radio**
([web/radio.js](web/radio.js), `navigator.bluetooth.requestLEScan`).
The dongle connection lives in [web/serial-conn.js](web/serial-conn.js) — a
singleton (port, autodetect, read loop, scan state) shared by both serial tabs;
[web/serial-core.js](web/serial-core.js) is the per-tab view (log rendering,
counters) and tabs differ only in the `decode` callback and the `decoderName`
label shown in each row's headline (`→ model [decoder]`; a string, or for
sensor-ble `decoderOf(result)`, a WeakMap lookup so the decoded JSON stays
untouched);
the JSONata expression pair lives in [web/jsonata-exprs.js](web/jsonata-exprs.js)
(one persisted pair shared by the File and Serial/JSONata tabs; storage is
pluggable and loaded by an async `init()`).
[web/decoder.js](web/decoder.js) is the browser-side wasm wrapper (parallels
index.js).

**sensor-ble decoding** ([web/sensorble-decode.js](web/sensorble-decode.js)).
The `decode` callback for the Serial/sensor-ble tab, over the `sensor-ble`
dependency (a bun git dependency pinned to a commit on the `mhaberler` fork —
the npm release is stale). Only decoders with an `advertisementDecode` function
are used; the streaming ones need a GATT connection a scanner dongle can't
provide. `isDecoderValid` is a port of the same function in sensor-ble's Node
harness (name → manufacturer → serviceUUID), and
[web/buffer-shim.js](web/buffer-shim.js) supplies the Node `Buffer` the decoders
expect — it must be imported before them, since they use a bare global.
[web/sensorble-custom.js](web/sensorble-custom.js) installs decoders from a URL
at runtime (fetch → blob URL → dynamic `import`, never `eval`), caching URL and
source in localStorage so they re-register offline; a custom decoder overrides a
built-in of the same `decoderName`. Catalog installs pass `{ catalogUrl,
version, sha256 }` and are refused on a sha256 mismatch.

**Decoders tab / catalogs.** [web/decoders-tab.js](web/decoders-tab.js) is the
Decoders tab (web and app): Installed + built-in toggles, Browse, Catalogs,
install-from-URL; the sensor-ble tab only scans and logs.
[web/decoder-catalog.js](web/decoder-catalog.js) keeps learned catalogs
(storage key `sensorble-catalogs`, with each catalog's cached index; preset
`PRESET_CATALOG`) and fetches them — page URL → `<link rel="alternate"
type="application/vnd.sensorble.catalog+json">` → `decoders.json` (schema 1).
Pure, Node-tested helpers (version compare, UUID normalization, matching
against `seenSignals()` from sensorble-decode, index resolution, sha256) live
in [web/catalog-util.js](web/catalog-util.js). The catalog format and a
forkable publisher are in the separate template repo
`mhaberler/sensor-ble-decoder-catalog`. The web app handles `?catalog=<url>`
(confirm, then add); the mobile app handles the deep link
`sensorble://catalog?url=<encoded url>` identically (`handleDeepLink` in
[app/main.js](app/main.js), via `@capacitor/app` `getLaunchUrl`/`appUrlOpen`;
scheme registered in `Info.plist` `CFBundleURLTypes` and an Android
`intent-filter`). Verify shim changes against the decoders'
own fixtures: each `node_modules/sensor-ble/devices/*.js` exports a `tests`
array of given/expected pairs. Local extensions to the sensor-ble contract:
`matchAll: true` matches every advertisement and such decoders are tried
**last** (`activeDecoders`); built-ins unchecked in the UI are skipped
(`setDisabledBuiltins`, persisted by `sensorble-custom.js` under
`sensorble-disabled-builtins`; custom decoders are never affected); `advertisementDecode` gets a third `meta` arg
`{ name, id }`.

**Theengs-as-sensor-ble decoder.** `sensor-ble-decoders/theengs.js` is
**generated** by [scripts/build-sensorble-theengs.js](scripts/build-sensorble-theengs.js)
(`bun run build-sensorble-theengs`) and committed (published as a gist). It
inlines the theengs wasm `.mjs` and textually patches out its Node branches
(`import.meta.url`, `await import('module')`, `require(...)`, shell-env assert)
so it satisfies Sensor Logger's no-`import`/`require` sandbox; each patch asserts
its match count, so a theengs-decoder bump that changes the Emscripten glue
fails the build. Rerun the generator after bumping theengs-decoder.
Top-level `await` initializes the wasm, so the decoder is ready once its
module import resolves.

**Mobile app** ([app/](app/)). Capacitor 8 app "Sensor-BLE"
(`com.haberler.sensorble`), native only: the Serial/sensor-ble and
Serial/JSONata tabs over the phone's BLE radio (one scan, both tabs subscribed). [web/serial-core.js](web/serial-core.js) takes the
connection as a `conn` option (default `serial-conn.js`);
[app/ble-conn.js](app/ble-conn.js) implements that interface over
`@capacitor-community/bluetooth-le` (always "connected", only scanning
toggles), and [app/scan-entry.js](app/scan-entry.js) converts a `ScanResult`
into the advert entry shape (company ID re-prefixed LE; all service data as
`serviceDataMap`, which `readEntry` accepts; `servicedatauuid` shortened to the
dongle's `0xxxxx` form for Base UUIDs). `initSerialSensorble` and
`initSerialJsonata` take `{ conn, readyMessage }`; `sensorble-custom.js` and
`jsonata-exprs.js` take a storage adapter via `setStorage` (app:
`@capacitor/preferences`) — `jsonata-exprs.js` must be `await init()`ed before
binding panes (web/app.js does it with localStorage). The app imports `../web/*.js`
directly; its vite config maps `./sensor-ble` and `./jsonata.min.js` to the
root `node_modules`.
Markup/CSS in `app/index.html`/`style.css` are a copy of the web panels — keep
ids (`sbl-*`, `jso-*`) in sync. iOS uses Swift Package Manager (no CocoaPods).
Signed builds: [.github/workflows/app-release.yml](.github/workflows/app-release.yml)
on `app-v*` tags / dispatch — iOS unsigned archive + `-exportArchive
-allowProvisioningUpdates` with an ASC API key (cloud-managed signing,
`app/ci/ExportOptions-*.plist`), Android Gradle `signingConfigs.release` from
`ANDROID_KEYSTORE_*` env; versions injected from tag + run number. No fastlane.
Full setup and troubleshooting: [BUILD.md](BUILD.md) — keep it in sync when
changing the workflow, export options or signing config.

**Dongle drivers** ([web/drivers/](web/drivers/)). Pluggable registry in
[web/drivers/index.js](web/drivers/index.js) for USB-serial BLE-scanner dongles
(nRF, adv2uart, OpenMQTTGateway). Each factory returns a driver with a uniform
shape — `probeMatches`, `start`/`stop`, `ingest(bytes, callbacks)`, optional
`buildPing`. `detectDongle()` autodetects by writing each driver's ping and
matching the first responding wire format. **To add a dongle driver:** create a
factory in `web/drivers/`, append it to `driverFactories`, and follow the
interface documented in the comment block at the top of index.js.

**Wasm distribution.** `node_modules/theengs-decoder/dist/theengs_decoder_wasm.mjs`
is the single source of truth — never copied or committed (except inlined into
the generated `sensor-ble-decoders/theengs.js`). Browser code imports
the relative URL `./theengs_decoder_wasm.mjs` ([web/decoder.js](web/decoder.js));
each server maps that URL to the node_modules artifact: vite via `resolve.alias`
([web/vite.config.mjs](web/vite.config.mjs)), `serve.js` via a route in
`resolveFile`. Node imports the bare specifier directly. The jsonata UMD build
(`node_modules/jsonata/jsonata.min.js`) is served the same way — browser code
imports `./jsonata.min.js` through [web/jsonata-shim.js](web/jsonata-shim.js),
which re-exports `window.jsonata`. `sensor-ble` follows the pattern too, but as
a **directory** map (`./sensor-ble/` → `node_modules/sensor-ble/`), since
`main.js` imports `./devices/*.js`.

## Conventions

- CommonJS in Node code (`index.js`, `scripts/`); ES modules in the browser
  (`web/`). Both use `'use strict'`.
- The decoder boundary is always JSON strings; never pass structured data across
  the wasm call.
- Keep `web/decoder.js` and `index.js` behaviorally aligned — they wrap the same
  three wasm methods for two runtimes.
- License is GPL-3.0-only (matches the underlying library).

## Agent tooling

- If using MobileBuildMCP, use the installed MobileBuildMCP skill before calling MobileBuildMCP tools.
