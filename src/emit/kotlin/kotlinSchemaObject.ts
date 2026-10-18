// src/emit/kotlin/kotlinSchemaObject.ts
// The object an app hands to the Kotlin SDK's `collection`: what the TypeScript `SchemaModule` holds.

import type { CollectionIdentity } from "../../registry/collectionName.js";
import { referencesOf } from "../collection/collectionEmitter.js";
import type { SchemaDescriptor } from "../descriptor/descriptorTypes.js";
import { HEADER } from "./kotlinRuntime.js";
import { pascalCase } from "./kotlinNames.js";

/** `@neoworks/contacts` is `ContactsSchema`. */
export function schemaObjectName(identity: CollectionIdentity): string {
  const collection = identity.name.slice(identity.name.indexOf("/") + 1);
  return `${pascalCase(collection)}Schema`;
}

export function schemaObjectSource(
  identity: CollectionIdentity,
  publishedDescriptor: string,
  descriptor: SchemaDescriptor,
  packageName: string,
): string {
  const lines = [
    HEADER,
    `package ${packageName}`,
    "",
    "import kotlinx.serialization.KSerializer",
    "import kotlinx.serialization.serializer",
    "",
    `object ${schemaObjectName(identity)} {`,
    "    /** The registry path of the collection. */",
    `    const val name: String = ${kotlinString(identity.name)}`,
    "",
    "    /** The schema version; every row the app writes records it. */",
    `    const val version: String = ${kotlinString(identity.version)}`,
    "",
    "    /** The descriptor text exactly as the registry publishes it. */",
    `    val descriptor: String = ${kotlinString(publishedDescriptor)}`,
    "",
    "    /** The serializer of each table's content, by model name. */",
    ...tablesBlock(descriptor),
    "",
    "    /** For each table, the table each of its single reference fields points to. */",
    ...referencesBlock(descriptor),
    "}",
    "",
  ];
  return lines.join("\n");
}

function tablesBlock(descriptor: SchemaDescriptor): string[] {
  const entries = descriptor.tables.map(table => `        ${kotlinString(table.model)} to serializer<${table.model}>(),`);
  return ["    val tables: Map<String, KSerializer<*>> = mapOf(", ...entries, "    )"];
}

function referencesBlock(descriptor: SchemaDescriptor): string[] {
  const entries: string[] = [];
  for (const [table, targets] of referencesOf(descriptor)) {
    const fields = [...targets].map(([field, target]) => `${kotlinString(field)} to ${kotlinString(target)}`);
    entries.push(`        ${kotlinString(table)} to mapOf(${fields.join(", ")}),`);
  }
  return ["    val references: Map<String, Map<String, String>> = mapOf(", ...entries, "    )"];
}

/** A one-line Kotlin string literal; `$` is escaped because the descriptor holds patterns that end in it. */
export function kotlinString(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}
