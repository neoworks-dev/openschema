// src/emit/sql/sqlDdl.ts
// Shared PostgreSQL DDL rendering used by both the CREATE-TABLE emitter and the
// migration (ALTER TABLE) emitter, so a column renders identically either way.
// Table, column and type names are the schema's names as written (or their
// @table / @sql.column overrides), quoted where PostgreSQL needs it.

import type { ResolvedModel, ResolvedField, ResolvedSchema } from "../../resolver/types.js";
import type { TypeExpr, ScalarKind, Decorator, Expr, EnumDecl } from "../../parser/ast.js";
import {
  findDecorator, hasDecorator, firstStringArg, decoratorValueToString,
  unwrapNullable, referencedModel, isTableModel,
} from "../typeMapping.js";
import { quotePostgresIdentifier } from "./sqlIdentifiers.js";

/** Renders a bare name as the target dialect needs it. */
export type QuoteIdentifier = (name: string) => string;

export const SCALAR_SQL: Record<ScalarKind, string> = {
  bool: "BOOLEAN",
  i8: "SMALLINT", i16: "SMALLINT", i32: "INTEGER", i64: "BIGINT",
  u8: "SMALLINT", u16: "INTEGER", u32: "BIGINT", u64: "NUMERIC(20)",
  f32: "REAL", f64: "DOUBLE PRECISION",
  string: "TEXT", bytes: "BYTEA", uuid: "UUID", json: "JSONB",
  date: "DATE", time: "TIME", timestamp: "TIMESTAMPTZ", duration: "INTERVAL",
  semver: "TEXT",
};

/** The table name: explicit @table, else the model name as written. */
export function tableNameFor(record: ResolvedModel): string {
  const explicit = firstStringArg(record.decorators, "table");
  if (explicit !== null) return explicit;
  return record.symbol.localName;
}

/** The physical column name: explicit @sql.column, else the field name as written. */
export function sqlColumnName(field: ResolvedField, fallbackName: string = field.name): string {
  const explicit = firstStringArg(field.decorators, "sql.column");
  if (explicit !== null) return explicit;
  return fallbackName;
}

/** The column an overlay field gets: prefixed by its company, so it can never collide with a base field. */
export function overlayColumnName(company: string, field: ResolvedField): string {
  const explicit = firstStringArg(field.decorators, "sql.column");
  if (explicit !== null) return explicit;
  return `${company}_${field.name}`;
}

export function columnDefinition(columnName: string, field: ResolvedField, schema: ResolvedSchema): string {
  const { inner, nullable } = unwrapNullable(field.type);

  const parts: string[] = [quotePostgresIdentifier(columnName), columnTypeFor(inner, field.decorators, schema)];
  if (!nullable) parts.push("NOT NULL");
  if (hasDecorator(field.decorators, "primaryKey")) parts.push("PRIMARY KEY");
  if (hasDecorator(field.decorators, "unique")) parts.push("UNIQUE");

  const defaultClause = defaultClauseFor(field.decorators);
  if (defaultClause !== null) parts.push(defaultClause);

  const foreignKey = referenceForeignKeyClause(field, schema);
  if (foreignKey !== null) parts.push(foreignKey);

  const checkClause = checkClauseFor(field.decorators);
  if (checkClause !== null) parts.push(checkClause);

  return parts.join(" ");
}

/**
 * `REFERENCES "T"(pk)` for a single `ref<T>` whose target has a table and one
 * uuid @primaryKey (a reference is a uuid, so only such a key can match it). A
 * list of references is a JSON id list, and a reference to an abstract model may
 * name a row of any subtype's table, so neither gets one.
 */
export function referenceForeignKeyClause(
  field: ResolvedField,
  schema: ResolvedSchema,
  quote: QuoteIdentifier = quotePostgresIdentifier,
): string | null {
  const target = referencedModel(unwrapNullable(field.type).inner, schema);
  if (target === null || !isTableModel(target)) return null;
  const primaryKey = uuidPrimaryKey(target);
  if (primaryKey === null) return null;
  return `REFERENCES ${quote(tableNameFor(target))}(${quote(sqlColumnName(primaryKey))})`;
}

function uuidPrimaryKey(model: ResolvedModel): ResolvedField | null {
  const primaryKeys = model.fields.filter(candidate => hasDecorator(candidate.decorators, "primaryKey"));
  if (primaryKeys.length !== 1) return null;
  const keyType = unwrapNullable(primaryKeys[0].type).inner;
  if (keyType.kind !== "scalar" || keyType.scalar !== "uuid") return null;
  return primaryKeys[0];
}

export function columnTypeFor(type: TypeExpr, decorators: Decorator[], schema: ResolvedSchema): string {
  const override = firstStringArg(decorators, "sql.type");
  if (override !== null) return override;
  return mapType(type, schema);
}

function mapType(type: TypeExpr, schema: ResolvedSchema): string {
  if (type.kind === "scalar")  return SCALAR_SQL[type.scalar];
  if (type.kind === "decimal") return `NUMERIC(${type.precision}, ${type.scale})`;
  if (type.kind === "named")   return mapNamedType(type.path, schema);
  // arrays, maps, unions, oneof, nested nullable → JSON document column
  return "JSONB";
}

function mapNamedType(path: string[], schema: ResolvedSchema): string {
  const local = path[path.length - 1];
  for (const symbol of schema.enums.values()) {
    if (symbol.localName === local) return enumTypeName(local);
  }
  return "JSONB";
}

/** The PostgreSQL native enum type for a DSL enum: its name as written, quoted as needed. */
export function enumTypeName(localName: string): string {
  return quotePostgresIdentifier(localName);
}

/** `CREATE TYPE <name> AS ENUM ('a', 'b');` for a native PostgreSQL enum. */
export function renderCreateEnum(decl: EnumDecl): string {
  const values = decl.variants.map(variant => `'${variant.name}'`).join(", ");
  return `CREATE TYPE ${enumTypeName(decl.name)} AS ENUM (${values});`;
}

export function defaultClauseFor(decorators: Decorator[]): string | null {
  const decorator = findDecorator(decorators, "default");
  if (decorator === null || decorator.args.length === 0) return null;
  const value = decorator.args[0].value;
  if (value.kind === "expr") return `DEFAULT ${exprToSql(value.expr)}`;
  if (value.kind === "string") return `DEFAULT '${value.value}'`;
  const literal = decoratorValueToString(value);
  if (literal === null) return null;
  return `DEFAULT ${literal}`;
}

export function checkClauseFor(decorators: Decorator[]): string | null {
  const decorator = findDecorator(decorators, "check");
  if (decorator === null || decorator.args.length === 0) return null;
  const value = decorator.args[0].value;
  if (value.kind !== "expr") return null;
  return `CHECK (${exprToSql(value.expr)})`;
}

export function exprToSql(expr: Expr): string {
  if (expr.kind === "literal") {
    if (typeof expr.value === "string") return `'${expr.value}'`;
    return String(expr.value);
  }
  if (expr.kind === "ident") return expr.name;
  if (expr.kind === "call")  return `${expr.callee}(${expr.args.map(exprToSql).join(", ")})`;
  if (expr.kind === "unary") return `${expr.op}${exprToSql(expr.operand)}`;
  return `${exprToSql(expr.left)} ${expr.op} ${exprToSql(expr.right)}`;
}

/** Render a full CREATE TABLE — reused by the CREATE emitter and the migration
 * emitter's CreateModel op. Overlay columns are prefixed by their company. */
export function renderCreateTable(
  record: ResolvedModel,
  schema: ResolvedSchema,
  company: string | null,
  includePrivate: boolean,
): string {
  const lines: string[] = [];

  for (const field of record.fields) {
    if (field.isPrivate && !includePrivate) continue;
    lines.push("  " + columnDefinition(sqlColumnName(field), field, schema));
  }

  if (company !== null) {
    const byCompany = schema.overlays.get(record.symbol.qualifiedName);
    const overlay = byCompany?.get(company);
    if (overlay !== undefined) {
      for (const field of overlay.fields) {
        lines.push("  " + columnDefinition(overlayColumnName(company, field), field, schema));
      }
    }
  }

  return `CREATE TABLE ${quotePostgresIdentifier(tableNameFor(record))} (\n${lines.join(",\n")}\n);`;
}
