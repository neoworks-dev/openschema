# Decorators

Decorators attach metadata to models, fields, enum variants, and operations.
They are the main way to influence what the code generators produce. This page
lists every built-in decorator and exactly what each generator does with it.

For decorator *syntax* (placement, argument forms), see
[Language Reference → Decorators](./language-reference.md#decorators).

## How decorators are consumed

A decorator is metadata; it does nothing on its own. Each generator reads the
decorators it understands and ignores the rest. So `@sql.type("JSONB")` affects
only the SQL output, and `@format("email")` affects only JSON Schema. This means
you can annotate a field for several targets at once:

```openschema
model Account {
  @format("email") @sql.type("CITEXT") @unique
  1 email: string
}
```

## Constraint and key decorators

These describe database-style constraints. They drive SQL output and are tracked
by the [compatibility checker](./compatibility.md).

| Decorator | Argument | Effect |
|-----------|----------|--------|
| `@primaryKey` | none | SQL: `PRIMARY KEY`. Diff: changing it is breaking (rule `R015`). |
| `@unique` | none | SQL: `UNIQUE`. Diff: adding it is breaking for writers (`R012`); removing it is safe (`R014`). |
| `@default(expr)` | an expression | SQL: `DEFAULT <expr>`. A field added *with* a default is a safe change (`R002`) rather than a breaking one. |
| `@check(expr)` | a boolean expression | SQL: `CHECK (<expr>)`. Diff: adding is breaking for writers (`R013`); removing is safe (`R014`). |

```openschema
@table("orders")
model Order {
  @primaryKey @default(gen_uuid())
  1 id: uuid

  2 customerId: ref<Customer>

  @check(total >= 0)
  3 total: decimal(12, 2)
}
```

A foreign key is not a decorator: type the field `ref<Customer>` and the SQL
targets add `REFERENCES` themselves (see
[References](./language-reference.md#references-reft)). The former `@link` and
`@references` decorators were removed; using either is an error (`OS1019`).

The argument to `@default` and `@check` is a real expression: literals
(`0`, `"draft"`), function calls (`gen_uuid()`, `now()`), comparisons
(`total >= 0`), and boolean logic (`a && b`) are all parsed and rendered into
the target SQL.

## Validation decorators

These describe value constraints. They drive **JSON Schema** output (where they
map to standard keywords) and are available to any future validator.

| Decorator | Argument | JSON Schema keyword |
|-----------|----------|---------------------|
| `@format(name)` | string | `format` (on string fields) |
| `@minValue(n)` | number | `minimum` |
| `@maxValue(n)` | number | `maximum` |
| `@minLength(n)` | number | `minLength` |
| `@maxLength(n)` | number | `maxLength` |
| `@pattern(re)` | string | `pattern` |

```openschema
model Profile {
  @format("email")
  1 email: string

  @minLength(2) @maxLength(2) @format("iso3166-1-alpha2")
  2 country: string

  @minValue(0) @maxValue(120)
  3 age: i32

  @pattern("^[A-Z]{3}$")
  4 code: string
}
```

Generated JSON Schema for `age`:

```json
{ "type": "integer", "minimum": 0, "maximum": 120 }
```

`@format` values are free-form strings. Standard ones (`email`, `uri`, `uuid`,
`date-time`) are understood by JSON Schema validators; custom ones
(`iso4217`, `e164`) are passed through for your own tooling.

## Storage and mapping decorators

These override how a field maps to a specific target.

| Decorator | Argument | Effect |
|-----------|----------|--------|
| `@table(name)` | string | SQL, SurrealDB: use this table name instead of the model name as written. |
| `@sql.type(type)` | string | SQL: use this exact column type, overriding the default mapping. |
| `@sql.column(name)` | string | SQL: use this column name instead of the field name as written. |

```openschema
@table("user_accounts")
model UserAccount {
  @sql.column("user_id") @primaryKey
  1 id: uuid

  @sql.type("JSONB")
  2 preferences: string
}
```

```sql
CREATE TABLE user_accounts (
  user_id UUID NOT NULL PRIMARY KEY,
  preferences JSONB NOT NULL
);
```

| Decorator | Applies to | Effect |
|-----------|-----------|--------|
| `@value` | model | An embedded value object: stored inline, as a JSON column, in every model that uses it. The `sql`, `sqlite` and `surrealdb` targets and the migration planner never give it a table. |
| `@index(fields: [...], unique: true, name: "…")` | model | A table index over the named fields (in order). `unique` defaults to `false`; `name` defaults to `<table>_<columns>_idx`. Repeatable. Renders as `CREATE [UNIQUE] INDEX … ON <table> (…)` after the table in `sql` and `sqlite`, `DEFINE INDEX` in `surrealdb`; migrations drop and create indexes as the declarations change. |
| `@sqlite.strict` | model | `sqlite` target: make the table `STRICT` (SQLite 3.37+). |

```openschema
@value
model Money { 1 amount: i64  2 currency: string }

@index(fields: ["customer", "placedAt"])
@index(fields: ["reference"], unique: true)
model Purchase {
  @primaryKey 1 id: uuid
  2 customer: uuid
  3 placedAt: timestamp
  4 reference: string
  5 total: Money
}
```

```sql
CREATE TABLE "Purchase" (
  id UUID NOT NULL PRIMARY KEY,
  customer UUID NOT NULL,
  "placedAt" TIMESTAMPTZ NOT NULL,
  reference TEXT NOT NULL,
  total JSONB NOT NULL
);
CREATE INDEX "Purchase_customer_placedAt_idx" ON "Purchase" (customer, "placedAt");
CREATE UNIQUE INDEX "Purchase_reference_idx" ON "Purchase" (reference);
```

## Lifecycle decorators

| Decorator | Applies to | Effect |
|-----------|-----------|--------|
| `@deprecated` | field, enum variant | Marks the element deprecated. Diff: adding `@deprecated` to a field is reported as a warning (`R019`). |
| `@compatibility(mode)` | model | Documents the intended compatibility mode (`backward`, `forward`, `full`, `none`). Enforce it with `openschema check --mode <mode>`. |

```openschema
@compatibility(backward)
model Order {
  1 id: uuid

  @deprecated
  2 legacyRef: string?
}
```

## Visibility decorators

Visibility controls which fields appear in operation **inputs** (request bodies,
mutation arguments) versus **outputs** (responses). This lets one model serve
both without leaking server-managed or write-only fields. Modeled on
[TypeSpec visibility](https://typespec.io/docs/language-basics/visibility/).

| Decorator | Argument | Effect |
|-----------|----------|--------|
| `@visibility(...phases)` | one or more of `"read"`, `"create"`, `"update"`, `"delete"`, `"query"` | The field appears only in the listed lifecycle phases. |
| `@invisible` | none | The field never appears in any operation input or output. |

A field with **no** visibility decorator appears everywhere. The phases group
into two operation contexts:

- **Output** (responses) shows fields visible in `read`.
- **Input** (mutation arguments / request bodies) shows fields visible in
  `create`, `update`, or `query`.

```openschema
model User {
  @visibility("read")              // server-generated: returned, never sent
  1 id: uuid

  @visibility("create", "read")    // set on create, returned
  2 name: string

  @visibility("create", "update")  // write-only: never returned (e.g. a secret)
  3 password: string

  @invisible                       // internal: never in any API surface
  4 fraudNotes: string?
}

@mutation op createUser(user: User): User
```

Generated GraphQL keeps `id`/`name` in the output `type User` and `name`/`password`
in the `input UserInput` — `id` is omitted from input (you don't send it on
create), `password` from output, and `fraudNotes` from both:

```graphql
type User {
  id: UUID!
  name: String!
}

input UserInput {
  name: String!
  password: String!
}
```

Visibility is target-agnostic: a future HTTP/OpenAPI generator applies the same
input/output filtering to request and response schemas.

## Operation routing decorators

These appear on `op` declarations and route them to GraphQL root types.

| Decorator | GraphQL root |
|-----------|--------------|
| `@query` | `type Query` |
| `@mutation` | `type Mutation` |
| `@subscription` | `type Subscription` |

```openschema
@query    op getOrder(id: uuid): Order
@mutation op placeOrder(order: Order): Order
```

An operation with no routing decorator defaults to `Query`. See
[Code Generation → GraphQL](./code-generation.md#graphql).

## HTTP decorators

These appear on `op` declarations and drive the OpenAPI generator.

| Decorator | Argument | Effect |
|-----------|----------|--------|
| `@get` `@post` `@put` `@delete` `@patch` | none | Sets the HTTP method for the operation. |
| `@route(path)` | string | Sets the URL path. `{name}` placeholders become path parameters bound to the operation's parameter of the same name. |

```openschema
@get  @route("/orders/{id}")
op getOrder(id: uuid): Order

@post @route("/orders")
op placeOrder(order: Order): Order
```

- A parameter named in the route's `{...}` becomes a **path** parameter.
- For `GET`, the remaining parameters become **query** parameters.
- For `POST`/`PUT`/`PATCH`, the remaining parameters form the **request body**.
- With no method decorator, an `op` defaults to `GET` (or `POST` if it also has
  `@mutation`); with no `@route`, the path defaults to `/opName`.

See [Code Generation → OpenAPI](./code-generation.md#openapi).

## Neoworks decorators

`@neoworks.table`, `@neoworks.facet`, `@neoworks.title` and `@neoworks.index` describe how a model is stored as encrypted Neoworks rows,
and `@belongsTo` and `@onDelete("cascade")` on a `ref<Table>` field describe how
rows relate. The `descriptor` target reads them and rejects any other `@neoworks`
decorator. See [Descriptor target and Neoworks tables](./descriptor.md).

## Defining your own decorators

The language does not restrict decorator names — any `@name` or `@ns.name` with
valid arguments parses. Unrecognized decorators are simply carried in the AST
and ignored by current generators, so you can annotate schemas for your own
tooling today and add a generator that reads them later.
