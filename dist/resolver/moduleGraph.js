// src/resolver/moduleGraph.ts
// Builds a module graph from an entry file by following `import ... from "..."`.
// Filesystem access is injected so the resolver stays testable and pure.
import { resolve as resolvePath, dirname, isAbsolute } from "path";
import { Lexer } from "../lexer/lexer.js";
import { Parser } from "../parser/parser.js";
/**
 * Load the entry file and everything it imports (transitively) into a module
 * list, entry first. Specifiers are resolved relative to the importing file;
 * package-style specifiers are not yet supported and surface as OS1008 later.
 */
export function loadProject(entryPath, readFileOrNull) {
    const entryId = resolvePath(entryPath);
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
            const targetId = resolveSpecifier(importDecl.from, moduleId, readFileOrNull);
            if (targetId === null)
                continue; // unresolved → reported during resolveModules
            importMap.set(importDecl.from, targetId);
            queue.push(targetId);
        }
        modules.set(moduleId, { moduleId, sourcePath: moduleId, program, importMap });
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
function resolveSpecifier(specifier, importerId, readFileOrNull) {
    if (!specifier.startsWith(".") && !isAbsolute(specifier)) {
        return null; // package-style specifier — not supported yet
    }
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