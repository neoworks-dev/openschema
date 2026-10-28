// src/resolver/moduleGraph.ts
// Builds a module graph from an entry file by following `import ... from "..."`.
// Filesystem access is injected so the resolver stays testable and pure.

import { resolve as resolvePath, dirname, isAbsolute } from "path";
import { Lexer } from "../lexer/lexer.js";
import { Parser } from "../parser/parser.js";
import type { Program, ImportDecl } from "../parser/ast.js";
import type { Module } from "./types.js";
import { isPackageSpecifier, packageLocator, type LocatePackage } from "./packages.js";

/** Reads a file's contents, or returns null when it does not exist. */
export type ReadFileOrNull = (path: string) => string | null;

/**
 * Load the entry file and everything it imports (transitively) into a module
 * list, entry first. Relative specifiers resolve against the importing file,
 * `@scope/name` against the project's downloaded dependencies; anything
 * unresolved surfaces as OS1008 later.
 */
export function loadProject(entryPath: string, readFileOrNull: ReadFileOrNull): Module[] {
  const entryId = resolvePath(entryPath);
  const locatePackage = packageLocator(entryId, readFileOrNull);
  const modules = new Map<string, Module>();
  const queue: string[] = [entryId];

  while (queue.length > 0) {
    const moduleId = queue.pop()!;
    if (modules.has(moduleId)) continue;

    const source = readFileOrNull(moduleId);
    if (source === null) {
      throw new Error(`Cannot read module: ${moduleId}`);
    }

    const program = parseSource(source);
    const importMap = new Map<string, string>();
    for (const importDecl of importDeclarations(program)) {
      const targetId = resolveSpecifier(importDecl.from, moduleId, readFileOrNull, locatePackage);
      if (targetId === null) continue; // unresolved → reported during resolveModules
      importMap.set(importDecl.from, targetId);
      queue.push(targetId);
    }

    modules.set(moduleId, { moduleId, sourcePath: moduleId, program, importMap });
  }

  return orderEntryFirst(entryId, modules);
}

function parseSource(source: string): Program {
  const tokens = new Lexer(source).tokenize();
  return new Parser(tokens).parse();
}

function importDeclarations(program: Program): ImportDecl[] {
  const imports: ImportDecl[] = [];
  for (const decl of program.declarations) {
    if (decl.kind === "import") imports.push(decl);
  }
  return imports;
}

const EXTENSION_CANDIDATES = ["", ".schema", ".openschema"];

function resolveSpecifier(
  specifier: string,
  importerId: string,
  readFileOrNull: ReadFileOrNull,
  locatePackage: LocatePackage,
): string | null {
  if (isPackageSpecifier(specifier)) return locatePackage(specifier);
  if (!specifier.startsWith(".") && !isAbsolute(specifier)) return null;
  const base = isAbsolute(specifier) ? specifier : resolvePath(dirname(importerId), specifier);
  for (const extension of EXTENSION_CANDIDATES) {
    const candidate = `${base}${extension}`;
    if (readFileOrNull(candidate) !== null) return candidate;
  }
  return null;
}

function orderEntryFirst(entryId: string, modules: Map<string, Module>): Module[] {
  const entry = modules.get(entryId)!;
  const rest: Module[] = [];
  for (const [moduleId, module] of modules) {
    if (moduleId !== entryId) rest.push(module);
  }
  return [entry, ...rest];
}
