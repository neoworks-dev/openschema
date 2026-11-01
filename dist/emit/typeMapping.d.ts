import type { Decorator, DecoratorValue, TypeExpr, TypeAlias } from "../parser/ast.js";
import type { ResolvedModel, ResolvedField, ResolvedSchema } from "../resolver/types.js";
import type { EmitContext } from "./types.js";
export declare const FILE_TS: string;
export declare const FILE_JSON_SCHEMA: {
    type: string;
    required: string[];
    properties: {
        objectId: {
            type: string;
            format: string;
        };
        name: {
            type: string;
        };
        mediaType: {
            type: string;
        };
        size: {
            type: string;
            minimum: number;
        };
        variants: {
            type: string;
            additionalProperties: {
                type: string;
                required: string[];
                properties: {
                    objectId: {
                        type: string;
                        format: string;
                    };
                    size: {
                        type: string;
                        minimum: number;
                    };
                };
            };
        };
    };
};
export declare const SEMVER_TS = "{ major: number; minor: number; patch: number }";
export declare const SEMVER_ZOD: string;
export declare const SEMVER_PATTERN = "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$";
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
/**
 * A model-level @value marks an embedded value object: it is stored inline (as
 * JSON) in every model that uses it and never gets a table of its own.
 */
export declare function isValueModel(model: ResolvedModel): boolean;
/**
 * A model-level @abstract marks a shared base that is never stored on its own:
 * only the models extending it are. GraphQL renders it as an interface.
 */
export declare function isAbstractModel(model: ResolvedModel): boolean;
/** True when a database target gives this model a table: not generic, @input, @value or @abstract. */
export declare function isTableModel(model: ResolvedModel): boolean;
/** The model a `ref<T>` type names, or null when the type is not a reference. */
export declare function referencedModel(type: TypeExpr, schema: ResolvedSchema): ResolvedModel | null;
/** Every concrete (non-abstract) model extending `base`, directly or through other bases. */
export declare function concreteSubtypes(base: ResolvedModel, schema: ResolvedSchema): ResolvedModel[];
/** True when `record` has `base` somewhere in its extends chain. */
export declare function extendsModel(record: ResolvedModel, base: ResolvedModel): boolean;
/** The abstract models in a record's extends chain, nearest first. */
export declare function abstractAncestors(record: ResolvedModel, schema: ResolvedSchema): ResolvedModel[];
/** The closest @abstract model in a record's extends chain, or null. */
export declare function nearestAbstractAncestor(record: ResolvedModel, schema: ResolvedSchema): ResolvedModel | null;
/** The fields a record adds on top of `base` (all of them when there is no base). */
export declare function fieldsBeyond(fields: ResolvedField[], base: ResolvedModel | null): ResolvedField[];
/** Records reordered so every @abstract base comes before the models extending it. */
export declare function abstractBasesFirst(records: ResolvedModel[], schema: ResolvedSchema): ResolvedModel[];
/** The abstract model a named type points at, or null. */
export declare function abstractModelOf(type: TypeExpr, schema: ResolvedSchema): ResolvedModel | null;
/** Find a decorator by its dotted name, e.g. "sql.type" or "table". */
export declare function findDecorator(decorators: Decorator[], name: string): Decorator | null;
export declare function hasDecorator(decorators: Decorator[], name: string): boolean;
/** Every decorator with the given dotted name; a name may repeat on one element. */
export declare function allDecorators(decorators: Decorator[], name: string): Decorator[];
/** The positional (unnamed) string arguments of a decorator, in order. */
export declare function positionalStringArgs(decorator: Decorator): string[];
/** First positional argument value of a decorator, as a plain string. */
export declare function firstStringArg(decorators: Decorator[], name: string): string | null;
/** A named list argument of a decorator whose elements are all strings or names, e.g. `fields`
 *  in @neoworks.index(fields: ["calendar", "start"]). Returns null when absent or not such a list. */
export declare function namedStringListArg(decorator: Decorator, argName: string): string[] | null;
export declare function decoratorValueToString(value: DecoratorValue): string | null;
/** Strip a single nullable wrapper, returning the inner type and a flag. */
export declare function unwrapNullable(type: TypeExpr): {
    inner: TypeExpr;
    nullable: boolean;
};
export declare function modelByLocalName(name: string, schema: ResolvedSchema): ResolvedModel | null;
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