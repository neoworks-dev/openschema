// src/cli/dependencies.ts
// `add` and `install`: a project's dependencies, from the requirements in
// openschema.yaml to the downloads in .openschema/dependencies and the exact
// versions openschema.lock pins. Every download finishes before the lock and
// the manifest are written, so a failure leaves the project as it was.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject, resolveModules } from "../resolver/index.js";
import { collectSpaces } from "../ledger/spaces.js";
import { reconcileLedger } from "../ledger/merge.js";
import { defaultLockPath, loadLedger, serializeLedger } from "../ledger/io.js";
import { fetchSchemaDetail, parseSchemaRef } from "../registry/client.js";
import { installDependencies } from "../registry/dependencyInstall.js";
import { MANIFEST_FILE, parseManifest, withDependency } from "../registry/manifest.js";
import { compareVersions, parseVersion, parseVersionRange } from "../registry/versionRange.js";
/** Requires `@scope/name[@requirement]` in the project, downloads the tree and pins it. */
export async function addDependency(reference, projectDirectory, registry, generator) {
    const project = readProject(projectDirectory);
    const schemaRef = parseSchemaRef(reference);
    const packageName = `@${schemaRef.scope}/${schemaRef.name}`;
    if (packageName === `@${project.manifest.scope}/${project.manifest.name}`) {
        throw new Error(`${packageName} is this project; a schema cannot depend on itself`);
    }
    const requirement = await requirementFor(registry, schemaRef);
    const pinned = await installDependencies(project.directory, { ...project.manifest.dependencies, [packageName]: requirement }, lockedDependencies(project), registry);
    writeLock(project, pinned, generator);
    writeFileSync(join(project.directory, MANIFEST_FILE), withDependency(project.manifestText, packageName, requirement), "utf8");
    return { packageName, requirement, pinned };
}
/** Downloads what openschema.yaml requires, keeping the versions openschema.lock pins while they fit. */
export async function installProject(projectDirectory, registry, generator) {
    const project = readProject(projectDirectory);
    const pinned = await installDependencies(project.directory, { ...project.manifest.dependencies }, lockedDependencies(project), registry);
    // A project without dependencies needs no lockfile for them.
    if (Object.keys(pinned).length > 0 || existsSync(project.lockPath))
        writeLock(project, pinned, generator);
    return pinned;
}
function readProject(directory) {
    const manifestPath = join(directory, MANIFEST_FILE);
    if (!existsSync(manifestPath)) {
        throw new Error(`no ${MANIFEST_FILE} in ${directory}; dependencies belong to a project, which openschema init creates`);
    }
    const manifestText = readFileSync(manifestPath, "utf8");
    const parsed = parseManifest(manifestText);
    if (parsed.manifest === null)
        throw new Error(parsed.problems.join("\n"));
    return { directory, manifestText, manifest: parsed.manifest, lockPath: defaultLockPath(join(directory, parsed.manifest.entry)) };
}
/** The requirement the user gave, or `^` and the latest published version. */
async function requirementFor(registry, schemaRef) {
    if (schemaRef.version !== "latest") {
        if (parseVersionRange(schemaRef.version) === null) {
            throw new Error(`'${schemaRef.version}' is not a version requirement such as ^1.2.0`);
        }
        return schemaRef.version;
    }
    const versions = (await fetchSchemaDetail(registry, schemaRef.scope, schemaRef.name)).versions
        .map(parseVersion)
        .filter((version) => version !== null);
    if (versions.length === 0)
        throw new Error(`@${schemaRef.scope}/${schemaRef.name} has no released version`);
    return `^${versions.reduce(laterVersion).join(".")}`;
}
function laterVersion(left, right) {
    if (compareVersions(left, right) >= 0)
        return left;
    return right;
}
function lockedDependencies(project) {
    const loaded = loadLedger(project.lockPath);
    if (loaded.integrityError !== null)
        throw new Error(loaded.integrityError);
    if (loaded.ledger === null)
        return {};
    return loaded.ledger.dependencies;
}
function writeLock(project, pinned, generator) {
    const loaded = loadLedger(project.lockPath);
    if (loaded.integrityError !== null)
        throw new Error(loaded.integrityError);
    let ledger = loaded.ledger;
    if (ledger === null)
        ledger = createLedger(project, generator);
    writeFileSync(project.lockPath, serializeLedger({ ...ledger, dependencies: pinned, updatedAt: new Date().toISOString() }), "utf8");
}
/** A first lockfile records the schema's ordinals as `openschema lock` would, which needs the downloads in place. */
function createLedger(project, generator) {
    const entryPath = join(project.directory, project.manifest.entry);
    const schema = resolveModules(loadProject(entryPath, readFileOrNull));
    if (schema.hasErrors) {
        throw new Error(`${entryPath} has errors, so no ${defaultLockPath(entryPath)} could be created; fix them and run openschema install`);
    }
    return reconcileLedger(collectSpaces(schema), null, {
        mode: "update",
        required: false,
        staleSeverity: "error",
        now: () => new Date().toISOString(),
        generator,
        version: project.manifest.version,
    }).next;
}
const readFileOrNull = (path) => {
    if (!existsSync(path))
        return null;
    return readFileSync(path, "utf8");
};
//# sourceMappingURL=dependencies.js.map