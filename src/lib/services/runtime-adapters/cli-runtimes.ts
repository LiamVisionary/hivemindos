import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { homedir } from "@/lib/home-dir";
import type { AgentProfile, KnownAgentRuntime } from "@/lib/types/agent-runtime";
import type { RuntimeAdapter } from "./types";
import { listCliTaskRuns, readCliTaskRunLog, startCliTaskRun } from "./cli-task-runs";

const execFileAsync = promisify(execFile);

function cliRuntimePath() {
  return [
    join(homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH || "",
  ].filter(Boolean).join(":");
}

type CliRuntimeConfig = {
  runtime: Extract<KnownAgentRuntime, "opencode" | "codex" | "claude-code" | "openhands" | "aider">;
  label: string;
  command: string;
  versionArgs: string[];
  provider: string;
  model: string;
  dataDir: string;
  installArgs?: string[];
  buildTaskArgs?: (task: string, input: Record<string, unknown>, profile?: AgentProfile) => string[];
};

const CLI_RUNTIMES: CliRuntimeConfig[] = [
  {
    runtime: "opencode",
    label: "OpenCode",
    command: process.env.OPENCODE_BIN || "opencode",
    versionArgs: ["--version"],
    provider: "openrouter",
    model: "",
    dataDir: "~/.opencode",
  },
  {
    runtime: "codex",
    label: "Codex",
    command: process.env.CODEX_BIN || "codex",
    versionArgs: ["--version"],
    provider: "openai-codex",
    model: "",
    dataDir: "~/.codex",
  },
  {
    runtime: "claude-code",
    label: "Claude Code",
    command: process.env.CLAUDE_CODE_BIN || process.env.CLAUDE_BIN || "claude",
    versionArgs: ["--version"],
    provider: "anthropic",
    model: "",
    dataDir: "~/.claude",
  },
  {
    runtime: "openhands",
    label: "OpenHands",
    command: process.env.OPENHANDS_BIN || "openhands",
    versionArgs: ["--version"],
    provider: "openai",
    model: "",
    dataDir: "~/.openhands",
    installArgs: ["tool", "install", "openhands", "--python", "3.12"],
    buildTaskArgs: (task) => ["--headless", "--json", "--override-with-envs", "-t", task],
  },
  {
    runtime: "aider",
    label: "Aider",
    command: process.env.AIDER_BIN || "aider",
    versionArgs: ["--version"],
    provider: "openrouter",
    model: "",
    dataDir: "~/.aider",
    installArgs: ["tool", "install", "aider-chat"],
    buildTaskArgs: (task, input, profile) => {
      const files = Array.isArray(input.files)
        ? input.files.filter((file): file is string => typeof file === "string" && file.trim().length > 0)
        : [];
      return [
        "--message",
        task,
        "--yes",
        "--no-auto-commits",
        "--no-dirty-commits",
        ...(profile?.model ? ["--model", profile.model] : []),
        ...files,
      ];
    },
  },
];

function providerName(slug: string) {
  const known: Record<string, string> = {
    anthropic: "Anthropic",
    openrouter: "OpenRouter",
    "openai-codex": "OpenAI Codex",
    openai: "OpenAI",
  };
  return known[slug] ?? slug;
}

function modelSelection(profile: AgentProfile, config: CliRuntimeConfig) {
  const provider = profile.provider?.trim() || config.provider;
  const model = profile.model?.trim() || config.model;
  return {
    provider,
    model,
    providers: provider
      ? [{
        slug: provider,
        name: providerName(provider),
        models: model ? [{ id: model }] : [],
        totalModels: model ? 1 : 0,
        isCurrent: true,
        isUserDefined: true,
        source: `${config.label} profile`,
      }]
      : [],
  };
}

async function cliStatus(config: CliRuntimeConfig, profile: AgentProfile) {
  const result = await execFileAsync(config.command, config.versionArgs, { timeout: 3_000, maxBuffer: 200_000, env: { ...process.env, PATH: cliRuntimePath() } }).catch(() => null);
  const version = result?.stdout.trim().split(/\r?\n/)[0] || result?.stderr.trim().split(/\r?\n/)[0] || "";
  return {
    ok: Boolean(result),
    runtime: config.runtime,
    detail: result ? (version ? `${config.label} is installed. ${version}` : `${config.label} is installed.`) : `${config.label} CLI was not found.`,
    modelSelection: modelSelection(profile, config),
  };
}

async function installCli(config: CliRuntimeConfig) {
  if (!config.installArgs) return { ok: false, error: `${config.label} does not expose an installer here yet.` };
  const uv = await execFileAsync("uv", ["--version"], { timeout: 5_000, maxBuffer: 100_000, env: { ...process.env, PATH: cliRuntimePath() } }).catch(() => null);
  if (!uv) return { ok: false, error: `uv is required to install ${config.label} from HivemindOS.` };
  const output = await execFileAsync("uv", config.installArgs, { timeout: 300_000, maxBuffer: 1_000_000, env: { ...process.env, PATH: cliRuntimePath() } }).catch((error: unknown) => {
    const maybe = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(maybe.stderr || maybe.stdout || maybe.message || `${config.label} install failed.`);
  });
  return { ok: true, message: `${config.label} install completed.`, output: `${output.stdout}${output.stderr}`.trim() };
}

function createCliRuntimeAdapter(config: CliRuntimeConfig): RuntimeAdapter {
  return {
    runtime: config.runtime,
    label: config.label,
    kind: "interactive",
    capabilities: {
      status: true,
      chat: false,
      runs: Boolean(config.buildTaskArgs),
      backgroundTasks: Boolean(config.buildTaskArgs),
      modelSelection: true,
    },
    defaultProfile: {
      gatewayUrl: "",
      chatPath: "",
      statusPath: "",
      localDataDir: config.dataDir,
      provider: config.provider,
      model: config.model,
    },
    getStatus: (profile) => cliStatus(config, profile),
    runIntegrationAction: async (profile, action, input) => {
      if (action === "install") return installCli(config);
      if (action !== "run-task") return { ok: false, error: `Unsupported ${config.label} action: ${action}` };
      if (!config.buildTaskArgs) return { ok: false, error: `${config.label} does not expose background task execution yet.` };
      return startCliTaskRun({
        runtime: config.runtime,
        label: config.label,
        command: config.command,
        buildArgs: config.buildTaskArgs,
      }, input, profile);
    },
    listRuns: () => listCliTaskRuns(config.runtime),
    getRunLog: (_profile, runId) => readCliTaskRunLog(config.runtime, runId),
  };
}

export const opencodeAdapter = createCliRuntimeAdapter(CLI_RUNTIMES[0]!);
export const codexAdapter = createCliRuntimeAdapter(CLI_RUNTIMES[1]!);
export const claudeCodeAdapter = createCliRuntimeAdapter(CLI_RUNTIMES[2]!);
export const openHandsAdapter = createCliRuntimeAdapter(CLI_RUNTIMES[3]!);
export const aiderAdapter = createCliRuntimeAdapter(CLI_RUNTIMES[4]!);
