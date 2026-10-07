// tests/registry-manifest.test.ts
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "../src/registry/manifest";
import { preparePublish } from "../src/registry/preparePublish";
import { parse, resolve } from "../src/index";
import { collectSpaces } from "../src/ledger/spaces";
import { reconcileLedger } from "../src/ledger/merge";
import { serializeLedger } from "../src/ledger/io";

const MANIFEST = `scope: acme
name: recipes
version: 1.0.0
title: Recipes
description: Recipes and the folders they are kept in.
entry: recipes.schema
license: MIT
repository: https://example.com/recipes
`;

const SCHEMA = `namespace acme.recipes

@neoworks.node("item")
model Recipe {
  1 title: string
  @neoworks.facet("Ingredients") 2 ingredients: [string]
}
`;

describe("parseManifest", () => {
  it("accepts a complete manifest", () => {
    const parsed = parseManifest(MANIFEST);
    expect(parsed.problems).toEqual([]);
    expect(parsed.manifest?.title).toBe("Recipes");
  });

  it("requires a title and a description", () => {
    const parsed = parseManifest(MANIFEST.replace(/title: .*\n/, "").replace(/description: .*\n/, ""));
    expect(parsed.problems).toEqual([
      "openschema.yaml: title is required",
      "openschema.yaml: description is required",
    ]);
  });

  it("rejects blank text, bad versions and unknown keys", () => {
    const problems = parseManifest(MANIFEST
      .replace("title: Recipes", "title: '   '")
      .replace("version: 1.0.0", "version: '1.0'")
      .concat("tagz: [food]\n")).problems.join("\n");
    expect(problems).toContain("title must not be empty");
    expect(problems).toContain("version must be a semantic version");
    expect(problems).toContain("tagz");
  });

  it("rejects names the registry would refuse and entries outside the directory", () => {
    const problems = parseManifest(MANIFEST
      .replace("scope: acme", "scope: Acme")
      .replace("entry: recipes.schema", "entry: ../recipes.schema")).problems.join("\n");
    expect(problems).toContain("scope must be lowercase");
    expect(problems).toContain("entry must name a .schema file");
  });

  it("reports YAML that does not parse", () => {
    expect(parseManifest("title: [unclosed").problems[0]).toContain("not valid YAML");
  });
});

describe("preparePublish", () => {
  let directory = "";

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  function project(files: Record<string, string>, withLedger = true): string {
    directory = mkdtempSync(join(tmpdir(), "openschema-publish-"));
    for (const [path, contents] of Object.entries(files)) writeFileSync(join(directory, path), contents);
    if (withLedger) writeFileSync(join(directory, "openschema.lock"), ledgerFor(files["recipes.schema"]));
    return directory;
  }

  function ledgerFor(schema: string): string {
    const result = reconcileLedger(collectSpaces(resolve(parse(schema))), null, {
      mode: "update", required: false, staleSeverity: "error", now: () => "2026-01-01T00:00:00.000Z", generator: "test",
    });
    return serializeLedger(result.next);
  }

  it("builds the payload from the manifest, with the descriptor for a node schema", () => {
    const prepared = preparePublish(project({ "openschema.yaml": MANIFEST, "recipes.schema": SCHEMA }), "test");
    expect(prepared.problems).toEqual([]);
    expect(prepared.payload).toMatchObject({
      scope: "acme", name: "recipes", version: "1.0.0", title: "Recipes",
      license: "MIT", files: [{ path: "recipes.schema", contents: SCHEMA }],
    });
    expect(JSON.parse(prepared.payload!.descriptor!).nodes[0].model).toBe("Recipe");
  });

  it("sends no descriptor for a schema without nodes", () => {
    const plain = "namespace acme.recipes\nmodel Recipe { 1 title: string }\n";
    const prepared = preparePublish(project({ "openschema.yaml": MANIFEST, "recipes.schema": plain }), "test");
    expect(prepared.problems).toEqual([]);
    expect(prepared.payload!.descriptor).toBeUndefined();
  });

  it("refuses without a manifest", () => {
    const prepared = preparePublish(project({ "recipes.schema": SCHEMA }), "test");
    expect(prepared.problems[0]).toContain("no openschema.yaml");
  });

  it("refuses a missing entry file", () => {
    const manifest = MANIFEST.replace("entry: recipes.schema", "entry: missing.schema");
    const prepared = preparePublish(project({ "openschema.yaml": manifest, "recipes.schema": SCHEMA }), "test");
    expect(prepared.problems).toEqual(["openschema.yaml: entry missing.schema does not exist"]);
  });

  it("refuses without an ordinal ledger, and with a stale one", () => {
    const missing = preparePublish(project({ "openschema.yaml": MANIFEST, "recipes.schema": SCHEMA }, false), "test");
    expect(missing.problems.join("\n")).toContain("OS2011");
    rmSync(directory, { recursive: true, force: true });

    project({ "openschema.yaml": MANIFEST, "recipes.schema": SCHEMA });
    writeFileSync(join(directory, "recipes.schema"), SCHEMA.replace("[string]", "[string]\n  3 minutes: i32"));
    expect(preparePublish(directory, "test").problems.join("\n")).toContain("OS2008");
  });

  it("refuses a schema whose descriptor cannot be built", () => {
    const broken = SCHEMA.replace('@neoworks.facet("Ingredients")', '@neoworks.facet("default")');
    const prepared = preparePublish(project({ "openschema.yaml": MANIFEST, "recipes.schema": broken }), "test");
    expect(prepared.problems.join("\n")).toContain("OSD005");
  });
});
