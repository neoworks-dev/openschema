// src/registry/client.ts
// Minimal read client for the OpenSchema public registry, served by the neoworks
// api under /api/v1/schemas. Reads need no token.

import { resolveEndpoints, type Endpoints } from "./urls.js";

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
export function resolveRegistry(explicit?: string, endpoints: Endpoints = resolveEndpoints()): string {
  const base = explicit || endpoints.api;
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

/** Every published version of a schema, as the registry lists them. */
export async function listVersions(registry: string, scope: string, name: string): Promise<string[]> {
  const detail = await getJson<{ versions: { version: string }[] | null }>(
    `${registry}/api/v1/schemas/${encodeURIComponent(scope)}/${encodeURIComponent(name)}`,
    `schema @${scope}/${name} not found in the registry`,
  );
  if (detail.versions === null) return [];
  return detail.versions.map(entry => entry.version);
}

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
  files: { path: string; contents: string }[];
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
export class IncompatibleSchemaError extends Error {
  constructor(message: string, readonly violations: Violation[]) {
    super(message);
    this.name = "IncompatibleSchemaError";
  }
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
export class PublishRefusedError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | undefined) {
    super(message);
    this.name = "PublishRefusedError";
  }
}

/**
 * Why a publish was refused, in terms of what the user can do about it. Reasons
 * the api explains itself (an existing version, invalid input) keep its message.
 */
export function describePublishRefusal(
  payload: Pick<PublishPayload, "scope">,
  status: number,
  body: PublishResponseBody,
): string {
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
  if (status === 409 && body.error === "archived") {
    return `${scope} belongs to an archived organization; nobody can publish into it`;
  }
  if (body.message) {
    return body.message;
  }
  return `publish failed (${status})`;
}

/**
 * Submit a schema version to the registry. The api checks the token's
 * schemas:publish scope and the caller's schemas.publish permission for the
 * owner of the scope. A 409 that lists violations throws an
 * IncompatibleSchemaError; a 401, 403, 404 or other refusal throws a
 * PublishRefusedError that says what to do about it.
 */
export async function publish(registry: string, token: string, payload: PublishPayload): Promise<void> {
  const { scope, name, ...version } = payload;
  const versionsUrl = `${registry.replace(/\/+$/, "")}/api/v1/schemas/${encodeURIComponent(scope)}/${encodeURIComponent(name)}/versions`;
  const response = await fetch(versionsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(version),
  });
  const body = await readPublishResponse(response);
  if (response.ok) {
    return;
  }
  const message = describePublishRefusal(payload, response.status, body);
  if (response.status === 409 && Array.isArray(body.violations) && body.violations.length > 0) {
    throw new IncompatibleSchemaError(message, body.violations);
  }
  throw new PublishRefusedError(message, response.status, body.error);
}

/** The response body as an object; an empty, non-JSON or non-object body (such as `null`) reads as {}. */
async function readPublishResponse(response: Response): Promise<PublishResponseBody> {
  const parsed: unknown = await response.json().catch(() => null);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as PublishResponseBody;
}

/** The lines the CLI prints for a refused publish: one header, then each violation. */
export function describeViolations(payload: Pick<PublishPayload, "scope" | "name" | "version">, violations: Violation[]): string[] {
  const lines = [`@${payload.scope}/${payload.name}@${payload.version} is not compatible with the versions already published:`];
  for (const violation of violations) {
    lines.push(`  ${violation.rule}  ${violation.path}`);
    lines.push(`      ${violation.message}`);
  }
  return lines;
}
