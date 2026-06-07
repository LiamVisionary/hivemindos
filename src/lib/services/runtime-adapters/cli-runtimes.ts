import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentProfile, KnownAgentRuntime } from "@/lib/types/agent-runtime";
import type { RuntimeAdapter } from "./types";

const execFileAsync = promisify(execFile);

type CliRuntimeConfig = {
  runtime: Extract<KnownAgentRuntime, "opencode" | "codex" | "claude-code">;
  label: string;
  command: string;
  versionArgs: string[];
  provider: string;
  model: string;
  dataDir: string;
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
];

function providerName(slug: string) {
  const known: Record<string, string> = {
    anthropic: "Anthropic",
    openrouter: "OpenRouter",
    "openai-codex": "OpenAI Codex",
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
  const result = await execFileAsync(config.command, config.versionArgs, { timeout: 3_000, maxBuffer: 200_000 }).catch(() => null);
  const version = result?.stdout.trim().split(/\r?\n/)[0] || result?.stderr.trim().split(/\r?\n/)[0] || "";
  return {
    ok: Boolean(result),
    runtime: config.runtime,
    detail: result ? (version ? `${config.label} is installed. ${version}` : `${config.label} is installed.`) : `${config.label} CLI was not found.`,
    modelSelection: modelSelection(profile, config),
  };
}

function createCliRuntimeAdapter(config: CliRuntimeConfig): RuntimeAdapter {
  return {
    runtime: config.runtime,
    label: config.label,
    kind: "interactive",
    capabilities: {
      status: true,
      chat: false,
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
  };
}

export const opencodeAdapter = createCliRuntimeAdapter(CLI_RUNTIMES[0]!);
export const codexAdapter = createCliRuntimeAdapter(CLI_RUNTIMES[1]!);
export const claudeCodeAdapter = createCliRuntimeAdapter(CLI_RUNTIMES[2]!);
