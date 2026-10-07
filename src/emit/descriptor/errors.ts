// src/emit/descriptor/errors.ts
// Constructs the descriptor target rejects. Emitters have no diagnostics
// channel, so the emitter throws and the CLI renders it like a diagnostic.

import type { Span } from "../../parser/ast.js";

export type DescriptorErrorCode =
  | "OSD001"   // unknown @neoworks decorator
  | "OSD002"   // @neoworks.node without a valid node kind
  | "OSD003"   // two models declare the same node kind
  | "OSD004"   // a node-only decorator on a model that is not a node
  | "OSD005"   // invalid or repeated facet name
  | "OSD006"   // two facets of one model hash to the same tag
  | "OSD007"   // @neoworks.searchable on a field that is not a string
  | "OSD008"   // invalid @neoworks.timeRange
  | "OSD009"   // invalid validation decorator
  | "OSD010";  // @neoworks.title not on exactly one single string field

export class DescriptorError extends Error {
  constructor(
    readonly code: DescriptorErrorCode,
    readonly model: string,
    readonly field: string | null,
    readonly reason: string,
    readonly span: Span | null,
  ) {
    super(formatMessage(model, field, reason));
    this.name = "DescriptorError";
  }
}

function formatMessage(model: string, field: string | null, reason: string): string {
  if (field === null) return `${model}: ${reason}`;
  return `${model}.${field}: ${reason}`;
}
