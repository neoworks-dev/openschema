// src/index.ts
// Public API: import { parse, Lexer, Parser, AST } from "openschema"
export { Lexer, LexError } from "./lexer/lexer.js";
export { Parser, ParseError } from "./parser/parser.js";
export * as AST from "./parser/ast.js";
export { resolve, resolveModules, loadProject } from "./resolver/index.js";
export { getEmitter, listTargets } from "./emit/index.js";
import { Lexer } from "./lexer/lexer.js";
import { Parser } from "./parser/parser.js";
/**
 * Parse an OpenSchema source string into a Program AST.
 *
 * @throws {LexError}   on unrecognised characters
 * @throws {ParseError} on unexpected tokens
 */
export function parse(source) {
    const tokens = new Lexer(source).tokenize();
    return new Parser(tokens).parse();
}
//# sourceMappingURL=index.js.map