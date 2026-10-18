import { type Endpoints } from "./urls.js";
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
export declare function resolveRegistry(explicit?: string, endpoints?: Endpoints): string;
/**
 * Parse a schema reference like "@neoworks/commerce", "neoworks/commerce", or
 * "@neoworks/commerce@2.4.1". The leading "@" and an explicit version are
 * optional; the version defaults to "latest".
 */
export declare function parseSchemaRef(input: string): SchemaRef;
/** Fetch a schema version's source files from the registry. */
export declare function fetchSchema(registry: string, ref: SchemaRef): Promise<ResolvedSchema>;
/** Every published version of a schema, as the registry lists them. */
export declare function listVersions(registry: string, scope: string, name: string): Promise<string[]>;
export interface PublishPayload {
    scope: string;
    name: string;
    version: string;
    title: string;
    description: string;
    license?: string;
    repository?: string;
    readme?: string;
    targets?: string[];
    files: {
        path: string;
        contents: string;
    }[];
    /** The descriptor target's output, when the schema defines Neoworks nodes. */
    descriptor?: string;
}
/** One rule a refused publish broke; `path` points into the schema's descriptor. */
export interface Violation {
    rule: string;
    path: string;
    message: string;
}
/** The registry refused the version because it breaks versions published before it. */
export declare class IncompatibleSchemaError extends Error {
    readonly violations: Violation[];
    constructor(message: string, violations: Violation[]);
}
interface PublishResponseBody {
    error?: string;
    /** The api's error code, e.g. `missing_permission` or `archived`. */
    code?: string;
    /** For `missing_permission`: the permission the caller lacks. */
    permission?: string;
    violations?: Violation[];
}
/** The registry refused the publish for a reason about the scope or the sign-in, not the schema. */
export declare class PublishRefusedError extends Error {
    readonly status: number;
    readonly code: string | undefined;
    constructor(message: string, status: number, code: string | undefined);
}
/**
 * Why a publish was refused, in terms of what the user can do about it. Reasons
 * the api explains itself (an existing version, invalid input) keep its message.
 */
export declare function describePublishRefusal(payload: Pick<PublishPayload, "scope">, status: number, body: PublishResponseBody): string;
/**
 * Submit a schema to the openschema site's /publish endpoint. The site (the org's
 * server) authenticates the bearer token and writes the org-owned registry rows.
 * A 409 that lists violations throws an IncompatibleSchemaError; a 401, 403, 404
 * or other refusal throws a PublishRefusedError that says what to do about it.
 */
export declare function publish(site: string, token: string, payload: PublishPayload): Promise<void>;
/** The lines the CLI prints for a refused publish: one header, then each violation. */
export declare function describeViolations(payload: Pick<PublishPayload, "scope" | "name" | "version">, violations: Violation[]): string[];
export {};
//# sourceMappingURL=client.d.ts.map