#!/usr/bin/env node
// src/mcp/server.ts
// Model Context Protocol server for OpenSchema.
//
// Exposes the compiler over stdio so an LLM agent can validate, generate,
// diff, and inspect OpenSchema projects. Every tool is a thin wrapper over
// the same public API the CLI uses (loadProject / resolveModules / getEmitter
// / engine diff), so behaviour stays identical to `openschema gen|diff`.

import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync, readFileSync } from "fs";

import { loadProject, resolveModules } from "../resolver/index.js";
import type { ReadFileOrNull } from "../resolver/moduleGraph.js";
import { getEmitter, listTargets } from "../emit/index.js";
import { diff as engineDiff } from "../engine/index.js";
import type { ResolvedSchema, Diagnostic } from "../resolver/types.js";

// ── Shared helpers ────────────────────────────────────────────────────────────

const readFileOrNull: ReadFileOrNull = (path: string) => {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
};

/** A tool whose path argument does not exist on disk. */
class SchemaPathError extends Error {}

function readSchemaSource(path: string): string {
  const source = readFileOrNull(path);
  if (source === null) {
    throw new SchemaPathError(`schema file not found: ${path}`);
  }
  return source;
}

/**
 * Load and resolve an entry schema and its import graph into a single
 * ResolvedSchema. Throws SchemaPathError if the entry file is missing.
 */
function resolveEntry(entryPath: string): ResolvedSchema {
  readSchemaSource(entryPath); // surface a friendly error before parsing
  const modules = loadProject(entryPath, readFileOrNull);
  return resolveModules(modules);
}

function diagnosticsPayload(diagnostics: Diagnostic[]): Array<Record<string, unknown>> {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    span: diagnostic.span,
  }));
}

/** Wrap a result object as the JSON text content every tool returns. */
function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/** Wrap an error as an MCP tool error result rather than crashing the server. */
function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

// ── Server ────────────────────────────────────────────────────────────────────

/** Build the OpenSchema MCP server with all tools registered. */
export function buildServer(): McpServer {
  const server = new McpServer({
    name: "openschema",
    version: "0.1.0",
  });

  registerTools(server);
  return server;
}

function registerTools(server: McpServer): void {
server.registerTool(
  "list_targets",
  {
    title: "List code-generation targets",
    description:
      "List the available OpenSchema emitter targets (sql, ts, go, json-schema, graphql, openapi, surrealdb).",
    inputSchema: {},
  },
  async () => {
    return jsonResult({ targets: listTargets() });
  },
);

server.registerTool(
  "validate_schema",
  {
    title: "Validate an OpenSchema project",
    description:
      "Parse and resolve a schema file and its import graph, returning resolver diagnostics (OS#### codes). " +
      "Use this to check a schema compiles before generating code.",
    inputSchema: {
      path: z.string().describe("Path to the entry .schema/.openschema file."),
    },
  },
  async ({ path }) => {
    try {
      const schema = resolveEntry(path);
      return jsonResult({
        valid: !schema.hasErrors,
        diagnostics: diagnosticsPayload(schema.diagnostics),
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "generate_code",
  {
    title: "Generate code from an OpenSchema project",
    description:
      "Resolve a schema and emit files for a target. Returns each generated file as { path, contents }. " +
      "Fails if the schema has resolver errors.",
    inputSchema: {
      path: z.string().describe("Path to the entry .schema/.openschema file."),
      target: z
        .string()
        .describe("Emitter target, e.g. sql, ts, go, json-schema, graphql, openapi, surrealdb."),
      company: z
        .string()
        .optional()
        .describe("Include this company's overlay fields, if any."),
      includePrivate: z
        .boolean()
        .optional()
        .describe("Include base-model private fields (default false)."),
    },
  },
  async ({ path, target, company, includePrivate }) => {
    try {
      const schema = resolveEntry(path);
      if (schema.hasErrors) {
        return jsonResult({
          generated: false,
          diagnostics: diagnosticsPayload(schema.diagnostics),
        });
      }

      const emitter = getEmitter(target);
      if (emitter === null) {
        return errorResult(
          new Error(`no emitter for target '${target}'. Available: ${listTargets().join(", ")}`),
        );
      }

      const files = emitter.emit({
        schema,
        company: company ?? null,
        includePrivate: includePrivate === true,
        options: {},
      });

      return jsonResult({
        generated: true,
        target,
        fileExtension: emitter.fileExtension,
        files,
        diagnostics: diagnosticsPayload(schema.diagnostics),
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "diff_schemas",
  {
    title: "Diff two schema versions for compatibility",
    description:
      "Compare an old and a new single-file schema, returning every change with its rule id (R###) and " +
      "severity, plus a compatibility verdict for the given mode.",
    inputSchema: {
      oldPath: z.string().describe("Path to the previous schema version."),
      newPath: z.string().describe("Path to the new schema version."),
      mode: z
        .enum(["backward", "forward", "full", "none"])
        .optional()
        .describe("Compatibility mode to evaluate (default backward)."),
    },
  },
  async ({ oldPath, newPath, mode }) => {
    try {
      const oldSource = readSchemaSource(oldPath);
      const newSource = readSchemaSource(newPath);
      const result = engineDiff(oldSource, newSource);
      const compatMode = mode ?? "backward";

      return jsonResult({
        mode: compatMode,
        compatible: result.isCompatible(compatMode),
        changes: result.changes,
        breaking: result.breaking,
        warnings: result.warnings,
        violations: result.violations(compatMode),
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "inspect_project",
  {
    title: "Inspect a resolved OpenSchema project",
    description:
      "Resolve a schema and its import graph, returning a summary of every declaration across all modules: " +
      "models (with field names), enums, type aliases, operations, and per-company overlays.",
    inputSchema: {
      path: z.string().describe("Path to the entry .schema/.openschema file."),
    },
  },
  async ({ path }) => {
    try {
      const schema = resolveEntry(path);

      const models = Array.from(schema.records.entries()).map(([name, model]) => ({
        name,
        fields: model.fields.map((field) => ({
          ordinal: field.ordinal,
          name: field.name,
          private: field.isPrivate,
        })),
      }));

      const overlays: Array<Record<string, unknown>> = [];
      for (const [base, byCompany] of schema.overlays.entries()) {
        for (const [company, overlay] of byCompany.entries()) {
          overlays.push({
            base,
            company,
            fields: overlay.fields.map((field) => field.name),
          });
        }
      }

      return jsonResult({
        namespace: schema.namespace,
        valid: !schema.hasErrors,
        models,
        enums: Array.from(schema.enums.keys()),
        aliases: Array.from(schema.aliases.keys()),
        operations: schema.operations.map((operation) => operation.name),
        overlays,
        diagnostics: diagnosticsPayload(schema.diagnostics),
      });
    } catch (error) {
      return errorResult(error);
    }
  },
);

} // end registerTools

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await buildServer().connect(transport);
}

// Only start the stdio server when run as the entry point, not when imported
// by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("openschema MCP server failed to start:", error);
    process.exit(1);
  });
}
