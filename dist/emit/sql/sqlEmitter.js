// src/emit/sql/sqlEmitter.ts
// Emits PostgreSQL CREATE TABLE statements from a resolved schema.
import { isTableModel } from "../typeMapping.js";
import { renderCreateTable, renderCreateEnum } from "./sqlDdl.js";
import { renderCreateIndex, tableIndexes } from "./sqlIndexes.js";
export const sqlEmitter = {
    target: "sql",
    fileExtension: "sql",
    emit(context) {
        const blocks = [];
        // Native enum types must be declared before the tables that use them.
        for (const symbol of context.schema.enums.values()) {
            blocks.push(renderCreateEnum(symbol.decl));
        }
        for (const record of context.schema.records.values()) {
            if (!isTableModel(record))
                continue; // generic, @input and @value models have no table
            blocks.push(renderTable(record, context));
        }
        const contents = blocks.join("\n\n") + "\n";
        return [{ path: `schema.${this.fileExtension}`, contents }];
    },
};
function renderTable(record, context) {
    const table = renderCreateTable(record, context.schema, context.company, context.includePrivate);
    return [table, ...tableIndexes(record).map(renderCreateIndex)].join("\n");
}
//# sourceMappingURL=sqlEmitter.js.map