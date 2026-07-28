// src/lsp/vocabulary.ts
// Static knowledge about the DSL the editor offers as completions and hovers:
// scalar types, structural keywords, and the built-in decorator vocabulary.
export const SCALAR_TYPES = [
    { label: "bool", detail: "scalar", documentation: "Boolean true/false." },
    { label: "i8", detail: "scalar", documentation: "Signed 8-bit integer." },
    { label: "i16", detail: "scalar", documentation: "Signed 16-bit integer." },
    { label: "i32", detail: "scalar", documentation: "Signed 32-bit integer." },
    { label: "i64", detail: "scalar", documentation: "Signed 64-bit integer." },
    { label: "u8", detail: "scalar", documentation: "Unsigned 8-bit integer." },
    { label: "u16", detail: "scalar", documentation: "Unsigned 16-bit integer." },
    { label: "u32", detail: "scalar", documentation: "Unsigned 32-bit integer." },
    { label: "u64", detail: "scalar", documentation: "Unsigned 64-bit integer." },
    { label: "f32", detail: "scalar", documentation: "32-bit floating point." },
    { label: "f64", detail: "scalar", documentation: "64-bit floating point." },
    { label: "decimal", detail: "scalar", documentation: "Fixed-point decimal: decimal(precision, scale)." },
    { label: "string", detail: "scalar", documentation: "UTF-8 text." },
    { label: "bytes", detail: "scalar", documentation: "Raw byte sequence." },
    { label: "json", detail: "scalar", documentation: "Arbitrary JSON value (object, array or scalar)." },
    { label: "uuid", detail: "scalar", documentation: "UUID value." },
    { label: "date", detail: "scalar", documentation: "Calendar date." },
    { label: "time", detail: "scalar", documentation: "Time of day." },
    { label: "timestamp", detail: "scalar", documentation: "Instant in time." },
    { label: "duration", detail: "scalar", documentation: "Span of time." },
];
export const KEYWORDS = [
    { label: "namespace", detail: "keyword", documentation: "Declares the namespace for this file's types." },
    { label: "import", detail: "keyword", documentation: 'Import types from another file: import { X } from "./other".' },
    { label: "from", detail: "keyword", documentation: "Source module of an import." },
    { label: "model", detail: "keyword", documentation: "A record type with ordinal-numbered fields." },
    { label: "enum", detail: "keyword", documentation: "An enumeration with ordinal-numbered variants." },
    { label: "type", detail: "keyword", documentation: "A type alias." },
    { label: "oneof", detail: "keyword", documentation: "A tagged union of ordinal-numbered variants." },
    { label: "op", detail: "keyword", documentation: "An operation (query or mutation)." },
    { label: "interface", detail: "keyword", documentation: "A group of related operations." },
    { label: "overlay", detail: "keyword", documentation: "A company-scoped set of private fields on a base model." },
    { label: "extends", detail: "keyword", documentation: "Inherit fields from a base model." },
    { label: "private", detail: "keyword", documentation: "Exclude this field from public artifacts unless --include-private." },
    { label: "reserved", detail: "keyword", documentation: "Mark ordinals or names that may never be used again: reserved 2, 5..9;" },
];
export const DECORATORS = [
    { label: "compatibility", detail: "decorator", documentation: "@compatibility(backward|forward|full|none) — CI compatibility mode." },
    { label: "table", detail: "decorator", documentation: '@table("name") — physical table name for SQL/SurrealDB.' },
    { label: "primaryKey", detail: "decorator", documentation: "@primaryKey — marks the primary key field." },
    { label: "unique", detail: "decorator", documentation: "@unique — adds a uniqueness constraint." },
    { label: "references", detail: "decorator", documentation: "@references(Model.field) — foreign-key / record link." },
    { label: "link", detail: "decorator", documentation: "@link — store a named-model field as a SurrealDB record<table> link instead of an embedded value object." },
    { label: "default", detail: "decorator", documentation: "@default(value) — default value expression." },
    { label: "check", detail: "decorator", documentation: "@check(expr) — value constraint expression." },
    { label: "format", detail: "decorator", documentation: '@format("email") — semantic string format.' },
    { label: "minValue", detail: "decorator", documentation: "@minValue(n) — minimum numeric value." },
    { label: "maxValue", detail: "decorator", documentation: "@maxValue(n) — maximum numeric value." },
    { label: "minLength", detail: "decorator", documentation: "@minLength(n) — minimum string length." },
    { label: "maxLength", detail: "decorator", documentation: "@maxLength(n) — maximum string length." },
    { label: "minItems", detail: "decorator", documentation: "@minItems(n) — minimum array length (outer array of the field)." },
    { label: "maxItems", detail: "decorator", documentation: "@maxItems(n) — maximum array length (outer array of the field)." },
    { label: "length", detail: "decorator", documentation: "@length(n) — exact array length; sets both minItems and maxItems. For nested bounds use the type-level form `[T; n]` / `[T; min..max]`." },
    { label: "pattern", detail: "decorator", documentation: '@pattern("regex") — string must match the pattern.' },
    { label: "deprecated", detail: "decorator", documentation: "@deprecated — marks a field/variant as deprecated." },
    { label: "renamed", detail: "decorator", documentation: '@renamed("OldName") — on a model/enum/type alias: the differ matches it to the removed OldName so the change is reported as a rename (warning, R020/E007/T004) instead of a breaking remove + add.' },
    { label: "doc", detail: "decorator", documentation: '@doc("text") — documentation string.' },
    { label: "visibility", detail: "decorator", documentation: '@visibility("read", "create", ...) — restricts where a field appears.' },
    { label: "invisible", detail: "decorator", documentation: "@invisible — hides a field from every context." },
    { label: "input", detail: "decorator", documentation: "@input — input-only. On a model: emit only as a GraphQL/OpenAPI input, never an output type or SQL/SurrealDB table. On a field: include in inputs only, never in output types." },
    { label: "query", detail: "decorator", documentation: "@query — routes an op to the GraphQL Query root." },
    { label: "mutation", detail: "decorator", documentation: "@mutation — routes an op to the GraphQL Mutation root." },
    { label: "get", detail: "decorator", documentation: "@get — HTTP GET (OpenAPI)." },
    { label: "post", detail: "decorator", documentation: "@post — HTTP POST (OpenAPI)." },
    { label: "put", detail: "decorator", documentation: "@put — HTTP PUT (OpenAPI)." },
    { label: "delete", detail: "decorator", documentation: "@delete — HTTP DELETE (OpenAPI)." },
    { label: "patch", detail: "decorator", documentation: "@patch — HTTP PATCH (OpenAPI)." },
    { label: "route", detail: "decorator", documentation: '@route("/path/{id}") — HTTP route (OpenAPI).' },
    { label: "sql.type", detail: "decorator", documentation: '@sql.type("JSONB") — override the SQL column type.' },
    { label: "sql.column", detail: "decorator", documentation: '@sql.column("name") — override the SQL column name.' },
    { label: "surreal.type", detail: "decorator", documentation: '@surreal.type("...") — override the SurrealDB field type.' },
    { label: "surreal.field", detail: "decorator", documentation: '@surreal.field("name") — override the SurrealDB field name.' },
];
// Known values for specific decorator arguments. Keyed by the (dotted) decorator
// name; lets the editor explain enum-like literals such as @compatibility(backward).
export const DECORATOR_ARG_VALUES = {
    compatibility: [
        { label: "backward", detail: "compatibility mode", documentation: "New schema can read data written by old schema. CI rejects changes that break old-data readers." },
        { label: "forward", detail: "compatibility mode", documentation: "Old schema can read data written by new schema. CI rejects changes that break old readers of new data." },
        { label: "full", detail: "compatibility mode", documentation: "Both backward and forward must hold — no breaking change of any kind is allowed." },
        { label: "none", detail: "compatibility mode", documentation: "No compatibility enforcement; any change is permitted." },
    ],
    visibility: [
        { label: "read", detail: "visibility phase", documentation: "Field appears in operation output (response bodies / read models)." },
        { label: "create", detail: "visibility phase", documentation: "Field appears in create inputs." },
        { label: "update", detail: "visibility phase", documentation: "Field appears in update inputs." },
        { label: "delete", detail: "visibility phase", documentation: "Field appears in delete inputs." },
        { label: "query", detail: "visibility phase", documentation: "Field appears in query/filter inputs." },
    ],
    format: [
        // ── JSON Schema standard formats ──
        { label: "date-time", detail: "string format", documentation: "RFC 3339 date and time (e.g. 2026-06-23T14:30:00Z)." },
        { label: "date", detail: "string format", documentation: "RFC 3339 full-date (e.g. 2026-06-23)." },
        { label: "time", detail: "string format", documentation: "RFC 3339 full-time (e.g. 14:30:00Z)." },
        { label: "duration", detail: "string format", documentation: "RFC 3339 / ISO 8601 duration (e.g. P3DT12H)." },
        { label: "email", detail: "string format", documentation: "RFC 5322 email address. Maps to JSON Schema format: email and a SurrealDB string::is::email assertion." },
        { label: "idn-email", detail: "string format", documentation: "Internationalized email address (RFC 6531)." },
        { label: "hostname", detail: "string format", documentation: "RFC 1123 host name." },
        { label: "idn-hostname", detail: "string format", documentation: "Internationalized host name (RFC 5890)." },
        { label: "ipv4", detail: "string format", documentation: "IPv4 address (dotted-quad)." },
        { label: "ipv6", detail: "string format", documentation: "IPv6 address (RFC 4291)." },
        { label: "uri", detail: "string format", documentation: "Absolute URI (RFC 3986)." },
        { label: "uri-reference", detail: "string format", documentation: "URI reference — absolute or relative (RFC 3986)." },
        { label: "iri", detail: "string format", documentation: "Internationalized resource identifier (RFC 3987)." },
        { label: "iri-reference", detail: "string format", documentation: "Internationalized resource identifier reference (RFC 3987)." },
        { label: "uri-template", detail: "string format", documentation: "URI template (RFC 6570), e.g. /users/{id}." },
        { label: "uuid", detail: "string format", documentation: "UUID string (RFC 4122)." },
        { label: "json-pointer", detail: "string format", documentation: "JSON Pointer (RFC 6901), e.g. /a/b/0." },
        { label: "relative-json-pointer", detail: "string format", documentation: "Relative JSON Pointer." },
        { label: "regex", detail: "string format", documentation: "ECMA 262 regular expression." },
        // ── Common semantic formats (not JSON Schema native) ──
        { label: "url", detail: "string format", documentation: "Absolute URL. Common alias of uri." },
        { label: "e164", detail: "string format", documentation: "E.164 international telephone number (e.g. +14155552671)." },
        { label: "iso8601", detail: "string format", documentation: "ISO 8601 date/time." },
        { label: "iso4217", detail: "string format", documentation: "ISO 4217 currency code (e.g. USD, EUR)." },
        { label: "iso3166-1-alpha2", detail: "string format", documentation: "ISO 3166-1 alpha-2 country code (e.g. US, DE)." },
        { label: "iso3166-1-alpha3", detail: "string format", documentation: "ISO 3166-1 alpha-3 country code (e.g. USA, DEU)." },
        { label: "iso639", detail: "string format", documentation: "ISO 639 language code (e.g. en, de)." },
        { label: "slug", detail: "string format", documentation: "URL-safe slug (lowercase, hyphen-separated)." },
        { label: "hex-color", detail: "string format", documentation: "Hex color (e.g. #1a2b3c)." },
        { label: "color", detail: "string format", documentation: "CSS color value." },
        { label: "base64", detail: "string format", documentation: "Base64-encoded data." },
        { label: "byte", detail: "string format", documentation: "Base64-encoded bytes (OpenAPI byte format)." },
        { label: "binary", detail: "string format", documentation: "Raw binary / file payload (OpenAPI binary format)." },
        { label: "credit-card", detail: "string format", documentation: "Credit card number (passes the Luhn check)." },
        { label: "password", detail: "string format", documentation: "Sensitive value; UIs should mask it (OpenAPI password format)." },
    ],
};
const SCALAR_LABELS = new Set(SCALAR_TYPES.map(entry => entry.label));
const DECORATOR_BY_LABEL = new Map(DECORATORS.map(entry => [entry.label, entry]));
export function findScalar(label) {
    if (!SCALAR_LABELS.has(label))
        return null;
    return SCALAR_TYPES.find(entry => entry.label === label) ?? null;
}
export function findDecorator(name) {
    return DECORATOR_BY_LABEL.get(name) ?? null;
}
/** Documentation for a known value of a specific decorator's argument. */
export function findArgValue(decoratorName, value) {
    const values = DECORATOR_ARG_VALUES[decoratorName];
    if (values === undefined)
        return null;
    return values.find(entry => entry.label === value) ?? null;
}
//# sourceMappingURL=vocabulary.js.map