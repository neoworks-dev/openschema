// src/engine/migration.ts
// Platform-neutral migration planner. Given two resolved schemas (old → new), it
// pairs models/fields by the same identity rules as the differ (name + @renamed,
// fields by ordinal) and classifies each change into a typed MigrationOp carrying
// the resolved model/field plus a `safety` tag. Per-backend emitters render the
// plan into ALTER TABLE / DEFINE FIELD DDL.
//
// It operates on ResolvedSchema (not the diagnostic Change[]) so every op has the
// full inlined TypeExpr, decorators and @table name that DDL rendering needs.

import type { TypeExpr, Decorator, EnumDecl, EnumVariant } from "../parser/ast.js";
import type { ResolvedSchema, ResolvedModel, ResolvedField, DeclSymbol } from "../resolver/types.js";
import { compareTypes, type TypeRelation } from "./type-compat.js";
import { matchDeclarations, pairByOrdinal, type NamedDecl } from "./match.js";
import { isInputModel, hasDecorator, unwrapNullable, firstStringArg, toSnakeCase } from "../emit/typeMapping.js";

export type Safety = "safe" | "needs_backfill" | "lossy" | "destructive";

export type MigrationOp =
  | { kind: "CreateModel"; table: string; model: ResolvedModel; safety: "safe" }
  | { kind: "DropModel"; table: string; model: ResolvedModel; safety: "destructive" }
  | { kind: "RenameModel"; oldTable: string; newTable: string; model: ResolvedModel; safety: "safe" }
  | { kind: "AddField"; table: string; field: ResolvedField; model: ResolvedModel; safety: "safe" | "needs_backfill" }
  | { kind: "DropField"; table: string; field: ResolvedField; model: ResolvedModel; safety: "destructive" }
  | { kind: "RenameField"; table: string; oldName: string; field: ResolvedField; model: ResolvedModel; safety: "safe" }
  | { kind: "ChangeFieldType"; table: string; oldType: TypeExpr; field: ResolvedField; model: ResolvedModel; relation: TypeRelation; safety: "safe" | "lossy" }
  | { kind: "ChangeFieldNullability"; table: string; field: ResolvedField; model: ResolvedModel; becameNullable: boolean; safety: "safe" | "needs_backfill" }
  | { kind: "CreateEnum"; enumName: string; decl: EnumDecl; safety: "safe" }
  | { kind: "DropEnum"; enumName: string; decl: EnumDecl; safety: "destructive" }
  | { kind: "RenameEnum"; oldName: string; newName: string; decl: EnumDecl; safety: "safe" }
  | { kind: "AddEnumVariant"; enumName: string; variant: string; decl: EnumDecl; safety: "safe" }
  | { kind: "DropEnumVariant"; enumName: string; variant: string; decl: EnumDecl; safety: "destructive" }
  | { kind: "RenameEnumVariant"; enumName: string; oldVariant: string; newVariant: string; decl: EnumDecl; safety: "safe" };

export interface MigrationPlan {
  ops: MigrationOp[];
  hasDestructive: boolean;
  hasManualSteps: boolean; // any op with safety needs_backfill | lossy
}

/** The logical table name for a model — same rule both DDL emitters use. */
export function migrationTableName(model: ResolvedModel): string {
  const explicit = firstStringArg(model.decorators, "table");
  if (explicit !== null) return explicit;
  return toSnakeCase(model.symbol.localName);
}

interface ModelEntry extends NamedDecl { model: ResolvedModel }
interface EnumEntry extends NamedDecl { decl: EnumDecl }

export function buildMigrationPlan(oldSchema: ResolvedSchema, newSchema: ResolvedSchema): MigrationPlan {
  const ops: MigrationOp[] = [];

  planModels(ops, oldSchema, newSchema);
  planEnums(ops, oldSchema, newSchema);

  const ordered = orderOps(ops);
  return {
    ops: ordered,
    hasDestructive: ordered.some(op => op.safety === "destructive"),
    hasManualSteps: ordered.some(op => op.safety === "needs_backfill" || op.safety === "lossy"),
  };
}

// ── Models & fields ───────────────────────────────────────────────────────────

function planModels(ops: MigrationOp[], oldSchema: ResolvedSchema, newSchema: ResolvedSchema): void {
  const match = matchDeclarations(modelEntries(oldSchema), modelEntries(newSchema));

  for (const removed of match.removed) {
    ops.push({ kind: "DropModel", table: migrationTableName(removed.model), model: removed.model, safety: "destructive" });
  }
  for (const added of match.added) {
    ops.push({ kind: "CreateModel", table: migrationTableName(added.model), model: added.model, safety: "safe" });
  }
  for (const pair of match.pairs) {
    const oldModel = pair.oldDecl.model;
    const newModel = pair.newDecl.model;
    const oldTable = migrationTableName(oldModel);
    const newTable = migrationTableName(newModel);
    if (pair.renamed && oldTable !== newTable) {
      ops.push({ kind: "RenameModel", oldTable, newTable, model: newModel, safety: "safe" });
    }
    planFields(ops, newTable, oldModel, newModel);
  }
}

function planFields(ops: MigrationOp[], table: string, oldModel: ResolvedModel, newModel: ResolvedModel): void {
  for (const { oldItem, newItem } of pairByOrdinal(oldModel.fields, newModel.fields)) {
    if (oldItem === null && newItem !== null) {
      ops.push({ kind: "AddField", table, field: newItem, model: newModel, safety: addFieldSafety(newItem) });
      continue;
    }
    if (newItem === null && oldItem !== null) {
      ops.push({ kind: "DropField", table, field: oldItem, model: newModel, safety: "destructive" });
      continue;
    }
    if (oldItem === null || newItem === null) continue;

    if (oldItem.name !== newItem.name) {
      ops.push({ kind: "RenameField", table, oldName: oldItem.name, field: newItem, model: newModel, safety: "safe" });
    }

    const oldParts = unwrapNullable(oldItem.type);
    const newParts = unwrapNullable(newItem.type);

    const relation = compareTypes(oldParts.inner, newParts.inner);
    if (relation !== "same") {
      const safety = relation === "widened" ? "safe" : "lossy";
      ops.push({ kind: "ChangeFieldType", table, oldType: oldItem.type, field: newItem, model: newModel, relation, safety });
    }

    if (oldParts.nullable !== newParts.nullable) {
      const becameNullable = newParts.nullable;
      ops.push({
        kind: "ChangeFieldNullability", table, field: newItem, model: newModel,
        becameNullable, safety: becameNullable ? "safe" : "needs_backfill",
      });
    }
  }
}

function addFieldSafety(field: ResolvedField): "safe" | "needs_backfill" {
  const { nullable } = unwrapNullable(field.type);
  if (nullable) return "safe";
  if (hasDecorator(field.decorators, "default")) return "safe";
  return "needs_backfill";
}

// ── Enums ─────────────────────────────────────────────────────────────────────

function planEnums(ops: MigrationOp[], oldSchema: ResolvedSchema, newSchema: ResolvedSchema): void {
  const match = matchDeclarations(enumEntries(oldSchema), enumEntries(newSchema));

  for (const removed of match.removed) {
    ops.push({ kind: "DropEnum", enumName: removed.decl.name, decl: removed.decl, safety: "destructive" });
  }
  for (const added of match.added) {
    ops.push({ kind: "CreateEnum", enumName: added.decl.name, decl: added.decl, safety: "safe" });
  }
  for (const pair of match.pairs) {
    const oldDecl = pair.oldDecl.decl;
    const newDecl = pair.newDecl.decl;
    if (pair.renamed) {
      ops.push({ kind: "RenameEnum", oldName: oldDecl.name, newName: newDecl.name, decl: newDecl, safety: "safe" });
    }
    for (const { oldItem, newItem } of pairByOrdinal<EnumVariant>(oldDecl.variants, newDecl.variants)) {
      if (oldItem === null && newItem !== null) {
        ops.push({ kind: "AddEnumVariant", enumName: newDecl.name, variant: newItem.name, decl: newDecl, safety: "safe" });
      } else if (newItem === null && oldItem !== null) {
        ops.push({ kind: "DropEnumVariant", enumName: newDecl.name, variant: oldItem.name, decl: newDecl, safety: "destructive" });
      } else if (oldItem !== null && newItem !== null && oldItem.name !== newItem.name) {
        ops.push({ kind: "RenameEnumVariant", enumName: newDecl.name, oldVariant: oldItem.name, newVariant: newItem.name, decl: newDecl, safety: "safe" });
      }
    }
  }
}

// ── Adapters ──────────────────────────────────────────────────────────────────

function modelEntries(schema: ResolvedSchema): Map<string, ModelEntry> {
  const map = new Map<string, ModelEntry>();
  for (const model of schema.records.values()) {
    if (model.isGeneric || isInputModel(model)) continue;
    map.set(model.symbol.localName, { name: model.symbol.localName, decorators: model.decorators, model });
  }
  return map;
}

function enumEntries(schema: ResolvedSchema): Map<string, EnumEntry> {
  const map = new Map<string, EnumEntry>();
  for (const symbol of schema.enums.values()) {
    const decl = symbol.decl as EnumDecl;
    map.set(symbol.localName, { name: symbol.localName, decorators: decl.decorators, decl });
  }
  return map;
}

// ── Ordering ──────────────────────────────────────────────────────────────────
//
// Phase ops so dependencies hold: create tables before fields/FKs reference them;
// rename a field before any op that targets the new name; destructive drops last
// so a forward migration is expand-then-contract safe.

const PHASE: Record<MigrationOp["kind"], number> = {
  CreateEnum: 0,        // a type must exist before a table/column uses it
  CreateModel: 1,
  RenameModel: 2,
  RenameEnum: 3,
  AddEnumVariant: 4,
  RenameEnumVariant: 4,
  RenameField: 5,
  AddField: 6,
  ChangeFieldType: 7,
  ChangeFieldNullability: 7,
  DropField: 9,
  DropEnumVariant: 10,
  DropModel: 11,
  DropEnum: 12,         // drop a type only after every table using it is gone
};

function orderOps(ops: MigrationOp[]): MigrationOp[] {
  // Stable sort by phase, preserving discovery order within a phase.
  return ops
    .map((op, index) => ({ op, index }))
    .sort((a, b) => PHASE[a.op.kind] - PHASE[b.op.kind] || a.index - b.index)
    .map(entry => entry.op);
}
