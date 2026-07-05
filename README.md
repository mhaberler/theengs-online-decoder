# theengs-online-decoder

Browser app for decoding BLE advertisements from a wide range of consumer
sensors and devices, built on [Theengs Decoder](https://decoder.theengs.io/) —
plus a small Node.js API around the same decoder.

The decoder runs as WebAssembly, so it requires no C++ toolchain. The wasm
comes from the `theengs-decoder` npm dependency.

Live instance: <https://mhaberler.github.io/theengs-online-decoder/>

## Web app

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

The dongle connection is shared between the serial tabs: connect and start a
scan once, then switch tabs to compare theengs and JSONata decoding of the
same live traffic. Web Serial requires Chrome/Edge (or another Chromium
browser); Firefox users can still use the File tab.

### Supported dongles

*Auto-detect* probes the connected dongle and picks the matching driver; a
profile can also be selected manually.

- **Nordic nRF Sniffer for BLE** — an nRF52840 dongle/DK flashed with Nordic's
  [sniffer firmware](https://www.nordicsemi.com/Products/Development-tools/nRF-Sniffer-for-Bluetooth-LE).
  Binary SLIP-framed UART protocol at 1 Mbaud with hardware flow control;
  reports channel, RSSI, PHY and full PDUs, including extended advertising
  (BLE 5 `ADV_EXT_IND`).
- **adv2uart** — an ESP32-C3 running the
  [ADV_BLE2UART](https://github.com/Ircama/ADV_BLE2UART) scanner firmware.
  CRC-checked binary frames over USB-serial at 115200; scan parameters
  (window, active scan, …) are adjustable live from the driver controls shown
  after connect.
- **OpenMQTTGateway (OMG) serial gateway** — any ESP32 running
  [OpenMQTTGateway](https://docs.openmqttgateway.com/) with the serial
  gateway enabled. Text protocol: the `/BTtoMQTT` advertisement JSON lines are
  read straight off the log output; profiles exist for 9600/115200/921600 baud.

**To add a dongle driver:** create a factory in `web/drivers/`, append it to
`driverFactories` in `web/drivers/index.js`, and follow the interface
documented in the comment block at the top of that file.

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

The pair is saved in `localStorage` and shared between the File and
Serial/JSONata tabs. Syntax errors are shown inline on save (invalid
expressions are not saved); runtime evaluation errors show as error rows and
scanning continues. The *Only decoded* checkbox hides non-matching
advertisements. The jsonata library is served from `node_modules` just like
the wasm — no copy in the repo.

Expressions are easiest to develop in the [JSONata sandbox](https://try.jsonata.org/) —
here is the full RuuviTag RAWv2 decoder with a sample advertisement:
<https://try.jsonata.org/uh4vIKxBh>.

### Example — RuuviTag RAWv2

This pair is prefilled on first visit.

Input advertisement:

```json
{
  "manufacturerdata": "99040511ea490cbfdd002400000400a296b64a16d4155c775668"
}
```

Trigger expression (Ruuvi's manufacturer ID `0x0499`, little-endian on air):

```jsonata
$substring(manufacturerdata, 0, 4) = "9904"
```

Decoder expression:

```jsonata
(
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
)
```

Result:

```json
{
  "id": "D4:15:5C:77:56:68",
  "name": "Ruuvi 5668",
  "brand": "Ruuvi",
  "model": "RuuviTag",
  "model_id": "RuuviTag_RAWv2",
  "type": "ACEL",
  "tempc": 22.93,
  "tempf": 73.274,
  "accx": 0.036,
  "accy": 0,
  "accz": 1.024,
  "volt": 2.9,
  "tx": 4,
  "mov": 182,
  "seq": 18966,
  "mac": "D4:15:5C:77:56:68"
}
```

## Install

```sh
bun install
```

## Run the web app locally

No build step (zero-dependency `serve.js`; wasm and jsonata are served
straight from `node_modules`):

```sh
bun run web        # http://localhost:8000/
```

Vite dev server:

```sh
bun run web:dev    # http://localhost:5173/
```

## Build a deployable static site

```sh
bun run web:build     # writes web/dist/
bun run web:preview   # serves the built output at http://localhost:4173/
```

`web/dist/` is fully self-contained. Drop the directory on any static host
(GitHub Pages, Netlify, Cloudflare Pages, S3, etc.) — no server-side code or
runtime dependencies needed. Pushing a `v*` tag deploys to GitHub Pages via
the workflow in `.github/workflows/`.

## Deploy to a static host via rsync

```sh
cp .env.example .env       # then edit DEPLOY_HOST, DEPLOY_PATH, DEPLOY_BASE, DEPLOY_URL
bun run deploy-web
```

`scripts/deploy-web.sh` runs `vite build` with the configured `--base`, writes
the output to `web/dist/`, and `rsync -avz --delete`s it to
`$DEPLOY_HOST:$DEPLOY_PATH`. Process environment variables override `.env`,
so one-offs work too:

```sh
DEPLOY_BASE=/preview/ DEPLOY_PATH=/var/www/preview/ bun run deploy-web
```

If your host runs sshd on a non-default port, set `DEPLOY_PORT` in `.env` (or
the environment).

Pass `--no-rsync` to build the deploy bundle without uploading:

```sh
bun run deploy-web -- --no-rsync
```

## Node API

```js
const { decodeBLE, getProperties, getAttribute } = require('.');

const decoded = await decodeBLE({
  servicedata: '71205d0183d20c6d8d7cc40d08100103',
});
// → { brand: 'Xiaomi', model: 'RoPot', model_id: 'HHCCPOT002', moi: 3, mac: 'C4:7C:8D:6D:0C:D2', ... }

const props = await getProperties('HHCCPOT002');
const brand = await getAttribute('HHCCPOT002', 'brand');
```

`decodeBLE` accepts either an object or a JSON string and returns the
decoded device information, or `null` if no decoder matched.

A `ready()` function is also exported; awaiting it pre-loads the WebAssembly
module so the first hot-path call doesn't pay the load cost.

## WebAssembly

The wasm module is provided by the
[`theengs-decoder`](https://www.npmjs.com/package/theengs-decoder) dependency
(`dist/theengs_decoder_wasm.mjs`) — there is no local build step and no C++
toolchain is required.

```sh
bun install
bun run test
```

## License

GPL-3.0-only — same as the underlying Theengs Decoder.
