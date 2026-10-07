// src/emit/descriptor/constraints.ts
// The validation decorators, read into the constraints a runtime enforces.
// A decorator that cannot apply to the field's type is an error rather than
// ignored: a validator that silently checks nothing is worse than none.

import type { Decorator, DecoratorValue, ScalarKind } from "../../parser/ast.js";
import type { ResolvedField } from "../../resolver/types.js";
import type { ValueShape } from "../codec/plan.js";
import type { ValueConstraints } from "./descriptorTypes.js";
import { DescriptorError } from "./errors.js";

const NUMERIC_SCALARS: ReadonlySet<ScalarKind> = new Set<ScalarKind>([
  "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "f32", "f64",
]);
const LENGTH_SCALARS: ReadonlySet<ScalarKind> = new Set<ScalarKind>(["string", "bytes"]);
const TEXT_SCALARS: ReadonlySet<ScalarKind> = new Set<ScalarKind>(["string"]);

type ConstraintName = keyof ValueConstraints;

interface ConstraintRule {
  scalars: ReadonlySet<ScalarKind>;
  read:    (value: DecoratorValue) => number | string | null;
}

const RULES: Record<string, ConstraintRule> = {
  minValue:  { scalars: NUMERIC_SCALARS, read: readFiniteNumber },
  maxValue:  { scalars: NUMERIC_SCALARS, read: readFiniteNumber },
  minLength: { scalars: LENGTH_SCALARS,  read: readLength },
  maxLength: { scalars: LENGTH_SCALARS,  read: readLength },
  pattern:   { scalars: TEXT_SCALARS,    read: readPattern },
  format:    { scalars: TEXT_SCALARS,    read: readText },
};

export function describeConstraints(model: string, field: ResolvedField, value: ValueShape): ValueConstraints {
  const constraints: ValueConstraints = {};
  for (const decorator of field.decorators) {
    const rule = RULES[decorator.name];
    if (rule === undefined) continue;
    storeConstraint(constraints, decorator.name as ConstraintName, readConstraint(model, field, value, decorator, rule));
  }
  return constraints;
}

function readConstraint(
  model: string,
  field: ResolvedField,
  value: ValueShape,
  decorator: Decorator,
  rule: ConstraintRule,
): number | string {
  if (value.kind !== "scalar" || !rule.scalars.has(value.scalar)) {
    throw new DescriptorError("OSD009", model, field.name,
      `@${decorator.name} does not apply to a value of this type`, decorator.span);
  }
  const argument = decorator.args[0];
  let parsed: number | string | null = null;
  if (decorator.args.length === 1 && argument.name === null) parsed = rule.read(argument.value);
  if (parsed === null) {
    throw new DescriptorError("OSD009", model, field.name,
      `@${decorator.name} has an invalid argument`, decorator.span);
  }
  return parsed;
}

function storeConstraint(constraints: ValueConstraints, name: ConstraintName, value: number | string): void {
  (constraints as Record<ConstraintName, number | string>)[name] = value;
}

function readFiniteNumber(value: DecoratorValue): number | null {
  if (value.kind !== "number" || !Number.isFinite(value.value)) return null;
  return value.value;
}

function readLength(value: DecoratorValue): number | null {
  if (value.kind !== "number" || !Number.isInteger(value.value) || value.value < 0) return null;
  return value.value;
}

function readText(value: DecoratorValue): string | null {
  if (value.kind !== "string") return null;
  return value.value;
}

function readPattern(value: DecoratorValue): string | null {
  if (value.kind !== "string") return null;
  try {
    new RegExp(value.value, "u");
  } catch {
    return null;
  }
  return value.value;
}
