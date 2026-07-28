// src/emit/codec/decoderGen.ts
// Generates the decoder for one model.
//
// Two rules carry most of the safety here. Unrecognised tags are captured
// verbatim so an older client's read-edit-write cannot destroy fields a newer
// client added. Unknown enum and oneof variants are preserved as-is rather than
// rejected, for the same reason.
import { UNKNOWN_PROPERTY, valueTsType, wireTypeOf } from "./plan.js";
import { indent } from "./encoderGen.js";
import { SCALAR_CODEC_TS, WireType } from "./wireFormat.js";
function collectOneofNames(plan) {
    const names = new Map();
    for (const field of plan.fields) {
        walkOneofShapes(field.value, `readOneof_${plan.name}_${field.ordinal}`, names);
    }
    return names;
}
function walkOneofShapes(value, name, into) {
    if (value.kind !== "oneof")
        return;
    into.set(value, name);
    for (const variant of value.variants) {
        walkOneofShapes(variant.value, `${name}_${variant.ordinal}`, into);
    }
}
export function emitDecoder(plan) {
    const oneofs = collectOneofNames(plan);
    return [
        `export function decode${plan.name}(bytes: Uint8Array): ${plan.name} {`,
        `  return read${plan.name}(Reader.of(bytes, ${JSON.stringify(plan.name)}), ${JSON.stringify(plan.name)});`,
        `}`,
        ``,
        `function read${plan.name}(r: Reader, path: string): ${plan.name} {`,
        ...plan.fields.map(field => `  ${declareLocal(field)}`),
        `  let unknown: UnknownField[] | undefined;`,
        ``,
        `  while (r.hasMore()) {`,
        `    const wireKey = r.key();`,
        `    const tag = wireKey >>> 3;`,
        `    const wire = wireKey & 7;`,
        `    switch (tag) {`,
        ...plan.fields.map(field => indent(fieldCase(field, oneofs), 6)),
        `      default:`,
        `        unknown = captureUnknown(r, wireKey, tag, wire, unknown, RETIRED_${plan.name});`,
        `    }`,
        `  }`,
        ``,
        ...requiredChecks(plan),
        `  const result: ${plan.name} = {`,
        ...plan.fields.map(field => `    ${assignment(field)},`),
        `  };`,
        `  if (unknown !== undefined && unknown.length > 0) result.${UNKNOWN_PROPERTY} = unknown;`,
        `  return result;`,
        `}`,
    ].join("\n");
}
// ── Locals ────────────────────────────────────────────────────────────────────
function localName(field) {
    return `field${field.ordinal}`;
}
function declareLocal(field) {
    const name = localName(field);
    const element = valueTsType(field.value);
    switch (field.container.kind) {
        case "singular":
            if (field.container.nullable)
                return `let ${name}: ${element} | null = null;`;
            return `let ${name}: ${element} | undefined;`;
        case "repeatedPacked":
        case "repeatedLen":
            return `const ${name}: ${element}[] = [];`;
        case "wrapperRepeated":
            return `let ${name}: ${element}[] | null = null;`;
        case "map":
            return `const ${name} = new Map<${SCALAR_CODEC_TS[field.container.key]}, ${element}>();`;
        case "wrapperMap":
            return `let ${name}: Map<${SCALAR_CODEC_TS[field.container.key]}, ${element}> | null = null;`;
    }
}
function requiredChecks(plan) {
    return plan.fields
        .filter(field => field.required)
        .map(field => `  if (${localName(field)} === undefined) throw missingField(path, ${JSON.stringify(field.name)}, ${field.ordinal});`);
}
function assignment(field) {
    const property = /^[A-Za-z_][A-Za-z0-9_]*$/.test(field.name) ? field.name : JSON.stringify(field.name);
    return `${property}: ${localName(field)}`;
}
// ── Cases ─────────────────────────────────────────────────────────────────────
function fieldCase(field, oneofs) {
    const path = `path + ${JSON.stringify(`.${field.name}`)}`;
    return [
        `case ${field.ordinal}: {`,
        indent(caseBody(field, path, oneofs), 2),
        `  break;`,
        `}`,
    ].join("\n");
}
function caseBody(field, path, oneofs) {
    const name = localName(field);
    const container = field.container;
    switch (container.kind) {
        case "singular":
            return `${name} = ${readValue(field.value, "r", "wire", path, oneofs)};`;
        case "repeatedPacked":
            return packedRead(field, name, path);
        case "repeatedLen":
            return `${name}.push(${readValue(field.value, "r", "wire", path, oneofs)});`;
        case "wrapperRepeated":
            return wrapperRepeatedRead(field, container, name, path, oneofs);
        case "map":
            return mapRead(field, container.key, name, path, "r", oneofs);
        case "wrapperMap":
            return wrapperMapRead(field, container.key, name, path, oneofs);
    }
}
function packedRead(field, target, path) {
    const wire = wireTypeOf(field.value);
    if (wire === WireType.I64) {
        return `readPackedDouble(r, wire, ${path}, ${target});`;
    }
    return [
        `const raw: bigint[] = [];`,
        `readPackedVarint(r, wire, ${path}, raw);`,
        `for (const item of raw) ${target}.push(${fromVarint(field.value, "item", path)});`,
    ].join("\n");
}
function wrapperRepeatedRead(field, container, target, path, oneofs) {
    const inner = container.packed
        ? packedWrapperRead(field, path)
        : `items.push(${readValue(field.value, "wrapper", "innerWire", path, oneofs)});`;
    return [
        `expectWire(wire, WIRE_LEN, ${path});`,
        `const wrapper = r.subMessage(${path});`,
        `const items: ${valueTsType(field.value)}[] = [];`,
        `while (wrapper.hasMore()) {`,
        `  const innerKey = wrapper.key();`,
        `  const innerWire = innerKey & 7;`,
        `  if ((innerKey >>> 3) !== 1) { wrapper.skipBody(innerWire); continue; }`,
        indent(inner, 2),
        `}`,
        `${target} = items;`,
    ].join("\n");
}
/** The packed body inside a nullable-array wrapper, read from `wrapper`. */
function packedWrapperRead(field, path) {
    if (wireTypeOf(field.value) === WireType.I64) {
        return `readPackedDouble(wrapper, innerWire, ${path}, items);`;
    }
    return [
        `const raw: bigint[] = [];`,
        `readPackedVarint(wrapper, innerWire, ${path}, raw);`,
        `for (const item of raw) items.push(${fromVarint(field.value, "item", path)});`,
    ].join("\n");
}
function mapRead(field, keyScalar, target, path, source, oneofs, entryWire = "wire") {
    return [
        `expectWire(${entryWire}, WIRE_LEN, ${path});`,
        `const pair = ${source}.subMessage(${path});`,
        `let entryKey: ${SCALAR_CODEC_TS[keyScalar]} | undefined;`,
        `let entryValue: ${valueTsType(field.value)} | undefined;`,
        `while (pair.hasMore()) {`,
        `  const pairKey = pair.key();`,
        `  const pairWire = pairKey & 7;`,
        `  if ((pairKey >>> 3) === 1) {`,
        `    entryKey = ${readValue({ kind: "scalar", scalar: keyScalar }, "pair", "pairWire", path, oneofs)};`,
        `    continue;`,
        `  }`,
        `  if ((pairKey >>> 3) === 2) {`,
        `    entryValue = ${readValue(field.value, "pair", "pairWire", path, oneofs)};`,
        `    continue;`,
        `  }`,
        `  pair.skipBody(pairWire);`,
        `}`,
        `if (entryKey !== undefined && entryValue !== undefined) ${target}.set(entryKey, entryValue);`,
    ].join("\n");
}
function wrapperMapRead(field, keyScalar, target, path, oneofs) {
    const valueType = valueTsType(field.value);
    const keyType = SCALAR_CODEC_TS[keyScalar];
    return [
        `expectWire(wire, WIRE_LEN, ${path});`,
        `const wrapper = r.subMessage(${path});`,
        `const entries = new Map<${keyType}, ${valueType}>();`,
        `while (wrapper.hasMore()) {`,
        `  const innerKey = wrapper.key();`,
        `  const innerWire = innerKey & 7;`,
        `  if ((innerKey >>> 3) !== 1) { wrapper.skipBody(innerWire); continue; }`,
        indent(mapRead(field, keyScalar, "entries", path, "wrapper", oneofs, "innerWire"), 2),
        `}`,
        `${target} = entries;`,
    ].join("\n");
}
// ── Values ────────────────────────────────────────────────────────────────────
function readValue(value, reader, wire, path, oneofs) {
    switch (value.kind) {
        case "scalar": return scalarRead(value.scalar, reader, wire, path);
        case "enum": return `Number(readVarintField(${reader}, ${wire}, ${path})) as ${value.name}`;
        case "decimal": return `canonicalDecimal(readStringField(${reader}, ${wire}, ${path}), ${value.precision}, ${value.scale}, ${path})`;
        case "message": return `read${value.name}(${subMessage(reader, wire, path)}, ${path})`;
        case "oneof": return `${oneofs.get(value)}(${subMessage(reader, wire, path)}, ${path})`;
    }
}
function subMessage(reader, wire, path) {
    return `(expectWire(${wire}, WIRE_LEN, ${path}), ${reader}.subMessage(${path}))`;
}
function scalarRead(scalar, reader, wire, path) {
    const varint = `readVarintField(${reader}, ${wire}, ${path})`;
    switch (scalar) {
        case "bool": return `${varint} !== 0n`;
        case "i8":
        case "i16":
        case "i32": return `signedNumber(${varint}, ${path})`;
        case "i64": return `toSigned(${varint})`;
        case "u8":
        case "u16":
        case "u32": return `unsignedNumber(${varint}, ${path})`;
        case "u64": return varint;
        case "f32":
        case "f64": return `readDoubleField(${reader}, ${wire}, ${path})`;
        case "string": return `readStringField(${reader}, ${wire}, ${path})`;
        case "bytes": return `readBytesField(${reader}, ${wire}, ${path})`;
        case "uuid": return `bytesToUuid(readBytesField(${reader}, ${wire}, ${path}), ${path})`;
        case "json": return `parseJson(readStringField(${reader}, ${wire}, ${path}), ${path})`;
        case "date": return `daysToDate(toSigned(${varint}), ${path})`;
        case "time": return `nanosToTime(toSigned(${varint}), ${path})`;
        case "timestamp": return `millisToTimestamp(toSigned(${varint}), ${path})`;
        case "duration": return `toSigned(${varint})`;
    }
}
/** Convert a value already read from a packed varint body. */
function fromVarint(value, source, path) {
    if (value.kind === "enum")
        return `Number(${source}) as ${value.name}`;
    if (value.kind !== "scalar")
        return source;
    switch (value.scalar) {
        case "bool": return `${source} !== 0n`;
        case "i8":
        case "i16":
        case "i32": return `signedNumber(${source}, ${path})`;
        case "i64": return `toSigned(${source})`;
        case "u8":
        case "u16":
        case "u32": return `unsignedNumber(${source}, ${path})`;
        case "u64": return source;
        case "date": return `daysToDate(toSigned(${source}), ${path})`;
        case "time": return `nanosToTime(toSigned(${source}), ${path})`;
        case "timestamp": return `millisToTimestamp(toSigned(${source}), ${path})`;
        case "duration": return `toSigned(${source})`;
        default: return source;
    }
}
// ── oneof ─────────────────────────────────────────────────────────────────────
//
// Emitted as a named reader per field, because the union type is structural and
// inlining a switch expression would be unreadable.
export function emitOneofReaders(plan) {
    const oneofs = collectOneofNames(plan);
    const readers = [];
    for (const [shape, name] of oneofs) {
        readers.push(oneofReader(name, shape, oneofs));
    }
    return readers;
}
function oneofReader(name, value, oneofs) {
    const type = valueTsType(value);
    const arms = value.variants.map(variant => [
        `      case ${variant.ordinal}:`,
        `        return { kind: ${JSON.stringify(variant.name)}, ${variant.name}: ${readValue(variant.value, "r", "wire", "path", oneofs)} };`,
    ].join("\n"));
    return [
        `function ${name}(r: Reader, path: string): ${type} {`,
        `  let carried: UnknownField[] | undefined;`,
        `  while (r.hasMore()) {`,
        `    const wireKey = r.key();`,
        `    const tag = wireKey >>> 3;`,
        `    const wire = wireKey & 7;`,
        `    switch (tag) {`,
        ...arms,
        `      default:`,
        `        carried = captureUnknown(r, wireKey, tag, wire, carried, EMPTY_TAGS);`,
        `    }`,
        `  }`,
        `  // A variant written by a newer client survives the round-trip instead of`,
        `  // destroying the row.`,
        `  return { kind: ${JSON.stringify(UNKNOWN_PROPERTY)}, ${UNKNOWN_PROPERTY}: carried ?? [] };`,
        `}`,
    ].join("\n");
}
/** The generated call site for a oneof field, resolved per model+ordinal. */
export function oneofReaderName(plan, field) {
    return `readOneof_${plan.name}_${field.ordinal}`;
}
//# sourceMappingURL=decoderGen.js.map