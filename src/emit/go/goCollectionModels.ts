// src/emit/go/goCollectionModels.ts
// The enums, structs and oneof types of a schema, as encoding/json reads and writes the core's
// content JSON.

import type { EnumDecl, ModelDecl } from "../../parser/ast.js";
import type { ResolvedSchema } from "../../resolver/types.js";
import type { ValueShape } from "../codec/plan.js";
import type { EnumDescriptor, FieldDescriptor, ModelDescriptor, SchemaDescriptor } from "../descriptor/descriptorTypes.js";
import {
  GoImports, JSON_IMPORT, fieldTag, fieldType, goFieldName, oneofTypeName, oneofVariantTypeName, valueType,
} from "./goCollectionTypes.js";
import { alignRows, docLines, exported } from "./goFormat.js";

type OneofShape = Extract<ValueShape, { kind: "oneof" }>;

interface OneofDeclaration {
  name:  string;
  shape: OneofShape;
}

/** Doc comments from the schema, by local name; the descriptor does not carry them. */
export interface SchemaDocs {
  models: Map<string, { doc: string | null; fields: Map<string, string | null> }>;
  enums:  Map<string, string | null>;
}

export function docsOf(schema: ResolvedSchema): SchemaDocs {
  const docs: SchemaDocs = { models: new Map(), enums: new Map() };
  for (const record of schema.records.values()) {
    const fields = new Map(record.fields.map(field => [field.name, field.doc] as const));
    docs.models.set(record.symbol.localName, { doc: (record.symbol.decl as ModelDecl).doc, fields });
  }
  for (const symbol of schema.enums.values()) {
    docs.enums.set(symbol.localName, (symbol.decl as EnumDecl).doc);
  }
  return docs;
}

export function modelsSource(descriptor: SchemaDescriptor, docs: SchemaDocs, imports: GoImports): string[] {
  const blocks = descriptor.enums.map(enumDescriptor => enumSource(enumDescriptor, docs));
  for (const model of descriptor.models) {
    blocks.push(structSource(model, docs, imports));
    for (const oneof of oneofsOf(model)) {
      blocks.push(oneofSource(oneof, imports));
    }
  }
  return blocks;
}

function enumSource(enumDescriptor: EnumDescriptor, docs: SchemaDocs): string {
  const constants = enumDescriptor.variants.map(variant => [
    `${enumDescriptor.name}${exported(variant.name)}`,
    `${enumDescriptor.name} = ${JSON.stringify(variant.name)}`,
  ]);
  const doc = docLines(docs.enums.get(enumDescriptor.name) ?? null, "");
  const lines = [...doc, `type ${enumDescriptor.name} string`, "", "const (", ...alignRows(constants).map(line => `\t${line}`), ")"];
  return lines.join("\n");
}

function structSource(model: ModelDescriptor, docs: SchemaDocs, imports: GoImports): string {
  const modelDocs = docs.models.get(model.name);
  const doc = docLines(modelDocs?.doc ?? null, "");
  if (model.fields.length === 0) return [...doc, `type ${model.name} struct{}`].join("\n");
  const body = fieldLines(model, modelDocs?.fields ?? new Map(), imports);
  return [...doc, `type ${model.name} struct {`, ...body, "}"].join("\n");
}

// gofmt aligns the columns of a run of field lines; a doc comment starts a new run.
function fieldLines(model: ModelDescriptor, fieldDocs: Map<string, string | null>, imports: GoImports): string[] {
  const lines: string[] = [];
  let run: string[][] = [];
  for (const field of model.fields) {
    const doc = docLines(fieldDocs.get(field.name) ?? null, "\t");
    if (doc.length > 0) {
      lines.push(...alignedRun(run));
      run = [];
      lines.push(...doc);
    }
    run.push(fieldCells(model.name, field, imports));
  }
  lines.push(...alignedRun(run));
  return lines;
}

function alignedRun(run: string[][]): string[] {
  return alignRows(run).map(line => `\t${line}`);
}

function fieldCells(modelName: string, field: FieldDescriptor, imports: GoImports): string[] {
  const type = fieldType(field, oneofTypeName(modelName, field.name), imports);
  return [goFieldName(modelName, field.name), type, fieldTag(field)];
}

/** The oneof of every field of a model, with those nested in a variant after the one that holds them. */
export function oneofsOf(model: ModelDescriptor): OneofDeclaration[] {
  const declarations: OneofDeclaration[] = [];
  for (const field of model.fields) {
    if (field.value.kind !== "oneof") continue;
    declarations.push(...withNestedOneofs(oneofTypeName(model.name, field.name), field.value));
  }
  return declarations;
}

function withNestedOneofs(name: string, shape: OneofShape): OneofDeclaration[] {
  const declarations: OneofDeclaration[] = [{ name, shape }];
  for (const variant of shape.variants) {
    if (variant.value.kind !== "oneof") continue;
    declarations.push(...withNestedOneofs(oneofVariantTypeName(name, variant.name), variant.value));
  }
  return declarations;
}

/** Every type name the models source declares, for collision checks. */
export function declaredTypeNames(descriptor: SchemaDescriptor): string[] {
  const names: string[] = [];
  for (const enumDescriptor of descriptor.enums) {
    names.push(enumDescriptor.name, ...enumDescriptor.variants.map(variant => `${enumDescriptor.name}${exported(variant.name)}`));
  }
  for (const model of descriptor.models) {
    names.push(model.name, ...oneofsOf(model).map(oneof => oneof.name));
  }
  return names;
}

// A oneof is the object `{ "<variant>": value }`; the struct holds one pointer per variant and
// writes whichever is set.
function oneofSource(oneof: OneofDeclaration, imports: GoImports): string {
  imports.add(JSON_IMPORT);
  imports.add("fmt");
  const variants = oneof.shape.variants.map(variant => [
    exported(variant.name),
    `*${valueType(variant.value, oneofVariantTypeName(oneof.name, variant.name), imports, false)}`,
  ]);
  const declaration = [
    `// ${oneof.name} holds exactly one of its variants.`,
    `type ${oneof.name} struct {`,
    ...alignRows(variants).map(line => `\t${line}`),
    "}",
  ];
  return [...declaration, "", ...marshalMethod(oneof), "", ...unmarshalMethod(oneof, imports)].join("\n");
}

function marshalMethod(oneof: OneofDeclaration): string[] {
  const cases = oneof.shape.variants.flatMap(variant => [
    `\tcase value.${exported(variant.name)} != nil:`,
    `\t\treturn json.Marshal(map[string]any{${JSON.stringify(variant.name)}: value.${exported(variant.name)}})`,
  ]);
  return [
    `func (value ${oneof.name}) MarshalJSON() ([]byte, error) {`,
    "\tswitch {",
    ...cases,
    "\t}",
    `\treturn nil, fmt.Errorf("${oneof.name}: no variant is set")`,
    "}",
  ];
}

function unmarshalMethod(oneof: OneofDeclaration, imports: GoImports): string[] {
  const cases = oneof.shape.variants.flatMap(variant => unmarshalCase(variant.name, variant.value, oneof, imports));
  return [
    `func (value *${oneof.name}) UnmarshalJSON(data []byte) error {`,
    "\tvar variants map[string]json.RawMessage",
    "\tif err := json.Unmarshal(data, &variants); err != nil {",
    "\t\treturn err",
    "\t}",
    "\tif len(variants) != 1 {",
    `\t\treturn fmt.Errorf("${oneof.name}: expected one variant, got %d", len(variants))`,
    "\t}",
    `\t*value = ${oneof.name}{}`,
    "\tfor name, raw := range variants {",
    "\t\tswitch name {",
    ...cases,
    "\t\t}",
    "\t}",
    `\treturn fmt.Errorf("${oneof.name}: unknown variant")`,
    "}",
  ];
}

function unmarshalCase(variantName: string, variantValue: ValueShape, oneof: OneofDeclaration, imports: GoImports): string[] {
  const field = exported(variantName);
  const type = valueType(variantValue, oneofVariantTypeName(oneof.name, variantName), imports, false);
  return [
    `\t\tcase ${JSON.stringify(variantName)}:`,
    `\t\t\tvalue.${field} = new(${type})`,
    `\t\t\treturn json.Unmarshal(raw, value.${field})`,
  ];
}
