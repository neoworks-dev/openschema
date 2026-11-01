import type { ReadFileOrNull } from "../resolver/moduleGraph.js";
import type { Module, ResolvedSchema } from "../resolver/types.js";
export declare const SNAPSHOT_FILE = "openschema.snapshot.json";
/** The schema as of the last numbered migration: its entry file and every file it read. */
export interface SchemaSnapshot {
    format: 1;
    entry: string;
    files: Record<string, string>;
}
/** Load a schema project and capture the files it read, keyed relative to the entry's directory. */
export declare function loadWithSnapshot(entryPath: string, readFileOrNull: ReadFileOrNull): {
    modules: Module[];
    snapshot: SchemaSnapshot;
};
/**
 * Resolve a snapshot as if its files sat beside `entryPath`. Only the snapshot's
 * files are visible, so later edits on disk cannot leak into the old schema.
 * Throws with the diagnostics when it does not resolve.
 */
export declare function resolveSnapshot(snapshot: SchemaSnapshot, entryPath: string): ResolvedSchema;
/** A schema with nothing in it: the starting point of a project's first migration. */
export declare function emptySchema(): ResolvedSchema;
export declare function readSnapshot(path: string): SchemaSnapshot;
export declare function writeSnapshot(path: string, snapshot: SchemaSnapshot): void;
/** The numbered migration files in a directory, hand-written ones included. */
export declare function numberedFiles(directory: string): string[];
/**
 * The file name of the next migration: one past the highest number in the
 * directory, keeping the zero padding of that number (3 digits when empty).
 */
export declare function nextMigrationFileName(existing: string[], name: string, extension: string): string;
/** A migration name as it appears in a file name: lower case, words joined by `_`. */
export declare function migrationSlug(name: string): string;
/** The text of a numbered migration with no schema change, for a hand-written data migration. */
export declare function emptyMigration(fileName: string): string;
export declare function snapshotPathIn(directory: string): string;
//# sourceMappingURL=numberedMigrations.d.ts.map