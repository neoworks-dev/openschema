import type { ReadFileOrNull } from "./moduleGraph.js";
export declare const DEPENDENCIES_DIRECTORY: string;
export interface PackageLocator {
    /** The entry file of a downloaded package, or null when it is not downloaded. */
    locate(specifier: string): string | null;
    /** The `@scope/name` a file was downloaded as, or null for the project's own files. */
    packageOf(path: string): string | null;
}
export declare function isPackageSpecifier(specifier: string): boolean;
export declare function packageLocator(entryId: string, readFileOrNull: ReadFileOrNull): PackageLocator;
/** The nearest directory at or above `startDirectory` that holds an openschema.yaml. */
export declare function findProjectRoot(startDirectory: string, readFileOrNull: ReadFileOrNull): string | null;
//# sourceMappingURL=packages.d.ts.map