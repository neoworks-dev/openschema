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
import { basename, dirname, join } from "path";
import { Lexer, LexError } from "../lexer/lexer.js";
import { Parser, ParseError } from "../parser/parser.js";
import { diff as engineDiff } from "../engine/index.js";
import { resolveModules, loadProject } from "../resolver/index.js";
import { getEmitter, listTargets } from "../emit/index.js";
import { getMigrationEmitter, MIGRATION_TARGETS } from "../emit/migration/index.js";
import { buildMigrationPlan } from "../engine/migration.js";
import { IncompatibleSchemaError, PublishRefusedError, describeViolations, fetchSchema, listVersions, parseSchemaRef, publish, resolveRegistry } from "../registry/client.js";
import { snapshotVersions, writeVersionSnapshot } from "../registry/versionSnapshots.js";
import { getAccessToken, login } from "../registry/auth.js";
import { resolveEndpoints } from "../registry/urls.js";
import { findCollectionIdentity, readCollectionIdentity, readManifestVersion } from "../registry/collectionName.js";
import { CODEC_MODULE_OPTION, COLLECTION_OPTION, COLLECTION_VERSION_OPTION, VERSIONS_MODULE_OPTION } from "../emit/collection/collectionEmitter.js";
import { CURRENT_VERSION_OPTION, ENTRY_OPTION, PROJECT_DIRECTORY_OPTION, VERSIONS_CODEC_MODULE_OPTION } from "../emit/versions/versionsEmitter.js";
import { initProject } from "./init.js";
import { preparePublish } from "../registry/preparePublish.js";
import { collectSpaces } from "../ledger/spaces.js";
import { reconcileLedger } from "../ledger/merge.js";
import { defaultLockPath, isSuperset, loadLedger, serializeLedger } from "../ledger/io.js";
import { CodecUnsupportedError } from "../emit/codec/errors.js";
import { DescriptorError } from "../emit/descriptor/errors.js";
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
    const files = emitAll(emitters, schema, opts, schemaPath);
    // The lockfile lands only after every emitter has succeeded, so a rejected
    // construct never leaves behind a ledger recording ordinals that produced no
    // output.
    if (pendingLock !== null)
        writeLockfile(pendingLock);
    mkdirSync(opts.out, { recursive: true });
    for (const file of files) {
        const fullPath = join(opts.out, file.path);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, file.contents, "utf8");
        console.log(chalk.green(`✓ ${fullPath}`));
    }
}
// The versions target imports from the codec module, and the collection target
// re-exports both, so they run last, in this order.
const LATE_TARGETS = ["versions", "collection"];
/**
 * Runs every emitter. The versions and collection targets run last: they read the
 * manifest beside the schema and use the modules the earlier targets wrote.
 */
function emitAll(emitters, schema, opts, schemaPath) {
    const files = [];
    const modules = { codec: [], versions: [] };
    for (const emitter of inEmitOrder(emitters)) {
        try {
            const emitted = emitter.emit({
                schema,
                company: opts.company ?? null,
                includePrivate: opts.includePrivate === true,
                options: emitOptions(emitter, schemaPath, modules),
            });
            recordModules(emitter, emitted, modules);
            files.push(...emitted);
        }
        catch (error) {
            reportEmitError(error);
            process.exit(1);
        }
    }
    return files;
}
function inEmitOrder(emitters) {
    const early = emitters.filter(emitter => !LATE_TARGETS.includes(emitter.target));
    const late = LATE_TARGETS.flatMap(target => emitters.filter(emitter => emitter.target === target));
    return [...early, ...late];
}
function recordModules(emitter, emitted, modules) {
    if (emitter.target === "codec")
        modules.codec.push(...emitted.map(file => file.path));
    if (emitter.target === "versions")
        modules.versions.push(...emitted.map(file => file.path));
}
function emitOptions(emitter, schemaPath, modules) {
    if (emitter.target === "versions")
        return versionsOptions(schemaPath, modules);
    if (emitter.target === "kotlin")
        return kotlinOptions(schemaPath);
    if (emitter.target !== "collection")
        return {};
    const identity = readCollectionIdentity(dirname(schemaPath));
    const options = { [COLLECTION_OPTION]: identity.name, [COLLECTION_VERSION_OPTION]: identity.version };
    if (modules.codec.length > 0)
        options[CODEC_MODULE_OPTION] = modules.codec[0];
    if (modules.versions.length > 0)
        options[VERSIONS_MODULE_OPTION] = modules.versions[0];
    return options;
}
/** The Kotlin target writes the schema object only for a schema with a manifest beside it. */
function kotlinOptions(schemaPath) {
    const identity = findCollectionIdentity(dirname(schemaPath));
    if (identity === null)
        return {};
    return { [COLLECTION_OPTION]: identity.name, [COLLECTION_VERSION_OPTION]: identity.version };
}
function versionsOptions(schemaPath, modules) {
    const projectDirectory = dirname(schemaPath);
    const options = {
        [PROJECT_DIRECTORY_OPTION]: projectDirectory,
        [ENTRY_OPTION]: basename(schemaPath),
        [CURRENT_VERSION_OPTION]: readCollectionIdentity(projectDirectory).version,
    };
    if (modules.codec.length > 0)
        options[VERSIONS_CODEC_MODULE_OPTION] = modules.codec[0];
    return options;
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
        version: readManifestVersion(dirname(schemaPath)),
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
        version: readManifestVersion(dirname(schemaPath)),
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
    if (error instanceof CodecUnsupportedError || error instanceof DescriptorError) {
        console.error(chalk.red(`error ${error.code} ${spanPrefix(error.span)}${error.message}`));
        return;
    }
    console.error(chalk.red(`error: ${error.message}`));
}
function spanPrefix(span) {
    if (span === null)
        return "";
    return `${span.line}:${span.col} `;
}
/** The service URLs for this run, or an exit with the reason the --base-port is unusable. */
function endpointsOrExit(opts) {
    try {
        return resolveEndpoints({ port: opts.basePort });
    }
    catch (e) {
        console.error(chalk.red(`error: ${describeError(e)}`));
        process.exit(1);
    }
}
async function cmdAdd(ref, opts) {
    const registry = resolveRegistry(opts.registry, endpointsOrExit(opts));
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
async function cmdLogin(opts) {
    const endpoints = endpointsOrExit(opts);
    try {
        await login(endpoints);
        console.log(chalk.green("\n  ✓ signed in. Credentials saved.\n"));
    }
    catch (e) {
        console.error(chalk.red(`error: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
    }
}
async function cmdPublish(dir, opts) {
    const prepared = preparePublish(dir, GENERATOR);
    if (prepared.payload === null) {
        for (const problem of prepared.problems)
            console.error(chalk.red(`error: ${problem}`));
        console.error(chalk.dim("  nothing was published"));
        process.exit(1);
    }
    const payload = prepared.payload;
    const endpoints = endpointsOrExit(opts);
    try {
        const token = await getAccessToken(endpoints);
        await publish(publishSite(opts, endpoints), token, payload);
    }
    catch (error) {
        reportPublishFailure(payload, error);
        process.exit(1);
    }
    console.log(chalk.green(`\n  ✓ published @${payload.scope}/${payload.name}@${payload.version} (${describeUpload(payload)})`));
    const snapshot = writeVersionSnapshot(dir, payload.version, payload.files);
    console.log(chalk.dim(`  kept its files in ${snapshot} for the versions target\n`));
}
// ── versions pull ─────────────────────────────────────────────────────────────
function describeVersionCount(count) {
    if (count === 1)
        return "1 version";
    return `${count} versions`;
}
async function cmdVersionsPull(dir, opts) {
    try {
        const identity = readCollectionIdentity(dir);
        const ref = parseSchemaRef(identity.name);
        const registry = resolveRegistry(opts.registry, endpointsOrExit(opts));
        const present = new Set(snapshotVersions(dir));
        const missing = (await listVersions(registry, ref.scope, ref.name)).filter(version => !present.has(version));
        for (const version of missing) {
            const resolved = await fetchSchema(registry, { ...ref, version });
            console.log(chalk.green(`✓ ${writeVersionSnapshot(dir, version, resolved.files)}`));
        }
        console.log(chalk.dim(`\n  ${describeVersionCount(missing.length)} pulled`));
    }
    catch (e) {
        console.error(chalk.red(`error: ${describeError(e)}`));
        process.exit(1);
    }
}
function reportRefusedPublish(payload, refusal) {
    const [header, ...violations] = describeViolations(payload, refusal.violations);
    console.error(chalk.red(`error: ${header}`));
    for (const line of violations)
        console.error(line);
    console.error(chalk.dim("  nothing was published"));
}
function reportPublishFailure(payload, error) {
    if (error instanceof IncompatibleSchemaError) {
        reportRefusedPublish(payload, error);
        return;
    }
    console.error(chalk.red(`error: ${describeError(error)}`));
    if (error instanceof PublishRefusedError)
        console.error(chalk.dim("  nothing was published"));
}
function publishSite(opts, endpoints) {
    if (opts.site)
        return opts.site;
    return endpoints.site;
}
function describeError(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
function describeUpload(payload) {
    let files = `${payload.files.length} files`;
    if (payload.files.length === 1)
        files = "1 file";
    if (payload.descriptor === undefined)
        return files;
    return `${files}, with descriptor`;
}
// ── init ──────────────────────────────────────────────────────────────────────
function cmdInit(dir, opts) {
    try {
        for (const path of initProject(dir, opts))
            console.log(chalk.green(`✓ ${path}`));
    }
    catch (e) {
        console.error(chalk.red(`error: ${describeError(e)}`));
        process.exit(1);
    }
    if (opts.scope === undefined)
        console.log(chalk.yellow("\n  ⚠ set `scope` in openschema.yaml to your handle before publishing."));
    console.log(chalk.dim("  The header of the schema file shows how to generate the collection module."));
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
        case "null":
            return "null";
        case "file":
            return "File";
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
const BASE_PORT_HELP = "port of every service on the base domain, e.g. 8443 for *.neoworks.localhost:8443 (env: OPENSCHEMA_BASE_PORT)";
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
    .option("--base-port <port>", BASE_PORT_HELP)
    .action((schema, opts) => cmdAdd(schema, opts));
program
    .command("versions")
    .description("The published versions of the schema beside openschema.yaml")
    .command("pull [dir]")
    .description("Download the files of every published version into [dir]/versions/<version>/, for the versions target")
    .option("--registry <url>", "registry API base (default: production)")
    .option("--base-port <port>", BASE_PORT_HELP)
    .action((dir, opts) => cmdVersionsPull(dir ?? ".", opts));
// ── login ─────────────────────────────────────────────────────────────────────
program
    .command("login")
    .description("Sign in to the OpenSchema registry (browser-based)")
    .option("--base-port <port>", BASE_PORT_HELP)
    .action((opts) => cmdLogin(opts));
// ── publish ─────────────────────────────────────────────────────────────────────
program
    .command("publish [dir]")
    .description("Publish the schema described by [dir]/openschema.yaml to the registry (submitted to the org's server)")
    .option("--site <url>", "openschema site base (default: production)")
    .option("--base-port <port>", BASE_PORT_HELP)
    .action((dir, opts) => cmdPublish(dir ?? ".", opts));
// ── init ──────────────────────────────────────────────────────────────────────
program
    .command("init [dir]")
    .description("Write a starter openschema.yaml and schema for a new collection")
    .option("--scope <handle>", "your handle or organization, the scope of the registry path")
    .option("--name <name>", "the schema's name (default: the directory name)")
    .option("--title <text>", "the title shown in the registry")
    .option("--description <text>", "the description shown in the registry")
    .option("--force", "overwrite files that already exist")
    .action((dir, opts) => cmdInit(dir ?? ".", opts));
program.parse(process.argv);
//# sourceMappingURL=index.js.map