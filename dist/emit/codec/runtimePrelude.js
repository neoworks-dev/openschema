// src/emit/codec/runtimePrelude.ts
// The fixed runtime that every generated codec file carries.
//
// Emitted as a string because the package ships no runtime library — every
// OpenSchema target produces one self-contained file. The trade-off is that this
// source is not typechecked by the package's own tsc, so the test suite executes
// the generated output and CI runs `tsc --noEmit` over it.
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

export class Writer {
  private bytes: number[] = [];

  raw(source: Uint8Array): void {
    for (let i = 0; i < source.length; i++) this.bytes.push(source[i]);
  }

  key(tag: number, wire: number): void {
    // Multiply rather than shift: tag << 3 overflows int32 above 2^28.
    this.varint(BigInt(tag) * 8n + BigInt(wire));
  }

  /** Plain two's-complement varint. Negative values always occupy 10 bytes. */
  varint(value: bigint): void {
    let remaining = BigInt.asUintN(64, value);
    while (true) {
      const septet = Number(remaining & 0x7fn);
      remaining >>= 7n;
      if (remaining === 0n) {
        this.bytes.push(septet);
        return;
      }
      this.bytes.push(septet | 0x80);
    }
  }

  double(value: number): void {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, true);
    this.raw(new Uint8Array(buffer));
  }

  lengthDelimited(body: Uint8Array): void {
    this.varint(BigInt(body.length));
    this.raw(body);
  }

  string(value: string): void {
    this.lengthDelimited(textEncoder.encode(value));
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
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

  varint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let consumed = 0; consumed < 10; consumed++) {
      this.require(1);
      const byte = this.buffer[this.position++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return BigInt.asUintN(64, result);
      shift += 7n;
    }
    throw new CodecError("OVERLONG_VARINT", this.path, "varint exceeds 10 bytes");
  }

  key(): number {
    const raw = this.varint();
    if (raw > 0xffffffffn) {
      throw new CodecError("BAD_TAG", this.path, "wire key exceeds 32 bits");
    }
    return Number(raw);
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
    const length = Number(this.varint());
    if (length < 0 || this.position + length > this.end) {
      throw new CodecError("TRUNCATED", this.path, "length-delimited field runs past the buffer");
    }
    const slice = this.buffer.subarray(this.position, this.position + length);
    this.position += length;
    return slice;
  }

  /** A bounded Reader over the next LEN field, one level deeper. */
  subMessage(path: string): Reader {
    if (this.depth + 1 > MAX_DEPTH) {
      throw new CodecError("DEPTH", path, "message nesting exceeds " + MAX_DEPTH);
    }
    const body = this.lengthDelimited();
    return new Reader(body, 0, body.length, this.depth + 1, path);
  }

  /** A bounded Reader over a packed repeated body. */
  packed(path: string): Reader {
    const body = this.lengthDelimited();
    return new Reader(body, 0, body.length, this.depth, path);
  }

  string(): string {
    try {
      return textDecoder.decode(this.lengthDelimited());
    } catch {
      throw new CodecError("BAD_UTF8", this.path, "field is not valid UTF-8");
    }
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.lengthDelimited());
  }

  /** Consume one field, returning key + body verbatim for unknown-field capture. */
  captureRaw(key: number, wire: number): Uint8Array {
    const start = this.position;
    this.skipBody(wire);
    const body = this.buffer.subarray(start, this.position);

    const keyWriter = new Writer();
    keyWriter.varint(BigInt(key));
    const keyBytes = keyWriter.finish();

    const raw = new Uint8Array(keyBytes.length + body.length);
    raw.set(keyBytes, 0);
    raw.set(body, keyBytes.length);
    return raw;
  }

  skipBody(wire: number): void {
    if (wire === WIRE_VARINT) { this.varint(); return; }
    if (wire === WIRE_I64) { this.require(8); this.position += 8; return; }
    if (wire === WIRE_I32) { this.require(4); this.position += 4; return; }
    if (wire === WIRE_LEN) { this.lengthDelimited(); return; }
    throw new CodecError("BAD_WIRE_TYPE", this.path, "unsupported wire type " + wire);
  }
}

// ── Scalar conversions ────────────────────────────────────────────────────────

export function toSigned(raw: bigint): bigint {
  return BigInt.asIntN(64, raw);
}

export function signedNumber(raw: bigint, path: string): number {
  const value = BigInt.asIntN(64, raw);
  if (value > 9007199254740991n || value < -9007199254740991n) {
    throw new CodecError("PRECISION", path, "integer exceeds the safe range for a JS number");
  }
  return Number(value);
}

export function unsignedNumber(raw: bigint, path: string): number {
  if (raw > 9007199254740991n) {
    throw new CodecError("PRECISION", path, "integer exceeds the safe range for a JS number");
  }
  return Number(raw);
}

export function requireUnsigned(value: number | bigint, path: string): bigint {
  const asBigInt = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  if (asBigInt < 0n) throw new CodecError("RANGE", path, "unsigned field cannot be negative");
  return asBigInt;
}

export function requireInteger(value: number, path: string): bigint {
  if (!Number.isFinite(value)) throw new CodecError("RANGE", path, "value is not finite");
  if (!Number.isInteger(value)) throw new CodecError("RANGE", path, "value is not an integer");
  return BigInt(value);
}

export function requireFinite(value: number, path: string): number {
  if (typeof value !== "number") throw new CodecError("TYPE", path, "expected a number");
  return value;
}

// ── uuid ──────────────────────────────────────────────────────────────────────

const HEX = "0123456789abcdef";

export function uuidToBytes(value: string, path: string): Uint8Array {
  const hex = value.replace(/-/g, "").toLowerCase();
  if (hex.length !== 32 || /[^0-9a-f]/.test(hex)) {
    throw new CodecError("BAD_UUID", path, "not a uuid: " + value);
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToUuid(bytes: Uint8Array, path: string): string {
  if (bytes.length !== 16) {
    throw new CodecError("BAD_UUID", path, "uuid must be 16 bytes, got " + bytes.length);
  }
  let hex = "";
  for (let i = 0; i < 16; i++) {
    hex += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  }
  return hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + hex.substring(12, 16) +
    "-" + hex.substring(16, 20) + "-" + hex.substring(20, 32);
}

// ── date / time / timestamp ───────────────────────────────────────────────────

const MS_PER_DAY = 86400000;

export function dateToDays(value: string, path: string): bigint {
  if (!/^-?\d{4,}-\d{2}-\d{2}$/.test(value)) {
    throw new CodecError("BAD_DATE", path, "expected YYYY-MM-DD, got " + value);
  }
  const ms = Date.parse(value + "T00:00:00.000Z");
  if (Number.isNaN(ms)) throw new CodecError("BAD_DATE", path, "invalid date " + value);
  return BigInt(Math.floor(ms / MS_PER_DAY));
}

export function daysToDate(days: bigint, path: string): string {
  const ms = Number(days) * MS_PER_DAY;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) throw new CodecError("BAD_DATE", path, "date out of range");
  return date.toISOString().substring(0, 10);
}

export function timestampToMillis(value: string, path: string): bigint {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new CodecError("BAD_TIMESTAMP", path, "invalid timestamp " + value);
  return BigInt(ms);
}

export function millisToTimestamp(ms: bigint, path: string): string {
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) throw new CodecError("BAD_TIMESTAMP", path, "timestamp out of range");
  return date.toISOString();
}

const NS_PER_SECOND = 1000000000n;

export function timeToNanos(value: string, path: string): bigint {
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/.exec(value);
  if (match === null) throw new CodecError("BAD_TIME", path, "expected HH:MM:SS[.fraction], got " + value);

  const hours = BigInt(match[1]);
  const minutes = BigInt(match[2]);
  const seconds = BigInt(match[3]);
  if (hours > 23n || minutes > 59n || seconds > 59n) {
    throw new CodecError("BAD_TIME", path, "time component out of range: " + value);
  }
  const fraction = BigInt((match[4] ?? "").padEnd(9, "0"));
  return ((hours * 3600n + minutes * 60n + seconds) * NS_PER_SECOND) + fraction;
}

export function nanosToTime(nanos: bigint, path: string): string {
  if (nanos < 0n || nanos >= 86400n * NS_PER_SECOND) {
    throw new CodecError("BAD_TIME", path, "time of day out of range");
  }
  const totalSeconds = nanos / NS_PER_SECOND;
  const fraction = nanos % NS_PER_SECOND;
  const hours = totalSeconds / 3600n;
  const minutes = (totalSeconds % 3600n) / 60n;
  const seconds = totalSeconds % 60n;

  const base = pad2(hours) + ":" + pad2(minutes) + ":" + pad2(seconds);
  if (fraction === 0n) return base;
  return base + "." + fraction.toString().padStart(9, "0");
}

function pad2(value: bigint): string {
  return value.toString().padStart(2, "0");
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
  const rawFraction = match[3] ?? "";

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
  const writer = new Writer();
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
  const list = into ?? [];
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

export function readVarintField(reader: Reader, wire: number, path: string): bigint {
  expectWire(wire, WIRE_VARINT, path);
  return reader.varint();
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

/** Accepts both the packed encoding and the unpacked one a writer may emit. */
export function readPackedVarint(reader: Reader, wire: number, path: string, into: bigint[]): void {
  if (wire === WIRE_LEN) {
    const body = reader.packed(path);
    while (body.hasMore()) into.push(body.varint());
    return;
  }
  into.push(readVarintField(reader, wire, path));
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