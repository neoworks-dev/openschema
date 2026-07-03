// src/registry/client.ts
// Minimal read client for the OpenSchema public registry. The registry is a
// neoworks client database of org-scoped, publicly-readable tables, served by the
// generic neoworks data plane — so reads are plain anonymous GraphQL queries
// against /graphql/db/openschema/registry. No registry-specific API surface.
import { resolveEndpoints } from "./urls.js";
/** Default neoworks API base (production). Override via the base-domain env or --registry. */
export const DEFAULT_REGISTRY = "https://api.neoworks.dev";
const CLIENT_ID = "openschema";
const DB_NAME = "registry";
/** Resolve the registry (data plane) base URL from an explicit flag, env, or the base domain. */
export function resolveRegistry(explicit) {
    const base = explicit || resolveEndpoints().api;
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
function dataPlaneUrl(registry) {
    return `${registry}/graphql/db/${CLIENT_ID}/${DB_NAME}`;
}
async function query(registry, gql, variables) {
    const response = await fetch(dataPlaneUrl(registry), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: gql, variables }),
    });
    if (!response.ok) {
        throw new Error(`registry request failed (${response.status} ${response.statusText})`);
    }
    const body = (await response.json());
    if (body.errors && body.errors.length > 0) {
        throw new Error(body.errors.map((e) => e.message).join("; "));
    }
    if (!body.data) {
        throw new Error("registry returned no data");
    }
    return body.data;
}
/** Fetch a schema version's source files via the data plane's public reads. */
export async function fetchSchema(registry, ref) {
    const schemaData = await query(registry, `query($scope: String, $name: String) {
      schemas(filter: { scope: $scope, name: $name }, limit: 1) { id latest_version }
    }`, { scope: ref.scope, name: ref.name });
    const schema = schemaData.schemas?.[0];
    if (!schema) {
        throw new Error(`schema @${ref.scope}/${ref.name} not found in the registry`);
    }
    const version = ref.version === "latest" || ref.version === "" ? schema.latest_version : ref.version;
    const versionData = await query(registry, `query($sid: String, $ver: String) {
      schema_versions(filter: { schema_id: $sid, version: $ver }, limit: 1) { id }
    }`, { sid: schema.id, ver: version });
    const versionRow = versionData.schema_versions?.[0];
    if (!versionRow) {
        throw new Error(`version ${version} of @${ref.scope}/${ref.name} not found`);
    }
    const fileData = await query(registry, `query($vid: String) {
      schema_files(filter: { version_id: $vid }, limit: 200) { path contents ordinal }
    }`, { vid: versionRow.id });
    const files = (fileData.schema_files ?? []).sort((a, b) => a.ordinal - b.ordinal);
    return { scope: ref.scope, name: ref.name, version, files };
}
/**
 * Submit a schema to the openschema site's /publish endpoint. The site (the org's
 * server) authenticates the bearer token and writes the org-owned registry rows.
 */
export async function publish(site, token, payload) {
    const response = await fetch(`${site.replace(/\/+$/, "")}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({})));
    if (!response.ok) {
        throw new Error(body.error || `publish failed (${response.status})`);
    }
}
//# sourceMappingURL=client.js.map