// src/emit/kotlin/kotlinUpdates.ts
// The class an `update(id) { ... }` lambda runs in, one per table: a property per field that records
// the assignment, so the SDK writes only the fields the lambda names.
import { identifier } from "./kotlinNames.js";
import { HEADER, SCHEMA_PACKAGE } from "./kotlinRuntime.js";
import { KotlinTargetError } from "./kotlinTargetError.js";
import { fieldSerializer, oneofTypeName, plainFieldType } from "./kotlinTypes.js";
/** The member of the SDK's `Update` that a field of the same name would call itself instead of. */
const UPDATE_FIELD_FUNCTION = "updateField";
export function updateClassName(modelName) {
    return `${modelName}Update`;
}
/** The names of the update classes a schema declares, for collision checks. */
export function updateClassNames(descriptor) {
    return descriptor.tables.map(table => updateClassName(table.model));
}
export function updatesSource(descriptor, packageName) {
    const imports = [
        `import ${SCHEMA_PACKAGE}.Update`,
        "import kotlinx.serialization.builtins.ListSerializer",
        "import kotlinx.serialization.builtins.MapSerializer",
        "import kotlinx.serialization.builtins.nullable",
        "import kotlinx.serialization.serializer",
        ...runtimeImports(),
    ];
    const classes = descriptor.tables.map(table => updateClass(modelNamed(descriptor, table.model)));
    return `${HEADER}\npackage ${packageName}\n\n${imports.join("\n")}\n\n${classes.join("\n\n")}\n`;
}
/** The SDK's serializers and value types, and the platform types, that the field types of a table can name. */
function runtimeImports() {
    const names = ["Base64UrlBytesSerializer", "File", "Int64AsTextSerializer", "Semver", "TimestampSerializer", "UInt64AsTextSerializer"];
    return [
        ...names.map(name => `import ${SCHEMA_PACKAGE}.${name}`),
        "import kotlin.time.Instant",
        "import kotlinx.serialization.json.JsonElement",
    ];
}
function modelNamed(descriptor, modelName) {
    const model = descriptor.models.find(candidate => candidate.name === modelName);
    if (model === undefined)
        throw new KotlinTargetError(`the descriptor has no model ${modelName}`);
    return model;
}
function updateClass(model) {
    const className = updateClassName(model.name);
    const properties = model.fields.map(field => updateProperty(model.name, field));
    if (properties.length === 0)
        return `class ${className} : Update()`;
    return `class ${className} : Update() {\n${properties.join("\n")}\n}`;
}
function updateProperty(modelName, field) {
    if (field.name === UPDATE_FIELD_FUNCTION) {
        throw new KotlinTargetError(`the field ${modelName}.${field.name} would hide a member of the Kotlin update class; rename it`);
    }
    const oneofName = oneofTypeName(modelName, field.name);
    const type = plainFieldType(field, oneofName);
    const serializer = fieldSerializer(field, oneofName);
    return `    var ${identifier(field.name)}: ${type} by ${UPDATE_FIELD_FUNCTION}(${JSON.stringify(field.name)}, ${serializer})`;
}
//# sourceMappingURL=kotlinUpdates.js.map