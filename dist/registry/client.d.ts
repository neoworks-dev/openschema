/** Default neoworks API base (production). Override via the base-domain env or --registry. */
export declare const DEFAULT_REGISTRY = "https://api.neoworks.dev";
export interface SchemaRef {
    scope: string;
    name: string;
    /** Concrete version, or "latest". */
    version: string;
}
export interface RegistryFile {
    path: string;
    contents: string;
    ordinal: number;
}
export interface ResolvedSchema {
    scope: string;
    name: string;
    version: string;
    files: RegistryFile[];
}
/** Resolve the registry (api) base URL from an explicit flag, env, or the base domain. */
export declare function resolveRegistry(explicit?: string): string;
/**
 * Parse a schema reference like "@neoworks/commerce", "neoworks/commerce", or
 * "@neoworks/commerce@2.4.1". The leading "@" and an explicit version are
 * optional; the version defaults to "latest".
 */
export declare function parseSchemaRef(input: string): SchemaRef;
/** Fetch a schema version's source files from the registry. */
export declare function fetchSchema(registry: string, ref: SchemaRef): Promise<ResolvedSchema>;
export interface PublishPayload {
    scope: string;
    name: string;
    version: string;
    description?: string;
    license?: string;
    repository?: string;
    readme?: string;
    targets?: string[];
    files: {
        path: string;
        contents: string;
    }[];
}
/**
 * Submit a schema to the openschema site's /publish endpoint. The site (the org's
 * server) authenticates the bearer token and writes the org-owned registry rows.
 */
export declare function publish(site: string, token: string, payload: PublishPayload): Promise<void>;
//# sourceMappingURL=client.d.ts.map