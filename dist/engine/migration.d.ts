import type { TypeExpr, EnumDecl } from "../parser/ast.js";
import type { ResolvedSchema, ResolvedModel, ResolvedField } from "../resolver/types.js";
import { type TypeRelation } from "./type-compat.js";
export type Safety = "safe" | "needs_backfill" | "lossy" | "destructive";
export type MigrationOp = {
    kind: "CreateModel";
    table: string;
    model: ResolvedModel;
    safety: "safe";
} | {
    kind: "DropModel";
    table: string;
    model: ResolvedModel;
    safety: "destructive";
} | {
    kind: "RenameModel";
    oldTable: string;
    newTable: string;
    model: ResolvedModel;
    safety: "safe";
} | {
    kind: "AddField";
    table: string;
    field: ResolvedField;
    model: ResolvedModel;
    safety: "safe" | "needs_backfill";
} | {
    kind: "DropField";
    table: string;
    field: ResolvedField;
    model: ResolvedModel;
    safety: "destructive";
} | {
    kind: "RenameField";
    table: string;
    oldName: string;
    field: ResolvedField;
    model: ResolvedModel;
    safety: "safe";
} | {
    kind: "ChangeFieldType";
    table: string;
    oldType: TypeExpr;
    field: ResolvedField;
    model: ResolvedModel;
    relation: TypeRelation;
    safety: "safe" | "lossy";
} | {
    kind: "ChangeFieldNullability";
    table: string;
    field: ResolvedField;
    model: ResolvedModel;
    becameNullable: boolean;
    safety: "safe" | "needs_backfill";
} | {
    kind: "CreateEnum";
    enumName: string;
    decl: EnumDecl;
    safety: "safe";
} | {
    kind: "DropEnum";
    enumName: string;
    decl: EnumDecl;
    safety: "destructive";
} | {
    kind: "RenameEnum";
    oldName: string;
    newName: string;
    decl: EnumDecl;
    safety: "safe";
} | {
    kind: "AddEnumVariant";
    enumName: string;
    variant: string;
    decl: EnumDecl;
    safety: "safe";
} | {
    kind: "DropEnumVariant";
    enumName: string;
    variant: string;
    decl: EnumDecl;
    safety: "destructive";
} | {
    kind: "RenameEnumVariant";
    enumName: string;
    oldVariant: string;
    newVariant: string;
    decl: EnumDecl;
    safety: "safe";
};
export interface MigrationPlan {
    ops: MigrationOp[];
    hasDestructive: boolean;
    hasManualSteps: boolean;
}
/** The logical table name for a model — same rule both DDL emitters use. */
export declare function migrationTableName(model: ResolvedModel): string;
export declare function buildMigrationPlan(oldSchema: ResolvedSchema, newSchema: ResolvedSchema): MigrationPlan;
//# sourceMappingURL=migration.d.ts.map