// src/emit/codec/wireFormat.ts
// The binary wire format, as data. No string emission lives here.
//
// This module is the single source of truth for how a schema type is encoded.
// The codec emitter generates code from it, and the ordinal ledger records the
// encoding signature it produces — if the two disagreed, the ledger's OS2010
// check would be validating a format the codec does not actually write.
//
// The normative prose version is docs/wire-format.md.

import type { ScalarKind, TypeExpr } from "../../parser/ast.js";
import type { ResolvedSchema } from "../../resolver/types.js";
import { aliasByLocalName, modelByLocalName, resolveAliasInline } from "../typeMapping.js";

// ── Tags ──────────────────────────────────────────────────────────────────────

/** Wire tags are `ordinal * 8 + wireType`; ordinals above this overflow int32. */
export const MAX_ORDINAL = 536870911;
export const MIN_ORDINAL = 1;

/**
 * Reserved for a future per-company overlay envelope: repeated LEN, each entry
 * `{1: companyId, 2..N: that overlay's own ordinal space}`. Nothing emits it
 * yet; the tag is spoken for so overlay support stays purely additive.
 */
export const OVERLAY_ENVELOPE_TAG = MAX_ORDINAL;

export enum WireType {
  Varint = 0,
  I64    = 1,
  Len    = 2,
  // 3 (SGROUP) and 4 (EGROUP) are never emitted and rejected on decode.
  I32    = 5, // decode-only: pre-existing f32 payloads
}

// ── Scalars ───────────────────────────────────────────────────────────────────
//
// Integers all use plain two's-complement varint, never zigzag. Every widening
// in type-compat's NUMERIC_WIDENS (i8:i64, u32:i64, u8:i16, …) is then a
// byte-level no-op; zigzag would silently corrupt them. Cost: negative values
// always occupy the full 10-byte sign-extended form.
//
// f32 and f64 both encode as I64 doubles. Wire-type dispatch cannot rescue a
// packed repeated f32: an 8-byte body is both two f32s and one f64, with nothing
// in the encoding to disambiguate. One representation per numeric family keeps
// f32:f64 a no-op like the integer widenings.

export const SCALAR_WIRE: Record<ScalarKind, WireType> = {
  bool:      WireType.Varint,
  i8:        WireType.Varint,
  i16:       WireType.Varint,
  i32:       WireType.Varint,
  i64:       WireType.Varint,
  u8:        WireType.Varint,
  u16:       WireType.Varint,
  u32:       WireType.Varint,
  u64:       WireType.Varint,
  f32:       WireType.I64,
  f64:       WireType.I64,
  string:    WireType.Len,
  bytes:     WireType.Len,
  uuid:      WireType.Len,
  json:      WireType.Len,
  date:      WireType.Varint,
  time:      WireType.Varint,
  timestamp: WireType.Varint,
  duration:  WireType.Varint,
};

/**
 * The TypeScript type the codec uses for each scalar. Deliberately diverges from
 * SCALAR_TS in the typescript emitter: 64-bit integers must be bigint, because
 * `number` silently loses precision above 2^53.
 */
export const SCALAR_CODEC_TS: Record<ScalarKind, string> = {
  bool:      "boolean",
  i8:        "number",
  i16:       "number",
  i32:       "number",
  i64:       "bigint",
  u8:        "number",
  u16:       "number",
  u32:       "number",
  u64:       "bigint",
  f32:       "number",
  f64:       "number",
  string:    "string",
  bytes:     "Uint8Array",
  uuid:      "string",
  json:      "unknown",
  date:      "string",
  time:      "string",
  timestamp: "string",
  duration:  "bigint",
};

/** Scalars whose runtime representation is a bigint. */
export const BIGINT_SCALARS: ReadonlySet<ScalarKind> = new Set<ScalarKind>(["i64", "u64", "duration"]);

/** Scalars usable as a map key. */
const MAP_KEY_SCALARS: ReadonlySet<ScalarKind> = new Set<ScalarKind>([
  "string", "uuid", "bool",
  "i8", "i16", "i32", "i64",
  "u8", "u16", "u32", "u64",
]);

// ── Encoding signatures ───────────────────────────────────────────────────────
//
// Finer-grained than the four protobuf wire types, because a field's layout can
// change while its wire type does not. The load-bearing case: `[T]` (repeated at
// tag N) becoming `[T]?` (a LEN wrapper at tag N) keeps wire type LEN, yet every
// existing row misparses — and compareTypes classifies it as a safe widening.
// The ledger compares these signatures, so that change is caught as OS2010.

export type EncodingSignature =
  | "singular:varint"
  | "singular:i64"
  | "singular:len"
  | "repeated:packed"
  | "repeated:len-element"
  | "wrapper:repeated"
  | "wrapper:map"
  | "map:entry"
  | "unencodable";

export function encodingSignatureOf(type: TypeExpr, schema: ResolvedSchema): EncodingSignature {
  const resolved = resolveAliasInline(type, schema);

  if (resolved.kind === "nullable") return nullableSignature(resolved.inner, schema);
  if (resolved.kind === "array")    return repeatedSignature(resolved.element, schema);
  if (resolved.kind === "map")      return "map:entry";

  return singularSignature(resolved, schema);
}

/**
 * Nullability changes the layout only for containers. For a singular field,
 * absent already means null, so `T -> T?` is a true wire no-op.
 */
function nullableSignature(inner: TypeExpr, schema: ResolvedSchema): EncodingSignature {
  const resolved = resolveAliasInline(inner, schema);
  if (resolved.kind === "array") return "wrapper:repeated";
  if (resolved.kind === "map")   return "wrapper:map";
  return encodingSignatureOf(resolved, schema);
}

function repeatedSignature(element: TypeExpr, schema: ResolvedSchema): EncodingSignature {
  if (isPackable(element, schema)) return "repeated:packed";
  return "repeated:len-element";
}

function singularSignature(type: TypeExpr, schema: ResolvedSchema): EncodingSignature {
  if (type.kind === "scalar")  return fromWireType(SCALAR_WIRE[type.scalar]);
  if (type.kind === "decimal") return "singular:len";
  if (type.kind === "oneof")   return "singular:len";
  if (type.kind === "union")   return "unencodable";
  if (type.kind === "named") {
    const named = classifyNamed(type, schema);
    if (named === "enum")  return "singular:varint";
    if (named === "model") return "singular:len";
    return "unencodable";
  }
  return "unencodable";
}

function fromWireType(wire: WireType): EncodingSignature {
  if (wire === WireType.Varint) return "singular:varint";
  if (wire === WireType.I64)    return "singular:i64";
  return "singular:len";
}

/** Scalars and enums pack; anything LEN-encoded must be one key per element. */
export function isPackable(type: TypeExpr, schema: ResolvedSchema): boolean {
  const resolved = resolveAliasInline(type, schema);
  if (resolved.kind === "scalar") return SCALAR_WIRE[resolved.scalar] !== WireType.Len;
  if (resolved.kind === "named")  return classifyNamed(resolved, schema) === "enum";
  return false;
}

// ── Named references ──────────────────────────────────────────────────────────

export type NamedKind = "enum" | "model" | "union-alias" | "unresolved";

/**
 * What a `named` type points at. Resolution is by local name, matching every
 * other emitter — see the OSC008 duplicate-localName guard in the emitter.
 */
export function classifyNamed(type: TypeExpr, schema: ResolvedSchema): NamedKind {
  if (type.kind !== "named") return "unresolved";
  const localName = type.path[type.path.length - 1];

  for (const symbol of schema.enums.values()) {
    if (symbol.localName === localName) return "enum";
  }
  if (modelByLocalName(localName, schema) !== null) return "model";

  const alias = aliasByLocalName(localName, schema);
  if (alias !== null && alias.type.kind === "union") return "union-alias";

  return "unresolved";
}

// ── Map keys ──────────────────────────────────────────────────────────────────

/** The scalar a map key encodes as, or null when the key type is unusable. */
export function mapKeyScalar(type: TypeExpr, schema: ResolvedSchema): ScalarKind | null {
  const resolved = resolveAliasInline(type, schema);
  if (resolved.kind !== "scalar") return null;
  if (!MAP_KEY_SCALARS.has(resolved.scalar)) return null;
  return resolved.scalar;
}

// ── Ordinals ──────────────────────────────────────────────────────────────────

/** Why this ordinal cannot be a wire tag, or null when it is fine. */
export function ordinalProblem(ordinal: number): string | null {
  if (!Number.isInteger(ordinal))  return "must be an integer";
  if (ordinal < MIN_ORDINAL)       return `must be at least ${MIN_ORDINAL}`;
  if (ordinal > MAX_ORDINAL)       return `must not exceed ${MAX_ORDINAL}`;
  return null;
}
