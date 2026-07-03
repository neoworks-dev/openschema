import type { Module } from "./types.js";
/** Reads a file's contents, or returns null when it does not exist. */
export type ReadFileOrNull = (path: string) => string | null;
/**
 * Load the entry file and everything it imports (transitively) into a module
 * list, entry first. Specifiers are resolved relative to the importing file;
 * package-style specifiers are not yet supported and surface as OS1008 later.
 */
export declare function loadProject(entryPath: string, readFileOrNull: ReadFileOrNull): Module[];
//# sourceMappingURL=moduleGraph.d.ts.map