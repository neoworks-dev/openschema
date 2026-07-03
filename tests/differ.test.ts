// tests/engine/differ.test.ts
import { describe, it, expect } from "bun:test";
import { diff, isCompatible } from "../src/engine";
import type { Change } from "../src/engine/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function changes(oldSrc: string, newSrc: string): Change[] {
  return diff(oldSrc, newSrc).changes;
}

function kinds(oldSrc: string, newSrc: string) {
  return changes(oldSrc, newSrc).map(c => c.kind);
}

function severities(oldSrc: string, newSrc: string) {
  return changes(oldSrc, newSrc).map(c => c.severity);
}

function findChange(cs: Change[], kind: string): Change | undefined {
  return cs.find(c => c.kind === kind);
}

function hasRule(cs: Change[], ruleId: string): boolean {
  return cs.some(c => c.ruleId === ruleId);
}

// ── No changes ────────────────────────────────────────────────────────────────

describe("identical schemas produce no changes", () => {
  it("empty programs", () => {
    expect(changes("", "")).toEqual([]);
  });

  it("identical model", () => {
    const src = "model R { 1 id: uuid }";
    expect(changes(src, src)).toEqual([]);
  });

  it("identical enum", () => {
    const src = "enum S { 1 a  2 b }";
    expect(changes(src, src)).toEqual([]);
  });

  it("identical type alias", () => {
    const src = "type Id = uuid";
    expect(changes(src, src)).toEqual([]);
  });
});

// ── Schema-level changes ──────────────────────────────────────────────────────

describe("schema-level changes", () => {
  it("adding a model is safe", () => {
    const result = diff("", "model Foo {}");
    const c = findChange(result.changes, "declaration_added");
    expect(c?.severity).toBe("safe");
  });

  it("removing a model is breaking_both", () => {
    const result = diff("model Foo {}", "");
    const c = findChange(result.changes, "declaration_removed");
    expect(c?.severity).toBe("breaking_both");
    expect(c?.path).toBe("Foo");
  });

  it("adding an enum is safe", () => {
    const result = diff("", "enum E { 1 a }");
    expect(findChange(result.changes, "declaration_added")?.severity).toBe("safe");
  });

  it("removing an enum is breaking_both", () => {
    const result = diff("enum E { 1 a }", "");
    expect(findChange(result.changes, "declaration_removed")?.severity).toBe("breaking_both");
  });

  it("adding a type alias is safe", () => {
    const result = diff("", "type Id = uuid");
    expect(findChange(result.changes, "declaration_added")?.severity).toBe("safe");
  });

  it("removing a type alias is breaking_both", () => {
    const result = diff("type Id = uuid", "");
    expect(findChange(result.changes, "declaration_removed")?.severity).toBe("breaking_both");
  });
});

// ── Field additions ───────────────────────────────────────────────────────────

describe("field additions", () => {
  const BASE = "model R { 1 id: uuid }";

  it("nullable field addition is safe (R001)", () => {
    const result = diff(BASE, "model R { 1 id: uuid  2 name: string? }");
    expect(findChange(result.changes, "field_added_nullable")?.severity).toBe("safe");
    expect(hasRule(result.changes, "R001")).toBe(true);
  });

  it("field with @default is safe (R002)", () => {
    const result = diff(BASE, "model R { 1 id: uuid  @default(0) 2 score: i32 }");
    expect(findChange(result.changes, "field_added_required_with_default")?.severity).toBe("safe");
    expect(hasRule(result.changes, "R002")).toBe(true);
  });

  it("required (non-nullable) field added is breaking_writer (R010)", () => {
    const result = diff(BASE, "model R { 1 id: uuid  2 name: string }");
    expect(findChange(result.changes, "field_added_required")?.severity).toBe("breaking_writer");
    expect(hasRule(result.changes, "R010")).toBe(true);
  });

  it("added field with gen_uuid default is safe (R002)", () => {
    const result = diff(BASE,
      "model R { 1 id: uuid  @default(gen_uuid()) 2 alt: uuid }");
    expect(findChange(result.changes, "field_added_required_with_default")?.severity).toBe("safe");
  });
});

// ── Field removals ────────────────────────────────────────────────────────────

describe("field removals", () => {
  it("removing a field is breaking_reader (R004)", () => {
    const OLD = "model R { 1 id: uuid  2 name: string }";
    const NEW = "model R { 1 id: uuid }";
    const result = diff(OLD, NEW);
    const c = findChange(result.changes, "field_removed");
    expect(c?.severity).toBe("breaking_reader");
    expect(c?.path).toBe("R.name");
    expect(hasRule(result.changes, "R004")).toBe(true);
  });

  it("before description contains the removed field info", () => {
    const OLD = "model R { 1 id: uuid  2 email: string }";
    const NEW = "model R { 1 id: uuid }";
    const c = findChange(changes(OLD, NEW), "field_removed");
    expect(c?.before).toContain("email");
  });
});

// ── Field renames ─────────────────────────────────────────────────────────────

describe("field renames", () => {
  it("same ordinal different name is a warning rename (R005)", () => {
    const OLD = "model R { 1 full_name: string }";
    const NEW = "model R { 1 name: string }";
    const result = diff(OLD, NEW);
    const c = findChange(result.changes, "field_renamed");
    expect(c?.severity).toBe("warning");
    expect(c?.before).toBe("full_name");
    expect(c?.after).toBe("name");
    expect(hasRule(result.changes, "R005")).toBe(true);
  });

  it("rename does not emit field_removed or field_added", () => {
    const OLD = "model R { 1 foo: string }";
    const NEW = "model R { 1 bar: string }";
    const cs = changes(OLD, NEW);
    expect(cs.some(c => c.kind === "field_removed")).toBe(false);
    expect(cs.some(c => c.kind === "field_added_nullable")).toBe(false);
    expect(cs.some(c => c.kind === "field_added_required_no_default")).toBe(false);
  });

  it("rename is compatible under all modes (only a warning)", () => {
    const OLD = "model R { 1 foo: string }";
    const NEW = "model R { 1 bar: string }";
    expect(isCompatible(OLD, NEW, "backward")).toBe(true);
    expect(isCompatible(OLD, NEW, "forward")).toBe(true);
    expect(isCompatible(OLD, NEW, "full")).toBe(true);
  });
});

// ── Type changes ──────────────────────────────────────────────────────────────

describe("type changes", () => {
  function typeChange(oldType: string, newType: string) {
    return diff(
      `model R { 1 x: ${oldType} }`,
      `model R { 1 x: ${newType} }`
    ).changes;
  }

  it("i32 → i64 is field_type_widened and safe (R006)", () => {
    const cs = typeChange("i32", "i64");
    const c = findChange(cs, "field_type_widened");
    expect(c?.severity).toBe("safe");
    expect(c?.before).toBe("i32");
    expect(c?.after).toBe("i64");
    expect(hasRule(cs, "R006")).toBe(true);
  });

  it("i64 → i32 is field_type_narrowed and breaking_writer (R007)", () => {
    const cs = typeChange("i64", "i32");
    const c = findChange(cs, "field_type_narrowed");
    expect(c?.severity).toBe("breaking_writer");
    expect(hasRule(cs, "R007")).toBe(true);
  });

  it("string → bytes is field_type_incompatible and breaking_both (R008)", () => {
    const cs = typeChange("string", "bytes");
    const c = findChange(cs, "field_type_incompatible");
    expect(c?.severity).toBe("breaking_both");
    expect(hasRule(cs, "R008")).toBe(true);
  });

  it("f32 → f64 is safe widening", () => {
    expect(findChange(typeChange("f32", "f64"), "field_type_widened")?.severity).toBe("safe");
  });

  it("decimal(10,2) → decimal(12,4) is safe widening", () => {
    const c = findChange(typeChange("decimal(10,2)", "decimal(12,4)"), "field_type_widened");
    expect(c?.severity).toBe("safe");
  });

  it("decimal(12,4) → decimal(10,2) is narrowed", () => {
    const c = findChange(typeChange("decimal(12,4)", "decimal(10,2)"), "field_type_narrowed");
    expect(c?.severity).toBe("breaking_writer");
  });

  it("[i32] → [i64] is widened", () => {
    const c = findChange(typeChange("[i32]", "[i64]"), "field_type_widened");
    expect(c?.severity).toBe("safe");
  });

  it("[i64] → [i32] is narrowed", () => {
    const c = findChange(typeChange("[i64]", "[i32]"), "field_type_narrowed");
    expect(c?.severity).toBe("breaking_writer");
  });
});

// ── Nullability changes ───────────────────────────────────────────────────────

describe("nullability changes", () => {
  it("string → string? emits field_type_widened and field_made_nullable (safe, R009)", () => {
    const OLD = "model R { 1 x: string }";
    const NEW = "model R { 1 x: string? }";
    const cs = changes(OLD, NEW);
    expect(findChange(cs, "field_type_widened")?.severity).toBe("safe");
    expect(findChange(cs, "field_made_nullable")?.severity).toBe("safe");
    expect(hasRule(cs, "R009")).toBe(true);
  });

  it("string? → string emits narrowing and field_made_required (breaking_writer, R010)", () => {
    const OLD = "model R { 1 x: string? }";
    const NEW = "model R { 1 x: string }";
    const cs = changes(OLD, NEW);
    expect(findChange(cs, "field_type_narrowed")?.severity).toBe("breaking_writer");
    expect(findChange(cs, "field_made_required")?.severity).toBe("breaking_writer");
    expect(hasRule(cs, "R011")).toBe(true);
  });
});

// ── Constraint changes (decorator-driven) ─────────────────────────────────────

describe("constraint changes", () => {
  it("adding @unique is breaking_writer (R012)", () => {
    const OLD = "model R { 1 email: string }";
    const NEW = "model R { @unique 1 email: string }";
    const cs = changes(OLD, NEW);
    expect(cs.some(c => c.ruleId === "R012" && c.severity === "breaking_writer")).toBe(true);
  });

  it("removing @unique is safe (R014)", () => {
    const OLD = "model R { @unique 1 email: string }";
    const NEW = "model R { 1 email: string }";
    const cs = changes(OLD, NEW);
    expect(cs.some(c => c.ruleId === "R014" && c.severity === "safe")).toBe(true);
  });

  it("adding @check is breaking_writer (R013)", () => {
    const OLD = "model R { 1 x: i32 }";
    const NEW = "model R { @check(x >= 0) 1 x: i32 }";
    const cs = changes(OLD, NEW);
    expect(cs.some(c => c.ruleId === "R013" && c.severity === "breaking_writer")).toBe(true);
  });

  it("removing @check is safe (R014)", () => {
    const OLD = "model R { @check(x >= 0) 1 x: i32 }";
    const NEW = "model R { 1 x: i32 }";
    const cs = changes(OLD, NEW);
    expect(cs.some(c => c.ruleId === "R014" && c.severity === "safe")).toBe(true);
  });

  it("adding @primaryKey is breaking_both (R015)", () => {
    const OLD = "model R { 1 id: uuid }";
    const NEW = "model R { @primaryKey 1 id: uuid }";
    const cs = changes(OLD, NEW);
    expect(cs.some(c => c.ruleId === "R015" && c.severity === "breaking_both")).toBe(true);
  });

  it("removing @primaryKey is breaking_both (R015)", () => {
    const OLD = "model R { @primaryKey 1 id: uuid }";
    const NEW = "model R { 1 id: uuid }";
    const cs = changes(OLD, NEW);
    expect(cs.some(c => c.ruleId === "R015" && c.severity === "breaking_both")).toBe(true);
  });

  it("@references target change is breaking_both (R018)", () => {
    const OLD = "model R { @references(User.id) 1 uid: i64 }";
    const NEW = "model R { @references(Account.id) 1 uid: i64 }";
    const cs = changes(OLD, NEW);
    expect(cs.some(c => c.ruleId === "R018" && c.severity === "breaking_both")).toBe(true);
  });

  it("marking a field @deprecated is a warning (R019)", () => {
    const OLD = "model R { 1 legacy: string }";
    const NEW = "model R { @deprecated 1 legacy: string }";
    const cs = changes(OLD, NEW);
    expect(cs.some(c => c.ruleId === "R019" && c.severity === "warning")).toBe(true);
  });
});

// ── #suppress directive ───────────────────────────────────────────────────────

describe("#suppress directive", () => {
  it("suppresses a matching rule on a field", () => {
    const OLD = "model R { 1 fullName: string }";
    const NEW = 'model R { #suppress "R005" "rename is intentional" 1 name: string }';
    const cs = changes(OLD, NEW);
    expect(cs.some(c => c.ruleId === "R005")).toBe(false);
  });

  it("does not suppress unrelated rules", () => {
    const OLD = "model R { 1 a: string  2 b: string }";
    const NEW = 'model R { #suppress "R005" "x" 1 a: string }';
    const cs = changes(OLD, NEW);
    // b removed (R004) is on a different field and must still surface.
    expect(cs.some(c => c.ruleId === "R004")).toBe(true);
  });
});

// NOTE: `index ... on [...]` grammar was removed; indexes will return as a
// decorator (@index) in a later iteration, at which point index-diff rules
// can be reintroduced here.

// ── Enum changes ──────────────────────────────────────────────────────────────

describe("enum changes", () => {
  const BASE = "enum S { 1 pending  2 active  3 cancelled }";

  it("removing a variant is breaking_reader (E002)", () => {
    const cs = changes(BASE, "enum S { 1 pending  2 active }");
    const c = findChange(cs, "variant_removed");
    expect(c?.severity).toBe("breaking_reader");
    expect(c?.path).toBe("S.cancelled");
    expect(hasRule(cs, "E002")).toBe(true);
  });

  it("adding a variant is a warning (E001)", () => {
    const cs = changes(BASE, "enum S { 1 pending  2 active  3 cancelled  4 archived }");
    const c = findChange(cs, "variant_added");
    expect(c?.severity).toBe("warning");
    expect(hasRule(cs, "E001")).toBe(true);
  });

  it("renaming a variant (same ordinal) is a warning (E003)", () => {
    const cs = changes(BASE, "enum S { 1 pending  2 active  3 done }");
    const c = findChange(cs, "variant_renamed");
    expect(c?.severity).toBe("warning");
    expect(c?.before).toBe("cancelled");
    expect(c?.after).toBe("done");
    expect(hasRule(cs, "E003")).toBe(true);
  });

  it("renumbering a variant is breaking_both (E004)", () => {
    const cs = changes(
      "enum S { 1 a  2 b  3 c }",
      "enum S { 1 a  3 b  2 c }"   // b and c swap ordinals
    );
    const renumbered = cs.filter(c => c.kind === "variant_renumbered");
    expect(renumbered.length).toBeGreaterThanOrEqual(2);
    expect(renumbered.every(c => c.severity === "breaking_both")).toBe(true);
    expect(hasRule(cs, "E004")).toBe(true);
  });
});

// ── Type alias changes ────────────────────────────────────────────────────────

describe("type alias changes", () => {
  it("widening an alias is safe", () => {
    const cs = changes("type T = i32", "type T = i64");
    const c = findChange(cs, "type_alias_changed");
    expect(c?.severity).toBe("safe");
  });

  it("narrowing an alias is breaking_writer", () => {
    const cs = changes("type T = i64", "type T = i32");
    const c = findChange(cs, "type_alias_changed");
    expect(c?.severity).toBe("breaking_writer");
  });

  it("incompatible alias change is breaking_both", () => {
    const cs = changes("type T = string", "type T = bytes");
    const c = findChange(cs, "type_alias_changed");
    expect(c?.severity).toBe("breaking_both");
  });
});

// ── Compatibility modes ───────────────────────────────────────────────────────

describe("compatibility mode evaluation", () => {
  describe("backward mode", () => {
    it("safe-only changes are compatible", () => {
      const OLD = "model R { 1 id: uuid }";
      const NEW = "model R { 1 id: uuid  2 name: string? }";
      expect(isCompatible(OLD, NEW, "backward")).toBe(true);
    });

    it("field removal violates backward", () => {
      const OLD = "model R { 1 id: uuid  2 name: string }";
      const NEW = "model R { 1 id: uuid }";
      expect(isCompatible(OLD, NEW, "backward")).toBe(false);
    });

    it("breaking_writer does NOT violate backward", () => {
      // Adding required field (breaking_writer) should pass backward
      const OLD = "model R { 1 id: uuid }";
      const NEW = "model R { 1 id: uuid  2 name: string }";
      expect(isCompatible(OLD, NEW, "backward")).toBe(true);
    });
  });

  describe("forward mode", () => {
    it("safe-only changes are compatible", () => {
      const OLD = "model R { 1 id: uuid }";
      const NEW = "model R { 1 id: uuid  2 name: string? }";
      expect(isCompatible(OLD, NEW, "forward")).toBe(true);
    });

    it("required field without default violates forward", () => {
      const OLD = "model R { 1 id: uuid }";
      const NEW = "model R { 1 id: uuid  2 name: string }";
      expect(isCompatible(OLD, NEW, "forward")).toBe(false);
    });

    it("field removal does NOT violate forward", () => {
      // Removing a field is breaking_reader which doesn't violate forward
      const OLD = "model R { 1 id: uuid  2 name: string }";
      const NEW = "model R { 1 id: uuid }";
      expect(isCompatible(OLD, NEW, "forward")).toBe(true);
    });
  });

  describe("full mode", () => {
    it("safe-only changes are compatible", () => {
      const OLD = "model R { 1 id: uuid }";
      const NEW = "model R { 1 id: uuid  2 x: string? }";
      expect(isCompatible(OLD, NEW, "full")).toBe(true);
    });

    it("any breaking change violates full", () => {
      const OLD = "model R { 1 id: uuid  2 name: string }";
      const NEW = "model R { 1 id: uuid }";
      expect(isCompatible(OLD, NEW, "full")).toBe(false);
    });

    it("breaking_writer also violates full", () => {
      const OLD = "model R { 1 id: uuid }";
      const NEW = "model R { 1 id: uuid  2 name: string }";
      expect(isCompatible(OLD, NEW, "full")).toBe(false);
    });
  });

  describe("none mode", () => {
    it("always compatible regardless of changes", () => {
      const OLD = "model R { 1 id: uuid  2 name: string }";
      const NEW = "model R { 1 id: uuid }";
      expect(isCompatible(OLD, NEW, "none")).toBe(true);
    });

    it("even breaking_both is compatible under none", () => {
      const OLD = "model R { 1 x: string }";
      const NEW = "model R { 1 x: bytes }";
      expect(isCompatible(OLD, NEW, "none")).toBe(true);
    });
  });
});

// ── violations() ─────────────────────────────────────────────────────────────

describe("violations()", () => {
  it("returns only reader-breaking changes under backward", () => {
    // type incompatible change → breaking_both → violates backward
    const result = diff("model R { 1 x: string }", "model R { 1 x: bytes }");
    const vs = result.violations("backward");
    expect(vs.length).toBeGreaterThan(0);
    expect(vs.every(v =>
      v.severity === "breaking_reader" ||
      v.severity === "breaking_both"
    )).toBe(true);
  });

  it("returns no violations under none", () => {
    const result = diff("model R { 1 x: string }", "model R { 1 x: bytes }");
    expect(result.violations("none")).toHaveLength(0);
  });
});

// ── DiffResult.breaking / .warnings ──────────────────────────────────────────

describe("DiffResult accessors", () => {
  it("breaking contains only breaking_* severity", () => {
    const OLD = "model R { 1 a: string  2 b: string }";
    const NEW = "model R { 1 a: string? }"; // b removed (breaking_reader), a→a? (safe + warning)
    const result = diff(OLD, NEW);
    expect(result.breaking.every(c =>
      c.severity.startsWith("breaking")
    )).toBe(true);
  });

  it("warnings contains only warning severity", () => {
    const OLD = "model R { 1 fullName: string }";
    const NEW = "model R { 1 name: string }"; // same ordinal, renamed → warning
    const result = diff(OLD, NEW);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.every(c => c.severity === "warning")).toBe(true);
  });

  it("all changes appear in exactly one of breaking, warnings, or neither", () => {
    const OLD = "model R { 1 a: string  2 b: i32 }";
    const NEW = "model R { 1 a: string?  2 b: i64 }";
    const result = diff(OLD, NEW);
    for (const c of result.changes) {
      const inBreaking = result.breaking.includes(c);
      const inWarnings = result.warnings.includes(c);
      expect(inBreaking && inWarnings).toBe(false); // can't be in both
    }
  });
});

// ── Change paths ──────────────────────────────────────────────────────────────

describe("change paths", () => {
  it("field path is 'RecordName.fieldName'", () => {
    const cs = changes("model Order { 1 total: i32 }", "model Order {}");
    expect(cs.find(c => c.kind === "field_removed")?.path).toBe("Order.total");
  });

  it("enum variant path is 'EnumName.variantName'", () => {
    const cs = changes("enum E { 1 a  2 b }", "enum E { 1 a }");
    expect(cs.find(c => c.kind === "variant_removed")?.path).toBe("E.b");
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("empty model to model with fields", () => {
    const cs = changes("model R {}", "model R { 1 x: string? }");
    expect(cs.some(c => c.kind === "field_added_nullable")).toBe(true);
  });

  it("model with fields to empty model", () => {
    const cs = changes("model R { 1 x: string }", "model R {}");
    expect(cs.some(c => c.kind === "field_removed")).toBe(true);
  });

  it("multiple records only diffs matching names", () => {
    const OLD = "model A { 1 x: i32 }  model B { 1 y: string }";
    const NEW = "model A { 1 x: i64 }  model B { 1 y: string }";
    const cs = changes(OLD, NEW);
    // Only A.x should change; B.y unchanged
    expect(cs.every(c => !c.path.startsWith("B"))).toBe(true);
    expect(cs.some(c => c.path === "A.x")).toBe(true);
  });

  it("adding and removing different records simultaneously", () => {
    const OLD = "model A {}";
    const NEW = "model B {}";
    const cs = changes(OLD, NEW);
    expect(cs.some(c => c.kind === "declaration_removed" && c.path === "A")).toBe(true);
    expect(cs.some(c => c.kind === "declaration_added"   && c.path === "B")).toBe(true);
  });
});
// ── @renamed declaration renames ───────────────────────────────────────────────

describe("@renamed turns a declaration remove+add into a rename", () => {
  it("matches a renamed model and keeps it compatible", () => {
    const OLD = "model Order { 1 id: uuid  2 total: i32 }";
    const NEW = '@renamed("Order") model PurchaseOrder { 1 id: uuid  2 total: i32 }';
    const cs = changes(OLD, NEW);

    expect(cs.some(c => c.kind === "declaration_removed")).toBe(false);
    expect(cs.some(c => c.kind === "declaration_added")).toBe(false);

    const renamed = findChange(cs, "declaration_renamed")!;
    expect(renamed.ruleId).toBe("R020");
    expect(renamed.severity).toBe("warning");
    expect(renamed.path).toBe("PurchaseOrder");
    expect(renamed.before).toBe("Order");
    expect(renamed.after).toBe("PurchaseOrder");
    expect(isCompatible(OLD, NEW, "full")).toBe(true);
  });

  it("still diffs the fields of a renamed model under the new name", () => {
    const OLD = "model Order { 1 id: uuid }";
    const NEW = '@renamed("Order") model PurchaseOrder { 1 id: uuid  2 note: string }';
    const cs = changes(OLD, NEW);
    const added = findChange(cs, "field_added_required")!;
    expect(added.path).toBe("PurchaseOrder.note");
  });

  it("matches a renamed enum and preserves wire compatibility", () => {
    const OLD = "enum Status { 1 pending  2 shipped }";
    const NEW = '@renamed("Status") enum OrderStatus { 1 pending  2 shipped }';
    const cs = changes(OLD, NEW);
    expect(cs.some(c => c.kind === "declaration_removed")).toBe(false);
    const renamed = findChange(cs, "declaration_renamed")!;
    expect(renamed.ruleId).toBe("E007");
    expect(isCompatible(OLD, NEW, "full")).toBe(true);
  });

  it("matches a renamed type alias", () => {
    const OLD = "type Id = uuid";
    const NEW = '@renamed("Id") type Identifier = uuid';
    const cs = changes(OLD, NEW);
    const renamed = findChange(cs, "declaration_renamed")!;
    expect(renamed.ruleId).toBe("T004");
    expect(cs.some(c => c.kind === "declaration_removed")).toBe(false);
  });

  it("ignores @renamed when a declaration with the old name still exists", () => {
    const OLD = "model Order { 1 id: uuid }";
    const NEW = 'model Order { 1 id: uuid }\n@renamed("Order") model PurchaseOrder { 1 id: uuid }';
    const cs = changes(OLD, NEW);
    // Order is unchanged; PurchaseOrder is a genuine addition, not a rename.
    expect(cs.some(c => c.kind === "declaration_added" && c.path === "PurchaseOrder")).toBe(true);
    expect(cs.some(c => c.kind === "declaration_renamed")).toBe(false);
  });

  it("can be suppressed with #suppress \"R020\"", () => {
    const OLD = "model Order { 1 id: uuid }";
    const NEW = '#suppress "R020"\n@renamed("Order") model PurchaseOrder { 1 id: uuid }';
    const cs = changes(OLD, NEW);
    expect(cs.some(c => c.ruleId === "R020")).toBe(false);
  });
});
