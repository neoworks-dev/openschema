// src/emit/go/goFormat.ts
// Text helpers shared by the Go targets: the column alignment gofmt applies, doc comments and
// exported names.
/** Pads every cell but the last of each row to its column's width, as gofmt's tabwriter does. */
export function alignRows(rows) {
    const widths = [];
    for (const row of rows) {
        row.slice(0, -1).forEach((cell, column) => {
            widths[column] = Math.max(widths[column] ?? 0, cell.length);
        });
    }
    return rows.map(row => row.map((cell, column) => padCell(cell, column, row.length, widths)).join(" "));
}
function padCell(cell, column, rowLength, widths) {
    if (column === rowLength - 1)
        return cell;
    return cell.padEnd(widths[column]);
}
export function docLines(doc, indent) {
    if (doc === null || doc.trim() === "")
        return [];
    return doc.split("\n").map(line => `${indent}// ${line.trim()}`.trimEnd());
}
// Go exports only capitalised identifiers; the rest of the name stays as written.
export function exported(name) {
    if (name.length === 0)
        return name;
    return name.charAt(0).toUpperCase() + name.slice(1);
}
//# sourceMappingURL=goFormat.js.map