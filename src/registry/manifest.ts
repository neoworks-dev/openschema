// src/registry/manifest.ts
// openschema.yaml: a published schema's identity and metadata. Publishing reads
// nothing else, and refuses a manifest with any problem rather than guessing.

import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const MANIFEST_FILE = "openschema.yaml";

const MAX_TITLE = 80;
const MAX_DESCRIPTION = 500;

// The registry's own rules for scope and name.
const REGISTRY_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// Rows record the version that wrote them as three numbers, so there is no
// pre-release or build suffix.
const SEMANTIC_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_VERSION_PART = 4294967295;
const SCHEMA_FILE = /^[^/\\]+\.schema$/;

function text() {
  return z.string({ error: describeTypeError });
}

function partsFitThirtyTwoBits(version: string): boolean {
  return version.split(".").every(part => Number(part) <= MAX_VERSION_PART);
}

function describeTypeError(issue: { input?: unknown }): string {
  if (issue.input === undefined) return "is required";
  return "must be a string";
}

function filledText(maxCharacters: number) {
  return text()
    .refine(value => value.trim() !== "", "must not be empty")
    .refine(value => [...value].length <= maxCharacters, `must be at most ${maxCharacters} characters`);
}

const NAME_RULE = "must be lowercase letters, digits, '.', '_' or '-', starting with a letter or digit";

const manifestShape = z.strictObject({
  scope:       text().regex(REGISTRY_NAME, NAME_RULE),
  name:        text().regex(REGISTRY_NAME, NAME_RULE),
  version:     text()
    .regex(SEMANTIC_VERSION, "must be a semantic version such as 1.0.0, without a suffix")
    .refine(partsFitThirtyTwoBits, `must have parts of at most ${MAX_VERSION_PART}`),
  title:       filledText(MAX_TITLE),
  description: filledText(MAX_DESCRIPTION),
  entry:       text().regex(SCHEMA_FILE, "must name a .schema file in the manifest's directory"),
  license:     filledText(MAX_TITLE).optional(),
  repository:  z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }).optional(),
}, { error: describeObjectError });

function describeObjectError(issue: { code: string }): string | undefined {
  if (issue.code === "invalid_type") return "must be a mapping of manifest fields";
  return undefined;
}

export type Manifest = z.infer<typeof manifestShape>;

export type ManifestResult =
  | { manifest: Manifest; problems: [] }
  | { manifest: null; problems: string[] };

export function parseManifest(text: string): ManifestResult {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (error) {
    return { manifest: null, problems: [`${MANIFEST_FILE} is not valid YAML: ${(error as Error).message}`] };
  }
  const parsed = manifestShape.safeParse(document);
  if (parsed.success) return { manifest: parsed.data, problems: [] };
  return { manifest: null, problems: parsed.error.issues.map(describeIssue) };
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const field = issue.path.join(".");
  if (field === "") return `${MANIFEST_FILE}: ${issue.message}`;
  return `${MANIFEST_FILE}: ${field} ${issue.message}`;
}
