# Use Cases

Worked, end-to-end scenarios that OpenSchema is designed for. Each shows the
schema and the commands that make it real.

## 1. One model, no drift between database and app

**Problem.** Your `Order` is defined three times — a SQL migration, a TypeScript
interface, a Go struct — and they have already drifted. A column is `NOT NULL`
in the database but optional in the frontend.

**With OpenSchema.** Define it once and generate all three:

```openschema
// order.schema
namespace shop

@table("orders")
model Order {
  @primaryKey @default(gen_uuid())
  1 id: uuid

  2 customerId: uuid

  @minValue(0)
  3 totalCents: i64

  4 placedAt: timestamp
  5 note:     string?
}
```

```bash
openschema gen order.schema --target sql --out ./db
openschema gen order.schema --target ts  --out ./web/src/types
openschema gen order.schema --target go  --out ./api/models
```

A nullable field is `string?` in one place; that single fact becomes a nullable
column, a `note?: string | null` property, and a `*string` Go pointer. They
cannot disagree because they come from the same line.

## 2. Catch breaking schema changes in CI

**Problem.** Someone removes a field or tightens a type, and a downstream service
breaks in production.

**With OpenSchema.** Keep the published schema in the repo and gate changes:

```bash
# .github/workflows/schema.yml (conceptually)
openschema check schema/order.published.schema schema/order.schema --mode backward
```

A safe change (adding a nullable field, widening `i32` to `i64`, renaming a field
while keeping its ordinal) passes. A removal or a narrowing fails the build with
an explanation. See [Compatibility Checking](./compatibility.md).

## 3. A shared schema across many companies

**Problem.** You run a platform. Many customer companies model the same `Order`,
but each needs a handful of private fields, and they must not see each other's.

**With OpenSchema.** Publish the shared schema; each company adds an overlay:

```openschema
// shared: orders.schema
namespace platform
model Order {
  @primaryKey
  1 id: uuid

  2 total: i64
}
```

```openschema
// acme keeps this in their own repo: acme-overlay.schema
namespace platform.acme
import { Order } from "./orders"
overlay acme on Order {
  1 loyaltyTier: string
}
```

```bash
# Platform CI builds the shared view:
openschema gen orders.schema --target sql --out ./shared

# ACME builds their own view, with their private columns:
openschema gen acme-overlay.schema --target sql --out ./acme --company acme
```

Both overlays can start at ordinal `1` and never collide, and the platform can
keep evolving the shared `Order` without ever clashing with a company's private
fields. This is the headline scenario — see [Overlays](./overlays.md).

## 4. Generate a GraphQL API from your data model

**Problem.** You want a GraphQL schema, but hand-writing object types, input
types, and keeping them in sync with your data model is tedious and error-prone.

**With OpenSchema.** Add a few operations and generate SDL:

```openschema
namespace shop

model Order {
  1 id:    uuid
  2 total: i64
  3 note:  string?
}

@query    op getOrder(id: uuid): Order
@mutation op placeOrder(order: Order): Order
```

```bash
openschema gen api.schema --target graphql --out ./graphql
```

You get object types, the `Query`/`Mutation` roots, and — because `Order` is used
as a mutation argument — an automatically derived `OrderInput`. Nullability is
inverted correctly (`id: UUID!`, `note: String`). See
[Code Generation → GraphQL](./code-generation.md#graphql).

## 5. Generate a REST API spec (OpenAPI) with read/write field rules

**Problem.** You want an OpenAPI document for your REST endpoints, with
request and response bodies that correctly differ — `id` is returned but never
sent, a `password` is sent but never returned.

**With OpenSchema.** Mark field visibility and describe the routes:

```openschema
namespace shop

model User {
  @visibility("read")              // server-generated
  1 id: uuid
  @visibility("create", "read")
  2 name: string
  @visibility("create", "update")  // write-only
  3 password: string
}

@get  @route("/users/{id}")
op getUser(id: uuid): User

@post @route("/users")
op createUser(user: User): User
```

```bash
openschema gen api.schema --target openapi --out ./openapi
```

You get an OpenAPI 3 document: `/users/{id}` with `id` as a path parameter,
`/users` POST with a request body, and two component schemas — `User` (response:
`id`, `name`) and `UserInput` (request: `name`, `password`). The visibility rules
keep server-managed and write-only fields on the correct side. See
[Code Generation → OpenAPI](./code-generation.md#openapi).

## 6. Produce JSON Schema for validation and contracts

**Problem.** You need JSON Schema to validate API payloads or publish a contract,
but maintaining it by hand alongside your types is duplicate work.

**With OpenSchema.** Annotate with validation decorators and generate:

```openschema
model SignupRequest {
  @format("email")
  1 email: string

  @minLength(8)
  2 password: string

  @minValue(13) @maxValue(120)
  3 age: i32
}
```

```bash
openschema gen signup.schema --target json-schema --out ./contracts
```

`@format`, `@minLength`, `@minValue`, etc. become the corresponding JSON Schema
keywords, and private fields are excluded by default so the published contract
only exposes the public surface.

## 7. A shared "common types" library

**Problem.** `Money`, `Address`, and `Region` should mean the same thing in every
service, but they are copy-pasted and have subtly diverged.

**With OpenSchema.** Put them in one file and import them everywhere:

```openschema
// common.schema
namespace myorg.common
model Money {
  @minValue(0)
  1 amount: decimal(12, 2)

  2 currency: string
}
```

```openschema
// billing.schema
namespace myorg.billing
import { Money } from "./common"
model Invoice { 1 id: uuid  2 amount: Money }
```

Generating `billing.schema` pulls in `Money` automatically, so the `Invoice`'s
amount uses exactly the shared definition. See
[Imports](./language-reference.md#imports-across-files).

---

These scenarios compose. A real platform might keep a `common` library, a shared
`Order` schema with per-company overlays, generate SQL + Go for the backend and
TypeScript + GraphQL for the frontend, and gate every schema change with
`check` in CI — all from the same set of `.schema` files.
