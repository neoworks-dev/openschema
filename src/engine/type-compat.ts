// src/engine/type-compat.ts
// Analyses whether a type change is a widening, narrowing, or incompatible.

import type { TypeExpr, ScalarKind } from "../parser/ast.js";

// ── Relation ──────────────────────────────────────────────────────────────────

export type TypeRelation =
  | "same"         // identical
  | "widened"      // new type is a superset of old — safe
  | "narrowed"     // new type is a subset of old   — breaking_writer (data may not fit)
  | "incompatible" // unrelated types               — breaking_both

// ── Numeric widening table ────────────────────────────────────────────────────
//
//  Entry "A:B" means A can safely widen to B (every value of A fits in B).
//  Missing entries are not safe widenings in either direction.

const NUMERIC_WIDENS = new Set<string>([
  // Signed integers
  "i8:i16",  "i8:i32",  "i8:i64",
  "i16:i32", "i16:i64",
  "i32:i64",
  // Unsigned integers
  "u8:u16",  "u8:u32",  "u8:u64",
  "u16:u32", "u16:u64",
  "u32:u64",
  // Unsigned → wider signed (unsigned max fits in wider signed)
  "u8:i16",  "u8:i32",  "u8:i64",
  "u16:i32", "u16:i64",
  "u32:i64",
  // Floats
  "f32:f64",
]);

function scalarRelation(a: ScalarKind, b: ScalarKind): TypeRelation {
  if (a === b)                        return "same";
  if (NUMERIC_WIDENS.has(`${a}:${b}`)) return "widened";
  if (NUMERIC_WIDENS.has(`${b}:${a}`)) return "narrowed";
  return "incompatible";
}

// ── Public function ───────────────────────────────────────────────────────────

/**
 * Returns the relation between `oldType` and `newType` from the perspective
 * of stored data and existing application code.
 *
 *   "widened"      → safe: new type accepts everything the old one did
 *   "narrowed"     → breaking_writer: old data or writes may exceed new type
 *   "incompatible" → breaking_both: types are unrelated
 *   "same"         → no change
 */
export function compareTypes(oldType: TypeExpr, newType: TypeExpr): TypeRelation {
  // ── Nullable promotions ────────────────────────────────────────────────────
  //  T  → T?   widened  (new schema accepts null in addition to T)
  //  T? → T    narrowed (new schema rejects null values in existing data)

  const oldIsNullable = oldType.kind === "nullable";
  const newIsNullable = newType.kind === "nullable";

  const oldInner = oldIsNullable ? (oldType as { inner: TypeExpr }).inner : oldType;
  const newInner = newIsNullable ? (newType as { inner: TypeExpr }).inner : newType;

  const innerRel = compareInner(oldInner, newInner);

  if (oldIsNullable === newIsNullable) return innerRel;           // nullability unchanged
  if (!oldIsNullable &&  newIsNullable) return merge(innerRel, "widened");   // became nullable
  if ( oldIsNullable && !newIsNullable) return merge(innerRel, "narrowed");  // became required
  return innerRel; // unreachable
}

/** Merge two relations: take the "worse" of the two. */
function merge(a: TypeRelation, b: TypeRelation): TypeRelation {
  const rank: Record<TypeRelation, number> = {
    same: 0, widened: 1, narrowed: 2, incompatible: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

function compareInner(oldType: TypeExpr, newType: TypeExpr): TypeRelation {
  // Strip nullable wrappers so recursion doesn't double-count them
  if (oldType.kind === "nullable" || newType.kind === "nullable") {
    return compareTypes(oldType, newType);
  }

  // ── Scalar ─────────────────────────────────────────────────────────────────
  if (oldType.kind === "scalar" && newType.kind === "scalar") {
    return scalarRelation(oldType.scalar, newType.scalar);
  }

  // ── Decimal ────────────────────────────────────────────────────────────────
  //  Larger (precision, scale) = widened if both dimensions grow.
  //  Mixed = incompatible (changing scale changes the value space).
  if (oldType.kind === "decimal" && newType.kind === "decimal") {
    const precRel = numericCompare(oldType.precision, newType.precision);
    const scaleRel = numericCompare(oldType.scale, newType.scale);
    if (precRel === "same"    && scaleRel === "same")    return "same";
    if (precRel !== "narrowed" && scaleRel !== "narrowed") return "widened";
    if (precRel === "narrowed" && scaleRel === "narrowed") return "narrowed";
    return "incompatible"; // one grew, one shrank — value space changed shape
  }

  // ── Named ──────────────────────────────────────────────────────────────────
  //  Without a full registry we can't resolve imported types — compare by name,
  //  including generic type arguments so Page<Order> differs from Page<Customer>.
  if (oldType.kind === "named" && newType.kind === "named") {
    return describeType(oldType) === describeType(newType) ? "same" : "incompatible";
  }

  // ── Array ──────────────────────────────────────────────────────────────────
  //  Arrays are covariant for read purposes but invariant for write —
  //  treat as same iff element types are same, widened/narrowed otherwise.
  if (oldType.kind === "array" && newType.kind === "array") {
    return compareTypes(oldType.element, newType.element);
  }

  // ── Map ────────────────────────────────────────────────────────────────────
  if (oldType.kind === "map" && newType.kind === "map") {
    const keyRel = compareTypes(oldType.key, newType.key);
    const valRel = compareTypes(oldType.value, newType.value);
    return merge(keyRel, valRel);
  }

  // ── Union ──────────────────────────────────────────────────────────────────
  //  Adding a variant = widened (new type accepts more values).
  //  Removing a variant = narrowed (existing data may not match new schema).
  if (oldType.kind === "union" && newType.kind === "union") {
    return compareUnions(oldType.variants, newType.variants);
  }

  // ── Oneof ──────────────────────────────────────────────────────────────────
  //  Compare by ordinal, same logic as union variants.
  if (oldType.kind === "oneof" && newType.kind === "oneof") {
    return compareOneofs(oldType.variants, newType.variants);
  }

  // ── Mixed kinds ────────────────────────────────────────────────────────────
  return "incompatible";
}

// ── Union comparison ─────────────────────────────────────────────────────────

function compareUnions(
  oldVariants: TypeExpr[],
  newVariants: TypeExpr[]
): TypeRelation {
  // Represent variants as description strings for cheap set membership checks.
  const oldSet = new Set(oldVariants.map(describeType));
  const newSet = new Set(newVariants.map(describeType));

  const added   = [...newSet].some(t => !oldSet.has(t));
  const removed = [...oldSet].some(t => !newSet.has(t));

  if (!added && !removed) return "same";
  if ( added && !removed) return "widened";
  if (!added &&  removed) return "narrowed";
  return "incompatible"; // both added and removed — restructured
}

// ── Oneof comparison ─────────────────────────────────────────────────────────

function compareOneofs(
  oldVariants: Array<{ ordinal: number; name: string; type: TypeExpr }>,
  newVariants: Array<{ ordinal: number; name: string; type: TypeExpr }>
): TypeRelation {
  const oldMap = new Map(oldVariants.map(v => [v.ordinal, v]));
  const newMap = new Map(newVariants.map(v => [v.ordinal, v]));

  let rel: TypeRelation = "same";

  for (const [ord, oldV] of oldMap) {
    const newV = newMap.get(ord);
    if (!newV) { rel = merge(rel, "narrowed"); continue; }
    rel = merge(rel, compareTypes(oldV.type, newV.type));
  }
  for (const ord of newMap.keys()) {
    if (!oldMap.has(ord)) rel = merge(rel, "widened");
  }
  return rel;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function numericCompare(a: number, b: number): TypeRelation {
  if (a === b) return "same";
  return a < b ? "widened" : "narrowed";
}

/** Produces a canonical string description of a type — used for set operations. */
export function describeType(t: TypeExpr): string {
  switch (t.kind) {
    case "scalar":   return t.scalar;
    case "decimal":  return `decimal(${t.precision},${t.scale})`;
    case "named": {
      const base = t.path.join(".");
      if (t.typeArgs.length === 0) return base;
      return `${base}<${t.typeArgs.map(describeType).join(",")}>`;
    }
    case "array":    return `[${describeType(t.element)}]`;
    case "map":      return `{${describeType(t.key)}:${describeType(t.value)}}`;
    case "nullable": return `${describeType(t.inner)}?`;
    case "union":    return t.variants.map(describeType).join("|");
    case "oneof":    return `oneof{${t.variants.map(v => `${v.ordinal}:${describeType(v.type)}`).join(",")}}`;
  }
}