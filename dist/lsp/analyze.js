// src/lsp/analyze.ts
// Run the real OpenSchema compiler (lexer → parser → resolver) over a document
// and translate its findings into LSP diagnostics. Imports are followed from
// disk so a file that `import`s siblings does not light up with false errors.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { DiagnosticSeverity } from "vscode-languageserver";
import { Lexer, LexError } from "../lexer/lexer.js";
import { Parser, ParseError } from "../parser/parser.js";
import { resolve, resolveModules, loadProject } from "../resolver/index.js";
import { spanToRange } from "./positions.js";
export function analyze(uri, text, liveText) {
    const parsed = parseDocument(text);
    if (parsed.error !== null) {
        return { diagnostics: [parsed.error], schema: null, program: null };
    }
    const program = parsed.program;
    const schema = resolveDocument(uri, program, liveText);
    const diagnostics = collectSchemaDiagnostics(text, program, schema);
    return { diagnostics, schema, program };
}
function parseDocument(text) {
    try {
        const tokens = new Lexer(text).tokenize();
        const program = new Parser(tokens).parse();
        return { program, error: null };
    }
    catch (error) {
        return { program: { declarations: [] }, error: syntaxDiagnostic(text, error) };
    }
}
function syntaxDiagnostic(text, error) {
    if (error instanceof LexError) {
        return makeDiagnostic(text, { line: error.line, col: error.col }, "lex", error.message, DiagnosticSeverity.Error);
    }
    if (error instanceof ParseError) {
        return makeDiagnostic(text, { line: error.token.line, col: error.token.col }, "parse", error.message, DiagnosticSeverity.Error);
    }
    const message = error instanceof Error ? error.message : String(error);
    return makeDiagnostic(text, { line: 1, col: 1 }, "parse", message, DiagnosticSeverity.Error);
}
// ── Resolution (multi-module when possible) ─────────────────────────────────────
function resolveDocument(uri, program, liveText) {
    const entryPath = uriToPath(uri);
    if (entryPath === null)
        return resolve(program);
    try {
        const modules = loadProject(entryPath, makeReader(entryPath, text => text, liveText));
        return resolveModules(modules);
    }
    catch {
        // A syntax error in an imported file (or an unreadable entry) — fall back to
        // resolving this file alone so the editor still gets local diagnostics.
        return resolve(program);
    }
}
function makeReader(entryPath, _entryText, liveText) {
    return path => {
        const live = liveText(path);
        if (live !== null)
            return live;
        try {
            return readFileSync(path, "utf8");
        }
        catch {
            return null;
        }
    };
}
function uriToPath(uri) {
    if (!uri.startsWith("file:"))
        return null;
    try {
        return fileURLToPath(uri);
    }
    catch {
        return null;
    }
}
// ── Diagnostic attribution ──────────────────────────────────────────────────────
// Resolver diagnostics are not tagged with a source file. To keep multi-file
// projects honest, only surface diagnostics whose span points at a node that
// belongs to THIS document.
function collectSchemaDiagnostics(text, program, schema) {
    const localPoints = collectSpanPoints(program);
    const result = [];
    for (const diagnostic of schema.diagnostics) {
        if (!belongsToDocument(diagnostic.span, localPoints))
            continue;
        result.push(fromResolverDiagnostic(text, diagnostic));
    }
    return result;
}
function belongsToDocument(span, localPoints) {
    if (span === null)
        return true; // file-level diagnostics attach to the open file
    return localPoints.has(pointKey(span));
}
function fromResolverDiagnostic(text, diagnostic) {
    const point = diagnostic.span ?? { line: 1, col: 1 };
    const severity = diagnostic.severity === "warning" ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error;
    return makeDiagnostic(text, point, diagnostic.code, diagnostic.message, severity);
}
function makeDiagnostic(text, point, code, message, severity) {
    return {
        range: spanToRange(text, point),
        severity,
        code,
        source: "openschema",
        message,
    };
}
// ── Span index for this document ─────────────────────────────────────────────────
function pointKey(span) {
    return `${span.line}:${span.col}`;
}
function collectSpanPoints(program) {
    const points = new Set();
    const add = (span) => points.add(pointKey(span));
    for (const decl of program.declarations) {
        add(decl.span);
        collectDeclPoints(decl, add);
    }
    return points;
}
function collectDeclPoints(decl, add) {
    if (decl.kind === "model") {
        for (const field of decl.members)
            collectFieldPoints(field, add);
        return;
    }
    if (decl.kind === "overlay") {
        for (const field of decl.fields)
            collectFieldPoints(field, add);
        return;
    }
    if (decl.kind === "type_alias") {
        collectTypePoints(decl.type, add);
        return;
    }
    if (decl.kind === "enum") {
        for (const variant of decl.variants)
            add(variant.span);
        return;
    }
    if (decl.kind === "operation") {
        for (const param of decl.params)
            collectTypePoints(param.type, add);
        collectTypePoints(decl.returnType, add);
        return;
    }
    if (decl.kind === "interface") {
        for (const op of decl.operations) {
            for (const param of op.params)
                collectTypePoints(param.type, add);
            collectTypePoints(op.returnType, add);
        }
        return;
    }
}
function collectFieldPoints(field, add) {
    add(field.span);
    collectTypePoints(field.type, add);
}
function collectTypePoints(type, add) {
    add(type.span);
    switch (type.kind) {
        case "named":
            for (const arg of type.typeArgs)
                collectTypePoints(arg, add);
            return;
        case "array":
            collectTypePoints(type.element, add);
            return;
        case "map":
            collectTypePoints(type.key, add);
            collectTypePoints(type.value, add);
            return;
        case "nullable":
            collectTypePoints(type.inner, add);
            return;
        case "union":
            for (const variant of type.variants)
                collectTypePoints(variant, add);
            return;
        case "oneof":
            for (const variant of type.variants)
                collectTypePoints(variant.type, add);
            return;
        default:
            return;
    }
}
//# sourceMappingURL=analyze.js.map