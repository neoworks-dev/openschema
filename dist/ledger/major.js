// src/ledger/major.ts
// The major of a version, as Cargo reads it: the leftmost non-zero component of
// major.minor.patch with everything to its right dropped. Versions on the same
// major must stay compatible; a new major may break the earlier ones. This is
// the rule the registry applies when it accepts a publish.
const PLAIN_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** "2" for 2.3.4, "0.3" for 0.3.4 and "0.0.4" for 0.0.4; null when `version` is not major.minor.patch. */
export function majorOf(version) {
    const parts = PLAIN_VERSION.exec(version);
    if (parts === null)
        return null;
    if (parts[1] !== "0")
        return parts[1];
    if (parts[2] !== "0")
        return `0.${parts[2]}`;
    return `0.0.${parts[3]}`;
}
/** True when `current` is a later major than `recorded`, both as written by `majorOf`. */
export function majorPrecedes(recorded, current) {
    const recordedParts = majorParts(recorded);
    const currentParts = majorParts(current);
    for (let index = 0; index < 3; index++) {
        if (recordedParts[index] !== currentParts[index])
            return recordedParts[index] < currentParts[index];
    }
    return false;
}
function majorParts(major) {
    const parts = major.split(".").map(Number);
    while (parts.length < 3)
        parts.push(0);
    return parts;
}
/** The lowest version on the next major, such as 3.0.0 after 2.3.4. */
export function nextMajorVersion(version) {
    const major = majorOf(version);
    if (major === null)
        return null;
    const parts = majorParts(major);
    if (parts[0] > 0)
        return `${parts[0] + 1}.0.0`;
    if (parts[1] > 0)
        return `0.${parts[1] + 1}.0`;
    return `0.0.${parts[2] + 1}`;
}
//# sourceMappingURL=major.js.map