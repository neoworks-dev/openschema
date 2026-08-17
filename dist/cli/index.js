#!/usr/bin/env node
// src/cli.ts
// OpenSchema command-line interface.
//
// Commands
// ────────
//   <schema>                      Generate output for a target (the default command)
//   parse  <file>                 Validate syntax; optionally dump tokens or AST
//   diff   <old> <new>            Show all changes between two schema files
//   check  <old> <new>            Assert compatibility under a given mode (CI-friendly)
//   lock   <schema>               Ordinal-ledger CI gate
import { Command, Option } from "commander";
import chalk from "chalk";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { Lexer, LexError } from "../lexer/lexer.js";
import { Parser, ParseError } from "../parser/parser.js";
import { diff as engineDiff } from "../engine/index.js";
import { resolveModules, loadProject } from "../resolver/index.js";
import { getEmitter, listTargets } from "../emit/index.js";
import { getMigrationEmitter, MIGRATION_TARGETS } from "../emit/migration/index.js";
import { buildMigrationPlan } from "../engine/migration.js";
import { fetchSchema, parseSchemaRef, publish, resolveRegistry } from "../registry/client.js";
import { getAccessToken, login } from "../registry/auth.js";
import { resolveEndpoints } from "../registry/urls.js";
import { readdirSync } from "fs";
import { collectSpaces } from "../ledger/spaces.js";
import { reconcileLedger } from "../ledger/merge.js";
import { defaultLockPath, isSuperset, loadLedger, serializeLedger } from "../ledger/io.js";
import { CodecUnsupportedError } from "../emit/codec/errors.js";
// ── Version ───────────────────────────────────────────────────────────────────
const VERSION = "0.1.0";
const readFileOrNull = (path) => {
    if (!existsSync(path))
        return null;
    return readFileSync(path, "utf8");
};
/** Load + resolve a schema project, printing diagnostics and exiting on error. */
function resolveProject(schemaPath) {
    readFile(schemaPath); // validate the entry file exists with a friendly error
    let modules;
    try {
        modules = loadProject(schemaPath, readFileOrNull);
    }
    catch (e) {
        reportFrontEndError(e);
        process.exit(1);
    }
    const schema = resolveModules(modules);
    if (schema.hasErrors) {
        printDiagnostics(schema.diagnostics);
        process.exit(1);
    }
    printDiagnostics(schema.diagnostics); // warnings only at this point
    return schema;
}
function resolveTargets(raw) {
    if (raw === undefined) {
        console.error(chalk.red("error: --target is required"));
        console.error(chalk.dim(`  available targets: ${listTargets().join(", ")}`));
        process.exit(1);
    }
    const names = raw
        .split(",")
        .map((target) => target.trim())
        .filter((target) => target.length > 0);
    if (names.length === 0) {
        console.error(chalk.red("error: no targets given"));
        process.exit(1);
    }
    return names.map((name) => {
        const emitter = getEmitter(name);
        if (emitter === null) {
            console.error(chalk.red(`error: no emitter for target '${name}'`));
            console.error(chalk.dim(`  available targets: ${listTargets().join(", ")}`));
            process.exit(1);
        }
        return emitter;
    });
}
function cmdGenerate(schemaPath, opts) {
    const emitters = resolveTargets(opts.target);
    const schema = resolveProject(schemaPath);
    const pendingLock = syncLedger(schemaPath, schema, opts);
    const files = emitAll(emitters, schema, opts);
    // The lockfile lands only after every emitter has succeeded, so a rejected
    // construct never leaves behind a ledger recording ordinals that produced no
    // output.
    if (pendingLock !== null)
        writeLockfile(pendingLock);
    mkdirSync(opts.out, { recursive: true });
    for (const file of files) {
        const fullPath = join(opts.out, file.path);
        writeFileSync(fullPath, file.contents, "utf8");
        console.log(chalk.green(`✓ ${fullPath}`));
    }
}
function emitAll(emitters, schema, opts) {
    const files = [];
    for (const emitter of emitters) {
        try {
            files.push(...emitter.emit({
                schema,
                company: opts.company ?? null,
                includePrivate: opts.includePrivate === true,
                options: {},
            }));
        }
        catch (error) {
            reportEmitError(error);
            process.exit(1);
        }
    }
    return files;
}
const GENERATOR = `openschema ${VERSION}`;
function lockPathFor(schemaPath, opts) {
    if (typeof opts.lock === "string")
        return opts.lock;
    return defaultLockPath(schemaPath);
}
function loadLedgerOrExit(path) {
    const loaded = loadLedger(path);
    if (loaded.integrityError !== null) {
        console.error(chalk.red(`error: OS2009 ${loaded.integrityError}`));
        process.exit(1);
    }
    return loaded.ledger;
}
/** CI is the one place where a self-healing lockfile would silently disarm the ledger. */
function runningInCI() {
    const flag = process.env.CI;
    if (flag === undefined)
        return false;
    return flag !== "" && flag !== "0" && flag !== "false";
}
function ledgerIsReadOnly(opts) {
    if (opts.frozen === true)
        return true;
    if (opts.writeLock === true)
        return false;
    return runningInCI();
}
/**
 * Reconcile the ordinal ledger and hand back the lockfile the caller should write.
 *
 * Recording a new ordinal and retiring a removed one are mechanical edits with
 * exactly one correct answer, so the compiler makes them itself rather than
 * failing the build until a human runs a second command. What it will not do is
 * launder a violation: reusing a spent ordinal (OS2007) or changing a live
 * ordinal's encoding (OS2010) still aborts before anything is written.
 *
 * Two situations stay strictly read-only, because there the auto-repair *is* the
 * disarm:
 *   - CI (or --frozen): a deleted lockfile would otherwise be silently rebuilt
 *     into an empty baseline and the build would go green.
 *   - `#requireLedger`: a missing lockfile is an error, never a fresh baseline.
 */
function syncLedger(schemaPath, schema, opts) {
    if (opts.lock === false)
        return null;
    const path = lockPathFor(schemaPath, opts);
    const current = loadLedgerOrExit(path);
    const readOnly = ledgerIsReadOnly(opts);
    const result = reconcileLedger(collectSpaces(schema), current, {
        mode: readOnly ? "check" : "update",
        required: readOnly || (current === null && schema.requiresLedger === true),
        staleSeverity: "error",
        now: () => new Date().toISOString(),
        generator: GENERATOR,
    });
    printDiagnostics(result.diagnostics);
    if (result.diagnostics.some(d => d.severity === "error"))
        process.exit(1);
    if (readOnly)
        return null;
    if (!result.changed)
        return null;
    return { path, contents: serializeLedger(result.next), baseline: current === null };
}
function writeLockfile(pending) {
    writeFileSync(pending.path, pending.contents, "utf8");
    if (!pending.baseline) {
        console.log(chalk.dim(`  ordinal ledger updated: ${pending.path}`));
        return;
    }
    console.log(chalk.yellow(`⚠ created ${pending.path} — commit it.`));
    console.log(chalk.dim("  It records every ordinal ever used; without it, reuse cannot be detected."));
}
function cmdLock(schemaPath, opts) {
    const schema = resolveProject(schemaPath);
    const path = lockPathFor(schemaPath, opts);
    const current = loadLedgerOrExit(path);
    // Update mode is what CREATES the ledger, so a missing one is never an error
    // there — otherwise #requireLedger would make the first lockfile impossible.
    // Under --check a missing ledger is exactly what should fail CI.
    const checking = opts.check === true;
    const result = reconcileLedger(collectSpaces(schema), current, {
        mode: checking ? "check" : "update",
        required: checking,
        staleSeverity: "error",
        now: () => new Date().toISOString(),
        generator: GENERATOR,
    });
    const blocking = result.diagnostics.filter(d => d.severity === "error");
    const supersetProblem = checkBase(result.next, opts.base);
    if (opts.json === true) {
        console.log(JSON.stringify({
            lockfile: path,
            changed: result.changed,
            diagnostics: result.diagnostics,
            supersetViolations: supersetProblem,
        }, null, 2));
        process.exit(blocking.length > 0 || supersetProblem.length > 0 ? 1 : 0);
    }
    printDiagnostics(result.diagnostics);
    if (supersetProblem.length > 0) {
        console.error(chalk.red(`error: OS2009 the ledger drops entries present in the base: ${supersetProblem.join(", ")}`));
    }
    if (blocking.length > 0 || supersetProblem.length > 0)
        process.exit(1);
    if (opts.check === true) {
        if (result.changed)
            process.exit(1);
        console.log(chalk.green(`✓ ${path} is up to date`));
        return;
    }
    if (!result.changed) {
        console.log(chalk.green(`✓ ${path} is up to date`));
        return;
    }
    writeFileSync(path, serializeLedger(result.next), "utf8");
    console.log(chalk.green(`✓ ${path}`));
}
/** The real append-only gate: compare against the lockfile at the merge base. */
function checkBase(candidate, basePath) {
    if (basePath === undefined)
        return [];
    const base = loadLedger(basePath);
    if (base.ledger === null)
        return [];
    return isSuperset(candidate, base.ledger).missing;
}
function reportEmitError(error) {
    if (error instanceof CodecUnsupportedError) {
        const where = error.span === null ? "" : `${error.span.line}:${error.span.col} `;
        console.error(chalk.red(`error ${error.code} ${where}${error.message}`));
        return;
    }
    console.error(chalk.red(`error: ${error.message}`));
}
async function cmdAdd(ref, opts) {
    const registry = resolveRegistry(opts.registry);
    let resolved;
    try {
        resolved = await fetchSchema(registry, parseSchemaRef(ref));
    }
    catch (e) {
        console.error(chalk.red(`error: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
    }
    // Default to a folder named after the schema so multiple `add`s don't collide.
    const outDir = opts.out === "." ? resolved.name : opts.out;
    mkdirSync(outDir, { recursive: true });
    for (const file of resolved.files) {
        const fullPath = join(outDir, file.path);
        writeFileSync(fullPath, file.contents, "utf8");
        console.log(chalk.green(`✓ ${fullPath}`));
    }
    console.log(chalk.dim(`\n  added @${resolved.scope}/${resolved.name}@${resolved.version} (${resolved.files.length} file${resolved.files.length === 1 ? "" : "s"})`));
}
// ── login / publish ───────────────────────────────────────────────────────────
async function cmdLogin() {
    try {
        await login();
        console.log(chalk.green("\n  ✓ signed in. Credentials saved.\n"));
    }
    catch (e) {
        console.error(chalk.red(`error: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
    }
}
// Collect the .schema source files under a directory as publish payload files.
function collectSchemaFiles(dir) {
    const entries = readdirSync(dir).filter((entry) => entry.endsWith(".schema"));
    if (entries.length === 0) {
        console.error(chalk.red(`error: no .schema files found in ${dir}`));
        process.exit(1);
    }
    return entries.map((entry) => ({ path: entry, contents: readFileSync(join(dir, entry), "utf8") }));
}
async function cmdPublish(dir, opts) {
    if (!opts.scope || !opts.name || !opts.version) {
        console.error(chalk.red("error: --scope, --name and --version are required"));
        process.exit(1);
    }
    const files = collectSchemaFiles(dir);
    const payload = {
        scope: opts.scope,
        name: opts.name,
        version: opts.version,
        description: opts.description,
        license: opts.license,
        repository: opts.repository,
        targets: [],
        files,
    };
    const site = opts.site || resolveEndpoints().site;
    try {
        const token = await getAccessToken();
        await publish(site, token, payload);
    }
    catch (e) {
        console.error(chalk.red(`error: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
    }
    console.log(chalk.green(`\n  ✓ published @${opts.scope}/${opts.name}@${opts.version} (${files.length} file${files.length === 1 ? "" : "s"})\n`));
}
function cmdMigrate(oldPath, newPath, opts) {
    const oldSchema = resolveProject(oldPath);
    const newSchema = resolveProject(newPath);
    const emitter = getMigrationEmitter(opts.target);
    if (emitter === null) {
        console.error(chalk.red(`error: no migration emitter for target '${opts.target}'`));
        process.exit(1);
    }
    const plan = buildMigrationPlan(oldSchema, newSchema);
    if (plan.ops.length === 0) {
        console.log(chalk.green("✓ schemas are identical — no migration needed"));
        return;
    }
    const files = emitter.emit({
        oldSchema,
        newSchema,
        plan,
        company: opts.company ?? null,
        includePrivate: opts.includePrivate === true,
    });
    mkdirSync(opts.out, { recursive: true });
    for (const file of files) {
        const fullPath = join(opts.out, file.path);
        writeFileSync(fullPath, file.contents, "utf8");
        console.log(chalk.green(`✓ ${fullPath} (${plan.ops.length} ops)`));
    }
    if (plan.hasDestructive)
        console.log(chalk.yellow("⚠ contains DESTRUCTIVE operations — review before running"));
    if (plan.hasManualSteps)
        console.log(chalk.yellow("⚠ contains TODO/LOSSY steps that need manual completion"));
}
function reportFrontEndError(e) {
    if (e instanceof Error) {
        console.error(chalk.red(e.message));
        process.exit(1);
    }
    throw e;
}
function printDiagnostics(diagnostics) {
    for (const d of diagnostics) {
        const location = d.span ? `${d.span.line}:${d.span.col} ` : "";
        const colour = d.severity === "error" ? chalk.red : chalk.yellow;
        console.error(colour(`${d.severity} ${d.code} ${location}${d.message}`));
    }
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function readFile(filePath) {
    if (!existsSync(filePath)) {
        console.error(chalk.red(`error: file not found: ${filePath}`));
        process.exit(1);
    }
    try {
        return readFileSync(filePath, "utf8");
    }
    catch (e) {
        console.error(chalk.red(`error: could not read file: ${filePath}`));
        process.exit(1);
    }
}
const SEVERITY_ICON = {
    safe: chalk.green("✓"),
    warning: chalk.yellow("⚠"),
    breaking_reader: chalk.red("✗"),
    breaking_writer: chalk.red("✗"),
    breaking_both: chalk.red("✗"),
};
const SEVERITY_COLOUR = {
    safe: chalk.green,
    warning: chalk.yellow,
    breaking_reader: chalk.red,
    breaking_writer: chalk.red,
    breaking_both: chalk.red,
};
const SEVERITY_LABEL = {
    safe: "safe",
    warning: "warning",
    breaking_reader: "breaking (reader)",
    breaking_writer: "breaking (writer)",
    breaking_both: "breaking (both)",
};
function formatChange(c, { verbose }) {
    const col = SEVERITY_COLOUR[c.severity];
    const icon = SEVERITY_ICON[c.severity];
    const label = col(SEVERITY_LABEL[c.severity]);
    const rule = chalk.dim(`[${c.ruleId}]`);
    const path = chalk.bold(c.path);
    const lines = [`  ${icon} ${rule} ${path}  ${label}`];
    if (verbose) {
        lines.push(`     ${chalk.dim(c.rationale)}`);
        if (c.before || c.after) {
            const parts = [];
            if (c.before)
                parts.push(chalk.red(`− ${c.before}`));
            if (c.after)
                parts.push(chalk.green(`+ ${c.after}`));
            lines.push(`     ${parts.join("  →  ")}`);
        }
    }
    return lines.join("\n");
}
function printSummary(changes) {
    const breaking = changes.filter((c) => c.severity.startsWith("breaking")).length;
    const warnings = changes.filter((c) => c.severity === "warning").length;
    const safe = changes.filter((c) => c.severity === "safe").length;
    const parts = [];
    if (breaking)
        parts.push(chalk.red(`${breaking} breaking`));
    if (warnings)
        parts.push(chalk.yellow(`${warnings} warnings`));
    if (safe)
        parts.push(chalk.green(`${safe} safe`));
    if (!parts.length)
        parts.push(chalk.green("no changes"));
    console.log(`\n  ${chalk.bold("Summary:")} ${parts.join(", ")}`);
}
// ── Command: parse ────────────────────────────────────────────────────────────
function cmdParse(filePath, opts) {
    const source = readFile(filePath);
    // ── Lex ──────────────────────────────────────────────────────────────────
    let tokens;
    try {
        tokens = new Lexer(source).tokenize();
    }
    catch (e) {
        if (e instanceof LexError) {
            console.error(chalk.red(`lex error: ${e.message}`));
            process.exit(1);
        }
        throw e;
    }
    if (opts.tokens) {
        if (opts.json) {
            console.log(JSON.stringify(tokens, null, 2));
        }
        else {
            console.log(chalk.bold(`\nTokens in ${filePath}\n`));
            for (const t of tokens) {
                console.log(`  ${String(t.line).padStart(4)}:${String(t.col).padEnd(4)}` +
                    `  ${t.kind.padEnd(20)}  ${chalk.dim(JSON.stringify(t.value))}`);
            }
            console.log(chalk.dim(`\n  ${tokens.length} tokens\n`));
        }
        return;
    }
    // ── Parse ─────────────────────────────────────────────────────────────────
    let ast;
    try {
        ast = new Parser(tokens).parse();
    }
    catch (e) {
        if (e instanceof ParseError) {
            console.error(chalk.red(`parse error: ${e.message}`));
            process.exit(1);
        }
        throw e;
    }
    if (opts.ast || opts.json) {
        console.log(JSON.stringify(ast, null, 2));
        return;
    }
    // ── Human-readable summary ────────────────────────────────────────────────
    console.log(chalk.bold(`\nSchema: ${filePath}\n`));
    for (const decl of ast.declarations) {
        switch (decl.kind) {
            case "namespace":
                console.log(`  ${chalk.cyan("namespace")}  ${decl.path.join(".")}`);
                break;
            case "import":
                console.log(`  ${chalk.cyan("import")}     { ${decl.names.join(", ")} }` +
                    chalk.dim(`  from "${decl.from}"`));
                break;
            case "type_alias":
                console.log(`  ${chalk.cyan("type")}       ${chalk.bold(decl.name)}`);
                break;
            case "enum": {
                console.log(`  ${chalk.cyan("enum")}       ${chalk.bold(decl.name)}` +
                    chalk.dim(`  (${decl.variants.length} variants)`));
                for (const v of decl.variants) {
                    console.log(`               ${chalk.dim(String(v.ordinal).padStart(3))}  ${v.name}`);
                }
                break;
            }
            case "model": {
                const fields = decl.members.length;
                console.log(`  ${chalk.cyan("model")}     ${chalk.bold(decl.name)}` +
                    chalk.dim(`  (${fields} fields)`));
                for (const field of decl.members) {
                    const ordinal = field.ordinal != null
                        ? chalk.dim(String(field.ordinal).padStart(3))
                        : chalk.dim("  -");
                    const access = field.private ? chalk.dim("private ") : "        ";
                    const type = describeType(field.type);
                    const doc = field.doc
                        ? chalk.dim(`  // ${field.doc.split("\n")[0]}`)
                        : "";
                    console.log(`               ${ordinal}  ${access}${field.name.padEnd(18)}${chalk.dim(type)}${doc}`);
                }
                break;
            }
        }
        console.log();
    }
    console.log(chalk.green(`  ✓ ${filePath} is valid\n`));
}
// ── Command: diff ─────────────────────────────────────────────────────────────
function cmdDiff(oldPath, newPath, opts) {
    const oldSource = readFile(oldPath);
    const newSource = readFile(newPath);
    let result;
    try {
        result = engineDiff(oldSource, newSource);
    }
    catch (e) {
        if (e instanceof LexError || e instanceof ParseError) {
            console.error(chalk.red(`error: ${e.message}`));
            process.exit(1);
        }
        throw e;
    }
    // Filter
    let changes = result.changes;
    if (opts.only === "breaking") {
        changes = changes.filter((c) => c.severity.startsWith("breaking"));
    }
    else if (opts.only === "warnings") {
        changes = changes.filter((c) => c.severity === "warning");
    }
    else if (opts.only === "safe") {
        changes = changes.filter((c) => c.severity === "safe");
    }
    if (opts.json) {
        console.log(JSON.stringify({ changes, breaking: result.breaking, warnings: result.warnings }, null, 2));
        return;
    }
    console.log(chalk.bold(`\nDiff: ${chalk.dim(oldPath)} → ${chalk.dim(newPath)}\n`));
    if (changes.length === 0) {
        if (opts.only === "all") {
            console.log(chalk.green("  ✓ No changes detected\n"));
        }
        else {
            console.log(chalk.dim(`  No ${opts.only} changes\n`));
        }
        return;
    }
    // Group by severity bucket for readability
    const groups = [
        ["Breaking", changes.filter((c) => c.severity.startsWith("breaking"))],
        ["Warnings", changes.filter((c) => c.severity === "warning")],
        ["Safe", changes.filter((c) => c.severity === "safe")],
    ];
    for (const [title, cs] of groups) {
        if (!cs.length)
            continue;
        console.log(chalk.bold(`  ${title}`));
        for (const c of cs) {
            console.log(formatChange(c, { verbose: opts.verbose }));
        }
        console.log();
    }
    printSummary(result.changes);
    console.log();
}
function describeType(t) {
    switch (t.kind) {
        case "scalar":
            return t.scalar;
        case "decimal":
            return `decimal(${t.precision}, ${t.scale})`;
        case "named":
            return t.typeArgs.length === 0
                ? t.path.join(".")
                : `${t.path.join(".")}<${t.typeArgs.map(describeType).join(", ")}>`;
        case "array":
            return `[${describeType(t.element)}]`;
        case "map":
            return `{${describeType(t.key)}: ${describeType(t.value)}}`;
        case "nullable":
            return `${describeType(t.inner)}?`;
        case "union":
            return t.variants.map(describeType).join(" | ");
        case "oneof":
            return `oneof { ${t.variants.map((v) => `${v.name}: ${describeType(v.type)}`).join(", ")} }`;
    }
}
// ── Command: check ────────────────────────────────────────────────────────────
function cmdCheck(oldPath, newPath, opts) {
    const oldSource = readFile(oldPath);
    const newSource = readFile(newPath);
    let result;
    try {
        result = engineDiff(oldSource, newSource);
    }
    catch (e) {
        if (e instanceof LexError || e instanceof ParseError) {
            console.error(chalk.red(`error: ${e.message}`));
            process.exit(1);
        }
        throw e;
    }
    const violations = result.violations(opts.mode);
    const compatible = violations.length === 0;
    if (opts.json) {
        console.log(JSON.stringify({
            compatible,
            mode: opts.mode,
            violations,
            changes: result.changes,
        }, null, 2));
        process.exit(compatible ? 0 : 1);
    }
    if (opts.quiet) {
        process.exit(compatible ? 0 : 1);
    }
    const modeLabel = chalk.bold(opts.mode);
    if (compatible) {
        console.log(chalk.green(`\n  ✓ Compatible`) +
            chalk.dim(` under ${opts.mode} mode`) +
            (result.changes.length
                ? chalk.dim(`  (${result.changes.length} change${result.changes.length > 1 ? "s" : ""}, none breaking)`)
                : chalk.dim("  (no changes)")));
        if (result.warnings.length && opts.verbose) {
            console.log(chalk.bold(`\n  Warnings`));
            for (const w of result.warnings) {
                console.log(formatChange(w, { verbose: true }));
            }
        }
        console.log();
        process.exit(0);
    }
    // Not compatible
    console.log(chalk.red(`\n  ✗ Not compatible`) +
        chalk.dim(` under ${opts.mode} mode`) +
        chalk.dim(`  (${violations.length} violation${violations.length > 1 ? "s" : ""})`));
    console.log(chalk.bold(`\n  Violations`));
    for (const v of violations) {
        console.log(formatChange(v, { verbose: opts.verbose ?? true }));
    }
    if (result.warnings.length) {
        console.log(chalk.bold(`\n  Warnings`));
        for (const w of result.warnings) {
            console.log(formatChange(w, { verbose: opts.verbose }));
        }
    }
    console.log();
    process.exit(1);
}
// ── Program ───────────────────────────────────────────────────────────────────
const program = new Command();
program
    .name("openschema")
    .description("OpenSchema DSL — schema compiler, differ, and compatibility checker")
    .version(VERSION, "-v, --version")
    .addHelpText("after", [
    "",
    "Examples:",
    "  openschema order.schema -t ts -o ./src/types",
    "  openschema order.schema -t codec,sql -o ./generated",
    "  openschema check published.schema order.schema --mode backward",
    "",
    "The ordinal lockfile beside the schema is maintained automatically;",
    "commit it. In CI it is treated as read-only.",
    "",
].join("\n"));
// ── generate (default) ────────────────────────────────────────────────────────
//
// Generating is what the tool is for, so it needs no verb: `openschema
// order.schema -t ts`. `gen` stays as an alias so existing scripts keep working.
//
// The options live on the subcommand, never on the root program: a root option
// of the same name shadows the subcommand's and silently swallows its value.
program
    .command("generate [schema]", { isDefault: true })
    .alias("gen")
    .description("Generate output for a target from a schema file (default command)")
    .option("-t, --target <targets>", `output target(s), comma-separated (${listTargets().join(", ")})`)
    .option("-o, --out <dir>", "output directory", ".")
    .option("--company <id>", "include this company's overlay fields")
    .option("--include-private", "include base-record private fields")
    .option("--lock <path>", "ordinal lockfile (default: <schema dir>/openschema.lock)")
    .option("--frozen", "never write the ordinal ledger; fail if it is missing or stale")
    .option("--write-lock", "write the ordinal ledger even when CI is set")
    .option("--no-lock", "skip the ordinal ledger entirely")
    .action((schemaPath, opts) => {
    if (schemaPath === undefined) {
        program.help();
        return;
    }
    cmdGenerate(schemaPath, opts);
});
// ── parse ─────────────────────────────────────────────────────────────────────
program
    .command("parse <file>")
    .description("Validate and summarise a schema file")
    .option("--tokens", "dump the token stream instead of the AST summary")
    .option("--ast", "dump the full AST as JSON")
    .option("--json", "format output as JSON (used with --tokens or --ast)")
    .action((file, opts) => cmdParse(file, opts));
// ── diff ──────────────────────────────────────────────────────────────────────
program
    .command("diff <old> <new>")
    .description("Show all changes between two schema files")
    .addOption(new Option("--only <filter>", "show only a subset of changes")
    .choices(["all", "breaking", "warnings", "safe"])
    .default("all"))
    .option("--json", "output results as JSON")
    .option("-v, --verbose", "show rationale and before/after for each change")
    .action((oldPath, newPath, opts) => cmdDiff(oldPath, newPath, opts));
// ── check ─────────────────────────────────────────────────────────────────────
program
    .command("check <old> <new>")
    .description("Assert schema compatibility under a mode (exits 1 if violated — useful in CI)")
    .addOption(new Option("-m, --mode <mode>", "compatibility mode to enforce")
    .choices(["backward", "forward", "full", "none"])
    .default("backward"))
    .option("--json", "output results as JSON")
    .option("-q, --quiet", "suppress output; communicate result via exit code only")
    .option("-v, --verbose", "show rationale and before/after for each change", true)
    .action((oldPath, newPath, opts) => cmdCheck(oldPath, newPath, opts));
// ── lock ──────────────────────────────────────────────────────────────────────
program
    .command("lock <schema>")
    .description("Verify the ordinal ledger without generating (CI gate)")
    .option("--lock <path>", "lockfile path (default: <schema dir>/openschema.lock)")
    .option("--check", "do not write; exit 1 if the ledger is missing or out of date")
    .option("--base <path>", "assert the result still contains everything this lockfile records")
    .option("--json", "machine-readable output")
    .action((schema, opts) => cmdLock(schema, opts));
program
    .command("migrate <old> <new>")
    .description("Generate a migration script between two schema versions")
    .addOption(new Option("-t, --target <target>", "migration target")
    .choices(MIGRATION_TARGETS)
    .makeOptionMandatory())
    .option("-o, --out <dir>", "output directory", ".")
    .option("--company <id>", "include this company's overlay fields")
    .option("--include-private", "include base-record private fields")
    .action((oldPath, newPath, opts) => cmdMigrate(oldPath, newPath, opts));
// ── add ─────────────────────────────────────────────────────────────────────
program
    .command("add <schema>")
    .description("Download a published schema from the registry (e.g. @neoworks/commerce)")
    .option("-o, --out <dir>", "output directory (defaults to the schema name)", ".")
    .option("--registry <url>", "registry API base (default: production)")
    .action((schema, opts) => cmdAdd(schema, opts));
// ── login ─────────────────────────────────────────────────────────────────────
program
    .command("login")
    .description("Sign in to the OpenSchema registry (browser-based)")
    .action(() => cmdLogin());
// ── publish ─────────────────────────────────────────────────────────────────────
program
    .command("publish [dir]")
    .description("Publish a schema to the registry (submitted to the org's server)")
    .option("--scope <scope>", "publisher scope (e.g. neoworks)")
    .option("--name <name>", "schema name")
    .option("--version <version>", "semantic version (e.g. 1.0.0)")
    .option("--description <text>", "short description")
    .option("--license <id>", "license identifier (e.g. MIT)")
    .option("--repository <url>", "source repository URL")
    .option("--site <url>", "openschema site base (default: production)")
    .action((dir, opts) => cmdPublish(dir ?? ".", opts));
program.parse(process.argv);
//# sourceMappingURL=index.js.map