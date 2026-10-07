# Code Generation

OpenSchema’s default command turns a schema into source files for a chosen target.

```bash
openschema <schema> --target <target> --out <dir> [options]
```

| Flag | Meaning | Default |
|------|---------|---------|
| `--target`, `-t` | one or more targets, comma-separated (required) | — |
| `--out`, `-o` | output directory (created if missing) | `.` |
| `--company <id>` | include this company's [overlay](./overlays.md) fields | none |
| `--include-private` | include the schema's own `private` fields | off |

Targets: `sql`, `ts`, `zod`, `go`, `json-schema`, `graphql`, `openapi`,
`surrealdb`, `internal`, `codec`. Pass several at once with a
comma: `-t ts,zod,sql`.

The `codec` target generates a canonical binary encoder and decoder, and writes
`schema.codec.ts` rather than `schema.ts`. It has its own rules and its own set of
rejected constructs — see [Wire Format](./wire-format.md).

The command parses the entry file, follows its `import`s, resolves the whole
graph, reports any semantic errors (and stops on them), then writes the output.
Each target writes a single `schema.<ext>` file.

It also keeps `openschema.lock` — the [ordinal ledger](./ordinal-ledger.md) — up to
date beside the entry file, and refuses to generate if the schema reuses a spent
ordinal. See [`--frozen` and CI](./ordinal-ledger.md#who-may-write-the-lockfile).

The examples below all use this source:

```openschema
namespace shop

enum Status { 1 pending  2 shipped }

@table("orders")
model Order {
  @primaryKey @default(gen_uuid())
  1 id: uuid

  2 status: Status

  @minValue(0)
  3 total: decimal(12, 2)

  4 tags: [string]
  5 note: string?
}
```

---

## SQL (PostgreSQL)

```bash
openschema order.schema --target sql --out ./out
```

```sql
CREATE TABLE orders (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_uuid(),
  status TEXT NOT NULL,
  total NUMERIC(12, 2) NOT NULL,
  tags JSONB NOT NULL,
  note TEXT
);
```

Type mapping:

| OpenSchema | SQL |
|-----------|-----|
| `bool` | `BOOLEAN` |
| `i8` `i16` | `SMALLINT` |
| `i32` `u16` | `INTEGER` |
| `i64` `u32` | `BIGINT` |
| `u64` | `NUMERIC(20)` |
| `f32` | `REAL` |
| `f64` | `DOUBLE PRECISION` |
| `decimal(p, s)` | `NUMERIC(p, s)` |
| `string` `uuid` `date` `time` `timestamp` `duration` | `TEXT`/`UUID`/`DATE`/`TIME`/`TIMESTAMPTZ`/`INTERVAL` |
| `bytes` | `BYTEA` |
| `json` | `JSONB` |
| an `enum` type | a native `CREATE TYPE … AS ENUM (…)`; columns use that type |
| `[T]`, `{K: V}`, unions, `oneof` | `JSONB` |

- A non-nullable field becomes `NOT NULL`; a `T?` field omits it.
- `@table`, `@sql.type`, `@sql.column`, `@primaryKey`, `@unique`, `@default`,
  `@check`, and `@references` all shape the output — see
  [Decorators](./decorators.md).
- Table and column names are snake-cased (`UserAccount` → `user_account`)
  unless overridden.

---

## TypeScript

```bash
openschema order.schema --target ts --out ./out
```

```typescript
export enum Status {
  pending = 1,
  shipped = 2,
}

export interface Order {
  id: string;
  status: Status;
  total: number;
  tags: string[];
  note?: string | null;
}
```

Type mapping:

| OpenSchema | TypeScript |
|-----------|------------|
| `bool` | `boolean` |
| all integers, floats, `decimal` | `number` |
| `string` `uuid` `date` `time` `timestamp` `duration` | `string` |
| `bytes` | `Uint8Array` |
| `json` | `unknown` |
| `[T]` | `T[]` |
| `{K: V}` | `Model<K, V>` |
| `T?` | `field?: T \| null` |
| union `A \| B` | `A \| B` |
| `oneof { 1 a: A  2 b: B }` | `{ kind: "a"; a: A } \| { kind: "b"; b: B }` |
| `enum` | `export enum` with the ordinal as the value |

Enum values preserve the ordinal (`pending = 1`), so the TypeScript enum and the
wire representation agree. Generic models emit as generic interfaces
(`export interface Page<T>`).

---

## Go

```bash
openschema order.schema --target go --out ./out
```

```go
package schema

type Status int32

const (
	StatusPending Status = 1
	StatusShipped Status = 2
)

type Order struct {
	Id string `json:"id"`
	Status Status `json:"status"`
	Total string `json:"total"`
	Tags []string `json:"tags"`
	Note *string `json:"note,omitempty"`
}
```

Type mapping:

| OpenSchema | Go |
|-----------|-----|
| `bool` | `bool` |
| `i8`..`i64`, `u8`..`u64` | `int8`..`int64`, `uint8`..`uint64` |
| `f32` `f64` | `float32` `float64` |
| `decimal` | `string` (no native decimal) |
| `string` and friends | `string` |
| `bytes` | `[]byte` |
| `json` | `any` |
| `[T]` | `[]T` |
| `{K: V}` | `map[K]V` |
| `T?` | `*T` with `json:"...,omitempty"` |
| `enum` | `type X int32` + `const` block |

Field names are exported (capitalized) and carry a `json` tag with the original
field name. Set the package name with `--out` plus a generator option if needed;
the default package is `schema`.

---

## JSON Schema

```bash
openschema order.schema --target json-schema --out ./out
```

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$defs": {
    "Status": { "type": "string", "enum": ["pending", "shipped"] },
    "Order": {
      "type": "object",
      "properties": {
        "id":     { "type": "string", "format": "uuid" },
        "status": { "$ref": "#/$defs/Status" },
        "total":  { "type": "string", "minimum": 0 },
        "tags":   { "type": "array", "items": { "type": "string" } },
        "note":   { "type": "string" }
      },
      "required": ["id", "status", "total", "tags"]
    }
  }
}
```

- Every model and enum becomes an entry under `$defs`; references between them
  use `$ref`.
- A non-nullable field appears in `required`; a `T?` field does not.
- Validation decorators map to standard keywords: `@format` → `format`,
  `@minValue`/`@maxValue` → `minimum`/`maximum`, `@minLength`/`@maxLength` →
  `minLength`/`maxLength`, `@pattern` → `pattern`.
- Private fields are **excluded by default** (this is a public artifact). Pass
  `--include-private` to keep them.

---

## GraphQL

```bash
openschema order.schema --target graphql --out ./out
```

```graphql
scalar UUID
scalar DateTime
scalar Date
scalar Time
scalar Duration
scalar Decimal
scalar Bytes
scalar JSON

enum Status {
  pending
  shipped
}

type Order {
  id: UUID!
  status: Status!
  total: Decimal!
  tags: [String!]!
  note: String
}
```

GraphQL is **nullable by default**, the opposite of OpenSchema. So the generator
*inverts* nullability: a required field gains a trailing `!`, and a `T?` field
does not. `note: String` is optional; everything else is `!`.

Type mapping highlights:

| OpenSchema | GraphQL |
|-----------|---------|
| `bool` | `Boolean` |
| integers | `Int` |
| `f32` `f64` | `Float` |
| `decimal` | `Decimal` (custom scalar) |
| `uuid` | `UUID` (custom scalar) |
| `timestamp` | `DateTime` (custom scalar) |
| `[T]` (non-null) | `[T!]!` |
| `{K: V}`, unions, `oneof` | `JSON` (custom scalar) |
| `enum` | `enum` (ordinals dropped — GraphQL enums are name-only) |

### Operations become Query and Mutation

If your schema declares [operations](./language-reference.md#operations-and-interfaces),
they generate root types:

```openschema
@query    op getOrder(id: uuid): Order
@mutation op placeOrder(order: Order): Order
```

```graphql
type Query {
  getOrder(id: UUID!): Order!
}

type Mutation {
  placeOrder(order: OrderInput!): Order!
}
```

Notice `OrderInput`. GraphQL forbids using an output `type` where an input is
expected, so any model used as an operation **parameter** automatically gets a
companion `input` type — and so does any model *it* references, transitively.
Models used only as return values stay as `type`. Enums work in both positions
and are never suffixed.

---

## OpenAPI

```bash
openschema api.schema --target openapi --out ./out
```

The OpenAPI generator turns [operations](./language-reference.md#operations-and-interfaces)
into an OpenAPI 3.0 document: `paths` from the operations and `components.schemas`
from the models and enums. It is driven by the
[HTTP decorators](./decorators.md#http-decorators) `@get`/`@post`/...
and `@route`.

Given:

```openschema
namespace shop

model User {
  @visibility("read")
  1 id: uuid

  @visibility("create", "read")
  2 name: string

  @visibility("create", "update")
  3 password: string
}

@get  @route("/users/{id}")
op getUser(id: uuid): User

@post @route("/users")
op createUser(user: User): User
```

the generator produces (abridged):

```json
{
  "openapi": "3.0.3",
  "info": { "title": "shop API", "version": "1.0.0" },
  "paths": {
    "/users/{id}": {
      "get": {
        "operationId": "getUser",
        "parameters": [
          { "name": "id", "in": "path", "required": true,
            "schema": { "type": "string", "format": "uuid" } }
        ],
        "responses": {
          "200": { "description": "Success",
            "content": { "application/json": {
              "schema": { "$ref": "#/components/schemas/User" } } } }
        }
      }
    },
    "/users": {
      "post": {
        "operationId": "createUser",
        "requestBody": { "required": true,
          "content": { "application/json": {
            "schema": { "$ref": "#/components/schemas/UserInput" } } } },
        "responses": { "200": { "description": "Success",
          "content": { "application/json": {
            "schema": { "$ref": "#/components/schemas/User" } } } } }
      }
    }
  },
  "components": {
    "schemas": {
      "User":      { "type": "object",
        "properties": { "id": { "type": "string", "format": "uuid" },
                        "name": { "type": "string" } },
        "required": ["id", "name"] },
      "UserInput": { "type": "object",
        "properties": { "name": { "type": "string" },
                        "password": { "type": "string" } },
        "required": ["name", "password"] }
    }
  }
}
```

Key behaviors:

- **Method and path** come from `@get`/`@post`/... and `@route(...)`. Defaults:
  `GET` (or `POST` with `@mutation`) and `/opName`.
- **Path parameters** are the `{...}` placeholders in the route; remaining
  parameters are query parameters (`GET`) or the request body (`POST`/`PUT`/`PATCH`).
- **Visibility splits the schemas.** A model has an output schema (`User`, the
  `read`-visible fields) and, when used as a request body, an input schema
  (`UserInput`, the `create`/`update`/`query`-visible fields). So `id` is
  read-only and `password` is write-only — exactly as the
  [`@visibility`](./decorators.md#visibility-decorators) decorators specify.
- Field-level validation decorators (`@format`, `@minValue`, ...) carry into the
  schema properties, just like the [JSON Schema](#json-schema) target.

---

## Multi-file projects

Point the compiler at the entry file; it follows imports automatically:

```bash
openschema orders.schema --target sql --out ./out
```

If `orders.schema` imports `Money` from `common.schema`, both the `orders` and
`money` tables appear in the output. See
[Language Reference → Imports](./language-reference.md#imports-across-files).

## Per-company output

When a [company overlay](./overlays.md) exists, generate that company's view:

```bash
openschema acme-overlay.schema --target sql --out ./out --company acme
```

The overlay's fields are added to the base model's output, namespaced by
company (`acme_loyalty_tier`), so different companies' generated artifacts never
collide.

## Type aliases and unions

Non-union aliases are inlined into the referencing type before emission (a
generic alias like `Box<T>` is substituted at the reference site). A **union
alias** becomes a named type per target:

| Target      | `type Geometry = Point \| Polygon`              |
| ----------- | ----------------------------------------------- |
| GraphQL     | `union Geometry = Point \| Polygon`             |
| TypeScript  | `export type Geometry = Point \| Polygon`       |
| Go          | `type Geometry = any`                           |
| JSON Schema | `$defs.Geometry = { anyOf: [...] }`             |
| OpenAPI     | `components.schemas.Geometry = { oneOf: [...] }`|
| SQL         | `JSONB` column                                  |
| SurrealDB   | `object` field                                  |

Array length bounds (`[T; min..max]` or `@minItems`/`@maxItems`/`@length`) emit
as `minItems`/`maxItems` (JSON Schema, OpenAPI) and `array<T, max>` plus an
`array::len` ASSERT (SurrealDB); other targets ignore them.
