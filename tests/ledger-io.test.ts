// tests/ledger-io.test.ts
import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, resolve } from "../src/index";
import { collectSpaces } from "../src/ledger/spaces";
import { reconcileLedger } from "../src/ledger/merge";
import { computeDigest, defaultLockPath, isSuperset, loadLedger, serializeLedger } from "../src/ledger/io";
import type { OrdinalLedger } from "../src/ledger/types";

const workDir = mkdtempSync(join(tmpdir(), "openschema-ledger-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

function build(src: string, current: OrdinalLedger | null = null): OrdinalLedger {
  return reconcileLedger(collectSpaces(resolve(parse(src))), current, {
    mode: "update", required: false, staleSeverity: "error",
    now: () => "2026-01-01T00:00:00.000Z", generator: "openschema test",
  }).next;
}

function writeLedger(name: string, contents: string): string {
  const path = join(workDir, name);
  writeFileSync(path, contents);
  return path;
}

const SRC = "namespace t\nmodel M { 1 id: uuid  2 phone: string }\nenum S { 1 a  2 b }";

describe("serialize and load", () => {
  it("round-trips through the filesystem", () => {
    const ledger = build(SRC);
    const path = writeLedger("round-trip.lock", serializeLedger(ledger));
    const loaded = loadLedger(path);

    expect(loaded.integrityError).toBeNull();
    expect(loaded.ledger?.spaces).toEqual(serialized(ledger).spaces);
  });

  it("returns a null ledger without error when the file is absent", () => {
    const loaded = loadLedger(join(workDir, "does-not-exist.lock"));
    expect(loaded.ledger).toBeNull();
    expect(loaded.integrityError).toBeNull();
  });

  it("sorts spaces and ordinals so diffs stay minimal", () => {
    const text = serializeLedger(build(SRC));
    const spaceOrder = [...text.matchAll(/^ {4}"(model|enum|overlay|oneof):[^"]+"/gm)].map(m => m[0].trim());
    expect(spaceOrder).toEqual([...spaceOrder].sort());
  });

  it("re-serializes an unchanged ledger byte-identically", () => {
    const ledger = build(SRC);
    expect(serializeLedger(ledger)).toBe(serializeLedger(ledger));

    const reloaded = loadLedger(writeLedger("stable.lock", serializeLedger(ledger)));
    expect(serializeLedger(reloaded.ledger!)).toBe(serializeLedger(ledger));
  });

  it("ends with a trailing newline", () => {
    expect(serializeLedger(build(SRC)).endsWith("}\n")).toBe(true);
  });
});

describe("integrity", () => {
  it("rejects a hand-edited spaces block", () => {
    const ledger = serialized(build(SRC));
    ledger.spaces["model:t.M"].ordinals["2"].state = "active";
    delete ledger.spaces["model:t.M"].ordinals["1"];

    const path = writeLedger("tampered.lock", `${JSON.stringify(ledger, null, 2)}\n`);
    const loaded = loadLedger(path);
    expect(loaded.ledger).toBeNull();
    expect(loaded.integrityError).toContain("digest mismatch");
  });

  it("rejects malformed JSON", () => {
    const path = writeLedger("broken.lock", "{ not json");
    expect(loadLedger(path).integrityError).toContain("not valid JSON");
  });

  it("rejects an unsupported lockfileVersion", () => {
    const ledger = serialized(build(SRC));
    ledger.lockfileVersion = 99;
    const path = writeLedger("future.lock", `${JSON.stringify(ledger, null, 2)}\n`);
    expect(loadLedger(path).integrityError).toContain("unsupported lockfileVersion");
  });

  it("computes a digest that ignores key order", () => {
    const ledger = build(SRC);
    const reversed: OrdinalLedger["spaces"] = {};
    for (const key of Object.keys(ledger.spaces).reverse()) reversed[key] = ledger.spaces[key];
    expect(computeDigest(reversed)).toBe(computeDigest(ledger.spaces));
  });
});

describe("isSuperset (the append-only gate)", () => {
  it("accepts a ledger that only grew", () => {
    const before = build(SRC);
    const after = build(`${SRC}\nmodel N { 1 x: uuid }`, before);
    expect(isSuperset(after, before).ok).toBe(true);
  });

  it("accepts retirement, which keeps the entry", () => {
    const before = build(SRC);
    const after = build("namespace t\nmodel M { 1 id: uuid }\nenum S { 1 a  2 b }", before);
    expect(isSuperset(after, before).ok).toBe(true);
  });

  it("detects a dropped ordinal", () => {
    const before = build(SRC);
    const after = serialized(before);
    delete after.spaces["model:t.M"].ordinals["2"];
    const result = isSuperset(after, before);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("model:t.M:2");
  });

  it("detects a dropped space", () => {
    const before = build(SRC);
    const after = serialized(before);
    delete after.spaces["enum:t.S"];
    const result = isSuperset(after, before);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("enum:t.S");
  });
});

describe("defaultLockPath", () => {
  it("resolves beside the entry schema", () => {
    expect(defaultLockPath("/a/b/contacts.schema")).toBe("/a/b/openschema.lock");
  });

  it("handles an entry with no directory component", () => {
    expect(defaultLockPath("contacts.schema")).toBe("openschema.lock");
  });
});

/** The ledger as it exists on disk, i.e. after serialization fills the digest. */
function serialized(ledger: OrdinalLedger): OrdinalLedger {
  return JSON.parse(serializeLedger(ledger)) as OrdinalLedger;
}
