import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
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
  const bin = candidates.find((path) => existsSync(path)) || "hermes";
  return checkCommand(bin, ["--version"], "Hermes is installed.", "Hermes is not installed.");
}

async function checkCommand(command: string, args: string[], okDetail: string, failDetail: string) {
  const result = await execFileAsync(command, args, { timeout: 3_000, maxBuffer: 200_000 }).catch(() => null);
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
    join(homedir(), ".volta", "bin", "openclaw"),
  ].filter(Boolean) as string[];
  const bin = candidates.find((path) => existsSync(path));
  if (bin) {
    const result = await execFileAsync(bin, ["--version"], { timeout: 3_000, maxBuffer: 200_000 }).catch(() => null);
    const version = result?.stdout.trim().split(/\r?\n/)[0] || result?.stderr.trim().split(/\r?\n/)[0] || "";
    return { installed: true, detail: version ? `OpenClaw is installed. ${version}` : "OpenClaw is installed." };
  }
  const configReadable = await access(join(homedir(), ".openclaw", "openclaw.json"), constants.R_OK).then(() => true).catch(() => false);
  if (configReadable) return { installed: true, detail: "OpenClaw config is present." };
  return { installed: false, detail: "OpenClaw is not installed." };
}

async function checkAeon() {
  const root = expandHome(process.env.AEON_LOCAL_PATH || process.env.AEON_HOME || "~/.aeon");
  const hasConfig = await access(join(root, "aeon.yml"), constants.R_OK).then(() => true).catch(() => false);
  if (hasConfig) return { installed: true, detail: "Aeon is installed." };
  if (process.env.AEON_REPO) return { installed: true, detail: "Aeon GitHub repo is configured." };
  const a2aUrl = (process.env.AEON_A2A_URL || process.env.NEXT_PUBLIC_AEON_A2A_URL || "").trim();
  if (a2aUrl) {
    const reachable = await fetch(`${a2aUrl.replace(/\/+$/, "")}/.well-known/agent.json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    }).then((response) => response.ok).catch(() => false);
    if (reachable) return { installed: true, detail: "Aeon A2A endpoint is reachable." };
  }
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
