// src/emit/codec/encoderGen.ts
// Generates the canonical encoder for one model.
//
// Canonical means: known fields strictly ascending by ordinal, unknown fields
// interleaved into that order rather than appended, absent fields omitted, and
// present fields always written — including 0, "", and false.

import type { ScalarKind } from "../../parser/ast.js";
import { UNKNOWN_PROPERTY, wireTypeOf, type Container, type FieldPlan, type ModelPlan, type ValueShape } from "./plan.js";
import { WireType } from "./wireFormat.js";

export function emitEncoder(plan: ModelPlan): string {
  const body = plan.fields.map(field => encodeField(plan, field)).join("\n\n");
  return [
    `export function encode${plan.name}(value: ${plan.name}): Uint8Array {`,
    `  const writer = new Writer();`,
    `  write${plan.name}(writer, value, ${JSON.stringify(plan.name)});`,
    `  return writer.finish();`,
    `}`,
    ``,
    `function write${plan.name}(w: Writer, value: ${plan.name}, path: string): void {`,
    `  const unknown = prepareUnknown(value.${UNKNOWN_PROPERTY}, KNOWN_${plan.name}, path);`,
    `  let pending = 0;`,
    body.length > 0 ? `\n${body}\n` : ``,
    `  flushUnknownRest(w, unknown, pending);`,
    `}`,
  ].join("\n");
}

function encodeField(plan: ModelPlan, field: FieldPlan): string {
  const source = `value${field.accessor}`;
  const path = `path + ${JSON.stringify(`.${field.name}`)}`;
  const lines = [`  pending = flushUnknownBefore(w, unknown, pending, ${field.ordinal});`];
  lines.push(indent(containerWriter(field, source, path), 2));
  return lines.join("\n");
}

function containerWriter(field: FieldPlan, source: string, path: string): string {
  const container = field.container;
  switch (container.kind) {
    case "singular":        return singularWriter(field, container, source, path);
    case "repeatedPacked":  return packedWriter(field, source, path);
    case "repeatedLen":     return lenElementWriter(field, source, path);
    case "wrapperRepeated": return wrapperRepeatedWriter(field, container, source, path);
    case "map":             return mapWriter(field, container.key, source, path, null);
    case "wrapperMap":      return wrapperMapWriter(field, container.key, source, path);
  }
}

function singularWriter(field: FieldPlan, container: Container & { kind: "singular" }, source: string, path: string): string {
  if (!container.nullable) {
    return `${key(field.ordinal, wireTypeOf(field.value))}\n${writeValue("w", field.value, source, path)}`;
  }
  // Bound to a local first: TypeScript does not carry the null-narrowing of a
  // property access into the nested-message closure.
  return [
    `if (${source} !== null && ${source} !== undefined) {`,
    `  const present = ${source};`,
    indent(`${key(field.ordinal, wireTypeOf(field.value))}\n${writeValue("w", field.value, "present", path)}`, 2),
    `}`,
  ].join("\n");
}

function packedWriter(field: FieldPlan, source: string, path: string): string {
  return [
    `if (${source}.length > 0) {`,
    `  ${key(field.ordinal, WireType.Len)}`,
    `  const packedOffset = w.beginNested();`,
    `  for (const item of ${source}) {`,
    indent(writeValue("w", field.value, "item", path), 4),
    `  }`,
    `  w.endNested(packedOffset);`,
    `}`,
  ].join("\n");
}

function lenElementWriter(field: FieldPlan, source: string, path: string): string {
  return [
    `for (const item of ${source}) {`,
    `  ${key(field.ordinal, wireTypeOf(field.value))}`,
    indent(writeValue("w", field.value, "item", path), 2),
    `}`,
  ].join("\n");
}

/**
 * A nullable repeated field becomes a LEN wrapper `{1: repeated T}`, so null and
 * [] stay distinct. Note this changes the layout at the tag versus a plain
 * repeated field — the ordinal ledger's encoding signature guards that edit.
 */
function wrapperRepeatedWriter(
  field: FieldPlan,
  container: Container & { kind: "wrapperRepeated" },
  source: string,
  path: string,
): string {
  const inner = container.packed
    ? [
        `  if (present.length > 0) {`,
        `    w.key(1, WIRE_LEN);`,
        `    const packedOffset = w.beginNested();`,
        `    for (const item of present) {`,
        indent(writeValue("w", field.value, "item", path), 6),
        `    }`,
        `    w.endNested(packedOffset);`,
        `  }`,
      ]
    : [
        `  for (const item of present) {`,
        `    w.key(1, ${wireConstant(wireTypeOf(field.value))});`,
        indent(writeValue("w", field.value, "item", path), 4),
        `  }`,
      ];

  return [
    `if (${source} !== null && ${source} !== undefined) {`,
    `  const present = ${source};`,
    `  ${key(field.ordinal, WireType.Len)}`,
    `  const wrapperOffset = w.beginNested();`,
    ...inner,
    `  w.endNested(wrapperOffset);`,
    `}`,
  ].join("\n");
}

function mapWriter(
  field: FieldPlan,
  keyScalar: ScalarKind,
  source: string,
  path: string,
  emitTarget: string | null,
): string {
  const tag = emitTarget === null ? field.ordinal : 1;
  return [
    `for (const entry of sortMapEntries([...${source}].map(([k, v]) => ({ key: k, value: v, keyBytes: ${keyBytes(keyScalar, "k")} })))) {`,
    `  w.key(${tag}, WIRE_LEN);`,
    `  const pairOffset = w.beginNested();`,
    `  w.key(1, ${wireConstant(scalarWire(keyScalar))});`,
    indent(writeValue("w", { kind: "scalar", scalar: keyScalar }, "entry.key", path), 2),
    `  w.key(2, ${wireConstant(wireTypeOf(field.value))});`,
    indent(writeValue("w", field.value, "entry.value", path), 2),
    `  w.endNested(pairOffset);`,
    `}`,
  ].join("\n");
}

function wrapperMapWriter(field: FieldPlan, keyScalar: ScalarKind, source: string, path: string): string {
  return [
    `if (${source} !== null && ${source} !== undefined) {`,
    `  const present = ${source};`,
    `  ${key(field.ordinal, WireType.Len)}`,
    `  const wrapperOffset = w.beginNested();`,
    indent(mapWriter(field, keyScalar, "present", path, "w"), 2),
    `  w.endNested(wrapperOffset);`,
    `}`,
  ].join("\n");
}

// ── Values ────────────────────────────────────────────────────────────────────

function writeValue(target: string, value: ValueShape, source: string, path: string): string {
  switch (value.kind) {
    case "scalar":  return `${target}.${scalarWriteCall(value.scalar, source, path)};`;
    case "enum":    return `${target}.varintNumber(${source});`;
    case "decimal":
      return `${target}.string(canonicalDecimal(${source}, ${value.precision}, ${value.scale}, ${path}));`;
    case "message":
      // A block, not a closure: a closure per present message field was the
      // single largest cost in the encode profile.
      return [
        `{`,
        `  const nestedOffset = ${target}.beginNested();`,
        `  write${value.name}(${target}, ${source}, ${path});`,
        `  ${target}.endNested(nestedOffset);`,
        `}`,
      ].join("\n");
    case "oneof":
      return oneofWriter(target, value, source, path);
  }
}

function oneofWriter(target: string, value: ValueShape & { kind: "oneof" }, source: string, path: string): string {
  // An else-if chain rather than early returns: this runs inline in the write
  // function, where a return would abandon the rest of the message.
  const arms = value.variants.map((variant, index) => [
    `  ${index === 0 ? "if" : "} else if"} (variant.kind === ${JSON.stringify(variant.name)}) {`,
    `    ${target}.key(${variant.ordinal}, ${wireConstant(wireTypeOf(variant.value))});`,
    indent(writeValue(target, variant.value, `variant${propertyAccess(variant.name)}`, path), 4),
  ].join("\n"));

  return [
    `{`,
    `  const chosenOffset = ${target}.beginNested();`,
    `  const variant = ${source};`,
    ...arms,
    `  ${arms.length === 0 ? "if" : "} else if"} (variant.kind === ${JSON.stringify(UNKNOWN_PROPERTY)}) {`,
    `    for (const carried of variant.${UNKNOWN_PROPERTY}) ${target}.raw(carried.raw);`,
    `  }`,
    `  ${target}.endNested(chosenOffset);`,
    `}`,
  ].join("\n");
}

function scalarWriteCall(scalar: ScalarKind, source: string, path: string): string {
  switch (scalar) {
    case "bool":      return `varintNumber(${source} ? 1 : 0)`;
    case "i8":
    case "i16":
    case "i32":       return `varintNumber(requireInteger(${source}, ${path}))`;
    case "i64":       return `varint(${source})`;
    case "u8":
    case "u16":
    case "u32":       return `varintNumber(requireUnsignedNumber(${source}, ${path}))`;
    case "u64":       return `varint(requireUnsigned(${source}, ${path}))`;
    case "f32":
    case "f64":       return `double(requireFinite(${source}, ${path}))`;
    case "string":    return `string(${source})`;
    case "bytes":     return `lengthDelimited(${source})`;
    case "uuid":      return `lengthDelimited(uuidToBytes(${source}, ${path}))`;
    case "json":      return `string(canonicalJson(${source}))`;
    case "date":      return `varintNumber(dateToDays(${source}, ${path}))`;
    case "time":      return `varintNumber(timeToNanos(${source}, ${path}))`;
    case "timestamp": return `varintNumber(timestampToMillis(${source}, ${path}))`;
    case "duration":  return `varint(${source})`;
  }
}

function keyBytes(scalar: ScalarKind, source: string): string {
  if (scalar === "string") return `stringKeyBytes(${source})`;
  if (scalar === "uuid")   return `uuidToBytes(${source}, "map key")`;
  if (scalar === "bool")   return `varintKeyBytes(${source} ? 1n : 0n)`;
  return `varintKeyBytes(BigInt(${source}))`;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

export function scalarWire(scalar: ScalarKind): WireType {
  return wireTypeOf({ kind: "scalar", scalar });
}

export function wireConstant(wire: WireType): string {
  if (wire === WireType.Varint) return "WIRE_VARINT";
  if (wire === WireType.I64)    return "WIRE_I64";
  if (wire === WireType.I32)    return "WIRE_I32";
  return "WIRE_LEN";
}

export function propertyAccess(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return `.${name}`;
  return `[${JSON.stringify(name)}]`;
}

function key(ordinal: number, wire: WireType): string {
  return `w.key(${ordinal}, ${wireConstant(wire)});`;
}

export function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text.split("\n").map(line => (line.length === 0 ? line : pad + line)).join("\n");
}
