import { afterEach, describe, expect, test } from "bun:test";
import { resolveEndpoints } from "../src/registry/urls";

const variables = ["OPENSCHEMA_BASE_DOMAIN", "OPENSCHEMA_SCHEME", "OPENSCHEMA_BASE_PORT", "OPENSCHEMA_REGISTRY", "OPENSCHEMA_OAUTH_URL", "OPENSCHEMA_SITE_URL"];
const saved = new Map(variables.map(name => [name, process.env[name]]));

function clearEnvironment(): void {
  for (const name of variables) delete process.env[name];
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("resolveEndpoints", () => {
  test("defaults to production without a port", () => {
    clearEnvironment();
    expect(resolveEndpoints()).toEqual({
      api: "https://api.neoworks.dev", oauth: "https://oauth.neoworks.dev", site: "https://openschema.neoworks.dev",
    });
  });

  test("a base port applies to every service, like the SDK's neoworksUrls()", () => {
    clearEnvironment();
    expect(resolveEndpoints({ baseDomain: "neoworks.localhost", port: "8443" })).toEqual({
      api: "https://api.neoworks.localhost:8443",
      oauth: "https://oauth.neoworks.localhost:8443",
      site: "https://openschema.neoworks.localhost:8443",
    });
  });

  test("OPENSCHEMA_BASE_PORT sets the port, and an explicit port wins over it", () => {
    clearEnvironment();
    process.env.OPENSCHEMA_BASE_DOMAIN = "neoworks.localhost";
    process.env.OPENSCHEMA_BASE_PORT = "8443";
    expect(resolveEndpoints().api).toBe("https://api.neoworks.localhost:8443");
    expect(resolveEndpoints({ port: "9443" }).api).toBe("https://api.neoworks.localhost:9443");
  });

  test("the scheme's default port is left out", () => {
    clearEnvironment();
    expect(resolveEndpoints({ port: "443" }).api).toBe("https://api.neoworks.dev");
    expect(resolveEndpoints({ scheme: "http", port: "80" }).api).toBe("http://api.neoworks.dev");
    expect(resolveEndpoints({ scheme: "http", port: "8080" }).api).toBe("http://api.neoworks.dev:8080");
  });

  test("a service URL variable still overrides the derived one", () => {
    clearEnvironment();
    process.env.OPENSCHEMA_REGISTRY = "https://registry.example.com";
    expect(resolveEndpoints({ port: "8443" }).api).toBe("https://registry.example.com");
    expect(resolveEndpoints({ port: "8443" }).oauth).toBe("https://oauth.neoworks.dev:8443");
  });

  test("a port that is not a number from 1 to 65535 is refused", () => {
    clearEnvironment();
    for (const port of ["abc", "0", "70000", "84 43", "8443.5"]) {
      expect(() => resolveEndpoints({ port })).toThrow("invalid base port");
    }
  });
});
