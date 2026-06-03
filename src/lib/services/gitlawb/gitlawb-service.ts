import { access, mkdir, readFile, rm, writeFile } from "fs/promises";
import { constants, existsSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { GitLawbIdentity, GitLawbNodeStatus, GitLawbStatus } from "@/lib/types/gitlawb";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 3500;
const STATUS_CACHE_PATH = join(homedir(), ".hivemindos", "gitlawb", "status.json");
const INSTALL_MARKER_PATH = join(homedir(), ".hivemindos", "gitlawb", "installed-by-hivemindos.json");
const DEFAULT_NODE_URL = "http://127.0.0.1:7545";
const REDACTED = "[redacted]";

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
};

function now() {
  return Date.now();
}

async function runCommand(command: string, args: string[] = [], timeoutMs = DEFAULT_TIMEOUT_MS, env?: Record<string, string>): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: timeoutMs,
      env: { ...process.env, ...env },
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
    };
  } catch (error) {
    const maybe = error as Partial<Error> & { stdout?: string | Buffer; stderr?: string | Buffer; code?: number | string };
    return {
      ok: false,
      stdout: maybe.stdout?.toString() ?? "",
      stderr: maybe.stderr?.toString() ?? "",
      error: maybe.message || "Command failed.",
    };
  }
}

async function commandPath(command: string) {
  const candidates = [
    command,
    join(homedir(), ".local", "bin", command),
    join(homedir(), "bin", command),
    `/opt/homebrew/bin/${command}`,
    `/usr/local/bin/${command}`,
  ];
  for (const candidate of candidates) {
    if (candidate === command) {
      const found = await runCommand("which", [command], 1200);
      const value = found.stdout.trim().split("\n")[0];
      if (found.ok && value) return value;
      continue;
    }
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep searching common user-local install targets.
    }
  }
  return "";
}

function parseDid(output: string) {
  const direct = output.match(/\bdid:[a-z0-9._:-]+/i)?.[0];
  if (direct) return direct;
  try {
    const parsed = JSON.parse(output) as { did?: unknown; identity?: { did?: unknown } };
    if (typeof parsed.did === "string") return parsed.did;
    if (typeof parsed.identity?.did === "string") return parsed.identity.did;
  } catch {
    // Plain-text CLI output is expected on older GitLawb builds.
  }
  return "";
}

export async function detectGitLawbCli() {
  const [glPath, remoteHelperPath, nodeBinaryPath] = await Promise.all([
    commandPath("gl"),
    commandPath("git-remote-gitlawb"),
    commandPath("gitlawb-node"),
  ]);
  const version = glPath ? await runCommand(glPath, ["--version"], 1800) : null;
  return {
    glPath: glPath || undefined,
    remoteHelperPath: remoteHelperPath || undefined,
    nodeBinaryPath: nodeBinaryPath || undefined,
    installed: Boolean(glPath),
    remoteHelperInstalled: Boolean(remoteHelperPath),
    version: version?.ok ? version.stdout.trim() || version.stderr.trim() || undefined : undefined,
    error: glPath ? undefined : "GitLawb CLI is not installed.",
  };
}

export async function detectGitLawbIdentity(): Promise<GitLawbIdentity> {
  const checkedAt = now();
  const glPath = await commandPath("gl");
  if (!glPath) {
    return { source: "missing", publicOnly: true, lastCheckedAt: checkedAt, error: "GitLawb CLI is not installed." };
  }
  const result = await runCommand(glPath, ["identity", "show"], 2200);
  const did = parseDid(result.stdout || result.stderr);
  if (!result.ok || !did) {
    return { source: "missing", publicOnly: true, lastCheckedAt: checkedAt, error: "No local GitLawb DID found." };
  }
  return { did, source: "local", publicOnly: true, lastCheckedAt: checkedAt };
}

function configuredNodeUrl(input?: string) {
  return input?.trim()
    || process.env.GITLAWB_NODE_URL?.trim()
    || process.env.GITLAWB_NODE?.trim()
    || process.env.NEXT_PUBLIC_GITLAWB_NODE_URL?.trim()
    || DEFAULT_NODE_URL;
}

function bindModeForUrl(url: string): GitLawbNodeStatus["bindMode"] {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "local";
    if (/^100\.(6[4-9]|7[0-9]|8[0-9]|9[0-9]|1[0-1][0-9]|12[0-7])\./.test(host) || host.endsWith(".ts.net")) return "tailnet";
    return "public";
  } catch {
    return "unknown";
  }
}

function positiveCount(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function detectGitLawbMcp() {
  const glPath = await commandPath("gl");
  if (!glPath) return false;
  const result = await runCommand(glPath, ["mcp", "--help"], 2000);
  return result.ok || /mcp/i.test(`${result.stdout}\n${result.stderr}`);
}

export async function nodeHealth(nodeUrl?: string): Promise<GitLawbNodeStatus> {
  const url = configuredNodeUrl(nodeUrl);
  const base = url.replace(/\/+$/, "");
  const bindMode = bindModeForUrl(base);
  const mcpAvailable = await detectGitLawbMcp().catch(() => false);
  try {
    const health = await fetchJson(`${base}/health`);
    const healthy = health.status === "ok" || health.healthy === true;
    let repoCount: number | undefined;
    let peerCount: number | undefined;
    try {
      const stats = await fetchJson(`${base}/api/v1/stats`);
      repoCount = positiveCount(stats.repoCount ?? stats.repos ?? stats.repositories);
      peerCount = positiveCount(stats.peerCount ?? stats.peers);
    } catch {
      // Health is enough for the compact Fleet status.
    }
    return { enabled: true, healthy, nodeUrl: base, bindMode, repoCount, peerCount, mcpAvailable };
  } catch (error) {
    return {
      enabled: false,
      healthy: false,
      nodeUrl: base,
      bindMode,
      mcpAvailable,
      error: error instanceof Error ? error.message : "GitLawb node is offline.",
    };
  }
}

export async function listGitLawbRepos(nodeUrl?: string) {
  const base = configuredNodeUrl(nodeUrl).replace(/\/+$/, "");
  try {
    const data = await fetchJson(`${base}/api/v1/repos`);
    const repos = Array.isArray(data.repos) ? data.repos : Array.isArray(data.repositories) ? data.repositories : [];
    return repos.filter((item) => item && typeof item === "object");
  } catch {
    return [];
  }
}

export function sanitizeGitLawbProof<T>(proof: T): T {
  return deepRedact(proof) as T;
}

function deepRedact(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(deepRedact);
  if (!value || typeof value !== "object") return value;
  const next: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/private|secret|token|password|tailnetIp|vault(?:Note)?Path|localPath/i.test(key)) {
      next[key] = REDACTED;
    } else {
      next[key] = deepRedact(raw);
    }
  }
  return next;
}

function redactString(value: string) {
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED)
    .replace(/\b100\.(?:6[4-9]|7[0-9]|8[0-9]|9[0-9]|1[0-1][0-9]|12[0-7])(?:\.\d{1,3}){2}\b/g, REDACTED)
    .replace(/(?:\/Users\/[^/\s]+|~)\/Documents\/Obsidian\/[^\s]+/g, REDACTED)
    .replace(new RegExp(escapeRegExp(homedir()), "g"), "~")
    .replace(/[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY)=[^\s,;]+/gi, (match) => `${match.split("=")[0]}=${REDACTED}`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function readGitLawbStatus(options: { nodeUrl?: string; cache?: boolean } = {}): Promise<GitLawbStatus> {
  if (options.cache && existsSync(STATUS_CACHE_PATH)) {
    try {
      const cached = JSON.parse(await readFile(STATUS_CACHE_PATH, "utf8")) as GitLawbStatus;
      if (Date.now() - cached.checkedAt < 15_000) return cached;
    } catch {
      // Rebuild broken cache below.
    }
  }
  const [cli, identity, node] = await Promise.all([
    detectGitLawbCli(),
    detectGitLawbIdentity(),
    nodeHealth(options.nodeUrl),
  ]);
  const status = { cli, identity, node, checkedAt: now() };
  await writeStatusCache(status).catch(() => undefined);
  return status;
}

async function writeStatusCache(status: GitLawbStatus) {
  await mkdir(join(homedir(), ".hivemindos", "gitlawb"), { recursive: true, mode: 0o700 });
  await writeFile(STATUS_CACHE_PATH, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
}

export async function setupGitLawbCli() {
  if (process.platform === "win32") {
    return { ok: false, status: await readGitLawbStatus(), error: "GitLawb static installer currently supports macOS and Linux. Install GitLawb manually, then refresh status." };
  }
  const before = await detectGitLawbCli();
  if (before.installed && before.remoteHelperInstalled) {
    return { ok: true, status: await readGitLawbStatus(), message: "GitLawb CLI is already installed." };
  }
  const installDir = process.env.GITLAWB_INSTALL_DIR?.trim() || join(homedir(), ".local", "bin");
  await mkdir(installDir, { recursive: true, mode: 0o755 });
  const installerPath = join(tmpdir(), `gitlawb-install-${process.pid}-${Date.now()}.sh`);
  try {
    const response = await fetch("https://gitlawb.com/install.sh", { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Installer download failed with HTTP ${response.status}.`);
    await writeFile(installerPath, await response.text(), { mode: 0o700 });
    const result = await runCommand("sh", [installerPath], 30_000, { GITLAWB_INSTALL_DIR: installDir });
    if (!result.ok) throw new Error(result.stderr || result.stdout || result.error || "GitLawb install failed.");
    await mkdir(join(homedir(), ".hivemindos", "gitlawb"), { recursive: true, mode: 0o700 });
    await writeFile(INSTALL_MARKER_PATH, `${JSON.stringify({
      installDir,
      binaries: ["gl", "git-remote-gitlawb", "gitlawb-node"],
      installedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });
    return { ok: true, status: await readGitLawbStatus(), message: "GitLawb CLI installed." };
  } catch (error) {
    return { ok: false, status: await readGitLawbStatus(), error: error instanceof Error ? error.message : "GitLawb install failed." };
  } finally {
    await rm(installerPath, { force: true }).catch(() => undefined);
  }
}

export async function ensureGitLawbIdentity() {
  const glPath = await commandPath("gl");
  if (!glPath) return { ok: false, status: await readGitLawbStatus(), error: "GitLawb CLI is not installed." };
  const existing = await detectGitLawbIdentity();
  if (existing.did) return { ok: true, status: await readGitLawbStatus(), identity: existing, message: "GitLawb DID already exists." };
  const created = await runCommand(glPath, ["identity", "new"], 5000);
  if (!created.ok) {
    return { ok: false, status: await readGitLawbStatus(), error: created.stderr || created.stdout || created.error || "Could not create GitLawb DID." };
  }
  const identity = await detectGitLawbIdentity();
  return { ok: Boolean(identity.did), status: await readGitLawbStatus(), identity, message: identity.did ? "GitLawb DID created." : "Identity command completed, but no DID was detected." };
}

export async function setupGitLawbNode() {
  const status = await readGitLawbStatus();
  if (status.node.healthy) {
    return { ok: true, status, message: "Local GitLawb node is already healthy." };
  }
  return {
    ok: false,
    status,
    requires: ["Docker or a local GitLawb node runtime", "Postgres for the full GitLawb node"],
    message: "Node setup is lazy in v1. CLI proof readiness is active; start a local/Tailnet-only GitLawb node before linking hosted repos.",
  };
}
