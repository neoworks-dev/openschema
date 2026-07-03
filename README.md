# OpenSchema

A schema definition language and code generator. Write your data model **once**
and generate SQL tables, TypeScript and Go types, JSON Schema, GraphQL, and OpenAPI — all
guaranteed to agree, because they come from the same source.

Built for organizations where **many teams or companies share one core schema**
but each needs private fields of their own, without forking and without
collisions.

```openschema
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

## Install and run

```bash
bun install
bun run src/cli/index.ts --help

# or build a standalone binary:
bun build src/cli/index.ts --compile --outfile openschema
```

## What it does

- **One source, many targets.** SQL DDL, TypeScript, Go, JSON Schema, GraphQL, and OpenAPI.
- **Protobuf-style field numbers** give every field a stable identity, so the
  compatibility checker can tell a safe rename from a breaking removal.
- **Per-company overlays** let many companies extend a shared schema with private
  fields in isolated number spaces.
- **Compatibility checking** (`diff` / `check`) gates schema changes in CI.

## Documentation

Full documentation is in [`docs/`](./docs/README.md):

- [Getting Started](./docs/getting-started.md)
- [Language Reference](./docs/language-reference.md)
- [Decorators](./docs/decorators.md)
- [Code Generation](./docs/code-generation.md)
- [Overlays](./docs/overlays.md)
- [Compatibility Checking](./docs/compatibility.md)
- [CLI Reference](./docs/cli.md)
- [Use Cases](./docs/use-cases.md)

Worked examples live in [`examples/`](./examples), including a multi-file,
multi-company project in [`examples/ecommerce/`](./examples/ecommerce).

## Development

```bash
bun test
```
