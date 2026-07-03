// src/emit/migration/types.ts
// Migration emitters render a platform-neutral MigrationPlan into per-backend DDL.
// They need BOTH schema versions (for DDL detail) plus the plan, so they use a
// dedicated interface rather than the single-schema EmitContext / getEmitter path.
/** A comment header summarising the plan for the top of a migration file. */
export function migrationHeader(plan, comment) {
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
//# sourceMappingURL=types.js.map