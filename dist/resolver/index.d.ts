import type { Program } from "../parser/ast.js";
import type { ResolvedSchema, Module } from "./types.js";
export { loadProject } from "./moduleGraph.js";
export type { ResolvedSchema, ResolvedModel, ResolvedField, ResolvedOverlay, DeclSymbol, Diagnostic, Module } from "./types.js";
/**
 * Resolve a parsed Program into a ResolvedSchema. Single-file today; the
 * import graph is a later extension.
 */
export declare function resolve(program: Program): ResolvedSchema;
/**
 * Resolve a module graph (entry module first) into a single ResolvedSchema.
 * Names resolve against each module's own scope (its declarations plus its
 * imports); qualified names resolve against the global table.
 */
export declare function resolveModules(modules: Module[]): ResolvedSchema;
//# sourceMappingURL=index.d.ts.map