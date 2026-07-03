// tests/registry-ref.test.ts
import { describe, it, expect } from "bun:test";
import { parseSchemaRef, resolveRegistry, DEFAULT_REGISTRY } from "../src/registry/client";

describe("parseSchemaRef", () => {
  it("parses a scoped ref with an explicit version", () => {
    expect(parseSchemaRef("@neoworks/commerce@2.4.1")).toEqual({
      scope: "neoworks",
      name: "commerce",
      version: "2.4.1",
    });
  });

  it("defaults the version to latest", () => {
    expect(parseSchemaRef("@neoworks/commerce")).toEqual({
      scope: "neoworks",
      name: "commerce",
      version: "latest",
    });
  });

  it("accepts a ref without the leading @", () => {
    expect(parseSchemaRef("acme/identity")).toEqual({
      scope: "acme",
      name: "identity",
      version: "latest",
    });
  });

  it("rejects a ref with no scope separator", () => {
    expect(() => parseSchemaRef("commerce")).toThrow();
  });
});

describe("resolveRegistry", () => {
  it("prefers an explicit base and trims trailing slashes", () => {
    expect(resolveRegistry("https://api.example.com/")).toBe("https://api.example.com");
  });

  it("falls back to the default when nothing is provided", () => {
    delete process.env.OPENSCHEMA_REGISTRY;
    expect(resolveRegistry()).toBe(DEFAULT_REGISTRY);
  });
});
