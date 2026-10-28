// tests/dependency-selection.test.ts
import { describe, it, expect } from "bun:test";
import { DependencyConflictError, selectVersions, type DependencySource } from "../src/registry/dependencySelection";

/** A registry of `@scope/name` → version → the requirements that version lists. */
function registry(packages: Record<string, Record<string, Record<string, string>>>): DependencySource {
  return {
    versions: async packageName => Object.keys(packages[packageName] ?? {}),
    dependenciesOf: async (packageName, version) => packages[packageName][version],
  };
}

const SHARED = { "1.0.0": {}, "1.4.0": {}, "2.0.0": {}, "2.1.0-beta.1": {} };

describe("selectVersions", () => {
  it("picks the highest version a requirement allows, leaving out pre-releases", async () => {
    expect(await selectVersions({ "@neoworks/shared": "^1.0" }, registry({ "@neoworks/shared": SHARED })))
      .toEqual({ "@neoworks/shared": "1.4.0" });
    expect(await selectVersions({ "@neoworks/shared": "*" }, registry({ "@neoworks/shared": SHARED })))
      .toEqual({ "@neoworks/shared": "2.0.0" });
  });

  it("follows the dependencies of the versions it picks", async () => {
    const source = registry({
      "@acme/routes": { "1.0.0": { "@neoworks/shared": "^1.0" } },
      "@neoworks/shared": SHARED,
    });
    expect(await selectVersions({ "@acme/routes": "^1" }, source))
      .toEqual({ "@acme/routes": "1.0.0", "@neoworks/shared": "1.4.0" });
  });

  it("settles on one version that every requirement on a package allows", async () => {
    const source = registry({
      "@acme/routes": { "1.0.0": { "@neoworks/shared": ">=1.0, <1.3" } },
      "@neoworks/shared": { "1.0.0": {}, "1.2.0": {}, "1.4.0": {} },
    });
    expect(await selectVersions({ "@acme/routes": "^1", "@neoworks/shared": "^1" }, source))
      .toEqual({ "@acme/routes": "1.0.0", "@neoworks/shared": "1.2.0" });
  });

  it("keeps a locked version while it still fits, and moves off it when it does not", async () => {
    const source = registry({ "@neoworks/shared": SHARED });
    expect(await selectVersions({ "@neoworks/shared": "^1" }, source, { "@neoworks/shared": "1.0.0" }))
      .toEqual({ "@neoworks/shared": "1.0.0" });
    expect(await selectVersions({ "@neoworks/shared": "^2" }, source, { "@neoworks/shared": "1.0.0" }))
      .toEqual({ "@neoworks/shared": "2.0.0" });
  });

  it("drops what an earlier pick required once that pick changes", async () => {
    const source = registry({
      "@acme/routes": { "1.0.0": { "@acme/legacy": "^1" }, "1.1.0": {} },
      "@acme/legacy": { "1.0.0": {} },
    });
    expect(await selectVersions({ "@acme/routes": "^1" }, source, { "@acme/routes": "1.0.0" }))
      .toEqual({ "@acme/routes": "1.0.0", "@acme/legacy": "1.0.0" });
    expect(await selectVersions({ "@acme/routes": "^1.1" }, source, { "@acme/routes": "1.0.0" }))
      .toEqual({ "@acme/routes": "1.1.0" });
  });

  it("names every requirement when no version meets them all", async () => {
    const source = registry({
      "@acme/routes": { "1.0.0": { "@neoworks/shared": "^2" } },
      "@neoworks/shared": SHARED,
    });
    const selection = selectVersions({ "@acme/routes": "^1", "@neoworks/shared": "^1" }, source);
    await expect(selection).rejects.toThrow(DependencyConflictError);
    await expect(selection).rejects.toThrow("no version of @neoworks/shared meets ^1 from the project and ^2 from @acme/routes@1.0.0");
  });

  it("reports a package the registry has no version of as a conflict", async () => {
    await expect(selectVersions({ "@acme/ghost": "^1" }, registry({}))).rejects.toThrow("no version of @acme/ghost");
  });
});
