import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { homedir } from "@/lib/home-dir";
import { runtimeCommandEnv } from "@/lib/services/runtime-command-env";
import { installRuntimeBinary } from "@/lib/services/runtime-installer";
import type { AgentProfile, KnownAgentRuntime } from "@/lib/types/agent-runtime";
import type { RuntimeAdapter } from "./types";
import { listCliTaskRuns, readCliTaskRunLog, startCliTaskRun } from "./cli-task-runs";

const execFileAsync = promisify(execFile);

type CliRuntimeConfig = {
  runtime: Extract<KnownAgentRuntime, "opencode" | "codex" | "claude-code" | "openhands" | "aider">;
  label: string;
  command: string;
  versionArgs: string[];
  authStatusArgs?: string[];
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
    authStatusArgs: ["login", "status"],
    provider: "openai-codex",
    model: "",
    dataDir: "~/.codex",
    buildTaskArgs: (task, _input, profile) => [
      "exec",
      "--color",
      "never",
      "--sandbox",
      "workspace-write",
      ...(profile?.model ? ["--model", profile.model] : []),
      task,
    ],
  },
  {
    runtime: "claude-code",
    label: "Claude Code",
    command: process.env.CLAUDE_CODE_BIN || process.env.CLAUDE_BIN || "claude",
    versionArgs: ["--version"],
    authStatusArgs: ["auth", "status"],
    provider: "anthropic",
    model: "",
    dataDir: "~/.claude",
    buildTaskArgs: (task, _input, profile) => [
      "--print",
      "--output-format",
      "text",
      "--permission-mode",
      "acceptEdits",
      ...(profile?.model ? ["--model", profile.model] : []),
      task,
    ],
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
  const result = await execFileAsync(config.command, config.versionArgs, { timeout: 3_000, maxBuffer: 200_000, env: runtimeCommandEnv() }).catch(() => null);
  const auth = result && config.authStatusArgs
    ? await execFileAsync(config.command, config.authStatusArgs, { timeout: 5_000, maxBuffer: 200_000, env: runtimeCommandEnv() }).catch(() => null)
    : undefined;
  const version = result?.stdout.trim().split(/\r?\n/)[0] || result?.stderr.trim().split(/\r?\n/)[0] || "";
  const authReady = auth !== null;
  return {
    ok: Boolean(result) && authReady,
    runtime: config.runtime,
    detail: !result
      ? `${config.label} CLI was not found.`
      : authReady
        ? (version ? `${config.label} is installed and authenticated. ${version}` : `${config.label} is installed and authenticated.`)
        : `${config.label} is installed but not authenticated. Log in before starting a managed task.`,
    modelSelection: modelSelection(profile, config),
  };
}

async function installCli(config: CliRuntimeConfig) {
  if (!config.installArgs) return { ok: false, error: `${config.label} does not expose an installer here yet.` };
  const uv = await execFileAsync("uv", ["--version"], { timeout: 5_000, maxBuffer: 100_000, env: runtimeCommandEnv() }).catch(() => null);
  if (!uv) return { ok: false, error: `uv is required to install ${config.label} from HivemindOS.` };
  const output = await execFileAsync("uv", config.installArgs, { timeout: 300_000, maxBuffer: 1_000_000, env: runtimeCommandEnv() }).catch((error: unknown) => {
    const maybe = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(maybe.stderr || maybe.stdout || maybe.message || `${config.label} install failed.`);
  });
  return { ok: true, message: `${config.label} install completed.`, output: `${output.stdout}${output.stderr}`.trim() };
}

// Persists a runtime credential into the shared hive env via hive-env-add,
// piping KEY=value over stdin so a literal `$` in the value survives (matches
// the Venice/UsePod/GitHub credential-save pattern). The value is never logged.
// Windows hive-env-add is a Python script with no extension (not spawnable);
// setup.ps1 installs a hive-env-add.cmd wrapper. Prefer that on Windows and run
// it through the shell so spawn can execute it.
function resolveHiveEnvAdd(): { command: string; shell: boolean } {
  const isWin = process.platform === "win32";
  const candidates = [
    process.env.HIVE_ENV_ADD_BIN,
    ...(isWin ? [join(homedir(), ".local", "bin", "hive-env-add.cmd")] : []),
    join(homedir(), ".local", "bin", "hive-env-add"),
    ...(isWin ? [join(process.cwd(), "scripts", "hive-env-add.cmd")] : []),
    join(process.cwd(), "scripts", "hive-env-add"),
  ].filter((path): path is string => Boolean(path));
  const command = candidates.find((path) => existsSync(path)) ?? join(process.cwd(), "scripts", "hive-env-add");
  return { command, shell: isWin && command.toLowerCase().endsWith(".cmd") };
}

async function saveRuntimeAuth(env: string, value: string) {
  const key = (env || "").trim();
  const secret = (value || "").trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) return { ok: false, error: "Invalid credential variable name." };
  if (!secret) return { ok: false, error: "A credential value is required." };
  if (/\s/.test(secret)) return { ok: false, error: "The credential must not contain spaces or line breaks." };
  const envAdd = resolveHiveEnvAdd();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(envAdd.command, [
      "--import-stdin",
      "--scope",
      "agent",
      "--runtime",
      "generic",
    ], { stdio: ["pipe", "pipe", "pipe"], shell: envAdd.shell });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while saving the credential to shared env."));
    }, 30_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) { resolve(); return; }
      reject(new Error(stderr.trim() || `hive-env-add exited with status ${code ?? "unknown"} while saving the credential.`));
    });
    child.stdin.end(`${key}=${secret}\n`);
  });
  return { ok: true, message: `Saved ${key} to your shared hive env.` };
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
      if (action === "install-runtime") return installRuntimeBinary(config.runtime);
      if (action === "runtime-auth") return saveRuntimeAuth(String(input.env || ""), String(input.value || ""));
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
