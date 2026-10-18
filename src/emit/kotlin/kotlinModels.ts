// src/emit/kotlin/kotlinModels.ts
// The `@Serializable` enums, data classes and oneof types of a schema.

import type { ValueShape } from "../codec/plan.js";
import type { EnumDescriptor, FieldDescriptor, ModelDescriptor, SchemaDescriptor } from "../descriptor/descriptorTypes.js";
import { capitalize, identifier } from "./kotlinNames.js";
import {
  fieldDefault, fieldType, oneofTypeName, oneofVariantTypeName, plainValueType, valueSerializer, type TypeScope,
} from "./kotlinTypes.js";

type OneofShape = Extract<ValueShape, { kind: "oneof" }>;

interface OneofDeclaration {
  name:  string;
  shape: OneofShape;
}

export const MODELS_IMPORTS = [
  "kotlin.time.Instant",
  "kotlinx.serialization.Serializable",
  "kotlinx.serialization.SerializationException",
  "kotlinx.serialization.json.Json",
  "kotlinx.serialization.json.JsonElement",
  "kotlinx.serialization.serializer",
];

export function modelsSource(descriptor: SchemaDescriptor, packageName: string): string {
  const blocks = descriptor.enums.map(emitEnum);
  for (const model of descriptor.models) {
    blocks.push(emitModel(model));
    blocks.push(...oneofsOf(model).map(oneof => emitOneof(oneof, packageName)));
  }
  return blocks.join("\n\n");
}

function emitEnum(enumDescriptor: EnumDescriptor): string {
  const entries = enumDescriptor.variants.map(variant => `    ${identifier(variant.name)},`);
  return `@Serializable\nenum class ${enumDescriptor.name} {\n${entries.join("\n")}\n}`;
}

function emitModel(model: ModelDescriptor): string {
  if (model.fields.length === 0) return `@Serializable\nclass ${model.name}`;
  const parameters = model.fields.map(field => propertyLine(model.name, field));
  return `@Serializable\ndata class ${model.name}(\n${parameters.join("\n")}\n)`;
}

function propertyLine(modelName: string, field: FieldDescriptor): string {
  const oneofName = oneofTypeName(modelName, field.name);
  return `    val ${identifier(field.name)}: ${fieldType(field, oneofName)}${fieldDefault(field)},`;
}

/** The oneof of every field of a model, with those nested in a variant after the one that holds them. */
function oneofsOf(model: ModelDescriptor): OneofDeclaration[] {
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

function emitOneof(oneof: OneofDeclaration, packageName: string): string {
  const scope: TypeScope = { qualifier: `${packageName}.` };
  const variants = oneof.shape.variants.map(variant => variantClass(oneof, variant, scope));
  const declaration = `@Serializable(with = ${oneof.name}Serializer::class)\nsealed interface ${oneof.name} {\n${variants.join("\n")}\n}`;
  return `${declaration}\n\n${emitOneofSerializer(oneof, scope)}`;
}

function variantClass(oneof: OneofDeclaration, variant: OneofShape["variants"][number], scope: TypeScope): string {
  const valueName = oneofVariantTypeName(oneof.name, variant.name);
  const valueType = plainValueType(variant.value, valueName, scope);
  return `    data class ${capitalize(variant.name)}(val value: ${valueType}) : ${oneof.name}`;
}

function emitOneofSerializer(oneof: OneofDeclaration, scope: TypeScope): string {
  const { name, shape } = oneof;
  const variantNames = shape.variants.map(variant => `        is ${name}.${capitalize(variant.name)} -> ${JSON.stringify(variant.name)}`);
  const encoders = shape.variants.map(variant => `        is ${name}.${capitalize(variant.name)} -> json.encodeToJsonElement(${variantSerializer(oneof, variant, scope)}, value.value)`);
  const decoders = shape.variants.map(variant => `        ${JSON.stringify(variant.name)} -> ${name}.${capitalize(variant.name)}(json.decodeFromJsonElement(${variantSerializer(oneof, variant, scope)}, element))`);
  decoders.push(`        else -> throw SerializationException("the oneof ${name} has no variant " + variantName)`);
  return [
    `object ${name}Serializer : OneofSerializer<${name}>(${JSON.stringify(`${scope.qualifier}${name}`)}) {`,
    `    override fun variantName(value: ${name}): String = when (value) {`,
    ...variantNames,
    "    }",
    "",
    `    override fun encodeVariant(json: Json, value: ${name}): JsonElement = when (value) {`,
    ...encoders,
    "    }",
    "",
    `    override fun decodeVariant(json: Json, variantName: String, element: JsonElement): ${name} = when (variantName) {`,
    ...decoders,
    "    }",
    "}",
  ].join("\n");
}

function variantSerializer(oneof: OneofDeclaration, variant: OneofShape["variants"][number], scope: TypeScope): string {
  return valueSerializer(variant.value, oneofVariantTypeName(oneof.name, variant.name), scope);
}

/** Every type name the models source declares, for collision checks. */
export function declaredTypeNames(descriptor: SchemaDescriptor): string[] {
  const names = descriptor.enums.map(enumDescriptor => enumDescriptor.name);
  for (const model of descriptor.models) {
    names.push(model.name);
    names.push(...oneofsOf(model).flatMap(oneof => [oneof.name, `${oneof.name}Serializer`]));
  }
  return names;
}
