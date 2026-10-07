import { z } from "zod";
export declare const MANIFEST_FILE = "openschema.yaml";
declare const manifestShape: z.ZodObject<{
    scope: z.ZodString;
    name: z.ZodString;
    version: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    entry: z.ZodString;
    license: z.ZodOptional<z.ZodString>;
    repository: z.ZodOptional<z.ZodURL>;
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
export {};
//# sourceMappingURL=manifest.d.ts.map