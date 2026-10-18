// src/emit/kotlin/kotlinCollection.ts
// The class `neoworks.collection(Schema)` returns: one `TableResource` property per table, named like
// the TypeScript SDK names its resources (`Photo` is `photos`, `AlbumPhoto` is `albumPhotos`).
import { identifier, pascalCase } from "./kotlinNames.js";
import { HEADER, COLLECTIONS_PACKAGE } from "./kotlinRuntime.js";
import { KotlinTargetError } from "./kotlinTargetError.js";
import { includeClassName, orderByClassName, whereClassName } from "./kotlinQueries.js";
import { schemaObjectName, tableDefinitionName } from "./kotlinSchemaObject.js";
import { updateClassName } from "./kotlinUpdates.js";
const CONSONANT_BEFORE_Y = /[bcdfghjklmnpqrstvwxz]y$/;
const SIBILANT_ENDING = /(s|x|z|ch|sh)$/;
/** The plural of the last word of a camel-cased name: `memory` is `memories`, `address` is `addresses`. */
export function pluralize(name) {
    if (CONSONANT_BEFORE_Y.test(name))
        return `${name.slice(0, -1)}ies`;
    if (SIBILANT_ENDING.test(name))
        return `${name}es`;
    return `${name}s`;
}
/** `@neoworks/contacts` is `ContactsCollection`. */
export function collectionClassName(identity) {
    const collection = identity.name.slice(identity.name.indexOf("/") + 1);
    return `${pascalCase(collection)}Collection`;
}
/** `Photo` is `photos`, `AlbumPhoto` is `albumPhotos`. */
export function resourceName(modelName) {
    return pluralize(`${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`);
}
export function collectionSource(identity, descriptor, packageName) {
    const imports = [
        `import ${COLLECTIONS_PACKAGE}.CollectionTables`,
        `import ${COLLECTIONS_PACKAGE}.TableResource`,
    ];
    const properties = descriptor.tables.map(table => resourceProperty(table.model, identity));
    rejectDuplicateNames(descriptor);
    return [
        HEADER,
        `package ${packageName}`,
        "",
        ...imports,
        "",
        `class ${collectionClassName(identity)} internal constructor(tables: CollectionTables) {`,
        ...properties,
        "}",
        "",
    ].join("\n");
}
function resourceProperty(modelName, identity) {
    const types = [modelName, whereClassName(modelName), orderByClassName(modelName), includeClassName(modelName), updateClassName(modelName)];
    const resourceType = `TableResource<${types.join(", ")}>`;
    const definition = `${schemaObjectName(identity)}.${tableDefinitionName(modelName)}`;
    return `    val ${identifier(resourceName(modelName))}: ${resourceType} = tables.table(${definition})`;
}
function rejectDuplicateNames(descriptor) {
    const seen = new Map();
    for (const table of descriptor.tables) {
        const name = resourceName(table.model);
        const other = seen.get(name);
        if (other !== undefined) {
            throw new KotlinTargetError(`the tables ${other} and ${table.model} both become the collection property ${name}; rename one`);
        }
        seen.set(name, table.model);
    }
}
//# sourceMappingURL=kotlinCollection.js.map