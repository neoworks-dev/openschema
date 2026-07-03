// src/lsp/features.ts
// Hover, go-to-definition, references, and completion. These read the resolved
// symbol table from the last successful analysis plus the static DSL vocabulary.

import { pathToFileURL } from "url";
import {
  CompletionItemKind, MarkupKind,
} from "vscode-languageserver";
import type {
  Hover, Location, Range, CompletionItem, Position,
} from "vscode-languageserver";

import type {
  Program, Declaration, TypeExpr, NamedTypeExpr, Span,
} from "../parser/ast.js";
import type { ResolvedSchema, DeclSymbol } from "../resolver/types.js";
import type { WordAtPosition } from "./positions.js";
import { wordAt } from "./positions.js";
import { spanToRange } from "./positions.js";
import type { VocabularyEntry } from "./vocabulary.js";
import {
  SCALAR_TYPES, KEYWORDS, DECORATORS, DECORATOR_ARG_VALUES,
  findScalar, findDecorator, findArgValue,
} from "./vocabulary.js";

// ── Hover ───────────────────────────────────────────────────────────────────────

export function hover(text: string, position: Position, schema: ResolvedSchema | null): Hover | null {
  const word = wordAt(text, position);
  if (word === null) return null;
  const lineText = lineAt(text, position.line);

  const decoratorHover = decoratorAwareHover(lineText, word);
  if (decoratorHover !== null) return decoratorHover;

  const symbol = findSymbol(schema, word.word, word.path);
  if (symbol !== null) {
    return { contents: { kind: MarkupKind.Markdown, value: symbolHoverText(symbol) }, range: word.range };
  }

  const scalar = findScalar(word.word);
  if (scalar !== null) return entryHover(scalar, word.range);
  return null;
}

// Hover for a decorator name (@compatibility) or one of its known argument
// values (@compatibility(backward) → explains "backward").
function decoratorAwareHover(lineText: string, word: WordAtPosition): Hover | null {
  if (isDecoratorName(lineText, word.range.start.character)) {
    const entry = findDecorator(word.path);
    if (entry !== null) return entryHover(entry, word.range);
  }

  const decoratorName = enclosingDecorator(lineText, word.range.start.character);
  if (decoratorName !== null) {
    const entry = findArgValue(decoratorName, word.word);
    if (entry !== null) return entryHover(entry, word.range);
  }
  return null;
}

function entryHover(entry: VocabularyEntry, range: Hover["range"]): Hover {
  const value = `\`${entry.label}\` — *${entry.detail}*\n\n${entry.documentation}`;
  return { contents: { kind: MarkupKind.Markdown, value }, range };
}

function symbolHoverText(symbol: DeclSymbol): string {
  const keyword = symbolKeyword(symbol);
  const doc = declDoc(symbol);
  const signature = `\`\`\`openschema\n${keyword} ${symbol.localName}\n\`\`\``;
  const qualified = `*${symbol.qualifiedName}*`;
  if (doc === null) return `${signature}\n\n${qualified}`;
  return `${signature}\n\n${qualified}\n\n${doc}`;
}

function symbolKeyword(symbol: DeclSymbol): string {
  if (symbol.kind === "model") return "model";
  if (symbol.kind === "enum") return "enum";
  return "type";
}

function declDoc(symbol: DeclSymbol): string | null {
  const decl = symbol.decl as { doc?: string | null };
  return decl.doc ?? null;
}

// ── Definition ────────────────────────────────────────────────────────────────────

export type ModuleTextProvider = (moduleId: string) => string | null;

export function definition(
  text: string,
  position: Position,
  schema: ResolvedSchema | null,
  entryUri: string,
  moduleText: ModuleTextProvider,
): Location | null {
  const word = wordAt(text, position);
  if (word === null) return null;

  const symbol = findSymbol(schema, word.word, word.path);
  if (symbol === null) return null;

  const declaringText = symbol.moduleId === "<entry>" ? text : moduleText(symbol.moduleId);
  const uri = symbol.moduleId === "<entry>" ? entryUri : pathToFileURL(symbol.moduleId).toString();
  // Without the declaring file's text we cannot size the range; point at the start.
  const range = declaringText === null
    ? { start: toLsp(symbol.span), end: toLsp(symbol.span) }
    : spanToRange(declaringText, symbol.span);

  return { uri, range };
}

function toLsp(span: { line: number; col: number }) {
  return { line: Math.max(0, span.line - 1), character: Math.max(0, span.col - 1) };
}

// ── References ────────────────────────────────────────────────────────────────────

// Every place the symbol under the cursor is used as a type, plus (optionally)
// its declaration. Scoped to the current document — see entryUri.
export function references(
  text: string,
  position: Position,
  schema: ResolvedSchema | null,
  program: Program | null,
  entryUri: string,
  includeDeclaration: boolean,
): Location[] {
  const word = wordAt(text, position);
  if (word === null || program === null) return [];

  const symbol = findSymbol(schema, word.word, word.path);
  if (symbol === null) return [];

  const locations: Location[] = [];
  if (includeDeclaration) {
    const declaration = declarationLocation(text, program, symbol, entryUri);
    if (declaration !== null) locations.push(declaration);
  }

  for (const named of collectNamedTypes(program)) {
    if (!matchesSymbol(named, symbol)) continue;
    locations.push({ uri: entryUri, range: spanToRange(text, named.span) });
  }
  return locations;
}

function matchesSymbol(named: NamedTypeExpr, symbol: DeclSymbol): boolean {
  if (named.path.join(".") === symbol.qualifiedName) return true;
  // Within one document local names are unique, so the trailing segment is safe.
  return named.path[named.path.length - 1] === symbol.localName;
}

function declarationLocation(
  text: string,
  program: Program,
  symbol: DeclSymbol,
  uri: string,
): Location | null {
  for (const decl of program.declarations) {
    if (!isSymbolDecl(decl) || decl.name !== symbol.localName) continue;
    const range = nameRangeOnLine(text, decl.span, symbol.localName);
    return { uri, range };
  }
  return null;
}

function isSymbolDecl(decl: Declaration): decl is Declaration & { name: string } {
  return decl.kind === "model" || decl.kind === "enum" || decl.kind === "type_alias";
}

// Range of the declared name on its declaration line; falls back to the keyword.
function nameRangeOnLine(text: string, span: Span, name: string): Range {
  const line = Math.max(0, span.line - 1);
  const lineText = text.split(/\r\n|\r|\n/)[line] ?? "";
  const index = lineText.indexOf(name, Math.max(0, span.col - 1));
  if (index < 0) return { start: toLsp(span), end: toLsp(span) };
  return {
    start: { line, character: index },
    end: { line, character: index + name.length },
  };
}

// ── Type traversal ─────────────────────────────────────────────────────────────────

function collectNamedTypes(program: Program): NamedTypeExpr[] {
  const named: NamedTypeExpr[] = [];
  for (const decl of program.declarations) {
    forEachTypeInDecl(decl, type => collectNamed(type, named));
  }
  return named;
}

function forEachTypeInDecl(decl: Declaration, visit: (type: TypeExpr) => void): void {
  if (decl.kind === "model") {
    for (const field of decl.members) visit(field.type);
    return;
  }
  if (decl.kind === "overlay") {
    for (const field of decl.fields) visit(field.type);
    return;
  }
  if (decl.kind === "type_alias") {
    visit(decl.type);
    return;
  }
  if (decl.kind === "operation") {
    for (const param of decl.params) visit(param.type);
    visit(decl.returnType);
    return;
  }
  if (decl.kind === "interface") {
    for (const op of decl.operations) {
      for (const param of op.params) visit(param.type);
      visit(op.returnType);
    }
  }
}

function collectNamed(type: TypeExpr, into: NamedTypeExpr[]): void {
  switch (type.kind) {
    case "named":
      into.push(type);
      for (const arg of type.typeArgs) collectNamed(arg, into);
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
      for (const variant of type.variants) collectNamed(variant, into);
      return;
    case "oneof":
      for (const variant of type.variants) collectNamed(variant.type, into);
      return;
    default:
      return;
  }
}

// ── Completion ────────────────────────────────────────────────────────────────────

export function completion(text: string, position: Position, schema: ResolvedSchema | null): CompletionItem[] {
  const lineText = lineAt(text, position.line);

  const argDecorator = enclosingDecorator(lineText, position.character);
  if (argDecorator !== null && DECORATOR_ARG_VALUES[argDecorator] !== undefined) {
    return DECORATOR_ARG_VALUES[argDecorator].map(entry =>
      vocabularyItem(entry.label, entry.detail, entry.documentation, CompletionItemKind.EnumMember));
  }

  if (inDecoratorContext(text, position)) {
    return DECORATORS.map(entry => vocabularyItem(entry.label, entry.detail, entry.documentation, CompletionItemKind.Property));
  }

  const items: CompletionItem[] = [];
  for (const entry of SCALAR_TYPES) {
    items.push(vocabularyItem(entry.label, entry.detail, entry.documentation, CompletionItemKind.Struct));
  }
  for (const entry of KEYWORDS) {
    items.push(vocabularyItem(entry.label, entry.detail, entry.documentation, CompletionItemKind.Keyword));
  }
  appendTypeNameItems(items, schema);
  return items;
}

function appendTypeNameItems(items: CompletionItem[], schema: ResolvedSchema | null): void {
  if (schema === null) return;
  for (const symbol of schema.symbols.values()) {
    items.push(vocabularyItem(
      symbol.localName,
      symbol.kind,
      `*${symbol.qualifiedName}*`,
      completionKindFor(symbol.kind),
    ));
  }
}

function completionKindFor(kind: DeclSymbol["kind"]): CompletionItemKind {
  if (kind === "enum") return CompletionItemKind.Enum;
  if (kind === "model") return CompletionItemKind.Class;
  return CompletionItemKind.Interface;
}

function inDecoratorContext(text: string, position: Position): boolean {
  const lineText = text.split(/\r\n|\r|\n/)[position.line] ?? "";
  const prefix = lineText.slice(0, position.character);
  return /@[A-Za-z0-9_.]*$/.test(prefix);
}

function vocabularyItem(
  label: string,
  detail: string,
  documentation: string,
  kind: CompletionItemKind,
): CompletionItem {
  return {
    label,
    kind,
    detail,
    documentation: { kind: MarkupKind.Markdown, value: documentation },
  };
}

// ── Decorator context ────────────────────────────────────────────────────────────

function lineAt(text: string, line: number): string {
  return text.split(/\r\n|\r|\n/)[line] ?? "";
}

// True when the identifier starting at `startChar` is a decorator name, i.e. the
// dotted name immediately follows an `@`.
function isDecoratorName(lineText: string, startChar: number): boolean {
  let pathStart = startChar;
  while (pathStart > 0 && /[A-Za-z0-9_.]/.test(lineText[pathStart - 1])) pathStart--;
  return lineText[pathStart - 1] === "@";
}

// The decorator whose argument list encloses `charIndex`, or null. Assumes the
// decorator and its `(` are on the same line, which is how they are written.
function enclosingDecorator(lineText: string, charIndex: number): string | null {
  const before = lineText.slice(0, charIndex);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;

  const rest = before.slice(at);
  const match = /^@([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(rest);
  if (match === null) return null;

  // Still inside the argument list only if its '(' is not yet balanced by a ')'.
  const fromParen = rest.slice(rest.indexOf("("));
  const opens = countOccurrences(fromParen, "(");
  const closes = countOccurrences(fromParen, ")");
  if (opens <= closes) return null;

  return match[1];
}

function countOccurrences(text: string, char: string): number {
  let count = 0;
  for (const c of text) {
    if (c === char) count++;
  }
  return count;
}

// ── Symbol lookup ───────────────────────────────────────────────────────────────

function findSymbol(schema: ResolvedSchema | null, word: string, path: string): DeclSymbol | null {
  if (schema === null) return null;

  const qualified = schema.symbols.get(path);
  if (qualified !== undefined) return qualified;

  for (const symbol of schema.symbols.values()) {
    if (symbol.localName === word) return symbol;
  }
  return null;
}
