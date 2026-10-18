// src/emit/kotlin/kotlinSchemaObject.ts
// The object an app hands to the Kotlin SDK's `collection`: what the TypeScript `SchemaModule` holds,
// and for each table the content serializer and the query scopes the SDK runs its lambdas in.

import type { CollectionIdentity } from "../../registry/collectionName.js";
import { referencesOf } from "../collection/collectionEmitter.js";
import type { SchemaDescriptor } from "../descriptor/descriptorTypes.js";
import { HEADER, SCHEMA_PACKAGE, importLines } from "./kotlinRuntime.js";
import { includeClassName, orderByClassName, whereClassName } from "./kotlinQueries.js";
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
  const imports = [
    ...importLines(SCHEMA_PACKAGE, ["CollectionSchema", "TableDefinition"]),
    "import kotlinx.serialization.serializer",
  ];
  const lines = [
    HEADER,
    `package ${packageName}`,
    "",
    ...imports,
    "",
    `object ${schemaObjectName(identity)} : CollectionSchema {`,
    `    override val name: String = ${kotlinString(identity.name)}`,
    "",
    `    override val version: String = ${kotlinString(identity.version)}`,
    "",
    `    override val descriptor: String = ${kotlinString(publishedDescriptor)}`,
    "",
    ...descriptor.tables.flatMap(table => [...tableDefinition(table.model, descriptor), ""]),
    `    override val tables: List<TableDefinition<*, *, *, *>> = listOf(${descriptor.tables.map(table => tableDefinitionName(table.model)).join(", ")})`,
    "}",
    "",
  ];
  return lines.join("\n");
}

/** `Contact` is `contactTable`. */
export function tableDefinitionName(modelName: string): string {
  return `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}Table`;
}

function tableDefinition(modelName: string, descriptor: SchemaDescriptor): string[] {
  return [
    `    val ${tableDefinitionName(modelName)} = TableDefinition(`,
    `        model = ${kotlinString(modelName)},`,
    `        serializer = serializer<${modelName}>(),`,
    `        createWhere = ::${whereClassName(modelName)},`,
    `        createOrderBy = ::${orderByClassName(modelName)},`,
    `        createInclude = ::${includeClassName(modelName)},`,
    `        references = ${referencesExpression(modelName, descriptor)},`,
    "    )",
  ];
}

function referencesExpression(modelName: string, descriptor: SchemaDescriptor): string {
  const targets = referencesOf(descriptor).get(modelName);
  if (targets === undefined) return "emptyMap()";
  const entries = [...targets].map(([field, target]) => `${kotlinString(field)} to ${kotlinString(target)}`);
  return `mapOf(${entries.join(", ")})`;
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
