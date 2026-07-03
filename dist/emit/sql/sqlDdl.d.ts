import type { ResolvedModel, ResolvedField, ResolvedSchema } from "../../resolver/types.js";
import type { TypeExpr, ScalarKind, Decorator, Expr, EnumDecl } from "../../parser/ast.js";
export declare const SCALAR_SQL: Record<ScalarKind, string>;
export declare function tableNameFor(record: ResolvedModel): string;
/** The physical column name: explicit @sql.column, else snake_cased field name. */
export declare function sqlColumnName(field: ResolvedField, fallbackName?: string): string;
export declare function columnDefinition(columnName: string, field: ResolvedField, schema: ResolvedSchema): string;
export declare function columnTypeFor(type: TypeExpr, decorators: Decorator[], schema: ResolvedSchema): string;
/** The PostgreSQL native enum type name for a DSL enum. */
export declare function enumTypeName(localName: string): string;
/** `CREATE TYPE <name> AS ENUM ('a', 'b');` for a native PostgreSQL enum. */
export declare function renderCreateEnum(decl: EnumDecl): string;
export declare function defaultClauseFor(decorators: Decorator[]): string | null;
export declare function checkClauseFor(decorators: Decorator[]): string | null;
export declare function referencesClauseFor(decorators: Decorator[]): string | null;
export declare function exprToSql(expr: Expr): string;
/** Render a full CREATE TABLE — reused by the CREATE emitter and the migration
 * emitter's CreateModel op. Overlay columns are namespaced by company. */
export declare function renderCreateTable(record: ResolvedModel, schema: ResolvedSchema, company: string | null, includePrivate: boolean): string;
//# sourceMappingURL=sqlDdl.d.ts.map