// src/registry/preparePublish.ts
// Everything publish checks before uploading, with no network: the manifest, the
// schema it names, the ordinal ledger and, for Neoworks collections, the
// descriptor. A published version is immutable, so nothing is uploaded unless
// every check passes.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject, resolveModules } from "../resolver/index.js";
import { DEPENDENCIES_DIRECTORY, isPackageSpecifier } from "../resolver/packages.js";
import { parseVersion, parseVersionRange, rangeIncludes } from "./versionRange.js";
import { collectSpaces } from "../ledger/spaces.js";
import { reconcileLedger } from "../ledger/merge.js";
import { defaultLockPath, loadLedger } from "../ledger/io.js";
import { definesNeoworksTables, publishedDescriptor } from "../emit/descriptor/descriptorEmitter.js";
import { DescriptorError } from "../emit/descriptor/errors.js";
import { CodecUnsupportedError } from "../emit/codec/errors.js";
import { MANIFEST_FILE, parseManifest } from "./manifest.js";
class PublishRefused extends Error {
    constructor(problems) {
        super(problems.join("\n"));
        this.problems = problems;
    }
}
export function preparePublish(directory, generator) {
    try {
        return { payload: buildPayload(directory, generator), problems: [] };
    }
    catch (error) {
        if (error instanceof PublishRefused)
            return { payload: null, problems: error.problems };
        throw error;
    }
}
function buildPayload(directory, generator) {
    const manifest = readManifest(directory);
    const entryPath = join(directory, manifest.entry);
    const modules = loadEntry(entryPath);
    const requirements = { ...manifest.dependencies };
    checkImportsAreListed(modules, requirements);
    const schema = resolveEntry(modules);
    const ledger = checkLedger(entryPath, schema, generator, manifest.version);
    checkDependenciesArePinned(directory, requirements, ledger);
    const payload = {
        scope: manifest.scope,
        name: manifest.name,
        version: manifest.version,
        title: manifest.title,
        description: manifest.description,
        license: manifest.license,
        repository: manifest.repository,
        targets: [],
        entry: manifest.entry,
        files: collectSchemaFiles(directory),
        dependencies: publishedDependencies(manifest),
        pinned: pinnedVersions(ledger),
    };
    const descriptor = describeTables(schema);
    if (descriptor !== null)
        payload.descriptor = descriptor;
    return payload;
}
function readManifest(directory) {
    const path = join(directory, MANIFEST_FILE);
    if (!existsSync(path)) {
        throw new PublishRefused([`no ${MANIFEST_FILE} in ${directory}; publishing needs a manifest`]);
    }
    const parsed = parseManifest(readFileSync(path, "utf8"));
    if (parsed.manifest === null)
        throw new PublishRefused(parsed.problems);
    if (!existsSync(join(directory, parsed.manifest.entry))) {
        throw new PublishRefused([`${MANIFEST_FILE}: entry ${parsed.manifest.entry} does not exist`]);
    }
    return parsed.manifest;
}
const readFileOrNull = (path) => {
    if (!existsSync(path))
        return null;
    return readFileSync(path, "utf8");
};
function loadEntry(entryPath) {
    try {
        return loadProject(entryPath, readFileOrNull);
    }
    catch (error) {
        throw new PublishRefused([`${entryPath}: ${error.message}`]);
    }
}
function resolveEntry(modules) {
    const schema = resolveModules(modules);
    const errors = schema.diagnostics.filter(diagnostic => diagnostic.severity === "error");
    if (errors.length > 0) {
        throw new PublishRefused(errors.map(diagnostic => `${diagnostic.code} ${diagnostic.message}`));
    }
    return schema;
}
/** The lockfile must exist and already record this schema: publishing never writes it. */
function checkLedger(entryPath, schema, generator, version) {
    const loaded = loadLedger(defaultLockPath(entryPath));
    if (loaded.integrityError !== null)
        throw new PublishRefused([`OS2009 ${loaded.integrityError}`]);
    const result = reconcileLedger(collectSpaces(schema), loaded.ledger, {
        mode: "check",
        required: true,
        staleSeverity: "error",
        now: () => new Date().toISOString(),
        generator,
        version,
    });
    const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === "error");
    if (errors.length > 0 || loaded.ledger === null) {
        throw new PublishRefused(errors.map(diagnostic => `${diagnostic.code} ${diagnostic.message}`));
    }
    return loaded.ledger;
}
// ── Dependencies ─────────────────────────────────────────────────────────────
// Whoever depends on this version resolves its imports from its manifest, so
// every package the project's own files import must be listed there, and what
// was checked here must be what the lock pins.
function checkImportsAreListed(modules, requirements) {
    const problems = modules
        .filter(module => module.packageName === null)
        .flatMap(module => unlistedImports(module, requirements));
    if (problems.length > 0)
        throw new PublishRefused(problems);
}
function unlistedImports(module, requirements) {
    return module.program.declarations
        .filter(declaration => declaration.kind === "import" && isPackageSpecifier(declaration.from))
        .map(declaration => declaration.from)
        .filter(specifier => !(specifier in requirements))
        .map(specifier => `${module.sourcePath} imports ${specifier}, which ${MANIFEST_FILE} does not list; run openschema add ${specifier}`);
}
function checkDependenciesArePinned(directory, requirements, ledger) {
    const problems = Object.entries(requirements)
        .map(([packageName, requirement]) => pinningProblem(directory, packageName, requirement, ledger.dependencies[packageName]))
        .filter((problem) => problem !== null);
    if (problems.length > 0)
        throw new PublishRefused(problems);
}
function pinningProblem(directory, packageName, requirement, locked) {
    if (locked === undefined)
        return `${packageName} is not pinned in openschema.lock; run openschema install`;
    if (!rangeIncludes(parseVersionRange(requirement), parseVersion(locked.version))) {
        return `openschema.lock pins ${packageName}@${locked.version}, outside ${requirement}; run openschema install`;
    }
    const downloaded = downloadedVersion(join(directory, DEPENDENCIES_DIRECTORY, packageName));
    if (downloaded !== locked.version) {
        return `the downloaded ${packageName} is not the ${locked.version} openschema.lock pins; run openschema install`;
    }
    return null;
}
function downloadedVersion(packageDirectory) {
    const manifestText = readFileOrNull(join(packageDirectory, MANIFEST_FILE));
    if (manifestText === null)
        return null;
    const parsed = parseManifest(manifestText);
    if (parsed.manifest === null)
        return null;
    return parsed.manifest.version;
}
/** The descriptor, exactly as the descriptor target writes it, when the schema defines Neoworks tables. */
function describeTables(schema) {
    if (!definesNeoworksTables(schema))
        return null;
    try {
        return publishedDescriptor(schema);
    }
    catch (error) {
        throw new PublishRefused([describeEmitError(error)]);
    }
}
function describeEmitError(error) {
    if (error instanceof DescriptorError || error instanceof CodecUnsupportedError) {
        return `${error.code} ${error.message}`;
    }
    return `descriptor: ${error.message}`;
}
function publishedDependencies(manifest) {
    if (manifest.dependencies === undefined)
        return [];
    return Object.entries(manifest.dependencies).map(([specifier, requirement]) => {
        const [scope, name] = specifier.slice(1).split("/");
        return { scope, name, requirement };
    });
}
/** The whole tree as openschema.lock pins it, so the registry can show the version as it was built. */
function pinnedVersions(ledger) {
    return Object.entries(ledger.dependencies).map(([packageName, locked]) => {
        const [scope, name] = packageName.slice(1).split("/");
        return { scope, name, version: locked.version, integrity: locked.integrity };
    });
}
function collectSchemaFiles(directory) {
    return readdirSync(directory)
        .filter(entry => entry.endsWith(".schema"))
        .sort()
        .map(entry => ({ path: entry, contents: readFileSync(join(directory, entry), "utf8") }));
}
//# sourceMappingURL=preparePublish.js.map