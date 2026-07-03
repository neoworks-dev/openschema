// src/lsp/symbols.ts
// Build the document outline (DocumentSymbol tree) from a parsed Program.
import { SymbolKind } from "vscode-languageserver";
import { spanToRange } from "./positions.js";
export function documentSymbols(text, program) {
    const symbols = [];
    for (const decl of program.declarations) {
        const symbol = declSymbol(text, decl);
        if (symbol !== null)
            symbols.push(symbol);
    }
    return symbols;
}
function declSymbol(text, decl) {
    if (decl.kind === "model") {
        return container(text, decl.name, SymbolKind.Class, decl.span, fieldSymbols(text, decl.members));
    }
    if (decl.kind === "overlay") {
        const name = `overlay ${decl.company} on ${decl.base.join(".")}`;
        return container(text, name, SymbolKind.Namespace, decl.span, fieldSymbols(text, decl.fields));
    }
    if (decl.kind === "enum") {
        const variants = decl.variants.map(variant => leaf(text, `${variant.ordinal} ${variant.name}`, SymbolKind.EnumMember, variant.span));
        return container(text, decl.name, SymbolKind.Enum, decl.span, variants);
    }
    if (decl.kind === "type_alias") {
        return leaf(text, decl.name, SymbolKind.Interface, decl.span);
    }
    if (decl.kind === "operation") {
        return leaf(text, decl.name, SymbolKind.Function, decl.span);
    }
    if (decl.kind === "interface") {
        const ops = decl.operations.map(op => leaf(text, op.name, SymbolKind.Method, op.span));
        return container(text, decl.name, SymbolKind.Interface, decl.span, ops);
    }
    return null; // namespace and import declarations are not outline-worthy
}
function fieldSymbols(text, fields) {
    return fields.map(field => {
        const label = field.ordinal === null ? field.name : `${field.ordinal} ${field.name}`;
        return leaf(text, label, SymbolKind.Field, field.span);
    });
}
function container(text, name, kind, span, children) {
    const range = spanToRange(text, span);
    return { name, kind, range, selectionRange: range, children };
}
function leaf(text, name, kind, span) {
    const range = spanToRange(text, span);
    return { name, kind, range, selectionRange: range };
}
//# sourceMappingURL=symbols.js.map