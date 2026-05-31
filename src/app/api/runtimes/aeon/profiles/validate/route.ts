import { constants } from "fs";
import { access, readdir, readFile, rm } from "fs/promises";
import { execFile } from "child_process";
import { homedir } from "os";
import { dirname, join, resolve, sep } from "path";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import type { AgentProfile } from "@/lib/types/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

function expandHome(path: string) {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith(`~${sep}`) || trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

function normalizeRepo(value?: string | null) {
  const cleaned = (value ?? "").trim().replace(/\.git$/i, "");
  const github = cleaned.match(/github\.com[:/]([^/\s]+)\/([^/\s.]+)$/i);
  const ownerRepo = cleaned.match(/^([^/\s]+)\/([^/\s.]+)$/);
  const match = github || ownerRepo;
  return match ? `${match[1]}/${match[2]}` : "";
}

function displayPath(path: string) {
  const home = homedir();
  if (path === home) return "~";
  return path.startsWith(`${home}${sep}`) ? `~/${path.slice(home.length + 1)}` : path;
}

function normalizeCollectorUrl(url?: string | null) {
  const trimmed = url?.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

function isLocalCollectorUrl(url?: string | null) {
  const normalized = normalizeCollectorUrl(url);
  if (!normalized) return true;
  const hostname = new URL(normalized).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function workspacePath(agent: AgentProfile) {
  const raw = agent.aeonLocalPath?.trim() || agent.localDataDir?.trim() || "";
  return raw ? resolve(expandHome(raw)) : "";
}

async function hasLocalAeonWorkspace(path: string) {
  if (!path) return false;
  const [hasConfig, hasSkills] = await Promise.all([
    access(join(path, "aeon.yml"), constants.R_OK).then(() => true).catch(() => false),
    access(join(path, "skills.json"), constants.R_OK).then(() => true).catch(() => false),
  ]);
  return hasConfig || hasSkills;
}

async function githubRepoExists(repo: string) {
  if (!repo) return "unknown";
  return execFileAsync("gh", ["repo", "view", repo, "--json", "nameWithOwner"], {
    timeout: 12_000,
    maxBuffer: 200_000,
  }).then(() => "exists").catch((error: unknown) => {
    const message = String((error as { stderr?: unknown; stdout?: unknown; message?: unknown })?.stderr ?? "")
      + String((error as { stdout?: unknown; message?: unknown })?.stdout ?? "")
      + String((error as { message?: unknown })?.message ?? "");
    if (/could not resolve to a repository|not found|404/i.test(message)) return "missing";
    return "unknown";
  });
}

async function gitRemote(root: string) {
  const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
    cwd: root,
    timeout: 10_000,
    maxBuffer: 200_000,
  }).catch(() => ({ stdout: "" }));
  return stdout.trim();
}

function localRecoveryRoots(localPath: string) {
  const roots = [
    localPath ? dirname(localPath) : "",
    join(homedir(), ".aeon-repos"),
  ].filter(Boolean);
  return [...new Set(roots.map((root) => resolve(root)))];
}

async function recoverRenamedLocalWorkspace(agent: AgentProfile, localPath: string, repo: string) {
  if (!localPath || !repo) return null;
  for (const root of localRecoveryRoots(localPath)) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.slice(0, 200)) {
      if (!entry.isDirectory()) continue;
      const candidate = join(root, entry.name);
      if (candidate === localPath || !await hasLocalAeonWorkspace(candidate)) continue;
      const remote = normalizeRepo(await gitRemote(candidate));
      if (remote !== repo) continue;
      const nextPath = displayPath(resolve(candidate));
      return {
        ...agent,
        localDataDir: nextPath,
        aeonLocalPath: nextPath,
      };
    }
  }
  return null;
}

async function validateAgent(agent: AgentProfile) {
  if (agent.runtime !== "aeon") return { reason: "", recovered: null };
  if (!isLocalCollectorUrl(agent.telemetryUrl)) return { reason: "", recovered: null };
  const localPath = workspacePath(agent);
  const repo = normalizeRepo(agent.aeonRepo);
  if (repo) {
    const repoStatus = await githubRepoExists(repo);
    if (repoStatus === "missing") return { reason: "github-repo-missing", recovered: null };
  }
  const localExists = await hasLocalAeonWorkspace(localPath);
  if (localExists) return { reason: "", recovered: null };
  const recovered = await recoverRenamedLocalWorkspace(agent, localPath, repo);
  if (recovered) return { reason: "", recovered };
  return { reason: localPath ? "local-workspace-missing" : "", recovered: null };
}

async function profileFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isFile() && entry.name === "profile.json") return [path];
    if (entry.isDirectory()) return profileFiles(path, depth + 1);
    return [];
  }));
  return nested.flat();
}

function vaultRoot(vaultPath?: string) {
  return resolve(expandHome(vaultPath?.trim() || "~/Documents/Obsidian/hivemindos-vault"));
}

async function pruneVaultProfiles(vaultPath: string | undefined, staleIds: Set<string>) {
  if (!staleIds.size) return [];
  const root = vaultRoot(vaultPath);
  const files = await Promise.all([
    profileFiles(join(root, "Agents", "AEON")),
    profileFiles(join(root, "AGENTS", "AEON")),
  ]).then((groups) => groups.flat());
  const pruned: string[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8").catch(() => "");
    let profile: AgentProfile | null = null;
    try {
      profile = JSON.parse(raw) as AgentProfile;
    } catch {
      continue;
    }
    if (profile?.runtime !== "aeon" || !staleIds.has(profile.id)) continue;
    await rm(file, { force: true });
    pruned.push(file);
  }
  return pruned;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { agents?: AgentProfile[]; vaultPath?: string };
  const agents = Array.isArray(body.agents) ? body.agents.filter((agent) => agent?.runtime === "aeon") : [];
  const checked = await Promise.all(agents.map(async (agent) => ({
    agent,
    result: await validateAgent(agent),
  })));
  const stale = checked.map(({ agent, result }) => ({
    id: agent.id,
    name: agent.name,
    reason: result.reason,
  }));
  const staleProfiles = stale.filter((item) => item.reason);
  const staleIds = new Set(staleProfiles.map((item) => item.id));
  const prunedVaultProfiles = await pruneVaultProfiles(body.vaultPath, staleIds);
  return NextResponse.json({
    ok: true,
    stale: staleProfiles,
    recovered: checked.map(({ result }) => result.recovered).filter(Boolean),
    prunedVaultProfiles,
  });
}
