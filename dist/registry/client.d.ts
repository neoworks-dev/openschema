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
/**
 * Fetch a schema version's source files from the registry. The read is marked
 * `download=1`, so the registry counts it as a download of that version.
 */
export declare function fetchSchema(registry: string, ref: SchemaRef): Promise<ResolvedSchema>;
/** A schema's current title and description, and every version it has published. */
export interface SchemaDetail {
    title: string;
    description: string;
    versions: string[];
}
export declare function fetchSchemaDetail(registry: string, scope: string, name: string): Promise<SchemaDetail>;
/** A published version as dependencies need it. `entry` is empty for versions published before entries were kept. */
export interface VersionDetail {
    entry: string;
    files: RegistryFile[];
    dependencies: PublishedDependency[];
}
/** A version's files in ordinal order; `download` counts the read as a download. */
export declare function fetchVersionDetail(registry: string, scope: string, name: string, version: string, download: boolean): Promise<VersionDetail>;
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
    /** The file the CLI compiles, one of `files`. */
    entry: string;
    files: {
        path: string;
        contents: string;
    }[];
    dependencies: PublishedDependency[];
    /** Every schema in the dependency tree at the version openschema.lock pins. */
    pinned: PinnedVersion[];
    /** The descriptor target's output, when the schema defines Neoworks nodes. */
    descriptor?: string;
}
/** A schema the version was published against, at its exact version and with the integrity of its files. */
export interface PinnedVersion {
    scope: string;
    name: string;
    version: string;
    integrity: string;
}
/** A schema the version imports from, with its manifest's version requirement. */
export interface PublishedDependency {
    scope: string;
    name: string;
    requirement: string;
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
/** The api's error body. */
interface PublishResponseBody {
    /** The error code, e.g. `missing_permission` or `archived`. */
    error?: string;
    message?: string;
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
 * Submit a schema version to the registry. The api checks the token's
 * schemas:publish scope and the caller's schemas.publish permission for the
 * owner of the scope. A 409 that lists violations throws an
 * IncompatibleSchemaError; a 401, 403, 404 or other refusal throws a
 * PublishRefusedError that says what to do about it.
 */
export declare function publish(registry: string, token: string, payload: PublishPayload): Promise<void>;
/** The lines the CLI prints for a refused publish: one header, then each violation. */
export declare function describeViolations(payload: Pick<PublishPayload, "scope" | "name" | "version">, violations: Violation[]): string[];
export {};
//# sourceMappingURL=client.d.ts.map