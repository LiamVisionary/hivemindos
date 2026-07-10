import "server-only";

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { homedir } from "@/lib/home-dir";
import { pythonScriptCommand } from "@/lib/services/hive-env-command";

const BROKER_TIMEOUT_MS = 40_000;
const BROKER_PATH = join(process.cwd(), "scripts", "xai-oauth-token-broker");

export type XaiOAuthTokenStoreStatus = {
  credentialsPresent: boolean;
  usable: boolean;
  needsReconnect: boolean;
  expiresAt: number | null;
  error: string | null;
};

export type XaiOAuthTokenStoreAccess = {
  accessToken: string;
  tokenType: string;
  expiresAt: number | null;
  baseUrl: string;
  refreshed: boolean;
};

type StoredTokenInput = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
};

type DiscoveryInput = {
  authorization_endpoint: string;
  token_endpoint: string;
};

export type XaiOAuthAuthority = {
  source: "hivemindos" | "hermes";
  storePath: string;
  hermesHome: string | null;
};

export function nativeXaiOAuthStorePath() {
  return join(homedir(), ".hivemindos", "oauth", "xai.json");
}

export function hermesXaiOAuthStorePath(home: string) {
  return join(home, "auth.json");
}

function authoritySelectionPath() {
  return join(homedir(), ".hivemindos", "oauth", "xai-authority.json");
}

function nativeAuthority(): XaiOAuthAuthority {
  return {
    source: "hivemindos",
    storePath: nativeXaiOAuthStorePath(),
    hermesHome: null,
  };
}

function validatedAuthority(value: unknown): XaiOAuthAuthority | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const source = record.source;
  const rawStorePath = typeof record.storePath === "string" ? record.storePath.trim() : "";
  if (!rawStorePath) return null;
  const storePath = resolve(rawStorePath);
  if (source === "hivemindos" && storePath === resolve(nativeXaiOAuthStorePath())) {
    return nativeAuthority();
  }
  if (source !== "hermes" || basename(storePath) !== "auth.json") return null;
  const hermesRoot = resolve(join(homedir(), ".hermes"));
  const relativeStore = relative(hermesRoot, storePath);
  if (!relativeStore || relativeStore.startsWith("..") || isAbsolute(relativeStore)) return null;
  return {
    source: "hermes",
    storePath,
    hermesHome: dirname(storePath),
  };
}

export async function selectedXaiOAuthAuthority(): Promise<XaiOAuthAuthority> {
  const raw = await readFile(authoritySelectionPath(), "utf8").catch(() => "");
  if (!raw.trim()) return nativeAuthority();
  try {
    return validatedAuthority(JSON.parse(raw)) ?? nativeAuthority();
  } catch {
    return nativeAuthority();
  }
}

export async function selectXaiOAuthAuthority(authority: XaiOAuthAuthority) {
  const validated = validatedAuthority(authority);
  if (!validated) throw new Error("Refusing an invalid xAI OAuth authority path.");
  const path = authoritySelectionPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp.${process.pid}.${randomUUID()}`;
  await writeFile(tmp, `${JSON.stringify({ version: 1, ...validated }, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => undefined);
  await rename(tmp, path);
  await chmod(path, 0o600).catch(() => undefined);
  return validated;
}

function brokerEnvironment(storePath: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HIVEMINDOS_XAI_OAUTH_STORE: storePath,
  };
  delete env.HERMES_HOME;
  for (const key of Object.keys(env)) {
    if (key.startsWith("XAI_OAUTH_")) delete env[key];
  }
  return env;
}

function runBroker<T>(action: "status" | "resolve" | "store", input: Record<string, unknown>, storePath: string) {
  return new Promise<T>((resolvePromise, reject) => {
    const { command, argv } = pythonScriptCommand(BROKER_PATH, [action]);
    const child = spawn(command, argv, {
      env: brokerEnvironment(storePath),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error("Timed out while resolving the local xAI OAuth session.")));
    }, BROKER_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 200_000) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) child.kill("SIGTERM");
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || "The local xAI OAuth token broker failed."));
          return;
        }
        try {
          resolvePromise(JSON.parse(stdout) as T);
        } catch {
          reject(new Error("The local xAI OAuth token broker returned invalid JSON."));
        }
      });
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

export function xaiOAuthTokenStoreStatus(storePath = nativeXaiOAuthStorePath()) {
  return runBroker<XaiOAuthTokenStoreStatus>("status", {}, storePath);
}

export function resolveXaiOAuthTokenStoreAccess(storePath = nativeXaiOAuthStorePath()) {
  return runBroker<XaiOAuthTokenStoreAccess>(
    "resolve",
    { refreshSkewSeconds: 60 },
    storePath,
  );
}

export function storeXaiOAuthTokens(
  tokens: StoredTokenInput,
  discovery: DiscoveryInput,
  redirectUri: string,
  lastRefresh?: string,
  storePath = nativeXaiOAuthStorePath(),
) {
  return runBroker<XaiOAuthTokenStoreStatus>(
    "store",
    { tokens, discovery, redirectUri, lastRefresh },
    storePath,
  );
}
