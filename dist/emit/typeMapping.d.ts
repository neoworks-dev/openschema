import type { Decorator, DecoratorValue, TypeExpr, TypeAlias } from "../parser/ast.js";
import type { ResolvedModel, ResolvedField, ResolvedSchema } from "../resolver/types.js";
import type { EmitContext } from "./types.js";
/** Base-record fields an emitter should render, honouring includePrivate. */
export declare function baseFieldsToEmit(record: ResolvedModel, context: EmitContext): ResolvedField[];
/** The selected company's overlay fields for this record, or []. */
export declare function overlayFieldsToEmit(schema: ResolvedSchema, record: ResolvedModel, company: string | null): ResolvedField[];
export type VisibilityPhase = "read" | "create" | "update" | "delete" | "query";
export declare const INPUT_PHASES: VisibilityPhase[];
export declare const OUTPUT_PHASE: VisibilityPhase;
export declare function isVisibleIn(decorators: Decorator[], phase: VisibilityPhase): boolean;
/** True if the field belongs in an operation input (any input phase). */
export declare function isVisibleInInput(decorators: Decorator[]): boolean;
/** True if the field belongs in an operation output (the read phase). */
export declare function isVisibleInOutput(decorators: Decorator[]): boolean;
/**
 * A model-level @input marks the whole model as input-only: emitters skip its
 * output type / database table and emit it only as an input shape.
 */
export declare function isInputModel(model: ResolvedModel): boolean;
/** Find a decorator by its dotted name, e.g. "sql.type" or "table". */
export declare function findDecorator(decorators: Decorator[], name: string): Decorator | null;
export declare function hasDecorator(decorators: Decorator[], name: string): boolean;
/** Every decorator with the given dotted name (a name may repeat, e.g. multiple
 *  @neoworks.index declarations on one model). */
export declare function allDecorators(decorators: Decorator[], name: string): Decorator[];
/** The positional (unnamed) string arguments of a decorator, in order. */
export declare function positionalStringArgs(decorator: Decorator): string[];
/** First positional argument value of a decorator, as a plain string. */
export declare function firstStringArg(decorators: Decorator[], name: string): string | null;
/** A named argument of a decorator, as a plain string. E.g. the "text_en" in
 *  @neoworks.fulltext(analyzer: "text_en"). Returns null when absent. */
export declare function namedStringArg(decorators: Decorator[], name: string, argName: string): string | null;
export declare function decoratorValueToString(value: DecoratorValue): string | null;
/** Strip a single nullable wrapper, returning the inner type and a flag. */
export declare function unwrapNullable(type: TypeExpr): {
    inner: TypeExpr;
    nullable: boolean;
};
/** A model's primary-key field, or null when none is marked @primaryKey. */
export declare function primaryKeyField(model: ResolvedModel): ResolvedField | null;
/** The non-nullable type of a model's primary key. The resolver (OS1016) rejects
 * @link targets that lack exactly one @primaryKey, so the uuid branch is only a
 * defensive fallback for already-invalid schemas. */
export declare function primaryKeyType(model: ResolvedModel): TypeExpr;
export declare function modelByLocalName(name: string, schema: ResolvedSchema): ResolvedModel | null;
/** If `field` is @link, rewrite each named-model reference in its type to that
 * model's primary-key scalar, preserving array/nullable wrappers. Otherwise
 * returns the type unchanged. */
export declare function applyLink(type: TypeExpr, field: ResolvedField, schema: ResolvedSchema): TypeExpr;
/** snake_case a camelCase or PascalCase identifier. */
export declare function toSnakeCase(name: string): string;
/** The alias whose local name matches `name`, or null. Matches the enum/record
 * localName lookups used by the sql/surreal/internal emitters. */
export declare function aliasByLocalName(name: string, schema: ResolvedSchema): TypeAlias | null;
/** True if a named reference points at a union alias (`type G = A | B`). */
export declare function isUnionAlias(path: string[], schema: ResolvedSchema): boolean;
/** Every union alias in declaration order, for first-class named emission. */
export declare function unionAliases(schema: ResolvedSchema): {
    name: string;
    alias: TypeAlias;
}[];
/**
 * If `type` is a `named` reference to a NON-union alias, return its underlying
 * type with any generic type-params substituted, following alias→alias chains.
 * Union-alias and model/enum references are returned unchanged. Cycle-guarded.
 *
 * This resolves only the top node; deep inlining of nested references is the
 * resolver normalization pass's job. Emitters use it to resolve union variants.
 */
export declare function resolveAliasInline(type: TypeExpr, schema: ResolvedSchema, seen?: Set<string>): TypeExpr;
/** Rewrite `body`, replacing each bare type-param reference with its argument.
 * Builds new nodes; never mutates `body`. */
export declare function substituteTypeParams(body: TypeExpr, paramNames: string[], typeArgs: TypeExpr[]): TypeExpr;
//# sourceMappingURL=typeMapping.d.ts.map