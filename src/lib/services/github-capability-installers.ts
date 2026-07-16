import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { homedir } from "@/lib/home-dir";
import type {
  InstallableServiceAction,
  InstallableServiceStatus,
} from "@/lib/services/installable-services";

export const GITHUB_CAPABILITY_INSTALLABLE_IDS = [
  "yt-dlp",
  "whisper",
  "graphify",
  "trading-agents",
  "appflowy",
  "ghost",
] as const;

export type GitHubCapabilityInstallableId = typeof GITHUB_CAPABILITY_INSTALLABLE_IDS[number];

export function isGitHubCapabilityInstallableId(value: string): value is GitHubCapabilityInstallableId {
  return (GITHUB_CAPABILITY_INSTALLABLE_IDS as readonly string[]).includes(value);
}

const execFileAsync = promisify(execFile);
const APPS_ROOT = join(homedir(), ".hivemindos", "apps");
const TRADING_AGENTS_DIR = join(APPS_ROOT, "trading-agents");
const GHOST_CONTAINER = "hivemindos-ghost";
const GHOST_VOLUME = "hivemindos_ghost_content";

type CommandResult = { ok: boolean; stdout: string; stderr: string };

async function run(command: string, args: string[], timeout = 20_000): Promise<CommandResult> {
  return execFileAsync(command, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 500_000,
  }).then(
    ({ stdout, stderr }) => ({ ok: true, stdout, stderr }),
    (error: unknown) => {
      const detail = error as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, stdout: detail.stdout ?? "", stderr: detail.stderr ?? detail.message ?? "" };
    },
  );
}

async function commandAvailable(command: string, args = ["--version"]) {
  return (await run(command, args, 8_000)).ok;
}

async function dockerReady() {
  return await commandAvailable("docker") && (await run("docker", ["info"], 8_000)).ok;
}

async function containerState(name: string) {
  const result = await run("docker", ["inspect", "-f", "{{.State.Status}}", name], 5_000);
  return result.ok ? result.stdout.trim() : "";
}

function cliStatus(
  id: Extract<GitHubCapabilityInstallableId, "yt-dlp" | "whisper" | "graphify">,
  installed: boolean,
  ready: boolean,
): InstallableServiceStatus {
  const definition = {
    "yt-dlp": {
      name: "yt-dlp",
      command: "uv tool install yt-dlp[default]",
      packageName: "yt-dlp[default]",
      sourceUrl: "https://github.com/yt-dlp/yt-dlp",
      requirements: ["uv", "Optional ffmpeg for format merging and audio conversion"],
    },
    whisper: {
      name: "Whisper",
      command: "uv tool install openai-whisper --python 3.11",
      packageName: "openai-whisper",
      sourceUrl: "https://github.com/openai/whisper",
      requirements: ["uv", "Python 3.11", "ffmpeg"],
    },
    graphify: {
      name: "Graphify",
      command: "uv tool install graphifyy && graphify install",
      packageName: "graphifyy",
      sourceUrl: "https://github.com/Graphify-Labs/graphify",
      requirements: ["uv", "Local parser dependencies installed by graphify install"],
    },
  }[id];
  return {
    id,
    name: definition.name,
    installed,
    running: false,
    detail: installed ? `${definition.name} is installed and ready for agents on this machine.` : ready ? `${definition.name} is ready to install with uv.` : `uv is required before HivemindOS can install ${definition.name}.`,
    installMethod: "uv-tool",
    requirements: definition.requirements,
    sourceUrl: definition.sourceUrl,
    provenance: {
      packageName: definition.packageName,
      packageManager: "uv tool",
      installCommand: definition.command,
      updatePolicy: "Latest compatible upstream package at install time; source and package identity are shown before installation.",
    },
    securityNotes: [
      "Runs locally with the files and network access granted to the invoking agent runtime.",
      "HivemindOS does not run the capability until a task selects it after installation.",
    ],
  };
}

async function readCliStatus(id: Extract<GitHubCapabilityInstallableId, "yt-dlp" | "whisper" | "graphify">) {
  const command = id === "whisper" ? "whisper" : id;
  const args = id === "whisper" || id === "graphify" ? ["--help"] : ["--version"];
  const [cliInstalled, uvReady, ffmpegReady] = await Promise.all([
    commandAvailable(command, args),
    commandAvailable("uv"),
    id === "whisper" ? commandAvailable("ffmpeg") : Promise.resolve(true),
  ]);
  const status = cliStatus(id, cliInstalled && ffmpegReady, uvReady);
  if (id === "whisper" && cliInstalled && !ffmpegReady) {
    return {
      ...status,
      detail: "The Whisper CLI is installed, but ffmpeg is still required before transcription is ready.",
      preflight: [{ key: "ffmpeg", ok: false, blocking: true, detail: "Install ffmpeg with the platform package manager, then refresh setup." }],
    };
  }
  return status;
}

async function readTradingAgentsStatus(): Promise<InstallableServiceStatus> {
  const installed = existsSync(join(TRADING_AGENTS_DIR, ".venv", "pyvenv.cfg"));
  const uvReady = await commandAvailable("uv");
  return {
    id: "trading-agents",
    name: "TradingAgents",
    installed,
    running: false,
    detail: installed ? `TradingAgents is installed in ${TRADING_AGENTS_DIR}.` : uvReady ? "TradingAgents is ready for an isolated local install." : "uv is required before HivemindOS can install TradingAgents.",
    installMethod: "uv-tool",
    requirements: ["git", "uv", "Python 3.12", "At least one supported model provider or a local Ollama model"],
    sourceUrl: "https://github.com/TauricResearch/TradingAgents",
    projectDir: TRADING_AGENTS_DIR,
    provenance: {
      packageName: "TauricResearch/TradingAgents",
      packageManager: "git + uv",
      installCommand: "git clone --depth 1 https://github.com/TauricResearch/TradingAgents; uv venv --python 3.12; uv pip install --python .venv/bin/python -e .",
      updatePolicy: "A fresh install uses the current reviewed upstream default branch. Existing installs are never overwritten automatically.",
    },
    securityNotes: [
      "TradingAgents is a research framework, not a broker or order-execution integration.",
      "Model and data-provider credentials remain separate shared-env setup and are never copied into the checkout.",
      "Outputs are research context and must not be treated as financial advice.",
    ],
  };
}

function appFlowyInstalled() {
  if (process.platform === "darwin") return existsSync("/Applications/AppFlowy.app") || existsSync(join(homedir(), "Applications", "AppFlowy.app"));
  return false;
}

async function readAppFlowyStatus(): Promise<InstallableServiceStatus> {
  const installed = appFlowyInstalled()
    || (process.platform === "win32" && await commandAvailable("where", ["AppFlowy.exe"]))
    || (process.platform === "linux" && (await run("flatpak", ["info", "io.appflowy.AppFlowy"], 8_000)).ok);
  const running = process.platform === "darwin" && installed && (await run("pgrep", ["-x", "AppFlowy"], 5_000)).ok;
  return {
    id: "appflowy",
    name: "AppFlowy",
    installed,
    running,
    detail: installed ? `AppFlowy is installed${running ? " and running" : ""}.` : "AppFlowy can be installed with the platform package manager.",
    installMethod: "local-service",
    requirements: [process.platform === "darwin" ? "Homebrew" : process.platform === "win32" ? "winget" : "Flatpak with Flathub"],
    sourceUrl: "https://github.com/AppFlowy-IO/AppFlowy",
    securityNotes: ["This installs the official desktop client. AppFlowy Cloud self-hosting is a separate server deployment documented upstream."],
  };
}

async function readGhostStatus(): Promise<InstallableServiceStatus> {
  const docker = await dockerReady();
  const state = docker ? await containerState(GHOST_CONTAINER) : "";
  return {
    id: "ghost",
    name: "Ghost",
    installed: Boolean(state),
    running: state === "running",
    openUrl: "http://127.0.0.1:2368",
    detail: !docker ? "Docker is required before HivemindOS can install Ghost." : state === "running" ? "Ghost is running privately on localhost:2368." : state ? `Ghost is installed and ${state}.` : "Ghost is ready to install as a local Docker service.",
    installMethod: "docker",
    requirements: ["Docker Desktop or Docker Engine"],
    sourceUrl: "https://github.com/TryGhost/Ghost",
    securityNotes: ["The local service binds only to 127.0.0.1 and persists content in a named Docker volume."],
  };
}

export async function readGitHubCapabilityInstallableStatus(id: GitHubCapabilityInstallableId): Promise<InstallableServiceStatus> {
  if (id === "yt-dlp" || id === "whisper" || id === "graphify") return readCliStatus(id);
  if (id === "trading-agents") return readTradingAgentsStatus();
  if (id === "appflowy") return readAppFlowyStatus();
  return readGhostStatus();
}

async function installCli(id: Extract<GitHubCapabilityInstallableId, "yt-dlp" | "whisper" | "graphify">) {
  if (!(await commandAvailable("uv"))) throw new Error(`uv is required to install ${id}.`);
  const args = id === "yt-dlp"
    ? ["tool", "install", "yt-dlp[default]"]
    : id === "whisper"
      ? ["tool", "install", "openai-whisper", "--python", "3.11"]
      : ["tool", "install", "graphifyy"];
  const command = id === "whisper" ? "whisper" : id;
  if (!(await commandAvailable(command, id === "yt-dlp" ? ["--version"] : ["--help"]))) {
    const result = await run("uv", args, 600_000);
    if (!result.ok) throw new Error(result.stderr || result.stdout || `${id} install failed.`);
  }
  if (id === "graphify") {
    const dependencies = await run("graphify", ["install"], 300_000);
    if (!dependencies.ok) throw new Error(dependencies.stderr || dependencies.stdout || "Graphify parser setup failed.");
  }
  if (id === "whisper" && !(await commandAvailable("ffmpeg")) && process.platform === "darwin" && await commandAvailable("brew")) {
    const ffmpeg = await run("brew", ["install", "ffmpeg"], 600_000);
    if (!ffmpeg.ok) throw new Error(`Whisper installed, but ffmpeg setup failed: ${ffmpeg.stderr || ffmpeg.stdout}`);
  }
  if (id === "whisper" && !(await commandAvailable("ffmpeg"))) {
    throw new Error("Whisper is installed, but ffmpeg is required before it can transcribe media. Install ffmpeg with the platform package manager, then retry setup.");
  }
}

async function installTradingAgents() {
  if (existsSync(TRADING_AGENTS_DIR) && !existsSync(join(TRADING_AGENTS_DIR, ".git"))) {
    throw new Error(`TradingAgents already has unrelated files at ${TRADING_AGENTS_DIR}; HivemindOS will not overwrite them.`);
  }
  await mkdir(APPS_ROOT, { recursive: true });
  if (!existsSync(TRADING_AGENTS_DIR)) {
    const clone = await run("git", ["clone", "--depth", "1", "https://github.com/TauricResearch/TradingAgents", TRADING_AGENTS_DIR], 300_000);
    if (!clone.ok) throw new Error(clone.stderr || clone.stdout || "TradingAgents clone failed.");
  }
  const venv = await run("uv", ["venv", "--python", "3.12", join(TRADING_AGENTS_DIR, ".venv")], 180_000);
  if (!venv.ok) throw new Error(venv.stderr || venv.stdout || "TradingAgents environment setup failed.");
  const python = process.platform === "win32" ? join(TRADING_AGENTS_DIR, ".venv", "Scripts", "python.exe") : join(TRADING_AGENTS_DIR, ".venv", "bin", "python");
  const install = await run("uv", ["pip", "install", "--python", python, "-e", TRADING_AGENTS_DIR], 600_000);
  if (!install.ok) throw new Error(install.stderr || install.stdout || "TradingAgents dependency install failed.");
}

async function runAppFlowyAction(action: InstallableServiceAction) {
  if (action === "install") {
    const spec = process.platform === "darwin"
      ? ["brew", ["install", "--cask", "appflowy"]] as const
      : process.platform === "win32"
        ? ["winget", ["install", "--id", "AppFlowy.AppFlowy", "--exact", "--accept-package-agreements", "--accept-source-agreements"]] as const
        : ["flatpak", ["install", "-y", "flathub", "io.appflowy.AppFlowy"]] as const;
    const result = await run(spec[0], [...spec[1]], 600_000);
    if (!result.ok) throw new Error(result.stderr || result.stdout || "AppFlowy install failed.");
  } else if (action === "start") {
    if (process.platform === "darwin") {
      const opened = await run("open", ["-a", "AppFlowy"], 20_000);
      if (!opened.ok) throw new Error(opened.stderr || "AppFlowy could not open.");
    } else throw new Error("Open AppFlowy from the operating system application menu after installation.");
  } else if (action === "stop" && process.platform === "darwin") {
    await run("osascript", ["-e", "tell application \"AppFlowy\" to quit"], 20_000);
  }
}

async function runGhostAction(action: InstallableServiceAction) {
  if (!(await dockerReady())) throw new Error("Docker is required to install or run Ghost.");
  const state = await containerState(GHOST_CONTAINER);
  if (action === "stop") await run("docker", ["stop", GHOST_CONTAINER], 30_000);
  else if (state) {
    const start = await run("docker", ["start", GHOST_CONTAINER], 30_000);
    if (!start.ok) throw new Error(start.stderr || "Ghost could not start.");
  } else {
    await run("docker", ["volume", "create", GHOST_VOLUME], 30_000);
    const create = await run("docker", ["run", "-d", "--name", GHOST_CONTAINER, "-p", "127.0.0.1:2368:2368", "-e", "url=http://127.0.0.1:2368", "-v", `${GHOST_VOLUME}:/var/lib/ghost/content`, "ghost:5-alpine"], 180_000);
    if (!create.ok) throw new Error(create.stderr || create.stdout || "Ghost install failed.");
  }
}

export async function runGitHubCapabilityInstallableAction(
  id: GitHubCapabilityInstallableId,
  action: InstallableServiceAction,
) {
  if (action === "status") return readGitHubCapabilityInstallableStatus(id);
  if (id === "yt-dlp" || id === "whisper" || id === "graphify") {
    if (action !== "install") throw new Error(`${id} is a CLI capability; install it here, then agents can invoke it for tasks.`);
    await installCli(id);
  } else if (id === "trading-agents") {
    if (action !== "install") throw new Error("TradingAgents is a research capability; install it here, then agents can invoke its local workflow.");
    await installTradingAgents();
  } else if (id === "appflowy") await runAppFlowyAction(action);
  else await runGhostAction(action);
  return readGitHubCapabilityInstallableStatus(id);
}
