// src/emit/go/goCollectionTypes.ts
// The Go type of a descriptor value, in the descriptor's JSON mapping, so that encoding/json
// reads and writes what the core reads and writes. 64-bit integers and durations are decimal
// text in that mapping: a plain field says so with the `string` tag option, which a list element,
// a map value or a oneof variant cannot, so those use the SDK's text-encoded types.
import { exported } from "./goFormat.js";
import { GoTargetError } from "./goTargetError.js";
export const COLLECTIONS_IMPORT = "github.com/neoworks-dev/sdk-go/collections";
export const VAULT_IMPORT = "github.com/neoworks-dev/sdk-go/vault";
/** The Go imports a generated file needs; each type mapping that uses a package adds it. */
export class GoImports {
    constructor() {
        this.paths = new Set();
    }
    add(path) {
        this.paths.add(path);
    }
    sorted() {
        return [...this.paths].sort();
    }
}
const NO_IMPORTS = [];
const TIME = "time";
export const JSON_IMPORT = "encoding/json";
function plain(goType) {
    return { field: goType, element: goType, quoted: false, imports: NO_IMPORTS };
}
const SCALARS = {
    bool: plain("bool"),
    i8: plain("int8"),
    i16: plain("int16"),
    i32: plain("int32"),
    i64: { field: "int64", element: "collections.Int64", quoted: true, imports: [COLLECTIONS_IMPORT] },
    u8: plain("uint8"),
    u16: plain("uint16"),
    u32: plain("uint32"),
    u64: { field: "uint64", element: "collections.Uint64", quoted: true, imports: [COLLECTIONS_IMPORT] },
    f32: plain("float32"),
    f64: plain("float64"),
    string: plain("string"),
    bytes: { field: "collections.Bytes", element: "collections.Bytes", quoted: false, imports: [COLLECTIONS_IMPORT] },
    uuid: plain("string"),
    json: { field: "json.RawMessage", element: "json.RawMessage", quoted: false, imports: [JSON_IMPORT] },
    date: plain("string"),
    time: plain("string"),
    timestamp: { field: "time.Time", element: "time.Time", quoted: false, imports: [TIME] },
    duration: { field: "time.Duration", element: "collections.Duration", quoted: true, imports: [TIME, COLLECTIONS_IMPORT] },
    semver: plain("string"),
};
const FILE_TYPE = "collections.File";
/** The Go type of a value that is not a list or a map element or a oneof variant: `native` selects the plain type. */
export function valueType(value, oneofName, imports, native) {
    switch (value.kind) {
        case "scalar": return scalarType(value.scalar, imports, native);
        case "ref": return "string";
        case "enum": return value.name;
        case "message": return value.name;
        case "file":
            imports.add(COLLECTIONS_IMPORT);
            return FILE_TYPE;
        case "decimal": return "string";
        case "oneof": return oneofName;
    }
}
function scalarType(scalar, imports, native) {
    const mapping = SCALARS[scalar];
    mapping.imports.forEach(path => imports.add(path));
    if (native)
        return mapping.field;
    return mapping.element;
}
/** The type a number handle compares: the plain Go type of the scalar. */
export function nativeScalarType(scalar, imports) {
    return scalarType(scalar, imports, true);
}
/** encoding/json writes a `[]uint8` as base64 text, so a list of u8 values needs its own element type. */
function listElementType(value, oneofName, imports) {
    if (value.kind === "scalar" && value.scalar === "u8") {
        imports.add(COLLECTIONS_IMPORT);
        return "collections.Uint8";
    }
    return valueType(value, oneofName, imports, false);
}
/** JSON object keys: encoding/json writes integer keys as decimal text and cannot take bool keys, whose text is `true` or `false`. */
export function mapKeyType(key, imports) {
    if (INTEGER_KEYS.has(key))
        return scalarType(key, imports, true);
    return "string";
}
const INTEGER_KEYS = new Set(["i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64"]);
/** A list or a map the schema marks optional: unset it is JSON null. */
export function isNullableCollection(container) {
    return container.kind === "wrapperRepeated" || container.kind === "wrapperMap";
}
/** The type of a field's value without the pointer that marks an optional single value. */
export function fieldValueType(field, oneofName, imports) {
    const container = field.container;
    if (container.kind === "singular")
        return valueType(field.value, oneofName, imports, true);
    if (container.kind === "map" || container.kind === "wrapperMap") {
        return `map[${mapKeyType(container.key, imports)}]${valueType(field.value, oneofName, imports, false)}`;
    }
    return `[]${listElementType(field.value, oneofName, imports)}`;
}
/** json.RawMessage already has a nil, so an optional json field is not a pointer. */
function needsPointer(field) {
    if (field.container.kind !== "singular")
        return false;
    if (!field.container.nullable)
        return false;
    return !(field.value.kind === "scalar" && field.value.scalar === "json");
}
/** The type of the struct field. */
export function fieldType(field, oneofName, imports) {
    const type = fieldValueType(field, oneofName, imports);
    if (needsPointer(field))
        return `*${type}`;
    return type;
}
/** The struct tag of the field: its JSON name and how the encoding treats it when unset or large. */
export function fieldTag(field) {
    const options = [];
    if (isOmittedWhenEmpty(field))
        options.push("omitempty");
    if (isQuoted(field))
        options.push("string");
    return `\`json:"${[field.name, ...options].join(",")}"\``;
}
function isOmittedWhenEmpty(field) {
    const container = field.container;
    if (container.kind === "singular")
        return container.nullable;
    return !isNullableCollection(container);
}
function isQuoted(field) {
    if (field.container.kind !== "singular")
        return false;
    if (field.value.kind !== "scalar")
        return false;
    return SCALARS[field.value.scalar].quoted;
}
/** Struct fields are exported, so a schema name that does not start with a letter has no Go name. */
export function goFieldName(modelName, fieldName) {
    if (!/^[A-Za-z]/.test(fieldName)) {
        throw new GoTargetError(`the field ${modelName}.${fieldName} cannot be exported from Go; rename it to start with a letter`);
    }
    return exported(fieldName);
}
/** `Event` with a `reminder` field is `EventReminder`. */
export function oneofTypeName(modelName, fieldName) {
    return modelName + exported(fieldName);
}
export function oneofVariantTypeName(oneofName, variantName) {
    return oneofName + exported(variantName);
}
//# sourceMappingURL=goCollectionTypes.js.map