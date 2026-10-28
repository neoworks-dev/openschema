export type Version = [number, number, number];
/** Versions from `lowest` (inclusive) up to `below` (exclusive); null is unbounded. */
export interface VersionRange {
    lowest: Version | null;
    below: Version | null;
}
/** The range a requirement allows, or null when it is not one. */
export declare function parseVersionRange(text: string): VersionRange | null;
/** A plain major.minor.patch version, or null for anything else, such as an old pre-release. */
export declare function parseVersion(text: string): Version | null;
export declare function rangeIncludes(range: VersionRange, version: Version): boolean;
export declare function compareVersions(left: Version, right: Version): number;
//# sourceMappingURL=versionRange.d.ts.map