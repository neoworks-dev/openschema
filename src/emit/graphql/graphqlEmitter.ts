// src/emit/graphql/graphqlEmitter.ts
// Emits GraphQL SDL (types, enums, inputs, and Query/Mutation roots) from a
// resolved schema. GraphQL is nullable-by-default, so non-nullable openschema
// fields gain a trailing '!'.

import type { Emitter, EmitContext, OutputFile } from "../types.js";
import type { ResolvedModel, ResolvedField, ResolvedSchema } from "../../resolver/types.js";
import type { TypeExpr, ScalarKind, EnumDecl, OperationDecl, TypeAlias } from "../../parser/ast.js";
import {
  baseFieldsToEmit, overlayFieldsToEmit, hasDecorator, applyLink,
  isVisibleInOutput, isVisibleInInput, isInputModel,
  unionAliases, isUnionAlias, resolveAliasInline,
} from "../typeMapping.js";

const SCALAR_GQL: Record<ScalarKind, string> = {
  bool: "Boolean",
  i8: "Int", i16: "Int", i32: "Int", i64: "Int",
  u8: "Int", u16: "Int", u32: "Int", u64: "Int",
  f32: "Float", f64: "Float",
  string: "String", bytes: "Bytes", uuid: "UUID", json: "JSON",
  date: "Date", time: "Time", timestamp: "DateTime", duration: "Duration",
};

const CUSTOM_SCALARS = ["scalar UUID", "scalar DateTime", "scalar Date", "scalar Time",
  "scalar Duration", "scalar Decimal", "scalar Bytes", "scalar JSON"];

export const graphqlEmitter: Emitter = {
  target: "graphql",
  fileExtension: "graphql",

  emit(context: EmitContext): OutputFile[] {
    const blocks: string[] = [CUSTOM_SCALARS.join("\n")];

    for (const symbol of context.schema.enums.values()) {
      blocks.push(emitEnum(symbol.decl as EnumDecl));
    }
    for (const { name, alias } of unionAliases(context.schema)) {
      blocks.push(emitUnionAlias(name, alias, context.schema));
    }
    for (const record of context.schema.records.values()) {
      if (record.isGeneric) continue;
      if (isInputModel(record)) continue; // input-only model: no output type
      blocks.push(emitObjectType(record, context));
    }

    const inputNames = collectInputRecords(context.schema);
    for (const name of inputNames) {
      const record = findRecordByLocalName(context.schema, name);
      if (record !== null) blocks.push(emitInputType(record, context));
    }

    blocks.push(...emitRoots(context.schema));

    return [{ path: `schema.${this.fileExtension}`, contents: blocks.join("\n\n") + "\n" }];
  },
};

function emitEnum(decl: EnumDecl): string {
  const members = decl.variants.map(v => `  ${v.name}`).join("\n");
  return `enum ${decl.name} {\n${members}\n}`;
}

function emitObjectType(record: ResolvedModel, context: EmitContext): string {
  // Output types show fields visible in the read phase.
  const fields = [
    ...baseFieldsToEmit(record, context),
    ...overlayFieldsToEmit(context.schema, record, context.company),
  ].filter(f => isVisibleInOutput(f.decorators));
  const lines = fields.map(f => `  ${f.name}: ${renderType(applyLink(f.type, f, context.schema), false, context.schema)}`);
  return `type ${record.symbol.localName} {\n${lines.join("\n")}\n}`;
}

function emitInputType(record: ResolvedModel, context: EmitContext): string {
  // Inputs exclude private fields and fields not visible in any input phase
  // (create/update/query), and reference other inputs by suffix.
  const fields = record.fields
    .filter(f => !f.isPrivate)
    .filter(f => isVisibleInInput(f.decorators));
  const lines = fields.map(f => `  ${f.name}: ${renderType(applyLink(f.type, f, context.schema), true, context.schema)}`);
  return `input ${inputTypeName(record)} {\n${lines.join("\n")}\n}`;
}

// An input-only (@input) model keeps its bare name; a dual-use model gets the
// `Input` suffix so it doesn't collide with its output type.
function inputTypeName(record: ResolvedModel): string {
  if (isInputModel(record)) return record.symbol.localName;
  return `${record.symbol.localName}Input`;
}

// ── Roots: Query / Mutation / Subscription ─────────────────────────────────────

function emitRoots(schema: ResolvedSchema): string[] {
  const buckets: Record<string, string[]> = { Query: [], Mutation: [], Subscription: [] };

  for (const op of schema.operations) {
    const root = rootForOperation(op);
    buckets[root].push(`  ${operationField(op, schema)}`);
  }

  const blocks: string[] = [];
  for (const root of ["Query", "Mutation", "Subscription"]) {
    if (buckets[root].length === 0) continue;
    blocks.push(`type ${root} {\n${buckets[root].join("\n")}\n}`);
  }
  return blocks;
}

function rootForOperation(op: OperationDecl): string {
  if (hasDecorator(op.decorators, "mutation")) return "Mutation";
  if (hasDecorator(op.decorators, "subscription")) return "Subscription";
  return "Query";
}

function operationField(op: OperationDecl, schema: ResolvedSchema): string {
  if (op.params.length === 0) {
    return `${op.name}: ${renderType(op.returnType, false, schema)}`;
  }
  const args = op.params.map(p => `${p.name}: ${renderType(p.type, true, schema)}`).join(", ");
  return `${op.name}(${args}): ${renderType(op.returnType, false, schema)}`;
}

// ── Input-type discovery ───────────────────────────────────────────────────────

function collectInputRecords(schema: ResolvedSchema): string[] {
  const found = new Set<string>();
  const queue: string[] = [];

  for (const op of schema.operations) {
    for (const param of op.params) collectRecordNames(param.type, schema, found, queue);
  }
  // Input-only models are always emitted as inputs, even if no op references them.
  for (const record of schema.records.values()) {
    if (isInputModel(record) && !found.has(record.symbol.localName)) {
      found.add(record.symbol.localName);
      queue.push(record.symbol.localName);
    }
  }
  while (queue.length > 0) {
    const name = queue.pop()!;
    const record = findRecordByLocalName(schema, name);
    if (record === null) continue;
    // Only follow fields that actually appear in the input; a read-only field's
    // type never reaches an input, so it must not pull in an orphan input type.
    for (const field of record.fields) {
      if (field.isPrivate) continue;
      if (!isVisibleInInput(field.decorators)) continue;
      collectRecordNames(applyLink(field.type, field, schema), schema, found, queue);
    }
  }
  return [...found];
}

function collectRecordNames(
  type: TypeExpr,
  schema: ResolvedSchema,
  found: Set<string>,
  queue: string[],
): void {
  if (type.kind === "named") {
    const local = type.path[type.path.length - 1];
    if (findRecordByLocalName(schema, local) !== null && !found.has(local)) {
      found.add(local);
      queue.push(local);
    }
    return;
  }
  if (type.kind === "array")    return collectRecordNames(type.element, schema, found, queue);
  if (type.kind === "nullable") return collectRecordNames(type.inner, schema, found, queue);
  if (type.kind === "map")      return collectRecordNames(type.value, schema, found, queue);
  if (type.kind === "union") {
    for (const v of type.variants) collectRecordNames(v, schema, found, queue);
  }
}

function findRecordByLocalName(schema: ResolvedSchema, local: string): ResolvedModel | null {
  for (const record of schema.records.values()) {
    if (record.symbol.localName === local) return record;
  }
  return null;
}

// ── Type rendering (nullability inversion) ────────────────────────────────────

function renderType(type: TypeExpr, inputMode: boolean, schema: ResolvedSchema): string {
  // `T | null` is GraphQL's plain nullable T: drop the `!`, keep the arm. An
  // optional `T?` is already nullable, so `(T | null)?` collapses to the same.
  if (type.kind === "nullable") {
    const strippedInner = unionWithoutNull(type.inner);
    if (strippedInner !== null) return renderInner(strippedInner, inputMode, schema);
    return renderInner(type.inner, inputMode, schema);
  }

  const nullableInner = unionWithoutNull(type);
  if (nullableInner !== null) return renderInner(nullableInner, inputMode, schema);

  return `${renderInner(type, inputMode, schema)}!`;
}

/** The sole remaining arm of a `T | null` union, or null when it is not one. */
function unionWithoutNull(type: TypeExpr): TypeExpr | null {
  if (type.kind !== "union") return null;
  const arms = type.variants.filter(variant => variant.kind !== "null");
  if (arms.length === type.variants.length) return null;
  if (arms.length !== 1) return null;
  return arms[0]!;
}

function renderInner(type: TypeExpr, inputMode: boolean, schema: ResolvedSchema): string {
  switch (type.kind) {
    case "scalar":   return SCALAR_GQL[type.scalar];
    case "decimal":  return "Decimal";
    case "named":    return renderNamed(type.path, inputMode, schema);
    case "array":    return `[${renderType(type.element, inputMode, schema)}]`;
    case "map":      return "JSON";
    case "union":    return "JSON";
    case "oneof":    return "JSON";
    case "nullable": return renderInner(type.inner, inputMode, schema);
    // Reached only for a bare `null`; `T | null` is handled in renderType.
    case "null":     return "JSON";
  }
}

// A named union alias is a real GraphQL `union` in output position, but unions
// can't be inputs — degrade to the JSON scalar there.
function emitUnionAlias(name: string, alias: TypeAlias, schema: ResolvedSchema): string {
  if (alias.type.kind !== "union") return "";
  const members = alias.type.variants.map(v => renderInner(resolveAliasInline(v, schema), false, schema));
  return `union ${name} = ${members.join(" | ")}`;
}

// In input position, record references become their `Input` companion type;
// enums and aliases keep their name (GraphQL enums work as both).
function renderNamed(path: string[], inputMode: boolean, schema: ResolvedSchema): string {
  if (isUnionAlias(path, schema)) return inputMode ? "JSON" : path[path.length - 1];
  const base = path[path.length - 1];
  if (!inputMode) return base;
  const record = findRecordByLocalName(schema, base);
  if (record === null) return base;                 // enum or alias — same name in both
  if (isInputModel(record)) return base;            // input-only model keeps its bare name
  return `${base}Input`;
}
