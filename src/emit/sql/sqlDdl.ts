// src/emit/sql/sqlDdl.ts
// Shared PostgreSQL DDL rendering used by both the CREATE-TABLE emitter and the
// migration (ALTER TABLE) emitter, so a column renders identically either way.
// Table, column and type names are the schema's names as written (or their
// @table / @sql.column overrides), quoted where PostgreSQL needs it.

import type { ResolvedModel, ResolvedField, ResolvedSchema } from "../../resolver/types.js";
import type { TypeExpr, ScalarKind, Decorator, Expr, EnumDecl } from "../../parser/ast.js";
import {
  findDecorator, hasDecorator, firstStringArg, decoratorValueToString,
  unwrapNullable, applyLink, modelByLocalName, primaryKeyField,
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
  // @link stores the foreign primary-key value: render the column as the linked
  // model's id type, then add the REFERENCES clause below.
  const { inner, nullable } = unwrapNullable(applyLink(field.type, field, schema));

  const parts: string[] = [quotePostgresIdentifier(columnName), columnTypeFor(inner, field.decorators, schema)];
  if (!nullable) parts.push("NOT NULL");
  if (hasDecorator(field.decorators, "primaryKey")) parts.push("PRIMARY KEY");
  if (hasDecorator(field.decorators, "unique")) parts.push("UNIQUE");

  const defaultClause = defaultClauseFor(field.decorators);
  if (defaultClause !== null) parts.push(defaultClause);

  const referencesClause = referencesClauseFor(field.decorators);
  if (referencesClause !== null) parts.push(referencesClause);

  const linkClause = linkReferencesClause(field, schema);
  if (linkClause !== null) parts.push(linkClause);

  const checkClause = checkClauseFor(field.decorators);
  if (checkClause !== null) parts.push(checkClause);

  return parts.join(" ");
}

// A scalar @link field becomes a foreign key to the linked model's primary key.
// Array links degrade to a JSONB id list (no FK), and an explicit @references
// wins, so both are skipped here.
export function linkReferencesClause(
  field: ResolvedField,
  schema: ResolvedSchema,
  quote: QuoteIdentifier = quotePostgresIdentifier,
): string | null {
  if (!hasDecorator(field.decorators, "link")) return null;
  if (hasDecorator(field.decorators, "references")) return null;

  const { inner } = unwrapNullable(field.type);
  if (inner.kind !== "named") return null;

  const model = modelByLocalName(inner.path[inner.path.length - 1], schema);
  if (model === null) return null;

  const primaryKey = primaryKeyField(model);
  const pkColumn = primaryKey !== null ? sqlColumnName(primaryKey) : "id";
  return `REFERENCES ${quote(tableNameFor(model))}(${quote(pkColumn)})`;
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

/** `REFERENCES Table(column)` for @references(Table.column), names as written. */
export function referencesClauseFor(decorators: Decorator[], quote: QuoteIdentifier = quotePostgresIdentifier): string | null {
  const target = firstStringArg(decorators, "references");
  if (target === null) return null;
  const segments = target.split(".");
  if (segments.length < 2) return `REFERENCES ${quote(target)}`;
  return `REFERENCES ${quote(segments[0])}(${quote(segments[1])})`;
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
