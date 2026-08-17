// src/emit/codec/plan.ts
// Classify each field once, so the encoder and the decoder are generated from a
// single description. Two independent classifications could disagree, and a
// disagreement between encode and decode is silent data loss.

import type { ScalarKind, Span, TypeExpr } from "../../parser/ast.js";
import type { ResolvedField, ResolvedModel, ResolvedSchema } from "../../resolver/types.js";
import { applyLink, resolveAliasInline, unwrapNullable } from "../typeMapping.js";
import { CodecUnsupportedError } from "./errors.js";
import {
  MAX_ORDINAL, SCALAR_CODEC_TS, SCALAR_WIRE, WireType,
  classifyNamed, isPackable, mapKeyScalar, ordinalProblem,
} from "./wireFormat.js";

export const UNKNOWN_PROPERTY = "$unknown";

export type ValueShape =
  | { kind: "scalar"; scalar: ScalarKind }
  | { kind: "enum"; name: string }
  | { kind: "message"; name: string }
  | { kind: "decimal"; precision: number; scale: number }
  | { kind: "oneof"; variants: OneofVariantPlan[] };

export interface OneofVariantPlan {
  ordinal: number;
  name: string;
  value: ValueShape;
}

export type Container =
  | { kind: "singular"; nullable: boolean }
  | { kind: "repeatedPacked" }
  | { kind: "repeatedLen" }
  | { kind: "wrapperRepeated"; packed: boolean }
  | { kind: "map"; key: ScalarKind }
  | { kind: "wrapperMap"; key: ScalarKind };

export interface FieldPlan {
  ordinal:   number;
  name:      string;
  /** `.name`, or `["odd name"]` for backtick-escaped identifiers. */
  accessor:  string;
  container: Container;
  value:     ValueShape;
  tsType:    string;
  /** True when decode must reject an absent field. */
  required:  boolean;
  span:      Span;
}

export interface ModelPlan {
  name:   string;
  fields: FieldPlan[];
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function planModel(model: ResolvedModel, fields: ResolvedField[], schema: ResolvedSchema): ModelPlan {
  const name = model.symbol.localName;
  return { name, fields: fields.map(field => planField(name, field, schema)) };
}

function planField(model: string, field: ResolvedField, schema: ResolvedSchema): FieldPlan {
  rejectBadOrdinal(model, field);
  rejectUnknownCollision(model, field);

  const type = resolveAliasInline(applyLink(field.type, field, schema), schema);
  const { container, value } = planShape(model, field, type, schema);

  return {
    ordinal:   field.ordinal,
    name:      field.name,
    accessor:  accessorFor(field.name),
    container,
    value,
    tsType:    renderTsType(container, value),
    required:  isRequired(container),
    span:      field.span,
  };
}

function rejectBadOrdinal(model: string, field: ResolvedField): void {
  const problem = ordinalProblem(field.ordinal);
  if (problem === null) return;
  throw new CodecUnsupportedError("OSC004", model, field.name,
    `ordinal ${field.ordinal} cannot be a wire tag: it ${problem} (1..${MAX_ORDINAL})`, field.span);
}

function rejectUnknownCollision(model: string, field: ResolvedField): void {
  if (field.name !== UNKNOWN_PROPERTY) return;
  throw new CodecUnsupportedError("OSC006", model, field.name,
    `'${UNKNOWN_PROPERTY}' is reserved for the unknown-field bag`, field.span);
}

// ── Containers ────────────────────────────────────────────────────────────────

function planShape(
  model: string,
  field: ResolvedField,
  type: TypeExpr,
  schema: ResolvedSchema,
): { container: Container; value: ValueShape } {
  const { inner, nullable } = unwrapNullable(type);
  const resolved = stripNull(resolveAliasInline(inner, schema));

  if (resolved.kind === "array") {
    return planArray(model, field, resolved.element, nullable, schema);
  }
  if (resolved.kind === "map") {
    return planMap(model, field, resolved.key, resolved.value, nullable, schema);
  }
  return {
    container: { kind: "singular", nullable },
    value: planValue(model, field, resolved, schema),
  };
}

/**
 * `T | null` encodes exactly as `T`. The wire format models presence, not null:
 * an absent tag is the only way to say "no value", so the null arm carries no
 * information here and is dropped. It stays meaningful in the API-surface
 * targets (ts, zod, json-schema, openapi).
 */
function stripNull(type: TypeExpr): TypeExpr {
  if (type.kind !== "union") return type;
  const arms = type.variants.filter(variant => variant.kind !== "null");
  if (arms.length === type.variants.length) return type;
  if (arms.length === 1) return arms[0]!;
  return { ...type, variants: arms };
}

function planArray(
  model: string,
  field: ResolvedField,
  element: TypeExpr,
  nullable: boolean,
  schema: ResolvedSchema,
): { container: Container; value: ValueShape } {
  if (unwrapNullable(resolveAliasInline(element, schema)).nullable) {
    throw new CodecUnsupportedError("OSC002", model, field.name,
      "a repeated field cannot hold null elements", field.span);
  }

  const value = planValue(model, field, element, schema);
  const packed = isPackable(element, schema);

  if (nullable) return { container: { kind: "wrapperRepeated", packed }, value };
  return { container: packed ? { kind: "repeatedPacked" } : { kind: "repeatedLen" }, value };
}

function planMap(
  model: string,
  field: ResolvedField,
  keyType: TypeExpr,
  valueType: TypeExpr,
  nullable: boolean,
  schema: ResolvedSchema,
): { container: Container; value: ValueShape } {
  const key = mapKeyScalar(keyType, schema);
  if (key === null) {
    throw new CodecUnsupportedError("OSC003", model, field.name,
      "map keys must be string, uuid, bool, or an integer scalar", field.span);
  }
  const value = planValue(model, field, valueType, schema);
  return { container: nullable ? { kind: "wrapperMap", key } : { kind: "map", key }, value };
}

// ── Values ────────────────────────────────────────────────────────────────────

function planValue(model: string, field: ResolvedField, type: TypeExpr, schema: ResolvedSchema): ValueShape {
  const resolved = resolveAliasInline(unwrapNullable(type).inner, schema);

  if (resolved.kind === "scalar")  return { kind: "scalar", scalar: resolved.scalar };
  if (resolved.kind === "decimal") return { kind: "decimal", precision: resolved.precision, scale: resolved.scale };
  if (resolved.kind === "oneof") {
    return {
      kind: "oneof",
      variants: resolved.variants.map(variant => ({
        ordinal: variant.ordinal,
        name: variant.name,
        value: planValue(model, field, variant.type, schema),
      })),
    };
  }
  if (resolved.kind === "union") {
    throw new CodecUnsupportedError("OSC001", model, field.name,
      "an untagged union has no discriminant on the wire; use `oneof { 1 a: A  2 b: B }`", field.span);
  }
  if (resolved.kind === "named") {
    const named = classifyNamed(resolved, schema);
    const localName = resolved.path[resolved.path.length - 1];
    if (named === "enum")        return { kind: "enum", name: localName };
    if (named === "model")       return { kind: "message", name: localName };
    if (named === "union-alias") {
      throw new CodecUnsupportedError("OSC001", model, field.name,
        `'${localName}' is an untagged union alias and has no discriminant on the wire`, field.span);
    }
    throw new CodecUnsupportedError("OSC007", model, field.name,
      `cannot resolve type '${localName}'`, field.span);
  }
  throw new CodecUnsupportedError("OSC007", model, field.name,
    `type kind '${resolved.kind}' is not encodable`, field.span);
}

// ── Rendering helpers ─────────────────────────────────────────────────────────

function accessorFor(name: string): string {
  if (IDENTIFIER.test(name)) return `.${name}`;
  return `[${JSON.stringify(name)}]`;
}

/** Only a non-nullable singular field must be present on decode. */
function isRequired(container: Container): boolean {
  return container.kind === "singular" && !container.nullable;
}

/**
 * Absence is `undefined`, spelled as an optional property — the wire format has
 * no null, only present and absent. Non-nullable repeated and map fields stay
 * required because the decoder always assigns them an empty collection.
 */
export function isOptional(container: Container): boolean {
  if (container.kind === "singular") return container.nullable;
  return container.kind === "wrapperRepeated" || container.kind === "wrapperMap";
}

export function renderTsType(container: Container, value: ValueShape): string {
  const element = valueTsType(value);
  switch (container.kind) {
    case "singular":        return element;
    case "repeatedPacked":
    case "repeatedLen":
    case "wrapperRepeated": return `${arrayElement(element)}[]`;
    case "map":
    case "wrapperMap":      return `Map<${SCALAR_CODEC_TS[container.key]}, ${element}>`;
  }
}

function arrayElement(rendered: string): string {
  if (/[|&\s]/.test(rendered)) return `(${rendered})`;
  return rendered;
}

export function valueTsType(value: ValueShape): string {
  switch (value.kind) {
    case "scalar":  return SCALAR_CODEC_TS[value.scalar];
    case "enum":    return value.name;
    case "message": return value.name;
    case "decimal": return "string";
    case "oneof":   return oneofTsType(value.variants);
  }
}

function oneofTsType(variants: OneofVariantPlan[]): string {
  const arms = variants.map(variant =>
    `{ kind: ${JSON.stringify(variant.name)}; ${variant.name}: ${valueTsType(variant.value)} }`);
  // A variant added by a newer client must survive a round-trip rather than
  // destroying the row, so the union always has an unknown arm.
  arms.push(`{ kind: "${UNKNOWN_PROPERTY}"; ${UNKNOWN_PROPERTY}: UnknownField[] }`);
  return arms.join(" | ");
}

/** The wire type a singular value of this shape occupies. */
export function wireTypeOf(value: ValueShape): WireType {
  switch (value.kind) {
    case "scalar":  return SCALAR_WIRE[value.scalar];
    case "enum":    return WireType.Varint;
    case "message": return WireType.Len;
    case "decimal": return WireType.Len;
    case "oneof":   return WireType.Len;
  }
}
