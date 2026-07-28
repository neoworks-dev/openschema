// src/emit/codec/plan.ts
// Classify each field once, so the encoder and the decoder are generated from a
// single description. Two independent classifications could disagree, and a
// disagreement between encode and decode is silent data loss.
import { applyLink, resolveAliasInline, unwrapNullable } from "../typeMapping.js";
import { CodecUnsupportedError } from "./errors.js";
import { MAX_ORDINAL, SCALAR_CODEC_TS, SCALAR_WIRE, WireType, classifyNamed, isPackable, mapKeyScalar, ordinalProblem, } from "./wireFormat.js";
export const UNKNOWN_PROPERTY = "$unknown";
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function planModel(model, fields, schema) {
    const name = model.symbol.localName;
    return { name, fields: fields.map(field => planField(name, field, schema)) };
}
function planField(model, field, schema) {
    rejectBadOrdinal(model, field);
    rejectUnknownCollision(model, field);
    const type = resolveAliasInline(applyLink(field.type, field, schema), schema);
    const { container, value } = planShape(model, field, type, schema);
    return {
        ordinal: field.ordinal,
        name: field.name,
        accessor: accessorFor(field.name),
        container,
        value,
        tsType: renderTsType(container, value),
        required: isRequired(container),
        span: field.span,
    };
}
function rejectBadOrdinal(model, field) {
    const problem = ordinalProblem(field.ordinal);
    if (problem === null)
        return;
    throw new CodecUnsupportedError("OSC004", model, field.name, `ordinal ${field.ordinal} cannot be a wire tag: it ${problem} (1..${MAX_ORDINAL})`, field.span);
}
function rejectUnknownCollision(model, field) {
    if (field.name !== UNKNOWN_PROPERTY)
        return;
    throw new CodecUnsupportedError("OSC006", model, field.name, `'${UNKNOWN_PROPERTY}' is reserved for the unknown-field bag`, field.span);
}
// ── Containers ────────────────────────────────────────────────────────────────
function planShape(model, field, type, schema) {
    const { inner, nullable } = unwrapNullable(type);
    const resolved = resolveAliasInline(inner, schema);
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
function planArray(model, field, element, nullable, schema) {
    if (unwrapNullable(resolveAliasInline(element, schema)).nullable) {
        throw new CodecUnsupportedError("OSC002", model, field.name, "a repeated field cannot hold null elements", field.span);
    }
    const value = planValue(model, field, element, schema);
    const packed = isPackable(element, schema);
    if (nullable)
        return { container: { kind: "wrapperRepeated", packed }, value };
    return { container: packed ? { kind: "repeatedPacked" } : { kind: "repeatedLen" }, value };
}
function planMap(model, field, keyType, valueType, nullable, schema) {
    const key = mapKeyScalar(keyType, schema);
    if (key === null) {
        throw new CodecUnsupportedError("OSC003", model, field.name, "map keys must be string, uuid, bool, or an integer scalar", field.span);
    }
    const value = planValue(model, field, valueType, schema);
    return { container: nullable ? { kind: "wrapperMap", key } : { kind: "map", key }, value };
}
// ── Values ────────────────────────────────────────────────────────────────────
function planValue(model, field, type, schema) {
    const resolved = resolveAliasInline(unwrapNullable(type).inner, schema);
    if (resolved.kind === "scalar")
        return { kind: "scalar", scalar: resolved.scalar };
    if (resolved.kind === "decimal")
        return { kind: "decimal", precision: resolved.precision, scale: resolved.scale };
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
        throw new CodecUnsupportedError("OSC001", model, field.name, "an untagged union has no discriminant on the wire; use `oneof { 1 a: A  2 b: B }`", field.span);
    }
    if (resolved.kind === "named") {
        const named = classifyNamed(resolved, schema);
        const localName = resolved.path[resolved.path.length - 1];
        if (named === "enum")
            return { kind: "enum", name: localName };
        if (named === "model")
            return { kind: "message", name: localName };
        if (named === "union-alias") {
            throw new CodecUnsupportedError("OSC001", model, field.name, `'${localName}' is an untagged union alias and has no discriminant on the wire`, field.span);
        }
        throw new CodecUnsupportedError("OSC007", model, field.name, `cannot resolve type '${localName}'`, field.span);
    }
    throw new CodecUnsupportedError("OSC007", model, field.name, `type kind '${resolved.kind}' is not encodable`, field.span);
}
// ── Rendering helpers ─────────────────────────────────────────────────────────
function accessorFor(name) {
    if (IDENTIFIER.test(name))
        return `.${name}`;
    return `[${JSON.stringify(name)}]`;
}
/** Only a non-nullable singular field must be present on decode. */
function isRequired(container) {
    return container.kind === "singular" && !container.nullable;
}
export function renderTsType(container, value) {
    const element = valueTsType(value);
    switch (container.kind) {
        case "singular": return container.nullable ? `${element} | null` : element;
        case "repeatedPacked":
        case "repeatedLen": return `${arrayElement(element)}[]`;
        case "wrapperRepeated": return `${arrayElement(element)}[] | null`;
        case "map": return `Map<${SCALAR_CODEC_TS[container.key]}, ${element}>`;
        case "wrapperMap": return `Map<${SCALAR_CODEC_TS[container.key]}, ${element}> | null`;
    }
}
function arrayElement(rendered) {
    if (/[|&\s]/.test(rendered))
        return `(${rendered})`;
    return rendered;
}
export function valueTsType(value) {
    switch (value.kind) {
        case "scalar": return SCALAR_CODEC_TS[value.scalar];
        case "enum": return value.name;
        case "message": return value.name;
        case "decimal": return "string";
        case "oneof": return oneofTsType(value.variants);
    }
}
function oneofTsType(variants) {
    const arms = variants.map(variant => `{ kind: ${JSON.stringify(variant.name)}; ${variant.name}: ${valueTsType(variant.value)} }`);
    // A variant added by a newer client must survive a round-trip rather than
    // destroying the row, so the union always has an unknown arm.
    arms.push(`{ kind: "${UNKNOWN_PROPERTY}"; ${UNKNOWN_PROPERTY}: UnknownField[] }`);
    return arms.join(" | ");
}
/** The wire type a singular value of this shape occupies. */
export function wireTypeOf(value) {
    switch (value.kind) {
        case "scalar": return SCALAR_WIRE[value.scalar];
        case "enum": return WireType.Varint;
        case "message": return WireType.Len;
        case "decimal": return WireType.Len;
        case "oneof": return WireType.Len;
    }
}
//# sourceMappingURL=plan.js.map