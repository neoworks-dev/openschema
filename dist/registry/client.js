// src/registry/client.ts
// Minimal read client for the OpenSchema public registry, served by the neoworks
// api under /api/v1/schemas. Reads need no token.
import { resolveEndpoints } from "./urls.js";
/** Default neoworks API base (production). Override via the base-domain env or --registry. */
export const DEFAULT_REGISTRY = "https://api.neoworks.dev";
/** Resolve the registry (api) base URL from an explicit flag, env, or the base domain. */
export function resolveRegistry(explicit, endpoints = resolveEndpoints()) {
    const base = explicit || endpoints.api;
    return base.replace(/\/+$/, "");
}
/**
 * Parse a schema reference like "@neoworks/commerce", "neoworks/commerce", or
 * "@neoworks/commerce@2.4.1". The leading "@" and an explicit version are
 * optional; the version defaults to "latest".
 */
export function parseSchemaRef(input) {
    let rest = input.trim();
    if (rest.startsWith("@")) {
        rest = rest.slice(1);
    }
    let version = "latest";
    const at = rest.indexOf("@");
    if (at !== -1) {
        version = rest.slice(at + 1);
        rest = rest.slice(0, at);
    }
    const slash = rest.indexOf("/");
    if (slash === -1) {
        throw new Error(`invalid schema reference "${input}" — expected @scope/name[@version]`);
    }
    const scope = rest.slice(0, slash);
    const name = rest.slice(slash + 1);
    if (!scope || !name) {
        throw new Error(`invalid schema reference "${input}" — expected @scope/name[@version]`);
    }
    return { scope, name, version };
}
async function getJson(url, notFoundMessage) {
    const response = await fetch(url);
    if (response.status === 404) {
        throw new Error(notFoundMessage);
    }
    if (!response.ok) {
        throw new Error(`registry request failed (${response.status} ${response.statusText})`);
    }
    return (await response.json());
}
/** Fetch a schema version's source files from the registry. */
export async function fetchSchema(registry, ref) {
    const schemaUrl = `${registry}/api/v1/schemas/${encodeURIComponent(ref.scope)}/${encodeURIComponent(ref.name)}`;
    let version = ref.version;
    if (version === "latest" || version === "") {
        const detail = await getJson(schemaUrl, `schema @${ref.scope}/${ref.name} not found in the registry`);
        version = detail.schema.latestVersion;
    }
    const versionRow = await getJson(`${schemaUrl}/versions/${encodeURIComponent(version)}`, `version ${version} of @${ref.scope}/${ref.name} not found`);
    const files = [...versionRow.files].sort((a, b) => a.ordinal - b.ordinal);
    return { scope: ref.scope, name: ref.name, version, files };
}
/** The registry refused the version because it breaks versions published before it. */
export class IncompatibleSchemaError extends Error {
    constructor(message, violations) {
        super(message);
        this.violations = violations;
        this.name = "IncompatibleSchemaError";
    }
}
/** The registry refused the publish for a reason about the scope or the sign-in, not the schema. */
export class PublishRefusedError extends Error {
    constructor(message, status, code) {
        super(message);
        this.status = status;
        this.code = code;
        this.name = "PublishRefusedError";
    }
}
/**
 * Why a publish was refused, in terms of what the user can do about it. Reasons
 * the api explains itself (an existing version, invalid input) keep its message.
 */
export function describePublishRefusal(payload, status, body) {
    const scope = `@${payload.scope}`;
    if (status === 401) {
        return "you are not signed in; run `openschema login`";
    }
    if (status === 403) {
        let permission = "schemas.publish";
        if (body.permission) {
            permission = body.permission;
        }
        return `you may not publish into ${scope}: it needs the ${permission} permission for the owner of ${scope}`;
    }
    if (status === 404) {
        return `${scope} is not a handle: pick it in the developer dashboard (as your own handle, or by creating an organization) before publishing into it`;
    }
    if (status === 409 && body.code === "archived") {
        return `${scope} belongs to an archived organization; nobody can publish into it`;
    }
    if (body.error) {
        return body.error;
    }
    return `publish failed (${status})`;
}
/**
 * Submit a schema to the openschema site's /publish endpoint. The site (the org's
 * server) authenticates the bearer token and writes the org-owned registry rows.
 * A 409 that lists violations throws an IncompatibleSchemaError; a 401, 403, 404
 * or other refusal throws a PublishRefusedError that says what to do about it.
 */
export async function publish(site, token, payload) {
    const response = await fetch(`${site.replace(/\/+$/, "")}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({})));
    if (response.ok) {
        return;
    }
    const message = describePublishRefusal(payload, response.status, body);
    if (response.status === 409 && Array.isArray(body.violations) && body.violations.length > 0) {
        throw new IncompatibleSchemaError(message, body.violations);
    }
    throw new PublishRefusedError(message, response.status, body.code);
}
/** The lines the CLI prints for a refused publish: one header, then each violation. */
export function describeViolations(payload, violations) {
    const lines = [`@${payload.scope}/${payload.name}@${payload.version} is not compatible with the versions already published:`];
    for (const violation of violations) {
        lines.push(`  ${violation.rule}  ${violation.path}`);
        lines.push(`      ${violation.message}`);
    }
    return lines;
}
//# sourceMappingURL=client.js.map