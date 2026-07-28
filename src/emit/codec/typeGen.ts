// src/emit/codec/typeGen.ts
// Interfaces, enums, and the per-model tag sets the decoder consults.

import type { EnumDecl } from "../../parser/ast.js";
import type { DeclSymbol } from "../../resolver/types.js";
import { UNKNOWN_PROPERTY, type ModelPlan } from "./plan.js";

export function emitEnum(symbol: DeclSymbol): string {
  const decl = symbol.decl as EnumDecl;
  const members = decl.variants.map(variant => `  ${variant.name} = ${variant.ordinal},`);
  return [`export enum ${symbol.localName} {`, ...members, "}"].join("\n");
}

export function emitInterface(plan: ModelPlan): string {
  const lines = plan.fields.map(field => `  ${propertyName(field.name)}: ${field.tsType};`);
  // Present only when the message carried fields this schema does not declare.
  lines.push(`  ${UNKNOWN_PROPERTY}?: UnknownField[];`);
  return [`export interface ${plan.name} {`, ...lines, "}"].join("\n");
}

/**
 * KNOWN_* guards against an unknown field re-entering at a tag the schema owns.
 * RETIRED_* is empty until the ordinal ledger fills it; the decoder drops those
 * tags rather than preserving them, so deleting a field does not grow every row
 * on every device forever.
 */
export function emitTagSets(plan: ModelPlan): string {
  const known = plan.fields.map(field => field.ordinal).sort((a, b) => a - b);
  return [
    `const KNOWN_${plan.name}: ReadonlySet<number> = new Set([${known.join(", ")}]);`,
    `const RETIRED_${plan.name}: ReadonlySet<number> = new Set([]);`,
  ].join("\n");
}

function propertyName(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return JSON.stringify(name);
}
