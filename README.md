# theengs-online-decoder

A standalone Node.js + browser app for decoding BLE advertisements from a wide
range of consumer sensors and devices, built on
[Theengs Decoder](https://decoder.theengs.io/).

The decoder runs as WebAssembly, so it requires no C++ toolchain. The wasm comes
from the `theengs-decoder` npm dependency.

## Install

```sh
bun install
```

## Usage (Node API)

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

The decoder runs as WebAssembly. The wasm module is provided by the
[`theengs-decoder`](https://www.npmjs.com/package/theengs-decoder) dependency
(`dist/theengs_decoder_wasm.mjs`) — there is no local build step and no C++
toolchain is required.

```sh
bun install
bun run test
```

See [web/README.md](web/README.md) for the browser app (file decode, Web Serial,
Web Bluetooth dongle drivers, and decoding with user-supplied
[JSONata](https://jsonata.org/) expressions as an alternative to the built-in
theengs decoders).

## License

GPL-3.0-only — same as the underlying Theengs Decoder.
