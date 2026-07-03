// src/engine/differ.ts
// Core diff engine: walks two Program ASTs and emits Change objects.
//
// Stable identity rules
// ─────────────────────
//   Records / Enums  → matched by declaration name
//   Fields           → matched by ordinal (name changes are detected as renames)
//   Enum variants    → matched by ordinal
//   Indexes          → matched by name
//   Constraints      → matched by kind (only one of each kind per field)
import { compareTypes, describeType } from "./type-compat.js";
import { matchDeclarations } from "./match.js";
// ── Rule IDs ─────────────────────────────────────────────────────────────────
//
//  Prefix  R = record/field
//          E = enum
//          T = type alias
//          S = schema (top-level)
const R = {
    FIELD_ADDED_NULLABLE: "R001",
    FIELD_ADDED_REQUIRED_DEFAULT: "R002",
    FIELD_ADDED_REQUIRED_NO_DEF: "R003",
    FIELD_REMOVED: "R004",
    FIELD_RENAMED: "R005",
    FIELD_TYPE_WIDENED: "R006",
    FIELD_TYPE_NARROWED: "R007",
    FIELD_TYPE_INCOMPATIBLE: "R008",
    FIELD_MADE_NULLABLE: "R009",
    FIELD_ADDED_REQUIRED: "R010",
    FIELD_MADE_REQUIRED: "R011",
    UNIQUE_ADDED: "R012",
    CHECK_ADDED: "R013",
    CONSTRAINT_REMOVED: "R014",
    PRIMARY_KEY_CHANGED: "R015",
    RECORD_ADDED: "R016",
    RECORD_REMOVED: "R017",
    REFERENCES_CHANGED: "R018",
    FIELD_DEPRECATED: "R019",
    RECORD_RENAMED: "R020",
};
const E = {
    VARIANT_ADDED: "E001",
    VARIANT_REMOVED: "E002",
    VARIANT_RENAMED: "E003",
    VARIANT_RENUMBERED: "E004",
    ENUM_ADDED: "E005",
    ENUM_REMOVED: "E006",
    ENUM_RENAMED: "E007",
};
const T = {
    TYPE_ALIAS_CHANGED: "T001",
    TYPE_ALIAS_ADDED: "T002",
    TYPE_ALIAS_REMOVED: "T003",
    TYPE_ALIAS_RENAMED: "T004",
};
// ── Differ class ──────────────────────────────────────────────────────────────
export class Differ {
    constructor() {
        this.changes = [];
    }
    diff(oldProg, newProg) {
        this.changes = [];
        this.diffPrograms(oldProg, newProg);
        const suppressions = collectSuppressions(newProg);
        const kept = this.changes.filter(c => !isSuppressed(c, suppressions));
        return buildResult(kept);
    }
    // ── Program ────────────────────────────────────────────────────────────────
    diffPrograms(oldProg, newProg) {
        const oldRecords = index(oldProg.declarations, "model");
        const newRecords = index(newProg.declarations, "model");
        const oldEnums = index(oldProg.declarations, "enum");
        const newEnums = index(newProg.declarations, "enum");
        const oldAliases = index(oldProg.declarations, "type_alias");
        const newAliases = index(newProg.declarations, "type_alias");
        // Records. @renamed("Old") on a new model matches it to the removed old one.
        const recordMatch = matchDeclarations(oldRecords, newRecords);
        for (const removed of recordMatch.removed) {
            this.emit(removed.name, R.RECORD_REMOVED, "declaration_removed", "breaking_both", `Model '${removed.name}' was removed. Any code reading or writing this table will break.`);
        }
        for (const added of recordMatch.added) {
            this.emit(added.name, R.RECORD_ADDED, "declaration_added", "safe", `Model '${added.name}' was added. New schema only — no impact on existing code.`);
        }
        for (const pair of recordMatch.pairs) {
            if (pair.renamed) {
                this.emit(pair.newName, R.RECORD_RENAMED, "declaration_renamed", "warning", `Model '${pair.oldName}' was renamed to '${pair.newName}' (via @renamed). ` +
                    `Logical identity is preserved, but code referencing the old name must be updated.`, pair.oldName, pair.newName);
            }
            this.diffRecords(pair.oldDecl, pair.newDecl);
        }
        // Enums
        const enumMatch = matchDeclarations(oldEnums, newEnums);
        for (const removed of enumMatch.removed) {
            this.emit(removed.name, E.ENUM_REMOVED, "declaration_removed", "breaking_both", `Enum '${removed.name}' was removed.`);
        }
        for (const added of enumMatch.added) {
            this.emit(added.name, E.ENUM_ADDED, "declaration_added", "safe", `Enum '${added.name}' was added.`);
        }
        for (const pair of enumMatch.pairs) {
            if (pair.renamed) {
                this.emit(pair.newName, E.ENUM_RENAMED, "declaration_renamed", "warning", `Enum '${pair.oldName}' was renamed to '${pair.newName}' (via @renamed). ` +
                    `Variant ordinals are unchanged so wire compatibility is maintained; code referencing the old name must be updated.`, pair.oldName, pair.newName);
            }
            this.diffEnums(pair.oldDecl, pair.newDecl);
        }
        // Type aliases
        const aliasMatch = matchDeclarations(oldAliases, newAliases);
        for (const removed of aliasMatch.removed) {
            this.emit(removed.name, T.TYPE_ALIAS_REMOVED, "declaration_removed", "breaking_both", `Type alias '${removed.name}' was removed.`);
        }
        for (const added of aliasMatch.added) {
            this.emit(added.name, T.TYPE_ALIAS_ADDED, "declaration_added", "safe", `Type alias '${added.name}' was added.`);
        }
        for (const pair of aliasMatch.pairs) {
            if (pair.renamed) {
                this.emit(pair.newName, T.TYPE_ALIAS_RENAMED, "declaration_renamed", "warning", `Type alias '${pair.oldName}' was renamed to '${pair.newName}' (via @renamed). ` +
                    `Code referencing the old name must be updated.`, pair.oldName, pair.newName);
            }
            const rel = compareTypes(pair.oldDecl.type, pair.newDecl.type);
            if (rel !== "same") {
                const sev = typeRelationToSeverity(rel);
                this.emit(pair.newName, T.TYPE_ALIAS_CHANGED, "type_alias_changed", sev, `Type alias '${pair.newName}' changed: ${typeRelationRationale(rel)}.`, describeType(pair.oldDecl.type), describeType(pair.newDecl.type));
            }
        }
    }
    // ── Record ─────────────────────────────────────────────────────────────────
    diffRecords(oldRec, newRec) {
        // Use the new name so a renamed model reports its fields under the new name.
        const name = newRec.name;
        // ── Fields (matched by ordinal) ──────────────────────────────────────────
        const oldFields = indexBy(oldRec.members, f => f.ordinal);
        const newFields = indexBy(newRec.members, f => f.ordinal);
        // Removed fields
        for (const [ord, oldField] of oldFields) {
            if (!newFields.has(ord)) {
                this.emit(`${name}.${oldField.name}`, R.FIELD_REMOVED, "field_removed", "breaking_reader", `Field '${oldField.name}' (ordinal ${ord}) was removed. ` +
                    `Existing code reading this column will get an error or unexpected null.`, describeField(oldField));
            }
        }
        // Added fields and changed fields
        for (const [ord, newField] of newFields) {
            const oldField = oldFields.get(ord);
            const path = `${name}.${newField.name}`;
            if (!oldField) {
                this.diffAddedField(path, newField);
                continue;
            }
            // Rename (path uses the new name; old/new names are in before/after)
            if (oldField.name !== newField.name) {
                this.emit(`${name}.${newField.name}`, R.FIELD_RENAMED, "field_renamed", "warning", `Field with ordinal ${oldField.ordinal} was renamed from '${oldField.name}' to '${newField.name}'. ` +
                    `Ordinal is stable so schema compatibility is maintained, but application code using the old name will need updates.`, oldField.name, newField.name);
            }
            // Type
            this.diffFieldTypes(`${name}.${newField.name}`, oldField, newField);
            // Constraints carried by decorators (@primaryKey, @unique, @check, @references)
            this.diffFieldConstraints(`${name}.${newField.name}`, oldField, newField);
            // Nullability (surfaced separately for clarity)
            const wasNullable = oldField.type.kind === "nullable";
            const isNullable = newField.type.kind === "nullable";
            if (!wasNullable && isNullable) {
                this.emit(`${name}.${newField.name}`, R.FIELD_MADE_NULLABLE, "field_made_nullable", "safe", `Field '${newField.name}' made nullable.`);
            }
            else if (wasNullable && !isNullable) {
                this.emit(`${name}.${newField.name}`, R.FIELD_MADE_REQUIRED, "field_made_required", "breaking_writer", `Field '${newField.name}' made non-nullable. Existing null values will violate the new schema.`);
            }
        }
    }
    // ── Constraint changes (decorator-driven) ──────────────────────────────────
    diffFieldConstraints(path, oldField, newField) {
        const hadUnique = hasDecorator(oldField, "unique");
        const hasUnique = hasDecorator(newField, "unique");
        if (!hadUnique && hasUnique) {
            this.emit(path, R.UNIQUE_ADDED, "field_added_required", "breaking_writer", `A unique constraint was added to '${newField.name}'. Existing duplicate values will be rejected.`);
        }
        else if (hadUnique && !hasUnique) {
            this.emit(path, R.CONSTRAINT_REMOVED, "field_type_same", "safe", `The unique constraint on '${newField.name}' was removed.`);
        }
        const hadCheck = hasDecorator(oldField, "check");
        const hasCheck = hasDecorator(newField, "check");
        if (!hadCheck && hasCheck) {
            this.emit(path, R.CHECK_ADDED, "field_added_required", "breaking_writer", `A check constraint was added to '${newField.name}'. Existing rows may violate it.`);
        }
        else if (hadCheck && !hasCheck) {
            this.emit(path, R.CONSTRAINT_REMOVED, "field_type_same", "safe", `The check constraint on '${newField.name}' was removed.`);
        }
        const hadPk = hasDecorator(oldField, "primaryKey");
        const hasPk = hasDecorator(newField, "primaryKey");
        if (hadPk !== hasPk) {
            this.emit(path, R.PRIMARY_KEY_CHANGED, "field_type_incompatible", "breaking_both", `The primary-key status of '${newField.name}' changed. This alters row identity for all consumers.`);
        }
        const oldRef = referencesTarget(oldField);
        const newRef = referencesTarget(newField);
        if (oldRef !== newRef && (oldRef !== null || newRef !== null)) {
            this.emit(path, R.REFERENCES_CHANGED, "field_type_incompatible", "breaking_both", `The foreign-key reference on '${newField.name}' changed from ${oldRef ?? "none"} to ${newRef ?? "none"}.`);
        }
        if (!hasDecorator(oldField, "deprecated") && hasDecorator(newField, "deprecated")) {
            this.emit(path, R.FIELD_DEPRECATED, "field_type_same", "warning", `Field '${newField.name}' was marked @deprecated.`);
        }
    }
    // ── Added field classification ─────────────────────────────────────────────
    diffAddedField(path, field) {
        if (field.type.kind === "nullable") {
            this.emit(path, R.FIELD_ADDED_NULLABLE, "field_added_nullable", "safe", `Nullable field '${field.name}' added. Existing consumers will receive null; no existing code breaks.`, undefined, describeField(field));
            return;
        }
        if (hasDecorator(field, "default")) {
            this.emit(path, R.FIELD_ADDED_REQUIRED_DEFAULT, "field_added_required_with_default", "safe", `Required field '${field.name}' added with a @default. Existing rows take the default; no writer breaks.`, undefined, describeField(field));
            return;
        }
        this.emit(path, R.FIELD_ADDED_REQUIRED, "field_added_required", "breaking_writer", `Required field '${field.name}' added. Consumers that produce this type must now supply a value.`, undefined, describeField(field));
    }
    // ── Field type change ──────────────────────────────────────────────────────
    diffFieldTypes(path, oldField, newField) {
        const rel = compareTypes(oldField.type, newField.type);
        const oldDesc = describeType(oldField.type);
        const newDesc = describeType(newField.type);
        switch (rel) {
            case "same": return; // no change
            case "widened":
                this.emit(path, R.FIELD_TYPE_WIDENED, "field_type_widened", "safe", `Type widened from ${oldDesc} to ${newDesc}. ` +
                    `All existing values fit in the new type; reads and writes are safe.`, oldDesc, newDesc);
                break;
            case "narrowed":
                this.emit(path, R.FIELD_TYPE_NARROWED, "field_type_narrowed", "breaking_writer", `Type narrowed from ${oldDesc} to ${newDesc}. ` +
                    `Existing rows containing values outside the new type's range will fail validation or be rejected on next write.`, oldDesc, newDesc);
                break;
            case "incompatible":
                this.emit(path, R.FIELD_TYPE_INCOMPATIBLE, "field_type_incompatible", "breaking_both", `Type changed incompatibly from ${oldDesc} to ${newDesc}. ` +
                    `Existing readers will see unexpected data; existing writers will produce data the new schema rejects.`, oldDesc, newDesc);
                break;
        }
        // Nullability specifically (rel already handles this via compareTypes,
        // but we surface it as a separate named change for clarity)
        const wasNullable = oldField.type.kind === "nullable";
        const isNullable = newField.type.kind === "nullable";
        if (!wasNullable && isNullable) {
            this.emit(path, R.FIELD_MADE_NULLABLE, "field_made_nullable", "safe", `Field '${newField.name}' made nullable. Existing non-null values are still valid; ` +
                `readers should now handle NULL.`);
        }
        else if (wasNullable && !isNullable) {
            this.emit(path, R.FIELD_MADE_REQUIRED, "field_made_required", "breaking_writer", `Field '${newField.name}' made NOT NULL. Any existing NULL rows will violate the ` +
                `new constraint; a backfill migration is required before applying this change.`);
        }
    }
    // ── Enum ───────────────────────────────────────────────────────────────────
    diffEnums(oldEnum, newEnum) {
        const name = newEnum.name;
        const oldByOrd = indexBy(oldEnum.variants, v => v.ordinal);
        const newByOrd = indexBy(newEnum.variants, v => v.ordinal);
        const oldByName = indexBy(oldEnum.variants, v => v.name);
        const newByName = indexBy(newEnum.variants, v => v.name);
        // Removed variants
        for (const [ord, oldV] of oldByOrd) {
            if (!newByOrd.has(ord)) {
                const path = `${name}.${oldV.name}`;
                this.emit(path, E.VARIANT_REMOVED, "variant_removed", "breaking_reader", `Enum variant '${oldV.name}' (ordinal ${ord}) was removed. ` +
                    `Readers that encounter this value in existing data will fail to deserialize it.`, `${ord} ${oldV.name}`);
            }
        }
        // Added variants and changed variants
        for (const [ord, newV] of newByOrd) {
            const oldV = oldByOrd.get(ord);
            const path = `${name}.${newV.name}`;
            if (!oldV) {
                this.emit(path, E.VARIANT_ADDED, "variant_added", "warning", `Enum variant '${newV.name}' (ordinal ${ord}) was added. ` +
                    `Old code using exhaustive pattern matches may not handle this value.`, undefined, `${ord} ${newV.name}`);
                continue;
            }
            // Rename: same ordinal, different name
            if (oldV.name !== newV.name) {
                this.emit(`${name}.${oldV.name} → ${newV.name}`, E.VARIANT_RENAMED, "variant_renamed", "warning", `Variant with ordinal ${ord} renamed from '${oldV.name}' to '${newV.name}'. ` +
                    `Ordinal is stable so wire compatibility is maintained; ` +
                    `code referencing the old name needs updating.`, oldV.name, newV.name);
            }
        }
        // Renumbering: same name, different ordinal (dangerous — changes the wire value)
        for (const [vname, oldV] of oldByName) {
            const newV = newByName.get(vname);
            if (newV && oldV.ordinal !== newV.ordinal) {
                this.emit(`${name}.${vname}`, E.VARIANT_RENUMBERED, "variant_renumbered", "breaking_both", `Variant '${vname}' ordinal changed from ${oldV.ordinal} to ${newV.ordinal}. ` +
                    `Any serialized data using the old ordinal will be misread.`, String(oldV.ordinal), String(newV.ordinal));
            }
        }
    }
    // ── Emit helper ────────────────────────────────────────────────────────────
    emit(path, ruleId, kind, severity, rationale, before, after) {
        this.changes.push({ path, ruleId, kind, severity, rationale, before, after });
    }
}
// ── Build DiffResult ──────────────────────────────────────────────────────────
function buildResult(changes) {
    const breaking = changes.filter(c => c.severity === "breaking_reader" ||
        c.severity === "breaking_writer" ||
        c.severity === "breaking_both");
    const warnings = changes.filter(c => c.severity === "warning");
    return {
        changes,
        breaking,
        warnings,
        isCompatible(mode) {
            return this.violations(mode).length === 0;
        },
        violations(mode) {
            if (mode === "none")
                return [];
            return changes.filter(c => {
                switch (mode) {
                    case "backward":
                        return c.severity === "breaking_reader" || c.severity === "breaking_both";
                    case "forward":
                        return c.severity === "breaking_writer" || c.severity === "breaking_both";
                    case "full":
                        return c.severity === "breaking_reader"
                            || c.severity === "breaking_writer"
                            || c.severity === "breaking_both";
                }
            });
        },
    };
}
// ── Utility functions ─────────────────────────────────────────────────────────
/** Build a Map<name, Declaration> for declarations of a given kind */
function index(declarations, kind) {
    const map = new Map();
    for (const d of declarations) {
        if (d.kind === kind) {
            const name = d.name;
            map.set(name, d);
        }
    }
    return map;
}
/** Build a Map<K, V> using a key extractor */
function indexBy(items, key) {
    const map = new Map();
    for (const item of items)
        map.set(key(item), item);
    return map;
}
function describeField(f) {
    const ordinal = f.ordinal != null ? `${f.ordinal} ` : "";
    const access = f.private ? "private " : "";
    return `${ordinal}${access}${f.name}: ${describeType(f.type)}`;
}
function hasDecorator(field, name) {
    return field.decorators.some(d => d.name === name);
}
function referencesTarget(field) {
    for (const decorator of field.decorators) {
        if (decorator.name !== "references")
            continue;
        if (decorator.args.length === 0)
            return null;
        const value = decorator.args[0].value;
        if (value.kind === "ident" || value.kind === "string")
            return value.value;
    }
    return null;
}
function collectSuppressions(program) {
    const suppressions = [];
    for (const decl of program.declarations) {
        if (decl.kind === "model") {
            addSuppressions(suppressions, decl.directives, decl.name);
            for (const field of decl.members) {
                addSuppressions(suppressions, field.directives, `${decl.name}.${field.name}`);
            }
            continue;
        }
        if (decl.kind === "enum") {
            addSuppressions(suppressions, decl.directives, decl.name);
        }
    }
    return suppressions;
}
function addSuppressions(into, directives, scope) {
    for (const directive of directives) {
        if (directive.name !== "suppress")
            continue;
        if (directive.args.length === 0)
            continue;
        into.push({ scope, ruleId: directive.args[0] });
    }
}
function isSuppressed(change, suppressions) {
    return suppressions.some(s => change.ruleId === s.ruleId && change.path.includes(s.scope));
}
function typeRelationToSeverity(rel) {
    switch (rel) {
        case "widened": return "safe";
        case "narrowed": return "breaking_writer";
        case "incompatible": return "breaking_both";
    }
}
function typeRelationRationale(rel) {
    switch (rel) {
        case "widened": return "new type can represent all values of the old type";
        case "narrowed": return "new type cannot represent all values of the old type";
        case "incompatible": return "types are unrelated";
    }
}
//# sourceMappingURL=differ.js.map