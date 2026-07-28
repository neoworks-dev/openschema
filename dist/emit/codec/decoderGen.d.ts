import { type FieldPlan, type ModelPlan } from "./plan.js";
export declare function emitDecoder(plan: ModelPlan): string;
export declare function emitOneofReaders(plan: ModelPlan): string[];
/** The generated call site for a oneof field, resolved per model+ordinal. */
export declare function oneofReaderName(plan: ModelPlan, field: FieldPlan): string;
//# sourceMappingURL=decoderGen.d.ts.map