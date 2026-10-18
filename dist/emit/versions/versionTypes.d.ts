import type { ResolvedSchema } from "../../resolver/types.js";
export interface VersionedSchema {
    /** `major.minor.patch`. */
    version: string;
    schema: ResolvedSchema;
}
export declare class VersionTypesError extends Error {
}
/** `Contact` at 0.4.0 is `Contact_0_4_0`. */
export declare function versionedName(name: string, version: string): string;
/** The module text; `codecModule` is imported from for the built-in File type. */
export declare function emitVersionTypes(versions: VersionedSchema[], codecModule: string | undefined): string;
//# sourceMappingURL=versionTypes.d.ts.map