// src/emit/kotlin/kotlinRowAccessors.ts
// An accessor on `Row<Table>` for each single reference field: `row.addressBook` reads the row the
// reference names, which the list that produced the row included.

import { referencesOf } from "../collection/collectionEmitter.js";
import type { SchemaDescriptor } from "../descriptor/descriptorTypes.js";
import { identifier } from "./kotlinNames.js";
import { HEADER, SCHEMA_PACKAGE } from "./kotlinRuntime.js";
import { KotlinTargetError } from "./kotlinTargetError.js";

/** Members of `Row` that an extension property of the same name would never be called over. */
const ROW_MEMBER_NAMES: ReadonlySet<string> = new Set(["id", "content", "meta", "included", "includedRows"]);

export function rowAccessorsSource(descriptor: SchemaDescriptor, packageName: string): string | null {
  const accessors: string[] = [];
  for (const [table, targets] of referencesOf(descriptor)) {
    for (const [fieldName, targetTable] of targets) {
      accessors.push(accessor(table, fieldName, targetTable));
    }
  }
  if (accessors.length === 0) return null;
  const imports = [`import ${SCHEMA_PACKAGE}.Row`, "import kotlin.jvm.JvmName"];
  return `${HEADER}\npackage ${packageName}\n\n${imports.join("\n")}\n\n${accessors.join("\n\n")}\n`;
}

/** The getter is named after the table too, because two tables may have a reference field of the same name. */
function accessor(table: string, fieldName: string, targetTable: string): string {
  if (ROW_MEMBER_NAMES.has(fieldName)) {
    throw new KotlinTargetError(`the reference ${table}.${fieldName} would be hidden by a member of Row; rename the field`);
  }
  const getterName = `${table.charAt(0).toLowerCase()}${table.slice(1)}${fieldName.charAt(0).toUpperCase()}${fieldName.slice(1)}`;
  return [
    `@get:JvmName(${JSON.stringify(getterName)})`,
    `val Row<${table}>.${identifier(fieldName)}: Row<${targetTable}>?`,
    `    get() = included<${targetTable}>(${JSON.stringify(fieldName)})`,
  ].join("\n");
}
