// src/emit/index.ts
// Emitter registry. Look up an emitter by target name.

import type { Emitter } from "./types.js";
import { sqlEmitter } from "./sql/sqlEmitter.js";
import { typescriptEmitter } from "./typescript/typescriptEmitter.js";
import { jsonSchemaEmitter } from "./jsonSchema/jsonSchemaEmitter.js";
import { goEmitter } from "./go/goEmitter.js";
import { graphqlEmitter } from "./graphql/graphqlEmitter.js";
import { openApiEmitter } from "./openapi/openApiEmitter.js";
import { surrealEmitter } from "./surrealdb/surrealEmitter.js";
import { zodEmitter } from "./zod/zodEmitter.js";
import { internalEmitter } from "./internal/internalEmitter.js";
import { neoworksDdlEmitter } from "./neoworks/neoworksDdlEmitter.js";

export type { Emitter, EmitContext, OutputFile } from "./types.js";
export type { InternalSchema, InternalTable, InternalField, InternalIndex } from "./internal/internalEmitter.js";

const EMITTERS: Record<string, Emitter> = {
  [sqlEmitter.target]: sqlEmitter,
  [typescriptEmitter.target]: typescriptEmitter,
  [jsonSchemaEmitter.target]: jsonSchemaEmitter,
  [goEmitter.target]: goEmitter,
  [graphqlEmitter.target]: graphqlEmitter,
  [openApiEmitter.target]: openApiEmitter,
  [surrealEmitter.target]: surrealEmitter,
  [zodEmitter.target]: zodEmitter,
  [internalEmitter.target]: internalEmitter,
  [neoworksDdlEmitter.target]: neoworksDdlEmitter,
};

export function getEmitter(target: string): Emitter | null {
  return EMITTERS[target] ?? null;
}

export function listTargets(): string[] {
  return Object.keys(EMITTERS);
}
