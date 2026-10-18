// src/emit/kotlin/kotlinQueries.ts
// The classes the `where`, `orderBy` and `include` lambdas of the Kotlin SDK run in: one field
// handle per field a query can use, with the operators its type supports. The handles produce the
// JSON the TypeScript SDK's `toCoreQuery` hands the core.
import { referencesOf } from "../collection/collectionEmitter.js";
import { identifier } from "./kotlinNames.js";
import { QUERY_PACKAGE, QUERY_RUNTIME_NAMES, SCHEMA_PACKAGE, HEADER, importLines } from "./kotlinRuntime.js";
import { KotlinTargetError } from "./kotlinTargetError.js";
import { UNQUALIFIED, valueSerializer } from "./kotlinTypes.js";
/** Members of the query base classes that a field of the same name would hide. */
const RESERVED_FIELD_NAMES = new Set([
    "AND", "OR", "NOT", "meta", "createScope", "operatorsOf", "sortField", "fileSortFields", "include",
]);
const NUMBER_SCALARS = new Set([
    "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "f32", "f64", "duration", "timestamp",
]);
const TEXT_SCALARS = new Set(["string", "uuid", "date", "time"]);
export function whereClassName(modelName) {
    return `${modelName}Where`;
}
export function orderByClassName(modelName) {
    return `${modelName}OrderBy`;
}
export function includeClassName(modelName) {
    return `${modelName}Include`;
}
/** The names of the query classes a schema declares, for collision checks. */
export function queryClassNames(descriptor) {
    const names = descriptor.tables.flatMap(table => [
        whereClassName(table.model), orderByClassName(table.model), includeClassName(table.model),
    ]);
    names.push(...elementModelNames(descriptor).map(whereClassName));
    return names;
}
export function queriesSource(descriptor, packageName) {
    const imports = [
        ...importLines(QUERY_PACKAGE, QUERY_RUNTIME_NAMES),
        ...importLines(SCHEMA_PACKAGE, ["Int64AsTextSerializer", "TimestampSerializer", "UInt64AsTextSerializer"]),
        "import kotlinx.serialization.serializer",
    ];
    const blocks = [`${HEADER}\npackage ${packageName}\n\n${imports.join("\n")}`];
    for (const table of descriptor.tables) {
        const model = modelNamed(descriptor, table.model);
        rejectReservedFields(model);
        blocks.push(whereClass(model, "table"), orderByClass(model), includeClass(model, descriptor));
    }
    for (const elementName of elementModelNames(descriptor)) {
        blocks.push(whereClass(modelNamed(descriptor, elementName), "element"));
    }
    return `${blocks.join("\n\n")}\n`;
}
function modelNamed(descriptor, modelName) {
    const model = descriptor.models.find(candidate => candidate.name === modelName);
    if (model === undefined)
        throw new KotlinTargetError(`the descriptor has no model ${modelName}`);
    return model;
}
function rejectReservedFields(model) {
    for (const field of model.fields) {
        if (!RESERVED_FIELD_NAMES.has(field.name))
            continue;
        throw new KotlinTargetError(`the field ${model.name}.${field.name} would hide a member of the Kotlin query classes; rename it`);
    }
}
function isListContainer(field) {
    const kind = field.container.kind;
    return kind === "repeatedPacked" || kind === "repeatedLen" || kind === "wrapperRepeated";
}
/** The message models a table filters on through a list: `emails.some { value.endsWith(...) }`. */
function elementModelNames(descriptor) {
    const names = new Set();
    for (const table of descriptor.tables) {
        for (const field of modelNamed(descriptor, table.model).fields) {
            if (isListContainer(field) && field.value.kind === "message")
                names.add(field.value.name);
        }
    }
    return [...names];
}
function whereClass(model, position) {
    const className = whereClassName(model.name);
    const handles = model.fields.flatMap(field => {
        const handle = whereHandle(field, position);
        if (handle === null)
            return [];
        return [`    val ${identifier(field.name)} = ${handle}`];
    });
    const createScope = `    override fun createScope(): ${className} = ${className}()`;
    const members = handles.join("\n");
    if (handles.length === 0)
        return `class ${className} : Where<${className}>() {\n${createScope}\n}`;
    return `class ${className} : Where<${className}>() {\n${members}\n\n${createScope}\n}`;
}
function orderByClass(model) {
    const keys = model.fields.flatMap(field => {
        const key = sortKey(field);
        if (key === null)
            return [];
        return [`    val ${identifier(field.name)} = ${key}`];
    });
    const className = orderByClassName(model.name);
    if (keys.length === 0)
        return `class ${className} : OrderBy()`;
    return `class ${className} : OrderBy() {\n${keys.join("\n")}\n}`;
}
function includeClass(model, descriptor) {
    const className = includeClassName(model.name);
    const targets = referencesOf(descriptor).get(model.name);
    if (targets === undefined)
        return `class ${className} : Include()`;
    const references = [...targets.keys()].map(fieldName => referenceProperty(fieldName));
    return `class ${className} : Include() {\n${references.join("\n\n")}\n}`;
}
function referenceProperty(fieldName) {
    return `    val ${identifier(fieldName)}: Unit\n        get() = include(${JSON.stringify(fieldName)})`;
}
/** The handle of a field in a `where` lambda, or null when a query cannot filter on it. */
function whereHandle(field, position) {
    const sink = `operatorsOf(${JSON.stringify(field.name)})`;
    if (field.container.kind === "singular")
        return singularHandle(field.value, sink, position);
    if (position === "element" || !isListContainer(field))
        return null;
    return listHandle(field.value, sink);
}
function singularHandle(value, sink, position) {
    if (value.kind !== "file")
        return plainHandle(value, sink);
    if (position === "element")
        return null;
    return `FileField(${sink})`;
}
function listHandle(value, sink) {
    if (value.kind === "file")
        return `FileListField(${sink})`;
    if (value.kind === "message")
        return `MessageListField(${sink}, ::${whereClassName(value.name)})`;
    const elementHandle = plainHandle(value, "it");
    if (elementHandle === null)
        return null;
    return `ValueListField(${sink}, ${valueSerializer(value, "", UNQUALIFIED)}) { ${elementHandle} }`;
}
/** The handle of a value that is a plain scalar, an enum or a reference. */
function plainHandle(value, sink) {
    if (value.kind === "ref")
        return `ReferenceField(${sink})`;
    if (value.kind === "decimal")
        return `TextField(${sink})`;
    if (value.kind === "enum")
        return `EnumField(${sink}, ${valueSerializer(value, "", UNQUALIFIED)})`;
    if (value.kind !== "scalar")
        return null;
    if (value.scalar === "bool")
        return `BooleanField(${sink})`;
    if (TEXT_SCALARS.has(value.scalar))
        return `TextField(${sink})`;
    if (NUMBER_SCALARS.has(value.scalar))
        return `ComparableField(${sink}, ${valueSerializer(value, "", UNQUALIFIED)})`;
    return null;
}
/** The sort key of a field in an `orderBy` lambda, or null when a query cannot sort by it. */
function sortKey(field) {
    if (field.container.kind !== "singular")
        return null;
    const fieldName = JSON.stringify(field.name);
    if (field.value.kind === "file")
        return `fileSortFields(${fieldName})`;
    if (plainHandle(field.value, "") === null)
        return null;
    return `sortField(${fieldName})`;
}
//# sourceMappingURL=kotlinQueries.js.map