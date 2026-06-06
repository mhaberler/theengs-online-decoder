# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`theengs-online-decoder` — a standalone Node.js + browser app for decoding BLE
advertisements from consumer sensors/devices, built on
[TheengsDecoder](https://decoder.theengs.io/).

It is **pure JS** — no C++, no CMake, no Emscripten. The compiled WebAssembly
comes from the [`theengs-decoder`](https://www.npmjs.com/package/theengs-decoder)
npm dependency: `node_modules/theengs-decoder/dist/theengs_decoder_wasm.mjs`, an
ES module with a `default` createModule export and base64-embedded wasm (single
file, no sidecar `.wasm`, built for both `web` and `node`). That one artifact
backs both the Node API and the browser web app; nothing is copied into the repo.

> Use **bun** for installs (`bun install`) — the npm registry mirror in this
> environment can't resolve the `theengs-decoder` dependency.

## Commands

```sh
bun install                # pulls theengs-decoder (provides the wasm)
bun run test               # node --test test/*.test.js
node --test test/decode.test.js   # single test file
bun run decode-log <file>  # decode a sensorlogs-style JSON file from the CLI
bun run decode-sensorlogs  # decode everything in sensorlogs/*.json

bun run web                # zero-dep static server (serve.js) on :8000
bun run web:dev            # vite dev server on :5173
bun run web:build          # production build -> web/dist/
bun run deploy-web         # vite build + rsync to host (configured via .env, see web/README.md)
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
in-page. Three tabs in [web/app.js](web/app.js): **File** (decode a sensorlogs
JSON array, annotate each entry with a `decoded` field, offer download), **Serial**
([web/serial.js](web/serial.js), Web Serial API), **Radio**
([web/radio.js](web/radio.js), `navigator.bluetooth.requestLEScan`).
[web/decoder.js](web/decoder.js) is the browser-side wasm wrapper (parallels
index.js).

**Dongle drivers** ([web/drivers/](web/drivers/)). Pluggable registry in
[web/drivers/index.js](web/drivers/index.js) for USB-serial BLE-scanner dongles
(nRF, adv2uart, OpenMQTTGateway). Each factory returns a driver with a uniform
shape — `probeMatches`, `start`/`stop`, `ingest(bytes, callbacks)`, optional
`buildPing`. `detectDongle()` autodetects by writing each driver's ping and
matching the first responding wire format. **To add a dongle driver:** create a
factory in `web/drivers/`, append it to `driverFactories`, and follow the
interface documented in the comment block at the top of index.js.

**Wasm distribution.** `node_modules/theengs-decoder/dist/theengs_decoder_wasm.mjs`
is the single source of truth — never copied or committed. Browser code imports
the relative URL `./theengs_decoder_wasm.mjs` ([web/decoder.js](web/decoder.js));
each server maps that URL to the node_modules artifact: vite via `resolve.alias`
([web/vite.config.mjs](web/vite.config.mjs)), `serve.js` via a route in
`resolveFile`. Node imports the bare specifier directly.

## Conventions

- CommonJS in Node code (`index.js`, `scripts/`); ES modules in the browser
  (`web/`). Both use `'use strict'`.
- The decoder boundary is always JSON strings; never pass structured data across
  the wasm call.
- Keep `web/decoder.js` and `index.js` behaviorally aligned — they wrap the same
  three wasm methods for two runtimes.
- License is GPL-3.0-only (matches the underlying library).
