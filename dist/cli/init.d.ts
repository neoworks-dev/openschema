export interface InitOptions {
    scope?: string;
    name?: string;
    title?: string;
    description?: string;
    /** Overwrite files that already exist. */
    force?: boolean;
}
/** The files `init` would write, as path and contents; the manifest is validated before anything is written. */
export declare function starterFiles(directory: string, options: InitOptions): {
    path: string;
    contents: string;
}[];
/** Writes the starter files and returns their paths; refuses to overwrite unless forced. */
export declare function initProject(directory: string, options: InitOptions): string[];
//# sourceMappingURL=init.d.ts.map