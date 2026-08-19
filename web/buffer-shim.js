'use strict';

// Browser stand-in for the Node `Buffer` the sensor-ble decoders expect. They
// are otherwise dependency-free, but call Buffer read/slice/toString methods on
// the advertisement payloads. This covers exactly what the decoders use — both
// the bundled ones and user-installed custom decoders, which run against the
// same `Buffer` global Sensor Logger provides in its own sandbox.
//
// Subclassing Uint8Array keeps indexing (`data[0]`), `.length` and iteration
// working for free; slice/subarray inherit and return BufferShim instances.

class BufferShim extends Uint8Array {
  get #view() {
    return new DataView(this.buffer, this.byteOffset, this.byteLength);
  }

  readUInt8(off = 0) { return this.#view.getUint8(off); }
  readInt8(off = 0) { return this.#view.getInt8(off); }
  readUInt16BE(off = 0) { return this.#view.getUint16(off, false); }
  readUInt16LE(off = 0) { return this.#view.getUint16(off, true); }
  readInt16BE(off = 0) { return this.#view.getInt16(off, false); }
  readInt16LE(off = 0) { return this.#view.getInt16(off, true); }
  readUInt32BE(off = 0) { return this.#view.getUint32(off, false); }
  readUInt32LE(off = 0) { return this.#view.getUint32(off, true); }
  readInt32BE(off = 0) { return this.#view.getInt32(off, false); }
  readInt32LE(off = 0) { return this.#view.getInt32(off, true); }

  // Node aliases (bthome.js and others use the lowercase-i spellings).
  readUint8(off = 0) { return this.readUInt8(off); }
  readUint16BE(off = 0) { return this.readUInt16BE(off); }
  readUint16LE(off = 0) { return this.readUInt16LE(off); }
  readUint32BE(off = 0) { return this.readUInt32BE(off); }
  readUint32LE(off = 0) { return this.readUInt32LE(off); }

  // Variable-width little-endian ints (BTHome packs 1..4-byte values).
  readUIntLE(off, byteLength) {
    let v = 0;
    for (let i = byteLength - 1; i >= 0; i--) v = v * 256 + this[off + i];
    return v;
  }

  readIntLE(off, byteLength) {
    const v = this.readUIntLE(off, byteLength);
    const half = 2 ** (byteLength * 8 - 1);
    return v >= half ? v - half * 2 : v;
  }

  readUIntBE(off, byteLength) {
    let v = 0;
    for (let i = 0; i < byteLength; i++) v = v * 256 + this[off + i];
    return v;
  }

  readIntBE(off, byteLength) {
    const v = this.readUIntBE(off, byteLength);
    const half = 2 ** (byteLength * 8 - 1);
    return v >= half ? v - half * 2 : v;
  }

  // Node's Buffer#slice aliases subarray (a view, not a copy); Uint8Array#slice
  // copies. Decoders only read, so the distinction is invisible to them, but
  // matching Node avoids surprising a decoder ported straight from the harness.
  slice(start, end) { return this.subarray(start, end); }

  toString(encoding = 'utf8', start = 0, end = this.length) {
    const part = this.subarray(start, end);
    if (encoding === 'hex') {
      let s = '';
      for (const b of part) s += b.toString(16).padStart(2, '0');
      return s;
    }
    return new TextDecoder(encoding === 'utf8' || encoding === 'utf-8' ? 'utf-8' : encoding).decode(part);
  }

  equals(other) {
    if (this.length !== other.length) return false;
    for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false;
    return true;
  }

  static from(value, encoding) {
    if (typeof value === 'string') {
      if (encoding === 'hex') {
        const clean = value.length % 2 ? '0' + value : value;
        const out = new BufferShim(clean.length / 2);
        for (let i = 0; i < out.length; i++) {
          out[i] = parseInt(clean.substr(i * 2, 2), 16);
        }
        return out;
      }
      return new BufferShim(new TextEncoder().encode(value));
    }
    return new BufferShim(Uint8Array.from(value));
  }

  static alloc(size) { return new BufferShim(size); }

  static concat(list, total) {
    const len = total ?? list.reduce((n, b) => n + b.length, 0);
    const out = new BufferShim(len);
    let off = 0;
    for (const b of list) {
      if (off >= len) break;
      out.set(b.subarray(0, Math.min(b.length, len - off)), off);
      off += b.length;
    }
    return out;
  }

  static isBuffer(b) { return b instanceof BufferShim; }
}

// The decoders reference a bare `Buffer`, so it has to be global. Never clobber
// a real one (e.g. under a bundler that already polyfilled it).
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = BufferShim;
}

export { BufferShim as Buffer };

export function hexToBuffer(hex) {
  return BufferShim.from(hex, 'hex');
}
