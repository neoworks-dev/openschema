// src/engine-example.ts
// Runs several diff scenarios and pretty-prints the structured results.
import { diff } from "./engine/index.js";
// ── ANSI colours ──────────────────────────────────────────────────────────────
const C = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    grey: "\x1b[90m",
};
function colour(s) {
    switch (s) {
        case "safe":
            return C.green;
        case "warning":
            return C.yellow;
        case "breaking_reader":
            return C.red;
        case "breaking_writer":
            return C.red;
        case "breaking_both":
            return C.red;
    }
}
function printResult(title, oldSrc, newSrc) {
    const result = diff(oldSrc, newSrc);
    console.log(`\n${C.bold}${C.cyan}══ ${title} ══${C.reset}`);
    if (result.changes.length === 0) {
        console.log(`${C.green}  ✓ No changes detected${C.reset}`);
    }
    for (const c of result.changes) {
        const col = colour(c.severity);
        const icon = c.severity === "safe" ? "✓" : c.severity === "warning" ? "⚠" : "✗";
        console.log(`  ${col}${icon} [${c.ruleId}] ${C.bold}${c.path}${C.reset}  ` +
            `${col}${c.severity}${C.reset}`);
        console.log(`    ${C.grey}${c.rationale}${C.reset}`);
        if (c.before || c.after) {
            const b = c.before ? `${C.red}− ${c.before}${C.reset}` : "";
            const a = c.after ? `${C.green}+ ${c.after}${C.reset}` : "";
            console.log(`    ${[b, a].filter(Boolean).join("  →  ")}`);
        }
    }
    const modes = ["backward", "forward", "full", "none"];
    const compat = modes
        .map((m) => {
        const ok = result.isCompatible(m);
        return `${ok ? C.green : C.red}${m}: ${ok ? "✓" : "✗"}${C.reset}`;
    })
        .join("  ");
    console.log(`\n  Compatibility  ${compat}`);
}
// ─────────────────────────────────────────────────────────────────────────────
// ── Scenario 1: Safe changes ──────────────────────────────────────────────────
const S1_OLD = `
record User {
  1 id:    uuid   [primary_key]
  2 email: string [not_null]
  3 name:  string?
}
`;
const S1_NEW = `
record User {
  1 id:         uuid      [primary_key]
  2 email:      string    [not_null]
  3 name:       string?
  4 created_at: timestamp?               // added nullable — safe
  5 score:      i32       [default: 0]   // added with default — safe

  index user_email_idx on [email]
}
`;
printResult("Scenario 1 — safe additions", S1_OLD, S1_NEW);
// ── Scenario 2: Breaking writer (not-null column, no default) ─────────────────
const S2_OLD = `
record Order {
  1 id:     uuid   [primary_key]
  2 status: string [not_null]
}
`;
const S2_NEW = `
record Order {
  1 id:          uuid   [primary_key]
  2 status:      string [not_null]
  3 confirmed_at: timestamp [not_null]   // NOT NULL, no default → breaking_writer
}
`;
printResult("Scenario 2 — added required column without default", S2_OLD, S2_NEW);
// ── Scenario 3: Breaking reader (column removed) ──────────────────────────────
const S3_OLD = `
record Product {
  1 id:          uuid    [primary_key]
  2 name:        string  [not_null]
  3 description: string?
  4 sku:         string  [not_null, unique]
}
`;
const S3_NEW = `
record Product {
  1 id:   uuid   [primary_key]
  2 name: string [not_null]
  // description removed  → breaking_reader
  // sku removed          → breaking_reader + unique gone
}
`;
printResult("Scenario 3 — columns removed", S3_OLD, S3_NEW);
// ── Scenario 4: Type changes ──────────────────────────────────────────────────
const S4_OLD = `
record Metrics {
  1 id:      uuid [primary_key]
  2 count:   i32
  3 amount:  i64
  4 label:   string
  5 ratio:   f32
}
`;
const S4_NEW = `
record Metrics {
  1 id:      uuid [primary_key]
  2 count:   i64       // widened i32 → i64 — safe
  3 amount:  i32       // narrowed i64 → i32 — breaking_writer
  4 label:   bytes     // incompatible string → bytes — breaking_both
  5 ratio:   f64       // widened f32 → f64 — safe
}
`;
printResult("Scenario 4 — type widening and narrowing", S4_OLD, S4_NEW);
// ── Scenario 5: Enum changes ──────────────────────────────────────────────────
const S5_OLD = `
enum Status {
  1 pending
  2 active
  3 cancelled
}
`;
const S5_NEW = `
enum Status {
  1 pending
  2 active
  // 3 cancelled  removed → breaking_reader
  4 archived            // added → warning
  5 suspended           // added → warning
}
`;
printResult("Scenario 5 — enum variant changes", S5_OLD, S5_NEW);
// ── Scenario 6: Ordinal renumbering (catastrophic) ────────────────────────────
const S6_OLD = `
enum Priority {
  1 low
  2 medium
  3 high
}
`;
const S6_NEW = `
enum Priority {
  1 low
  3 medium   // ordinal changed from 2 to 3 → breaking_both
  2 high     // ordinal changed from 3 to 2 → breaking_both
}
`;
printResult("Scenario 6 — variant renumbering", S6_OLD, S6_NEW);
// ── Scenario 7: Field renamed (detected via ordinal) ──────────────────────────
const S7_OLD = `
record Customer {
  1 id:         uuid   [primary_key]
  2 full_name:  string [not_null]
  3 email_addr: string [not_null]
}
`;
const S7_NEW = `
record Customer {
  1 id:         uuid   [primary_key]
  2 name:       string [not_null]   // ordinal 2: rename full_name → name
  3 email:      string [not_null]   // ordinal 3: rename email_addr → email
}
`;
printResult("Scenario 7 — field renames (stable ordinals)", S7_OLD, S7_NEW);
// ── Scenario 8: Nullable ↔ required ───────────────────────────────────────────
const S8_OLD = `
record Document {
  1 id:       uuid    [primary_key]
  2 title:    string?
  3 body:     string  [not_null]
}
`;
const S8_NEW = `
record Document {
  1 id:       uuid    [primary_key]
  2 title:    string  [not_null]   // nullable → required: breaking_writer
  3 body:     string?              // required → nullable: safe
}
`;
printResult("Scenario 8 — nullability changes", S8_OLD, S8_NEW);
// ── Scenario 9: Constraint changes ───────────────────────────────────────────
const S9_OLD = `
record Account {
  1 id:       uuid    [primary_key]
  2 handle:   string  [not_null]
  3 balance:  decimal(10,2) [not_null, check: balance >= 0]
}
`;
const S9_NEW = `
record Account {
  1 id:       uuid    [primary_key]
  2 handle:   string  [not_null, unique]        // unique added → breaking_writer
  3 balance:  decimal(12,4) [not_null]          // decimal widened, check removed
}
`;
printResult("Scenario 9 — constraint and decimal changes", S9_OLD, S9_NEW);
console.log("\n");
//# sourceMappingURL=engine-example.js.map