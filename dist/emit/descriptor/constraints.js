// src/emit/descriptor/constraints.ts
// The validation decorators, read into the constraints a runtime enforces.
// A decorator that cannot apply to the field's type is an error rather than
// ignored: a validator that silently checks nothing is worse than none.
import { DescriptorError } from "./errors.js";
const NUMERIC_SCALARS = new Set([
    "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "f32", "f64",
]);
const LENGTH_SCALARS = new Set(["string", "bytes"]);
const TEXT_SCALARS = new Set(["string"]);
const RULES = {
    minValue: { scalars: NUMERIC_SCALARS, read: readFiniteNumber },
    maxValue: { scalars: NUMERIC_SCALARS, read: readFiniteNumber },
    minLength: { scalars: LENGTH_SCALARS, read: readLength },
    maxLength: { scalars: LENGTH_SCALARS, read: readLength },
    pattern: { scalars: TEXT_SCALARS, read: readPattern },
    format: { scalars: TEXT_SCALARS, read: readText },
};
export function describeConstraints(model, field, value) {
    const constraints = {};
    for (const decorator of field.decorators) {
        const rule = RULES[decorator.name];
        if (rule === undefined)
            continue;
        storeConstraint(constraints, decorator.name, readConstraint(model, field, value, decorator, rule));
    }
    return constraints;
}
function readConstraint(model, field, value, decorator, rule) {
    if (value.kind !== "scalar" || !rule.scalars.has(value.scalar)) {
        throw new DescriptorError("OSD009", model, field.name, `@${decorator.name} does not apply to a value of this type`, decorator.span);
    }
    const argument = decorator.args[0];
    let parsed = null;
    if (decorator.args.length === 1 && argument.name === null)
        parsed = rule.read(argument.value);
    if (parsed === null) {
        throw new DescriptorError("OSD009", model, field.name, `@${decorator.name} has an invalid argument`, decorator.span);
    }
    return parsed;
}
function storeConstraint(constraints, name, value) {
    constraints[name] = value;
}
function readFiniteNumber(value) {
    if (value.kind !== "number" || !Number.isFinite(value.value))
        return null;
    return value.value;
}
function readLength(value) {
    if (value.kind !== "number" || !Number.isInteger(value.value) || value.value < 0)
        return null;
    return value.value;
}
function readText(value) {
    if (value.kind !== "string")
        return null;
    return value.value;
}
function readPattern(value) {
    if (value.kind !== "string")
        return null;
    try {
        new RegExp(value.value, "u");
    }
    catch {
        return null;
    }
    return value.value;
}
//# sourceMappingURL=constraints.js.map