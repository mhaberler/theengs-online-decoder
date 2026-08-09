'use strict';

// Minimal zip reader for browser use: parses the central directory and inflates
// deflate entries via DecompressionStream. No zip64, no encryption.

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function findEocd(view) {
  const min = Math.max(0, view.byteLength - 65557);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

// Zip64 extended information (header id 0x0001) carries the real values for any
// field stored as 0xffffffff, in this order: uncompressed, compressed, offset.
function readZip64Extra(view, start, len, fields) {
  let p = start;
  const end = start + len;
  while (p + 4 <= end) {
    const id = view.getUint16(p, true);
    const size = view.getUint16(p + 2, true);
    if (id === 0x0001) {
      let q = p + 4;
      for (const key of ['uncompSize', 'compSize', 'localOffset']) {
        if (fields[key] !== 0xffffffff) continue;
        if (q + 8 > p + 4 + size) break;
        const value = view.getBigUint64(q, true);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('zip entry too large');
        fields[key] = Number(value);
        q += 8;
      }
      return fields;
    }
    p += 4 + size;
  }
  return fields;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Map<string, Uint8Array>>} entry name -> uncompressed bytes
 */
export async function readZipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.byteLength < 22) throw new Error('not a zip file (too short)');

  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');

  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) throw new Error('zip64 archives are not supported');

  const decoder = new TextDecoder();
  const out = new Map();
  let p = cdOffset;

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== SIG_CENTRAL) throw new Error('corrupt zip (bad central directory)');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const fields = readZip64Extra(view, p + 46 + nameLen, extraLen, {
      compSize: view.getUint32(p + 20, true),
      uncompSize: view.getUint32(p + 24, true),
      localOffset: view.getUint32(p + 42, true),
    });
    const { compSize, localOffset } = fields;
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (flags & 0x1) throw new Error(`encrypted zip entry: ${name}`);
    if (compSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error(`zip entry ${name} is missing zip64 size information`);
    }
    if (view.getUint32(localOffset, true) !== SIG_LOCAL) throw new Error(`corrupt zip (bad local header for ${name})`);

    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(start, start + compSize);

    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflateRaw(data));
    else throw new Error(`unsupported compression method ${method} in ${name}`);
  }

  return out;
}
