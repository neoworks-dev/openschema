// src/emit/kotlin/kotlinEmitter.ts
// The `kotlin` target: `@Serializable` classes for the models of a schema, in the descriptor's
// JSON mapping, and, when the schema is a collection, the object the Kotlin SDK takes. The files
// are laid out as a source root, so `generated/kotlin` can be added to a Gradle source set.
import { buildDescriptor, definesNeoworksTables, publishedDescriptor } from "../descriptor/descriptorEmitter.js";
import { COLLECTION_OPTION, COLLECTION_VERSION_OPTION } from "../collection/collectionEmitter.js";
import { MODELS_IMPORTS, declaredTypeNames, modelsSource } from "./kotlinModels.js";
import { packageDirectory, packageSegment } from "./kotlinNames.js";
import { HEADER, IMPORTED_NAMES, MODEL_RUNTIME_NAMES, SCHEMA_PACKAGE, importLines } from "./kotlinRuntime.js";
import { queriesSource, queryClassNames } from "./kotlinQueries.js";
import { rowAccessorsSource } from "./kotlinRowAccessors.js";
import { collectionClassName, collectionSource } from "./kotlinCollection.js";
import { updateClassNames, updatesSource } from "./kotlinUpdates.js";
import { schemaObjectName, schemaObjectSource } from "./kotlinSchemaObject.js";
import { KotlinTargetError } from "./kotlinTargetError.js";
export const SOURCE_ROOT = "kotlin";
/** The context option naming the Kotlin package; without it the package follows the collection name. */
export const PACKAGE_OPTION = "package";
const PACKAGE_PREFIX = "dev.neoworks.schemas";
export { KotlinTargetError };
export const kotlinEmitter = {
    target: "kotlin",
    fileExtension: "kt",
    emit(context) {
        const descriptor = buildDescriptor({ ...context, company: null });
        const identity = collectionIdentityOf(context);
        rejectNameCollisions(descriptor, identity);
        const packageName = packageNameOf(context, identity);
        const files = [sourceFile(packageName, "Models.kt", modelsFile(descriptor, packageName))];
        files.push(...queryFiles(descriptor, packageName));
        if (identity === null)
            return files;
        const schemaSource = schemaObjectSource(identity, publishedDescriptor(context.schema), descriptor, packageName);
        files.push(sourceFile(packageName, `${schemaObjectName(identity)}.kt`, schemaSource));
        const collectionFile = `${collectionClassName(identity)}.kt`;
        files.push(sourceFile(packageName, collectionFile, collectionSource(identity, descriptor, packageName)));
        return files;
    },
};
function sourceFile(packageName, fileName, contents) {
    return { path: `${SOURCE_ROOT}/${packageDirectory(packageName)}/${fileName}`, contents };
}
function modelsFile(descriptor, packageName) {
    const imports = [...importLines(SCHEMA_PACKAGE, MODEL_RUNTIME_NAMES), ...MODELS_IMPORTS.map(name => `import ${name}`)];
    return `${HEADER}\npackage ${packageName}\n\n${imports.join("\n")}\n\n${modelsSource(descriptor, packageName)}\n`;
}
/** The query classes and row accessors of the tables; a schema without tables has none. */
function queryFiles(descriptor, packageName) {
    if (descriptor.tables.length === 0)
        return [];
    const files = [sourceFile(packageName, "Queries.kt", queriesSource(descriptor, packageName))];
    files.push(sourceFile(packageName, "Updates.kt", updatesSource(descriptor, packageName)));
    const accessors = rowAccessorsSource(descriptor, packageName);
    if (accessors !== null)
        files.push(sourceFile(packageName, "RowAccessors.kt", accessors));
    return files;
}
/** The collection the schema is published as: a schema with @neoworks.table models and a manifest. */
function collectionIdentityOf(context) {
    const name = context.options[COLLECTION_OPTION];
    const version = context.options[COLLECTION_VERSION_OPTION];
    if (name === undefined || version === undefined)
        return null;
    if (!definesNeoworksTables(context.schema))
        return null;
    return { name, version };
}
function packageNameOf(context, identity) {
    const configured = context.options[PACKAGE_OPTION];
    if (configured !== undefined)
        return configured;
    if (identity !== null)
        return `${PACKAGE_PREFIX}.${packageSegment(identity.name)}`;
    if (context.schema.namespace.length === 0)
        return "schema";
    return context.schema.namespace.join(".");
}
function rejectNameCollisions(descriptor, identity) {
    const seen = new Set(IMPORTED_NAMES);
    const generatedNames = [...declaredTypeNames(descriptor), ...queryClassNames(descriptor), ...updateClassNames(descriptor)];
    if (identity !== null)
        generatedNames.push(collectionClassName(identity), schemaObjectName(identity));
    for (const name of generatedNames) {
        if (seen.has(name)) {
            throw new KotlinTargetError(`the Kotlin type ${name} is declared twice; rename the model or enum, or the field that names a oneof`);
        }
        seen.add(name);
    }
}
//# sourceMappingURL=kotlinEmitter.js.map