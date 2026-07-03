import type { Range, Position } from "vscode-languageserver";
import type { Span } from "../parser/ast.js";
/**
 * A compiler Span is a single 1-based point. Turn it into an LSP Range that
 * covers the identifier (or token) starting at that point, so squiggles land
 * on something visible instead of a zero-width caret.
 */
export declare function spanToRange(text: string, span: Span): Range;
export interface WordAtPosition {
    word: string;
    path: string;
    range: Range;
}
/** The identifier and surrounding dotted path under an LSP position, if any. */
export declare function wordAt(text: string, position: Position): WordAtPosition | null;
//# sourceMappingURL=positions.d.ts.map