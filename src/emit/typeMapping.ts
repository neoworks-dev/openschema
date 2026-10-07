// src/emit/typeMapping.ts
// Shared helpers for reading decorators and inspecting types across emitters.

import type { Decorator, DecoratorValue, TypeExpr, TypeAlias, Span } from "../parser/ast.js";
import type { ResolvedModel, ResolvedField, ResolvedSchema } from "../resolver/types.js";
import type { EmitContext } from "./types.js";

/** Base-record fields an emitter should render, honouring includePrivate. */
export function baseFieldsToEmit(record: ResolvedModel, context: EmitContext): ResolvedField[] {
  if (context.includePrivate) return record.fields;
  return record.fields.filter(field => !field.isPrivate);
}

/** The selected company's overlay fields for this record, or []. */
export function overlayFieldsToEmit(
  schema: ResolvedSchema,
  record: ResolvedModel,
  company: string | null,
): ResolvedField[] {
  if (company === null) return [];
  const byCompany = schema.overlays.get(record.symbol.qualifiedName);
  if (byCompany === undefined) return [];
  const overlay = byCompany.get(company);
  if (overlay === undefined) return [];
  return overlay.fields;
}

// ── Visibility (TypeSpec-style) ───────────────────────────────────────────────
//
// @visibility("read") / @visibility("create", "update") restricts which
// operation contexts a field appears in. @invisible hides it everywhere. A
// field with no visibility decorator is visible in every context.

export type VisibilityPhase = "read" | "create" | "update" | "delete" | "query";

// Phases that make up an operation INPUT (request body / arguments).
export const INPUT_PHASES: VisibilityPhase[] = ["create", "update", "query"];
// The phase that makes up an operation OUTPUT (response body).
export const OUTPUT_PHASE: VisibilityPhase = "read";

export function isVisibleIn(decorators: Decorator[], phase: VisibilityPhase): boolean {
  if (hasDecorator(decorators, "invisible")) return false;
  const visibility = findDecorator(decorators, "visibility");
  if (visibility === null) return true; // unrestricted
  for (const arg of visibility.args) {
    if (arg.value.kind === "string" && arg.value.value === phase) return true;
  }
  return false;
}

/** True if the field belongs in an operation input (any input phase). */
export function isVisibleInInput(decorators: Decorator[]): boolean {
  if (hasDecorator(decorators, "invisible")) return false;
  // @input on a field marks it input-only; it always belongs in inputs.
  if (hasDecorator(decorators, "input")) return true;
  return INPUT_PHASES.some(phase => isVisibleIn(decorators, phase));
}

/** True if the field belongs in an operation output (the read phase). */
export function isVisibleInOutput(decorators: Decorator[]): boolean {
  // A field-level @input is input-only: never shown in output types.
  if (hasDecorator(decorators, "input")) return false;
  return isVisibleIn(decorators, OUTPUT_PHASE);
}

/**
 * A model-level @input marks the whole model as input-only: emitters skip its
 * output type / database table and emit it only as an input shape.
 */
export function isInputModel(model: ResolvedModel): boolean {
  return hasDecorator(model.decorators, "input");
}

/** Find a decorator by its dotted name, e.g. "sql.type" or "table". */
export function findDecorator(decorators: Decorator[], name: string): Decorator | null {
  for (const decorator of decorators) {
    if (decorator.name === name) return decorator;
  }
  return null;
}

export function hasDecorator(decorators: Decorator[], name: string): boolean {
  return findDecorator(decorators, name) !== null;
}

/** Every decorator with the given dotted name; a name may repeat on one element. */
export function allDecorators(decorators: Decorator[], name: string): Decorator[] {
  return decorators.filter(decorator => decorator.name === name);
}

/** The positional (unnamed) string arguments of a decorator, in order. */
export function positionalStringArgs(decorator: Decorator): string[] {
  const out: string[] = [];
  for (const arg of decorator.args) {
    if (arg.name !== null) continue;
    const value = decoratorValueToString(arg.value);
    if (value !== null) out.push(value);
  }
  return out;
}

/** First positional argument value of a decorator, as a plain string. */
export function firstStringArg(decorators: Decorator[], name: string): string | null {
  const decorator = findDecorator(decorators, name);
  if (decorator === null || decorator.args.length === 0) return null;
  return decoratorValueToString(decorator.args[0].value);
}

/** A named argument of a decorator, as a plain string, e.g. `start` in
 *  @neoworks.timeRange(start: "from", end: "to"). Returns null when absent. */
export function namedStringArg(decorators: Decorator[], name: string, argName: string): string | null {
  const decorator = findDecorator(decorators, name);
  if (decorator === null) return null;
  for (const arg of decorator.args) {
    if (arg.name === argName) return decoratorValueToString(arg.value);
  }
  return null;
}

export function decoratorValueToString(value: DecoratorValue): string | null {
  if (value.kind === "string") return value.value;
  if (value.kind === "ident")  return value.value;
  if (value.kind === "number") return String(value.value);
  if (value.kind === "bool")   return String(value.value);
  return null; // expr values have no simple string form
}

/** Strip a single nullable wrapper, returning the inner type and a flag. */
export function unwrapNullable(type: TypeExpr): { inner: TypeExpr; nullable: boolean } {
  if (type.kind === "nullable") return { inner: type.inner, nullable: true };
  return { inner: type, nullable: false };
}

// ── @link (store a model field by its primary-key id) ──────────────────────────
//
// A @link field references another model by id instead of embedding it. For most
// targets the field renders as the linked model's primary-key scalar (uuid by
// default); array/nullable wrappers are preserved. SurrealDB instead emits its
// native record<table> link (see surrealDdl), and SQL adds a foreign-key clause.

const SYNTHETIC_SPAN: Span = { line: 0, col: 0 };

/** A model's primary-key field, or null when none is marked @primaryKey. */
export function primaryKeyField(model: ResolvedModel): ResolvedField | null {
  for (const field of model.fields) {
    if (hasDecorator(field.decorators, "primaryKey")) return field;
  }
  return null;
}

/** The non-nullable type of a model's primary key. The resolver (OS1016) rejects
 * @link targets that lack exactly one @primaryKey, so the uuid branch is only a
 * defensive fallback for already-invalid schemas. */
export function primaryKeyType(model: ResolvedModel): TypeExpr {
  const field = primaryKeyField(model);
  if (field !== null) return unwrapNullable(field.type).inner;
  return { kind: "scalar", scalar: "uuid", span: SYNTHETIC_SPAN };
}

export function modelByLocalName(name: string, schema: ResolvedSchema): ResolvedModel | null {
  for (const record of schema.records.values()) {
    if (record.symbol.localName === name) return record;
  }
  return null;
}

/** If `field` is @link, rewrite each named-model reference in its type to that
 * model's primary-key scalar, preserving array/nullable wrappers. Otherwise
 * returns the type unchanged. */
export function applyLink(type: TypeExpr, field: ResolvedField, schema: ResolvedSchema): TypeExpr {
  if (!hasDecorator(field.decorators, "link")) return type;
  return rewriteLinks(type, schema);
}

function rewriteLinks(type: TypeExpr, schema: ResolvedSchema): TypeExpr {
  if (type.kind === "named") {
    const model = modelByLocalName(type.path[type.path.length - 1], schema);
    if (model !== null) return primaryKeyType(model);
    return type;
  }
  if (type.kind === "array")    return { ...type, element: rewriteLinks(type.element, schema) };
  if (type.kind === "nullable") return { ...type, inner: rewriteLinks(type.inner, schema) };
  return type;
}

/** snake_case a camelCase or PascalCase identifier. */
export function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

// ── Type aliases ──────────────────────────────────────────────────────────────
//
// `type X = ...` aliases come in two flavours. NON-UNION aliases (scalar/array/
// map/named) are inlined: every reference expands to the underlying type, because
// most targets cannot name an array or scalar. UNION aliases (`type G = A | B`)
// become first-class named types (GraphQL union, TS union, json-schema anyOf, …).

/** The alias whose local name matches `name`, or null. Matches the enum/record
 * localName lookups used by the sql/surreal/internal emitters. */
export function aliasByLocalName(name: string, schema: ResolvedSchema): TypeAlias | null {
  for (const symbol of schema.aliases.values()) {
    if (symbol.localName === name) return symbol.decl as TypeAlias;
  }
  return null;
}

/** True if a named reference points at a union alias (`type G = A | B`). */
export function isUnionAlias(path: string[], schema: ResolvedSchema): boolean {
  const alias = aliasByLocalName(path[path.length - 1], schema);
  return alias !== null && alias.type.kind === "union";
}

/** Every union alias in declaration order, for first-class named emission. */
export function unionAliases(schema: ResolvedSchema): { name: string; alias: TypeAlias }[] {
  const result: { name: string; alias: TypeAlias }[] = [];
  for (const symbol of schema.aliases.values()) {
    const alias = symbol.decl as TypeAlias;
    if (alias.type.kind === "union") result.push({ name: symbol.localName, alias });
  }
  return result;
}

/**
 * If `type` is a `named` reference to a NON-union alias, return its underlying
 * type with any generic type-params substituted, following alias→alias chains.
 * Union-alias and model/enum references are returned unchanged. Cycle-guarded.
 *
 * This resolves only the top node; deep inlining of nested references is the
 * resolver normalization pass's job. Emitters use it to resolve union variants.
 */
export function resolveAliasInline(
  type: TypeExpr,
  schema: ResolvedSchema,
  seen: Set<string> = new Set(),
): TypeExpr {
  if (type.kind !== "named") return type;
  const name = type.path[type.path.length - 1];
  const alias = aliasByLocalName(name, schema);
  if (alias === null) return type;            // model / enum / type-param reference
  if (alias.type.kind === "union") return type; // union alias stays named
  if (seen.has(name)) return type;            // cycle — resolver reports OS1010
  seen.add(name);

  let body: TypeExpr = alias.type;
  if (alias.typeParams.length > 0) {
    body = substituteTypeParams(body, alias.typeParams.map(p => p.name), type.typeArgs);
  }
  return resolveAliasInline(body, schema, seen);
}

/** Rewrite `body`, replacing each bare type-param reference with its argument.
 * Builds new nodes; never mutates `body`. */
export function substituteTypeParams(
  body: TypeExpr,
  paramNames: string[],
  typeArgs: TypeExpr[],
): TypeExpr {
  const bindings = new Map<string, TypeExpr>();
  paramNames.forEach((paramName, index) => {
    if (index < typeArgs.length) bindings.set(paramName, typeArgs[index]);
  });
  return substitute(body, bindings);
}

function substitute(type: TypeExpr, bindings: Map<string, TypeExpr>): TypeExpr {
  switch (type.kind) {
    case "named":
      if (type.path.length === 1 && type.typeArgs.length === 0 && bindings.has(type.path[0])) {
        return bindings.get(type.path[0])!;
      }
      return { ...type, typeArgs: type.typeArgs.map(arg => substitute(arg, bindings)) };
    case "array":
      return { ...type, element: substitute(type.element, bindings) };
    case "map":
      return { ...type, key: substitute(type.key, bindings), value: substitute(type.value, bindings) };
    case "nullable":
      return { ...type, inner: substitute(type.inner, bindings) };
    case "union":
      return { ...type, variants: type.variants.map(variant => substitute(variant, bindings)) };
    case "oneof":
      return { ...type, variants: type.variants.map(v => ({ ...v, type: substitute(v.type, bindings) })) };
    default:
      return type;
  }
}
