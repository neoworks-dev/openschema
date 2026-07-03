// src/emit/migration/index.ts
// Registry of migration emitters, kept separate from the CREATE-schema EMITTERS
// so `gen` doesn't offer migration targets and vice versa.

import type { MigrationEmitter } from "./types.js";
import { sqlMigrationEmitter } from "./sqlMigrationEmitter.js";
import { surrealMigrationEmitter } from "./surrealMigrationEmitter.js";

export type { MigrationEmitter, MigrationEmitContext } from "./types.js";

const MIGRATION_EMITTERS: Record<string, MigrationEmitter> = {
  [sqlMigrationEmitter.target]:     sqlMigrationEmitter,
  [surrealMigrationEmitter.target]: surrealMigrationEmitter,
};

export function getMigrationEmitter(target: string): MigrationEmitter | null {
  return MIGRATION_EMITTERS[target] ?? null;
}

export const MIGRATION_TARGETS = Object.keys(MIGRATION_EMITTERS);
