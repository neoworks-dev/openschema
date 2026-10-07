// src/registry/preparePublish.ts
// Everything publish checks before uploading, with no network: the manifest, the
// schema it names, the ordinal ledger and, for Neoworks collections, the
// descriptor. A published version is immutable, so nothing is uploaded unless
// every check passes.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject, resolveModules } from "../resolver/index.js";
import { collectSpaces } from "../ledger/spaces.js";
import { reconcileLedger } from "../ledger/merge.js";
import { defaultLockPath, loadLedger } from "../ledger/io.js";
import { hasDecorator } from "../emit/typeMapping.js";
import { descriptorEmitter } from "../emit/descriptor/descriptorEmitter.js";
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
    const schema = resolveEntry(entryPath);
    checkLedger(entryPath, schema, generator);
    const payload = {
        scope: manifest.scope,
        name: manifest.name,
        version: manifest.version,
        title: manifest.title,
        description: manifest.description,
        license: manifest.license,
        repository: manifest.repository,
        targets: [],
        files: collectSchemaFiles(directory),
    };
    const descriptor = describeNodes(schema);
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
function resolveEntry(entryPath) {
    let schema;
    try {
        schema = resolveModules(loadProject(entryPath, readFileOrNull));
    }
    catch (error) {
        throw new PublishRefused([`${entryPath}: ${error.message}`]);
    }
    const errors = schema.diagnostics.filter(diagnostic => diagnostic.severity === "error");
    if (errors.length > 0) {
        throw new PublishRefused(errors.map(diagnostic => `${diagnostic.code} ${diagnostic.message}`));
    }
    return schema;
}
/** The lockfile must exist and already record this schema: publishing never writes it. */
function checkLedger(entryPath, schema, generator) {
    const lockPath = defaultLockPath(entryPath);
    const loaded = loadLedger(lockPath);
    if (loaded.integrityError !== null)
        throw new PublishRefused([`OS2009 ${loaded.integrityError}`]);
    const result = reconcileLedger(collectSpaces(schema), loaded.ledger, {
        mode: "check",
        required: true,
        staleSeverity: "error",
        now: () => new Date().toISOString(),
        generator,
    });
    const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === "error");
    if (errors.length > 0) {
        throw new PublishRefused(errors.map(diagnostic => `${diagnostic.code} ${diagnostic.message}`));
    }
}
/** The descriptor, exactly as the descriptor target writes it, when the schema defines Neoworks nodes. */
function describeNodes(schema) {
    const definesNodes = [...schema.records.values()].some(record => hasDecorator(record.decorators, "neoworks.node"));
    if (!definesNodes)
        return null;
    try {
        const [file] = descriptorEmitter.emit({ schema, company: null, includePrivate: false, options: {} });
        return file.contents;
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
function collectSchemaFiles(directory) {
    return readdirSync(directory)
        .filter(entry => entry.endsWith(".schema"))
        .sort()
        .map(entry => ({ path: entry, contents: readFileSync(join(directory, entry), "utf8") }));
}
//# sourceMappingURL=preparePublish.js.map