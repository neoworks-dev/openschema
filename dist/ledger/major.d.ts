/** "2" for 2.3.4, "0.3" for 0.3.4 and "0.0.4" for 0.0.4; null when `version` is not major.minor.patch. */
export declare function majorOf(version: string): string | null;
/** True when `current` is a later major than `recorded`, both as written by `majorOf`. */
export declare function majorPrecedes(recorded: string, current: string): boolean;
/** The lowest version on the next major, such as 3.0.0 after 2.3.4. */
export declare function nextMajorVersion(version: string): string | null;
//# sourceMappingURL=major.d.ts.map