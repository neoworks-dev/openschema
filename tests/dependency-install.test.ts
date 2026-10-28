// tests/dependency-install.test.ts
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDependency, installProject } from "../src/cli/dependencies";
import { loadLedger } from "../src/ledger/io";
import { loadProject, resolveModules } from "../src/resolver";
import { schemaIntegrity } from "../src/registry/integrity";

const REGISTRY = "https://api.example";

interface PublishedVersion {
  entry?: string;
  files: Record<string, string>;
  dependencies?: Record<string, string>;
}

const realFetch = globalThis.fetch;
let projectDirectory = "";

afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(projectDirectory, { recursive: true, force: true });
});

/** Serves `@scope/name` → version → files the way the registry's read routes do. */
function stubRegistry(packages: Record<string, Record<string, PublishedVersion>>): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const match = /^\/api\/v1\/schemas\/([^/]+)\/([^/]+)(?:\/versions\/([^/]+))?$/.exec(url.pathname);
    if (match === null) return new Response("{}", { status: 404 });
    const versions = packages[`@${match[1]}/${match[2]}`];
    if (versions === undefined) return new Response("{}", { status: 404 });
    if (match[3] === undefined) {
      return Response.json({
        schema: { title: match[2], description: `The ${match[2]} schema` },
        versions: Object.keys(versions).map(version => ({ version })),
      });
    }
    const published = versions[match[3]];
    if (published === undefined) return new Response("{}", { status: 404 });
    return Response.json(versionBody(published));
  }) as typeof fetch;
}

function versionBody(published: PublishedVersion) {
  return {
    entry: published.entry,
    files: Object.entries(published.files).map(([path, contents], ordinal) => ({ path, contents, ordinal })),
    dependencies: Object.entries(published.dependencies ?? {}).map(([packageName, requirement]) => {
      const [scope, name] = packageName.slice(1).split("/");
      return { scope, name, requirement };
    }),
  };
}

function shared(version: string): PublishedVersion {
  return { entry: "shared.schema", files: { "shared.schema": `namespace neoworks.shared\nmodel GeoPoint { 1 latitude: f64 } // ${version}` } };
}

const ROUTES: PublishedVersion = {
  entry: "routes.schema",
  files: { "routes.schema": 'namespace acme.routes\nimport { GeoPoint } from "@neoworks/shared"\nmodel Stop { 1 at: GeoPoint }' },
  dependencies: { "@neoworks/shared": "^1.0" },
};

function project(schema = 'namespace acme.trips\nimport { Stop } from "@acme/routes"\nmodel Trip { 1 first: Stop }'): string {
  projectDirectory = mkdtempSync(join(tmpdir(), "openschema-dependencies-"));
  writeFileSync(join(projectDirectory, "openschema.yaml"), [
    "# trips", "scope: acme", "name: trips", "version: 1.0.0", "title: Trips", "description: Trips and stops", "entry: trips.schema", "",
  ].join("\n"));
  writeFileSync(join(projectDirectory, "trips.schema"), schema);
  return projectDirectory;
}

function read(path: string): string {
  return readFileSync(join(projectDirectory, path), "utf8");
}

describe("openschema add", () => {
  it("requires the latest version, downloads the tree and pins it", async () => {
    stubRegistry({ "@acme/routes": { "1.0.0": ROUTES }, "@neoworks/shared": { "1.0.0": shared("1.0.0"), "1.3.0": shared("1.3.0") } });
    const added = await addDependency("@acme/routes", project(), REGISTRY, "test");

    expect(added.requirement).toBe("^1.0.0");
    expect(read("openschema.yaml")).toContain('# trips\n');
    expect(read("openschema.yaml")).toContain('dependencies:\n  "@acme/routes": ^1.0.0\n');
    expect(read(".openschema/dependencies/@neoworks/shared/openschema.yaml")).toContain("version: 1.3.0");

    const ledger = loadLedger(join(projectDirectory, "openschema.lock")).ledger!;
    expect(ledger.dependencies["@acme/routes"].version).toBe("1.0.0");
    expect(ledger.dependencies["@neoworks/shared"]).toEqual({
      version: "1.3.0", integrity: schemaIntegrity([{ path: "shared.schema", contents: shared("1.3.0").files["shared.schema"] }]),
    });
    expect(Object.keys(ledger.spaces).some(id => id.includes("acme.trips.Trip"))).toBe(true);

    const schema = resolveModules(loadProject(join(projectDirectory, "trips.schema"), path => existsSync(path) ? readFileSync(path, "utf8") : null));
    expect(schema.hasErrors).toBe(false);
  });

  it("changes nothing when no version meets the requirement", async () => {
    stubRegistry({ "@neoworks/shared": { "1.0.0": shared("1.0.0") } });
    project("namespace acme.trips\nmodel Trip { 1 name: string }");
    const manifestBefore = read("openschema.yaml");

    await expect(addDependency("@neoworks/shared@^2", projectDirectory, REGISTRY, "test")).rejects.toThrow("no version of @neoworks/shared");
    expect(read("openschema.yaml")).toBe(manifestBefore);
    expect(existsSync(join(projectDirectory, "openschema.lock"))).toBe(false);
  });

  it("refuses a version published before versions named their entry", async () => {
    stubRegistry({ "@neoworks/shared": { "1.0.0": { files: shared("1.0.0").files } } });
    project("namespace acme.trips\nmodel Trip { 1 name: string }");
    await expect(addDependency("@neoworks/shared", projectDirectory, REGISTRY, "test")).rejects.toThrow("entry file");
  });

  it("refuses a file name that would write outside the package's folder", async () => {
    stubRegistry({ "@neoworks/shared": { "1.0.0": { entry: "shared.schema", files: { "../escape.schema": "x", "shared.schema": "x" } } } });
    project("namespace acme.trips\nmodel Trip { 1 name: string }");
    await expect(addDependency("@neoworks/shared", projectDirectory, REGISTRY, "test")).rejects.toThrow("../escape.schema");
    expect(existsSync(join(projectDirectory, ".openschema/dependencies/escape.schema"))).toBe(false);
  });
});

describe("openschema install", () => {
  it("installs the locked versions on a fresh checkout, even when newer ones exist", async () => {
    stubRegistry({ "@acme/routes": { "1.0.0": ROUTES }, "@neoworks/shared": { "1.0.0": shared("1.0.0") } });
    await addDependency("@acme/routes", project(), REGISTRY, "test");
    rmSync(join(projectDirectory, ".openschema"), { recursive: true });

    stubRegistry({ "@acme/routes": { "1.0.0": ROUTES }, "@neoworks/shared": { "1.0.0": shared("1.0.0"), "1.5.0": shared("1.5.0") } });
    const pinned = await installProject(projectDirectory, REGISTRY, "test");
    expect(pinned["@neoworks/shared"].version).toBe("1.0.0");
    expect(read(".openschema/dependencies/@neoworks/shared/shared.schema")).toContain("1.0.0");
  });

  it("refuses a download that does not match the locked integrity", async () => {
    stubRegistry({ "@neoworks/shared": { "1.0.0": shared("1.0.0") } });
    await addDependency("@neoworks/shared", project("namespace acme.trips\nmodel Trip { 1 name: string }"), REGISTRY, "test");
    const lockBefore = read("openschema.lock");

    stubRegistry({ "@neoworks/shared": { "1.0.0": { entry: "shared.schema", files: { "shared.schema": "namespace changed" } } } });
    await expect(installProject(projectDirectory, REGISTRY, "test")).rejects.toThrow("does not match the integrity");
    expect(read("openschema.lock")).toBe(lockBefore);
  });

  it("removes a package the tree no longer needs", async () => {
    stubRegistry({ "@acme/routes": { "1.0.0": ROUTES }, "@neoworks/shared": { "1.0.0": shared("1.0.0") } });
    await addDependency("@acme/routes", project(), REGISTRY, "test");
    mkdirSync(join(projectDirectory, ".openschema/dependencies/@acme/old"), { recursive: true });

    await installProject(projectDirectory, REGISTRY, "test");
    expect(existsSync(join(projectDirectory, ".openschema/dependencies/@acme/old"))).toBe(false);
    expect(existsSync(join(projectDirectory, ".openschema/dependencies/@acme/routes"))).toBe(true);
  });
});
