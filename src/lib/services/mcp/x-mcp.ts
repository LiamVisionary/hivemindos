import "server-only";

import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "@/lib/home-dir";
import { join } from "node:path";
import { promisify } from "node:util";
import { hiveEnvPresence, type HiveEnvPresence } from "@/lib/services/shared-hive-env";
import { writeSharedHiveEnvValue } from "@/lib/services/hive-env-write";
import { getManagedXGatewayStatus, type ManagedXGatewayStatus } from "@/lib/services/managed-x-api-client";

const execFileAsync = promisify(execFile);

export const X_MCP_CLIENT_ID_ENV = "X_MCP_CLIENT_ID";
export const X_MCP_CLIENT_SECRET_ENV = "X_MCP_CLIENT_SECRET";
export const X_MCP_REDIRECT_URI_ENV = "X_MCP_REDIRECT_URI";
export const X_MCP_API_URL = "https://api.x.com/mcp";
export const X_DOCS_MCP_URL = "https://docs.x.com/mcp";

const X_MCP_ENV_KEYS = [X_MCP_CLIENT_ID_ENV, X_MCP_CLIENT_SECRET_ENV] as const;
const X_MCP_OPTIONAL_ENV_KEYS = [X_MCP_REDIRECT_URI_ENV] as const;
const REGISTER_SCRIPT = join(process.cwd(), "scripts", "register-mcp-clients.mjs");
const BRIDGE_SCRIPT = join(process.cwd(), "scripts", "x-mcp-bridge.mjs");
const XURL_DIR = join(homedir(), ".xurl");

export type XMcpRuntimeTargetStatus = {
  runtime: "claude" | "codex" | "gemini" | "openclaw" | "hermes" | "aeon";
  installed: boolean;
  configured: boolean;
  path: string;
};

export type XMcpStatus = {
  credentials: HiveEnvPresence[];
  optionalCredentials: HiveEnvPresence[];
  credentialsReady: boolean;
  managedGateway: ManagedXGatewayStatus;
  xurlCachePresent: boolean;
  bridgeScriptPresent: boolean;
  runtimeTargets: XMcpRuntimeTargetStatus[];
  configuredRuntimeCount: number;
  installedRuntimeCount: number;
  apiMcpUrl: string;
  docsMcpUrl: string;
};

export async function getXMcpStatus(): Promise<XMcpStatus> {
  const [credentials, optionalCredentials, managedGateway] = await Promise.all([
    hiveEnvPresence(X_MCP_ENV_KEYS),
    hiveEnvPresence(X_MCP_OPTIONAL_ENV_KEYS),
    getManagedXGatewayStatus(),
  ]);
  const runtimeTargets = readRuntimeTargets();
  return {
    credentials,
    optionalCredentials,
    credentialsReady: credentials.every((item) => item.present),
    managedGateway,
    xurlCachePresent: existsSync(XURL_DIR),
    bridgeScriptPresent: existsSync(BRIDGE_SCRIPT),
    runtimeTargets,
    configuredRuntimeCount: runtimeTargets.filter((target) => target.configured).length,
    installedRuntimeCount: runtimeTargets.filter((target) => target.installed).length,
    apiMcpUrl: X_MCP_API_URL,
    docsMcpUrl: X_DOCS_MCP_URL,
  };
}

export async function saveXMcpCredentials(input: { clientId?: string; clientSecret?: string; redirectUri?: string }) {
  const clientId = input.clientId?.trim() ?? "";
  const clientSecret = input.clientSecret?.trim() ?? "";
  const redirectUri = input.redirectUri?.trim() ?? "";
  if (clientId) await writeSharedHiveEnvValue(X_MCP_CLIENT_ID_ENV, clientId);
  if (clientSecret) await writeSharedHiveEnvValue(X_MCP_CLIENT_SECRET_ENV, clientSecret);
  if (redirectUri) await writeSharedHiveEnvValue(X_MCP_REDIRECT_URI_ENV, redirectUri);
  return getXMcpStatus();
}

export async function startXMcpOAuth() {
  const status = await getXMcpStatus();
  if (!status.credentialsReady) {
    throw new Error(`Save ${X_MCP_CLIENT_ID_ENV} and ${X_MCP_CLIENT_SECRET_ENV} before starting X sign-in.`);
  }
  const child = spawn(process.execPath, [BRIDGE_SCRIPT, "auth"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: { ...process.env, HIVE_ENV_PROJECT_ROOT: process.cwd() },
  });
  child.unref();
  return {
    ok: true,
    pid: child.pid,
    message: "Started X OAuth in the system browser. Finish the browser login, then refresh status.",
    status: await getXMcpStatus(),
  };
}

export async function syncXMcpRuntimeConfigs(targets = "all") {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    REGISTER_SCRIPT,
    "--server",
    "xapi",
    "--targets",
    sanitizeTargets(targets),
  ], {
    cwd: process.cwd(),
    timeout: 30_000,
    maxBuffer: 1_000_000,
  });
  return {
    ok: true,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    status: await getXMcpStatus(),
  };
}

export async function removeXMcpRuntimeConfigs(targets = "all") {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    REGISTER_SCRIPT,
    "--server",
    "xapi",
    "--remove",
    "--targets",
    sanitizeTargets(targets),
  ], {
    cwd: process.cwd(),
    timeout: 30_000,
    maxBuffer: 1_000_000,
  });
  return {
    ok: true,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    status: await getXMcpStatus(),
  };
}

function sanitizeTargets(value: string) {
  const clean = value.trim().toLowerCase();
  if (!clean || clean === "all" || clean === "none") return clean || "all";
  const allowed = new Set(readRuntimeTargetDefinitions().map((target) => target.runtime));
  return clean
    .split(",")
    .map((part) => part.trim())
    .filter((part) => allowed.has(part as XMcpRuntimeTargetStatus["runtime"]))
    .join(",") || "all";
}

function readRuntimeTargetDefinitions(): Array<Pick<XMcpRuntimeTargetStatus, "runtime" | "path"> & { installedPaths: string[]; detector: (text: string) => boolean }> {
  const home = homedir();
  return [
    {
      runtime: "claude",
      path: join(home, ".claude.json"),
      installedPaths: [join(home, ".claude"), join(home, ".claude.json")],
      detector: (text) => jsonHasMcpServer(text, "mcpServers", "xapi"),
    },
    {
      runtime: "codex",
      path: join(home, ".codex", "config.toml"),
      installedPaths: [join(home, ".codex")],
      detector: (text) => /^\[mcp_servers\.xapi\]\s*$/m.test(text),
    },
    {
      runtime: "gemini",
      path: join(home, ".gemini", "settings.json"),
      installedPaths: [join(home, ".gemini")],
      detector: (text) => jsonHasMcpServer(text, "mcpServers", "xapi"),
    },
    {
      runtime: "openclaw",
      path: join(home, ".openclaw", "openclaw.json"),
      installedPaths: [join(home, ".openclaw")],
      detector: (text) => jsonHasMcpServer(text, "mcpServers", "xapi"),
    },
    {
      runtime: "hermes",
      path: join(home, ".hermes", "config.yaml"),
      installedPaths: [join(home, ".hermes")],
      detector: (text) => /^  xapi:\s*$/m.test(text),
    },
    {
      runtime: "aeon",
      path: join(home, ".aeon", ".mcp.json"),
      installedPaths: [join(home, ".aeon")],
      detector: (text) => jsonHasMcpServer(text, "", "xapi"),
    },
  ];
}

function readRuntimeTargets(): XMcpRuntimeTargetStatus[] {
  return readRuntimeTargetDefinitions().map((target) => {
    const installed = target.installedPaths.some((candidate) => existsSync(candidate));
    const text = existsSync(target.path) ? readFileSync(target.path, "utf8") : "";
    return {
      runtime: target.runtime,
      installed,
      configured: text ? target.detector(text) : false,
      path: target.path,
    };
  });
}

function jsonHasMcpServer(text: string, wrapperKey: string, serverName: string) {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const container = wrapperKey
      ? parsed[wrapperKey]
      : parsed;
    return Boolean(container && typeof container === "object" && serverName in container);
  } catch {
    return false;
  }
}
