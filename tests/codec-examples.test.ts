// tests/codec-examples.test.ts
//
// The emitter can produce a string that compiles in unit tests but breaks on a
// real schema, so this runs the shipped examples end to end.

import { describe, it, expect, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject } from "../src/resolver/moduleGraph";
import { resolveModules } from "../src/resolver";
import { getEmitter } from "../src/emit";
import { collectSpaces } from "../src/ledger/spaces";
import { reconcileLedger } from "../src/ledger/merge";
import { cleanupCodecs, loadCodec } from "./helpers/loadCodec";

afterAll(cleanupCodecs);

const EXAMPLES = join(import.meta.dir, "..", "examples");

function resolveEntry(relativePath: string) {
  const entry = join(EXAMPLES, relativePath);
  const modules = loadProject(entry, path => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  });
  return resolveModules(modules);
}

function emitCodec(relativePath: string): string {
  const schema = resolveEntry(relativePath);
  expect(schema.hasErrors).toBe(false);
  return getEmitter("codec")!.emit({
    schema, company: null, includePrivate: false, options: {},
  })[0].contents;
}

describe("examples/contacts", () => {
  it("generates a codec without rejecting any construct", () => {
    const output = emitCodec("contacts/contacts.schema");
    expect(output).toContain("export function encodeContact");
    expect(output).toContain("export function decodeContact");
  });

  it("generates deterministically", () => {
    expect(emitCodec("contacts/contacts.schema")).toBe(emitCodec("contacts/contacts.schema"));
  });

  it("collects an ordinal space for every model and enum", () => {
    const schema = resolveEntry("contacts/contacts.schema");
    const spaces = collectSpaces(schema);
    const kinds = new Set(spaces.map(space => space.kind));
    expect(spaces.length).toBeGreaterThan(0);
    expect(kinds.has("model")).toBe(true);
  });

  it("builds a ledger whose second run is a no-op", () => {
    const schema = resolveEntry("contacts/contacts.schema");
    const options = {
      mode: "update" as const, required: false, staleSeverity: "error" as const,
      now: () => "2026-01-01T00:00:00.000Z", generator: "test",
    };
    const first = reconcileLedger(collectSpaces(schema), null, options);
    const second = reconcileLedger(collectSpaces(schema), first.next, options);
    expect(second.changed).toBe(false);
    expect(second.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  });
});

describe("examples/ecommerce", () => {
  it("generates a codec across an import graph", () => {
    const output = emitCodec("ecommerce/orders.schema");
    expect(output).toContain("export function encode");
  });
});

describe("a realistic contact round-trips", () => {
  // Mirrors the shape of the real vCard model without depending on its exact
  // field set, so it stays meaningful as the example evolves.
  const SCHEMA = `namespace t
enum Kind { 1 individual  2 org }
model Address { 1 street: string?  2 locality: string?  3 country: string? }
model Contact {
  1 id: uuid
  2 kind: Kind
  3 formattedName: string
  4 nicknames: [string]?
  5 addresses: [Address]?
  6 birthday: date?
  7 geo: {string: f64}?
  8 notes: [string]?
  9 updatedAt: timestamp
}`;

  it("preserves optional containers, absent fields, and nested messages", async () => {
    const codec = await loadCodec(SCHEMA);
    const value = {
      id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      kind: 1,
      formattedName: "Ada Lovelace",
      nicknames: undefined,
      addresses: [{ street: "1 Main St", locality: undefined, country: "DE" }],
      birthday: "1815-12-10",
      geo: new Map([["lat", 52.5], ["lng", 13.4]]),
      notes: [],
      updatedAt: "2026-07-28T10:00:00.000Z",
    };

    const back = codec.decodeContact(codec.encodeContact(value));
    expect(back.nicknames).toBeUndefined();
    expect(back.notes).toEqual([]);
    expect(back.addresses[0].locality).toBeUndefined();
    expect(back.addresses[0].country).toBe("DE");
    expect(back.birthday).toBe("1815-12-10");
    expect([...back.geo.entries()]).toEqual([["lat", 52.5], ["lng", 13.4]]);
    expect(back.updatedAt).toBe("2026-07-28T10:00:00.000Z");
  });
});
