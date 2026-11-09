// src/emit/go/goCollectionHandles.ts
// The typed field handles of a table: a value `<Model>Fields` whose members build the conditions,
// orders and changes the SDK's table takes. A handle holds the JSON path of its field, so a
// handle of an embedded message's field names the whole path below the row.
import { COLLECTIONS_IMPORT, fieldValueType, goFieldName, nativeScalarType, oneofTypeName, } from "./goCollectionTypes.js";
import { alignRows, exported } from "./goFormat.js";
import { GoTargetError } from "./goTargetError.js";
/** Members of the embedded `MessageField` that a field of the same name would hide. */
const MESSAGE_RESERVED_FIELD_NAMES = new Set(["Set", "Clear", "MessageField"]);
const NUMBER_SCALARS = new Set([
    "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "f32", "f64", "duration",
]);
const TEXT_SCALARS = new Set(["string", "uuid", "date", "time"]);
export function handleTypeName(modelName) {
    return `${modelName}FieldHandles`;
}
export function handleConstructorName(modelName) {
    return `new${modelName}FieldHandles`;
}
export function fieldsValueName(modelName) {
    return `${modelName}Fields`;
}
/** The names the handles source declares, for collision checks. */
export function handleNames(descriptor) {
    const names = [];
    for (const modelName of handleModelNames(descriptor)) {
        names.push(handleTypeName(modelName), handleConstructorName(modelName));
    }
    for (const table of descriptor.tables) {
        names.push(fieldsValueName(table.model));
    }
    return names;
}
export function handlesSource(descriptor, imports) {
    imports.add(COLLECTIONS_IMPORT);
    const embedded = embeddedModelNames(descriptor);
    const blocks = [];
    for (const modelName of handleModelNames(descriptor)) {
        const model = modelNamed(descriptor, modelName);
        blocks.push(handlesType(model, embedded.has(modelName), descriptor, imports));
        blocks.push(handlesConstructor(model, embedded.has(modelName), descriptor, imports));
        blocks.push(...recursiveMethods(model, descriptor));
    }
    for (const table of descriptor.tables) {
        blocks.push(fieldsValueSource(table.model));
    }
    return blocks;
}
function fieldsValueSource(modelName) {
    return [
        `// ${fieldsValueName(modelName)} holds the handles of the fields of ${modelName}.`,
        `var ${fieldsValueName(modelName)} = ${handleConstructorName(modelName)}()`,
    ].join("\n");
}
function modelNamed(descriptor, modelName) {
    const model = descriptor.models.find(candidate => candidate.name === modelName);
    if (model === undefined)
        throw new GoTargetError(`the descriptor has no model ${modelName}`);
    return model;
}
function messageNameOf(field) {
    if (field.value.kind !== "message")
        return null;
    return field.value.name;
}
function singularMessageNameOf(field) {
    if (field.container.kind !== "singular")
        return null;
    return messageNameOf(field);
}
/** The tables, then the messages their fields reach at any depth: the models that get handles. */
function handleModelNames(descriptor) {
    const names = descriptor.tables.map(table => table.model);
    const seen = new Set(names);
    for (const name of names) {
        for (const field of modelNamed(descriptor, name).fields) {
            const messageName = messageNameOf(field);
            if (messageName === null || seen.has(messageName))
                continue;
            seen.add(messageName);
            names.push(messageName);
        }
    }
    return names;
}
/** Models used as the value of some field: their handles also set and clear the whole message. */
function embeddedModelNames(descriptor) {
    const names = new Set();
    for (const modelName of handleModelNames(descriptor)) {
        for (const field of modelNamed(descriptor, modelName).fields) {
            const messageName = messageNameOf(field);
            if (messageName !== null)
                names.add(messageName);
        }
    }
    return names;
}
/** Whether the message of a single field leads back to `ownerName` through single message fields. */
function leadsBackTo(descriptor, ownerName, messageName) {
    const visited = new Set();
    const pending = [messageName];
    while (pending.length > 0) {
        const current = pending.pop();
        if (current === ownerName)
            return true;
        if (visited.has(current))
            continue;
        visited.add(current);
        for (const field of modelNamed(descriptor, current).fields) {
            const next = singularMessageNameOf(field);
            if (next !== null)
                pending.push(next);
        }
    }
    return false;
}
/** A single message field whose handles would contain themselves is a method, which builds them when called. */
function isRecursive(descriptor, model, field) {
    const messageName = singularMessageNameOf(field);
    if (messageName === null)
        return false;
    return leadsBackTo(descriptor, model.name, messageName);
}
function hasRecursiveField(descriptor, model) {
    return model.fields.some(field => isRecursive(descriptor, model, field));
}
function rejectReservedFields(model) {
    for (const field of model.fields) {
        if (!MESSAGE_RESERVED_FIELD_NAMES.has(exported(field.name)))
            continue;
        throw new GoTargetError(`the field ${model.name}.${field.name} would hide a member of the Go field handles; rename it`);
    }
}
function handlesType(model, embedded, descriptor, imports) {
    if (embedded)
        rejectReservedFields(model);
    const header = `// ${handleTypeName(model.name)} builds conditions, orders and changes for the fields of ${model.name}.`;
    const lines = [header, `type ${handleTypeName(model.name)} struct {`];
    if (embedded)
        lines.push(`\tcollections.MessageField[${model.name}]`);
    const rows = [];
    if (hasRecursiveField(descriptor, model))
        rows.push(["path", "[]string"]);
    for (const field of model.fields) {
        if (isRecursive(descriptor, model, field))
            continue;
        rows.push([goFieldName(model.name, field.name), fieldHandle(model, field, imports).type]);
    }
    lines.push(...alignRows(rows).map(line => `\t${line}`), "}");
    return lines.join("\n");
}
function handlesConstructor(model, embedded, descriptor, imports) {
    const rows = [];
    if (embedded)
        rows.push(["MessageField:", `collections.NewMessageField[${model.name}](path...),`]);
    if (hasRecursiveField(descriptor, model))
        rows.push(["path:", "path,"]);
    for (const field of model.fields) {
        if (isRecursive(descriptor, model, field))
            continue;
        rows.push([`${goFieldName(model.name, field.name)}:`, `${fieldHandle(model, field, imports).build(childPath(field))},`]);
    }
    return [
        `func ${handleConstructorName(model.name)}(path ...string) ${handleTypeName(model.name)} {`,
        `\treturn ${handleTypeName(model.name)}{`,
        ...alignRows(rows).map(line => `\t\t${line}`),
        "\t}",
        "}",
    ].join("\n");
}
function childPath(field) {
    return `collections.Child(path, ${JSON.stringify(field.name)})...`;
}
function recursiveMethods(model, descriptor) {
    const recursiveFields = model.fields.filter(field => isRecursive(descriptor, model, field));
    return recursiveFields.map(field => {
        const targetName = singularMessageNameOf(field);
        return [
            `func (handles ${handleTypeName(model.name)}) ${goFieldName(model.name, field.name)}() ${handleTypeName(targetName)} {`,
            `\treturn ${handleConstructorName(targetName)}(collections.Child(handles.path, ${JSON.stringify(field.name)})...)`,
            "}",
        ].join("\n");
    });
}
function fieldHandle(model, field, imports) {
    const wholeType = fieldValueType(field, oneofTypeName(model.name, field.name), imports);
    if (field.container.kind === "singular")
        return singularHandle(field.value, wholeType, imports);
    const element = elementHandle(field.value, imports);
    if (element === null)
        return valueHandle(wholeType);
    return {
        type: `collections.ListField[${wholeType}, ${element.type}]`,
        build: path => `collections.NewListField[${wholeType}](${element.constructorName}, ${path})`,
    };
}
function singularHandle(value, wholeType, imports) {
    const element = elementHandle(value, imports);
    if (element !== null)
        return fromElement(element);
    if (value.kind === "scalar" && value.scalar === "bytes")
        return fromElement({ type: "collections.BytesField", constructorName: "collections.NewBytesField" });
    return valueHandle(wholeType);
}
/** The handle of a field the queries cannot filter on: it only sets and clears the value. */
function valueHandle(wholeType) {
    return fromElement({ type: `collections.ValueField[${wholeType}]`, constructorName: `collections.NewValueField[${wholeType}]` });
}
function fromElement(element) {
    return { type: element.type, build: path => `${element.constructorName}(${path})` };
}
/** The handle of a single value that queries can filter on, or null. */
function elementHandle(value, imports) {
    switch (value.kind) {
        case "scalar": return scalarHandle(value.scalar, imports);
        case "ref": return { type: "collections.RefField", constructorName: "collections.NewRefField" };
        case "decimal": return { type: "collections.StringField", constructorName: "collections.NewStringField" };
        case "file": return { type: "collections.FileField", constructorName: "collections.NewFileField" };
        case "enum": return enumHandle(value.name);
        case "message": return { type: handleTypeName(value.name), constructorName: handleConstructorName(value.name) };
        case "oneof": return null;
    }
}
function enumHandle(enumName) {
    return { type: `collections.EnumField[${enumName}]`, constructorName: `collections.NewEnumField[${enumName}]` };
}
function scalarHandle(scalar, imports) {
    if (scalar === "bool")
        return { type: "collections.BoolField", constructorName: "collections.NewBoolField" };
    if (scalar === "timestamp")
        return { type: "collections.TimeField", constructorName: "collections.NewTimeField" };
    if (TEXT_SCALARS.has(scalar))
        return { type: "collections.StringField", constructorName: "collections.NewStringField" };
    if (!NUMBER_SCALARS.has(scalar))
        return null;
    const numberType = nativeScalarType(scalar, imports);
    return { type: `collections.NumberField[${numberType}]`, constructorName: `collections.NewNumberField[${numberType}]` };
}
//# sourceMappingURL=goCollectionHandles.js.map