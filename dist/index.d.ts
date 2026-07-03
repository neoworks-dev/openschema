export { Lexer, LexError } from "./lexer/lexer.js";
export { Parser, ParseError } from "./parser/parser.js";
export * as AST from "./parser/ast.js";
export { TokenKind } from "./lexer/tokens.js";
export type { Token } from "./lexer/tokens.js";
export { resolve, resolveModules, loadProject } from "./resolver/index.js";
export type { ResolvedSchema, ResolvedModel, ResolvedField, ResolvedOverlay, DeclSymbol, Diagnostic, Module, } from "./resolver/types.js";
export { getEmitter, listTargets } from "./emit/index.js";
export type { Emitter, EmitContext, OutputFile } from "./emit/types.js";
export type { InternalSchema, InternalTable, InternalField, InternalIndex } from "./emit/internal/internalEmitter.js";
import type { Program } from "./parser/ast.js";
/**
 * Parse an OpenSchema source string into a Program AST.
 *
 * @throws {LexError}   on unrecognised characters
 * @throws {ParseError} on unexpected tokens
 */
export declare function parse(source: string): Program;
//# sourceMappingURL=index.d.ts.map