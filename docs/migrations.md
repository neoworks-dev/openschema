# Migrations

`openschema migrate <old> <new>` turns the difference between two schema versions
into a runnable migration script. It builds on the same identity rules as
[`diff`](./compatibility.md): fields are matched by **ordinal**, declarations by
name (a new model with `@renamed("Old")` continues the removed `Old`), so a rename
is never mistaken for a drop + add.

```bash
openschema migrate v1.schema v2.schema --target migration-sql      --out ./migrations
openschema migrate v1.schema v2.schema --target migration-surreal  --out ./migrations
```

## What is generated automatically

The planner derives a platform-neutral list of operations and each backend renders
it to DDL:

| Change                         | SQL                                   | SurrealDB                        |
| ------------------------------ | ------------------------------------- | -------------------------------- |
| new model                      | `CREATE TABLE`                        | `DEFINE TABLE` + `DEFINE FIELD`  |
| removed model                  | `DROP TABLE` (destructive)            | `REMOVE TABLE` (destructive)     |
| `@renamed` model               | `ALTER TABLE … RENAME TO`             | `-- MANUAL` (no native rename)   |
| added field                    | `ALTER TABLE … ADD COLUMN`            | `DEFINE FIELD`                   |
| removed field                  | `… DROP COLUMN` (destructive)         | `REMOVE FIELD` (destructive)     |
| renamed field (same ordinal)   | `… RENAME COLUMN a TO b`              | `-- MANUAL` (define/copy/remove) |
| widened type (`i32`→`i64`)     | `ALTER COLUMN … TYPE …`               | re-`DEFINE FIELD`                |
| narrowed/incompatible type     | `… TYPE … USING …` + `-- LOSSY`       | re-`DEFINE FIELD` + `-- LOSSY`   |
| made nullable                  | `… DROP NOT NULL`                     | re-`DEFINE FIELD` (`option<…>`)  |
| new / removed enum             | `CREATE TYPE` / `DROP TYPE`            | comment (inlined as ASSERTs)     |
| enum variant add / rename      | `ALTER TYPE … ADD VALUE` / `RENAME VALUE` | re-`DEFINE FIELD` updated ASSERT |
| enum variant remove            | `-- MANUAL` recreate (PG limitation)  | re-`DEFINE FIELD` updated ASSERT |

Operations are ordered so dependencies hold: tables are created before fields that
reference them, a field is renamed before any op that targets its new name, and
destructive drops come last (an expand-then-contract forward migration).

## What needs a human

Structural DDL is fully derivable; **data intent is not**, and it differs per
project, so the generator marks those spots rather than guessing:

- **Required column, no `@default`** → a `-- TODO backfill` block: add the column
  nullable, backfill, then enforce `NOT NULL`. (If the field has `@default`, that
  declared value is used automatically and no TODO is emitted.)
- **Narrowing / incompatible type change** → a `-- LOSSY` marker plus a `USING`
  cast (SQL) or a commented `UPDATE` (SurrealDB) to review — values outside the new
  type's range will fail.
- **Made required** → a `-- TODO` to ensure no NULLs before enforcing.
- **SurrealDB rename** → a `-- MANUAL` block (SurrealDB has no `RENAME`); define the
  new field/table, copy, then remove the old.

The CLI prints a summary and warns when the plan `hasDestructive` or
`hasManualSteps` operations.

## Notes & limits

- A type change that collapses to the same physical column (e.g. `[i32]`→`[i64]`,
  both a JSON column) is suppressed as a `-- no-op`.
- Enums are native PostgreSQL types (`CREATE TYPE … AS ENUM`). Adding/renaming a
  value maps to `ALTER TYPE … ADD VALUE` / `RENAME VALUE`; **removing** a value
  needs a `-- MANUAL` type-recreate (PostgreSQL has no drop-value). In SurrealDB,
  enums are inlined `ASSERT $value INSIDE […]`, so any variant change re-`DEFINE`s
  every field typed by that enum.
- A bare `@table` literal change without `@renamed` reads as drop + create — use
  `@renamed` to express a model rename.
- Migrations are **forward-only** for now; down-migrations are future work.
