// src/resolver/packages.ts
// Package imports such as `@neoworks/shared` resolve to a schema downloaded into
// the project's .openschema/dependencies folder, next to its openschema.yaml.
// Each download keeps its manifest, which names the entry file.
import { dirname, isAbsolute, join, relative, sep } from "path";
import { MANIFEST_FILE, PACKAGE_SPECIFIER, parseManifest } from "../registry/manifest.js";
export const DEPENDENCIES_DIRECTORY = join(".openschema", "dependencies");
const OUTSIDE_A_PROJECT = { locate: () => null, packageOf: () => null };
export function isPackageSpecifier(specifier) {
    return PACKAGE_SPECIFIER.test(specifier);
}
export function packageLocator(entryId, readFileOrNull) {
    const projectRoot = findProjectRoot(dirname(entryId), readFileOrNull);
    if (projectRoot === null)
        return OUTSIDE_A_PROJECT;
    const dependenciesRoot = join(projectRoot, DEPENDENCIES_DIRECTORY);
    return {
        locate: specifier => packageEntry(join(dependenciesRoot, specifier), readFileOrNull),
        packageOf: path => packageContaining(dependenciesRoot, path),
    };
}
function packageContaining(dependenciesRoot, path) {
    const inside = relative(dependenciesRoot, path);
    if (inside.startsWith("..") || isAbsolute(inside))
        return null;
    const [scope, name] = inside.split(sep);
    return `${scope}/${name}`;
}
/** The nearest directory at or above `startDirectory` that holds an openschema.yaml. */
export function findProjectRoot(startDirectory, readFileOrNull) {
    let directory = startDirectory;
    while (readFileOrNull(join(directory, MANIFEST_FILE)) === null) {
        const parent = dirname(directory);
        if (parent === directory)
            return null;
        directory = parent;
    }
    return directory;
}
function packageEntry(packageDirectory, readFileOrNull) {
    const manifestText = readFileOrNull(join(packageDirectory, MANIFEST_FILE));
    if (manifestText === null)
        return null;
    const parsed = parseManifest(manifestText);
    if (parsed.manifest === null)
        return null;
    const entryPath = join(packageDirectory, parsed.manifest.entry);
    if (readFileOrNull(entryPath) === null)
        return null;
    return entryPath;
}
//# sourceMappingURL=packages.js.map