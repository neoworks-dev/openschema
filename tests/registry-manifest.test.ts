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
import type { OrdinalLedger } from "../src/ledger/types";

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

@neoworks.table
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

  it("rejects pre-release and build suffixes and parts wider than 32 bits", () => {
    for (const version of ["1.0.0-beta.2", "1.0.0+build.5", "4294967296.0.0"]) {
      const problems = parseManifest(MANIFEST.replace("version: 1.0.0", `version: ${version}`)).problems.join("\n");
      expect(problems).toContain("version must");
    }
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

  it("accepts dependencies with version ranges", () => {
    const parsed = parseManifest(`${MANIFEST}dependencies:\n  "@neoworks/shared": ^1.2.0\n  "@acme/units": "0.3"\n`);
    expect(parsed.problems).toEqual([]);
    expect(parsed.manifest?.dependencies).toEqual({ "@neoworks/shared": "^1.2.0", "@acme/units": "0.3" });
  });

  it("rejects dependency names, ranges and unquoted numbers it cannot read", () => {
    const problems = parseManifest(
      `${MANIFEST}dependencies:\n  shared: ^1.0.0\n  "@acme/units": ^1.x\n  "@acme/money": 1.2\n`,
    ).problems.join("\n");
    expect(problems).toContain("must be a schema name such as @scope/name");
    expect(problems).toContain("@acme/units must be a version range");
    expect(problems).toContain("@acme/money must be a quoted version range");
  });

  it("rejects a schema that depends on itself", () => {
    const problems = parseManifest(`${MANIFEST}dependencies:\n  "@acme/recipes": ^1.0.0\n`).problems;
    expect(problems).toEqual(["openschema.yaml: dependencies must not list the schema itself"]);
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

  function ledgerFor(schema: string, current: OrdinalLedger | null = null, version = "1.0.0"): string {
    const result = reconcileLedger(collectSpaces(resolve(parse(schema))), current, {
      mode: "update", required: false, staleSeverity: "error", now: () => "2026-01-01T00:00:00.000Z", generator: "test", version,
    });
    return serializeLedger(result.next);
  }

  it("builds the payload from the manifest, with the descriptor for a schema with tables", () => {
    const prepared = preparePublish(project({ "openschema.yaml": MANIFEST, "recipes.schema": SCHEMA }), "test");
    expect(prepared.problems).toEqual([]);
    expect(prepared.payload).toMatchObject({
      scope: "acme", name: "recipes", version: "1.0.0", title: "Recipes",
      license: "MIT", entry: "recipes.schema", files: [{ path: "recipes.schema", contents: SCHEMA }], dependencies: [],
    });
    expect(JSON.parse(prepared.payload!.descriptor!).tables[0].model).toBe("Recipe");
  });

  it("sends no descriptor for a schema without tables", () => {
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

  describe("a retired field number", () => {
    const WITHOUT_TITLE = SCHEMA.replace("  1 title: string\n", "");
    const REUSED = SCHEMA.replace("1 title: string", "1 minutes: i32");

    function ledgerAfter(schema: string, previous: OrdinalLedger | null, version: string): OrdinalLedger {
      return reconcileLedger(collectSpaces(resolve(parse(schema))), previous, {
        mode: "update", required: false, staleSeverity: "error", now: () => "2026-01-01T00:00:00.000Z", generator: "test", version,
      }).next;
    }

    function publishReusing(version: string): string[] {
      const retired = ledgerAfter(WITHOUT_TITLE, ledgerAfter(SCHEMA, null, "1.0.0"), "1.1.0");
      const lock = ledgerAfter(REUSED, retired, version);
      const manifest = MANIFEST.replace("version: 1.0.0", `version: ${version}`);
      project({ "openschema.yaml": manifest, "recipes.schema": REUSED }, false);
      writeFileSync(join(directory, "openschema.lock"), serializeLedger(lock));
      return preparePublish(directory, "test").problems;
    }

    it("cannot be reused within its major", () => {
      expect(publishReusing("1.2.0").join("\n")).toContain("OS2007");
    });

    it("can be reused in the next major", () => {
      expect(publishReusing("2.0.0")).toEqual([]);
    });
  });

  it("refuses a schema whose descriptor cannot be built", () => {
    const broken = SCHEMA.replace('@neoworks.facet("Ingredients")', '@neoworks.facet("default")');
    const prepared = preparePublish(project({ "openschema.yaml": MANIFEST, "recipes.schema": broken }), "test");
    expect(prepared.problems.join("\n")).toContain("OSD005");
  });
});
