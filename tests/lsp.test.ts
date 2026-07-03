// tests/lsp.test.ts
import { describe, it, expect } from "bun:test";
import { DiagnosticSeverity } from "vscode-languageserver";

import { analyze } from "../src/lsp/analyze";
import { documentSymbols } from "../src/lsp/symbols";
import { hover, definition, references, completion } from "../src/lsp/features";
import { wordAt, spanToRange } from "../src/lsp/positions";

// Standalone snippets: no file scheme, no live siblings -> single-module resolve.
function run(src: string) {
  return analyze("untitled:test", src, () => null);
}

describe("lsp positions", () => {
  it("sizes a span range to cover the identifier", () => {
    const range = spanToRange("model Person {}", { line: 1, col: 7 });
    expect(range).toEqual({ start: { line: 0, character: 6 }, end: { line: 0, character: 12 } });
  });

  it("finds the word and dotted path under the cursor", () => {
    const text = "  2 total: myorg.Money";
    const word = wordAt(text, { line: 0, character: 17 });
    expect(word?.word).toBe("Money");
    expect(word?.path).toBe("myorg.Money");
  });
});

describe("lsp diagnostics", () => {
  it("reports nothing for a valid schema", () => {
    const result = run("model R { 1 id: uuid  2 name: string }");
    expect(result.diagnostics).toHaveLength(0);
    expect(result.schema).not.toBeNull();
  });

  it("flags a duplicate ordinal with its resolver code", () => {
    const result = run("model R { 1 a: i32  1 b: i32 }");
    const codes = result.diagnostics.map(d => d.code);
    expect(codes).toContain("OS2001");
    expect(result.diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
  });

  it("flags an undefined type reference", () => {
    const result = run("model R { 1 x: Missing }");
    expect(result.diagnostics.map(d => d.code)).toContain("OS1003");
  });

  it("turns a parse error into a single diagnostic", () => {
    const result = run("model R { 1 x: }");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.program).toBeNull();
  });
});

describe("lsp document symbols", () => {
  it("outlines models with their fields and enums with variants", () => {
    const result = run("enum S { 1 a  2 b }  model R { 1 x: i32  2 s: S }");
    const symbols = documentSymbols("enum S { 1 a  2 b }  model R { 1 x: i32  2 s: S }", result.program!);
    const names = symbols.map(s => s.name);
    expect(names).toEqual(["S", "R"]);
    const model = symbols.find(s => s.name === "R")!;
    expect(model.children!.map(c => c.name)).toEqual(["1 x", "2 s"]);
  });
});

describe("lsp hover", () => {
  it("describes a user-declared model", () => {
    const src = "/// A person.\nmodel Person { 1 id: uuid }\nmodel R { 1 owner: Person }";
    const result = run(src);
    const h = hover(src, { line: 2, character: 19 }, result.schema);
    expect(h).not.toBeNull();
    const value = (h!.contents as any).value as string;
    expect(value).toContain("model Person");
    expect(value).toContain("A person.");
  });

  it("describes a scalar keyword", () => {
    const src = "model R { 1 id: uuid }";
    const result = run(src);
    const h = hover(src, { line: 0, character: 16 }, result.schema);
    expect((h!.contents as any).value).toContain("UUID");
  });

  it("explains a decorator argument value like compatibility(backward)", () => {
    const src = "@compatibility(backward)\nmodel R { 1 id: uuid }";
    const h = hover(src, { line: 0, character: 17 }, run(src).schema);
    expect(h).not.toBeNull();
    const value = (h!.contents as any).value as string;
    expect(value).toContain("backward");
    expect(value).toContain("read data written by old schema");
  });

  it("explains a decorator name", () => {
    const src = "model R {\n  @minValue(0)\n  1 n: i32\n}";
    const h = hover(src, { line: 1, character: 5 }, run(src).schema);
    expect((h!.contents as any).value).toContain("minimum numeric value");
  });

  it("explains a @format value used in the schemas", () => {
    const src = '@format("e164")\nmodel R { 1 phone: string }';
    const h = hover(src, { line: 0, character: 10 }, run(src).schema);
    expect((h!.contents as any).value).toContain("E.164");
  });

  it("explains a namespaced decorator name", () => {
    const src = '@sql.type("JSONB")\nmodel R { 1 id: uuid }';
    const h = hover(src, { line: 0, character: 6 }, run(src).schema);
    expect((h!.contents as any).value).toContain("SQL column type");
  });
});

describe("lsp definition", () => {
  it("jumps from a type reference to its declaration", () => {
    const src = "model Person { 1 id: uuid }\nmodel R { 1 owner: Person }";
    const result = run(src);
    const loc = definition(src, { line: 1, character: 19 }, result.schema, "file:///x.schema", () => null);
    expect(loc).not.toBeNull();
    // Points at the start of the `model Person` declaration on line 0.
    expect(loc!.range.start).toEqual({ line: 0, character: 0 });
  });
});

describe("lsp references", () => {
  const SRC = [
    "model Person { 1 id: uuid }",
    "model R { 1 owner: Person  2 backup: Person? }",
    "type Alias = Person",
  ].join("\n");
  const URI = "file:///x.schema";

  function refs(line: number, character: number, includeDeclaration: boolean) {
    const result = run(SRC);
    return references(SRC, { line, character }, result.schema, result.program, URI, includeDeclaration);
  }

  it("finds every usage plus the declaration", () => {
    const locs = refs(0, 8, true); // cursor on the Person declaration
    expect(locs).toHaveLength(4);
    const lines = locs.map(l => l.range.start.line).sort();
    expect(lines).toEqual([0, 1, 1, 2]);
    expect(locs.every(l => l.uri === URI)).toBe(true);
  });

  it("works when invoked from a usage too", () => {
    const fromUsage = refs(1, 21, true); // cursor on `Person` in `owner: Person`
    expect(fromUsage).toHaveLength(4);
  });

  it("excludes the declaration when includeDeclaration is false", () => {
    const locs = refs(0, 8, false);
    expect(locs).toHaveLength(3);
    expect(locs.some(l => l.range.start.line === 0)).toBe(false);
  });
});

describe("lsp completion", () => {
  it("offers scalars, keywords, and declared type names", () => {
    const src = "model Order { 1 id: uuid }";
    const result = run(src);
    const labels = completion(src, { line: 0, character: 20 }, result.schema).map(i => i.label);
    expect(labels).toContain("string");
    expect(labels).toContain("model");
    expect(labels).toContain("Order");
  });

  it("offers decorators after an @", () => {
    const src = "@\nmodel R { 1 id: uuid }";
    const labels = completion(src, { line: 0, character: 1 }, null).map(i => i.label);
    expect(labels).toContain("minValue");
    expect(labels).toContain("references");
    expect(labels).not.toContain("string");
  });

  it("offers known argument values inside a decorator's parentheses", () => {
    const src = "@compatibility()\nmodel R { 1 id: uuid }";
    const labels = completion(src, { line: 0, character: 15 }, null).map(i => i.label);
    expect(labels).toEqual(["backward", "forward", "full", "none"]);
  });
});
