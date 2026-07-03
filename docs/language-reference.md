# Language Reference

This is the complete reference for the OpenSchema language. Each section is
self-contained and includes runnable examples. If you are new, read
[Getting Started](./getting-started.md) first.

## Contents

- [Comments and documentation](#comments-and-documentation)
- [Namespaces](#namespaces)
- [Models and fields](#models-and-fields)
- [Escaped identifiers](#escaped-identifiers)
- [Ordinals (field numbers)](#ordinals-field-numbers)
- [Scalar types](#scalar-types)
- [Composite types](#composite-types-arrays-maps-nullable)
- [Unions and oneof](#unions-and-oneof)
- [Enums](#enums)
- [Type aliases](#type-aliases)
- [Inheritance with `extends`](#inheritance-with-extends)
- [Generics (templates)](#generics-templates)
- [Decorators](#decorators)
- [Directives](#directives)
- [Private fields](#private-fields)
- [Operations and interfaces](#operations-and-interfaces)
- [Overlays](#overlays)
- [Imports across files](#imports-across-files)

---

## Comments and documentation

Three comment forms:

```openschema
// a line comment — ignored
/* a block comment,
   possibly spanning lines — ignored */
/// a doc comment — attached to the next declaration or field
```

Doc comments (`///`) are not discarded; they are captured and travel with the
declaration into generated output (for example, as JSDoc in TypeScript).

```openschema
/// A user account.
model User {
  /// The user's primary email address.
  1 email: string
}
```

---

## Namespaces

A file declares one namespace, which qualifies every type it defines.

```openschema
namespace myorg.billing

model Invoice { 1 id: uuid }
```

`Invoice` is now globally known as `myorg.billing.Invoice`. Other files can
refer to it by that qualified name, or import it by its short name (see
[Imports](#imports-across-files)). A namespace is dotted and can be as deep as
you like (`myorg.billing.v2`).

A file without a `namespace` line is still valid; its types are known by their
bare names.

---

## Models and fields

A **model** is a structured type — a named bag of fields.

```openschema
model Customer {
  1 id:    uuid
  2 name:  string
  3 email: string
}
```

A **field** has the shape:

```
[decorators] [directives] ORDINAL [private] name: type
```

Only the ordinal, name, colon, and type are required. The simplest field is
`1 id: uuid`. The most decorated might be:

```openschema
model Account {
  @primaryKey @default(gen_uuid())
  1 id: uuid

  @format("email")
  2 email: string

  100 private internalRiskScore: f32?
}
```

---

## Escaped identifiers

Any name — a model, field, enum variant, or type — can be wrapped in backticks
to use text that is otherwise illegal as an identifier: a reserved keyword, or a
name containing spaces or symbols.

```openschema
model `User Account` {
  1 `type`:  string     // `type` is a keyword, escaped here as a field name
  2 `model`: i32        // so is `model`
  3 `gross $`: decimal(12, 2)
}
```

The backticks are not part of the name; `` `type` `` is the identifier `type`.
Use this when you must mirror an external system's naming (a column called
`select`, a field with a space) that would otherwise collide with the language.

> Names with spaces or symbols may need escaping in some generated targets (a
> SQL column, a GraphQL field). Prefer ordinary identifiers unless you have a
> reason to escape.

---

## Ordinals (field numbers)

Every field starts with an integer **ordinal**. This is the single most
important idea in OpenSchema.

The ordinal is the field's **permanent identity**. The field name is just a
label that humans and generated code use; the ordinal is what the schema, the
diff engine, and any binary encoding key on.

```openschema
model Person {
  1 fullName: string
}
```

Rename the field but keep its ordinal, and the change is provably a rename:

```openschema
model Person {
  1 name: string   // ordinal 1 unchanged → this is a safe rename
}
```

Rules:

- Ordinals must be **unique** within a model.
- They may have **gaps** and need not be in order (`1`, `2`, `5` is fine).
- Once a field is removed, **do not reuse its ordinal** for a different field —
  the same discipline as Protobuf `reserved`. The compatibility checker assumes
  ordinals are stable identities.

Why this matters: tools that key on field *names* (JSON Schema, plain GraphQL)
cannot tell a rename apart from "delete the old field, add a new one." With
ordinals, OpenSchema can — so it never falsely flags a rename as a breaking
change, and never misses a genuine removal. See
[Compatibility Checking](./compatibility.md).

---

## Scalar types

Primitive types built into the language:

| Type | Meaning |
|------|---------|
| `bool` | boolean |
| `i8` `i16` `i32` `i64` | signed integers of the given bit width |
| `u8` `u16` `u32` `u64` | unsigned integers |
| `f32` `f64` | IEEE floating point |
| `decimal(p, s)` | fixed-point decimal with precision `p`, scale `s` |
| `string` | UTF-8 text |
| `bytes` | raw bytes |
| `json` | arbitrary JSON value (object, array or scalar) |
| `uuid` | UUID |
| `date` | calendar date |
| `time` | time of day |
| `timestamp` | date + time |
| `duration` | a length of time |

```openschema
model Measurement {
  1 id:      uuid
  2 takenAt: timestamp

  @minValue(0)
  3 celsius: f64

  4 amount: decimal(10, 4)
}
```

The bit widths are meaningful: they drive the generated SQL column type
(`i32` → `INTEGER`, `i64` → `BIGINT`) and let the compatibility checker reason
about widening (`i32` → `i64` is safe; the reverse is not). See
[Code Generation](./code-generation.md).

---

## Composite types: arrays, maps, nullable

Build larger types from smaller ones:

```openschema
model Document {
  1 tags:      [string]              // array (list) of strings
  2 headers:   {string: string}     // map from string keys to string values
  3 title:     string?              // nullable — may be absent / null
  4 revisions: [Revision]?          // a nullable list of models
}
```

- `[T]` — an ordered list of `T`.
- `[T; n]` — a list bounded to exactly `n` elements; `[T; min..max]` bounds the
  length to a range (`min..` and `..max` leave one end open). Bounds travel with
  the type, so they apply at any nesting depth and through alias inlining.
- `{K: V}` — a map with keys of type `K` and values of type `V`.
- `T?` — `T` or null. A field **without** `?` is required.

These nest freely: `[{string: [i32]}]` is a list of maps from strings to lists
of integers.

Array length can also be set per field with `@minItems(n)` / `@maxItems(n)` /
`@length(n)` (exact). Those decorators only bound the field's **outermost** array;
for inner arrays use the type-level `[T; …]` form. Bounds emit as `minItems`/
`maxItems` (JSON Schema, OpenAPI) and `array<T, max>` plus an `array::len` ASSERT
(SurrealDB); other targets ignore them.

---

## Unions and oneof

Two ways to say "one of several types."

An **untagged union** with `|` — the value is any one of the listed types:

```openschema
model Event {
  1 payload: string | i64 | bool
}
```

A **tagged union** with `oneof` — each alternative has its own ordinal and name,
like a Protobuf `oneof`. Use this when the alternatives are models or when you
want a stable, named discriminator:

```openschema
model Notification {
  1 channel: oneof {
    1 email: EmailPayload
    2 sms:   SmsPayload
    3 push:  PushPayload
  }
}
```

`oneof` variants carry ordinals for the same reason fields do: stable identity
across versions. In generated TypeScript, a `oneof` becomes a discriminated
union; in GraphQL it maps to a union type.

---

## Enums

A fixed set of named values, each with an ordinal:

```openschema
enum OrderStatus {
  1 pending
  2 confirmed
  3 shipped
  4 delivered
}
```

As with fields, the ordinal is the stable identity. Renaming `shipped` to
`dispatched` while keeping ordinal `3` is a safe rename; reusing an ordinal for
a different meaning is a breaking change.

You can deprecate a variant without removing it:

```openschema
enum OrderStatus {
  1 pending
  2 shipped

  @deprecated
  3 cancelled
}
```

---

## Type aliases

Give a name to any type expression:

```openschema
type Id = uuid
type Position = [f64; 2..3]
type Tags = [string]
type Geometry = Point | Polygon   // a union alias
```

**Non-union aliases** (scalar/array/map) are *inlined*: every reference expands
to the underlying type during code generation (most targets cannot name an array
or scalar). Generic aliases work too — `type Box<T> = [T]`, used as `Box<i32>`,
inlines to `[i32]`.

**Union aliases** (`type Geometry = …`) become a first-class named type: a GraphQL
`union`, a TypeScript union, a JSON-Schema `anyOf` / OpenAPI `oneOf`, and a Go
`= any`. SQL/SurrealDB store them as a JSON/object column. Two rules are enforced:
every member must be an object model (`OS1011`), and a union may not appear in an
operation input position (`OS1012`, GraphQL unions are output-only). Cyclic
aliases raise `OS1010`; a generic alias used with the wrong arity raises `OS1009`.

---

## Inheritance with `extends`

A model can extend another model, inheriting all of its fields:

```openschema
model Entity {
  @primaryKey
  1 id: uuid

  @default(now())
  2 createdAt: timestamp
}

model Product extends Entity {
  3 name: string

  @minValue(0)
  4 priceCents: i64
}
```

`Product` has four fields: the inherited `id` and `createdAt`, plus its own
`name` and `priceCents`. The compiler flattens the inheritance chain, detects
cycles, and reports an error if two models in the chain reuse the same ordinal.

> Ordinals must stay unique **across** the whole inheritance chain. If `Entity`
> uses 1 and 2, `Product` must not reuse them.

---

## Generics (templates)

Models and aliases can take type parameters, like generics in a programming
language:

```openschema
model Page<T> {
  1 items:      [T]
  2 totalCount: i64
  3 nextCursor: string?
}

model ProductList {
  1 page: Page<Product>
}
```

A parameter can be constrained with `extends`:

```openschema
model Page<T extends Entity> {
  1 items: [T]
}
```

Nested generics work, and the language deliberately lexes `>>` as two closing
brackets, so you can write `Page<List<Order>>` without spaces.

> Generic models are not emitted directly (a database table cannot be
> "generic"); they take shape when used with concrete type arguments.

---

## Decorators

Decorators attach metadata to a declaration or field. They precede the thing
they decorate and, on a field, come **before the ordinal**:

```openschema
@table("orders")
model Order {
  @primaryKey @default(gen_uuid())
  1 id: uuid

  @format("email")
  2 email: string

  @minValue(0) @maxValue(100)
  3 discountPercent: i32
}
```

A decorator has a (possibly namespaced) name and optional arguments:

- **No arguments:** `@primaryKey`, `@deprecated`
- **Positional:** `@format("email")`, `@minValue(-90)`
- **Named:** `@http.route(path: "/orders", method: "GET")`
- **Namespaced name:** `@sql.type("JSONB")` — the `sql.` prefix scopes the
  decorator to the SQL generator.
- **Expression argument:** `@check(total >= 0)`, `@default(gen_uuid())`

The full list of built-in decorators and what each generator does with them is
in the [Decorators reference](./decorators.md).

---

## Directives

A directive is a compiler instruction, written with `#`. The main one is
`#suppress`, which silences a specific compatibility rule for the thing it
precedes:

```openschema
model User {
  // We renamed this on purpose; don't warn about the rename.
  #suppress "R005" "renamed fullName -> name in v3, intentional"
  1 name: string
}
```

Directives are distinct from decorators: decorators feed the code generators,
directives feed the compiler and the compatibility checker. See
[Compatibility Checking](./compatibility.md) for the rule IDs.

---

## Private fields

Mark a field `private` (after its ordinal) to keep it out of public artifacts:

```openschema
model Person {
  1 name: string
  100 private fraudScore:   f32?
  101 private internalNote: string?
}
```

By default, private fields are **included** in SQL and Go (your own database
and backend want them) and **excluded** from JSON Schema and GraphQL (public
API surfaces). The `--include-private` / `--company` flags control this per
generation. See [Code Generation](./code-generation.md).

For fields that belong to a *different company* rather than the schema owner,
use an [overlay](#overlays) instead.

---

## Operations and interfaces

Beyond data, you can describe service operations. These are optional and exist
mainly to generate a GraphQL `Query`/`Mutation` API.

```openschema
@query    op getOrder(id: uuid): Order
@query    op listOrders(region: Region): [Order]
@mutation op placeOrder(order: Order): Order
```

- `op name(params): returnType` defines an operation.
- `@query` / `@mutation` / `@subscription` route it to the matching GraphQL root
  type.
- `@get`/`@post`/... and `@route("/path/{id}")` drive the OpenAPI generator.
- Parameters and return types use the same type syntax as fields.
- [`@visibility`](./decorators.md#visibility-decorators) on a model's fields
  controls which appear in operation inputs vs outputs.

Group related operations in an `interface`:

```openschema
interface Orders {
  @query    op get(id: uuid): Order
  @mutation op place(order: Order): Order
}
```

When generating GraphQL, models used as operation *parameters* automatically
get a companion `input` type (for example `Order` → `OrderInput`). See
[Code Generation](./code-generation.md#graphql).

### `@input` — input-only models and fields

`@input` marks something as belonging to the input side only:

- On a **model**, it emits only as a GraphQL/OpenAPI input (keeping its bare
  name, e.g. `input ContactFilter`) and is skipped by the SQL and SurrealDB
  table emitters. Use it for filter/argument DTOs that are not entities.
- On a **field**, it appears in derived inputs but never in the output type —
  the write-only counterpart of `@visibility("read")`.

A field with neither marker appears in both. So to derive a create/update input
straight from an entity, mark the server-managed fields `@visibility("read")`
and pass the entity itself as the operation parameter — no separate input model
is needed. See `examples/contacts/` for a full example.

---

## Overlays

An overlay lets one company add private fields to a shared model without
editing the shared file and without ordinal collisions. It has its own
independent ordinal space:

```openschema
namespace myorg.acme

import { Order } from "./orders"

overlay acme on Order {
  1 loyaltyTier:      string
  2 accountManagerId: u32
}
```

Two different companies can both start at ordinal `1` and never clash, because
each overlay is keyed by `(company, base model)`. This is the feature that
makes a shared schema practical across organizations — it has its own guide:
[Overlays](./overlays.md).

---

## Imports across files

Split a large model across files and import what you need:

```openschema
// common.schema
namespace myorg.common
model Money { 1 amount: decimal(12, 2)  2 currency: string }
```

```openschema
// orders.schema
namespace myorg.shop

import { Money } from "./common"

model Order {
  1 id:    uuid
  2 total: Money
}
```

- The specifier (`"./common"`) is resolved **relative to the importing file**.
  The `.schema` extension is added automatically, so `"./common"` finds
  `common.schema`.
- Importing a name that the target file does not declare is an error
  (`OS1007`). Importing from a file that cannot be found is an error
  (`OS1008`).
- You can also refer to a type by its fully-qualified name
  (`myorg.common.Money`) without importing it, as long as that file is part of
  the project being generated.

When you run `openschema gen` on an entry file, the compiler automatically
follows its imports, loads the whole graph, and resolves names across all of
them.

> Package-style specifiers (for example `@myorg/common`) are not yet supported;
> use relative paths for now.
