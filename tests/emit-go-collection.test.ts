// The go-collection target: the Go file an app imports to open a Neoworks collection with the Go
// SDK. The kitchen fixture holds a field of every kind; its output is pinned by a golden file, is
// checked to be gofmt-clean, and is compiled and run against a stub of the SDK's collections package
// when the Go toolchain is installed.

import { afterAll, describe, expect, it } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter, listTargets } from "../src/emit";
import { pluralize } from "../src/emit/collection/pluralize";

const CLI = join(import.meta.dir, "..", "src", "cli", "index.ts");
const FIXTURES = join(import.meta.dir, "fixtures");
const KITCHEN_SCHEMA = join(FIXTURES, "go-collection", "kitchen.schema");
const KITCHEN_GOLDEN = join(FIXTURES, "go-collection", "kitchen.go.golden");
const KITCHEN_ROUNDTRIP_TEST = join(FIXTURES, "go-collection", "kitchen_roundtrip_test.go");
const SDK_STUB = join(FIXTURES, "go-sdk-stub");
const SCHEMAS_DIRECTORY = join(import.meta.dir, "..", "..", "schemas");
const DRIFT_SCHEMA = "/home/moritz/Documents/neoworks/drift/.worktrees/23-neoworks-tables/core/neoworks/schema/drift/drift.schema";
const OPTIONS = { collection: "@acme/kitchen", collectionVersion: "1.2.0" };

const hasGofmt = Bun.which("gofmt") !== null;
const hasGo = Bun.which("go") !== null;

const workspaces: string[] = [];

afterAll(() => {
  for (const directory of workspaces) rmSync(directory, { recursive: true, force: true });
});

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "openschema-go-collection-"));
  workspaces.push(directory);
  return directory;
}

function emitSource(src: string, options: Record<string, string> = OPTIONS): string {
  const schema = resolve(parse(src));
  const files = getEmitter("go-collection")!.emit({ schema, company: null, includePrivate: false, options });
  expect(files.length).toBe(1);
  return files[0].contents;
}

const KITCHEN = readFileSync(KITCHEN_SCHEMA, "utf8");

function kitchenOutput(): string {
  return emitSource(KITCHEN);
}

function gofmtOutput(source: string): string {
  const child = Bun.spawnSync({ cmd: ["gofmt"], stdin: new TextEncoder().encode(source) });
  expect(child.stderr.toString()).toBe("");
  return child.stdout.toString();
}

function runGo(args: string[], cwd: string): { exitCode: number; output: string } {
  const child = Bun.spawnSync({ cmd: ["go", ...args], cwd, env: { ...process.env, GOWORK: "off", GOFLAGS: "-mod=mod" } });
  return { exitCode: child.exitCode ?? 1, output: child.stdout.toString() + child.stderr.toString() };
}

function runCli(args: string[], cwd: string): { exitCode: number; output: string } {
  const child = Bun.spawnSync({ cmd: ["bun", "run", CLI, ...args], cwd, env: { ...process.env, CI: "" } });
  return { exitCode: child.exitCode ?? 1, output: child.stdout.toString() + child.stderr.toString() };
}

/** A module that is the stub of the SDK with `source` as the package `pkg`, plus extra files for it. */
function goModuleWith(source: string, packageFiles: Record<string, string> = {}): string {
  const directory = workspace();
  cpSync(SDK_STUB, directory, { recursive: true });
  mkdirSync(join(directory, "pkg"));
  writeFileSync(join(directory, "pkg", "generated.go"), source);
  for (const [name, contents] of Object.entries(packageFiles)) {
    writeFileSync(join(directory, "pkg", name), contents);
  }
  return directory;
}

describe("the go-collection target", () => {
  it("is registered", () => {
    expect(listTargets()).toContain("go-collection");
  });

  it("writes one file named after the package", () => {
    const schema = resolve(parse(KITCHEN));
    const files = getEmitter("go-collection")!.emit({ schema, company: null, includePrivate: false, options: OPTIONS });
    expect(files.map(file => file.path)).toEqual(["kitchen.go"]);
  });

  it("matches the golden file", () => {
    const output = kitchenOutput();
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(KITCHEN_GOLDEN, output);
    expect(output).toBe(readFileSync(KITCHEN_GOLDEN, "utf8"));
  });

  it.skipIf(!hasGofmt)("writes gofmt-clean code", () => {
    const output = kitchenOutput();
    expect(gofmtOutput(output)).toBe(output);
  });

  it.skipIf(!hasGo)("compiles against the SDK's collections package and reads and writes the core's content JSON", () => {
    const directory = goModuleWith(kitchenOutput(), {
      "kitchen_roundtrip_test.go": readFileSync(KITCHEN_ROUNDTRIP_TEST, "utf8"),
    });
    const result = runGo(["test", "./..."], directory);
    expect(result.output).toContain("ok");
    expect(result.exitCode).toBe(0);
  });
});

describe("go-collection output", () => {
  const SMALL = `namespace acme.notes
/// A note.
@neoworks.table
model Note {
  @belongsTo
  1 folder: ref<Folder>
  2 title: string
  3 body: string?
  4 createdAt: timestamp
}
@neoworks.table
model Folder {
  1 name: string
}
@neoworks.table
model Category {
  1 label: string
}`;
  const output = emitSource(SMALL, { collection: "@acme/notes", collectionVersion: "0.3.0" });

  it("names the package after the collection and declares its identity and scopes", () => {
    expect(output).toContain("package notes\n");
    expect(output).toContain('\tCollection    = "@acme/notes"\n\tSchemaVersion = "0.3.0"\n');
    expect(output).toContain('var Scopes = []string{\n\t"@acme/notes:read",\n\t"@acme/notes:write",\n}');
  });

  it("holds the descriptor the registry publishes", () => {
    expect(output).toContain('\tDescriptor: []byte(`{\n  "descriptorVersion": 2,');
  });

  it("writes a struct per model with json tags, pointers for optional fields and row ids for references", () => {
    expect(output).toContain(
      "// A note.\ntype Note struct {\n" +
      '\tFolder    string    `json:"folder"`\n' +
      '\tTitle     string    `json:"title"`\n' +
      '\tBody      *string   `json:"body,omitempty"`\n' +
      '\tCreatedAt time.Time `json:"createdAt"`\n' +
      "}",
    );
  });

  it("writes a field handle value per table", () => {
    expect(output).toContain("var NoteFields = newNoteFieldHandles()");
    expect(output).toContain(
      "type NoteFieldHandles struct {\n" +
      "\tFolder    collections.RefField\n" +
      "\tTitle     collections.StringField\n" +
      "\tBody      collections.StringField\n" +
      "\tCreatedAt collections.TimeField\n" +
      "}",
    );
    expect(output).toContain('\t\tTitle:     collections.NewStringField(collections.Child(path, "title")...),');
  });

  it("opens one table per model, named like the TypeScript SDK names its resources, with the target of each reference", () => {
    expect(output).toContain("type Tables struct {\n\tNotes      *collections.Table[Note]\n\tFolders    *collections.Table[Folder]\n\tCategories *collections.Table[Category]\n}");
    expect(output).toContain("func Open(v *vault.Vault, options ...collections.Option) (*Tables, error) {");
    expect(output).toContain('collections.NewTable[Note](collection, collections.TableDefinition{Model: "Note", References: map[string]string{"folder": "Folder"}})');
    expect(output).toContain('collections.NewTable[Folder](collection, collections.TableDefinition{Model: "Folder"})');
  });

  it("imports only the packages it uses", () => {
    expect(output).toContain('import (\n\t"time"\n\n\t"github.com/neoworks-dev/sdk-go/collections"\n\t"github.com/neoworks-dev/sdk-go/vault"\n)');
    expect(output).not.toContain("encoding/json");
  });
});

describe("go-collection value types", () => {
  const output = kitchenOutput();

  it("holds 64-bit integers and durations as decimal text through the string tag option", () => {
    expect(output).toContain('`json:"views,string"`');
    expect(output).toContain('*uint64       `json:"totalViews,omitempty,string"`');
    expect(output).toContain("time.Duration `json:\"cookTime,string\"`");
  });

  it("uses the SDK's text types inside lists, maps and oneofs, where a tag cannot reach", () => {
    expect(output).toContain("[]collections.Int64");
    expect(output).toContain("map[string]collections.Int64");
    expect(output).toContain("Count  *collections.Int64");
  });

  it("keeps a list of u8 from becoming base64 text", () => {
    expect(output).toContain("[]collections.Uint8");
  });

  it("holds bytes as the SDK's base64url type and json as raw JSON", () => {
    expect(output).toContain("PhotoData   collections.Bytes");
    expect(output).toContain("Thumbnail   *collections.Bytes");
    expect(output).toContain("Extra       json.RawMessage");
    expect(output).toContain('Annotations json.RawMessage              `json:"annotations,omitempty"`');
  });

  it("holds dates, times, uuids, decimals and semvers as text", () => {
    expect(output).toMatch(/Day\s+string\s+`json:"day"`/);
    expect(output).toMatch(/StartsAt\s+\*string/);
    expect(output).toMatch(/Token\s+string/);
    expect(output).toMatch(/Price\s+string/);
    expect(output).toMatch(/Version\s+string/);
  });

  it("writes JSON map keys as integers or as text, and bool keys as their text", () => {
    expect(output).toContain("map[int32]string");
    expect(output).toMatch(/Flags\s+map\[string\]string/);
  });

  it("omits an empty list that is not optional, and writes an unset optional list as null", () => {
    expect(output).toMatch(/Tags\s+\[\]string\s+`json:"tags,omitempty"`/);
    expect(output).toMatch(/Allergens\s+\[\]string\s+`json:"allergens"`/);
  });

  it("declares enums as named strings with a constant per variant", () => {
    expect(output).toContain('type Difficulty string\n\nconst (\n\tDifficultyEasy Difficulty = "easy"\n\tDifficultyHard Difficulty = "hard"\n)');
  });

  it("holds a oneof as a struct with a pointer per variant that reads and writes the single-key object", () => {
    expect(output).toContain("type RecipeSource struct {");
    expect(output).toContain("func (value RecipeSource) MarshalJSON() ([]byte, error) {");
    expect(output).toContain("func (value *RecipeSource) UnmarshalJSON(data []byte) error {");
    expect(output).toContain("type RecipeReminderWhen struct {");
  });

  it("copies doc comments of models, fields and enums", () => {
    expect(output).toContain("// A recipe with one field of every kind the Go target maps.\ntype Recipe struct {");
    expect(output).toContain("\t// When it was last cooked.\n");
  });
});

describe("go-collection field handles", () => {
  const output = kitchenOutput();

  it("gives each kind of field its handle", () => {
    expect(output).toContain("Servings    collections.NumberField[int32]");
    expect(output).toContain("CookTime    collections.NumberField[time.Duration]");
    expect(output).toContain("CookedAt    collections.TimeField");
    expect(output).toContain("Favourite   collections.BoolField");
    expect(output).toContain("Difficulty  collections.EnumField[Difficulty]");
    expect(output).toContain("Pantry      collections.RefField");
    expect(output).toContain("PhotoData   collections.BytesField");
    expect(output).toContain("Cover       collections.FileField");
  });

  it("filters lists and maps through the handle of one element", () => {
    expect(output).toContain("Tags        collections.ListField[[]string, collections.StringField]");
    expect(output).toContain("Counts      collections.ListField[[]collections.Int64, collections.NumberField[int64]]");
    expect(output).toContain("Nutrition   collections.ListField[map[string]float64, collections.NumberField[float64]]");
    expect(output).toContain("Steps       collections.ListField[[]Step, StepFieldHandles]");
    expect(output).toContain("Gallery     collections.ListField[[]collections.File, collections.FileField]");
  });

  it("only sets and clears fields that queries cannot filter on", () => {
    expect(output).toContain("Extra       collections.ValueField[json.RawMessage]");
    expect(output).toContain("Blobs       collections.ValueField[[]collections.Bytes]");
    expect(output).toContain("Reminder    collections.ValueField[RecipeReminder]");
  });

  it("nests the handles of an embedded message and lets them set and clear the whole message", () => {
    expect(output).toContain("Author      AuthorFieldHandles");
    expect(output).toContain("type AuthorFieldHandles struct {\n\tcollections.MessageField[Author]\n");
    expect(output).toContain('Website:      collections.NewStringField(collections.Child(path, "website")...),');
  });

  it("builds the handles of a message that contains itself on demand", () => {
    expect(output).toContain("func (handles SectionFieldHandles) Child() SectionFieldHandles {");
    expect(output).toContain('return newSectionFieldHandles(collections.Child(handles.path, "child")...)');
  });
});

describe("go-collection options and errors", () => {
  const SIMPLE = "namespace t\n@neoworks.table\nmodel Note {\n  1 title: string\n}";

  it("adds the share scope on request", () => {
    const output = emitSource(SIMPLE, { ...OPTIONS, share: "true" });
    expect(output).toContain('\t"@acme/kitchen:share",\n');
    expect(emitSource(SIMPLE)).not.toContain(":share");
  });

  it("honours an explicit package", () => {
    const schema = resolve(parse(SIMPLE));
    const files = getEmitter("go-collection")!.emit({ schema, company: null, includePrivate: false, options: { ...OPTIONS, package: "notes" } });
    expect(files[0].path).toBe("notes.go");
    expect(files[0].contents).toContain("package notes\n");
  });

  it("refuses a package name Go cannot use", () => {
    expect(() => emitSource(SIMPLE, { ...OPTIONS, package: "func" })).toThrow("package name");
    expect(() => emitSource(SIMPLE, { collection: "@acme/3d", collectionVersion: "1.0.0" })).toThrow("package name");
  });

  it("needs the collection's identity", () => {
    expect(() => emitSource(SIMPLE, {})).toThrow("registry path and version");
  });

  it("needs tables", () => {
    expect(() => emitSource("namespace t\nmodel Plain {\n  1 a: string\n}")).toThrow("@neoworks.table");
  });

  it("refuses two tables that become the same field", () => {
    const src = "namespace t\n@neoworks.table\nmodel Box {\n  1 a: string\n}\n@neoworks.table\nmodel Boxe {\n  1 a: string\n}";
    expect(() => emitSource(src)).toThrow("Boxes");
  });

  it("refuses a model that takes a name the file declares itself", () => {
    expect(() => emitSource("namespace t\n@neoworks.table\nmodel Tables {\n  1 a: string\n}")).toThrow("Tables");
    expect(() => emitSource("namespace t\n@neoworks.table\nmodel Note {\n  1 a: string\n}\nmodel NoteFieldHandles {\n  1 a: string\n}")).toThrow("NoteFieldHandles");
  });

  it("refuses a field of an embedded message that would hide the message's own Set", () => {
    const src = "namespace t\n@neoworks.table\nmodel Note {\n  1 card: Card\n}\nmodel Card {\n  1 set: string\n}";
    expect(() => emitSource(src)).toThrow("Card.set");
  });

  it("is not applied by the go target, which keeps writing plain structs", () => {
    const schema = resolve(parse(SIMPLE));
    const files = getEmitter("go")!.emit({ schema, company: null, includePrivate: false, options: {} });
    expect(files[0].contents).not.toContain("collections");
  });
});

describe("pluralize", () => {
  it("forms table names the way the TypeScript SDK does", () => {
    expect(pluralize("photo")).toBe("photos");
    expect(pluralize("albumPhoto")).toBe("albumPhotos");
    expect(pluralize("memory")).toBe("memories");
    expect(pluralize("day")).toBe("days");
    expect(pluralize("address")).toBe("addresses");
    expect(pluralize("batch")).toBe("batches");
  });
});

describe("go-collection on the real schemas", () => {
  function generate(schemaPath: string): string {
    const directory = workspace();
    const result = runCli([schemaPath, "-t", "go-collection", "-o", directory, "--no-lock"], directory);
    expect(result.output).not.toContain("error");
    expect(result.exitCode).toBe(0);
    const generated = join(directory, `${schemaPath.split("/").pop()!.replace(".schema", "")}.go`);
    return readFileSync(generated, "utf8");
  }

  function checkGenerated(source: string): void {
    if (hasGofmt) expect(gofmtOutput(source)).toBe(source);
    if (!hasGo) return;
    const result = runGo(["vet", "./..."], goModuleWith(source));
    expect(result.output).toBe("");
    expect(result.exitCode).toBe(0);
  }

  it.skipIf(!existsSync(join(SCHEMAS_DIRECTORY, "calendar", "calendar.schema")))("generates the @neoworks/calendar collection", () => {
    const source = generate(join(SCHEMAS_DIRECTORY, "calendar", "calendar.schema"));
    expect(source).toContain("package calendar\n");
    checkGenerated(source);
  });

  it.skipIf(!existsSync(join(SCHEMAS_DIRECTORY, "photos", "photos.schema")))("generates the @neoworks/photos collection, which uses a dependency's models", () => {
    checkGenerated(generate(join(SCHEMAS_DIRECTORY, "photos", "photos.schema")));
  });

  it.skipIf(!existsSync(DRIFT_SCHEMA))("generates Drift's collection", () => {
    const source = generate(DRIFT_SCHEMA);
    expect(source).toContain("package drift\n");
    expect(source).toContain("Playlists  *collections.Table[Playlist]");
    checkGenerated(source);
  });
});
