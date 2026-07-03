// src/lsp/features.ts
// Hover, go-to-definition, references, and completion. These read the resolved
// symbol table from the last successful analysis plus the static DSL vocabulary.
import { pathToFileURL } from "url";
import { CompletionItemKind, MarkupKind, } from "vscode-languageserver";
import { wordAt } from "./positions.js";
import { spanToRange } from "./positions.js";
import { SCALAR_TYPES, KEYWORDS, DECORATORS, DECORATOR_ARG_VALUES, findScalar, findDecorator, findArgValue, } from "./vocabulary.js";
// ── Hover ───────────────────────────────────────────────────────────────────────
export function hover(text, position, schema) {
    const word = wordAt(text, position);
    if (word === null)
        return null;
    const lineText = lineAt(text, position.line);
    const decoratorHover = decoratorAwareHover(lineText, word);
    if (decoratorHover !== null)
        return decoratorHover;
    const symbol = findSymbol(schema, word.word, word.path);
    if (symbol !== null) {
        return { contents: { kind: MarkupKind.Markdown, value: symbolHoverText(symbol) }, range: word.range };
    }
    const scalar = findScalar(word.word);
    if (scalar !== null)
        return entryHover(scalar, word.range);
    return null;
}
// Hover for a decorator name (@compatibility) or one of its known argument
// values (@compatibility(backward) → explains "backward").
function decoratorAwareHover(lineText, word) {
    if (isDecoratorName(lineText, word.range.start.character)) {
        const entry = findDecorator(word.path);
        if (entry !== null)
            return entryHover(entry, word.range);
    }
    const decoratorName = enclosingDecorator(lineText, word.range.start.character);
    if (decoratorName !== null) {
        const entry = findArgValue(decoratorName, word.word);
        if (entry !== null)
            return entryHover(entry, word.range);
    }
    return null;
}
function entryHover(entry, range) {
    const value = `\`${entry.label}\` — *${entry.detail}*\n\n${entry.documentation}`;
    return { contents: { kind: MarkupKind.Markdown, value }, range };
}
function symbolHoverText(symbol) {
    const keyword = symbolKeyword(symbol);
    const doc = declDoc(symbol);
    const signature = `\`\`\`openschema\n${keyword} ${symbol.localName}\n\`\`\``;
    const qualified = `*${symbol.qualifiedName}*`;
    if (doc === null)
        return `${signature}\n\n${qualified}`;
    return `${signature}\n\n${qualified}\n\n${doc}`;
}
function symbolKeyword(symbol) {
    if (symbol.kind === "model")
        return "model";
    if (symbol.kind === "enum")
        return "enum";
    return "type";
}
function declDoc(symbol) {
    const decl = symbol.decl;
    return decl.doc ?? null;
}
export function definition(text, position, schema, entryUri, moduleText) {
    const word = wordAt(text, position);
    if (word === null)
        return null;
    const symbol = findSymbol(schema, word.word, word.path);
    if (symbol === null)
        return null;
    const declaringText = symbol.moduleId === "<entry>" ? text : moduleText(symbol.moduleId);
    const uri = symbol.moduleId === "<entry>" ? entryUri : pathToFileURL(symbol.moduleId).toString();
    // Without the declaring file's text we cannot size the range; point at the start.
    const range = declaringText === null
        ? { start: toLsp(symbol.span), end: toLsp(symbol.span) }
        : spanToRange(declaringText, symbol.span);
    return { uri, range };
}
function toLsp(span) {
    return { line: Math.max(0, span.line - 1), character: Math.max(0, span.col - 1) };
}
// ── References ────────────────────────────────────────────────────────────────────
// Every place the symbol under the cursor is used as a type, plus (optionally)
// its declaration. Scoped to the current document — see entryUri.
export function references(text, position, schema, program, entryUri, includeDeclaration) {
    const word = wordAt(text, position);
    if (word === null || program === null)
        return [];
    const symbol = findSymbol(schema, word.word, word.path);
    if (symbol === null)
        return [];
    const locations = [];
    if (includeDeclaration) {
        const declaration = declarationLocation(text, program, symbol, entryUri);
        if (declaration !== null)
            locations.push(declaration);
    }
    for (const named of collectNamedTypes(program)) {
        if (!matchesSymbol(named, symbol))
            continue;
        locations.push({ uri: entryUri, range: spanToRange(text, named.span) });
    }
    return locations;
}
function matchesSymbol(named, symbol) {
    if (named.path.join(".") === symbol.qualifiedName)
        return true;
    // Within one document local names are unique, so the trailing segment is safe.
    return named.path[named.path.length - 1] === symbol.localName;
}
function declarationLocation(text, program, symbol, uri) {
    for (const decl of program.declarations) {
        if (!isSymbolDecl(decl) || decl.name !== symbol.localName)
            continue;
        const range = nameRangeOnLine(text, decl.span, symbol.localName);
        return { uri, range };
    }
    return null;
}
function isSymbolDecl(decl) {
    return decl.kind === "model" || decl.kind === "enum" || decl.kind === "type_alias";
}
// Range of the declared name on its declaration line; falls back to the keyword.
function nameRangeOnLine(text, span, name) {
    const line = Math.max(0, span.line - 1);
    const lineText = text.split(/\r\n|\r|\n/)[line] ?? "";
    const index = lineText.indexOf(name, Math.max(0, span.col - 1));
    if (index < 0)
        return { start: toLsp(span), end: toLsp(span) };
    return {
        start: { line, character: index },
        end: { line, character: index + name.length },
    };
}
// ── Type traversal ─────────────────────────────────────────────────────────────────
function collectNamedTypes(program) {
    const named = [];
    for (const decl of program.declarations) {
        forEachTypeInDecl(decl, type => collectNamed(type, named));
    }
    return named;
}
function forEachTypeInDecl(decl, visit) {
    if (decl.kind === "model") {
        for (const field of decl.members)
            visit(field.type);
        return;
    }
    if (decl.kind === "overlay") {
        for (const field of decl.fields)
            visit(field.type);
        return;
    }
    if (decl.kind === "type_alias") {
        visit(decl.type);
        return;
    }
    if (decl.kind === "operation") {
        for (const param of decl.params)
            visit(param.type);
        visit(decl.returnType);
        return;
    }
    if (decl.kind === "interface") {
        for (const op of decl.operations) {
            for (const param of op.params)
                visit(param.type);
            visit(op.returnType);
        }
    }
}
function collectNamed(type, into) {
    switch (type.kind) {
        case "named":
            into.push(type);
            for (const arg of type.typeArgs)
                collectNamed(arg, into);
            return;
        case "array":
            collectNamed(type.element, into);
            return;
        case "map":
            collectNamed(type.key, into);
            collectNamed(type.value, into);
            return;
        case "nullable":
            collectNamed(type.inner, into);
            return;
        case "union":
            for (const variant of type.variants)
                collectNamed(variant, into);
            return;
        case "oneof":
            for (const variant of type.variants)
                collectNamed(variant.type, into);
            return;
        default:
            return;
    }
}
// ── Completion ────────────────────────────────────────────────────────────────────
export function completion(text, position, schema) {
    const lineText = lineAt(text, position.line);
    const argDecorator = enclosingDecorator(lineText, position.character);
    if (argDecorator !== null && DECORATOR_ARG_VALUES[argDecorator] !== undefined) {
        return DECORATOR_ARG_VALUES[argDecorator].map(entry => vocabularyItem(entry.label, entry.detail, entry.documentation, CompletionItemKind.EnumMember));
    }
    if (inDecoratorContext(text, position)) {
        return DECORATORS.map(entry => vocabularyItem(entry.label, entry.detail, entry.documentation, CompletionItemKind.Property));
    }
    const items = [];
    for (const entry of SCALAR_TYPES) {
        items.push(vocabularyItem(entry.label, entry.detail, entry.documentation, CompletionItemKind.Struct));
    }
    for (const entry of KEYWORDS) {
        items.push(vocabularyItem(entry.label, entry.detail, entry.documentation, CompletionItemKind.Keyword));
    }
    appendTypeNameItems(items, schema);
    return items;
}
function appendTypeNameItems(items, schema) {
    if (schema === null)
        return;
    for (const symbol of schema.symbols.values()) {
        items.push(vocabularyItem(symbol.localName, symbol.kind, `*${symbol.qualifiedName}*`, completionKindFor(symbol.kind)));
    }
}
function completionKindFor(kind) {
    if (kind === "enum")
        return CompletionItemKind.Enum;
    if (kind === "model")
        return CompletionItemKind.Class;
    return CompletionItemKind.Interface;
}
function inDecoratorContext(text, position) {
    const lineText = text.split(/\r\n|\r|\n/)[position.line] ?? "";
    const prefix = lineText.slice(0, position.character);
    return /@[A-Za-z0-9_.]*$/.test(prefix);
}
function vocabularyItem(label, detail, documentation, kind) {
    return {
        label,
        kind,
        detail,
        documentation: { kind: MarkupKind.Markdown, value: documentation },
    };
}
// ── Decorator context ────────────────────────────────────────────────────────────
function lineAt(text, line) {
    return text.split(/\r\n|\r|\n/)[line] ?? "";
}
// True when the identifier starting at `startChar` is a decorator name, i.e. the
// dotted name immediately follows an `@`.
function isDecoratorName(lineText, startChar) {
    let pathStart = startChar;
    while (pathStart > 0 && /[A-Za-z0-9_.]/.test(lineText[pathStart - 1]))
        pathStart--;
    return lineText[pathStart - 1] === "@";
}
// The decorator whose argument list encloses `charIndex`, or null. Assumes the
// decorator and its `(` are on the same line, which is how they are written.
function enclosingDecorator(lineText, charIndex) {
    const before = lineText.slice(0, charIndex);
    const at = before.lastIndexOf("@");
    if (at < 0)
        return null;
    const rest = before.slice(at);
    const match = /^@([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(rest);
    if (match === null)
        return null;
    // Still inside the argument list only if its '(' is not yet balanced by a ')'.
    const fromParen = rest.slice(rest.indexOf("("));
    const opens = countOccurrences(fromParen, "(");
    const closes = countOccurrences(fromParen, ")");
    if (opens <= closes)
        return null;
    return match[1];
}
function countOccurrences(text, char) {
    let count = 0;
    for (const c of text) {
        if (c === char)
            count++;
    }
    return count;
}
// ── Symbol lookup ───────────────────────────────────────────────────────────────
function findSymbol(schema, word, path) {
    if (schema === null)
        return null;
    const qualified = schema.symbols.get(path);
    if (qualified !== undefined)
        return qualified;
    for (const symbol of schema.symbols.values()) {
        if (symbol.localName === word)
            return symbol;
    }
    return null;
}
//# sourceMappingURL=features.js.map