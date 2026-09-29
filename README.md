# theengs-online-decoder

Browser app for decoding BLE advertisements from a wide range of consumer
sensors and devices, built on [Theengs Decoder](https://decoder.theengs.io/) —
plus a small Node.js API around the same decoder.

The decoder runs as WebAssembly, so it requires no C++ toolchain. The wasm
comes from the `theengs-decoder` npm dependency.

Live instance: <https://mhaberler.github.io/theengs-online-decoder/>

## Web app

Static browser app for decoding BLE advertisements, either from a sensorlogs
JSON file or live from a USB-serial scanner dongle. Five tabs:

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
- **Serial/sensor-ble** — same dongle stack, decoding with
  [sensor-ble](https://github.com/tszheichoi/sensor-ble) (see below).
- **BLE radio** — scans with the host's own radio via Web Bluetooth
  (opt-in with `?webble=true`).

The dongle connection is shared between the serial tabs: connect and start a
scan once, then switch tabs to compare theengs, JSONata and sensor-ble decoding
of the same live traffic. Web Serial requires Chrome/Edge (or another Chromium
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

## sensor-ble decoding

The **Serial/sensor-ble** tab decodes live dongle traffic with
[sensor-ble](https://github.com/tszheichoi/sensor-ble), the decoder library
behind [Sensor Logger](https://www.tszheichoi.com/sensorlogger), instead of
TheengsDecoder. It runs in-page like the other decoders — the library is pure
dependency-free JavaScript, so only a small `Buffer` shim
([web/buffer-shim.js](web/buffer-shim.js)) is needed to run its Node-oriented
decoders in the browser.

Only sensor-ble's **advertising-based** decoders are used: `ruuvi`, `airpods`,
`bthome`, `mopeka`, `xiaomi_atc`, `mikrotik` and `qingping`. Its streaming
decoders (heart rate, cycling power/speed, Muse, WitMotion) need a GATT
connection, which a passive scanner dongle cannot provide, and are filtered out.

Matching follows the library's own rule — local name, then manufacturer ID,
then service UUID — so a decoder matches here exactly as it does under
sensor-ble's Node harness.

### Custom decoders

Decoders can be installed at runtime from a URL, the same way Sensor Logger
loads them. Paste the URL of a self-contained ES module that exports a
`decoder` object (see the
[sensor-ble API](https://github.com/tszheichoi/sensor-ble#sensor-ble-api))
and press **Install**. A GitHub Gist works well — use the **raw** file URL; a
`.../blob/...` link returns HTML and is rejected.

- Installed decoders are cached in `localStorage` (URL *and* source) and
  re-registered on every load, so they keep working offline.
- **Reload** re-fetches from the original URL — push a change to the gist, press
  Reload, and the new version replaces the old one.
- A decoder whose `decoderName` matches a built-in **replaces** it; the list
  marks it as overriding. Removing it restores the built-in.
- Decoders without an `advertisementDecode` function are rejected, since this
  tab never connects.

> Only install decoders from sources you trust: the fetched code runs in the
> page, like any other script on it.

### Theengs as a sensor-ble decoder

[sensor-ble-decoders/theengs.js](sensor-ble-decoders/theengs.js) is a custom
decoder that wraps TheengsDecoder: any advertisement Theengs knows decodes to
its JSON (`brand`, `model`, `model_id`, measurements…). It declares no
`manufacturer`/`serviceUUID`; instead `matchAll: true` makes this tab offer it
every advertisement, **after** all other decoders, so it acts as a fallback.
Output varies per device, hence `variableFormat: true`. The file is generated —
the theengs-decoder wasm is inlined and its Node code patched out, so it obeys
Sensor Logger's sandbox (no `import`/`require`) — and committed so it can be
published as a gist:

```sh
bun run build-sensorble-theengs   # regenerate after a theengs-decoder bump
```

Install it via the raw URL of wherever you publish it. Sensor Logger doesn't
know `matchAll`, so there the decoder installs but never matches.

### Publishing decoders as gists

`bun run publish-gist` publishes selected files from `sensor-ble-decoders/` as
**secret**, single-file gists and prints the raw URL to paste into Sensor
Logger or the Serial/sensor-ble tab. It needs the [GitHub CLI](https://cli.github.com/)
logged in with the `gist` scope (`gh auth login`).

```sh
bun run publish-gist theengs.js            # create or update; prints raw URLs
bun run publish-gist theengs.js other.js   # several at once
```

```text
theengs.js
  raw:    https://gist.githubusercontent.com/<user>/<id>/raw/theengs.js
  pinned: https://gist.githubusercontent.com/<user>/<id>/raw/<revision>/theengs.js
```

- Re-publishing **updates the same gist**, so the unpinned `raw` URL stays
  valid and **Reload** (tab) / refresh (Sensor Logger) picks up the new version.
  The `pinned` URL always serves that exact revision.
- Generated decoders (`theengs.js`) are regenerated before upload.
- The name → gist id map is kept in `.gists.json` (untracked). If it's lost,
  the gist is found again by its description,
  `sensor-ble decoder: <name> (theengs-online-decoder)`.
- "Secret" means unlisted, not private: anyone with the URL can read it (and
  the sources are public in this repo anyway).

Handy `gh` commands:

```sh
gh gist list --secret                      # your secret gists
gh gist view <id> --files                  # files in a gist
gh gist view <id> --raw -f theengs.js      # print a published file
gh gist delete <id>                        # unpublish — also drop its entry from .gists.json
```

## Mobile app (Sensor-BLE)

[app/](app/) is a Capacitor app for iOS and Android: the Serial/sensor-ble and
Serial/JSONata tabs running on the **phone's own BLE radio** instead of a
dongle, both fed by one scan. It reuses the web modules directly (log view,
sensor-ble decoding, custom decoder install, JSONata expressions), so built-in
decoders, decoders installed from a URL — including the
[Theengs decoder](#theengs-as-a-sensor-ble-decoder) gist — and JSONata
expression pairs work as in the browser. Installed decoders and saved
expressions are stored with `@capacitor/preferences` and keep working offline.
Phone scans report 16-bit service UUIDs in the dongle form (`"0xfcd2"`), so
JSONata expressions written against dongle traffic match unchanged.

```sh
bun install                 # repo root (sensor-ble lives here)
cd app && bun install
bun run sync                # vite build + cap sync
bun run run-android         # build + install on the configured Android device
bun run run-ios             # build + install on the configured iPhone
bun run debug-android       # same, with live reload from the vite dev server
bun run open-ios            # open in Xcode (signing, other devices)
```

The `run-*` scripts target specific devices (`--target` in
[app/package.json](app/package.json)); change them for yours
(`bunx cap run android --list`). iOS signing uses the development team set in
the Xcode project.

### Signed release builds (GitHub Actions)

[.github/workflows/app-release.yml](.github/workflows/app-release.yml) builds a
signed **IPA** (App Store Connect distribution), a signed **APK** (sideload)
and an **AAB** (Play) — no fastlane:

- **iOS:** unsigned `xcodebuild archive`, then `-exportArchive
  -allowProvisioningUpdates` with an App Store Connect API key. Xcode's
  automatic signing fetches the profile and uses Apple's cloud-managed
  distribution certificate, so no certificates or profiles are stored anywhere.
- **Android:** plain Gradle `assembleRelease bundleRelease`; the release
  `signingConfig` in [app/android/app/build.gradle](app/android/app/build.gradle)
  reads the keystore from `ANDROID_KEYSTORE_*` env vars (unsigned when unset).
- **Versions:** `versionName`/`MARKETING_VERSION` from the tag (or
  `app/package.json`), `versionCode`/`CURRENT_PROJECT_VERSION` = run number.

| Trigger | Result |
|---|---|
| tag `app-v0.1.0` | IPA uploaded to TestFlight; IPA + APK + AAB attached to a GitHub Release |
| *Run workflow* (dispatch) | IPA + APK + AAB as workflow artifacts |

`app-v*` keeps app releases separate from the web/library `v*` tags.

One-time setup:

1. Create the app record for `com.haberler.sensorble` in App Store Connect
   (the API can't create apps; the bundle ID is registered automatically).
2. An App Store Connect API key with the **Admin** role (Users and Access →
   Integrations → App Store Connect API → Team Keys). Only Admin keys may use
   cloud-managed distribution certificates; an App Manager key fails export
   with "Cloud signing permission error".
3. Fill in the app-signing block of `.env` (see [.env.example](.env.example))
   and push the secrets into the repo — the script only pipes the values to
   `gh secret set`, it never prints them:

   ```sh
   scripts/sync-app-secrets.sh --env-file .env   # or --repo owner/name, --ios-only, --android-only
   ```

   The same variables can come from the process environment instead.

Release: `git tag app-v0.1.0 && git push origin app-v0.1.0`.

Platform limits:
- **iOS** hides MAC addresses (the id is a per-phone UUID), so decoders that
  need the MAC fail; iOS also strips iBeacon advertisements, and scanning is
  foreground-only.
- **Android** requests location permission too (asserting "never for
  location" would filter some beacons), and returns no scan results while
  system location is off — the app then offers a button to open location
  settings.

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
toolchain is required. The one copy is the generated
[sensor-ble-decoders/theengs.js](sensor-ble-decoders/theengs.js), which inlines
it (see [Theengs as a sensor-ble decoder](#theengs-as-a-sensor-ble-decoder)).

```sh
bun install
bun run test
```

## License

GPL-3.0-only — same as the underlying Theengs Decoder.
