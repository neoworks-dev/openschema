import type { ResolvedModel, ResolvedField, ResolvedSchema } from "../../resolver/types.js";
import type { TypeExpr, ScalarKind, Decorator, EnumDecl } from "../../parser/ast.js";
export declare const SCALAR_SQLITE: Record<ScalarKind, string>;
/** The `CREATE TABLE` for a model, optionally under another name (for table rebuilds). */
export declare function renderCreateTableSqlite(record: ResolvedModel, schema: ResolvedSchema, company: string | null, includePrivate: boolean, tableName?: string): string;
/** A physical column of a table: its name and the field it stores. */
export interface SqliteColumn {
    name: string;
    field: ResolvedField;
    fromOverlay: boolean;
}
/** The columns of a model's table in order, overlay columns (prefixed by company) last. */
export declare function sqliteColumns(record: ResolvedModel, schema: ResolvedSchema, company: string | null, includePrivate: boolean): SqliteColumn[];
/** The physical column name, unquoted: explicit @sql.column, else the field name as written. */
export declare function sqliteColumnName(field: ResolvedField): string;
/** One column definition, e.g. `status TEXT NOT NULL CHECK (status IN ('a', 'b'))`. */
export declare function sqliteColumnDefinition(columnName: string, field: ResolvedField, schema: ResolvedSchema): string;
/** The SQLite column type a field type renders to, ignoring its CHECK. */
export declare function sqliteColumnType(type: TypeExpr, decorators: Decorator[], schema: ResolvedSchema): string;
/** The enum declaration with this local name, or null. */
export declare function enumDeclByLocalName(localName: string, schema: ResolvedSchema): EnumDecl | null;
/**
 * `DEFAULT …` in SQLite form. Literals stay bare; any other expression must be
 * parenthesised, and `now()` becomes an ISO 8601 UTC timestamp.
 */
export declare function sqliteDefaultClause(decorators: Decorator[]): string | null;
/**
 * True when SQLite's ADD COLUMN cannot add this field: it forbids PRIMARY KEY,
 * UNIQUE and parenthesised (non-constant) defaults, a NOT NULL column without a
 * default, and a NOT NULL foreign key.
 */
export declare function needsRebuildToAdd(field: ResolvedField, schema: ResolvedSchema): boolean;
/** A single-quoted SQLite string literal. */
export declare function sqliteString(text: string): string;
//# sourceMappingURL=sqliteDdl.d.ts.map