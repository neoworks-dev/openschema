// tests/publish-dependencies.test.ts
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { preparePublish } from "../src/registry/preparePublish";
import { loadProject, resolveModules } from "../src/resolver";
import { collectSpaces } from "../src/ledger/spaces";
import { reconcileLedger } from "../src/ledger/merge";
import { serializeLedger } from "../src/ledger/io";

const INTEGRITY = `sha256-${"a".repeat(64)}`;
const SHARED_FOLDER = ".openschema/dependencies/@neoworks/shared";

let directory = "";
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function manifest(dependencies: string): string {
  return [
    "scope: acme", "name: places", "version: 1.0.0", "title: Places", "description: Places on a map",
    "entry: places.schema", dependencies,
  ].join("\n");
}

/** A project importing @neoworks/shared, with the dependency downloaded at `downloaded` and pinned at `pinned`. */
function project(options: { dependencies: string; downloaded: string; pinned: string | null }): string {
  directory = mkdtempSync(join(tmpdir(), "openschema-publish-dependencies-"));
  write("openschema.yaml", manifest(options.dependencies));
  write("places.schema", 'namespace acme.places\nimport { GeoPoint } from "@neoworks/shared"\nmodel Place { 1 at: GeoPoint }\n');
  write(`${SHARED_FOLDER}/openschema.yaml`, [
    "scope: neoworks", "name: shared", `version: ${options.downloaded}`, "title: Shared", "description: Shared types",
    "entry: shared.schema",
  ].join("\n"));
  write(`${SHARED_FOLDER}/shared.schema`, "namespace neoworks.shared\nmodel GeoPoint { 1 latitude: f64 }\n");

  const schema = resolveModules(loadProject(join(directory, "places.schema"), path => readFileSync(path, "utf8")));
  const ledger = reconcileLedger(collectSpaces(schema), null, {
    mode: "update", required: false, staleSeverity: "error", now: () => "2026-01-01T00:00:00.000Z", generator: "test", version: "1.0.0",
  }).next;
  if (options.pinned !== null) ledger.dependencies = { "@neoworks/shared": { version: options.pinned, integrity: INTEGRITY } };
  write("openschema.lock", serializeLedger(ledger));
  return directory;
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  writeFileSync(join(directory, path), contents);
}

const LISTED = 'dependencies:\n  "@neoworks/shared": ^1.2.0\n';

describe("preparePublish with dependencies", () => {
  it("publishes a project whose imports are listed and pinned as downloaded", () => {
    const prepared = preparePublish(project({ dependencies: LISTED, downloaded: "1.4.0", pinned: "1.4.0" }), "test");
    expect(prepared.problems).toEqual([]);
    expect(prepared.payload!.dependencies).toEqual([{ scope: "neoworks", name: "shared", requirement: "^1.2.0" }]);
    expect(prepared.payload!.files.map(file => file.path)).toEqual(["places.schema"]);
  });

  it("refuses an import that openschema.yaml does not list", () => {
    const prepared = preparePublish(project({ dependencies: "", downloaded: "1.4.0", pinned: "1.4.0" }), "test");
    expect(prepared.problems[0]).toContain("imports @neoworks/shared, which openschema.yaml does not list; run openschema add @neoworks/shared");
  });

  it("refuses a dependency the lock does not pin", () => {
    const prepared = preparePublish(project({ dependencies: LISTED, downloaded: "1.4.0", pinned: null }), "test");
    expect(prepared.problems).toEqual(["@neoworks/shared is not pinned in openschema.lock; run openschema install"]);
  });

  it("refuses a pin outside the requirement", () => {
    const prepared = preparePublish(project({ dependencies: LISTED, downloaded: "1.1.0", pinned: "1.1.0" }), "test");
    expect(prepared.problems).toEqual(["openschema.lock pins @neoworks/shared@1.1.0, outside ^1.2.0; run openschema install"]);
  });

  it("refuses a download that is not the pinned version", () => {
    const prepared = preparePublish(project({ dependencies: LISTED, downloaded: "1.3.0", pinned: "1.4.0" }), "test");
    expect(prepared.problems).toEqual(["the downloaded @neoworks/shared is not the 1.4.0 openschema.lock pins; run openschema install"]);
  });
});
