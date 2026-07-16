import "server-only";

import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "@/lib/home-dir";
import { join } from "node:path";
import { promisify } from "node:util";

import { runtimeCommandEnv, runtimeCommandExists } from "@/lib/services/runtime-command-env";

const execFileAsync = promisify(execFile);
const NOTEBOOKLM_VERSION = "0.8.0b1";
const NOTEBOOKLM_PACKAGE = `notebooklm-py[browser,mcp]==${NOTEBOOKLM_VERSION}`;
const NOTEBOOKLM_APPROX_BYTES = 250_000_000;
const LOGOUT_CONFIRMATION = "SIGN_OUT_NOTEBOOKLM";
const REMOVE_CONFIRMATION = "REMOVE_NOTEBOOKLM_PACKAGE";
const RUNTIMES = ["claude", "codex", "gemini", "openclaw", "hermes", "aeon"] as const;

type NotebookLmInstallState = {
  status?: "absent" | "installing" | "installed" | "error";
  pid?: number;
  phase?: string;
  version?: string;
  package?: string;
  pythonVersion?: string;
  error?: string;
  authStatus?: "signed-out" | "signing-in" | "authenticated" | "error";
  authPid?: number;
  authError?: string;
  updatedAt?: string;
};

export type NotebookLmRuntimeStatus = {
  runtime: typeof RUNTIMES[number];
  installed: boolean;
  configured: boolean;
  path: string;
};

export type NotebookLmStatus = {
  installed: boolean;
  installStatus: "absent" | "installing" | "installed" | "error";
  installPhase?: string;
  version?: string;
  pythonVersion?: string;
  package: string;
  approximateBytes: number;
  preview: true;
  unofficial: true;
  authenticated: boolean;
  authStatus: "signed-out" | "signing-in" | "authenticated" | "error";
  authError?: string;
  error?: string;
  runtimeTargets: NotebookLmRuntimeStatus[];
  installedRuntimeCount: number;
  configuredRuntimeCount: number;
};

function paths() {
  const base = join(homedir(), ".hivemindos", "integrations");
  const installRoot = join(base, "notebooklm");
  const binaryDir = join(installRoot, "venv", process.platform === "win32" ? "Scripts" : "bin");
  return {
    base,
    installRoot,
    stateFile: join(base, "notebooklm-state.json"),
    cli: join(binaryDir, process.platform === "win32" ? "notebooklm.exe" : "notebooklm"),
    mcp: join(binaryDir, process.platform === "win32" ? "notebooklm-mcp.exe" : "notebooklm-mcp"),
    browserPath: join(installRoot, "playwright"),
    installer: join(process.cwd(), "scripts", "install-notebooklm.mjs"),
    loginRunner: join(process.cwd(), "scripts", "notebooklm-login.mjs"),
    registrar: join(process.cwd(), "scripts", "register-mcp-clients.mjs"),
  };
}

function readInstallState(): NotebookLmInstallState {
  try {
    return JSON.parse(readFileSync(paths().stateFile, "utf8")) as NotebookLmInstallState;
  } catch {
    return {};
  }
}

function writeInstallState(state: NotebookLmInstallState) {
  const { base, stateFile } = paths();
  mkdirSync(base, { recursive: true });
  const next = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(next, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  renameSync(next, stateFile);
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

async function authenticationIsAvailable(installed: boolean, state: NotebookLmInstallState) {
  if (!installed || (state.authStatus === "signing-in" && processIsRunning(state.authPid))) return false;
  try {
    await execFileAsync(paths().cli, ["auth", "check", "--json"], {
      timeout: 15_000,
      maxBuffer: 1_000_000,
      env: runtimeCommandEnv({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: paths().browserPath }),
    });
    return true;
  } catch {
    return false;
  }
}

async function installedVersion() {
  if (!existsSync(paths().cli) || !existsSync(paths().mcp)) return undefined;
  try {
    const result = await execFileAsync(paths().cli, ["--version"], {
      timeout: 10_000,
      maxBuffer: 100_000,
      env: runtimeCommandEnv(),
    });
    return result.stdout.includes(NOTEBOOKLM_VERSION) ? NOTEBOOKLM_VERSION : undefined;
  } catch {
    return undefined;
  }
}

export async function getNotebookLmStatus(): Promise<NotebookLmStatus> {
  const state = readInstallState();
  const version = await installedVersion();
  const installed = version === NOTEBOOKLM_VERSION;
  const staleInstall = state.status === "installing" && !processIsRunning(state.pid);
  const signingIn = state.authStatus === "signing-in" && processIsRunning(state.authPid);
  const staleSignIn = state.authStatus === "signing-in" && !signingIn;
  const authenticated = await authenticationIsAvailable(installed, state);
  const authStatus = signingIn
    ? "signing-in"
    : authenticated
      ? "authenticated"
      : (state.authStatus === "error" || staleSignIn)
        ? "error"
        : "signed-out";
  const runtimeTargets = readRuntimeTargets();
  return {
    installed,
    installStatus: installed ? "installed" : staleInstall ? "error" : state.status || "absent",
    installPhase: state.phase,
    version: version || state.version,
    pythonVersion: state.pythonVersion,
    package: NOTEBOOKLM_PACKAGE,
    approximateBytes: NOTEBOOKLM_APPROX_BYTES,
    preview: true,
    unofficial: true,
    authenticated,
    authStatus,
    authError: staleSignIn ? "NotebookLM browser sign-in stopped before completing." : state.authError,
    error: staleInstall ? "The NotebookLM installer stopped before completing." : state.error,
    runtimeTargets,
    installedRuntimeCount: runtimeTargets.filter((target) => target.installed).length,
    configuredRuntimeCount: runtimeTargets.filter((target) => target.configured).length,
  };
}

export async function startNotebookLmInstall(targets = "all") {
  const current = await getNotebookLmStatus();
  if (current.installStatus === "installing") return { ok: true, alreadyRunning: true, status: current };
  if (!existsSync(paths().installer)) throw new Error("The HivemindOS NotebookLM installer is missing.");
  const child = spawn(process.execPath, [paths().installer, "--targets", sanitizeTargets(targets)], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: runtimeCommandEnv(),
  });
  child.unref();
  writeInstallState({ status: "installing", pid: child.pid, phase: "starting", package: NOTEBOOKLM_PACKAGE });
  return { ok: true, pid: child.pid, status: await getNotebookLmStatus() };
}

export async function startNotebookLmLogin() {
  const status = await getNotebookLmStatus();
  if (!status.installed) throw new Error("Install NotebookLM before signing in.");
  if (status.authStatus === "signing-in") return { ok: true, alreadyRunning: true, status };
  if (!existsSync(paths().loginRunner)) throw new Error("The HivemindOS NotebookLM login runner is missing.");
  const child = spawn(process.execPath, [paths().loginRunner], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: runtimeCommandEnv(),
  });
  child.unref();
  writeInstallState({ ...readInstallState(), authStatus: "signing-in", authPid: child.pid, authError: undefined });
  return { ok: true, pid: child.pid, status: await getNotebookLmStatus() };
}

export async function configureNotebookLm(targets = "all") {
  const status = await getNotebookLmStatus();
  if (!status.installed) throw new Error("Install NotebookLM before registering it with agent runtimes.");
  const output = await runRegistrar(["--server", "notebooklm", "--targets", sanitizeTargets(targets)]);
  return { ok: true, stdout: output.stdout.trim(), stderr: output.stderr.trim(), status: await getNotebookLmStatus() };
}

export async function logoutNotebookLm(confirmation?: string) {
  if (confirmation !== LOGOUT_CONFIRMATION) throw new Error(`NotebookLM sign-out requires confirmation ${LOGOUT_CONFIRMATION}.`);
  const status = await getNotebookLmStatus();
  if (!status.installed) throw new Error("NotebookLM is not installed.");
  await execFileAsync(paths().cli, ["auth", "logout", "--json"], {
    timeout: 30_000,
    maxBuffer: 1_000_000,
    env: runtimeCommandEnv({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: paths().browserPath }),
  });
  writeInstallState({ ...readInstallState(), authStatus: "signed-out", authPid: undefined, authError: undefined });
  return { ok: true, status: await getNotebookLmStatus() };
}

export async function removeNotebookLm(targets = "all", confirmation?: string) {
  if (confirmation !== REMOVE_CONFIRMATION) throw new Error(`NotebookLM removal requires confirmation ${REMOVE_CONFIRMATION}.`);
  const state = readInstallState();
  if (state.authStatus === "signing-in" && processIsRunning(state.authPid)) {
    throw new Error("Finish or close the NotebookLM sign-in window before removing the package.");
  }
  const output = await runRegistrar(["--server", "notebooklm", "--remove", "--targets", sanitizeTargets(targets)]);
  rmSync(paths().installRoot, { recursive: true, force: true });
  writeInstallState({ status: "absent", package: NOTEBOOKLM_PACKAGE, authStatus: "signed-out" });
  return { ok: true, authPreserved: true, stdout: output.stdout.trim(), stderr: output.stderr.trim(), status: await getNotebookLmStatus() };
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

function readRuntimeTargets(): NotebookLmRuntimeStatus[] {
  const home = homedir();
  const aeonRoot = (process.env.AEON_LOCAL_PATH || process.env.AEON_HOME || "").replace(/^~\//, `${home}/`);
  const definitions: Array<{
    runtime: NotebookLmRuntimeStatus["runtime"];
    command: string;
    installedPaths: string[];
    path: string;
    configured: (text: string) => boolean;
  }> = [
    { runtime: "claude", command: "claude", installedPaths: [join(home, ".claude"), join(home, ".claude.json")], path: join(home, ".claude.json"), configured: (text) => readJsonTarget(text, "mcpServers") },
    { runtime: "codex", command: "codex", installedPaths: [join(home, ".codex")], path: join(home, ".codex", "config.toml"), configured: (text) => /(?:^|\n)\[mcp_servers\.notebooklm\]/.test(text) },
    { runtime: "gemini", command: "gemini", installedPaths: [join(home, ".gemini")], path: join(home, ".gemini", "settings.json"), configured: (text) => readJsonTarget(text, "mcpServers") },
    { runtime: "openclaw", command: "openclaw", installedPaths: [join(home, ".openclaw")], path: join(home, ".openclaw", "openclaw.json"), configured: (text) => readJsonTarget(text, "mcpServers") },
    { runtime: "hermes", command: "hermes", installedPaths: [join(home, ".hermes")], path: join(home, ".hermes", "config.yaml"), configured: (text) => /(?:^|\n)  notebooklm:\s*\n/.test(text) },
    { runtime: "aeon", command: "aeon", installedPaths: aeonRoot ? [aeonRoot] : [], path: aeonRoot ? join(aeonRoot, ".mcp.json") : "", configured: (text) => readJsonTarget(text, "") },
  ];
  return definitions.map((target) => {
    const text = target.path && existsSync(target.path) ? readFileSync(target.path, "utf8") : "";
    return {
      runtime: target.runtime,
      installed: target.installedPaths.some((candidate) => existsSync(candidate)) || runtimeCommandExists(target.command),
      configured: target.configured(text),
      path: target.path,
    };
  });
}

function readJsonTarget(text: string, wrapperKey: string) {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const container = wrapperKey ? parsed[wrapperKey] : parsed;
    return Boolean(container && typeof container === "object" && "notebooklm" in container);
  } catch {
    return false;
  }
}
