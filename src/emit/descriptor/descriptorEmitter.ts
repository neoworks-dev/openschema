// src/emit/descriptor/descriptorEmitter.ts
// The `descriptor` target: the schema as data, for runtimes that encode, decode
// and validate the codec wire format without generated code. Field layouts come
// from the same plan the codec target generates from, so the two cannot disagree.

import type { EnumDecl } from "../../parser/ast.js";
import type { ResolvedField, ResolvedModel } from "../../resolver/types.js";
import type { EmitContext, Emitter, OutputFile } from "../types.js";
import { baseFieldsToEmit } from "../typeMapping.js";
import { planModel, type FieldPlan } from "../codec/plan.js";
import { rejectDuplicateLocalNames, rejectOverlayCompany } from "../codec/codecEmitter.js";
import { describeConstraints } from "./constraints.js";
import { describeNodes } from "./nodes.js";
import {
  DESCRIPTOR_VERSION, type EnumDescriptor, type FieldDescriptor, type ModelDescriptor, type SchemaDescriptor,
} from "./descriptorTypes.js";

export const descriptorEmitter: Emitter = {
  target: "descriptor",
  fileExtension: "json",

  emit(context: EmitContext): OutputFile[] {
    const descriptor = buildDescriptor(context);
    return [{ path: "schema.descriptor.json", contents: `${JSON.stringify(descriptor, null, 2)}\n` }];
  },
};

export function buildDescriptor(context: EmitContext): SchemaDescriptor {
  rejectOverlayCompany(context);
  rejectDuplicateLocalNames(context.schema);

  const models = describeModels(context);
  return {
    descriptorVersion: DESCRIPTOR_VERSION,
    namespace: context.schema.namespace.join("."),
    enums: describeEnums(context),
    models: [...models.values()],
    nodes: describeNodes(context.schema, models),
  };
}

function describeEnums(context: EmitContext): EnumDescriptor[] {
  const enums: EnumDescriptor[] = [];
  for (const symbol of context.schema.enums.values()) {
    const decl = symbol.decl as EnumDecl;
    const variants = decl.variants.map(variant => ({ name: variant.name, ordinal: variant.ordinal }));
    enums.push({ name: symbol.localName, variants });
  }
  return enums;
}

/** Keyed by local name, which rejectDuplicateLocalNames keeps unique. */
function describeModels(context: EmitContext): Map<string, ModelDescriptor> {
  const models = new Map<string, ModelDescriptor>();
  for (const record of context.schema.records.values()) {
    // Generic records have unsubstituted type parameters, matching the codec target.
    if (record.isGeneric) continue;
    models.set(record.symbol.localName, describeModel(record, baseFieldsToEmit(record, context), context));
  }
  return models;
}

function describeModel(record: ResolvedModel, fields: ResolvedField[], context: EmitContext): ModelDescriptor {
  const plan = planModel(record, fields, context.schema);
  const described = plan.fields.map((fieldPlan, index) => describeField(plan.name, fields[index], fieldPlan));
  return { name: plan.name, fields: described };
}

function describeField(model: string, field: ResolvedField, plan: FieldPlan): FieldDescriptor {
  return {
    ordinal: plan.ordinal,
    name: plan.name,
    container: plan.container,
    value: plan.value,
    required: plan.required,
    constraints: describeConstraints(model, field, plan.value),
  };
}
