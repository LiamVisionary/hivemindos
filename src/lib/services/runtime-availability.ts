import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { runtimeCommandEnv } from "@/lib/services/runtime-command-env";
import { inspectAeonWorkspace } from "@/lib/services/runtime-adapters/aeon-workspace";
import type { AgentRuntime } from "@/lib/types/agent-runtime";
import { HIVEMIND_OS_RUNTIME, RUNTIME_DEFAULTS, RUNTIME_LABELS } from "@/lib/types/agent-runtime";

const execFileAsync = promisify(execFile);

export type RuntimeAvailability = Record<string, {
  installed: boolean;
  detail: string;
}>;

export async function readRuntimeAvailability(): Promise<RuntimeAvailability> {
  const entries = await Promise.all(Object.keys(RUNTIME_LABELS).map(async (runtime) => {
    const status = await checkRuntimeAvailability(runtime as AgentRuntime);
    return [runtime, status] as const;
  }));
  return Object.fromEntries(entries);
}

export function readRuntimeAvailabilityFor(runtime: AgentRuntime) {
  return checkRuntimeAvailability(runtime);
}

async function checkRuntimeAvailability(runtime: AgentRuntime) {
  if (runtime === "hermes") return checkHermes();
  if (runtime === "openclaw") return checkOpenClaw();
  if (runtime === "opencode") return checkCliRuntime("OpenCode", process.env.OPENCODE_BIN, "opencode");
  if (runtime === "codex") return checkCliRuntime("Codex", process.env.CODEX_BIN, "codex");
  if (runtime === "claude-code") return checkCliRuntime("Claude Code", process.env.CLAUDE_CODE_BIN || process.env.CLAUDE_BIN, "claude");
  if (runtime === "openhands") return checkCliRuntime("OpenHands", process.env.OPENHANDS_BIN, "openhands");
  if (runtime === "aider") return checkCliRuntime("Aider", process.env.AIDER_BIN, "aider");
  if (runtime === "aeon") return checkAeon();
  if (runtime === "evo") return checkCliRuntime("Evo", process.env.EVO_BIN, "evo");
  if (runtime === HIVEMIND_OS_RUNTIME) return checkOpenAICompatible();
  return { installed: false, detail: `${RUNTIME_LABELS[runtime] ?? runtime} is not installed.` };
}

async function checkHermes() {
  const candidates = [
    process.env.HERMES_BIN,
    join(homedir(), ".local", "bin", "hermes"),
    "/opt/homebrew/bin/hermes",
    "/usr/local/bin/hermes",
    "/usr/bin/hermes",
  ].filter(Boolean) as string[];
  let foundExistingLauncher = false;
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    foundExistingLauncher = true;
    const status = await checkCommand(candidate, ["--version"], "Hermes is installed.", "");
    if (status.installed) return status;
  }
  if (foundExistingLauncher) return { installed: true, detail: "Hermes is installed." };
  return checkCommand("hermes", ["--version"], "Hermes is installed.", "Hermes is not installed.");
}

async function checkCommand(command: string, args: string[], okDetail: string, failDetail: string) {
  const result = await execFileAsync(command, args, {
    timeout: 3_000,
    maxBuffer: 200_000,
    env: runtimeCommandEnv(),
  }).catch(() => null);
  const version = result?.stdout.trim().split(/\r?\n/)[0] || result?.stderr.trim().split(/\r?\n/)[0] || "";
  return {
    installed: Boolean(result),
    detail: result ? (version ? `${okDetail} ${version}` : okDetail) : failDetail,
  };
}

async function checkCliRuntime(label: string, envBin: string | undefined, command: string) {
  const candidates = [
    envBin,
    join(homedir(), ".local", "bin", command),
    join(homedir(), ".npm-global", "bin", command),
    join(homedir(), `.${command}`, "bin", command),
    join(homedir(), ".nvm", "versions", "node", process.version, "bin", command),
    "/opt/homebrew/bin/" + command,
    "/usr/local/bin/" + command,
  ].filter(Boolean) as string[];
  // Some CLIs (claude, opencode) take ~10s on a cold --version run, so an
  // executable on disk counts as installed even when the version probe fails.
  const existing = candidates.find((path) => existsSync(path));
  if (existing) {
    const status = await checkCommand(existing, ["--version"], `${label} is installed.`, "");
    return status.installed ? status : { installed: true, detail: `${label} is installed.` };
  }
  return checkCommand(command, ["--version"], `${label} is installed.`, `${label} is not installed.`);
}

async function checkOpenClaw() {
  const candidates = [
    process.env.OPENCLAW_BIN,
    "/usr/local/bin/openclaw",
    "/usr/bin/openclaw",
    join(homedir(), ".local", "bin", "openclaw"),
    join(homedir(), ".npm-global", "bin", "openclaw"),
    join(homedir(), ".volta", "bin", "openclaw"),
  ].filter(Boolean) as string[];
  const bin = candidates.find((path) => existsSync(path));
  if (bin) {
    const status = await checkCommand(bin, ["--version"], "OpenClaw is installed.", "");
    return status.installed ? status : { installed: true, detail: "OpenClaw is installed." };
  }
  const configReadable = await access(join(homedir(), ".openclaw", "openclaw.json"), constants.R_OK).then(() => true).catch(() => false);
  if (configReadable) return { installed: true, detail: "OpenClaw config is present." };
  return { installed: false, detail: "OpenClaw is not installed." };
}

async function checkAeon() {
  const root = expandHome(process.env.AEON_LOCAL_PATH || process.env.AEON_HOME || "~/.aeon");
  const layout = await inspectAeonWorkspace(root);
  if (layout.generation === "v0.1") return { installed: true, detail: "AEON v0.1 is installed with its CLI and catalog." };
  if (layout.generation === "legacy") return { installed: false, detail: "A legacy AEON workspace is present; update or re-clone AEON v0.1." };
  if (process.env.AEON_REPO) return { installed: false, detail: "An AEON GitHub repo is configured, but no local AEON v0.1 checkout was found." };
  return { installed: false, detail: "Aeon is not installed." };
}

async function checkOpenAICompatible() {
  const defaults = RUNTIME_DEFAULTS[HIVEMIND_OS_RUNTIME];
  const base = defaults.gatewayUrl.replace(/\/+$/, "");
  const path = defaults.statusPath || "/v1/models";
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const reachable = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(1_500),
  }).then((response) => response.ok).catch(() => false);
  return {
    installed: reachable,
    detail: reachable ? "HivemindOS managed runtime endpoint is reachable." : "HivemindOS managed runtime endpoint is not reachable.",
  };
}

function expandHome(path: string) {
  return resolve(path.replace(/^~(?=$|\/)/, homedir()));
}
