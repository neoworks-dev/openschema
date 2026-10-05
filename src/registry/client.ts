// src/registry/client.ts
// Minimal read client for the OpenSchema public registry, served by the neoworks
// api under /api/v1/schemas. Reads need no token.

import { resolveEndpoints } from "./urls.js";

/** Default neoworks API base (production). Override via the base-domain env or --registry. */
export const DEFAULT_REGISTRY = "https://api.neoworks.dev";

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
export function resolveRegistry(explicit?: string): string {
  const base = explicit || resolveEndpoints().api;
  return base.replace(/\/+$/, "");
}

/**
 * Parse a schema reference like "@neoworks/commerce", "neoworks/commerce", or
 * "@neoworks/commerce@2.4.1". The leading "@" and an explicit version are
 * optional; the version defaults to "latest".
 */
export function parseSchemaRef(input: string): SchemaRef {
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

async function getJson<T>(url: string, notFoundMessage: string): Promise<T> {
  const response = await fetch(url);
  if (response.status === 404) {
    throw new Error(notFoundMessage);
  }
  if (!response.ok) {
    throw new Error(`registry request failed (${response.status} ${response.statusText})`);
  }
  return (await response.json()) as T;
}

/** Fetch a schema version's source files from the registry. */
export async function fetchSchema(registry: string, ref: SchemaRef): Promise<ResolvedSchema> {
  const schemaUrl = `${registry}/api/v1/schemas/${encodeURIComponent(ref.scope)}/${encodeURIComponent(ref.name)}`;
  let version = ref.version;
  if (version === "latest" || version === "") {
    const detail = await getJson<{ schema: { latestVersion: string } }>(
      schemaUrl,
      `schema @${ref.scope}/${ref.name} not found in the registry`,
    );
    version = detail.schema.latestVersion;
  }

  const versionRow = await getJson<{ files: RegistryFile[] }>(
    `${schemaUrl}/versions/${encodeURIComponent(version)}`,
    `version ${version} of @${ref.scope}/${ref.name} not found`,
  );
  const files = [...versionRow.files].sort((a, b) => a.ordinal - b.ordinal);

  return { scope: ref.scope, name: ref.name, version, files };
}

export interface PublishPayload {
  scope: string;
  name: string;
  version: string;
  description?: string;
  license?: string;
  repository?: string;
  readme?: string;
  targets?: string[];
  files: { path: string; contents: string }[];
}

/**
 * Submit a schema to the openschema site's /publish endpoint. The site (the org's
 * server) authenticates the bearer token and writes the org-owned registry rows.
 */
export async function publish(site: string, token: string, payload: PublishPayload): Promise<void> {
  const response = await fetch(`${site.replace(/\/+$/, "")}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error || `publish failed (${response.status})`);
  }
}
