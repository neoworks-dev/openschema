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
//   - No allocation per primitive: a DataView is kept alongside the buffer, and
//     strings are written straight into it with TextEncoder.encodeInto.
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

export class Writer {
  private bytes: Uint8Array;
  private view: DataView;
  private length = 0;

  constructor(capacity: number = 256) {
    this.bytes = new Uint8Array(capacity);
    this.view = new DataView(this.bytes.buffer);
  }

  private reserve(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.bytes.length) return;

    let capacity = this.bytes.length * 2;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
    this.view = new DataView(grown.buffer);
  }

  raw(source: Uint8Array): void {
    this.reserve(source.length);
    this.bytes.set(source, this.length);
    this.length += source.length;
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
    this.view.setFloat64(this.length, value, true);
    this.length += 8;
  }

  lengthDelimited(body: Uint8Array): void {
    this.varintNumber(body.length);
    this.raw(body);
  }

  string(value: string): void {
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
   */
  nested(write: (writer: Writer) => void): void {
    const lengthOffset = this.beginLengthDelimited();
    write(this);
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
    return this.bytes.slice(0, this.length);
  }
}

/** Encode a nested message body without a length prefix. */
export function subMessageBytes(write: (writer: Writer) => void): Uint8Array {
  const writer = new Writer();
  write(writer);
  return writer.finish();
}

// ── Reader ────────────────────────────────────────────────────────────────────

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
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.position, 8);
    this.position += 8;
    return view.getFloat64(0, true);
  }

  float32(): number {
    this.require(4);
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.position, 4);
    this.position += 4;
    return view.getFloat32(0, true);
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

export function dateToDays(value: string, path: string): number {
  if (!/^-?\d{4,}-\d{2}-\d{2}$/.test(value)) {
    throw new CodecError("BAD_DATE", path, "expected YYYY-MM-DD, got " + value);
  }
  const ms = Date.parse(value + "T00:00:00.000Z");
  if (Number.isNaN(ms)) throw new CodecError("BAD_DATE", path, "invalid date " + value);
  return Math.floor(ms / MS_PER_DAY);
}

export function daysToDate(days: number, path: string): string {
  const date = new Date(days * MS_PER_DAY);
  if (Number.isNaN(date.getTime())) throw new CodecError("BAD_DATE", path, "date out of range");
  return date.toISOString().substring(0, 10);
}

export function timestampToMillis(value: string, path: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new CodecError("BAD_TIMESTAMP", path, "invalid timestamp " + value);
  return ms;
}

export function millisToTimestamp(ms: number, path: string): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) throw new CodecError("BAD_TIMESTAMP", path, "timestamp out of range");
  return date.toISOString();
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