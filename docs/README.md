# OpenSchema Documentation

OpenSchema is a schema definition language and code generator. You write a data
model **once**, in a small, readable language, and generate everything that
needs to agree on that model: SQL tables, TypeScript and Go types, JSON Schema,
and GraphQL.

It is built for organizations where **many teams or companies share the same
core schema** but each needs to add a few private fields of their own — without
forking the shared definition and without their fields ever colliding.

```
                          ┌─► SQL DDL (PostgreSQL)
                          ├─► TypeScript interfaces
   one .schema file  ──►  ├─► Go structs
                          ├─► JSON Schema
                          ├─► GraphQL SDL
                          └─► OpenAPI 3
```

## Why it exists

When the same concept — an `Order`, a `Customer`, a `Money` value — is defined
separately in the database, the backend, and the frontend, those definitions
drift. A column is renamed in SQL but not in the API; a field becomes optional
in TypeScript but is still required in the database. OpenSchema makes one file
the single source of truth and derives the rest, so they cannot drift.

Two design choices make this practical:

- **Protobuf-style field numbers (ordinals).** Every field carries a number
  that is its permanent identity. Renaming a field keeps its ordinal, so the
  change is provably safe; the compatibility checker can tell a rename apart
  from a delete-and-add, which name-only schemas (JSON Schema, plain GraphQL)
  cannot.
- **Per-company overlays.** A company can layer its own private fields onto a
  shared model in an isolated number space, so two companies never clash and
  the shared schema never has to know about them. See
  [Overlays](./overlays.md).

## Documentation map

| Guide | What it covers |
|-------|----------------|
| [Getting Started](./getting-started.md) | Install, write your first schema, generate code |
| [Language Reference](./language-reference.md) | Every construct in the language, with examples |
| [Decorators](./decorators.md) | The built-in decorator vocabulary |
| [Code Generation](./code-generation.md) | The `gen` command and every output target |
| [Overlays](./overlays.md) | Sharing a schema across companies with private fields |
| [Compatibility Checking](./compatibility.md) | `diff`, `check`, compatibility modes, suppressing rules |
| [Wire Format](./wire-format.md) | The `codec` target's binary encoding |
| [Ordinal Ledger](./ordinal-ledger.md) | `lock`, and why an ordinal can never be reused |
| [CLI Reference](./cli.md) | Every command and flag |
| [Use Cases](./use-cases.md) | End-to-end scenarios this tool is designed for |

## A 60-second taste

```openschema
// order.schema
namespace shop

enum OrderStatus { 1 pending  2 shipped  3 delivered }

@table("orders")
model Order {
  @primaryKey @default(gen_uuid())
  1 id: uuid

  2 status: OrderStatus

  @minValue(0)
  3 total: decimal(12, 2)

  4 note: string?
}
```

Generate a PostgreSQL table:

```bash
openschema gen order.schema --target sql --out ./generated
```

```sql
CREATE TABLE orders (
  id UUID NOT NULL PRIMARY KEY DEFAULT gen_uuid(),
  status TEXT NOT NULL,
  total NUMERIC(12, 2) NOT NULL,
  note TEXT
);
```

The same file generates a TypeScript interface, a Go struct, a JSON Schema
document, or a GraphQL type — see [Code Generation](./code-generation.md).
