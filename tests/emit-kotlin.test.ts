// The kotlin target: @Serializable classes in the descriptor's JSON mapping, laid out as a
// Gradle source root, and the schema object the Kotlin SDK takes for a collection.

import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parse } from "../src/index";
import { resolve } from "../src/resolver";
import { getEmitter, listTargets } from "../src/emit";
import { kotlinString } from "../src/emit/kotlin/kotlinSchemaObject";

const PACKAGE_DIRECTORY = "kotlin/dev/neoworks/schemas/recipes";
const OPTIONS = { collection: "@acme/recipes", collectionVersion: "0.1.0" };

function emitFiles(src: string, options: Record<string, string> = {}): Map<string, string> {
  const schema = resolve(parse(src));
  const files = getEmitter("kotlin")!.emit({ schema, company: null, includePrivate: false, options });
  return new Map(files.map(file => [file.path, file.contents]));
}

function emitModels(src: string, options: Record<string, string> = {}): string {
  const files = emitFiles(src, options);
  const models = [...files].find(([path]) => path.endsWith("/Models.kt"));
  return models![1];
}

const RECIPES = `namespace acme.recipes
@neoworks.table
model Book {
  1 name: string
}
@neoworks.table
model Recipe {
  @belongsTo
  1 book: ref<Book>
  2 title: string
  3 steps: [string]
  4 tags: [string]?
  5 nutrition: {string: f64}?
  6 cookedAt: timestamp?
  7 difficulty: Difficulty?
}
enum Difficulty {
  1 easy
  2 hard
}`;

describe("the kotlin target", () => {
  it("is registered", () => {
    expect(listTargets()).toContain("kotlin");
  });

  it("writes models, the runtime and the schema object as a source root", () => {
    const files = emitFiles(RECIPES, OPTIONS);
    expect([...files.keys()]).toEqual([
      `${PACKAGE_DIRECTORY}/Models.kt`,
      `${PACKAGE_DIRECTORY}/Runtime.kt`,
      `${PACKAGE_DIRECTORY}/RecipesSchema.kt`,
    ]);
    expect(files.get(`${PACKAGE_DIRECTORY}/Models.kt`)).toContain("package dev.neoworks.schemas.recipes\n");
  });

  it("writes no schema object without a collection", () => {
    const files = emitFiles(RECIPES);
    expect([...files.keys()].some(path => path.endsWith("Schema.kt"))).toBe(false);
  });

  it("follows the namespace when no collection names the package, and honours an explicit package", () => {
    expect([...emitFiles(RECIPES).keys()][0]).toBe("kotlin/acme/recipes/Models.kt");
    expect([...emitFiles(RECIPES, { package: "com.example.cooking" }).keys()][0]).toBe("kotlin/com/example/cooking/Models.kt");
  });
});

describe("kotlin models", () => {
  const models = emitModels(RECIPES, OPTIONS);

  it("makes optional fields nullable with a null default", () => {
    expect(models).toContain("    val tags: List<String>? = null,");
    expect(models).toContain("    val nutrition: Map<String, Double>? = null,");
    expect(models).toContain("    val difficulty: Difficulty? = null,");
  });

  it("defaults a list that is not optional to an empty one and leaves required scalars without a default", () => {
    expect(models).toContain("    val steps: List<String> = emptyList(),");
    expect(models).toContain("    val title: String,");
  });

  it("holds a reference as the id of its row", () => {
    expect(models).toContain("    val book: String,");
  });

  it("writes enums by variant name", () => {
    expect(models).toContain("@Serializable\nenum class Difficulty {\n    easy,\n    hard,\n}");
  });

  it("selects serializers for the types whose JSON form is not the default", () => {
    expect(models).toContain("    val cookedAt: @Serializable(with = TimestampSerializer::class) Instant? = null,");
  });
});

describe("kotlin scalars", () => {
  const SRC = `namespace t
model Sink {
  1 big: i64
  2 unsigned: u64
  3 small: u8
  4 data: bytes
  5 id: uuid
  6 extra: json
  7 version: semver
  8 span: duration
  9 stamps: [timestamp]
  10 sizes: {string: u64}
  11 day: date
  12 amount: decimal(10, 2)
}`;
  const models = emitModels(SRC);

  it("writes 64-bit integers and durations as decimal text", () => {
    expect(models).toContain("    val big: @Serializable(with = Int64AsTextSerializer::class) Long,");
    expect(models).toContain("    val unsigned: @Serializable(with = UInt64AsTextSerializer::class) ULong,");
    expect(models).toContain("    val span: @Serializable(with = Int64AsTextSerializer::class) Long,");
  });

  it("maps the other scalars to their natural Kotlin types", () => {
    expect(models).toContain("    val small: UByte,");
    expect(models).toContain("    val id: String,");
    expect(models).toContain("    val extra: JsonElement,");
    expect(models).toContain("    val version: Semver,");
    expect(models).toContain("    val day: String,");
    expect(models).toContain("    val amount: String,");
  });

  it("writes bytes as base64url text", () => {
    expect(models).toContain("    val data: @Serializable(with = Base64UrlBytesSerializer::class) ByteArray,");
  });

  it("annotates the element type of lists and the value type of maps", () => {
    expect(models).toContain("    val stamps: List<@Serializable(with = TimestampSerializer::class) Instant> = emptyList(),");
    expect(models).toContain("    val sizes: Map<String, @Serializable(with = UInt64AsTextSerializer::class) ULong> = emptyMap(),");
  });
});

describe("kotlin identifiers", () => {
  it("quotes names that are Kotlin keywords", () => {
    const models = emitModels("namespace t\nmodel Mapping {\n  1 `in`: string?\n  2 `object`: Kind?\n}\nenum Kind {\n  1 `class`\n  2 plain\n}");
    expect(models).toContain("    val `in`: String? = null,");
    expect(models).toContain("    `class`,");
    expect(models).toContain("    plain,");
  });

  it("refuses two types of the same Kotlin name", () => {
    const src = "namespace t\nmodel Alert {\n  1 trigger: oneof {\n    1 a: string\n  }\n}\nmodel AlertTrigger {\n  1 a: string\n}";
    expect(() => emitFiles(src)).toThrow("AlertTrigger");
  });

  it("refuses a type the runtime file already declares", () => {
    expect(() => emitFiles("namespace t\nmodel Semver {\n  1 a: string\n}")).toThrow("Semver");
  });
});

describe("kotlin oneofs", () => {
  const SRC = `namespace t
model Alert {
  1 trigger: oneof {
    1 offset: Offset
    2 at: oneof {
      1 moment: timestamp
      2 count: i64
    }
  }
}
model Offset {
  1 text: string
}`;
  const models = emitModels(SRC);

  it("writes a sealed interface with a class per variant", () => {
    expect(models).toContain("    val trigger: AlertTrigger,");
    expect(models).toContain("@Serializable(with = AlertTriggerSerializer::class)\nsealed interface AlertTrigger {");
    expect(models).toContain("    data class Offset(val value: t.Offset) : AlertTrigger");
    expect(models).toContain("    data class At(val value: t.AlertTriggerAt) : AlertTrigger");
  });

  it("reads and writes the variant as a single-entry object", () => {
    expect(models).toContain("object AlertTriggerSerializer : OneofSerializer<AlertTrigger>(\"t.AlertTrigger\") {");
    expect(models).toContain("        is AlertTrigger.Offset -> \"offset\"");
    expect(models).toContain("        \"at\" -> AlertTrigger.At(json.decodeFromJsonElement(serializer<t.AlertTriggerAt>(), element))");
    expect(models).toContain("throw SerializationException(\"the oneof AlertTrigger has no variant \" + variantName)");
  });

  it("writes a oneof inside a variant as a type of its own, with the serializers of its scalars", () => {
    expect(models).toContain("sealed interface AlertTriggerAt {");
    expect(models).toContain("json.encodeToJsonElement(TimestampSerializer, value.value)");
    expect(models).toContain("json.decodeFromJsonElement(Int64AsTextSerializer, element)");
  });
});

describe("kotlin schema object", () => {
  const files = emitFiles(RECIPES, OPTIONS);
  const schemaObject = files.get(`${PACKAGE_DIRECTORY}/RecipesSchema.kt`)!;

  it("holds the name, the version and the descriptor the registry publishes", () => {
    const descriptor = getEmitter("descriptor")!.emit({ schema: resolve(parse(RECIPES)), company: null, includePrivate: false, options: {} })[0].contents;
    expect(schemaObject).toContain("object RecipesSchema {");
    expect(schemaObject).toContain('const val name: String = "@acme/recipes"');
    expect(schemaObject).toContain('const val version: String = "0.1.0"');
    expect(schemaObject).toContain(`val descriptor: String = ${kotlinString(descriptor)}`);
  });

  it("holds the serializer of each table and the target of each single reference", () => {
    expect(schemaObject).toContain('"Book" to serializer<Book>(),');
    expect(schemaObject).toContain('"Recipe" to serializer<Recipe>(),');
    expect(schemaObject).toContain('"Recipe" to mapOf("book" to "Book"),');
  });

  it("is written for a schema with tables only", () => {
    const plain = emitFiles("namespace t\nmodel Plain {\n  1 id: uuid\n}", OPTIONS);
    expect([...plain.keys()].some(path => path.endsWith("Schema.kt"))).toBe(false);
  });
});

describe("kotlinString", () => {
  it("escapes what a Kotlin string literal would read as something else", () => {
    expect(kotlinString('a"b\\c$d\ne\tf')).toBe('"a\\"b\\\\c\\$d\\ne\\tf"');
  });
});

describe("the kotlin target through the CLI", () => {
  const CLI = join(import.meta.dir, "..", "src", "cli", "index.ts");
  const workspace = mkdtempSync(join(tmpdir(), "openschema-kotlin-"));
  afterAll(() => rmSync(workspace, { recursive: true, force: true }));

  function generate(directory: string): { exitCode: number; output: string } {
    const cmd = ["bun", "run", CLI, "recipes.schema", "-t", "kotlin", "-o", "generated"];
    const child = Bun.spawnSync({ cmd, cwd: directory, env: { ...process.env, CI: "" } });
    return { exitCode: child.exitCode ?? 1, output: child.stdout.toString() + child.stderr.toString() };
  }

  it("takes the collection from the manifest and writes the files below the output directory", () => {
    const directory = join(workspace, "recipes");
    Bun.spawnSync({ cmd: ["bun", "run", CLI, "init", directory, "--scope", "acme", "--name", "recipes"] });
    writeFileSync(join(directory, "recipes.schema"), RECIPES);
    expect(generate(directory).exitCode).toBe(0);

    const schemaObject = join(directory, "generated", PACKAGE_DIRECTORY, "RecipesSchema.kt");
    expect(readFileSync(schemaObject, "utf8")).toContain('const val name: String = "@acme/recipes"');
  });

  it("writes the models alone when there is no manifest", () => {
    const directory = join(workspace, "no-manifest");
    mkdirSync(directory);
    writeFileSync(join(directory, "recipes.schema"), RECIPES);
    expect(generate(directory).exitCode).toBe(0);

    expect(existsSync(join(directory, "generated", "kotlin", "acme", "recipes", "Models.kt"))).toBe(true);
    expect(existsSync(join(directory, "generated", "kotlin", "acme", "recipes", "RecipesSchema.kt"))).toBe(false);
  });
});
