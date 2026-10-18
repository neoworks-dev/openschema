// src/registry/versionSnapshots.ts
// The schema files of every published version, kept beside the manifest in
// versions/<major.minor.patch>/. `publish` writes the version it uploaded and
// `versions pull` fetches the others from the registry, so generating the types
// of every version needs no network.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject, resolveModules } from "../resolver/index.js";
export const VERSIONS_DIRECTORY = "versions";
const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function writeVersionSnapshot(projectDirectory, version, files) {
    const directory = join(projectDirectory, VERSIONS_DIRECTORY, version);
    mkdirSync(directory, { recursive: true });
    for (const file of files)
        writeFileSync(join(directory, file.path), file.contents, "utf8");
    return directory;
}
/** The snapshotted versions, oldest first. */
export function snapshotVersions(projectDirectory) {
    const directory = join(projectDirectory, VERSIONS_DIRECTORY);
    if (!existsSync(directory))
        return [];
    return readdirSync(directory).filter(entry => RELEASE.test(entry)).sort(compareVersions);
}
export function compareVersions(left, right) {
    const leftParts = left.split(".").map(Number);
    const rightParts = right.split(".").map(Number);
    for (let index = 0; index < 3; index++) {
        if (leftParts[index] !== rightParts[index])
            return leftParts[index] - rightParts[index];
    }
    return 0;
}
const readFileOrNull = (path) => {
    if (!existsSync(path))
        return null;
    return readFileSync(path, "utf8");
};
/** Throws with the diagnostics when the snapshot does not resolve. */
export function resolveSnapshot(projectDirectory, version, entry) {
    const entryPath = join(projectDirectory, VERSIONS_DIRECTORY, version, entry);
    if (!existsSync(entryPath)) {
        throw new Error(`${entryPath} does not exist; a snapshot holds the published files under the manifest's entry name`);
    }
    const schema = resolveModules(loadProject(entryPath, readFileOrNull));
    const errors = schema.diagnostics.filter(diagnostic => diagnostic.severity === "error");
    if (errors.length > 0) {
        throw new Error(`${entryPath}: ${errors.map(diagnostic => `${diagnostic.code} ${diagnostic.message}`).join("; ")}`);
    }
    return schema;
}
//# sourceMappingURL=versionSnapshots.js.map