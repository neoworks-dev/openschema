// src/emit/kotlin/kotlinEmitter.ts
// The `kotlin` target: `@Serializable` classes for the models of a schema, in the descriptor's
// JSON mapping, and, when the schema is a collection, the object the Kotlin SDK takes. The files
// are laid out as a source root, so `generated/kotlin` can be added to a Gradle source set.

import { buildDescriptor, definesNeoworksTables, publishedDescriptor } from "../descriptor/descriptorEmitter.js";
import type { SchemaDescriptor } from "../descriptor/descriptorTypes.js";
import { COLLECTION_OPTION, COLLECTION_VERSION_OPTION } from "../collection/collectionEmitter.js";
import type { EmitContext, Emitter, OutputFile } from "../types.js";
import { MODELS_IMPORTS, declaredTypeNames, modelsSource } from "./kotlinModels.js";
import { packageDirectory, packageSegment } from "./kotlinNames.js";
import { HEADER, RUNTIME_NAMES, runtimeSource } from "./kotlinRuntime.js";
import type { CollectionIdentity } from "../../registry/collectionName.js";
import { schemaObjectName, schemaObjectSource } from "./kotlinSchemaObject.js";

export const SOURCE_ROOT = "kotlin";

/** The context option naming the Kotlin package; without it the package follows the collection name. */
export const PACKAGE_OPTION = "package";

const PACKAGE_PREFIX = "dev.neoworks.schemas";

export class KotlinTargetError extends Error {}

export const kotlinEmitter: Emitter = {
  target: "kotlin",
  fileExtension: "kt",

  emit(context: EmitContext): OutputFile[] {
    const descriptor = buildDescriptor({ ...context, company: null });
    rejectNameCollisions(descriptor);
    const identity = collectionIdentityOf(context);
    const packageName = packageNameOf(context, identity);
    const files = [
      sourceFile(packageName, "Models.kt", modelsFile(descriptor, packageName)),
      sourceFile(packageName, "Runtime.kt", runtimeSource(packageName)),
    ];
    if (identity === null) return files;
    const schemaSource = schemaObjectSource(identity, publishedDescriptor(context.schema), descriptor, packageName);
    files.push(sourceFile(packageName, `${schemaObjectName(identity)}.kt`, schemaSource));
    return files;
  },
};

function sourceFile(packageName: string, fileName: string, contents: string): OutputFile {
  return { path: `${SOURCE_ROOT}/${packageDirectory(packageName)}/${fileName}`, contents };
}

function modelsFile(descriptor: SchemaDescriptor, packageName: string): string {
  const imports = MODELS_IMPORTS.map(name => `import ${name}`).join("\n");
  return `${HEADER}\npackage ${packageName}\n\n${imports}\n\n${modelsSource(descriptor, packageName)}\n`;
}

/** The collection the schema is published as: a schema with @neoworks.table models and a manifest. */
function collectionIdentityOf(context: EmitContext): CollectionIdentity | null {
  const name = context.options[COLLECTION_OPTION];
  const version = context.options[COLLECTION_VERSION_OPTION];
  if (name === undefined || version === undefined) return null;
  if (!definesNeoworksTables(context.schema)) return null;
  return { name, version };
}

function packageNameOf(context: EmitContext, identity: CollectionIdentity | null): string {
  const configured = context.options[PACKAGE_OPTION];
  if (configured !== undefined) return configured;
  if (identity !== null) return `${PACKAGE_PREFIX}.${packageSegment(identity.name)}`;
  if (context.schema.namespace.length === 0) return "schema";
  return context.schema.namespace.join(".");
}

function rejectNameCollisions(descriptor: SchemaDescriptor): void {
  const seen = new Set<string>(RUNTIME_NAMES);
  for (const name of declaredTypeNames(descriptor)) {
    if (seen.has(name)) {
      throw new KotlinTargetError(`the Kotlin type ${name} is declared twice; rename the model or enum, or the field that names a oneof`);
    }
    seen.add(name);
  }
}
