// src/lsp/positions.ts
// Translate between the compiler's 1-based (line, col) points and the LSP's
// 0-based (line, character) ranges, and extract identifiers under the cursor.

import type { Range, Position } from "vscode-languageserver";
import type { Span } from "../parser/ast.js";

const IDENT_CHAR = /[A-Za-z0-9_]/;
const PATH_CHAR = /[A-Za-z0-9_.]/;

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/**
 * A compiler Span is a single 1-based point. Turn it into an LSP Range that
 * covers the identifier (or token) starting at that point, so squiggles land
 * on something visible instead of a zero-width caret.
 */
export function spanToRange(text: string, span: Span): Range {
  const line = Math.max(0, span.line - 1);
  const startChar = Math.max(0, span.col - 1);
  const lineText = splitLines(text)[line] ?? "";

  const endChar = tokenEnd(lineText, startChar);
  return {
    start: { line, character: startChar },
    end: { line, character: endChar },
  };
}

// Best-effort end column for the token that begins at `startChar`.
function tokenEnd(lineText: string, startChar: number): number {
  const first = lineText[startChar];
  if (first === undefined) return startChar + 1;

  if (first === "`") return matchClosing(lineText, startChar, "`");
  if (first === '"') return matchClosing(lineText, startChar, '"');

  if (IDENT_CHAR.test(first)) {
    let end = startChar;
    while (end < lineText.length && IDENT_CHAR.test(lineText[end])) end++;
    return end;
  }
  return startChar + 1;
}

function matchClosing(lineText: string, startChar: number, closing: string): number {
  let end = startChar + 1;
  while (end < lineText.length && lineText[end] !== closing) end++;
  return Math.min(lineText.length, end + 1);
}

export interface WordAtPosition {
  word: string; // bare identifier under the cursor
  path: string; // dotted path the identifier belongs to, e.g. "myorg.Foo"
  range: Range; // range of the bare identifier
}

/** The identifier and surrounding dotted path under an LSP position, if any. */
export function wordAt(text: string, position: Position): WordAtPosition | null {
  const lineText = splitLines(text)[position.line] ?? "";
  const cursor = position.character;
  if (!isInsideIdent(lineText, cursor)) return null;

  const start = scanLeft(lineText, cursor, IDENT_CHAR);
  const end = scanRight(lineText, cursor, IDENT_CHAR);
  const pathStart = scanLeft(lineText, cursor, PATH_CHAR);
  const pathEnd = scanRight(lineText, cursor, PATH_CHAR);

  return {
    word: lineText.slice(start, end),
    path: lineText.slice(pathStart, pathEnd),
    range: {
      start: { line: position.line, character: start },
      end: { line: position.line, character: end },
    },
  };
}

function isInsideIdent(lineText: string, cursor: number): boolean {
  const here = lineText[cursor];
  const before = lineText[cursor - 1];
  if (here !== undefined && IDENT_CHAR.test(here)) return true;
  if (before !== undefined && IDENT_CHAR.test(before)) return true;
  return false;
}

function scanLeft(lineText: string, from: number, charClass: RegExp): number {
  let index = from;
  while (index > 0 && charClass.test(lineText[index - 1])) index--;
  return index;
}

function scanRight(lineText: string, from: number, charClass: RegExp): number {
  let index = from;
  while (index < lineText.length && charClass.test(lineText[index])) index++;
  return index;
}
