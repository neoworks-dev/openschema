// src/emit/go/goCollectionTables.ts
// What an app opens: the collection's name, version and scopes, the descriptor, the `Tables`
// struct with one table per @neoworks.table model, and `Open`.

import type { CollectionIdentity } from "../../registry/collectionName.js";
import { referencesOf } from "../collection/collectionEmitter.js";
import { pluralize } from "../collection/pluralize.js";
import type { SchemaDescriptor } from "../descriptor/descriptorTypes.js";
import { COLLECTIONS_IMPORT, GoImports, VAULT_IMPORT } from "./goCollectionTypes.js";
import { alignRows, exported } from "./goFormat.js";
import { GoTargetError } from "./goTargetError.js";

/** Names the generated file declares besides the schema's types. */
export const FILE_LEVEL_NAMES: readonly string[] = ["Collection", "SchemaVersion", "Scopes", "Schema", "Tables", "Open"];

/** `Photo` is `Photos`, `AlbumPhoto` is `AlbumPhotos`; the SDK's resource name with a capital. */
export function tableFieldName(modelName: string): string {
  return exported(pluralize(`${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`));
}

export function tableFieldNames(descriptor: SchemaDescriptor): string[] {
  return descriptor.tables.map(table => tableFieldName(table.model));
}

function rejectDuplicateTableNames(descriptor: SchemaDescriptor): void {
  const seen = new Map<string, string>();
  for (const table of descriptor.tables) {
    const name = tableFieldName(table.model);
    const other = seen.get(name);
    if (other !== undefined) {
      throw new GoTargetError(`the tables ${other} and ${table.model} both become the field ${name} of Tables; rename one`);
    }
    seen.set(name, table.model);
  }
}

/** A Go string literal; JSON strings are valid Go interpreted string literals. */
function goString(text: string): string {
  return JSON.stringify(text);
}

export function constantsSource(identity: CollectionIdentity, scopes: string[]): string {
  const constants = alignRows([
    ["Collection", `= ${goString(identity.name)}`],
    ["SchemaVersion", `= ${goString(identity.version)}`],
  ]);
  const scopeLines = scopes.map(scope => `\t${goString(`${identity.name}:${scope}`)},`);
  return [
    "const (",
    ...constants.map(line => `\t${line}`),
    ")",
    "",
    "// Scopes are what an app requests to use the collection.",
    "var Scopes = []string{",
    ...scopeLines,
    "}",
  ].join("\n");
}

/** The descriptor text as it is published, in a raw string when that can hold it unchanged. */
function descriptorBytes(publishedDescriptor: string): string {
  if (publishedDescriptor.includes("`") || publishedDescriptor.includes("\r")) {
    return `[]byte(${goString(publishedDescriptor)}),`;
  }
  return `[]byte(\`${publishedDescriptor}\`),`;
}

// The descriptor spans lines, and gofmt does not align the key of a multi-line value with the keys
// above it, so it comes last and on its own.
export function schemaSource(publishedDescriptor: string): string {
  const rows = [
    ["Name:", "Collection,"],
    ["Version:", "SchemaVersion,"],
    ["Scopes:", "Scopes,"],
  ];
  return [
    "// Schema is the collection as the SDK opens it.",
    "var Schema = collections.Schema{",
    ...alignRows(rows).map(line => `\t${line}`),
    `\tDescriptor: ${descriptorBytes(publishedDescriptor)}`,
    "}",
  ].join("\n");
}

export function tablesSource(descriptor: SchemaDescriptor, imports: GoImports): string {
  rejectDuplicateTableNames(descriptor);
  imports.add(COLLECTIONS_IMPORT);
  imports.add(VAULT_IMPORT);
  const rows = descriptor.tables.map(table => [tableFieldName(table.model), `*collections.Table[${table.model}]`]);
  const structure = ["// Tables holds one table per model of the collection.", "type Tables struct {", ...alignRows(rows).map(line => `\t${line}`), "}"];
  return [...structure, "", ...openSource(descriptor)].join("\n");
}

function openSource(descriptor: SchemaDescriptor): string[] {
  const rows = descriptor.tables.map(table => [`${tableFieldName(table.model)}:`, `${newTable(table.model, descriptor)},`]);
  return [
    "// Open opens the collection in the vault and returns its tables.",
    "func Open(v *vault.Vault, options ...collections.Option) (*Tables, error) {",
    "\tcollection, err := collections.Open(v, Schema, options...)",
    "\tif err != nil {",
    "\t\treturn nil, err",
    "\t}",
    "\treturn &Tables{",
    ...alignRows(rows).map(line => `\t\t${line}`),
    "\t}, nil",
    "}",
  ];
}

function newTable(modelName: string, descriptor: SchemaDescriptor): string {
  return `collections.NewTable[${modelName}](collection, ${tableDefinition(modelName, descriptor)})`;
}

function tableDefinition(modelName: string, descriptor: SchemaDescriptor): string {
  const fields = [`Model: ${goString(modelName)}`];
  const targets = referencesOf(descriptor).get(modelName);
  if (targets !== undefined) {
    const entries = [...targets].map(([field, target]) => `${goString(field)}: ${goString(target)}`);
    fields.push(`References: map[string]string{${entries.join(", ")}}`);
  }
  return `collections.TableDefinition{${fields.join(", ")}}`;
}
