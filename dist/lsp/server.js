// src/lsp/server.ts
// The OpenSchema language server. Speaks LSP over stdio and reuses the real
// compiler (lexer/parser/resolver) for live diagnostics, plus hover,
// go-to-definition, completion, and the document outline.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind, StreamMessageReader, StreamMessageWriter, } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { analyze } from "./analyze.js";
import { documentSymbols } from "./symbols.js";
import { hover, definition, references, completion } from "./features.js";
// Communicate over stdio. Works whether or not the client passes `--stdio`.
const connection = createConnection(ProposedFeatures.all, new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
const documents = new TextDocuments(TextDocument);
// Last successful analysis per document URI, so navigation keeps working while
// the buffer is mid-edit and temporarily unparseable.
const lastSchema = new Map();
const lastProgram = new Map();
connection.onInitialize(() => ({
    capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        documentSymbolProvider: true,
        completionProvider: { triggerCharacters: ["@", "."] },
    },
}));
// ── Diagnostics ─────────────────────────────────────────────────────────────────
function refresh(document) {
    const text = document.getText();
    const result = analyze(document.uri, text, liveTextProvider());
    if (result.schema !== null)
        lastSchema.set(document.uri, result.schema);
    if (result.program !== null)
        lastProgram.set(document.uri, result.program);
    connection.sendDiagnostics({ uri: document.uri, diagnostics: result.diagnostics });
}
documents.onDidChangeContent(change => refresh(change.document));
documents.onDidClose(event => {
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
    lastSchema.delete(event.document.uri);
    lastProgram.delete(event.document.uri);
});
// ── Navigation & assistance ───────────────────────────────────────────────────────
connection.onHover(params => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined)
        return null;
    const schema = lastSchema.get(params.textDocument.uri) ?? null;
    return hover(document.getText(), params.position, schema);
});
connection.onDefinition(params => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined)
        return null;
    const schema = lastSchema.get(params.textDocument.uri) ?? null;
    return definition(document.getText(), params.position, schema, params.textDocument.uri, moduleTextProvider());
});
connection.onReferences(params => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined)
        return [];
    const schema = lastSchema.get(params.textDocument.uri) ?? null;
    const program = lastProgram.get(params.textDocument.uri) ?? null;
    return references(document.getText(), params.position, schema, program, params.textDocument.uri, params.context.includeDeclaration);
});
connection.onCompletion(params => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined)
        return [];
    const schema = lastSchema.get(params.textDocument.uri) ?? null;
    return completion(document.getText(), params.position, schema);
});
connection.onDocumentSymbol(params => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined)
        return [];
    const program = lastProgram.get(params.textDocument.uri);
    if (program === undefined)
        return [];
    return documentSymbols(document.getText(), program);
});
// ── Filesystem bridge ─────────────────────────────────────────────────────────────
// Prefer an open editor buffer for any path the compiler asks to read.
function liveTextProvider() {
    return path => openDocumentText(path);
}
function moduleTextProvider() {
    return moduleId => {
        const open = openDocumentText(moduleId);
        if (open !== null)
            return open;
        try {
            return readFileSync(moduleId, "utf8");
        }
        catch {
            return null;
        }
    };
}
function openDocumentText(path) {
    for (const document of documents.all()) {
        const documentPath = uriToPath(document.uri);
        if (documentPath === path)
            return document.getText();
    }
    return null;
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
documents.listen(connection);
connection.listen();
//# sourceMappingURL=server.js.map