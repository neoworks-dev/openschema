// src/emit/codec/errors.ts
// Constructs the codec cannot encode. Emitters have no diagnostics channel, so
// the codec emitter throws and the CLI renders it like a resolver diagnostic.

import type { Span } from "../../parser/ast.js";

export type CodecErrorCode =
  | "OSC001"   // untagged union — no discriminant on the wire
  | "OSC002"   // [T?] — null is unrepresentable in a repeated position
  | "OSC003"   // map key is not a string / integer / bool / uuid
  | "OSC004"   // ordinal outside the encodable tag range
  | "OSC005"   // --company: overlay ordinals collide with the base record's
  | "OSC006"   // a field named $unknown collides with the unknown-field bag
  | "OSC007"   // unresolvable named reference or unsubstituted type parameter
  | "OSC008";  // duplicate localName across namespaces

export class CodecUnsupportedError extends Error {
  constructor(
    readonly code: CodecErrorCode,
    readonly model: string,
    readonly field: string | null,
    readonly reason: string,
    readonly span: Span | null,
  ) {
    super(formatMessage(model, field, reason));
    this.name = "CodecUnsupportedError";
  }
}

function formatMessage(model: string, field: string | null, reason: string): string {
  if (field === null) return `${model}: ${reason}`;
  return `${model}.${field}: ${reason}`;
}
