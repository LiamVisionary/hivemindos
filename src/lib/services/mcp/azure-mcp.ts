import "server-only";

import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "@/lib/home-dir";
import { join } from "node:path";
import { promisify } from "node:util";

import { runtimeCommandEnv, runtimeCommandExists } from "@/lib/services/runtime-command-env";

const execFileAsync = promisify(execFile);
const AZURE_MCP_VERSION = "2.0.4";
const AZURE_MCP_PACKAGE = `@azure/mcp@${AZURE_MCP_VERSION}`;
const AZURE_MCP_APPROX_BYTES = 114_000_000;
const MANAGEMENT_CONFIRMATION = "ENABLE_AZURE_MCP_MANAGEMENT";
const RUNTIMES = ["claude", "codex", "gemini", "openclaw", "hermes", "aeon"] as const;

type AzureMcpAccess = "read" | "manage";
type AzureMcpInstallState = {
  status?: "absent" | "installing" | "installed" | "error";
  pid?: number;
  phase?: string;
  version?: string;
  package?: string;
  integrity?: string;
  access?: AzureMcpAccess;
  error?: string;
  updatedAt?: string;
};

export type AzureMcpRuntimeStatus = {
  runtime: typeof RUNTIMES[number];
  installed: boolean;
  configured: boolean;
  access?: AzureMcpAccess;
  path: string;
};

export type AzureMcpStatus = {
  installed: boolean;
  installStatus: "absent" | "installing" | "installed" | "error";
  installPhase?: string;
  version?: string;
  package: string;
  approximateBytes: number;
  access: AzureMcpAccess;
  telemetry: "disabled";
  error?: string;
  managementConfirmation: string;
  runtimeTargets: AzureMcpRuntimeStatus[];
  installedRuntimeCount: number;
  configuredRuntimeCount: number;
};

function paths() {
  const base = join(homedir(), ".hivemindos", "integrations");
  const installRoot = join(base, "azure-mcp");
  return {
    base,
    installRoot,
    stateFile: join(base, "azure-mcp-state.json"),
    packageFile: join(installRoot, "node_modules", "@azure", "mcp", "package.json"),
    binary: join(installRoot, "node_modules", ".bin", process.platform === "win32" ? "azmcp.cmd" : "azmcp"),
    installer: join(process.cwd(), "scripts", "install-azure-mcp.mjs"),
    registrar: join(process.cwd(), "scripts", "register-mcp-clients.mjs"),
  };
}

function readInstallState(): AzureMcpInstallState {
  try {
    return JSON.parse(readFileSync(paths().stateFile, "utf8")) as AzureMcpInstallState;
  } catch {
    return {};
  }
}

function writeInstallState(state: AzureMcpInstallState) {
  const { base, stateFile } = paths();
  mkdirSync(base, { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
}

function installedVersion(): string | undefined {
  try {
    const value = JSON.parse(readFileSync(paths().packageFile, "utf8")) as { version?: string };
    return value.version;
  } catch {
    return undefined;
  }
}

function processIsRunning(pid?: number) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getAzureMcpStatus(): Promise<AzureMcpStatus> {
  const state = readInstallState();
  const version = installedVersion();
  const installed = version === AZURE_MCP_VERSION && existsSync(paths().binary);
  const staleInstall = state.status === "installing" && !processIsRunning(state.pid);
  const installStatus = installed
    ? "installed"
    : staleInstall
      ? "error"
      : state.status || "absent";
  const runtimeTargets = readRuntimeTargets();
  const configuredAccess = runtimeTargets.find((target) => target.configured)?.access;
  return {
    installed,
    installStatus,
    installPhase: state.phase,
    version,
    package: AZURE_MCP_PACKAGE,
    approximateBytes: AZURE_MCP_APPROX_BYTES,
    access: configuredAccess || state.access || "read",
    telemetry: "disabled",
    error: staleInstall ? "The Azure MCP installer stopped before completing." : state.error,
    managementConfirmation: MANAGEMENT_CONFIRMATION,
    runtimeTargets,
    installedRuntimeCount: runtimeTargets.filter((target) => target.installed).length,
    configuredRuntimeCount: runtimeTargets.filter((target) => target.configured).length,
  };
}

export async function startAzureMcpInstall(targets = "all") {
  const current = await getAzureMcpStatus();
  if (current.installStatus === "installing") return { ok: true, alreadyRunning: true, status: current };
  if (!existsSync(paths().installer)) throw new Error("The HivemindOS Azure MCP installer is missing.");
  const child = spawn(process.execPath, [paths().installer, "--targets", sanitizeTargets(targets)], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: runtimeCommandEnv({ ...process.env, AZURE_MCP_COLLECT_TELEMETRY: "false" }),
  });
  child.unref();
  writeInstallState({ status: "installing", pid: child.pid, phase: "starting", package: AZURE_MCP_PACKAGE, access: "read" });
  return { ok: true, pid: child.pid, status: await getAzureMcpStatus() };
}

export async function configureAzureMcp(input: { access?: string; targets?: string; confirmation?: string }) {
  const access: AzureMcpAccess = input.access === "manage" ? "manage" : "read";
  if (access === "manage" && input.confirmation !== MANAGEMENT_CONFIRMATION) {
    throw new Error(`Azure MCP management mode requires confirmation ${MANAGEMENT_CONFIRMATION}.`);
  }
  const status = await getAzureMcpStatus();
  if (!status.installed) throw new Error("Install the Azure MCP before registering it with agent runtimes.");
  const { stdout, stderr } = await runRegistrar([
    "--server", "azure",
    "--azure-access", access,
    "--targets", sanitizeTargets(input.targets || "all"),
  ]);
  writeInstallState({ ...readInstallState(), status: "installed", version: AZURE_MCP_VERSION, access, error: undefined });
  return { ok: true, stdout: stdout.trim(), stderr: stderr.trim(), status: await getAzureMcpStatus() };
}

export async function removeAzureMcp(targets = "all") {
  const output = await runRegistrar(["--server", "azure", "--remove", "--targets", sanitizeTargets(targets)]);
  rmSync(paths().installRoot, { recursive: true, force: true });
  writeInstallState({ status: "absent", package: AZURE_MCP_PACKAGE, access: "read" });
  return { ok: true, stdout: output.stdout.trim(), stderr: output.stderr.trim(), status: await getAzureMcpStatus() };
}

async function runRegistrar(args: string[]) {
  return execFileAsync(process.execPath, [paths().registrar, ...args], {
    cwd: process.cwd(),
    timeout: 60_000,
    maxBuffer: 2_000_000,
    env: runtimeCommandEnv(),
  });
}

function sanitizeTargets(value: string) {
  const clean = value.trim().toLowerCase();
  if (!clean || clean === "all" || clean === "none") return clean || "all";
  const allowed = new Set<string>(RUNTIMES);
  return clean.split(",").map((part) => part.trim()).filter((part) => allowed.has(part)).join(",") || "all";
}

function readRuntimeTargets(): AzureMcpRuntimeStatus[] {
  const home = homedir();
  const aeonRoot = (process.env.AEON_LOCAL_PATH || process.env.AEON_HOME || "").replace(/^~\//, `${home}/`);
  const definitions: Array<{
    runtime: AzureMcpRuntimeStatus["runtime"];
    command: string;
    installedPaths: string[];
    path: string;
    read: (text: string) => { configured: boolean; access?: AzureMcpAccess };
  }> = [
    { runtime: "claude", command: "claude", installedPaths: [join(home, ".claude"), join(home, ".claude.json")], path: join(home, ".claude.json"), read: (text) => readJsonTarget(text, "mcpServers") },
    { runtime: "codex", command: "codex", installedPaths: [join(home, ".codex")], path: join(home, ".codex", "config.toml"), read: readCodexTarget },
    { runtime: "gemini", command: "gemini", installedPaths: [join(home, ".gemini")], path: join(home, ".gemini", "settings.json"), read: (text) => readJsonTarget(text, "mcpServers") },
    { runtime: "openclaw", command: "openclaw", installedPaths: [join(home, ".openclaw")], path: join(home, ".openclaw", "openclaw.json"), read: (text) => readJsonTarget(text, "mcpServers") },
    { runtime: "hermes", command: "hermes", installedPaths: [join(home, ".hermes")], path: join(home, ".hermes", "config.yaml"), read: readHermesTarget },
    { runtime: "aeon", command: "aeon", installedPaths: aeonRoot ? [aeonRoot] : [], path: aeonRoot ? join(aeonRoot, ".mcp.json") : "", read: (text) => readJsonTarget(text, "") },
  ];
  return definitions.map((target) => {
    const text = target.path && existsSync(target.path) ? readFileSync(target.path, "utf8") : "";
    const configured = target.read(text);
    return {
      runtime: target.runtime,
      installed: target.installedPaths.some((candidate) => existsSync(candidate)) || runtimeCommandExists(target.command),
      configured: configured.configured,
      access: configured.access,
      path: target.path,
    };
  });
}

function readJsonTarget(text: string, wrapperKey: string): { configured: boolean; access?: AzureMcpAccess } {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const container = wrapperKey ? parsed[wrapperKey] : parsed;
    if (!container || typeof container !== "object") return { configured: false };
    const entry = (container as Record<string, unknown>).azure;
    if (!entry || typeof entry !== "object") return { configured: false };
    const args = (entry as { args?: unknown }).args;
    return { configured: true, access: Array.isArray(args) && args.includes("--read-only") ? "read" : "manage" };
  } catch {
    return { configured: false };
  }
}

function readCodexTarget(text: string) {
  const match = text.match(/(?:^|\n)\[mcp_servers\.azure\]([\s\S]*?)(?=\n\[|$)/);
  return match ? { configured: true, access: match[1].includes("--read-only") ? "read" as const : "manage" as const } : { configured: false };
}

function readHermesTarget(text: string) {
  const match = text.match(/(?:^|\n)  azure:\s*\n([\s\S]*?)(?=\n  \S|\n\S|$)/);
  return match ? { configured: true, access: match[1].includes("--read-only") ? "read" as const : "manage" as const } : { configured: false };
}

