import { describe, it, expect } from "bun:test";
import { parse, resolve } from "../src/index";
import { collectSpaces } from "../src/ledger/spaces";
import { reconcileLedger } from "../src/ledger/merge";
import { majorOf, majorPrecedes, nextMajorVersion } from "../src/ledger/major";
import type { OrdinalLedger } from "../src/ledger/types";

function run(src: string, current: OrdinalLedger | null, version: string | null) {
  return reconcileLedger(collectSpaces(resolve(parse(src))), current, {
    mode: "update",
    required: false,
    staleSeverity: "error",
    now: () => "2026-01-01T00:00:00.000Z",
    generator: "openschema test",
    version,
  });
}

function codes(result: { diagnostics: { code: string }[] }): string[] {
  return result.diagnostics.map(diagnostic => diagnostic.code);
}

const WITH_LABEL = "namespace t\nmodel M { 1 id: uuid  2 label: string }";
const WITHOUT_LABEL = "namespace t\nmodel M { 1 id: uuid }";
const REUSED_LABEL = "namespace t\nmodel M { 1 id: uuid  2 label: i32 }";
const MODEL = "model:t.M";

describe("the major of a version", () => {
  it("is the leftmost non-zero component", () => {
    expect(majorOf("2.3.4")).toBe("2");
    expect(majorOf("0.3.4")).toBe("0.3");
    expect(majorOf("0.0.4")).toBe("0.0.4");
    expect(majorOf("1.0.0-beta.1")).toBeNull();
  });

  it("orders majors numerically", () => {
    expect(majorPrecedes("0.3", "0.10")).toBe(true);
    expect(majorPrecedes("0.10", "1")).toBe(true);
    expect(majorPrecedes("0.0.4", "0.1")).toBe(true);
    expect(majorPrecedes("2", "2")).toBe(false);
    expect(majorPrecedes("2", "1")).toBe(false);
  });

  it("names the lowest version of the next major", () => {
    expect(nextMajorVersion("2.3.4")).toBe("3.0.0");
    expect(nextMajorVersion("0.3.4")).toBe("0.4.0");
    expect(nextMajorVersion("0.0.4")).toBe("0.0.5");
  });
});

describe("a retired ordinal", () => {
  function retiredIn(version: string): OrdinalLedger {
    const base = run(WITH_LABEL, null, "1.0.0").next;
    return run(WITHOUT_LABEL, base, version).next;
  }

  it("records the major it was retired in", () => {
    expect(retiredIn("1.2.0").spaces[MODEL].ordinals["2"].major).toBe("1");
  });

  it("stays spent within the same major", () => {
    const result = run(REUSED_LABEL, retiredIn("1.2.0"), "1.3.0");
    expect(codes(result)).toEqual(["OS2007"]);
    expect(result.diagnostics[0].message).toContain("A release from 2.0.0 on frees it");
  });

  it("is free again from the next major on", () => {
    const result = run(REUSED_LABEL, retiredIn("1.2.0"), "2.0.0");
    expect(codes(result)).toEqual([]);
    const entry = result.next.spaces[MODEL].ordinals["2"];
    expect(entry).toMatchObject({ state: "active", type: "i32", major: "2" });
    expect(entry.retiredAt).toBeUndefined();
  });

  it("is spent again in the major that reused and retired it", () => {
    const reused = run(REUSED_LABEL, retiredIn("1.2.0"), "2.0.0").next;
    const retired = run(WITHOUT_LABEL, reused, "2.1.0").next;
    expect(codes(run(WITH_LABEL, retired, "2.2.0"))).toEqual(["OS2007"]);
    expect(codes(run(WITH_LABEL, retired, "3.0.0"))).toEqual([]);
  });

  it("is free from the next minor below 1.0.0", () => {
    const base = run(WITH_LABEL, null, "0.4.0").next;
    const retired = run(WITHOUT_LABEL, base, "0.4.1").next;
    expect(codes(run(REUSED_LABEL, retired, "0.4.2"))).toEqual(["OS2007"]);
    expect(codes(run(REUSED_LABEL, retired, "0.5.0"))).toEqual([]);
  });

  it("is free after every patch of 0.0.z", () => {
    const base = run(WITH_LABEL, null, "0.0.1").next;
    const retired = run(WITHOUT_LABEL, base, "0.0.2").next;
    expect(codes(run(REUSED_LABEL, retired, "0.0.2"))).toEqual(["OS2007"]);
    expect(codes(run(REUSED_LABEL, retired, "0.0.3"))).toEqual([]);
  });

  it("is never free for a lower version", () => {
    expect(codes(run(REUSED_LABEL, retiredIn("2.0.0"), "1.5.0"))).toEqual(["OS2007"]);
  });

  it("is never free without a version", () => {
    expect(codes(run(REUSED_LABEL, retiredIn("1.2.0"), null))).toEqual(["OS2007"]);
  });

  it("stays spent when it was retired without a version", () => {
    const base = run(WITH_LABEL, null, null).next;
    const retired = run(WITHOUT_LABEL, base, null).next;
    expect(retired.spaces[MODEL].ordinals["2"].major).toBeUndefined();
    expect(codes(run(REUSED_LABEL, retired, "5.0.0"))).toEqual(["OS2007"]);
  });

  it("stays spent when a source reservation holds it", () => {
    const base = run("namespace t\nmodel M { 1 id: uuid  reserved 5; }", null, "1.0.0").next;
    expect(codes(run("namespace t\nmodel M { 1 id: uuid  5 x: i32 }", base, "2.0.0"))).toEqual(["OS2007"]);
  });

  it("is free in a derived record when the base freed it", () => {
    const withBoth = "namespace t\nmodel B { 1 a: uuid  2 b: string }\nmodel D extends B { 3 c: i32 }";
    const baseDropped = "namespace t\nmodel B { 1 a: uuid }\nmodel D extends B { 3 c: i32 }";
    const reclaimed = "namespace t\nmodel B { 1 a: uuid }\nmodel D extends B { 2 c: i32  3 d: i32 }";
    const retired = run(baseDropped, run(withBoth, null, "1.0.0").next, "1.1.0").next;
    expect(codes(run(reclaimed, retired, "1.2.0"))).toEqual(["OS2007"]);
    expect(codes(run(reclaimed, retired, "2.0.0"))).toEqual([]);
  });
});

describe("an ordinal whose encoding changed", () => {
  const PACKED = "namespace t\nmodel M { 1 id: uuid  2 tags: [string] }";
  const WRAPPED = "namespace t\nmodel M { 1 id: uuid  2 tags: [string]? }";

  it("is refused within the major that recorded the encoding", () => {
    const base = run(PACKED, null, "1.0.0").next;
    expect(codes(run(WRAPPED, base, "1.1.0"))).toEqual(["OS2010"]);
  });

  it("may change from the next major on, which records the new major", () => {
    const base = run(PACKED, null, "1.0.0").next;
    const result = run(WRAPPED, base, "2.0.0");
    expect(codes(result)).toEqual([]);
    expect(result.next.spaces[MODEL].ordinals["2"]).toMatchObject({ encoding: "wrapper:repeated", major: "2" });
    expect(codes(run(PACKED, result.next, "2.1.0"))).toEqual(["OS2010"]);
  });

  it("is refused without a version", () => {
    const base = run(PACKED, null, "1.0.0").next;
    expect(codes(run(WRAPPED, base, null))).toEqual(["OS2010"]);
  });

  it("keeps the major of an unchanged ordinal", () => {
    const base = run(PACKED, null, "1.0.0").next;
    const result = run(PACKED, base, "2.0.0");
    expect(result.next.spaces[MODEL].ordinals["2"].major).toBe("1");
    expect(result.changed).toBe(false);
  });
});

describe("a ledger written without versions", () => {
  it("takes its entries to belong to the major being generated", () => {
    const base = run(WITH_LABEL, null, null).next;
    const result = run(WITH_LABEL, base, "1.0.0");
    expect(result.changed).toBe(true);
    expect(result.next.spaces[MODEL].ordinals["2"].major).toBe("1");
  });
});
