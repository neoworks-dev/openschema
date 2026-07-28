import type { ScalarKind, TypeExpr } from "../../parser/ast.js";
import type { ResolvedSchema } from "../../resolver/types.js";
/** Wire tags are `ordinal * 8 + wireType`; ordinals above this overflow int32. */
export declare const MAX_ORDINAL = 536870911;
export declare const MIN_ORDINAL = 1;
/**
 * Reserved for a future per-company overlay envelope: repeated LEN, each entry
 * `{1: companyId, 2..N: that overlay's own ordinal space}`. Nothing emits it
 * yet; the tag is spoken for so overlay support stays purely additive.
 */
export declare const OVERLAY_ENVELOPE_TAG = 536870911;
export declare enum WireType {
    Varint = 0,
    I64 = 1,
    Len = 2,
    I32 = 5
}
export declare const SCALAR_WIRE: Record<ScalarKind, WireType>;
/**
 * The TypeScript type the codec uses for each scalar. Deliberately diverges from
 * SCALAR_TS in the typescript emitter: 64-bit integers must be bigint, because
 * `number` silently loses precision above 2^53.
 */
export declare const SCALAR_CODEC_TS: Record<ScalarKind, string>;
/** Scalars whose runtime representation is a bigint. */
export declare const BIGINT_SCALARS: ReadonlySet<ScalarKind>;
export type EncodingSignature = "singular:varint" | "singular:i64" | "singular:len" | "repeated:packed" | "repeated:len-element" | "wrapper:repeated" | "wrapper:map" | "map:entry" | "unencodable";
export declare function encodingSignatureOf(type: TypeExpr, schema: ResolvedSchema): EncodingSignature;
/** Scalars and enums pack; anything LEN-encoded must be one key per element. */
export declare function isPackable(type: TypeExpr, schema: ResolvedSchema): boolean;
export type NamedKind = "enum" | "model" | "union-alias" | "unresolved";
/**
 * What a `named` type points at. Resolution is by local name, matching every
 * other emitter — see the OSC008 duplicate-localName guard in the emitter.
 */
export declare function classifyNamed(type: TypeExpr, schema: ResolvedSchema): NamedKind;
/** The scalar a map key encodes as, or null when the key type is unusable. */
export declare function mapKeyScalar(type: TypeExpr, schema: ResolvedSchema): ScalarKind | null;
/** Why this ordinal cannot be a wire tag, or null when it is fine. */
export declare function ordinalProblem(ordinal: number): string | null;
//# sourceMappingURL=wireFormat.d.ts.map