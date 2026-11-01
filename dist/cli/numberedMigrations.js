// src/cli/numberedMigrations.ts
// Numbered migration files (`001_init.sql`, `002_….sql`, …) in one directory,
// plus the schema snapshot that remembers what the last generated migration
// migrated to. The snapshot holds the source of every file the schema was
// loaded from, so the previous schema resolves exactly as it did, with no git
// history and no network.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve as resolvePath, sep } from "path";
import { loadProject, resolveModules } from "../resolver/index.js";
export const SNAPSHOT_FILE = "openschema.snapshot.json";
const DEFAULT_NUMBER_WIDTH = 3;
const NUMBERED_FILE = /^(\d+)_/;
/** Load a schema project and capture the files it read, keyed relative to the entry's directory. */
export function loadWithSnapshot(entryPath, readFileOrNull) {
    const baseDirectory = dirname(resolvePath(entryPath));
    const files = {};
    const recordingReader = (path) => {
        const contents = readFileOrNull(path);
        if (contents !== null)
            files[snapshotKey(baseDirectory, path)] = contents;
        return contents;
    };
    const modules = loadProject(entryPath, recordingReader);
    const snapshot = { format: 1, entry: snapshotKey(baseDirectory, entryPath), files: sortedByKey(files) };
    return { modules, snapshot };
}
function snapshotKey(baseDirectory, path) {
    return relative(baseDirectory, resolvePath(path)).split(sep).join("/");
}
function sortedByKey(files) {
    const sorted = {};
    for (const key of Object.keys(files).sort())
        sorted[key] = files[key];
    return sorted;
}
/**
 * Resolve a snapshot as if its files sat beside `entryPath`. Only the snapshot's
 * files are visible, so later edits on disk cannot leak into the old schema.
 * Throws with the diagnostics when it does not resolve.
 */
export function resolveSnapshot(snapshot, entryPath) {
    const baseDirectory = dirname(resolvePath(entryPath));
    const snapshotReader = (path) => {
        const contents = snapshot.files[snapshotKey(baseDirectory, path)];
        if (contents === undefined)
            return null;
        return contents;
    };
    const schema = resolveModules(loadProject(resolvePath(baseDirectory, snapshot.entry), snapshotReader));
    const errors = schema.diagnostics.filter(diagnostic => diagnostic.severity === "error");
    if (errors.length > 0) {
        throw new Error(`the schema snapshot does not resolve: ${errors.map(diagnostic => `${diagnostic.code} ${diagnostic.message}`).join("; ")}`);
    }
    return schema;
}
/** A schema with nothing in it: the starting point of a project's first migration. */
export function emptySchema() {
    return resolveModules([]);
}
export function readSnapshot(path) {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed.format !== 1 || typeof parsed.entry !== "string" || typeof parsed.files !== "object") {
        throw new Error(`${path} is not an OpenSchema snapshot`);
    }
    return parsed;
}
export function writeSnapshot(path, snapshot) {
    writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
}
/** The numbered migration files in a directory, hand-written ones included. */
export function numberedFiles(directory) {
    if (!existsSync(directory))
        return [];
    return readdirSync(directory).filter(name => NUMBERED_FILE.test(name));
}
/**
 * The file name of the next migration: one past the highest number in the
 * directory, keeping the zero padding of that number (3 digits when empty).
 */
export function nextMigrationFileName(existing, name, extension) {
    let highest = 0;
    let width = DEFAULT_NUMBER_WIDTH;
    for (const file of existing) {
        const match = NUMBERED_FILE.exec(file);
        if (match === null)
            continue;
        const digits = match[1];
        const number = Number(digits);
        if (number < highest)
            continue;
        highest = number;
        width = digits.length;
    }
    const number = String(highest + 1).padStart(width, "0");
    return `${number}_${migrationSlug(name)}.${extension}`;
}
/** A migration name as it appears in a file name: lower case, words joined by `_`. */
export function migrationSlug(name) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (slug.length === 0)
        throw new Error(`'${name}' has no letters or digits to name a migration file with`);
    return slug;
}
/** The text of a numbered migration with no schema change, for a hand-written data migration. */
export function emptyMigration(fileName) {
    return `-- ${fileName}: no schema change. Write the data migration here.\n`;
}
export function snapshotPathIn(directory) {
    return join(directory, SNAPSHOT_FILE);
}
//# sourceMappingURL=numberedMigrations.js.map