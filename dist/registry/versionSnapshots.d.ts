import type { ResolvedSchema } from "../resolver/types.js";
export declare const VERSIONS_DIRECTORY = "versions";
export declare function writeVersionSnapshot(projectDirectory: string, version: string, files: {
    path: string;
    contents: string;
}[]): string;
/** The snapshotted versions, oldest first. */
export declare function snapshotVersions(projectDirectory: string): string[];
export declare function compareVersions(left: string, right: string): number;
/** Throws with the diagnostics when the snapshot does not resolve. */
export declare function resolveSnapshot(projectDirectory: string, version: string, entry: string): ResolvedSchema;
//# sourceMappingURL=versionSnapshots.d.ts.map