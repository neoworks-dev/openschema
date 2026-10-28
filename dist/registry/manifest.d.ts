import { z } from "zod";
export declare const MANIFEST_FILE = "openschema.yaml";
/** `@scope/name`, as a dependency key and an import specifier. */
export declare const PACKAGE_SPECIFIER: RegExp;
declare const manifestShape: z.ZodObject<{
    scope: z.ZodString;
    name: z.ZodString;
    version: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    entry: z.ZodString;
    license: z.ZodOptional<z.ZodString>;
    repository: z.ZodOptional<z.ZodURL>;
    dependencies: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strict>;
export type Manifest = z.infer<typeof manifestShape>;
export type ManifestResult = {
    manifest: Manifest;
    problems: [];
} | {
    manifest: null;
    problems: string[];
};
export declare function parseManifest(text: string): ManifestResult;
/** The manifest text with `@scope/name` required at `requirement`, keeping the rest of the file and its comments. */
export declare function withDependency(manifestText: string, packageName: string, requirement: string): string;
export {};
//# sourceMappingURL=manifest.d.ts.map