# Theengs sensorlog decoder — web app

Static browser app for decoding BLE advertisements, either from a sensorlogs
JSON file or live from a USB-serial scanner dongle. Four tabs:

- **File** — reads a sensorlogs-style JSON array, decodes each entry, and
  offers the decorated result as a download. Each entry gets a nested
  `decoded` field (`null` on no match); the original schema is preserved.
  A selector picks the decoder: **theengs** (TheengsDecoder WebAssembly,
  in-page) or **JSONata** (see below).
- **Serial/theengs** — connects a BLE scanner dongle via Web Serial
  (nRF Sniffer, adv2uart, OpenMQTTGateway serial; auto-detected) and decodes
  live advertisements with TheengsDecoder.
- **Serial/JSONata** — same dongle stack, but decodes with user-supplied
  JSONata expressions instead of TheengsDecoder.
- **BLE radio** — scans with the host's own radio via Web Bluetooth
  (opt-in with `?webble=true`).

## JSONata decoding

Decode devices TheengsDecoder doesn't know without touching C++: paste a pair
of [JSONata](https://jsonata.org/) expressions and press *Save expressions*.

- **Trigger expression** — a predicate evaluated against every advertisement
  object (fields like `id`, `mac`, `rssi`, `channel`, `advType`,
  `manufacturerdata`, `servicedata`, `name`). Truthy result → the entry is
  decoded; falsy (`false`, `null`, `undefined`, `0`, `""`) → undecoded.
- **Decoder expression** — evaluated against the same object when the trigger
  matched; its result is displayed (Serial/JSONata tab) or stored as the
  entry's `decoded` field (File tab).

Expressions are easiest to develop in the [JSONata sandbox](https://try.jsonata.org/) —
here is the full RuuviTag RAWv2 decoder with a sample advertisement:
<https://try.jsonata.org/uh4vIKxBh>.

Example — RuuviTag RAWv2 (this pair is prefilled on first visit):

```jsonata
$substring(manufacturerdata, 0, 4) = "9904"
```

```jsonata
(
  $payload := $substring(manufacturerdata, 4, 48);
  $temp_raw := $number("0x" & $substring($payload, 2, 4));
  {
    "model_id": "RuuviTag_RAWv2",
    "tempc": (($temp_raw > 32767) ? $temp_raw - 65536 : $temp_raw) * 0.005
  }
)
```

The pair is saved in `localStorage` and shared between the File and
Serial/JSONata tabs. Syntax errors are shown inline on save (invalid
expressions are not saved); runtime evaluation errors show as error rows and
scanning continues. The *Only decoded* checkbox hides non-matching
advertisements. The jsonata library is served from `node_modules` just like
the wasm — no copy in the repo.

## Run locally — no build step

```sh
cd nodejs/theengs-decoder
npm run web   # serves http://localhost:8000/
```

This uses the zero-dependency `serve.js`. The wasm bundle is served directly
from `node_modules/theengs-decoder/dist/theengs_decoder_wasm.mjs`, so just run
`npm install` first.

## Run locally — Vite dev server

```sh
cd nodejs/theengs-decoder
npm install        # first time only, pulls vite
npm run web:dev    # http://localhost:5173/
```

## Build a deployable static site

```sh
cd nodejs/theengs-decoder
npm run web:build     # writes web/dist/
npm run web:preview   # serves the built output at http://localhost:4173/
```

`web/dist/` is fully self-contained: `index.html`, a hashed `assets/app-*.js`,
and `theengs_decoder_wasm.js`. Drop the directory on any static host
(GitHub Pages, Netlify, Cloudflare Pages, S3, etc.) — no server-side code or
runtime dependencies needed.

## Deploy to a static host via rsync

```sh
cd nodejs/theengs-decoder
cp .env.example .env       # then edit DEPLOY_HOST, DEPLOY_PATH, DEPLOY_BASE, DEPLOY_URL
npm run deploy-web
```

`scripts/deploy-web.sh` runs `vite build` with the configured `--base`, writes
the output to `web/dist/`, and `rsync -avz --delete`s it to
`$DEPLOY_HOST:$DEPLOY_PATH`. Process environment variables override `.env`,
so one-offs work too:

```sh
DEPLOY_BASE=/preview/ DEPLOY_PATH=/var/www/preview/ npm run deploy-web
```

If your host runs sshd on a non-default port, set `DEPLOY_PORT` in `.env` (or
the environment).

Pass `--no-rsync` to build the deploy bundle without uploading:

```sh
npm run deploy-web -- --no-rsync
```
