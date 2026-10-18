// src/emit/kotlin/kotlinQueries.ts
// The classes the `where`, `orderBy` and `include` lambdas of the Kotlin SDK run in: one field
// handle per field a query can use, with the operators its type supports. The handles produce the
// JSON the TypeScript SDK's `toCoreQuery` hands the core.
import { referencesOf } from "../collection/collectionEmitter.js";
import { identifier } from "./kotlinNames.js";
import { QUERY_PACKAGE, QUERY_RUNTIME_NAMES, SCHEMA_PACKAGE, HEADER, importLines } from "./kotlinRuntime.js";
import { KotlinTargetError } from "./kotlinTargetError.js";
import { UNQUALIFIED, valueSerializer } from "./kotlinTypes.js";
/** Members of `Where` and `SortFields`, which every message model's query classes inherit. */
const MESSAGE_RESERVED_FIELD_NAMES = [
    "AND", "OR", "NOT", "createScope", "operatorsOf", "sortField", "fileSortFields", "sortFields",
];
/** Members of the query base classes that a field of a table of the same name would hide. */
const TABLE_RESERVED_FIELD_NAMES = new Set([...MESSAGE_RESERVED_FIELD_NAMES, "meta", "include"]);
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
export function sortFieldsClassName(modelName) {
    return `${modelName}SortFields`;
}
/** The names of the query classes a schema declares, for collision checks. */
export function queryClassNames(descriptor) {
    const names = descriptor.tables.flatMap(table => [
        whereClassName(table.model), orderByClassName(table.model), includeClassName(table.model),
    ]);
    names.push(...whereOnlyModelNames(descriptor).map(whereClassName));
    names.push(...sortModelNames(descriptor).map(sortFieldsClassName));
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
        rejectReservedFields(model, TABLE_RESERVED_FIELD_NAMES);
        blocks.push(whereClass(model), orderByClass(model), includeClass(model, descriptor));
    }
    blocks.push(...embeddedBlocks(descriptor));
    return `${blocks.join("\n\n")}\n`;
}
function modelNamed(descriptor, modelName) {
    const model = descriptor.models.find(candidate => candidate.name === modelName);
    if (model === undefined)
        throw new KotlinTargetError(`the descriptor has no model ${modelName}`);
    return model;
}
function embeddedBlocks(descriptor) {
    const messageReserved = new Set(MESSAGE_RESERVED_FIELD_NAMES);
    const blocks = [];
    for (const modelName of whereOnlyModelNames(descriptor)) {
        const model = modelNamed(descriptor, modelName);
        rejectReservedFields(model, messageReserved);
        blocks.push(whereClass(model));
    }
    for (const modelName of sortModelNames(descriptor)) {
        const model = modelNamed(descriptor, modelName);
        rejectReservedFields(model, messageReserved);
        blocks.push(sortFieldsClass(model));
    }
    return blocks;
}
function rejectReservedFields(model, reserved) {
    for (const field of model.fields) {
        if (!reserved.has(field.name))
            continue;
        throw new KotlinTargetError(`the field ${model.name}.${field.name} would hide a member of the Kotlin query classes; rename it`);
    }
}
/** A list or a map: the values of the field are filtered with `some`, `every` and `none`. */
function isCollectionContainer(field) {
    const kind = field.container.kind;
    return kind === "repeatedPacked" || kind === "repeatedLen" || kind === "wrapperRepeated" || kind === "map" || kind === "wrapperMap";
}
/** The model of the message a field of any container holds, or null. */
function messageOf(field) {
    if (field.value.kind !== "message")
        return null;
    return field.value.name;
}
function singularMessageOf(field) {
    if (field.container.kind !== "singular")
        return null;
    return messageOf(field);
}
/** The models of the messages the tables reach through the fields [messageOfField] names, at any depth. */
function reachableModelNames(descriptor, messageOfField) {
    const reached = new Set();
    const pending = descriptor.tables.map(table => table.model);
    while (pending.length > 0) {
        const model = modelNamed(descriptor, pending.shift());
        for (const field of model.fields) {
            const name = messageOfField(field);
            if (name === null || reached.has(name))
                continue;
            reached.add(name);
            pending.push(name);
        }
    }
    return [...reached];
}
/** The message models a query filters inside of and that are not tables, so they get no table classes. */
function whereOnlyModelNames(descriptor) {
    const tableModels = new Set(descriptor.tables.map(table => table.model));
    return reachableModelNames(descriptor, messageOf).filter(name => !tableModels.has(name));
}
/** The message models a query sorts through: singular messages, at any depth. */
function sortModelNames(descriptor) {
    return reachableModelNames(descriptor, singularMessageOf);
}
function whereClass(model) {
    const className = whereClassName(model.name);
    const handles = model.fields.flatMap(field => {
        const handle = whereHandle(field);
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
    const className = orderByClassName(model.name);
    const members = sortMembers(model);
    if (members.length === 0)
        return `class ${className} : OrderBy()`;
    return `class ${className} : OrderBy() {\n${members.join("\n")}\n}`;
}
function sortFieldsClass(model) {
    const className = sortFieldsClassName(model.name);
    const header = `class ${className}(scope: SortScope) : SortFields(scope)`;
    const members = sortMembers(model);
    if (members.length === 0)
        return header;
    return `${header} {\n${members.join("\n")}\n}`;
}
function sortMembers(model) {
    return model.fields.flatMap(field => {
        const member = sortMember(field);
        if (member === null)
            return [];
        return [member];
    });
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
function whereHandle(field) {
    const sink = `operatorsOf(${JSON.stringify(field.name)})`;
    if (field.container.kind === "singular")
        return singularHandle(field.value, sink);
    if (!isCollectionContainer(field))
        return null;
    return collectionHandle(field.value, sink);
}
function singularHandle(value, sink) {
    if (value.kind === "file")
        return `FileField(${sink})`;
    if (value.kind === "message")
        return `MessageField(${sink}, ::${whereClassName(value.name)})`;
    return plainHandle(value, sink);
}
/** The handle of a list or a map, which filter their values alike. */
function collectionHandle(value, sink) {
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
/** The member of an `orderBy` class that sorts by a field, or null when a query cannot sort by it. */
function sortMember(field) {
    if (field.container.kind !== "singular")
        return null;
    const name = identifier(field.name);
    const fieldName = JSON.stringify(field.name);
    if (field.value.kind === "file")
        return `    val ${name} = fileSortFields(${fieldName})`;
    if (field.value.kind === "message")
        return messageSortMember(name, fieldName, field.value.name);
    if (plainHandle(field.value, "") === null)
        return null;
    return `    val ${name} = sortField(${fieldName})`;
}
/** A getter, so a message that contains itself does not build its sort keys forever. */
function messageSortMember(name, fieldName, modelName) {
    const className = sortFieldsClassName(modelName);
    return `    val ${name}: ${className}\n        get() = sortFields(${fieldName}, ::${className})`;
}
//# sourceMappingURL=kotlinQueries.js.map