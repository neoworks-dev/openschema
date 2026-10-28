/** What selection needs from the registry. */
export interface DependencySource {
    /** Every published version of `@scope/name`. */
    versions(packageName: string): Promise<string[]>;
    /** The requirements a published version lists, keyed by `@scope/name`. */
    dependenciesOf(packageName: string, version: string): Promise<Record<string, string>>;
}
interface Requirement {
    range: string;
    /** `@scope/name@version` of the dependency that sets it; null for the project. */
    requiredBy: string | null;
}
/** No version of a package meets every requirement on it. */
export declare class DependencyConflictError extends Error {
    readonly packageName: string;
    readonly requirements: Requirement[];
    constructor(packageName: string, requirements: Requirement[]);
}
/**
 * The exact version of each package, keyed by `@scope/name`. `locked` holds the
 * versions from the lockfile, kept while every requirement still allows them.
 */
export declare function selectVersions(projectRequirements: Record<string, string>, source: DependencySource, locked?: Record<string, string>): Promise<Record<string, string>>;
export {};
//# sourceMappingURL=dependencySelection.d.ts.map