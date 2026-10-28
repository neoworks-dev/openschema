// src/resolver/moduleGraph.ts
// Builds a module graph from an entry file by following `import ... from "..."`.
// Filesystem access is injected so the resolver stays testable and pure.
import { resolve as resolvePath, dirname, isAbsolute } from "path";
import { Lexer } from "../lexer/lexer.js";
import { Parser } from "../parser/parser.js";
import { isPackageSpecifier, packageLocator } from "./packages.js";
/**
 * Load the entry file and everything it imports (transitively) into a module
 * list, entry first. Relative specifiers resolve against the importing file,
 * `@scope/name` against the project's downloaded dependencies; anything
 * unresolved surfaces as OS1008 later.
 */
export function loadProject(entryPath, readFileOrNull) {
    const entryId = resolvePath(entryPath);
    const packages = packageLocator(entryId, readFileOrNull);
    const modules = new Map();
    const queue = [entryId];
    while (queue.length > 0) {
        const moduleId = queue.pop();
        if (modules.has(moduleId))
            continue;
        const source = readFileOrNull(moduleId);
        if (source === null) {
            throw new Error(`Cannot read module: ${moduleId}`);
        }
        const program = parseSource(source);
        const importMap = new Map();
        for (const importDecl of importDeclarations(program)) {
            const targetId = resolveSpecifier(importDecl.from, moduleId, readFileOrNull, packages);
            if (targetId === null)
                continue; // unresolved → reported during resolveModules
            importMap.set(importDecl.from, targetId);
            queue.push(targetId);
        }
        modules.set(moduleId, { moduleId, sourcePath: moduleId, program, importMap, packageName: packages.packageOf(moduleId) });
    }
    return orderEntryFirst(entryId, modules);
}
function parseSource(source) {
    const tokens = new Lexer(source).tokenize();
    return new Parser(tokens).parse();
}
function importDeclarations(program) {
    const imports = [];
    for (const decl of program.declarations) {
        if (decl.kind === "import")
            imports.push(decl);
    }
    return imports;
}
const EXTENSION_CANDIDATES = ["", ".schema", ".openschema"];
function resolveSpecifier(specifier, importerId, readFileOrNull, packages) {
    if (isPackageSpecifier(specifier))
        return packages.locate(specifier);
    if (!specifier.startsWith(".") && !isAbsolute(specifier))
        return null;
    const base = isAbsolute(specifier) ? specifier : resolvePath(dirname(importerId), specifier);
    for (const extension of EXTENSION_CANDIDATES) {
        const candidate = `${base}${extension}`;
        if (readFileOrNull(candidate) !== null)
            return candidate;
    }
    return null;
}
function orderEntryFirst(entryId, modules) {
    const entry = modules.get(entryId);
    const rest = [];
    for (const [moduleId, module] of modules) {
        if (moduleId !== entryId)
            rest.push(module);
    }
    return [entry, ...rest];
}
//# sourceMappingURL=moduleGraph.js.map