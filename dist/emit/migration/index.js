// src/emit/migration/index.ts
// Registry of migration emitters, kept separate from the CREATE-schema EMITTERS
// so `gen` doesn't offer migration targets and vice versa.
import { sqlMigrationEmitter } from "./sqlMigrationEmitter.js";
import { surrealMigrationEmitter } from "./surrealMigrationEmitter.js";
const MIGRATION_EMITTERS = {
    [sqlMigrationEmitter.target]: sqlMigrationEmitter,
    [surrealMigrationEmitter.target]: surrealMigrationEmitter,
};
export function getMigrationEmitter(target) {
    return MIGRATION_EMITTERS[target] ?? null;
}
export const MIGRATION_TARGETS = Object.keys(MIGRATION_EMITTERS);
//# sourceMappingURL=index.js.map