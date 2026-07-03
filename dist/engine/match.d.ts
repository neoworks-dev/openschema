import type * as AST from "../parser/ast.js";
export interface NamedDecl {
    name: string;
    decorators: AST.Decorator[];
}
export interface DeclPair<T> {
    oldDecl: T;
    newDecl: T;
    oldName: string;
    newName: string;
    renamed: boolean;
}
export interface DeclMatch<T> {
    pairs: DeclPair<T>[];
    removed: T[];
    added: T[];
}
/** The old name a declaration claims to have been renamed from, via @renamed("Old"). */
export declare function renamedFrom(decl: NamedDecl): string | null;
/**
 * Pair up old and new declarations by name, treating a new declaration that
 * carries @renamed("Old") as the continuation of the removed "Old" rather than
 * a remove + add. A @renamed pointing at a still-present name is ignored.
 */
export declare function matchDeclarations<T extends NamedDecl>(oldMap: Map<string, T>, newMap: Map<string, T>): DeclMatch<T>;
export interface OrdinalPair<T> {
    oldItem: T | null;
    newItem: T | null;
}
/**
 * Pair items (fields, enum variants) by ordinal. Each result holds the old
 * and/or new item sharing one ordinal: both present = a match (possibly
 * renamed/retyped), old-only = removed, new-only = added. Order follows the new
 * items first (ascending insertion), then any old-only items.
 */
export declare function pairByOrdinal<T extends {
    ordinal: number | null;
}>(oldItems: T[], newItems: T[]): OrdinalPair<T>[];
//# sourceMappingURL=match.d.ts.map