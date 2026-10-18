// src/emit/kotlin/kotlinTypes.ts
// The Kotlin type of a descriptor value, and the serializer that reads and writes it in the
// descriptor's JSON mapping (the one the TypeScript SDK's content mapping implements).
import { capitalize } from "./kotlinNames.js";
const NO_SERIALIZER = null;
const SCALARS = {
    bool: { type: "Boolean", serializer: NO_SERIALIZER },
    i8: { type: "Byte", serializer: NO_SERIALIZER },
    i16: { type: "Short", serializer: NO_SERIALIZER },
    i32: { type: "Int", serializer: NO_SERIALIZER },
    i64: { type: "Long", serializer: "Int64AsTextSerializer" },
    u8: { type: "UByte", serializer: NO_SERIALIZER },
    u16: { type: "UShort", serializer: NO_SERIALIZER },
    u32: { type: "UInt", serializer: NO_SERIALIZER },
    u64: { type: "ULong", serializer: "UInt64AsTextSerializer" },
    f32: { type: "Float", serializer: NO_SERIALIZER },
    f64: { type: "Double", serializer: NO_SERIALIZER },
    string: { type: "String", serializer: NO_SERIALIZER },
    bytes: { type: "ByteArray", serializer: "Base64UrlBytesSerializer" },
    uuid: { type: "String", serializer: NO_SERIALIZER },
    json: { type: "JsonElement", serializer: NO_SERIALIZER },
    date: { type: "String", serializer: NO_SERIALIZER },
    time: { type: "String", serializer: NO_SERIALIZER },
    timestamp: { type: "Instant", serializer: "TimestampSerializer" },
    duration: { type: "Long", serializer: "Int64AsTextSerializer" },
    semver: { type: "Semver", serializer: NO_SERIALIZER },
};
/** The built-in File the runtime file declares. */
const FILE_TYPE = "File";
export const UNQUALIFIED = { qualifier: "" };
/** The name a oneof field's generated type has; nested oneofs extend the name of the variant they sit in. */
export function oneofTypeName(modelName, fieldName) {
    return modelName + capitalize(fieldName);
}
export function oneofVariantTypeName(oneofName, variantName) {
    return oneofName + capitalize(variantName);
}
/** A value's type without serialization annotations, for places that are not serialized by plugin. */
export function plainValueType(value, oneofName, scope) {
    switch (value.kind) {
        case "scalar": return SCALARS[value.scalar].type;
        case "ref": return "String";
        case "enum": return scope.qualifier + value.name;
        case "message": return scope.qualifier + value.name;
        case "file": return scope.qualifier + FILE_TYPE;
        case "decimal": return "String";
        case "oneof": return scope.qualifier + oneofName;
    }
}
/** A value's type with the annotation that selects its serializer where the default one is wrong. */
export function annotatedValueType(value, oneofName) {
    const plain = plainValueType(value, oneofName, UNQUALIFIED);
    if (value.kind !== "scalar")
        return plain;
    const serializer = SCALARS[value.scalar].serializer;
    if (serializer === NO_SERIALIZER)
        return plain;
    return `@Serializable(with = ${serializer}::class) ${plain}`;
}
/** The Kotlin expression of the serializer for one value. */
export function valueSerializer(value, oneofName, scope) {
    if (value.kind === "scalar" && SCALARS[value.scalar].serializer !== NO_SERIALIZER) {
        return String(SCALARS[value.scalar].serializer);
    }
    return `serializer<${plainValueType(value, oneofName, scope)}>()`;
}
/** A map key is written as JSON object key text, which the plugin does for every key type itself. */
function mapKeyType(key) {
    return SCALARS[key].type;
}
function isCollection(container) {
    return container.kind !== "singular";
}
function isAbsentWhenUnset(container) {
    if (container.kind === "singular")
        return container.nullable;
    return container.kind === "wrapperRepeated" || container.kind === "wrapperMap";
}
/** The type of a field as the property declares it. */
export function fieldType(field, oneofName) {
    const element = annotatedValueType(field.value, oneofName);
    const type = containerType(field.container, element);
    if (isAbsentWhenUnset(field.container))
        return `${type}?`;
    return type;
}
/** The type of a field as a plain property declares it, without serialization annotations. */
export function plainFieldType(field, oneofName) {
    const element = plainValueType(field.value, oneofName, UNQUALIFIED);
    const type = containerType(field.container, element);
    if (isAbsentWhenUnset(field.container))
        return `${type}?`;
    return type;
}
/** The Kotlin expression of the serializer for a whole field: the container around the element, nullable when the field is optional. */
export function fieldSerializer(field, oneofName) {
    const element = valueSerializer(field.value, oneofName, UNQUALIFIED);
    const container = field.container;
    let serializer = element;
    if (container.kind === "map" || container.kind === "wrapperMap") {
        serializer = `MapSerializer(serializer<${mapKeyType(container.key)}>(), ${element})`;
    }
    else if (container.kind !== "singular") {
        serializer = `ListSerializer(${element})`;
    }
    if (isAbsentWhenUnset(container))
        return `${serializer}.nullable`;
    return serializer;
}
function containerType(container, element) {
    if (container.kind === "singular")
        return element;
    if (container.kind === "map" || container.kind === "wrapperMap") {
        return `Map<${mapKeyType(container.key)}, ${element}>`;
    }
    return `List<${element}>`;
}
/** Optional fields default to null and unset lists and maps to empty ones, so a row read from older data decodes. */
export function fieldDefault(field) {
    if (isAbsentWhenUnset(field.container))
        return " = null";
    if (!isCollection(field.container))
        return "";
    if (field.container.kind === "map")
        return " = emptyMap()";
    return " = emptyList()";
}
//# sourceMappingURL=kotlinTypes.js.map