// src/emit/descriptor/descriptorEmitter.ts
// The `descriptor` target: the schema as data, for runtimes that encode, decode
// and validate the codec wire format without generated code. Field layouts come
// from the same plan the codec target generates from, so the two cannot disagree.
import { baseFieldsToEmit } from "../typeMapping.js";
import { planModel } from "../codec/plan.js";
import { rejectDuplicateLocalNames, rejectOverlayCompany } from "../codec/codecEmitter.js";
import { describeConstraints } from "./constraints.js";
import { describeNodes } from "./nodes.js";
import { DESCRIPTOR_VERSION, } from "./descriptorTypes.js";
export const descriptorEmitter = {
    target: "descriptor",
    fileExtension: "json",
    emit(context) {
        const descriptor = buildDescriptor(context);
        return [{ path: "schema.descriptor.json", contents: `${JSON.stringify(descriptor, null, 2)}\n` }];
    },
};
export function buildDescriptor(context) {
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
function describeEnums(context) {
    const enums = [];
    for (const symbol of context.schema.enums.values()) {
        const decl = symbol.decl;
        const variants = decl.variants.map(variant => ({ name: variant.name, ordinal: variant.ordinal }));
        enums.push({ name: symbol.localName, variants });
    }
    return enums;
}
/** Keyed by local name, which rejectDuplicateLocalNames keeps unique. */
function describeModels(context) {
    const models = new Map();
    for (const record of context.schema.records.values()) {
        // Generic records have unsubstituted type parameters, matching the codec target.
        if (record.isGeneric)
            continue;
        models.set(record.symbol.localName, describeModel(record, baseFieldsToEmit(record, context), context));
    }
    return models;
}
function describeModel(record, fields, context) {
    const plan = planModel(record, fields, context.schema);
    const described = plan.fields.map((fieldPlan, index) => describeField(plan.name, fields[index], fieldPlan));
    return { name: plan.name, fields: described };
}
function describeField(model, field, plan) {
    return {
        ordinal: plan.ordinal,
        name: plan.name,
        container: plan.container,
        value: plan.value,
        required: plan.required,
        constraints: describeConstraints(model, field, plan.value),
    };
}
//# sourceMappingURL=descriptorEmitter.js.map