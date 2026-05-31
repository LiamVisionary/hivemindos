import { constants } from "fs";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { basename, dirname, join, resolve, sep } from "path";
import { NextRequest, NextResponse } from "next/server";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { registerAeonEnvSyncRepo } from "@/lib/services/runtime-adapters/aeon-env-sync-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const GIT_CLONE_TIMEOUT_MS = 900_000;

function expandHome(path: string) {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith(`~${sep}`) || trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

function displayPath(path: string) {
  const home = homedir();
  if (path === home) return "~";
  return path.startsWith(`${home}${sep}`) ? `~/${path.slice(home.length + 1)}` : path;
}

function slug(value: string, fallback = "aeon") {
  return (value || fallback)
    .trim()
    .replace(/\.git$/i, "")
    .replace(/['"]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || fallback;
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

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function remoteHostFromCollectorUrl(collectorUrl: string) {
  const hostname = new URL(collectorUrl).hostname;
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function repoNameFromUrl(url: string) {
  const cleaned = url.trim().replace(/\.git$/i, "");
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  return slug(parts.at(-1) || "aeon");
}

function repoFullNameFromUrl(url: string) {
  const cleaned = url.trim().replace(/\.git$/i, "");
  const github = cleaned.match(/github\.com[:/]([^/\s]+)\/([^/\s.]+)$/i);
  const ownerRepo = cleaned.match(/^([^/\s]+)\/([^/\s.]+)$/);
  const match = github || ownerRepo;
  return match ? `${match[1]}/${match[2]}` : "";
}

function logoFromRepo(repo?: string) {
  const match = repo?.match(/github\.com[:/]([^/\s]+)\/([^/\s.]+)/i) || repo?.match(/^([^/\s]+)\/([^/\s.]+)$/);
  return match ? `https://github.com/${match[1]}.png` : "";
}

async function canRead(path: string) {
  return access(path, constants.R_OK).then(() => true).catch(() => false);
}

// Optional local repo cache: when enabled, a clone seeds a pristine copy under
// ~/.hivemindos/aeon-repo-cache/<owner>-<repo>, and future clones duplicate that copy
// (fast, offline) instead of hitting the network. Lives in the home dir, not the project,
// so the Next.js dev watcher never sees the ~42MB repo.
function repoCacheDir(repoUrl: string) {
  const full = repoFullNameFromUrl(repoUrl) || repoNameFromUrl(repoUrl);
  const key = slug(full.replace(/[\\/]+/g, "-")) || "aeon";
  return join(homedir(), ".hivemindos", "aeon-repo-cache", key);
}

async function duplicateDir(source: string, dest: string) {
  // cp -R is fast locally (and copy-on-write on APFS), and copies the .git so the new repo
  // keeps history and can push.
  await execFileAsync("cp", ["-R", source, dest], { timeout: 120_000, maxBuffer: 2_000_000 });
}

async function setOrigin(root: string, repoUrl: string) {
  await execFileAsync("git", ["remote", "set-url", "origin", repoUrl], { cwd: root, timeout: 20_000, maxBuffer: 500_000 })
    .catch(() => execFileAsync("git", ["remote", "add", "origin", repoUrl], { cwd: root, timeout: 20_000, maxBuffer: 500_000 }).catch(() => undefined));
}

async function cacheBranch(cacheDir: string) {
  const { stdout } = await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: cacheDir, timeout: 10_000, maxBuffer: 200_000 }).catch(() => ({ stdout: "" }));
  return stdout.trim() || "main";
}

// How many commits the cached copy is behind its upstream (after fetching). 0 when current.
async function cacheBehindCount(cacheDir: string) {
  const branch = await cacheBranch(cacheDir);
  await execFileAsync("git", ["fetch", "--quiet", "origin", branch], { cwd: cacheDir, timeout: 60_000, maxBuffer: 1_000_000 }).catch(() => undefined);
  const { stdout } = await execFileAsync("git", ["rev-list", "--count", `${branch}..origin/${branch}`], { cwd: cacheDir, timeout: 15_000, maxBuffer: 200_000 }).catch(() => ({ stdout: "0" }));
  return { branch, behind: Number.parseInt(stdout.trim(), 10) || 0 };
}

async function refreshCache(cacheDir: string) {
  const branch = await cacheBranch(cacheDir);
  await execFileAsync("git", ["fetch", "--quiet", "origin", branch], { cwd: cacheDir, timeout: 60_000, maxBuffer: 1_000_000 });
  await execFileAsync("git", ["reset", "--hard", `origin/${branch}`], { cwd: cacheDir, timeout: 30_000, maxBuffer: 500_000 });
  return { branch, behind: 0 };
}

// Clone into `root`, optionally backed by the local cache. Returns how the repo was obtained.
async function cloneIntoRoot(repo: string, root: string, useCache: boolean): Promise<"cache" | "network"> {
  const cacheDir = repoCacheDir(repo);
  if (useCache && await canRead(join(cacheDir, ".git"))) {
    await duplicateDir(cacheDir, root);
    await setOrigin(root, repo);
    return "cache";
  }
  try {
    await execFileAsync("git", ["clone", repo, root], { timeout: GIT_CLONE_TIMEOUT_MS, maxBuffer: 2_000_000 });
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  if (useCache) {
    // Seed the cache from this fresh clone for next time.
    await rm(cacheDir, { recursive: true, force: true }).catch(() => undefined);
    await mkdir(dirname(cacheDir), { recursive: true });
    await duplicateDir(root, cacheDir).catch(() => undefined);
  }
  return "network";
}

async function gitRemote(root: string) {
  const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: root, timeout: 10_000, maxBuffer: 200_000 }).catch(() => ({ stdout: "" }));
  return stdout.trim();
}

async function ensureAeonWorkspace(root: string) {
  await mkdir(root, { recursive: true });
  await Promise.all([
    mkdir(join(root, "skills"), { recursive: true }),
    mkdir(join(root, "memory", "topics"), { recursive: true }),
    mkdir(join(root, "memory", "logs"), { recursive: true }),
    mkdir(join(root, "memory", "issues"), { recursive: true }),
    mkdir(join(root, ".outputs"), { recursive: true }),
    mkdir(join(root, "dashboard", "outputs"), { recursive: true }),
  ]);
  if (!await canRead(join(root, "aeon.yml"))) {
    await writeFile(join(root, "aeon.yml"), "skills:\n");
  }
  if (!await canRead(join(root, "skills.json"))) {
    await writeFile(join(root, "skills.json"), `${JSON.stringify({ skills: [] }, null, 2)}\n`);
  }
  if (!await canRead(join(root, "memory", "MEMORY.md"))) {
    await writeFile(join(root, "memory", "MEMORY.md"), "# AEON Memory\n\n");
  }
  if (!await canRead(join(root, ".git"))) {
    await execFileAsync("git", ["init"], { cwd: root, timeout: 20_000, maxBuffer: 500_000 }).catch(() => undefined);
  }
}

function parseRemoteWorkspaceOutput(stdout: string) {
  let root = "";
  let repo = "";
  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const [key, ...rest] = rawLine.split("\t");
    const value = rest.join("\t");
    if (key === "__ROOT__") root = value;
    if (key === "__REMOTE__") repo = value;
  }
  if (!root) throw new Error("Remote machine did not return an AEON repo path.");
  return { root, repo };
}

async function ensureRemoteAeonWorkspace(input: { collectorUrl: string; path: string; action: string; repoUrl?: string }) {
  const host = remoteHostFromCollectorUrl(input.collectorUrl);
  if (!host) throw new Error("Remote agent bridge URL is missing a host.");
  const quotedPath = shellQuote(input.path.trim() || "~/.aeon");
  const quotedRepo = shellQuote(input.repoUrl?.trim() || "");
  const script = [
    "set -eu",
    `p=${quotedPath}`,
    `repo=${quotedRepo}`,
    "case \"$p\" in",
    "  \"~\") p=\"$HOME\" ;;",
    "  \"~/\"*) p=\"$HOME/${p#~/}\" ;;",
    "esac",
    "if [ -n \"$repo\" ] && [ ! -d \"$p\" ]; then",
    "  git clone \"$repo\" \"$p\" >/dev/null",
    "fi",
    "mkdir -p \"$p/skills\" \"$p/memory/topics\" \"$p/memory/logs\" \"$p/memory/issues\" \"$p/.outputs\" \"$p/dashboard/outputs\"",
    "[ -f \"$p/aeon.yml\" ] || printf 'skills:\\n' > \"$p/aeon.yml\"",
    "[ -f \"$p/skills.json\" ] || printf '{\\n  \"skills\": []\\n}\\n' > \"$p/skills.json\"",
    "[ -f \"$p/memory/MEMORY.md\" ] || printf '# AEON Memory\\n\\n' > \"$p/memory/MEMORY.md\"",
    "if [ ! -d \"$p/.git\" ]; then git -C \"$p\" init >/dev/null 2>&1 || true; fi",
    "real_path=$(cd \"$p\" && pwd -P)",
    "remote=$(git -C \"$real_path\" remote get-url origin 2>/dev/null || true)",
    "printf '__ROOT__\\t%s\\n' \"$real_path\"",
    "printf '__REMOTE__\\t%s\\n' \"$remote\"",
  ].join("\n");
  const targets = [host, `ubuntu@${host}`, `root@${host}`];
  const errors: string[] = [];
  for (const target of targets) {
    try {
      const { stdout } = await execFileAsync("tailscale", ["ssh", target, "sh", "-lc", script], {
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      });
      return parseRemoteWorkspaceOutput(stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Tailscale SSH error.";
      errors.push(message.replaceAll(host, "<machine>"));
    }
  }
  throw new Error(errors.at(-1) ?? "Could not initialize AEON repo over Tailscale SSH.");
}

function workspaceRootFromAgent(agent?: AgentProfile | null) {
  const path = agent?.aeonLocalPath || agent?.localDataDir || "";
  return path.trim();
}

function renameSegment(value?: string) {
  const next = slug(value || "", "");
  if (!next || next === "." || next === ".." || next.includes("/") || next.includes("\\")) {
    throw new Error("Use a folder-safe AEON repo name.");
  }
  return next;
}

async function renameRemoteAeonWorkspace(input: { collectorUrl: string; path: string; name: string }) {
  const host = remoteHostFromCollectorUrl(input.collectorUrl);
  if (!host) throw new Error("Remote agent bridge URL is missing a host.");
  const quotedPath = shellQuote(input.path.trim());
  const quotedName = shellQuote(input.name);
  const script = [
    "set -eu",
    `p=${quotedPath}`,
    `new_name=${quotedName}`,
    "case \"$p\" in",
    "  \"~\") p=\"$HOME\" ;;",
    "  \"~/\"*) p=\"$HOME/${p#~/}\" ;;",
    "esac",
    "[ -d \"$p\" ] || { printf 'AEON repo folder does not exist: %s\\n' \"$p\" >&2; exit 2; }",
    "parent=$(dirname \"$p\")",
    "target=\"$parent/$new_name\"",
    "if [ \"$p\" != \"$target\" ]; then",
    "  [ ! -e \"$target\" ] || { printf 'A folder already exists at %s\\n' \"$target\" >&2; exit 3; }",
    "  mv \"$p\" \"$target\"",
    "fi",
    "real_path=$(cd \"$target\" && pwd -P)",
    "remote=$(git -C \"$real_path\" remote get-url origin 2>/dev/null || true)",
    "printf '__ROOT__\\t%s\\n' \"$real_path\"",
    "printf '__REMOTE__\\t%s\\n' \"$remote\"",
  ].join("\n");
  const targets = [host, `ubuntu@${host}`, `root@${host}`];
  const errors: string[] = [];
  for (const target of targets) {
    try {
      const { stdout } = await execFileAsync("tailscale", ["ssh", target, "sh", "-lc", script], {
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      });
      return parseRemoteWorkspaceOutput(stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Tailscale SSH error.";
      errors.push(message.replaceAll(host, "<machine>"));
    }
  }
  throw new Error(errors.at(-1) ?? "Could not rename AEON repo over Tailscale SSH.");
}

async function availableLocalWorkspaceRoot(name = "aeon-workspace", parentPath = "~/.aeon-repos") {
  const root = resolve(expandHome(parentPath));
  await mkdir(root, { recursive: true });
  const requested = slug(name, "aeon-workspace").toLowerCase();
  const base = /^aeon-\d+$/.test(requested) ? "aeon" : requested;
  for (let index = 1; index < 1000; index++) {
    const suffix = index === 1 ? "" : `-${index}`;
    const candidate = join(root, `${base}${suffix}`);
    if (!await canRead(candidate)) return candidate;
  }
  return join(root, `${base}-${Date.now()}`);
}

async function assertSafeLocalWorkspaceRoot(root: string) {
  if (!root || root === sep || root === homedir()) {
    throw new Error("Refusing to delete a broad filesystem path.");
  }
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error("AEON repo folder does not exist.");
  const hasAeonFile = await canRead(join(root, "aeon.yml")) || await canRead(join(root, "skills.json"));
  if (!hasAeonFile) throw new Error("Refusing to delete a folder that does not look like an AEON workspace.");
}

async function agentForWorkspace(input: { root: string; name?: string; repo?: string; mode?: AgentProfile["aeonMode"]; collectorUrl?: string; machineName?: string; readGitRemote?: boolean }): Promise<AgentProfile> {
  const collectorUrl = normalizeCollectorUrl(input.collectorUrl);
  const remoteWorkspace = Boolean(collectorUrl && !isLocalCollectorUrl(collectorUrl));
  const remote = input.repo ?? (remoteWorkspace || input.readGitRemote === false ? "" : await gitRemote(input.root));
  const repoFullName = repoFullNameFromUrl(remote);
  const repoName = slug(input.name || (remote ? repoNameFromUrl(remote) : basename(input.root)) || "AEON Workspace", "AEON Workspace");
  return {
    id: `aeon-${repoName.toLowerCase()}-${Date.now()}`,
    name: input.name || repoName.replace(/[-_]+/g, " "),
    runtime: "aeon",
    runtimeKind: "background",
    runtimeCapabilities: {
      status: true,
      skills: true,
      schedules: true,
      runs: true,
      outputs: true,
      memory: true,
      backgroundTasks: true,
      notifications: true,
      setup: true,
    },
    gatewayUrl: "http://127.0.0.1:41241",
    a2aUrl: "http://127.0.0.1:41241",
    chatPath: "",
    statusPath: "/health",
    agentId: repoName,
    localDataDir: remoteWorkspace ? input.root : displayPath(input.root),
    aeonLocalPath: remoteWorkspace ? input.root : displayPath(input.root),
    aeonRepo: repoFullName || remote,
    aeonRepoName: repoName,
    aeonLogoUrl: logoFromRepo(repoFullName || remote),
    aeonBranch: "main",
    aeonMode: input.mode || (repoFullName || remote ? "github" : "local"),
    machineName: input.machineName || (remoteWorkspace ? remoteHostFromCollectorUrl(collectorUrl) : "local"),
    telemetryUrl: collectorUrl,
    useSharedVault: true,
    beeRole: "worker",
    workerClass: "ops",
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { action?: string; path?: string; repoUrl?: string; name?: string; unique?: boolean | string; cache?: boolean | string; collectorUrl?: string; machineName?: string; machineKey?: string; agent?: AgentProfile };
    const action = body.action || "initialize";
    const collectorUrl = normalizeCollectorUrl(body.collectorUrl || body.agent?.telemetryUrl);
    const remoteWorkspace = Boolean(collectorUrl && !isLocalCollectorUrl(collectorUrl));

    // Local repo cache status/refresh — used by the clone modal to detect an existing copy
    // and offer to update it before cloning. These don't touch any workspace.
    if (action === "cache-status" || action === "cache-refresh") {
      const repoUrl = body.repoUrl?.trim() || "";
      if (!repoUrl) throw new Error("repoUrl is required for cache operations.");
      const cacheDir = repoCacheDir(repoUrl);
      if (!await canRead(join(cacheDir, ".git"))) {
        return NextResponse.json({ ok: true, action, exists: false, behind: 0, path: displayPath(cacheDir) });
      }
      const result = action === "cache-refresh" ? await refreshCache(cacheDir) : await cacheBehindCount(cacheDir);
      return NextResponse.json({ ok: true, action, exists: true, behind: result.behind, branch: result.branch, path: displayPath(cacheDir) });
    }
    let root = "";
    let repo = "";
    if (remoteWorkspace) {
      if (action !== "initialize" && action !== "link" && action !== "clone" && action !== "rename") {
        throw new Error(`Unsupported remote AEON workspace action: ${action}.`);
      }
      if (action === "rename") {
        const currentPath = body.path?.trim() || workspaceRootFromAgent(body.agent);
        if (!currentPath) throw new Error("AEON repo path is missing.");
        const nextName = renameSegment(body.name);
        const remoteResult = await renameRemoteAeonWorkspace({ collectorUrl, path: currentPath, name: nextName });
        root = remoteResult.root;
        repo = remoteResult.repo;
      } else if (action === "clone") {
        repo = body.repoUrl?.trim() || "";
        if (!/^((https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?)|git@github\.com:[\w.-]+\/[\w.-]+(?:\.git)?)$/.test(repo)) {
          throw new Error("Use a GitHub repository URL like https://github.com/owner/repo.git.");
        }
      }
      const path = body.path?.trim() || (action === "clone" && repo ? `~/.aeon-repos/${repoNameFromUrl(repo)}` : "~/.aeon");
      const remoteResult = await ensureRemoteAeonWorkspace({ collectorUrl, path, action, repoUrl: repo });
      root = remoteResult.root;
      repo = repo || remoteResult.repo;
    } else if (action === "delete-git" || action === "delete-local") {
      root = resolve(expandHome(body.path?.trim() || workspaceRootFromAgent(body.agent)));
      await assertSafeLocalWorkspaceRoot(root);
      if (action === "delete-git") {
        await rm(join(root, ".git"), { recursive: true, force: true });
        const agent = await agentForWorkspace({ root, name: body.agent?.aeonRepoName || body.agent?.name || basename(root), mode: "local" });
        return NextResponse.json({ ok: true, action, agent, root: displayPath(root), message: "Removed Git metadata from the AEON workspace." });
      }
      await rm(root, { recursive: true, force: true });
      return NextResponse.json({ ok: true, action, root: displayPath(root), deleted: true, message: "Deleted the local AEON workspace." });
    } else if (action === "duplicate") {
      const sourceRoot = resolve(expandHome(body.path?.trim() || workspaceRootFromAgent(body.agent)));
      await assertSafeLocalWorkspaceRoot(sourceRoot);
      const sourceName = body.agent?.aeonRepoName || body.agent?.name || basename(sourceRoot) || "aeon-workspace";
      const folderName = body.name?.trim() || `${sourceName}-copy`;
      root = await availableLocalWorkspaceRoot(folderName, dirname(sourceRoot));
      await duplicateDir(sourceRoot, root);
      await ensureAeonWorkspace(root);
    } else if (action === "initialize") {
      const createUnique = body.unique === true || body.unique === "true";
      root = body.path
        ? resolve(expandHome(body.path))
        : createUnique
          ? await availableLocalWorkspaceRoot(body.name)
          : resolve(expandHome("~/.aeon"));
      await ensureAeonWorkspace(root);
    } else if (action === "link") {
      root = resolve(expandHome(body.path || ""));
      if (!root || !await canRead(root)) throw new Error("Choose an existing AEON repo folder.");
      await ensureAeonWorkspace(root);
    } else if (action === "clone") {
      repo = body.repoUrl?.trim() || "";
      if (!/^((https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?)|git@github\.com:[\w.-]+\/[\w.-]+(?:\.git)?)$/.test(repo)) {
        throw new Error("Use a GitHub repository URL like https://github.com/owner/repo.git.");
      }
      const name = body.name?.trim() || repoNameFromUrl(repo);
      const requestedRoot = resolve(expandHome(body.path || `~/.aeon-repos/${name}`));
      root = body.unique === true || body.unique === "true"
        ? await availableLocalWorkspaceRoot(name, dirname(requestedRoot))
        : requestedRoot;
      if (!await canRead(root)) {
        await mkdir(dirname(root), { recursive: true });
        await cloneIntoRoot(repo, root, body.cache === true || body.cache === "true");
      }
      await ensureAeonWorkspace(root);
    } else if (action === "rename") {
      const currentPath = body.path?.trim() || workspaceRootFromAgent(body.agent);
      if (!currentPath) throw new Error("AEON repo path is missing.");
      const currentRoot = resolve(expandHome(currentPath));
      if (!await canRead(currentRoot)) throw new Error("AEON repo folder does not exist.");
      const nextName = renameSegment(body.name);
      const nextRoot = join(dirname(currentRoot), nextName);
      if (currentRoot !== nextRoot) {
        if (await canRead(nextRoot)) throw new Error(`A folder already exists at ${displayPath(nextRoot)}.`);
        await rename(currentRoot, nextRoot);
      }
      root = nextRoot;
      repo = await gitRemote(root);
    } else {
      throw new Error(`Unsupported AEON workspace action: ${action}.`);
    }
    const requestedName = body.name?.trim();
    const actualName = (body.unique === true || body.unique === "true") && root ? basename(root) : requestedName;
    const agent = await agentForWorkspace({
      root,
      repo: action === "duplicate" ? "" : repo,
      name: actualName,
      mode: action === "clone" ? "github" : action === "duplicate" ? "local" : undefined,
      collectorUrl,
      machineName: body.machineName,
      readGitRemote: action !== "duplicate",
    });
    if (agent.aeonRepo) await registerAeonEnvSyncRepo(agent.aeonRepo, `workspace:${action}`).catch(() => undefined);
    const readme = remoteWorkspace ? "" : await readFile(join(root, "README.md"), "utf8").catch(() => "");
    return NextResponse.json({ ok: true, agent, root: displayPath(root), readme: readme.slice(0, 1200) });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not prepare AEON workspace.",
    }, { status: 400 });
  }
}
