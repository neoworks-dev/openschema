// src/registry/auth.ts
// CLI authentication for publishing. The openschema client is public, so the CLI
// uses a loopback authorization-code + PKCE flow (no client secret on the user's
// machine). Tokens are cached under ~/.config/openschema/credentials.json. The
// token (scope schemas:publish) authenticates the user to the openschema site's
// /publish endpoint, which forwards it to the api; the user becomes the owner.

import { spawn } from "child_process";
import { createHash, randomBytes } from "crypto";
import { createServer } from "http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { resolveEndpoints } from "./urls.js";

const CLIENT_ID = "openschema";
// Must match the loopback redirect seeded on the openschema client (007_seed_clients.surql).
const LOOPBACK_PORT = 8765;
export const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}/callback`;

interface Credentials {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

function credentialsPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "openschema", "credentials.json");
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function loadCredentials(): Credentials | null {
  const path = credentialsPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Credentials;
  } catch {
    return null;
  }
}

function saveCredentials(creds: Credentials): void {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(creds, null, 2), "utf8");
}

/** Wait for the OAuth redirect on the loopback server and return the auth code. */
function awaitAuthCode(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h2>OpenSchema login complete.</h2>You can close this tab.</body></html>");
      server.close();
      if (!code || state !== expectedState) {
        reject(new Error("login failed: missing code or state mismatch"));
        return;
      }
      resolve(code);
    });
    server.on("error", reject);
    server.listen(LOOPBACK_PORT, "127.0.0.1");
  });
}

async function exchangeCode(oauth: string, code: string, verifier: string): Promise<Credentials> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });
  const response = await fetch(`${oauth}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`token exchange failed (${response.status})`);
  }
  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 300) * 1000,
  };
}

/** Run the loopback PKCE login, persisting the resulting tokens. Returns the access token. */
export async function login(): Promise<string> {
  const { oauth } = resolveEndpoints();
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const authorizeUrl =
    `${oauth}/oauth/authorize?response_type=code&client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256` +
    `&scope=${encodeURIComponent("openid profile email schemas:publish")}&state=${state}`;

  const codePromise = awaitAuthCode(state);
  console.log("\n  Open this URL to sign in:\n");
  console.log("    " + authorizeUrl + "\n");
  tryOpenBrowser(authorizeUrl);

  const code = await codePromise;
  const creds = await exchangeCode(oauth, code, verifier);
  saveCredentials(creds);
  return creds.access_token;
}

/** Return a valid access token, refreshing or prompting login as needed. */
export async function getAccessToken(): Promise<string> {
  const creds = loadCredentials();
  if (creds && creds.expires_at - 30_000 > Date.now()) {
    return creds.access_token;
  }
  if (creds?.refresh_token) {
    const refreshed = await tryRefresh(creds.refresh_token);
    if (refreshed) {
      saveCredentials(refreshed);
      return refreshed.access_token;
    }
  }
  return login();
}

async function tryRefresh(refreshToken: string): Promise<Credentials | null> {
  const { oauth } = resolveEndpoints();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });
  const response = await fetch(`${oauth}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_at: Date.now() + (data.expires_in ?? 300) * 1000,
  };
}

function tryOpenBrowser(url: string): void {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    // Best-effort; the URL is also printed for manual opening.
    spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // ignore — the user can open the printed URL manually.
  }
}
