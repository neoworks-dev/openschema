// tests/ledger-facets.test.ts
import { describe, it, expect } from "bun:test";
import { parse, resolve } from "../src/index";
import { collectSpaces } from "../src/ledger/spaces";
import { reconcileLedger } from "../src/ledger/merge";
import type { OrdinalLedger } from "../src/ledger/types";

const OPTIONS = {
  mode: "update" as const,
  required: false,
  staleSeverity: "error" as const,
  now: () => "2026-01-01T00:00:00.000Z",
  generator: "openschema test",
};

function run(body: string, current: OrdinalLedger | null) {
  const spaces = collectSpaces(resolve(parse(`namespace t\n${body}`)));
  return reconcileLedger(spaces, current, OPTIONS);
}

function codes(result: { diagnostics: { code: string }[] }): string[] {
  return result.diagnostics.map(diagnostic => diagnostic.code);
}

const V1 = `@neoworks.node("item") model Event {
  1 title: string
  @neoworks.facet("Availability") 2 start: timestamp
}`;

describe("facet ledger", () => {
  it("records the facet of a field and leaves default-facet fields without one", () => {
    const ordinals = run(V1, null).next.spaces["model:t.Event"].ordinals;
    expect(ordinals["1"].facet).toBeUndefined();
    expect(ordinals["2"].facet).toBe("Availability");
  });

  it("accepts an unchanged schema", () => {
    const baseline = run(V1, null).next;
    const result = run(V1, baseline);
    expect(codes(result)).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it("refuses renaming a facet", () => {
    const baseline = run(V1, null).next;
    expect(codes(run(V1.replace("Availability", "FreeBusy"), baseline))).toEqual(["OS2013"]);
  });

  it("refuses moving a field into or out of the default facet", () => {
    const baseline = run(V1, null).next;
    const intoNamed = V1.replace("1 title", '@neoworks.facet("Availability") 1 title');
    const intoDefault = V1.replace('@neoworks.facet("Availability") 2 start', "2 start");
    expect(codes(run(intoNamed, baseline))).toEqual(["OS2013"]);
    expect(codes(run(intoDefault, baseline))).toEqual(["OS2013"]);
  });

  it("still allows renaming the field itself", () => {
    const baseline = run(V1, null).next;
    expect(codes(run(V1.replace("2 start", "2 startsAt"), baseline))).toEqual([]);
  });
});
