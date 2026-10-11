// src/cli/init.ts
// `openschema init`: a starter openschema.yaml and schema for a new collection.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { MANIFEST_FILE, parseManifest } from "../registry/manifest.js";
const PLACEHOLDER_SCOPE = "your-handle";
const FALLBACK_NAME = "my-collection";
/** A registry name from free text: lowercase letters, digits, '.', '_' and '-'. */
function registryName(text) {
    const name = text.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 64);
    if (name === "") {
        return FALLBACK_NAME;
    }
    return name;
}
function titleOf(name) {
    const words = name.split(/[^a-z0-9]+/).filter(word => word !== "");
    return words.map(word => word[0].toUpperCase() + word.slice(1)).join(" ");
}
/** A schema namespace segment: identifiers cannot hold the '-' and '.' a registry name may. */
function namespaceSegment(text) {
    const segment = text.replace(/[^A-Za-z0-9_]/g, "_");
    if (/^[0-9]/.test(segment)) {
        return `_${segment}`;
    }
    return segment;
}
function manifestText(scope, name, title, description) {
    return [
        `scope: ${scope}`,
        `name: ${name}`,
        "version: 0.1.0",
        `title: ${JSON.stringify(title)}`,
        `description: ${JSON.stringify(description)}`,
        `entry: ${name}.schema`,
        "",
    ].join("\n");
}
function schemaText(scope, name) {
    return [
        `// ${name}.schema — the @${scope}/${name} collection.`,
        "// Generate the descriptor, the codec and the `collection` module for apps:",
        `//   openschema ${name}.schema --target descriptor,codec,collection --out generated`,
        "// Commit the generated files and openschema.lock, then `openschema publish`.",
        "",
        `namespace ${namespaceSegment(scope)}.${namespaceSegment(name)}`,
        "",
        "/// A folder of notes.",
        '@neoworks.node("container")',
        "model Folder {",
        "  @neoworks.title @minLength(1) @maxLength(200)",
        "  1 name: string",
        "}",
        "",
        '@neoworks.node("item")',
        "model Note {",
        "  @neoworks.searchable @neoworks.title @minLength(1) @maxLength(200)",
        "  1 title: string",
        "  2 body: string?",
        "  3 createdAt: timestamp",
        "}",
        "",
    ].join("\n");
}
function orDefault(value, fallback) {
    if (value === undefined || value === "") {
        return fallback;
    }
    return value;
}
/** The files `init` would write, as path and contents; the manifest is validated before anything is written. */
export function starterFiles(directory, options) {
    const scope = orDefault(options.scope, PLACEHOLDER_SCOPE);
    const name = orDefault(options.name, registryName(basename(resolve(directory))));
    const title = orDefault(options.title, titleOf(name));
    const description = orDefault(options.description, `The ${title} collection.`);
    const manifest = manifestText(scope, name, title, description);
    const parsed = parseManifest(manifest);
    if (parsed.manifest === null) {
        throw new Error(parsed.problems.join("\n"));
    }
    return [
        { path: join(directory, MANIFEST_FILE), contents: manifest },
        { path: join(directory, `${name}.schema`), contents: schemaText(scope, name) },
    ];
}
/** Writes the starter files and returns their paths; refuses to overwrite unless forced. */
export function initProject(directory, options) {
    const files = starterFiles(directory, options);
    const existing = files.filter(file => existsSync(file.path));
    if (existing.length > 0 && options.force !== true) {
        throw new Error(`${existing.map(file => file.path).join(", ")} already exists; pass --force to overwrite`);
    }
    mkdirSync(directory, { recursive: true });
    for (const file of files) {
        writeFileSync(file.path, file.contents, "utf8");
    }
    return files.map(file => file.path);
}
//# sourceMappingURL=init.js.map