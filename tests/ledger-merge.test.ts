// tests/ledger-merge.test.ts
import { describe, it, expect } from "bun:test";
import { parse, resolve } from "../src/index";
import { collectSpaces } from "../src/ledger/spaces";
import { reconcileLedger, type LedgerMode } from "../src/ledger/merge";
import type { OrdinalLedger } from "../src/ledger/types";

const BASE_OPTIONS = {
  required: false,
  staleSeverity: "error" as const,
  now: () => "2026-01-01T00:00:00.000Z",
  generator: "openschema test",
};

function run(
  src: string,
  current: OrdinalLedger | null,
  overrides: Partial<typeof BASE_OPTIONS & { mode: LedgerMode }> = {},
) {
  const spaces = collectSpaces(resolve(parse(src)));
  return reconcileLedger(spaces, current, { mode: "update", ...BASE_OPTIONS, ...overrides });
}

function codes(result: { diagnostics: { code: string }[] }): string[] {
  return result.diagnostics.map(d => d.code);
}

function states(ledger: OrdinalLedger, spaceId: string): string[] {
  return Object.entries(ledger.spaces[spaceId].ordinals).map(([key, entry]) => `${key}:${entry.state}`);
}

const V1 = "namespace t\nmodel M { 1 id: uuid  2 phone: string  3 tags: [string] }";

describe("baseline", () => {
  it("seeds every declared ordinal as active", () => {
    const result = run(V1, null);
    expect(states(result.next, "model:t.M")).toEqual(["1:active", "2:active", "3:active"]);
    expect(result.next.baseline).toBe(true);
    expect(result.changed).toBe(true);
  });

  it("warns that protection is disabled when no ledger exists", () => {
    expect(codes(run(V1, null))).toEqual(["OS2011"]);
  });

  it("errors instead when a ledger is required", () => {
    const result = run(V1, null, { required: true });
    expect(result.diagnostics[0].code).toBe("OS2011");
    expect(result.diagnostics[0].severity).toBe("error");
  });

  it("records the encoding signature of each ordinal", () => {
    const ordinals = run(V1, null).next.spaces["model:t.M"].ordinals;
    expect(ordinals["1"].encoding).toBe("singular:len");
    // string is LEN-encoded, so a repeated string cannot pack.
    expect(ordinals["3"].encoding).toBe("repeated:len-element");
  });

  it("packs a repeated varint scalar", () => {
    const ordinals = run("namespace t\nmodel M { 1 ns: [i32] }", null).next.spaces["model:t.M"].ordinals;
    expect(ordinals["1"].encoding).toBe("repeated:packed");
  });
});

describe("retirement", () => {
  it("retires an ordinal whose field was removed", () => {
    const base = run(V1, null).next;
    const after = run("namespace t\nmodel M { 1 id: uuid  3 tags: [string] }", base).next;
    expect(states(after, "model:t.M")).toEqual(["1:active", "2:retired", "3:active"]);
    expect(after.spaces["model:t.M"].ordinals["2"].retiredAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not mutate the ledger it was given", () => {
    const base = run(V1, null).next;
    run("namespace t\nmodel M { 1 id: uuid }", base);
    expect(states(base, "model:t.M")).toEqual(["1:active", "2:active", "3:active"]);
  });
});

describe("reuse (OS2007)", () => {
  function retiredLedger(): OrdinalLedger {
    const base = run(V1, null).next;
    return run("namespace t\nmodel M { 1 id: uuid  3 tags: [string] }", base).next;
  }

  it("rejects re-adding a retired ordinal", () => {
    const src = "namespace t\nmodel M { 1 id: uuid  2 isFavorite: bool  3 tags: [string] }";
    expect(codes(run(src, retiredLedger()))).toEqual(["OS2007"]);
  });

  // State is the rule, not a fingerprint: restoring the identical field is still
  // reuse, because rows written between the two versions do not carry it.
  it("rejects re-adding it even with the original name and type", () => {
    expect(codes(run(V1, retiredLedger()))).toEqual(["OS2007"]);
  });

  it("rejects an ordinal reserved in source", () => {
    const base = run("namespace t\nmodel M { 1 id: uuid  reserved 5; }", null).next;
    expect(codes(run("namespace t\nmodel M { 1 id: uuid  5 x: i32 }", base))).toEqual(["OS2007"]);
  });

  it("keeps a source reservation spent after the reserved line is deleted", () => {
    const base = run("namespace t\nmodel M { 1 id: uuid  reserved 5; }", null).next;
    expect(base.spaces["model:t.M"].ordinals["5"].state).toBe("reserved");
    expect(codes(run("namespace t\nmodel M { 1 id: uuid  5 x: i32 }", base))).toEqual(["OS2007"]);
  });

  it("spends a base record's retired ordinal in every derived record", () => {
    const v1 = "namespace t\nmodel B { 1 a: uuid  2 b: string }\nmodel D extends B { 3 c: i32 }";
    const v2 = "namespace t\nmodel B { 1 a: uuid }\nmodel D extends B { 3 c: i32 }";
    const retired = run(v2, run(v1, null).next).next;

    const reclaim = "namespace t\nmodel B { 1 a: uuid }\nmodel D extends B { 2 c: i32  3 d: i32 }";
    expect(codes(run(reclaim, retired))).toEqual(["OS2007"]);
  });

  it("applies to enum variants", () => {
    const base = run("namespace t\nenum S { 1 a  2 b }", null).next;
    const retired = run("namespace t\nenum S { 1 a }", base).next;
    expect(codes(run("namespace t\nenum S { 1 a  2 c }", retired))).toEqual(["OS2007"]);
  });

  it("applies to oneof variants", () => {
    const v1 = "namespace t\nmodel M { 1 p: oneof { 1 a: i32  2 b: string } }";
    const v2 = "namespace t\nmodel M { 1 p: oneof { 1 a: i32 } }";
    const retired = run(v2, run(v1, null).next).next;
    const reclaim = "namespace t\nmodel M { 1 p: oneof { 1 a: i32  2 c: bool } }";
    expect(codes(run(reclaim, retired))).toEqual(["OS2007"]);
  });
});

describe("encoding changes (OS2010)", () => {
  // The compatibility checker calls [T] -> [T]? a safe widening, but it moves
  // the field from repeated-at-tag-N to a LEN wrapper at tag N. The ledger is
  // the only thing that catches it.
  it("rejects [T] becoming [T]?", () => {
    const base = run(V1, null).next;
    const src = "namespace t\nmodel M { 1 id: uuid  2 phone: string  3 tags: [string]? }";
    expect(codes(run(src, base))).toEqual(["OS2010"]);
  });

  it("rejects a scalar becoming a different wire class", () => {
    const base = run("namespace t\nmodel M { 1 id: uuid  2 n: i32 }", null).next;
    expect(codes(run("namespace t\nmodel M { 1 id: uuid  2 n: string }", base))).toEqual(["OS2010"]);
  });

  it("allows a widening that keeps the same encoding", () => {
    const base = run("namespace t\nmodel M { 1 id: uuid  2 n: i32 }", null).next;
    expect(codes(run("namespace t\nmodel M { 1 id: uuid  2 n: i64 }", base))).toEqual([]);
  });

  it("allows f32 becoming f64, which shares one encoding", () => {
    const base = run("namespace t\nmodel M { 1 id: uuid  2 n: f32 }", null).next;
    expect(codes(run("namespace t\nmodel M { 1 id: uuid  2 n: f64 }", base))).toEqual([]);
  });

  // Presence for a singular field is absence on the wire, so this is a no-op.
  it("allows T becoming T? for a singular field", () => {
    const base = run("namespace t\nmodel M { 1 id: uuid  2 n: i32 }", null).next;
    expect(codes(run("namespace t\nmodel M { 1 id: uuid  2 n: i32? }", base))).toEqual([]);
  });
});

describe("renames and staleness", () => {
  it("accepts a rename at a stable ordinal and records the new name", () => {
    const base = run(V1, null).next;
    const src = "namespace t\nmodel M { 1 id: uuid  2 phoneNumber: string  3 tags: [string] }";
    const result = run(src, base);
    expect(codes(result)).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.next.spaces["model:t.M"].ordinals["2"].name).toBe("phoneNumber");
  });

  it("is idempotent for an unchanged schema", () => {
    const base = run(V1, null).next;
    expect(run(V1, base).changed).toBe(false);
  });

  it("reports OS2008 in check mode when the ledger would change", () => {
    const base = run(V1, null).next;
    const src = "namespace t\nmodel M { 1 id: uuid  2 phone: string  3 tags: [string]  4 extra: bool }";
    expect(codes(run(src, base, { mode: "check" }))).toEqual(["OS2008"]);
  });

  it("stays silent in check mode when the ledger is current", () => {
    const base = run(V1, null).next;
    expect(codes(run(V1, base, { mode: "check" }))).toEqual([]);
  });
});

describe("space isolation", () => {
  // A lockfile shared by several entry files must not have one entry's run
  // retire another entry's live fields.
  it("leaves a space that was not observed completely untouched", () => {
    const a = "namespace t\nmodel A { 1 a: uuid  2 b: string }";
    const b = "namespace t\nmodel B { 1 x: uuid  2 y: string }";
    const shared = run(b, run(a, null).next).next;

    const rerunA = run(a, shared);
    expect(states(rerunA.next, "model:t.B")).toEqual(["1:active", "2:active"]);
    expect(codes(rerunA)).toEqual([]);
    expect(rerunA.changed).toBe(false);
    expect(codes(run(b, rerunA.next))).toEqual([]);
  });

  it("keeps overlay ordinals in their own space", () => {
    const v1 = "namespace t\nmodel M { 1 a: i32 }\noverlay acme on t.M { 1 x: i32  2 y: string }";
    const v2 = "namespace t\nmodel M { 1 a: i32 }\noverlay acme on t.M { 1 x: i32 }";
    const retired = run(v2, run(v1, null).next).next;

    // Ordinal 2 is retired for acme, but the base record's 2 is untouched.
    expect(codes(run("namespace t\nmodel M { 1 a: i32  2 b: string }\noverlay acme on t.M { 1 x: i32 }", retired)))
      .toEqual([]);
    const reclaim = "namespace t\nmodel M { 1 a: i32 }\noverlay acme on t.M { 1 x: i32  2 z: bool }";
    expect(codes(run(reclaim, retired))).toEqual(["OS2007"]);
  });

  it("keeps two companies' overlays independent", () => {
    const v1 = "namespace t\nmodel M { 1 a: i32 }\noverlay acme on t.M { 1 x: i32  2 y: string }";
    const v2 = "namespace t\nmodel M { 1 a: i32 }\noverlay acme on t.M { 1 x: i32 }";
    const retired = run(v2, run(v1, null).next).next;

    const other = "namespace t\nmodel M { 1 a: i32 }\noverlay acme on t.M { 1 x: i32 }\noverlay globex on t.M { 2 z: bool }";
    expect(codes(run(other, retired))).toEqual([]);
  });

  it("keys a oneof space by the field ordinal so renames do not churn it", () => {
    const v1 = "namespace t\nmodel M { 4 payment: oneof { 1 card: string } }";
    const v2 = "namespace t\nmodel M { 4 paymentMethod: oneof { 1 card: string } }";
    const base = run(v1, null).next;
    expect(Object.keys(base.spaces)).toContain("oneof:t.M:4");
    expect(codes(run(v2, base))).toEqual([]);
  });
});
