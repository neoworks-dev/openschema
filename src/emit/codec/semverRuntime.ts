// src/emit/codec/semverRuntime.ts
// The runtime for `semver` values, emitted only into codecs whose schema uses the
// type, so codecs without one keep their exact output. The layout is a LEN body of
// three varints, major then minor then patch, each an unsigned 32-bit integer.

import type { ModelPlan, ValueShape } from "./plan.js";

/** Whether a field of any plan holds a `semver`, directly or inside a oneof. */
export function usesSemver(plans: ModelPlan[]): boolean {
  return plans.some(plan => plan.fields.some(field => holdsSemver(field.value)));
}

function holdsSemver(value: ValueShape): boolean {
  if (value.kind === "scalar") return value.scalar === "semver";
  if (value.kind !== "oneof") return false;
  return value.variants.some(variant => holdsSemver(variant.value));
}

export const SEMVER_RUNTIME = String.raw`
// ── semver ────────────────────────────────────────────────────────────────────

const MAX_SEMVER_PART = 4294967295;

function requireSemverPart(value: number, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CodecError("BAD_SEMVER", path, "a semver part must be an integer");
  }
  if (value < 0 || value > MAX_SEMVER_PART) {
    throw new CodecError("BAD_SEMVER", path, "a semver part must be between 0 and " + MAX_SEMVER_PART);
  }
  return value;
}

function writeSemver(writer: Writer, value: { major: number; minor: number; patch: number }, path: string): void {
  const lengthOffset = writer.beginNested();
  writer.varintNumber(requireSemverPart(value.major, path + ".major"));
  writer.varintNumber(requireSemverPart(value.minor, path + ".minor"));
  writer.varintNumber(requireSemverPart(value.patch, path + ".patch"));
  writer.endNested(lengthOffset);
}

function readSemverField(reader: Reader, wire: number, path: string): { major: number; minor: number; patch: number } {
  expectWire(wire, WIRE_LEN, path);
  const body = reader.packed(path);
  const major = readSemverPart(body, path);
  const minor = readSemverPart(body, path);
  const patch = readSemverPart(body, path);
  if (body.hasMore()) throw new CodecError("BAD_SEMVER", path, "a semver holds exactly three numbers");
  return { major, minor, patch };
}

function readSemverPart(body: Reader, path: string): number {
  if (!body.hasMore()) throw new CodecError("BAD_SEMVER", path, "a semver holds exactly three numbers");
  const part = body.varintUnsigned(path);
  if (part > MAX_SEMVER_PART) {
    throw new CodecError("BAD_SEMVER", path, "a semver part must be between 0 and " + MAX_SEMVER_PART);
  }
  return part;
}
`;
