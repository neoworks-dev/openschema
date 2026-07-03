// src/emit/migration/types.ts
// Migration emitters render a platform-neutral MigrationPlan into per-backend DDL.
// They need BOTH schema versions (for DDL detail) plus the plan, so they use a
// dedicated interface rather than the single-schema EmitContext / getEmitter path.

import type { ResolvedSchema } from "../../resolver/types.js";
import type { MigrationPlan } from "../../engine/migration.js";
import type { OutputFile } from "../types.js";

export interface MigrationEmitContext {
  oldSchema:      ResolvedSchema;
  newSchema:      ResolvedSchema;
  plan:           MigrationPlan;
  company:        string | null;
  includePrivate: boolean;
}

export interface MigrationEmitter {
  target:        string;        // "migration-sql" | "migration-surreal"
  fileExtension: string;
  emit(context: MigrationEmitContext): OutputFile[];
}

/** A comment header summarising the plan for the top of a migration file. */
export function migrationHeader(plan: MigrationPlan, comment: string): string {
  const lines = [
    `${comment} Generated migration — ${plan.ops.length} operation(s).`,
  ];
  if (plan.hasDestructive) {
    lines.push(`${comment} ⚠ Contains DESTRUCTIVE operations (data loss). Review before running.`);
  }
  if (plan.hasManualSteps) {
    lines.push(`${comment} ⚠ Contains TODO/LOSSY steps that need a human (backfills, casts).`);
  }
  return lines.join("\n");
}
