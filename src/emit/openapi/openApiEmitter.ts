// src/emit/openapi/openApiEmitter.ts
// Emits an OpenAPI 3.0 document from a resolved schema.
//
// Operations become paths. HTTP method and route come from decorators:
//   @get / @post / @put / @delete / @patch   choose the method
//   @route("/users/{id}")                     sets the path and path params
// Request bodies use input visibility (create/update/query); responses use
// output visibility (read) — see @visibility in the docs.

import type { Emitter, EmitContext, OutputFile } from "../types.js";
import type { ResolvedModel, ResolvedField, ResolvedSchema } from "../../resolver/types.js";
import type { TypeExpr, ScalarKind, EnumDecl, OperationDecl, ParamDecl } from "../../parser/ast.js";
import {
  findDecorator, hasDecorator, firstStringArg, unwrapNullable, applyLink,
  isVisibleInInput, isVisibleInOutput, isInputModel,
  unionAliases, resolveAliasInline,
} from "../typeMapping.js";

type Json = Record<string, unknown>;

const SCALAR_JSON: Record<ScalarKind, Json> = {
  bool: { type: "boolean" },
  i8: { type: "integer", format: "int32" }, i16: { type: "integer", format: "int32" },
  i32: { type: "integer", format: "int32" }, i64: { type: "integer", format: "int64" },
  u8: { type: "integer", minimum: 0 }, u16: { type: "integer", minimum: 0 },
  u32: { type: "integer", minimum: 0 }, u64: { type: "integer", minimum: 0 },
  f32: { type: "number", format: "float" }, f64: { type: "number", format: "double" },
  string: { type: "string" }, bytes: { type: "string", format: "byte" },
  uuid: { type: "string", format: "uuid" },
  json: {},
  date: { type: "string", format: "date" }, time: { type: "string", format: "time" },
  timestamp: { type: "string", format: "date-time" }, duration: { type: "string", format: "duration" },
};

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"];

export const openApiEmitter: Emitter = {
  target: "openapi",
  fileExtension: "json",

  emit(context: EmitContext): OutputFile[] {
    const schemas: Json = {};
    for (const symbol of context.schema.enums.values()) {
      schemas[symbol.localName] = enumSchema(symbol.decl as EnumDecl);
    }
    for (const model of context.schema.records.values()) {
      if (model.isGeneric) continue;
      if (isInputModel(model)) continue; // input-only model: no output schema
      schemas[model.symbol.localName] = outputSchema(model, context);
    }
    for (const name of collectInputModels(context.schema)) {
      const model = findModel(context.schema, name);
      if (model !== null) schemas[inputSchemaName(model)] = inputSchema(model, context.schema);
    }
    for (const { name, alias } of unionAliases(context.schema)) {
      if (alias.type.kind !== "union") continue;
      schemas[name] = { oneOf: alias.type.variants.map(v => mapType(resolveAliasInline(v, context.schema), false, context.schema)) };
    }

    const doc: Json = {
      openapi: "3.0.3",
      info: { title: apiTitle(context.schema), version: "1.0.0" },
      paths: buildPaths(context.schema),
      components: { schemas },
    };
    return [{ path: `openapi.${this.fileExtension}`, contents: JSON.stringify(doc, null, 2) + "\n" }];
  },
};

function apiTitle(schema: ResolvedSchema): string {
  if (schema.namespace.length === 0) return "OpenSchema API";
  return `${schema.namespace.join(".")} API`;
}

// ── Component schemas ──────────────────────────────────────────────────────────

function enumSchema(decl: EnumDecl): Json {
  return { type: "string", enum: decl.variants.map(v => v.name) };
}

function outputSchema(model: ResolvedModel, context: EmitContext): Json {
  const fields = model.fields.filter(f => keepField(f, context)).filter(f => isVisibleInOutput(f.decorators));
  return objectSchema(fields, false, context.schema);
}

function inputSchema(model: ResolvedModel, schema: ResolvedSchema): Json {
  const fields = model.fields.filter(f => !f.isPrivate).filter(f => isVisibleInInput(f.decorators));
  return objectSchema(fields, true, schema);
}

function keepField(field: ResolvedField, context: EmitContext): boolean {
  if (field.isPrivate) return context.includePrivate;
  return true;
}

function objectSchema(fields: ResolvedField[], inputMode: boolean, schema: ResolvedSchema): Json {
  const properties: Json = {};
  const required: string[] = [];
  for (const field of fields) {
    const { inner, nullable } = unwrapNullable(applyLink(field.type, field, schema));
    properties[field.name] = applyFieldConstraints(mapType(inner, inputMode, schema), field);
    if (!nullable) required.push(field.name);
  }
  const result: Json = { type: "object", properties };
  if (required.length > 0) result.required = required;
  return result;
}

function applyFieldConstraints(schema: Json, field: ResolvedField): Json {
  const format = firstStringArg(field.decorators, "format");
  if (format !== null && schema.type === "string") schema.format = format;
  applyNumericBound(schema, field, "minValue", "minimum");
  applyNumericBound(schema, field, "maxValue", "maximum");
  applyNumericBound(schema, field, "minLength", "minLength");
  applyNumericBound(schema, field, "maxLength", "maxLength");
  const pattern = firstStringArg(field.decorators, "pattern");
  if (pattern !== null) schema.pattern = pattern;
  return schema;
}

function applyNumericBound(schema: Json, field: ResolvedField, decorator: string, keyword: string): void {
  const found = findDecorator(field.decorators, decorator);
  if (found === null || found.args.length === 0) return;
  const value = found.args[0].value;
  if (value.kind !== "number") return;
  schema[keyword] = value.value;
}

function mapType(type: TypeExpr, inputMode: boolean, schema: ResolvedSchema): Json {
  switch (type.kind) {
    case "scalar":   return { ...SCALAR_JSON[type.scalar] };
    case "decimal":  return { type: "string", format: "decimal" };
    case "named":    return { $ref: refFor(type.path[type.path.length - 1], inputMode, schema) };
    case "array": {
      const arraySchema: Json = { type: "array", items: mapType(type.element, inputMode, schema) };
      if (type.minItems !== undefined) arraySchema.minItems = type.minItems;
      if (type.maxItems !== undefined) arraySchema.maxItems = type.maxItems;
      return arraySchema;
    }
    case "map":      return { type: "object", additionalProperties: mapType(type.value, inputMode, schema) };
    case "nullable": return mapType(type.inner, inputMode, schema);
    case "union":    return { oneOf: type.variants.map(v => mapType(v, inputMode, schema)) };
    case "oneof":    return { oneOf: type.variants.map(v => mapType(v.type, inputMode, schema)) };
  }
}

// In input position, model references point to their Input variant; enums,
// aliases, and input-only (@input) models keep their single schema name.
function refFor(name: string, inputMode: boolean, schema: ResolvedSchema): string {
  if (inputMode) {
    const model = findModel(schema, name);
    if (model !== null && !isInputModel(model)) return `#/components/schemas/${name}Input`;
  }
  return `#/components/schemas/${name}`;
}

// An input-only (@input) model keeps its bare schema name; a dual-use model's
// input gets the `Input` suffix.
function inputSchemaName(model: ResolvedModel): string {
  if (isInputModel(model)) return model.symbol.localName;
  return `${model.symbol.localName}Input`;
}

// ── Paths ──────────────────────────────────────────────────────────────────────

function buildPaths(schema: ResolvedSchema): Json {
  const paths: Json = {};
  for (const op of schema.operations) {
    const route = routeFor(op);
    const method = methodFor(op);
    const pathItem = (paths[route] as Json) ?? {};
    pathItem[method] = operationObject(op, route, method, schema);
    paths[route] = pathItem;
  }
  return paths;
}

function routeFor(op: OperationDecl): string {
  const explicit = firstStringArg(op.decorators, "route");
  if (explicit !== null) return explicit;
  return `/${op.name}`;
}

function methodFor(op: OperationDecl): string {
  for (const method of HTTP_METHODS) {
    if (hasDecorator(op.decorators, method)) return method;
  }
  if (hasDecorator(op.decorators, "mutation")) return "post";
  return "get";
}

function pathParamNames(route: string): Set<string> {
  const names = new Set<string>();
  const matches = route.matchAll(/\{(\w+)\}/g);
  for (const match of matches) names.add(match[1]);
  return names;
}

function operationObject(op: OperationDecl, route: string, method: string, schema: ResolvedSchema): Json {
  const pathNames = pathParamNames(route);
  const pathParams = op.params.filter(p => pathNames.has(p.name));
  const otherParams = op.params.filter(p => !pathNames.has(p.name));

  const parameters: Json[] = pathParams.map(p => parameterObject(p, "path", schema));
  const operation: Json = { operationId: op.name };

  const bodyMethod = method === "post" || method === "put" || method === "patch";
  if (bodyMethod && otherParams.length > 0) {
    operation.requestBody = requestBody(otherParams, schema);
  } else {
    for (const p of otherParams) parameters.push(parameterObject(p, "query", schema));
  }

  if (parameters.length > 0) operation.parameters = parameters;
  operation.responses = responses(op.returnType, schema);
  return operation;
}

function parameterObject(param: ParamDecl, location: "path" | "query", schema: ResolvedSchema): Json {
  const { inner, nullable } = unwrapNullable(param.type);
  return {
    name: param.name,
    in: location,
    required: location === "path" ? true : !nullable,
    schema: mapType(inner, true, schema),
  };
}

function requestBody(params: ParamDecl[], schema: ResolvedSchema): Json {
  // A single model parameter becomes the body directly; otherwise wrap the
  // parameters in an object.
  const bodySchema = params.length === 1
    ? mapType(unwrapNullable(params[0].type).inner, true, schema)
    : wrapParams(params, schema);
  return { required: true, content: { "application/json": { schema: bodySchema } } };
}

function wrapParams(params: ParamDecl[], schema: ResolvedSchema): Json {
  const properties: Json = {};
  const required: string[] = [];
  for (const param of params) {
    const { inner, nullable } = unwrapNullable(param.type);
    properties[param.name] = mapType(inner, true, schema);
    if (!nullable) required.push(param.name);
  }
  const result: Json = { type: "object", properties };
  if (required.length > 0) result.required = required;
  return result;
}

function responses(returnType: TypeExpr, schema: ResolvedSchema): Json {
  return {
    "200": {
      description: "Success",
      content: { "application/json": { schema: mapType(unwrapNullable(returnType).inner, false, schema) } },
    },
  };
}

// ── Input-model discovery (demand-driven, like the GraphQL emitter) ─────────────

function collectInputModels(schema: ResolvedSchema): string[] {
  const found = new Set<string>();
  const queue: string[] = [];

  for (const op of schema.operations) {
    if (!isBodyMethod(methodFor(op))) continue;
    for (const param of op.params) collectModelNames(param.type, schema, found, queue);
  }
  // Input-only models always get an input schema, even if no op body references them.
  for (const model of schema.records.values()) {
    if (isInputModel(model) && !found.has(model.symbol.localName)) {
      found.add(model.symbol.localName);
      queue.push(model.symbol.localName);
    }
  }
  while (queue.length > 0) {
    const name = queue.pop()!;
    const model = findModel(schema, name);
    if (model === null) continue;
    // Only follow fields that reach the input; read-only/private field types
    // must not pull in an orphan input schema.
    for (const field of model.fields) {
      if (field.isPrivate) continue;
      if (!isVisibleInInput(field.decorators)) continue;
      collectModelNames(applyLink(field.type, field, schema), schema, found, queue);
    }
  }
  return [...found];
}

function isBodyMethod(method: string): boolean {
  return method === "post" || method === "put" || method === "patch";
}

function collectModelNames(type: TypeExpr, schema: ResolvedSchema, found: Set<string>, queue: string[]): void {
  if (type.kind === "named") {
    const local = type.path[type.path.length - 1];
    if (findModel(schema, local) !== null && !found.has(local)) {
      found.add(local);
      queue.push(local);
    }
    return;
  }
  if (type.kind === "array")    return collectModelNames(type.element, schema, found, queue);
  if (type.kind === "nullable") return collectModelNames(type.inner, schema, found, queue);
  if (type.kind === "map")      return collectModelNames(type.value, schema, found, queue);
  if (type.kind === "union") {
    for (const v of type.variants) collectModelNames(v, schema, found, queue);
  }
}

function findModel(schema: ResolvedSchema, local: string): ResolvedModel | null {
  for (const model of schema.records.values()) {
    if (model.symbol.localName === local) return model;
  }
  return null;
}
