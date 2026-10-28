// tests/file-and-reference-diff.test.ts
// The diff engine compares File and null as types of their own, and a ref<Model>
// by its target as well as by its uuid scalar.
import { describe, it, expect } from "bun:test";
import { diff } from "../src/engine";
import { describeType } from "../src/engine/type-compat";
import type { TypeExpr } from "../src/parser/ast";

const SPAN = { line: 0, col: 0 };

function schema(fields: string): string {
  return `namespace acme\n\nmodel Album {\n  1 name: string\n}\n\nmodel Folder {\n  1 name: string\n}\n\nmodel Photo {\n${fields}\n}\n`;
}

function fieldChanges(oldFields: string, newFields: string) {
  return diff(schema(oldFields), schema(newFields)).changes.map(change => ({
    path: change.path, kind: change.kind, severity: change.severity, before: change.before, after: change.after,
  }));
}

describe("File and null", () => {
  it("leaves an unchanged File field alone", () => {
    expect(fieldChanges("  1 image: File", "  1 image: File")).toEqual([]);
  });

  it("leaves an unchanged optional File field alone", () => {
    expect(fieldChanges("  1 image: File?", "  1 image: File?")).toEqual([]);
  });

  it("leaves an unchanged union with null alone", () => {
    expect(fieldChanges("  1 note: string | null", "  1 note: string | null")).toEqual([]);
  });
});

describe("references", () => {
  it("leaves an unchanged reference alone", () => {
    expect(fieldChanges("  1 album: ref<Album>", "  1 album: ref<Album>")).toEqual([]);
  });

  it("breaks both sides when a reference points at another model", () => {
    expect(fieldChanges("  1 album: ref<Album>", "  1 album: ref<Folder>")).toEqual([{
      path: "Photo.album", kind: "field_type_incompatible", severity: "breaking_both",
      before: "ref<Album>", after: "ref<Folder>",
    }]);
  });

  it("narrows a uuid that becomes a reference and widens one that stops being one", () => {
    expect(fieldChanges("  1 album: uuid", "  1 album: ref<Album>")[0]?.kind).toBe("field_type_narrowed");
    expect(fieldChanges("  1 album: ref<Album>", "  1 album: uuid")[0]?.kind).toBe("field_type_widened");
  });

  it("describes a reference by its scalar unless asked for the reference", () => {
    const reference: TypeExpr = { kind: "scalar", scalar: "uuid", reference: ["Album"], span: SPAN };
    expect(describeType(reference)).toBe("uuid");
    expect(describeType(reference, true)).toBe("ref<Album>");
  });
});
