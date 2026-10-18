// src/emit/codec/filePlan.ts
// The built-in `File` type is encoded as an ordinary message, so it goes through
// the same generators as a model. Its layout is fixed here, and the descriptor
// consumers (libneoworks) implement the same one:
//
//   File         1 objectId: uuid   2 name: string   3 mediaType: string
//                4 size: u64        5 variants: {string: FileVariant}
//                6 key: bytes, the 32-byte key of the file's objects
//   FileVariant  1 objectId: uuid   2 size: u64
import { FILE_MESSAGE_NAME, renderTsType } from "./plan.js";
export const FILE_VARIANT_MESSAGE_NAME = "FileVariant";
const NO_SPAN = { line: 0, col: 0 };
function scalar(scalarKind) {
    return { kind: "scalar", scalar: scalarKind };
}
function field(ordinal, name, container, value) {
    return {
        ordinal,
        name,
        accessor: `.${name}`,
        container,
        value,
        tsType: renderTsType(container, value),
        required: container.kind === "singular",
        span: NO_SPAN,
    };
}
const SINGULAR = { kind: "singular", nullable: false };
export function fileModelPlans() {
    return [
        {
            name: FILE_MESSAGE_NAME,
            fields: [
                field(1, "objectId", SINGULAR, scalar("uuid")),
                field(2, "name", SINGULAR, scalar("string")),
                field(3, "mediaType", SINGULAR, scalar("string")),
                field(4, "size", SINGULAR, scalar("u64")),
                field(5, "variants", { kind: "map", key: "string" }, { kind: "message", name: FILE_VARIANT_MESSAGE_NAME }),
                field(6, "key", SINGULAR, scalar("bytes")),
            ],
        },
        {
            name: FILE_VARIANT_MESSAGE_NAME,
            fields: [
                field(1, "objectId", SINGULAR, scalar("uuid")),
                field(2, "size", SINGULAR, scalar("u64")),
            ],
        },
    ];
}
/** Whether a field of any plan holds a `File`, directly or inside a oneof. */
export function usesFile(plans) {
    return plans.some(plan => plan.fields.some(planField => holdsFile(planField.value)));
}
function holdsFile(value) {
    if (value.kind === "file")
        return true;
    if (value.kind !== "oneof")
        return false;
    return value.variants.some(variant => holdsFile(variant.value));
}
//# sourceMappingURL=filePlan.js.map