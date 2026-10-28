// tests/integrity.test.ts
// The same vectors are in apps/api/storage/database/registry_integrity_test.go,
// so the CLI and the registry cannot drift apart.
import { describe, it, expect } from "bun:test";
import { schemaIntegrity } from "../src/registry/integrity";

describe("schemaIntegrity", () => {
  it("hashes the files in the order given", () => {
    const files = [
      { path: "orders.schema", contents: "namespace commerce" },
      { path: "customers.schema", contents: "table customers" },
    ];
    expect(schemaIntegrity(files)).toBe("sha256-7e31e3d8fd5d2a36c65ecb508bf0c54c521ee68df0b5b97850d2d205a714b598");
    expect(schemaIntegrity([...files].reverse())).not.toBe(schemaIntegrity(files));
  });

  it("counts lengths in bytes, not characters", () => {
    expect(schemaIntegrity([{ path: "straße.schema", contents: "namespace grüße" }]))
      .toBe("sha256-d0822a12115dd46b577f084a20525ea2ee70323f47a9ec6109c9d2551aec7bde");
  });
});
