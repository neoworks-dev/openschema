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
const SEMANTIC_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;
const SCHEMA_FILE = /^[^/\\]+\.schema$/;
function text() {
    return z.string({ error: describeTypeError });
}
function describeTypeError(issue) {
    if (issue.input === undefined)
        return "is required";
    return "must be a string";
}
function filledText(maxCharacters) {
    return text()
        .refine(value => value.trim() !== "", "must not be empty")
        .refine(value => [...value].length <= maxCharacters, `must be at most ${maxCharacters} characters`);
}
const NAME_RULE = "must be lowercase letters, digits, '.', '_' or '-', starting with a letter or digit";
const manifestShape = z.strictObject({
    scope: text().regex(REGISTRY_NAME, NAME_RULE),
    name: text().regex(REGISTRY_NAME, NAME_RULE),
    version: text().regex(SEMANTIC_VERSION, "must be a semantic version such as 1.0.0"),
    title: filledText(MAX_TITLE),
    description: filledText(MAX_DESCRIPTION),
    entry: text().regex(SCHEMA_FILE, "must name a .schema file in the manifest's directory"),
    license: filledText(MAX_TITLE).optional(),
    repository: z.url({ protocol: /^https?$/, error: "must be an http(s) URL" }).optional(),
}, { error: describeObjectError });
function describeObjectError(issue) {
    if (issue.code === "invalid_type")
        return "must be a mapping of manifest fields";
    return undefined;
}
export function parseManifest(text) {
    let document;
    try {
        document = parseYaml(text);
    }
    catch (error) {
        return { manifest: null, problems: [`${MANIFEST_FILE} is not valid YAML: ${error.message}`] };
    }
    const parsed = manifestShape.safeParse(document);
    if (parsed.success)
        return { manifest: parsed.data, problems: [] };
    return { manifest: null, problems: parsed.error.issues.map(describeIssue) };
}
function describeIssue(issue) {
    const field = issue.path.join(".");
    if (field === "")
        return `${MANIFEST_FILE}: ${issue.message}`;
    return `${MANIFEST_FILE}: ${field} ${issue.message}`;
}
//# sourceMappingURL=manifest.js.map