import type { ResolvedSchema } from "../../resolver/types.js";
import type { MigrationPlan } from "../../engine/migration.js";
import type { OutputFile } from "../types.js";
export interface MigrationEmitContext {
    oldSchema: ResolvedSchema;
    newSchema: ResolvedSchema;
    plan: MigrationPlan;
    company: string | null;
    includePrivate: boolean;
}
export interface MigrationEmitter {
    target: string;
    fileExtension: string;
    emit(context: MigrationEmitContext): OutputFile[];
}
/** A comment header summarising the plan for the top of a migration file. */
export declare function migrationHeader(plan: MigrationPlan, comment: string): string;
//# sourceMappingURL=types.d.ts.map