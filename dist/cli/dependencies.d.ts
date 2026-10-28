import type { LockedDependency } from "../ledger/types.js";
export interface AddResult {
    packageName: string;
    requirement: string;
    pinned: Record<string, LockedDependency>;
}
/** Requires `@scope/name[@requirement]` in the project, downloads the tree and pins it. */
export declare function addDependency(reference: string, projectDirectory: string, registry: string, generator: string): Promise<AddResult>;
/** Downloads what openschema.yaml requires, keeping the versions openschema.lock pins while they fit. */
export declare function installProject(projectDirectory: string, registry: string, generator: string): Promise<Record<string, LockedDependency>>;
//# sourceMappingURL=dependencies.d.ts.map