// tests/resolver-packages.test.ts
import { describe, it, expect } from "bun:test";
import { loadProject, resolveModules } from "../src/resolver";
import type { ReadFileOrNull } from "../src/resolver/moduleGraph";
import { buildDescriptor } from "../src/emit/descriptor/descriptorEmitter";

const DEPENDENCIES = "/project/.openschema/dependencies";

function manifest(scope: string, name: string, entry: string): string {
  return [
    `scope: ${scope}`,
    `name: ${name}`,
    "version: 1.0.0",
    `title: ${name}`,
    `description: The ${name} schema`,
    `entry: ${entry}`,
  ].join("\n");
}

function reader(files: Record<string, string>): ReadFileOrNull {
  return path => {
    if (path in files) return files[path];
    return null;
  };
}

const SHARED_FILES = {
  [`${DEPENDENCIES}/@neoworks/shared/openschema.yaml`]: manifest("neoworks", "shared", "shared.schema"),
  [`${DEPENDENCIES}/@neoworks/shared/shared.schema`]:
    "namespace neoworks.shared\nmodel GeoPoint { 1 latitude: f64  2 longitude: f64 }\nmodel Address { 1 street: string }",
};

describe("package imports", () => {
  it("resolves @scope/name to the downloaded schema's entry", () => {
    const files = {
      "/project/openschema.yaml": manifest("acme", "places", "places.schema"),
      "/project/places.schema":
        'namespace acme.places\nimport { GeoPoint } from "@neoworks/shared"\nmodel Place { 1 location: GeoPoint }',
      ...SHARED_FILES,
    };
    const schema = resolveModules(loadProject("/project/places.schema", reader(files)));
    expect(schema.hasErrors).toBe(false);
    expect(schema.records.has("neoworks.shared.GeoPoint")).toBe(true);
  });

  it("keeps the dependency's names in its own namespace", () => {
    const files = {
      "/project/openschema.yaml": manifest("acme", "places", "places.schema"),
      "/project/places.schema":
        'namespace acme.places\nimport { GeoPoint } from "@neoworks/shared"\nmodel Address { 1 at: GeoPoint }',
      ...SHARED_FILES,
    };
    const schema = resolveModules(loadProject("/project/places.schema", reader(files)));
    expect(schema.hasErrors).toBe(false);
    expect(schema.records.has("acme.places.Address")).toBe(true);
    expect(schema.records.has("neoworks.shared.Address")).toBe(true);
  });

  it("resolves a dependency's own package imports from the same folder", () => {
    const files = {
      "/project/openschema.yaml": manifest("acme", "trips", "trips.schema"),
      "/project/trips.schema":
        'namespace acme.trips\nimport { Stop } from "@neoworks/routes"\nmodel Trip { 1 first: Stop }',
      [`${DEPENDENCIES}/@neoworks/routes/openschema.yaml`]: manifest("neoworks", "routes", "routes.schema"),
      [`${DEPENDENCIES}/@neoworks/routes/routes.schema`]:
        'namespace neoworks.routes\nimport { GeoPoint } from "@neoworks/shared"\nmodel Stop { 1 at: GeoPoint }',
      ...SHARED_FILES,
    };
    const schema = resolveModules(loadProject("/project/trips.schema", reader(files)));
    expect(schema.hasErrors).toBe(false);
    expect(schema.records.has("neoworks.routes.Stop")).toBe(true);
  });

  it("says a package that is not downloaded is missing from the dependencies folder", () => {
    const files = {
      "/project/openschema.yaml": manifest("acme", "places", "places.schema"),
      "/project/places.schema":
        'namespace acme.places\nimport { GeoPoint } from "@neoworks/shared"\nmodel Place { 1 location: GeoPoint }',
    };
    const schema = resolveModules(loadProject("/project/places.schema", reader(files)));
    const unresolved = schema.diagnostics.find(diagnostic => diagnostic.code === "OS1008");
    expect(unresolved?.message).toContain(".openschema/dependencies");
  });

  // The registry's compatibility check compares descriptors, so this is what
  // catches a dependency's new major changing a collection's rows.
  it("puts the models a table uses from a dependency into the descriptor", () => {
    const files = {
      "/project/openschema.yaml": manifest("acme", "places", "places.schema"),
      "/project/places.schema":
        'namespace acme.places\nimport { GeoPoint } from "@neoworks/shared"\n@neoworks.table\nmodel Place { 1 location: GeoPoint }',
      [`${DEPENDENCIES}/@neoworks/shared/openschema.yaml`]: manifest("neoworks", "shared", "shared.schema"),
      [`${DEPENDENCIES}/@neoworks/shared/shared.schema`]:
        "namespace neoworks.shared\nmodel GeoPoint { 1 latitude: f64  2 longitude: f64 }",
    };
    const schema = resolveModules(loadProject("/project/places.schema", reader(files)));
    const descriptor = buildDescriptor({ schema, company: null, includePrivate: false, options: {} });
    const geoPoint = descriptor.models.find(model => model.name === "GeoPoint");
    expect(geoPoint?.fields.map(field => field.name)).toEqual(["latitude", "longitude"]);
  });

  it("leaves package imports unresolved outside a project with a manifest", () => {
    const files = {
      "/loose/places.schema":
        'namespace acme.places\nimport { GeoPoint } from "@neoworks/shared"\nmodel Place { 1 location: GeoPoint }',
    };
    const schema = resolveModules(loadProject("/loose/places.schema", reader(files)));
    expect(schema.diagnostics.map(diagnostic => diagnostic.code)).toContain("OS1008");
  });
});
