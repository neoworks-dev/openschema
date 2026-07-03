// src/engine/match.ts
// Shared identity-matching primitives used by both the differ and the migration
// planner, so the two never disagree on what counts as a rename vs a remove+add.
//
//   Declarations (records/enums/aliases) → matched by name; a new declaration
//   carrying @renamed("Old") continues the removed "Old" rather than being a
//   remove + add.
//   Fields / enum variants → matched by ordinal (the stable wire identity).
/** The old name a declaration claims to have been renamed from, via @renamed("Old"). */
export function renamedFrom(decl) {
    for (const decorator of decl.decorators) {
        if (decorator.name !== "renamed")
            continue;
        if (decorator.args.length === 0)
            return null;
        const value = decorator.args[0].value;
        if (value.kind === "string" || value.kind === "ident")
            return value.value;
    }
    return null;
}
/**
 * Pair up old and new declarations by name, treating a new declaration that
 * carries @renamed("Old") as the continuation of the removed "Old" rather than
 * a remove + add. A @renamed pointing at a still-present name is ignored.
 */
export function matchDeclarations(oldMap, newMap) {
    const renameTargets = new Map();
    for (const newDecl of newMap.values()) {
        const oldName = renamedFrom(newDecl);
        if (oldName !== null && !newMap.has(oldName))
            renameTargets.set(oldName, newDecl);
    }
    const pairs = [];
    const removed = [];
    const consumedNew = new Set();
    for (const [oldName, oldDecl] of oldMap) {
        const direct = newMap.get(oldName);
        if (direct !== undefined) {
            pairs.push({ oldDecl, newDecl: direct, oldName, newName: oldName, renamed: false });
            consumedNew.add(oldName);
            continue;
        }
        const renamedTo = renameTargets.get(oldName);
        if (renamedTo !== undefined) {
            pairs.push({ oldDecl, newDecl: renamedTo, oldName, newName: renamedTo.name, renamed: true });
            consumedNew.add(renamedTo.name);
            continue;
        }
        removed.push(oldDecl);
    }
    const added = [];
    for (const [newName, newDecl] of newMap) {
        if (!consumedNew.has(newName))
            added.push(newDecl);
    }
    return { pairs, removed, added };
}
/**
 * Pair items (fields, enum variants) by ordinal. Each result holds the old
 * and/or new item sharing one ordinal: both present = a match (possibly
 * renamed/retyped), old-only = removed, new-only = added. Order follows the new
 * items first (ascending insertion), then any old-only items.
 */
export function pairByOrdinal(oldItems, newItems) {
    const oldByOrd = indexByOrdinal(oldItems);
    const newByOrd = indexByOrdinal(newItems);
    const pairs = [];
    for (const [ord, newItem] of newByOrd) {
        pairs.push({ oldItem: oldByOrd.get(ord) ?? null, newItem });
    }
    for (const [ord, oldItem] of oldByOrd) {
        if (!newByOrd.has(ord))
            pairs.push({ oldItem, newItem: null });
    }
    return pairs;
}
function indexByOrdinal(items) {
    const map = new Map();
    for (const item of items) {
        if (item.ordinal != null)
            map.set(item.ordinal, item);
    }
    return map;
}
//# sourceMappingURL=match.js.map