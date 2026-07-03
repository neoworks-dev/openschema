// src/emit/types.ts
// The pluggable emitter interface. An emitter turns a ResolvedSchema into files.

import type { ResolvedSchema } from "../resolver/types.js";

export interface OutputFile {
  path:     string;      // relative to the output directory, e.g. "schema.sql"
  contents: string;
}

export interface EmitContext {
  schema:         ResolvedSchema;
  company:        string | null;   // emit this company's overlay fields, if any
  includePrivate: boolean;         // include base-record private fields
  options:        Record<string, string>;
}

export interface Emitter {
  target:        string;           // "sql" | "ts" | "go" | "json-schema" | "graphql"
  fileExtension: string;
  emit(context: EmitContext): OutputFile[];
}
