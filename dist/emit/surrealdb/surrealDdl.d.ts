import type { ResolvedModel, ResolvedField, ResolvedSchema } from "../../resolver/types.js";
export declare function tableNameFor(record: ResolvedModel): string;
export declare function surrealFieldName(field: ResolvedField, fallbackName?: string): string;
/** The `DEFINE FIELD … ;` line for a field. `fieldName` is the logical name
 * (overridable by @surreal.field). */
export declare function renderFieldDefine(tableName: string, fieldName: string, field: ResolvedField, schema: ResolvedSchema): string;
/** The `DEFINE INDEX … UNIQUE;` line for a unique/pk field, or null. */
export declare function renderFieldIndex(tableName: string, fieldName: string, field: ResolvedField): string | null;
/** Both lines a field contributes to a table definition, in order. A field whose
 * type is an embedded value object expands into a typed nested object instead. */
export declare function renderField(tableName: string, fieldName: string, field: ResolvedField, schema: ResolvedSchema, seen?: Set<string>): string[];
/** Local names of every model embedded somewhere as a value object. The schema
 * emitter skips these: they live inside their host tables, not as tables. A model
 * that is @link'd anywhere is an entity (it owns the table the link points at), so
 * it is excluded even if some other field embeds it. */
export declare function collectEmbeddedModels(schema: ResolvedSchema): Set<string>;
/** Render a full DEFINE TABLE + fields — reused by the schema emitter and the
 * migration emitter's CreateModel op. */
export declare function renderCreateTable(record: ResolvedModel, schema: ResolvedSchema, company: string | null, includePrivate: boolean): string;
//# sourceMappingURL=surrealDdl.d.ts.map