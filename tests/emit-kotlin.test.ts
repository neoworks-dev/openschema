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
import { pluralize } from "../src/emit/kotlin/kotlinCollection";

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

  it("writes models, query classes, update classes, row accessors, the schema object and the collection class as a source root", () => {
    const files = emitFiles(RECIPES, OPTIONS);
    expect([...files.keys()]).toEqual([
      `${PACKAGE_DIRECTORY}/Models.kt`,
      `${PACKAGE_DIRECTORY}/Queries.kt`,
      `${PACKAGE_DIRECTORY}/Updates.kt`,
      `${PACKAGE_DIRECTORY}/RowAccessors.kt`,
      `${PACKAGE_DIRECTORY}/RecipesSchema.kt`,
      `${PACKAGE_DIRECTORY}/RecipesCollection.kt`,
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

  it("renames enum constants that clash with the members of a Kotlin enum, keeping the wire name", () => {
    const models = emitModels("namespace t\nenum Part {\n  1 name\n  2 ordinal\n  3 plain\n}");
    expect(models).toContain('    @kotlinx.serialization.SerialName("name") nameValue,');
    expect(models).toContain('    @kotlinx.serialization.SerialName("ordinal") ordinalValue,');
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
    expect(schemaObject).toContain("object RecipesSchema : CollectionSchema<RecipesCollection> {");
    expect(schemaObject).toContain('override val name: String = "@acme/recipes"');
    expect(schemaObject).toContain('override val version: String = "0.1.0"');
    expect(schemaObject).toContain(`override val descriptor: String = ${kotlinString(descriptor)}`);
  });

  it("declares a table definition per table with its serializer, query scopes and single references", () => {
    expect(schemaObject).toContain(
      'val recipeTable = TableDefinition(\n' +
      '        model = "Recipe",\n' +
      '        serializer = serializer<Recipe>(),\n' +
      '        createWhere = ::RecipeWhere,\n' +
      '        createOrderBy = ::RecipeOrderBy,\n' +
      '        createInclude = ::RecipeInclude,\n' +
      '        createUpdate = ::RecipeUpdate,\n' +
      '        references = mapOf("book" to "Book"),\n' +
      '    )',
    );
    expect(schemaObject).toContain("references = emptyMap(),");
    expect(schemaObject).toContain("override val tables: List<TableDefinition<*, *, *, *, *>> = listOf(bookTable, recipeTable)");
    expect(schemaObject).toContain("override fun open(tables: CollectionTables): RecipesCollection = RecipesCollection(tables)");
  });

  it("is written for a schema with tables only", () => {
    const plain = emitFiles("namespace t\nmodel Plain {\n  1 id: uuid\n}", OPTIONS);
    expect([...plain.keys()].some(path => path.endsWith("Schema.kt"))).toBe(false);
  });
});

describe("kotlin runtime", () => {
  it("imports the shared runtime from the SDK and writes none of its own", () => {
    const files = emitFiles(RECIPES, OPTIONS);
    expect([...files.keys()].some(path => path.endsWith("Runtime.kt"))).toBe(false);
    expect(emitModels(RECIPES, OPTIONS)).toContain("import dev.neoworks.sdk.schema.TimestampSerializer\n");
  });

  it("refuses a type named like anything a generated file imports", () => {
    expect(() => emitFiles("namespace t\n@neoworks.table\nmodel Where {\n  1 a: string\n}", OPTIONS)).toThrow("Where");
    expect(() => emitFiles("namespace t\nmodel Row {\n  1 a: string\n}")).toThrow("Row");
  });
});

describe("kotlin query classes", () => {
  const SRC = `namespace t
@neoworks.table
model Item {
  1 flag: bool
  2 title: string
  3 count: i32
  4 big: i64?
  5 at: timestamp
  6 level: Level
  7 levels: [Level]
  8 tags: [string]
  9 lines: [Line]
  10 picture: File?
  11 files: [File]
  12 data: bytes?
  13 extra: json?
  14 attributes: {string: string}?
  15 note: Line?
  @belongsTo
  16 parent: ref<Item>?
}
model Line {
  1 text: string
  2 inner: [string]
  3 level: Level?
  4 file: File?
}
enum Level {
  1 low
  2 high
}`;
  const files = emitFiles(SRC);
  const queries = files.get("kotlin/t/Queries.kt")!;

  it("gives a table a field handle for every type a query can filter on", () => {
    expect(queries).toContain("class ItemWhere : Where<ItemWhere>() {");
    expect(queries).toContain('    val flag = BooleanField(operatorsOf("flag"))');
    expect(queries).toContain('    val title = TextField(operatorsOf("title"))');
    expect(queries).toContain('    val count = ComparableField(operatorsOf("count"), serializer<Int>())');
    expect(queries).toContain('    val big = ComparableField(operatorsOf("big"), Int64AsTextSerializer)');
    expect(queries).toContain('    val at = ComparableField(operatorsOf("at"), TimestampSerializer)');
    expect(queries).toContain('    val level = EnumField(operatorsOf("level"), serializer<Level>())');
    expect(queries).toContain('    val parent = ReferenceField(operatorsOf("parent"))');
    expect(queries).toContain('    val picture = FileField(operatorsOf("picture"))');
  });

  it("gives lists the handle for their element type", () => {
    expect(queries).toContain('    val tags = ValueListField(operatorsOf("tags"), serializer<String>()) { TextField(it) }');
    expect(queries).toContain('    val levels = ValueListField(operatorsOf("levels"), serializer<Level>()) { EnumField(it, serializer<Level>()) }');
    expect(queries).toContain('    val lines = MessageListField(operatorsOf("lines"), ::LineWhere)');
    expect(queries).toContain('    val files = FileListField(operatorsOf("files"))');
  });

  it("leaves out what a query cannot filter on", () => {
    for (const name of ["data", "extra"]) {
      expect(queries).not.toContain(`val ${name} = `);
    }
  });

  it("filters an embedded message through a nested where class", () => {
    expect(queries).toContain('    val note = MessageField(operatorsOf("note"), ::LineWhere)');
  });

  it("gives a map the handle for its value type, like a list", () => {
    expect(queries).toContain('    val attributes = ValueListField(operatorsOf("attributes"), serializer<String>()) { TextField(it) }');
  });

  it("filters the values of lists and maps of messages by every field they can filter on", () => {
    const lineWhere = queries.slice(queries.indexOf("class LineWhere"), queries.indexOf("class LineSortFields"));
    expect(lineWhere).toContain('    val text = TextField(operatorsOf("text"))');
    expect(lineWhere).toContain('    val level = EnumField(operatorsOf("level"), serializer<Level>())');
    expect(lineWhere).toContain('    val inner = ValueListField(operatorsOf("inner"), serializer<String>()) { TextField(it) }');
    expect(lineWhere).toContain('    val file = FileField(operatorsOf("file"))');
  });

  it("sorts by scalars, enums, references and the members of a File", () => {
    const orderBy = queries.slice(queries.indexOf("class ItemOrderBy"), queries.indexOf("class ItemInclude"));
    expect(orderBy).toContain('    val title = sortField("title")');
    expect(orderBy).toContain('    val level = sortField("level")');
    expect(orderBy).toContain('    val parent = sortField("parent")');
    expect(orderBy).toContain('    val picture = fileSortFields("picture")');
    for (const name of ["tags", "lines", "files", "data", "attributes"]) {
      expect(orderBy).not.toContain(`val ${name} = `);
    }
  });

  it("sorts through singular messages with a sort fields class per message", () => {
    const orderBy = queries.slice(queries.indexOf("class ItemOrderBy"), queries.indexOf("class ItemInclude"));
    expect(orderBy).toContain('    val note: LineSortFields\n        get() = sortFields("note", ::LineSortFields)');
    const lineSortFields = queries.slice(queries.indexOf("class LineSortFields"));
    expect(lineSortFields).toContain("class LineSortFields(scope: SortScope) : SortFields(scope) {");
    expect(lineSortFields).toContain('    val text = sortField("text")');
    expect(lineSortFields).toContain('    val file = fileSortFields("file")');
    expect(lineSortFields).not.toContain("val inner");
  });

  it("includes single references by naming them", () => {
    expect(queries).toContain('class ItemInclude : Include() {\n    val parent: Unit\n        get() = include("parent")\n}');
    expect(queries).toContain("class LineWhere : Where<LineWhere>() {");
    expect(queries).not.toContain("class LineInclude");
  });

  describe("nested messages", () => {
    const nested = emitFiles(`namespace t
@neoworks.table
model Contact {
  1 card: Card?
}
model Card {
  1 name: Name?
  2 emails: {string: Email}
  3 nicknames: {string: string}
  4 photo: File?
  5 parent: Card?
}
model Name {
  1 full: string?
  2 given: string?
}
model Email {
  1 address: string
  2 labels: [string]
  3 owner: Name?
}`).get("kotlin/t/Queries.kt")!;

    it("generates a where class for every message at any depth", () => {
      for (const className of ["Card", "Name", "Email"]) {
        expect(nested).toContain(`class ${className}Where : Where<${className}Where>() {`);
      }
      expect(nested).toContain('    val card = MessageField(operatorsOf("card"), ::CardWhere)');
      expect(nested).toContain('    val name = MessageField(operatorsOf("name"), ::NameWhere)');
    });

    it("gives maps of messages some, every and none, and the values their own nested fields", () => {
      expect(nested).toContain('    val emails = MessageListField(operatorsOf("emails"), ::EmailWhere)');
      expect(nested).toContain('    val owner = MessageField(operatorsOf("owner"), ::NameWhere)');
      expect(nested).toContain('    val labels = ValueListField(operatorsOf("labels"), serializer<String>()) { TextField(it) }');
    });

    it("gives maps of plain values the value handle, which has has", () => {
      expect(nested).toContain('    val nicknames = ValueListField(operatorsOf("nicknames"), serializer<String>()) { TextField(it) }');
    });

    it("sorts through messages that contain themselves without building them eagerly", () => {
      expect(nested).toContain('class ContactOrderBy : OrderBy() {\n    val card: CardSortFields\n        get() = sortFields("card", ::CardSortFields)\n}');
      expect(nested).toContain('    val parent: CardSortFields\n        get() = sortFields("parent", ::CardSortFields)');
      expect(nested).toContain('    val photo = fileSortFields("photo")');
    });

    it("does not sort through lists or maps", () => {
      expect(nested).not.toContain("class EmailSortFields");
    });
  });

  it("writes no query classes for a schema without tables", () => {
    const plain = emitFiles("namespace t\nmodel Plain {\n  1 id: uuid\n}");
    expect([...plain.keys()]).toEqual(["kotlin/t/Models.kt"]);
  });

  it("refuses a field that would hide a member of the query classes", () => {
    const src = "namespace t\n@neoworks.table\nmodel Item {\n  1 meta: string\n}";
    expect(() => emitFiles(src)).toThrow("Item.meta");
  });

  it("refuses a field of an embedded message that would hide a member of its query classes", () => {
    const src = "namespace t\n@neoworks.table\nmodel Item {\n  1 card: Card\n}\nmodel Card {\n  1 sortFields: string\n}";
    expect(() => emitFiles(src)).toThrow("Card.sortFields");
  });

  it("refuses a message model whose sort fields class is named like another type", () => {
    const src = "namespace t\n@neoworks.table\nmodel Item {\n  1 card: Card\n}\nmodel Card {\n  1 name: string\n}\nmodel CardSortFields {\n  1 a: string\n}";
    expect(() => emitFiles(src)).toThrow("CardSortFields");
  });
});

describe("kotlin row accessors", () => {
  it("adds an accessor per single reference, named after the table in the JVM", () => {
    const accessors = emitFiles(RECIPES, OPTIONS).get(`${PACKAGE_DIRECTORY}/RowAccessors.kt`)!;
    expect(accessors).toContain('@get:JvmName("recipeBook")\nval Row<Recipe>.book: Row<Book>?\n    get() = included<Book>("book")');
  });

  it("writes none for a schema without references", () => {
    const src = "namespace t\n@neoworks.table\nmodel Item {\n  1 title: string\n}";
    expect([...emitFiles(src).keys()].some(path => path.endsWith("RowAccessors.kt"))).toBe(false);
  });

  it("refuses a reference that a member of Row would hide", () => {
    const src = "namespace t\n@neoworks.table\nmodel Parent {\n  1 a: string\n}\n@neoworks.table\nmodel Child {\n  @belongsTo\n  1 id: ref<Parent>\n}";
    expect(() => emitFiles(src)).toThrow("Child.id");
  });
});

describe("kotlin update classes", () => {
  const updates = emitFiles(RECIPES, OPTIONS).get(`${PACKAGE_DIRECTORY}/Updates.kt`)!;

  it("declares a recording property per field, nullable exactly when the field is optional", () => {
    expect(updates).toContain("class RecipeUpdate : Update() {");
    expect(updates).toContain('var title: String by updateField("title", serializer<String>())');
    expect(updates).toContain('var tags: List<String>? by updateField("tags", ListSerializer(serializer<String>()).nullable)');
    expect(updates).toContain('var nutrition: Map<String, Double>? by updateField("nutrition", MapSerializer(serializer<String>(), serializer<Double>()).nullable)');
    expect(updates).toContain('var cookedAt: Instant? by updateField("cookedAt", TimestampSerializer.nullable)');
    expect(updates).toContain('var difficulty: Difficulty? by updateField("difficulty", serializer<Difficulty>().nullable)');
  });

  it("refuses a field that would call itself instead of the SDK's update function", () => {
    const src = "namespace t\n@neoworks.table\nmodel Item {\n  1 updateField: string\n}";
    expect(() => emitFiles(src)).toThrow("Item.updateField");
  });
});

describe("kotlin collection class", () => {
  const collection = emitFiles(RECIPES, OPTIONS).get(`${PACKAGE_DIRECTORY}/RecipesCollection.kt`)!;

  it("has a resource property per table, named in the plural as the TypeScript SDK names its resources", () => {
    expect(collection).toContain("class RecipesCollection internal constructor(tables: CollectionTables) {");
    expect(collection).toContain("val books: TableResource<Book, BookWhere, BookOrderBy, BookInclude, BookUpdate> = tables.table(RecipesSchema.bookTable)");
    expect(collection).toContain("val recipes: TableResource<Recipe, RecipeWhere, RecipeOrderBy, RecipeInclude, RecipeUpdate> = tables.table(RecipesSchema.recipeTable)");
  });

  it("pluralizes like the TypeScript SDK", () => {
    expect(pluralize("memory")).toBe("memories");
    expect(pluralize("address")).toBe("addresses");
    expect(pluralize("albumPhoto")).toBe("albumPhotos");
    expect(pluralize("day")).toBe("days");
    expect(pluralize("box")).toBe("boxes");
    expect(pluralize("dish")).toBe("dishes");
    expect(pluralize("church")).toBe("churches");
  });

  it("refuses two tables that become the same property", () => {
    const src = "namespace t\n@neoworks.table\nmodel Box {\n  1 a: string\n}\n@neoworks.table\nmodel Boxe {\n  1 a: string\n}";
    expect(() => emitFiles(src, OPTIONS)).toThrow("boxes");
  });

  it("is not written without a collection", () => {
    expect([...emitFiles(RECIPES).keys()].some(path => path.endsWith("Collection.kt"))).toBe(false);
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
    expect(readFileSync(schemaObject, "utf8")).toContain('override val name: String = "@acme/recipes"');
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
