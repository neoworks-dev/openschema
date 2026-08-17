// src/example.ts
// Demonstrates the lexer and parser on a realistic OpenSchema file.

import { Lexer }  from "./lexer/lexer.js";
import { Parser } from "./parser/parser.js";
import * as AST  from "./parser/ast.js";

// ── Sample schema source ─────────────────────────────────────────────────────

const SOURCE = `
namespace myorg.ecommerce

import { Money, Address } from "@myorg/common/v1"

// Compatibility: new readers can always read data written by old writers.
enum OrderStatus {
  1 pending
  2 confirmed
  3 shipped
  4 cancelled
}

// Untagged union alias
type Identifier = uuid | string

record User [compatibility: backward, table: "users"] {
  1 id:         uuid          [primary_key, default: gen_uuid()]
  2 email:      string        [not_null, unique]
  3 name:       string?
  4 created_at: timestamp     [not_null, default: now()]

  index user_email_idx on [email]
}

record Order [compatibility: backward, table: "orders"] {
  1 id:         uuid          [primary_key, default: gen_uuid()]
  2 user_id:    i64           [not_null, references: User.id]
  3 status:     OrderStatus   [not_null]
  4 total:      Money         [not_null, check: total >= 0]
  5 address:    Address
  6 note:       string?
  7 placed_at:  timestamp     [not_null, default: now()]

  index order_user_idx   on [user_id]
  index order_status_idx on [status, placed_at]
}

record Notification [compatibility: full] {
  1 id:      uuid [primary_key]
  2 payload: oneof {
    1 email:   string
    2 sms:     string
    3 webhook: string
  }
}

// decimal, map, and @target annotation
record Product [table: "products"] {
  1 id:         uuid              [primary_key]
  2 sku:        string            [not_null, unique]
  3 price:      decimal(10, 2)    [not_null, check: price > 0]
  4 tags:       [string]
  5 attributes: {string: string}
  6 metadata:   bytes             @target(postgres: "JSONB", mongo: "object")
}
`;

// ── Run ──────────────────────────────────────────────────────────────────────

console.log("=== OpenSchema parse example ===\n");

// Step 1 – Lex
const tokens = new Lexer(SOURCE).tokenize();
console.log(`Lexed ${tokens.length} tokens\n`);

// Step 2 – Parse
const program = new Parser(tokens).parse();

// Step 3 – Walk declarations
for (const decl of program.declarations) {
  switch (decl.kind) {
    case "namespace":
      console.log(`namespace  ${decl.path.join(".")}`);
      break;

    case "import":
      console.log(`import     { ${decl.names.join(", ")} }  from "${decl.from}"`);
      break;

    case "type_alias":
      console.log(`type       ${decl.name}  (alias)`);
      break;

    case "enum": {
      console.log(`enum       ${decl.name}  (${decl.variants.length} variants)`);
      for (const v of decl.variants) {
        console.log(`             ${v.ordinal}  ${v.name}`);
      }
      break;
    }

    case "model": {
      console.log(`record     ${decl.name}  — ${decl.members.length} fields`);
      for (const field of decl.members) {
        const access = field.private ? "private " : "";
        console.log(
          `  ${String(field.ordinal).padStart(2)}  ${access}${field.name.padEnd(14)}` +
          ` : ${describeType(field.type)}`
        );
      }
      break;
    }
  }
  console.log();
}

// ── Helper: render a type to a short string ──────────────────────────────────

function describeType(t: AST.TypeExpr): string {
  switch (t.kind) {
    case "scalar":   return t.scalar;
    case "decimal":  return `decimal(${t.precision},${t.scale})`;
    case "named":    return t.path.join(".");
    case "array":    return `[${describeType(t.element)}]`;
    case "map":      return `{${describeType(t.key)}:${describeType(t.value)}}`;
    case "nullable": return `${describeType(t.inner)}?`;
    case "null":     return "null";
    case "union":    return t.variants.map(describeType).join(" | ");
    case "oneof":    return `oneof{${t.variants.map(v => v.name).join(",")}}`;
  }
}