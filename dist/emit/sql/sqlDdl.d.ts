import type { ResolvedModel, ResolvedField, ResolvedSchema } from "../../resolver/types.js";
import type { TypeExpr, ScalarKind, Decorator, Expr, EnumDecl } from "../../parser/ast.js";
/** Renders a bare name as the target dialect needs it. */
export type QuoteIdentifier = (name: string) => string;
export declare const SCALAR_SQL: Record<ScalarKind, string>;
/** The table name: explicit @table, else the model name as written. */
export declare function tableNameFor(record: ResolvedModel): string;
/** The physical column name: explicit @sql.column, else the field name as written. */
export declare function sqlColumnName(field: ResolvedField, fallbackName?: string): string;
/** The column an overlay field gets: prefixed by its company, so it can never collide with a base field. */
export declare function overlayColumnName(company: string, field: ResolvedField): string;
export declare function columnDefinition(columnName: string, field: ResolvedField, schema: ResolvedSchema): string;
export declare function linkReferencesClause(field: ResolvedField, schema: ResolvedSchema, quote?: QuoteIdentifier): string | null;
export declare function columnTypeFor(type: TypeExpr, decorators: Decorator[], schema: ResolvedSchema): string;
/** The PostgreSQL native enum type for a DSL enum: its name as written, quoted as needed. */
export declare function enumTypeName(localName: string): string;
/** `CREATE TYPE <name> AS ENUM ('a', 'b');` for a native PostgreSQL enum. */
export declare function renderCreateEnum(decl: EnumDecl): string;
export declare function defaultClauseFor(decorators: Decorator[]): string | null;
export declare function checkClauseFor(decorators: Decorator[]): string | null;
/** `REFERENCES Table(column)` for @references(Table.column), names as written. */
export declare function referencesClauseFor(decorators: Decorator[], quote?: QuoteIdentifier): string | null;
export declare function exprToSql(expr: Expr): string;
/** Render a full CREATE TABLE — reused by the CREATE emitter and the migration
 * emitter's CreateModel op. Overlay columns are prefixed by their company. */
export declare function renderCreateTable(record: ResolvedModel, schema: ResolvedSchema, company: string | null, includePrivate: boolean): string;
//# sourceMappingURL=sqlDdl.d.ts.map