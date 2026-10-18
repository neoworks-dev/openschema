import { type ModelPlan } from "./plan.js";
export declare const FILE_VARIANT_MESSAGE_NAME = "FileVariant";
export declare function fileModelPlans(): ModelPlan[];
/** Whether a field of any plan holds a `File`, directly or inside a oneof. */
export declare function usesFile(plans: ModelPlan[]): boolean;
//# sourceMappingURL=filePlan.d.ts.map