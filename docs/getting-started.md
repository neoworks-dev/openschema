# Getting Started

This guide takes you from an empty directory to generating code from your first
schema. It assumes you can run a terminal; no prior knowledge of OpenSchema is
required.

## 1. Install

OpenSchema runs on [Bun](https://bun.com). From the project directory:

```bash
bun install
```

You can run the CLI directly with Bun:

```bash
bun run src/cli/index.ts --help
```

To get a standalone binary you can drop into CI (no Bun required at runtime):

```bash
bun build src/cli/index.ts --compile --outfile openschema
./openschema --help
```

The rest of this guide writes `openschema` for brevity. Substitute
`bun run src/cli/index.ts` if you have not built the binary.

## 2. Write your first schema

Create a file `product.schema`:

```openschema
namespace catalog

/// A sellable product in the catalog.
model Product {
  @primaryKey @default(gen_uuid())
  1 id: uuid

  2 name: string

  @minLength(1)
  3 sku: string

  @minValue(0)
  4 priceCents: i64

  5 description: string?
  6 tags:        [string]
}
```

A few things to notice — each is explained fully in the
[Language Reference](./language-reference.md):

- `namespace catalog` groups everything in the file under a name. Types are
  referred to elsewhere as `catalog.Product`.
- `model Product { ... }` defines a structured type.
- Every field starts with a **number** (`1`, `2`, `3`...). This is the field's
  *ordinal* — its permanent identity. Numbers may have gaps and need not be in
  order, but each must be unique within the model.
- `@primaryKey`, `@minValue(0)`, `@format(...)` are **decorators** — metadata
  that guides code generation and validation.
- `string?` is a **nullable** field (the `?`). `[string]` is a list of strings.

## 3. Validate it

```bash
openschema parse product.schema
```

This checks the syntax and prints a summary. If you made a typo, you get a
precise error with a line and column:

```
Parse error at 4:14: Expected field name (identifier) (got ":" ":")
```

## 4. Generate code

Pick a target and an output directory:

```bash
openschema product.schema --target ts --out ./generated
```

`./generated/schema.ts`:

```typescript
export interface Product {
  id: string;
  name: string;
  sku: string;
  priceCents: number;
  description?: string | null;
  tags: string[];
}
```

Alongside the output you will find a new `openschema.lock`. It is the
[ordinal ledger](./ordinal-ledger.md): a record of every field number the schema has
ever used, which is what makes a reused number a compile error instead of silent data
corruption. It is maintained for you — commit it and forget about it.

Try the other targets — the same source file drives all of them:

```bash
openschema product.schema --target sql         --out ./generated
openschema product.schema --target go          --out ./generated
openschema product.schema --target json-schema --out ./generated
openschema product.schema --target graphql     --out ./generated
```

See [Code Generation](./code-generation.md) for what each target produces and
how decorators influence the output.

## 5. The day-two workflow: don't break consumers

Once other teams depend on your schema, you want to know **before** you ship
whether a change is safe. OpenSchema diffs two versions of a schema and tells
you exactly what changed and whether it breaks anyone:

```bash
openschema check product.v1.schema product.v2.schema --mode backward
```

- Exit code `0` and a green check: the change is safe.
- Exit code `1`: a breaking change, with an explanation of why.

This is designed to run in CI as a gate on schema changes. See
[Compatibility Checking](./compatibility.md).

## Where to go next

- [Language Reference](./language-reference.md) — the full language.
- [Overlays](./overlays.md) — if multiple companies share your schema.
- [Use Cases](./use-cases.md) — worked end-to-end scenarios.
