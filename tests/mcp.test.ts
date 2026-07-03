// tests/mcp.test.ts
// End-to-end tests for the OpenSchema MCP server, driven through the SDK's
// in-memory transport so the full registerTool wiring is exercised.

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { buildServer } from "../src/mcp/server";

const ENTRY_SCHEMA = join(import.meta.dir, "..", "examples", "orders.v1.schema");

let client: Client;

beforeAll(async () => {
  const server = buildServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close();
});

/** Call a tool and parse the JSON text content it returns. */
async function callJson(name: string, args: Record<string, unknown>): Promise<any> {
  const result = (await client.callTool({ name, arguments: args })) as any;
  expect(result.content[0].type).toBe("text");
  return JSON.parse(result.content[0].text);
}

describe("openschema MCP server", () => {
  it("lists every tool", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "diff_schemas",
      "generate_code",
      "inspect_project",
      "list_targets",
      "validate_schema",
    ]);
  });

  it("list_targets returns the emitter targets", async () => {
    const payload = await callJson("list_targets", {});
    expect(payload.targets).toContain("sql");
    expect(payload.targets).toContain("surrealdb");
  });

  it("validate_schema reports a valid example schema", async () => {
    const payload = await callJson("validate_schema", { path: ENTRY_SCHEMA });
    expect(payload.valid).toBe(true);
    expect(Array.isArray(payload.diagnostics)).toBe(true);
  });

  it("validate_schema surfaces a missing-file error", async () => {
    const result = (await client.callTool({
      name: "validate_schema",
      arguments: { path: "/no/such/schema.schema" },
    })) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("generate_code emits files for a target", async () => {
    const payload = await callJson("generate_code", { path: ENTRY_SCHEMA, target: "sql" });
    expect(payload.generated).toBe(true);
    expect(payload.files.length).toBeGreaterThan(0);
    expect(payload.files[0]).toHaveProperty("path");
    expect(payload.files[0]).toHaveProperty("contents");
  });

  it("generate_code rejects an unknown target", async () => {
    const result = (await client.callTool({
      name: "generate_code",
      arguments: { path: ENTRY_SCHEMA, target: "cobol" },
    })) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no emitter");
  });

  it("inspect_project summarizes declarations", async () => {
    const payload = await callJson("inspect_project", { path: ENTRY_SCHEMA });
    expect(payload.valid).toBe(true);
    expect(payload.models.length).toBeGreaterThan(0);
    expect(payload.models[0]).toHaveProperty("fields");
  });

  it("diff_schemas detects a breaking field removal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "openschema-mcp-"));
    const oldPath = join(dir, "old.schema");
    const newPath = join(dir, "new.schema");
    writeFileSync(oldPath, "model Person {\n  1 name: string\n  2 age: i32\n}\n");
    writeFileSync(newPath, "model Person {\n  1 name: string\n}\n");
    try {
      const payload = await callJson("diff_schemas", { oldPath, newPath, mode: "backward" });
      expect(payload.changes.length).toBeGreaterThan(0);
      expect(payload.breaking.length).toBeGreaterThan(0);
      expect(payload.compatible).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
