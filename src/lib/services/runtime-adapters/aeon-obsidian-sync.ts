import { constants, createWriteStream } from "fs";
import { access, mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import { execFile, spawn } from "child_process";
import { createHash } from "crypto";
import { homedir } from "@/lib/home-dir";
import { basename, join, resolve } from "path";
import { promisify } from "util";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { expandHomePath, resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { repoNameFromAgent } from "@/lib/services/obsidian/agent-profiles";

const execFileAsync = promisify(execFile);
const STATE_ROOT = join(homedir(), ".hivemindos", "aeon-obsidian-sync");
const UNISON_IGNORES = [
  "Path .git",
  "Name node_modules",
  "Path dashboard/.next",
  "Path dashboard/node_modules",
  "Name .env*",
];
const REPEAT_SECONDS = "2";

export type AeonObsidianSyncAction = "status" | "start" | "stop" | "once";

export type AeonObsidianSyncStatus = {
  ok: boolean;
  installed: boolean;
  running: boolean;
  repoRoot: string;
  vaultRoot: string;
  vaultRepoRoot: string;
  pid?: number;
  logPath: string;
  command: string;
  message?: string;
  error?: string;
};

function clean(value?: string) {
  const trimmed = value?.trim();
  return trimmed || "";
}

function aeonRoot(profile: AgentProfile) {
  const candidate = clean(profile.aeonLocalPath) || clean(profile.localDataDir) || clean(process.env.AEON_LOCAL_PATH) || clean(process.env.AEON_HOME);
  return candidate ? resolve(expandHomePath(candidate)) : "";
}

function stateKey(repoRoot: string, vaultRepoRoot: string) {
  return createHash("sha256").update(`${repoRoot}\n${vaultRepoRoot}`).digest("hex").slice(0, 16);
}

function commandText(repoRoot: string, vaultRepoRoot: string, repeat = true) {
  const base = ["unison", repoRoot, vaultRepoRoot, "-auto", "-batch", "-times"];
  if (repeat) base.push("-repeat", REPEAT_SECONDS);
  for (const ignore of UNISON_IGNORES) base.push("-ignore", JSON.stringify(ignore));
  return base.join(" ");
}

function unisonArgs(repoRoot: string, vaultRepoRoot: string, repeat: boolean) {
  const args = [repoRoot, vaultRepoRoot, "-auto", "-batch", "-times"];
  if (repeat) args.push("-repeat", REPEAT_SECONDS);
  for (const ignore of UNISON_IGNORES) args.push("-ignore", ignore);
  return args;
}

async function canExecute(command: string) {
  const pathValue = process.env.PATH || "";
  const candidates = pathValue.split(":").filter(Boolean).map((dir) => join(dir, command));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

async function processRunning(pid?: number) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function syncPaths(profile: AgentProfile, vaultPath?: string) {
  const repoRoot = aeonRoot(profile);
  if (!repoRoot) throw new Error("Configure an AEON local repo path before starting Obsidian sync.");
  const repoStats = await stat(repoRoot).catch(() => null);
  if (!repoStats?.isDirectory()) throw new Error(`AEON repo path is not a directory: ${repoRoot}`);
  const vaultRoot = resolveObsidianVaultPath(vaultPath, { requireWritable: true });
  const vaultRepoRoot = join(vaultRoot, "Agents", "AEON", repoNameFromAgent(profile));
  await mkdir(vaultRepoRoot, { recursive: true });
  await mkdir(STATE_ROOT, { recursive: true });
  const key = stateKey(repoRoot, vaultRepoRoot);
  return {
    repoRoot,
    vaultRoot,
    vaultRepoRoot,
    pidPath: join(STATE_ROOT, `${key}.pid`),
    logPath: join(STATE_ROOT, `${key}.log`),
  };
}

async function readPid(pidPath: string) {
  const raw = await readFile(pidPath, "utf8").catch(() => "");
  const pid = Number(raw.trim());
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

async function baseStatus(profile: AgentProfile, vaultPath?: string): Promise<AeonObsidianSyncStatus> {
  const paths = await syncPaths(profile, vaultPath);
  const pid = await readPid(paths.pidPath);
  const running = await processRunning(pid);
  if (pid && !running) await rm(paths.pidPath, { force: true }).catch(() => undefined);
  const installed = await canExecute("unison");
  return {
    ok: installed,
    installed,
    running,
    repoRoot: paths.repoRoot,
    vaultRoot: paths.vaultRoot,
    vaultRepoRoot: paths.vaultRepoRoot,
    pid: running ? pid : undefined,
    logPath: paths.logPath,
    command: commandText(paths.repoRoot, paths.vaultRepoRoot),
    error: installed ? undefined : "Unison is not installed. Install it with setup or `brew install unison`.",
  };
}

async function startSync(profile: AgentProfile, vaultPath?: string) {
  const status = await baseStatus(profile, vaultPath);
  if (!status.installed) return status;
  if (status.running) return { ...status, ok: true, message: "AEON Obsidian sync is already running." };
  const paths = await syncPaths(profile, vaultPath);
  const log = createWriteStream(paths.logPath, { flags: "a" });
  log.write(`\n[${new Date().toISOString()}] ${commandText(paths.repoRoot, paths.vaultRepoRoot)}\n`);
  const child = spawn("unison", unisonArgs(paths.repoRoot, paths.vaultRepoRoot, true), {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.unref();
  if (child.pid) await writeFile(paths.pidPath, `${child.pid}\n`);
  await new Promise((resolve) => setTimeout(resolve, 350));
  return { ...(await baseStatus(profile, vaultPath)), ok: true, message: "AEON Obsidian sync started." };
}

async function stopSync(profile: AgentProfile, vaultPath?: string) {
  const paths = await syncPaths(profile, vaultPath);
  const pid = await readPid(paths.pidPath);
  if (await processRunning(pid)) {
    try {
      process.kill(-(pid as number), "SIGTERM");
    } catch {
      try {
        process.kill(pid as number, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }
  await rm(paths.pidPath, { force: true });
  return { ...(await baseStatus(profile, vaultPath)), ok: true, message: "AEON Obsidian sync stopped." };
}

async function runOnce(profile: AgentProfile, vaultPath?: string) {
  const status = await baseStatus(profile, vaultPath);
  if (!status.installed) return status;
  await execFileAsync("unison", unisonArgs(status.repoRoot, status.vaultRepoRoot, false), {
    timeout: 120_000,
    maxBuffer: 4_000_000,
  });
  return { ...(await baseStatus(profile, vaultPath)), ok: true, message: `Synced ${basename(status.repoRoot)} with Obsidian.` };
}

export async function runAeonObsidianSyncAction(profile: AgentProfile, action: AeonObsidianSyncAction, vaultPath?: string) {
  if (action === "start") return startSync(profile, vaultPath);
  if (action === "stop") return stopSync(profile, vaultPath);
  if (action === "once") return runOnce(profile, vaultPath);
  return baseStatus(profile, vaultPath);
}
