import type { LockedDependency } from "../ledger/types.js";
/** The pinned version and integrity of every package in the tree, keyed by `@scope/name`. */
export declare function installDependencies(projectDirectory: string, requirements: Record<string, string>, locked: Record<string, LockedDependency>, registry: string): Promise<Record<string, LockedDependency>>;
//# sourceMappingURL=dependencyInstall.d.ts.map