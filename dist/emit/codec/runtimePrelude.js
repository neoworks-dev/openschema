// src/emit/codec/runtimePrelude.ts
// The fixed runtime that every generated codec file carries.
//
// Emitted as a string because the package ships no runtime library — every
// OpenSchema target produces one self-contained file. The trade-off is that this
// source is not typechecked by the package's own tsc, so the test suite executes
// the generated output and CI runs `tsc --noEmit` over it.
//
// Performance is a correctness-adjacent concern here: this code runs per row on
// a user's device, inside the encrypt/decrypt path. Three rules keep it honest:
//
//   - BigInt only where the value genuinely needs 64 bits (i64, u64, duration).
//     Field tags, lengths, and every scalar that fits in 2^53 use plain numbers.
//   - One growing Uint8Array per encode. Nested messages are written in place
//     and their length back-filled, rather than each building its own buffer.
//   - No allocation per primitive: floats go through one shared scratch view,
//     short strings are encoded and decoded by hand (TextEncoder/TextDecoder
//     cost a native call and a subarray per string), and the common date and
//     timestamp shapes are converted without touching Date.
//
// None of this changes a single emitted byte — codec-golden.test.ts pins the
// wire format against hardcoded vectors.
export const CODEC_RUNTIME = String.raw `
// ── Wire primitives ───────────────────────────────────────────────────────────

export const WIRE_VARINT = 0;
export const WIRE_I64 = 1;
export const WIRE_LEN = 2;
export const WIRE_I32 = 5;

/** Largest ordinal expressible as a wire tag. */
export const MAX_ORDINAL = 536870911;

/** Guards against a hostile buffer driving unbounded recursion. */
const MAX_DEPTH = 100;

/** Above this a double can no longer represent every integer exactly. */
const MAX_SAFE = 9007199254740991;

const TWO_TO_32 = 4294967296;

export interface UnknownField {
  tag: number;
  wire: number;
  /** Key varint plus body, so re-emission is a byte copy. */
  raw: Uint8Array;
}

export class CodecError extends Error {
  constructor(readonly code: string, readonly path: string, message: string) {
    super(path.length > 0 ? path + ": " + message : message);
    this.name = "CodecError";
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

// ── Manual UTF-8 ──────────────────────────────────────────────────────────────
//
// For short strings the native TextEncoder/TextDecoder round-trip (a subarray
// allocation plus a C++ boundary crossing per call) dominates the codec's
// profile. These produce byte-for-byte what TextEncoder produces, including
// U+FFFD for an unpaired surrogate.

function isSurrogatePair(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  if ((code & 0xfc00) !== 0xd800) return false;
  return (value.charCodeAt(index + 1) & 0xfc00) === 0xdc00;
}

function utf8Length(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) { length += 1; continue; }
    if (code < 0x800) { length += 2; continue; }
    if (isSurrogatePair(value, index)) { length += 4; index++; continue; }
    length += 3;
  }
  return length;
}

/** The caller has already reserved utf8Length(value) bytes at offset. */
function writeUtf8(bytes: Uint8Array, offset: number, value: string): void {
  let position = offset;
  for (let index = 0; index < value.length; index++) {
    let code = value.charCodeAt(index);
    if (code < 0x80) { bytes[position++] = code; continue; }
    if (code < 0x800) {
      bytes[position++] = 0xc0 | (code >> 6);
      bytes[position++] = 0x80 | (code & 0x3f);
      continue;
    }
    if (isSurrogatePair(value, index)) {
      code = 0x10000 + ((code & 0x3ff) << 10) + (value.charCodeAt(++index) & 0x3ff);
      bytes[position++] = 0xf0 | (code >> 18);
      bytes[position++] = 0x80 | ((code >> 12) & 0x3f);
      bytes[position++] = 0x80 | ((code >> 6) & 0x3f);
      bytes[position++] = 0x80 | (code & 0x3f);
      continue;
    }
    // An unpaired surrogate encodes as U+FFFD, exactly as TextEncoder does.
    if ((code & 0xf800) === 0xd800) code = 0xfffd;
    bytes[position++] = 0xe0 | (code >> 12);
    bytes[position++] = 0x80 | ((code >> 6) & 0x3f);
    bytes[position++] = 0x80 | (code & 0x3f);
  }
}

// ── Writer ────────────────────────────────────────────────────────────────────

/** Bytes a varint of this non-negative value occupies. */
function varintWidth(value: number): number {
  if (value < 0x80) return 1;
  if (value < 0x4000) return 2;
  if (value < 0x200000) return 3;
  if (value < 0x10000000) return 4;
  return 5;
}

function writeVarintAt(bytes: Uint8Array, offset: number, value: number): void {
  let position = offset;
  let remaining = value;
  while (remaining > 0x7f) {
    bytes[position++] = (remaining & 0x7f) | 0x80;
    remaining >>>= 7;
  }
  bytes[position] = remaining;
}

/**
 * The buffer of the last finished Writer, kept for the next one. Encoding is
 * synchronous and single-threaded, so at most one top-level Writer is live at
 * a time; a nested Writer (map keys) simply misses the pool while the outer
 * one holds it. Steady state: zero buffer allocations and zero grows per row.
 */
let pooledBuffer: Uint8Array | null = null;

/** Rows larger than this are rare enough that retaining the buffer is waste. */
const MAX_POOLED_CAPACITY = 65536;

export class Writer {
  private bytes: Uint8Array;
  /** Created on first float write — most messages never need one. */
  private view: DataView | null = null;
  private length = 0;

  constructor(capacity: number = 256) {
    if (pooledBuffer !== null && pooledBuffer.length >= capacity) {
      this.bytes = pooledBuffer;
      pooledBuffer = null;
      return;
    }
    this.bytes = new Uint8Array(capacity);
  }

  private reserve(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.bytes.length) return;

    let capacity = this.bytes.length * 2;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
    this.view = null;
  }

  raw(source: Uint8Array): void {
    const count = source.length;
    this.reserve(count);
    if (count <= 32) {
      // Typical sources are uuids and short bodies; a loop beats the native
      // set() call at this size.
      const bytes = this.bytes;
      let position = this.length;
      for (let index = 0; index < count; index++) bytes[position++] = source[index];
    } else {
      this.bytes.set(source, this.length);
    }
    this.length += count;
  }

  key(tag: number, wire: number): void {
    // Multiply rather than shift: tag << 3 overflows int32 above 2^28.
    this.varintNumber(tag * 8 + wire);
  }

  /**
   * The common path. Anything that fits in a double's integer range comes
   * through here; only i64/u64/duration need the BigInt variant below.
   */
  varintNumber(value: number): void {
    // Negatives are sign-extended to 64 bits, which is past the number range.
    if (value < 0) { this.varint(BigInt(value)); return; }

    this.reserve(10);
    const bytes = this.bytes;
    let position = this.length;
    let remaining = value;

    if (remaining <= 0x7fffffff) {
      while (remaining > 0x7f) {
        bytes[position++] = (remaining & 0x7f) | 0x80;
        remaining >>>= 7;
      }
    } else {
      // Bitwise operators coerce to int32, so anything wider has to use
      // arithmetic. Exact for every integer below 2^53.
      while (remaining > 0x7f) {
        bytes[position++] = (remaining % 128) | 0x80;
        remaining = Math.floor(remaining / 128);
      }
    }

    bytes[position++] = remaining;
    this.length = position;
  }

  /** Plain two's-complement varint. Negative values always occupy 10 bytes. */
  varint(value: bigint): void {
    if (value >= 0n && value <= 9007199254740991n) {
      this.varintNumber(Number(value));
      return;
    }

    this.reserve(10);
    const bytes = this.bytes;
    let position = this.length;
    let remaining = BigInt.asUintN(64, value);

    while (remaining > 0x7fn) {
      bytes[position++] = Number(remaining & 0x7fn) | 0x80;
      remaining >>= 7n;
    }
    bytes[position++] = Number(remaining);
    this.length = position;
  }

  double(value: number): void {
    this.reserve(8);
    if (this.view === null) this.view = new DataView(this.bytes.buffer);
    this.view.setFloat64(this.length, value, true);
    this.length += 8;
  }

  lengthDelimited(body: Uint8Array): void {
    this.varintNumber(body.length);
    this.raw(body);
  }

  string(value: string): void {
    // Short strings are the overwhelming case, and for them the native
    // TextEncoder round-trip (a subarray allocation plus a C++ call) costs more
    // than encoding by hand. Long strings still go through encodeInto.
    if (value.length >= 64) { this.longString(value); return; }

    const byteLength = utf8Length(value);
    this.varintNumber(byteLength);
    this.reserve(byteLength);
    writeUtf8(this.bytes, this.length, value);
    this.length += byteLength;
  }

  private longString(value: string): void {
    const lengthOffset = this.beginLengthDelimited();
    // A UTF-16 code unit never expands past 3 UTF-8 bytes: astral characters
    // arrive as two units and cost four, so 3x the length always fits.
    this.reserve(value.length * 3);
    const written = textEncoder.encodeInto(value, this.bytes.subarray(this.length)).written;
    this.length += written;
    this.endLengthDelimited(lengthOffset);
  }

  /**
   * Write a nested message body in place, then back-fill its length prefix.
   * The alternative — a fresh Writer per nesting level, copied back byte by
   * byte — is what made encoding slower than JSON.stringify.
   *
   * Generated code calls beginNested/endNested directly rather than passing a
   * closure here: a closure per present message field was the single largest
   * cost in the encode profile.
   */
  nested(write: (writer: Writer) => void): void {
    const lengthOffset = this.beginLengthDelimited();
    write(this);
    this.endLengthDelimited(lengthOffset);
  }

  beginNested(): number {
    return this.beginLengthDelimited();
  }

  endNested(lengthOffset: number): void {
    this.endLengthDelimited(lengthOffset);
  }

  /** Reserves one byte for the length, which covers bodies under 128 bytes. */
  private beginLengthDelimited(): number {
    this.reserve(1);
    const offset = this.length;
    this.length += 1;
    return offset;
  }

  private endLengthDelimited(lengthOffset: number): void {
    const bodyStart = lengthOffset + 1;
    const bodyLength = this.length - bodyStart;
    const width = varintWidth(bodyLength);

    if (width > 1) {
      // reserve() may replace the backing array, so re-read it afterwards.
      this.reserve(width - 1);
      this.bytes.copyWithin(bodyStart + width - 1, bodyStart, this.length);
      this.length += width - 1;
    }
    writeVarintAt(this.bytes, lengthOffset, bodyLength);
  }

  finish(): Uint8Array {
    const result = this.bytes.slice(0, this.length);
    const worthKeeping = this.bytes.length <= MAX_POOLED_CAPACITY &&
      (pooledBuffer === null || pooledBuffer.length < this.bytes.length);
    if (worthKeeping) pooledBuffer = this.bytes;
    return result;
  }
}

/** Encode a nested message body without a length prefix. */
export function subMessageBytes(write: (writer: Writer) => void): Uint8Array {
  const writer = new Writer();
  write(writer);
  return writer.finish();
}

// ── Reader ────────────────────────────────────────────────────────────────────

/** Shared float conversion area — cheaper than a DataView per read. */
const scratchBytes = new Uint8Array(8);
const scratchView = new DataView(scratchBytes.buffer);

function copyToScratch(buffer: Uint8Array, position: number, count: number): void {
  for (let index = 0; index < count; index++) {
    scratchBytes[index] = buffer[position + index];
  }
}

/**
 * null when any byte is non-ASCII; the caller falls back to TextDecoder.
 * Rope concatenation measures faster here than fromCharCode.apply and than
 * TextDecoder itself for the short fields that dominate real rows.
 */
function asciiString(buffer: Uint8Array, start: number, length: number): string | null {
  const end = start + length;
  for (let index = start; index < end; index++) {
    if (buffer[index] > 0x7f) return null;
  }
  let out = "";
  for (let index = start; index < end; index++) {
    out += String.fromCharCode(buffer[index]);
  }
  return out;
}

export class Reader {
  /** The last varint read, split into two 32-bit halves. */
  private lo = 0;
  private hi = 0;

  constructor(
    private readonly buffer: Uint8Array,
    private position: number,
    private readonly end: number,
    readonly depth: number,
    private readonly path: string,
  ) {}

  static of(bytes: Uint8Array, path: string): Reader {
    return new Reader(bytes, 0, bytes.length, 0, path);
  }

  hasMore(): boolean {
    return this.position < this.end;
  }

  private require(count: number): void {
    if (this.position + count > this.end) {
      throw new CodecError("TRUNCATED", this.path, "buffer ended mid-value");
    }
  }

  /**
   * Decode one varint into lo/hi without allocating. Bytes 1-4 fill the low 28
   * bits, byte 5 straddles the halves, bytes 6-10 fill the high word.
   */
  private readVarint64(): void {
    const buffer = this.buffer;
    const end = this.end;
    let position = this.position;
    let lo = 0;
    let hi = 0;
    let byte = 0;

    for (let shift = 0; shift < 28; shift += 7) {
      if (position >= end) throw this.truncated();
      byte = buffer[position++];
      lo |= (byte & 0x7f) << shift;
      if (byte < 0x80) { this.commitVarint(position, lo, 0); return; }
    }

    if (position >= end) throw this.truncated();
    byte = buffer[position++];
    lo |= (byte & 0x0f) << 28;
    hi = (byte & 0x7f) >> 4;
    if (byte < 0x80) { this.commitVarint(position, lo, hi); return; }

    for (let shift = 3; shift < 32; shift += 7) {
      if (position >= end) throw this.truncated();
      byte = buffer[position++];
      hi |= (byte & 0x7f) << shift;
      if (byte < 0x80) { this.commitVarint(position, lo, hi); return; }
    }
    throw new CodecError("OVERLONG_VARINT", this.path, "varint exceeds 10 bytes");
  }

  private commitVarint(position: number, lo: number, hi: number): void {
    this.position = position;
    this.lo = lo >>> 0;
    this.hi = hi >>> 0;
  }

  private truncated(): CodecError {
    return new CodecError("TRUNCATED", this.path, "buffer ended mid-value");
  }

  /** The raw 64-bit value, unsigned. Only for i64/u64/duration. */
  varint(): bigint {
    this.readVarint64();
    if (this.hi === 0) return BigInt(this.lo);
    return (BigInt(this.hi) << 32n) | BigInt(this.lo);
  }

  varintUnsigned(path: string): number {
    this.readVarint64();
    return unsignedFromHalves(this.lo, this.hi, path);
  }

  varintSigned(path: string): number {
    this.readVarint64();
    return signedFromHalves(this.lo, this.hi, path);
  }

  skipVarint(): void {
    this.readVarint64();
  }

  key(): number {
    this.readVarint64();
    if (this.hi !== 0) {
      throw new CodecError("BAD_TAG", this.path, "wire key exceeds 32 bits");
    }
    return this.lo;
  }

  /** A length prefix: non-negative and inside the remaining buffer. */
  private length(): number {
    this.readVarint64();
    const value = unsignedFromHalves(this.lo, this.hi, this.path);
    if (this.position + value > this.end) {
      throw new CodecError("TRUNCATED", this.path, "length-delimited field runs past the buffer");
    }
    return value;
  }

  double(): number {
    this.require(8);
    copyToScratch(this.buffer, this.position, 8);
    this.position += 8;
    return scratchView.getFloat64(0, true);
  }

  float32(): number {
    this.require(4);
    copyToScratch(this.buffer, this.position, 4);
    this.position += 4;
    return scratchView.getFloat32(0, true);
  }

  lengthDelimited(): Uint8Array {
    const length = this.length();
    const slice = this.buffer.subarray(this.position, this.position + length);
    this.position += length;
    return slice;
  }

  /**
   * A bounded Reader over the next LEN field, one level deeper. Bounds are
   * carried as offsets into the same buffer, so no slice is materialised.
   */
  subMessage(path: string): Reader {
    if (this.depth + 1 > MAX_DEPTH) {
      throw new CodecError("DEPTH", path, "message nesting exceeds " + MAX_DEPTH);
    }
    const length = this.length();
    const start = this.position;
    this.position += length;
    return new Reader(this.buffer, start, start + length, this.depth + 1, path);
  }

  /** A bounded Reader over a packed repeated body. */
  packed(path: string): Reader {
    const length = this.length();
    const start = this.position;
    this.position += length;
    return new Reader(this.buffer, start, start + length, this.depth, path);
  }

  string(): string {
    const length = this.length();
    const start = this.position;
    this.position += length;

    if (length <= 64) {
      const ascii = asciiString(this.buffer, start, length);
      if (ascii !== null) return ascii;
    }
    try {
      return textDecoder.decode(this.buffer.subarray(start, start + length));
    } catch {
      throw new CodecError("BAD_UTF8", this.path, "field is not valid UTF-8");
    }
  }

  bytes(): Uint8Array {
    return this.lengthDelimited().slice();
  }

  /** Consume one field, returning key + body verbatim for unknown-field capture. */
  captureRaw(key: number, wire: number): Uint8Array {
    const start = this.position;
    this.skipBody(wire);
    const bodyLength = this.position - start;

    const keyWidth = varintWidth(key);
    const raw = new Uint8Array(keyWidth + bodyLength);
    writeVarintAt(raw, 0, key);
    raw.set(this.buffer.subarray(start, this.position), keyWidth);
    return raw;
  }

  skipBody(wire: number): void {
    if (wire === WIRE_VARINT) { this.skipVarint(); return; }
    if (wire === WIRE_I64) { this.require(8); this.position += 8; return; }
    if (wire === WIRE_I32) { this.require(4); this.position += 4; return; }
    // Bound first: 'this.position += this.length()' would read position before
    // length() advances it past the prefix, discarding that advance.
    if (wire === WIRE_LEN) {
      const bodyLength = this.length();
      this.position += bodyLength;
      return;
    }
    throw new CodecError("BAD_WIRE_TYPE", this.path, "unsupported wire type " + wire);
  }
}

// ── Scalar conversions ────────────────────────────────────────────────────────

function unsignedFromHalves(lo: number, hi: number, path: string): number {
  // hi * 2^32 must stay below 2^53, so hi itself has to fit in 21 bits.
  if (hi > 0x1fffff) {
    throw new CodecError("PRECISION", path, "integer exceeds the safe range for a JS number");
  }
  return hi * TWO_TO_32 + lo;
}

function signedFromHalves(lo: number, hi: number, path: string): number {
  if ((hi & 0x80000000) === 0) return unsignedFromHalves(lo, hi, path);

  // Two's complement: negate the 64-bit pattern and report the magnitude.
  let negatedLo = (~lo + 1) >>> 0;
  let negatedHi = ~hi >>> 0;
  if (negatedLo === 0) negatedHi = (negatedHi + 1) >>> 0;

  const magnitude = negatedHi * TWO_TO_32 + negatedLo;
  if (magnitude > MAX_SAFE) {
    throw new CodecError("PRECISION", path, "integer exceeds the safe range for a JS number");
  }
  return -magnitude;
}

export function toSigned(raw: bigint): bigint {
  return BigInt.asIntN(64, raw);
}

export function requireUnsigned(value: number | bigint, path: string): bigint {
  const asBigInt = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  if (asBigInt < 0n) throw new CodecError("RANGE", path, "unsigned field cannot be negative");
  return asBigInt;
}

export function requireUnsignedNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) throw new CodecError("RANGE", path, "value is not finite");
  if (!Number.isInteger(value)) throw new CodecError("RANGE", path, "value is not an integer");
  if (value < 0) throw new CodecError("RANGE", path, "unsigned field cannot be negative");
  return value;
}

export function requireInteger(value: number, path: string): number {
  if (!Number.isFinite(value)) throw new CodecError("RANGE", path, "value is not finite");
  if (!Number.isInteger(value)) throw new CodecError("RANGE", path, "value is not an integer");
  return value;
}

export function requireFinite(value: number, path: string): number {
  if (typeof value !== "number") throw new CodecError("TYPE", path, "expected a number");
  return value;
}

// ── uuid ──────────────────────────────────────────────────────────────────────

const HEX = "0123456789abcdef";

/** 512 two-character strings, so formatting a uuid is 16 lookups and a join. */
const HEX_PAIRS: string[] = (() => {
  const pairs = new Array<string>(256);
  for (let i = 0; i < 256; i++) pairs[i] = HEX[i >> 4] + HEX[i & 15];
  return pairs;
})();

/** -1 for any character that is not a hex digit. */
const HEX_VALUES: Int8Array = (() => {
  const values = new Int8Array(128).fill(-1);
  for (let i = 0; i < 16; i++) {
    values[HEX.charCodeAt(i)] = i;
    values["0123456789ABCDEF".charCodeAt(i)] = i;
  }
  return values;
})();

export function uuidToBytes(value: string, path: string): Uint8Array {
  const out = new Uint8Array(16);
  let written = 0;
  let high = -1;

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 45) continue;   // '-'

    const digit = code < 128 ? HEX_VALUES[code] : -1;
    if (digit < 0 || written === 16) {
      throw new CodecError("BAD_UUID", path, "not a uuid: " + value);
    }
    if (high < 0) { high = digit; continue; }
    out[written++] = (high << 4) | digit;
    high = -1;
  }

  if (written !== 16 || high >= 0) {
    throw new CodecError("BAD_UUID", path, "not a uuid: " + value);
  }
  return out;
}

export function bytesToUuid(bytes: Uint8Array, path: string): string {
  if (bytes.length !== 16) {
    throw new CodecError("BAD_UUID", path, "uuid must be 16 bytes, got " + bytes.length);
  }
  return HEX_PAIRS[bytes[0]] + HEX_PAIRS[bytes[1]] + HEX_PAIRS[bytes[2]] + HEX_PAIRS[bytes[3]] + "-" +
    HEX_PAIRS[bytes[4]] + HEX_PAIRS[bytes[5]] + "-" +
    HEX_PAIRS[bytes[6]] + HEX_PAIRS[bytes[7]] + "-" +
    HEX_PAIRS[bytes[8]] + HEX_PAIRS[bytes[9]] + "-" +
    HEX_PAIRS[bytes[10]] + HEX_PAIRS[bytes[11]] + HEX_PAIRS[bytes[12]] +
    HEX_PAIRS[bytes[13]] + HEX_PAIRS[bytes[14]] + HEX_PAIRS[bytes[15]];
}

// ── date / time / timestamp ───────────────────────────────────────────────────

const MS_PER_DAY = 86400000;
const NS_PER_SECOND = 1000000000;

// Date and Date.parse dominate the encode/decode profile when every row
// carries timestamps, so the common shapes — YYYY-MM-DD and the exact
// toISOString form — are converted by hand. Anything else falls back to Date,
// with identical results.

/** Epoch days for 0000-01-01 and 9999-12-31, the four-digit-year window. */
const MIN_FOUR_DIGIT_DAY = -719528;
const MAX_FOUR_DIGIT_DAY = 2932896;
const MIN_FOUR_DIGIT_MS = MIN_FOUR_DIGIT_DAY * MS_PER_DAY;
const MAX_FOUR_DIGIT_MS = (MAX_FOUR_DIGIT_DAY + 1) * MS_PER_DAY - 1;

/** -1 unless both characters are digits. */
function twoDigits(value: string, index: number): number {
  const high = value.charCodeAt(index) - 48;
  const low = value.charCodeAt(index + 1) - 48;
  if (high < 0 || high > 9 || low < 0 || low > 9) return -1;
  return high * 10 + low;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/** Howard Hinnant's days_from_civil; exact for every proleptic Gregorian date. */
function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const monthIndex = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * monthIndex + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The inverse, packed as year * 10000 + month * 100 + day to avoid an allocation. */
function civilFromDays(days: number): number {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return year * 10000 + month * 100 + day;
}

/** Epoch days for a plain YYYY-MM-DD, or NaN when the shape or range is off. */
function parseIsoDate(value: string): number {
  const yearHigh = twoDigits(value, 0);
  const yearLow = twoDigits(value, 2);
  const month = twoDigits(value, 5);
  const day = twoDigits(value, 8);
  if (yearHigh < 0 || yearLow < 0 || month < 0 || day < 0) return NaN;
  if (value.charCodeAt(4) !== 45 || value.charCodeAt(7) !== 45) return NaN;

  const year = yearHigh * 100 + yearLow;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return NaN;
  return daysFromCivil(year, month, day);
}

export function dateToDays(value: string, path: string): number {
  if (value.length === 10) {
    const days = parseIsoDate(value);
    if (!Number.isNaN(days)) return days;
  }
  if (!/^-?\d{4,}-\d{2}-\d{2}$/.test(value)) {
    throw new CodecError("BAD_DATE", path, "expected YYYY-MM-DD, got " + value);
  }
  const ms = Date.parse(value + "T00:00:00.000Z");
  if (Number.isNaN(ms)) throw new CodecError("BAD_DATE", path, "invalid date " + value);
  return Math.floor(ms / MS_PER_DAY);
}

/** "00".."99", so zero-padding is a lookup instead of a padStart call. */
const TWO_DIGIT_STRINGS: string[] = (() => {
  const strings = new Array<string>(100);
  for (let value = 0; value < 100; value++) {
    strings[value] = String(Math.floor(value / 10)) + String(value % 10);
  }
  return strings;
})();

function formatIsoDate(packed: number): string {
  const year = Math.floor(packed / 10000);
  const month = Math.floor(packed / 100) % 100;
  const day = packed % 100;
  return TWO_DIGIT_STRINGS[Math.floor(year / 100)] + TWO_DIGIT_STRINGS[year % 100] + "-" +
    TWO_DIGIT_STRINGS[month] + "-" + TWO_DIGIT_STRINGS[day];
}

// Rows cluster by day (created/updated stamps share dates), so the last
// formatted day is worth one comparison.
let lastFormattedDays = NaN;
let lastFormattedDate = "";

function formatDateFromDays(days: number): string {
  if (days === lastFormattedDays) return lastFormattedDate;
  const formatted = formatIsoDate(civilFromDays(days));
  lastFormattedDays = days;
  lastFormattedDate = formatted;
  return formatted;
}

export function daysToDate(days: number, path: string): string {
  if (Number.isInteger(days) && days >= MIN_FOUR_DIGIT_DAY && days <= MAX_FOUR_DIGIT_DAY) {
    return formatDateFromDays(days);
  }
  const date = new Date(days * MS_PER_DAY);
  if (Number.isNaN(date.getTime())) throw new CodecError("BAD_DATE", path, "date out of range");
  return date.toISOString().substring(0, 10);
}

/** Epoch ms for the exact toISOString shape YYYY-MM-DDTHH:MM:SS.sssZ, else NaN. */
function parseIsoUtcTimestamp(value: string): number {
  if (value.length !== 24) return NaN;
  if (value.charCodeAt(10) !== 84 || value.charCodeAt(13) !== 58 || value.charCodeAt(16) !== 58 ||
      value.charCodeAt(19) !== 46 || value.charCodeAt(23) !== 90) return NaN;

  const days = parseIsoDate(value);
  const hours = twoDigits(value, 11);
  const minutes = twoDigits(value, 14);
  const seconds = twoDigits(value, 17);
  const millisHigh = twoDigits(value, 20);
  const millisLow = value.charCodeAt(22) - 48;
  if (Number.isNaN(days) || hours < 0 || minutes < 0 || seconds < 0 || millisHigh < 0) return NaN;
  if (millisLow < 0 || millisLow > 9) return NaN;
  if (hours > 23 || minutes > 59 || seconds > 59) return NaN;

  const secondOfDay = hours * 3600 + minutes * 60 + seconds;
  return days * MS_PER_DAY + secondOfDay * 1000 + millisHigh * 10 + millisLow;
}

export function timestampToMillis(value: string, path: string): number {
  const fast = parseIsoUtcTimestamp(value);
  if (!Number.isNaN(fast)) return fast;

  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new CodecError("BAD_TIMESTAMP", path, "invalid timestamp " + value);
  return ms;
}

export function millisToTimestamp(ms: number, path: string): string {
  if (Number.isInteger(ms) && ms >= MIN_FOUR_DIGIT_MS && ms <= MAX_FOUR_DIGIT_MS) {
    return formatIsoUtcTimestamp(ms);
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) throw new CodecError("BAD_TIMESTAMP", path, "timestamp out of range");
  return date.toISOString();
}

function formatIsoUtcTimestamp(ms: number): string {
  const days = Math.floor(ms / MS_PER_DAY);
  const msOfDay = ms - days * MS_PER_DAY;
  const secondOfDay = Math.floor(msOfDay / 1000);
  const millis = msOfDay - secondOfDay * 1000;
  const hours = Math.floor(secondOfDay / 3600);
  const minutes = Math.floor((secondOfDay % 3600) / 60);
  const seconds = secondOfDay % 60;

  return formatDateFromDays(days) + "T" +
    TWO_DIGIT_STRINGS[hours] + ":" + TWO_DIGIT_STRINGS[minutes] + ":" + TWO_DIGIT_STRINGS[seconds] + "." +
    TWO_DIGIT_STRINGS[Math.floor(millis / 10)] + String(millis % 10) + "Z";
}

export function timeToNanos(value: string, path: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/.exec(value);
  if (match === null) throw new CodecError("BAD_TIME", path, "expected HH:MM:SS[.fraction], got " + value);

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new CodecError("BAD_TIME", path, "time component out of range: " + value);
  }
  const fraction = Number((match[4] === undefined ? "" : match[4]).padEnd(9, "0"));
  return (hours * 3600 + minutes * 60 + seconds) * NS_PER_SECOND + fraction;
}

export function nanosToTime(nanos: number, path: string): string {
  if (nanos < 0 || nanos >= 86400 * NS_PER_SECOND) {
    throw new CodecError("BAD_TIME", path, "time of day out of range");
  }
  const totalSeconds = Math.floor(nanos / NS_PER_SECOND);
  const fraction = nanos - totalSeconds * NS_PER_SECOND;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const base = pad2(hours) + ":" + pad2(minutes) + ":" + pad2(seconds);
  if (fraction === 0) return base;
  return base + "." + String(fraction).padStart(9, "0");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

// ── decimal ───────────────────────────────────────────────────────────────────
//
// Canonical form: optional leading '-', no leading zeros beyond a single '0',
// exactly 'scale' fraction digits when scale > 0, no '+', no exponent, and -0
// normalized to 0. Two encoders must never disagree on the bytes for one value.

export function canonicalDecimal(value: string, precision: number, scale: number, path: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (match === null) throw new CodecError("BAD_DECIMAL", path, "not a decimal: " + value);

  const negative = match[1] === "-";
  const integerPart = match[2].replace(/^0+(?=\d)/, "");
  const rawFraction = match[3] === undefined ? "" : match[3];

  if (rawFraction.length > scale) {
    throw new CodecError("BAD_DECIMAL", path,
      "value has " + rawFraction.length + " fraction digits, scale is " + scale);
  }
  const fraction = scale > 0 ? rawFraction.padEnd(scale, "0") : "";

  const digits = integerPart === "0" ? fraction.replace(/0+$/, "").length : integerPart.length + scale;
  if (digits > precision) {
    throw new CodecError("BAD_DECIMAL", path, "value exceeds precision " + precision + ": " + value);
  }

  const magnitude = scale > 0 ? integerPart + "." + fraction : integerPart;
  const isZero = /^0(\.0*)?$/.test(magnitude);
  return negative && !isZero ? "-" + magnitude : magnitude;
}

// ── json (JCS-style canonicalization) ─────────────────────────────────────────
//
// JSON.stringify reorders integer-like object keys, so an uncanonicalized blob
// would not re-encode to the same bytes.

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonKeys(value));
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value === null || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) sorted[key] = sortJsonKeys(source[key]);
  return sorted;
}

export function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CodecError("BAD_JSON", path, "invalid JSON: " + (error as Error).message);
  }
}

// ── Maps ──────────────────────────────────────────────────────────────────────

export interface MapEntry<K, V> {
  key: K;
  value: V;
  keyBytes: Uint8Array;
}

/**
 * Sort by ENCODED key bytes, not JS string order. UTF-16 code-unit comparison
 * disagrees with UTF-8 byte order across the surrogate boundary, which is
 * reachable with emoji.
 */
export function sortMapEntries<K, V>(entries: MapEntry<K, V>[]): MapEntry<K, V>[] {
  return entries.sort((a, b) => compareBytes(a.keyBytes, b.keyBytes));
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export function stringKeyBytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function varintKeyBytes(value: bigint): Uint8Array {
  const writer = new Writer(16);
  writer.varint(value);
  return writer.finish();
}

// ── Unknown fields ────────────────────────────────────────────────────────────

/**
 * Sort captured unknown fields by tag so they can be interleaved into the known
 * fields' ascending order. Array.prototype.sort is stable, so several entries
 * sharing a tag keep their original relative order.
 */
export function prepareUnknown(
  unknown: UnknownField[] | undefined,
  known: ReadonlySet<number>,
  path: string,
): UnknownField[] {
  if (unknown === undefined || unknown.length === 0) return [];
  for (const field of unknown) {
    if (known.has(field.tag)) {
      throw new CodecError("UNKNOWN_COLLISION", path,
        "unknown field carries tag " + field.tag + ", which this message declares");
    }
  }
  return [...unknown].sort((a, b) => a.tag - b.tag);
}

/** Emit every pending unknown field whose tag precedes the given tag. */
export function flushUnknownBefore(
  writer: Writer,
  unknown: UnknownField[],
  index: number,
  tag: number,
): number {
  let cursor = index;
  while (cursor < unknown.length && unknown[cursor].tag < tag) {
    writer.raw(unknown[cursor].raw);
    cursor++;
  }
  return cursor;
}

export function flushUnknownRest(writer: Writer, unknown: UnknownField[], index: number): void {
  for (let cursor = index; cursor < unknown.length; cursor++) writer.raw(unknown[cursor].raw);
}

/**
 * Capture a field the schema does not declare. Retired tags are dropped instead:
 * they are known-dead, so preserving them would grow every row forever.
 */
export function captureUnknown(
  reader: Reader,
  key: number,
  tag: number,
  wire: number,
  into: UnknownField[] | undefined,
  retired: ReadonlySet<number>,
): UnknownField[] | undefined {
  if (retired.has(tag)) {
    reader.skipBody(wire);
    return into;
  }
  const raw = reader.captureRaw(key, wire);
  const list = into === undefined ? [] : into;
  list.push({ tag, wire, raw });
  return list;
}

export function missingField(path: string, name: string, tag: number): CodecError {
  return new CodecError("MISSING_FIELD", path, "required field '" + name + "' (tag " + tag + ") is absent");
}

export function expectWire(actual: number, expected: number, path: string): void {
  if (actual === expected) return;
  throw new CodecError("WIRE_MISMATCH", path, "expected wire type " + expected + ", got " + actual);
}

// ── Field readers ─────────────────────────────────────────────────────────────

/** For i64, u64 and duration, where 64 bits are genuinely needed. */
export function readVarintField(reader: Reader, wire: number, path: string): bigint {
  expectWire(wire, WIRE_VARINT, path);
  return reader.varint();
}

export function readSignedField(reader: Reader, wire: number, path: string): number {
  expectWire(wire, WIRE_VARINT, path);
  return reader.varintSigned(path);
}

export function readUnsignedField(reader: Reader, wire: number, path: string): number {
  expectWire(wire, WIRE_VARINT, path);
  return reader.varintUnsigned(path);
}

/**
 * f32 and f64 both encode as I64, so this normally reads a double. I32 is
 * accepted so payloads written before that rule stay readable.
 */
export function readDoubleField(reader: Reader, wire: number, path: string): number {
  if (wire === WIRE_I32) return reader.float32();
  expectWire(wire, WIRE_I64, path);
  return reader.double();
}

export function readStringField(reader: Reader, wire: number, path: string): string {
  expectWire(wire, WIRE_LEN, path);
  return reader.string();
}

export function readBytesField(reader: Reader, wire: number, path: string): Uint8Array {
  expectWire(wire, WIRE_LEN, path);
  return reader.bytes();
}

// Each accepts both the packed encoding and the unpacked one a writer may emit.

export function readPackedVarint(reader: Reader, wire: number, path: string, into: bigint[]): void {
  if (wire === WIRE_LEN) {
    const body = reader.packed(path);
    while (body.hasMore()) into.push(body.varint());
    return;
  }
  into.push(readVarintField(reader, wire, path));
}

export function readPackedSigned(reader: Reader, wire: number, path: string, into: number[]): void {
  if (wire === WIRE_LEN) {
    const body = reader.packed(path);
    while (body.hasMore()) into.push(body.varintSigned(path));
    return;
  }
  into.push(readSignedField(reader, wire, path));
}

export function readPackedUnsigned(reader: Reader, wire: number, path: string, into: number[]): void {
  if (wire === WIRE_LEN) {
    const body = reader.packed(path);
    while (body.hasMore()) into.push(body.varintUnsigned(path));
    return;
  }
  into.push(readUnsignedField(reader, wire, path));
}

export function readPackedDouble(reader: Reader, wire: number, path: string, into: number[]): void {
  if (wire === WIRE_LEN) {
    const body = reader.packed(path);
    while (body.hasMore()) into.push(body.double());
    return;
  }
  into.push(readDoubleField(reader, wire, path));
}
`;
//# sourceMappingURL=runtimePrelude.js.map