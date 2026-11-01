import type { ResolvedField, ResolvedModel } from "../../resolver/types.js";
import { type QuoteIdentifier } from "./sqlDdl.js";
/** One index of a table. */
export interface TableIndex {
    name: string;
    table: string;
    unique: boolean;
    fields: ResolvedField[];
    columns: string[];
}
/** The indexes a model declares, in declaration order. Throws on an unknown field. */
export declare function tableIndexes(record: ResolvedModel): TableIndex[];
/** `CREATE [UNIQUE] INDEX name ON table (a, b);` — the same in PostgreSQL and SQLite but for quoting. */
export declare function renderCreateIndex(index: TableIndex, quote: QuoteIdentifier): string;
/** `DROP INDEX name;` */
export declare function renderDropIndex(index: TableIndex, quote: QuoteIdentifier): string;
/** A key that changes whenever anything about the index does. */
export declare function indexIdentity(index: TableIndex): string;
//# sourceMappingURL=sqlIndexes.d.ts.map