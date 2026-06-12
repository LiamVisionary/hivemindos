import { execFile, spawn } from "child_process";
import { constants } from "fs";
import { access, mkdir } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { join, resolve, sep } from "path";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { registerAeonEnvSyncRepo } from "@/lib/services/runtime-adapters/aeon-env-sync-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

type GitHubRepo = {
  full_name: string;
  name: string;
  private: boolean;
  html_url: string;
  clone_url: string;
  default_branch?: string;
  owner?: { login?: string };
  description?: string | null;
};

type GitHubUser = {
  login: string;
};

function expandHome(path: string) {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith(`~${sep}`) || trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

function workspaceRoot(agent?: AgentProfile | null) {
  const configured = agent?.aeonLocalPath || agent?.localDataDir || "";
  return configured.trim() ? resolve(expandHome(configured)) : "";
}

async function readHiveEnv() {
  try {
    const { stdout } = await execFileAsync(join(process.cwd(), "scripts", "hive-env-add"), [
      "--export-json",
      "--scope",
      "agent",
      "--runtime",
      "generic",
    ], {
      timeout: 12_000,
      maxBuffer: 1_000_000,
    });
    const payload = JSON.parse(stdout) as { values?: Record<string, string> };
    return payload.values && typeof payload.values === "object" ? payload.values : {};
  } catch {
    return {};
  }
}

async function githubToken() {
  const hive = await readHiveEnv();
  const token = process.env.GH_GLOBAL?.trim() || hive.GH_GLOBAL?.trim() || "";
  if (!token) throw new Error("Connect GitHub first. GH_GLOBAL is missing.");
  return token;
}

async function githubFetch<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${await githubToken()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as (T & { message?: string; errors?: Array<{ message?: string; field?: string; code?: string }> }) | null;
  if (!response.ok) {
    const details = payload?.errors
      ?.map((error) => error.message || [error.field, error.code].filter(Boolean).join(" "))
      .filter(Boolean)
      .join("; ");
    throw new Error(details || payload?.message || `GitHub returned HTTP ${response.status}.`);
  }
  return payload as T;
}

function normalizeRepo(input?: string) {
  const trimmed = input?.trim() || "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) throw new Error("Choose a GitHub repo like owner/repo.");
  return trimmed;
}

function normalizeRepoName(input?: string) {
  const name = (input || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name) throw new Error("Repo name is required.");
  return name;
}

function nextRepoName(existingNames: Iterable<string>, baseName: string) {
  const taken = new Set(Array.from(existingNames, (name) => name.toLowerCase()));
  const requested = baseName.toLowerCase();
  const rootName = /^aeon-\d+$/.test(requested) ? "aeon" : baseName;
  if (!taken.has(rootName.toLowerCase())) return rootName;
  for (let index = 2; index < 1000; index++) {
    const candidate = `${rootName}-${index}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${rootName}-${Date.now()}`;
}

async function canRead(path: string) {
  return access(path, constants.R_OK).then(() => true).catch(() => false);
}

async function ensureGitRoot(root: string) {
  if (!root) throw new Error("AEON local repo folder is missing.");
  await mkdir(root, { recursive: true });
  if (!await canRead(join(root, ".git"))) {
    await execFileAsync("git", ["init"], { cwd: root, timeout: 20_000, maxBuffer: 500_000 });
  }
}

async function git(root: string, args: string[]) {
  return execFileAsync("git", args, { cwd: root, timeout: 60_000, maxBuffer: 1_000_000 });
}

async function linkRepo(agent: AgentProfile | undefined, repo: string) {
  const root = workspaceRoot(agent);
  await ensureGitRoot(root);
  const remote = `https://github.com/${repo}.git`;
  const hasOrigin = await git(root, ["remote", "get-url", "origin"]).then(() => true).catch(() => false);
  await git(root, hasOrigin ? ["remote", "set-url", "origin", remote] : ["remote", "add", "origin", remote]);
  return { root, repo, remote };
}

function pushLinkedRepo(root: string, branch: string) {
  return new Promise<{ pushed: boolean; error?: string }>((resolve) => {
    const child = spawn("git", ["push", "-u", "origin", branch], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorText = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ pushed: false, error: "Timed out while pushing the AEON repo." });
    }, 120_000);
    child.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ pushed: false, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code === 0 ? { pushed: true } : { pushed: false, error: errorText.trim() || "Git push did not complete." });
    });
  });
}

async function createRepo(input: {
  name?: string;
  description?: string;
  visibility?: string;
  owner?: string;
  autoPush?: boolean;
  autoIncrement?: boolean;
  agent?: AgentProfile;
}) {
  const requestedName = normalizeRepoName(input.name);
  const owner = input.owner?.trim();
  const name = input.autoIncrement
    ? nextRepoName((await githubFetch<GitHubRepo[]>(owner ? `/orgs/${encodeURIComponent(owner)}/repos?per_page=100&type=all` : "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member")).map((repo) => repo.name), requestedName)
    : requestedName;
  const body = {
    name,
    description: input.description?.trim() || undefined,
    private: input.visibility !== "public",
    auto_init: false,
  };
  const path = owner ? `/orgs/${encodeURIComponent(owner)}/repos` : "/user/repos";
  const repo = await githubFetch<GitHubRepo>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const linked = await linkRepo(input.agent, repo.full_name);
  const branch = input.agent?.aeonBranch || repo.default_branch || "main";
  const push = input.autoPush === false ? { pushed: false } : await pushLinkedRepo(linked.root, branch);
  return { repo, linked, push };
}

async function deleteRepo(input: { repo?: string; agent?: AgentProfile }) {
  const repo = normalizeRepo(input.repo || input.agent?.aeonRepo);
  await githubFetch(`/repos/${encodeURIComponent(repo).replaceAll("%2F", "/")}`, { method: "DELETE" });
  return repo;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRepo(fullName: string, fallback: GitHubRepo) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await githubFetch<GitHubRepo>(`/repos/${encodeURIComponent(fullName).replaceAll("%2F", "/")}`);
    } catch {
      await sleep(1_000);
    }
  }
  return fallback;
}

async function forkOfficialAeon(input: { name?: string }) {
  const name = normalizeRepoName(input.name || "aeon");
  const user = await githubFetch<GitHubUser>("/user");
  try {
    const repo = await githubFetch<GitHubRepo>("/repos/aaronjmars/aeon/forks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, default_branch_only: false }),
    });
    return waitForRepo(repo.full_name || `${user.login}/${name}`, repo);
  } catch (error) {
    const existingFullName = `${user.login}/${name}`;
    try {
      return await githubFetch<GitHubRepo>(`/repos/${existingFullName}`);
    } catch {
      throw error;
    }
  }
}

export async function GET() {
  try {
    const repos = await githubFetch<GitHubRepo[]>("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member");
    return NextResponse.json({
      ok: true,
      repos: repos.map((repo) => ({
        fullName: repo.full_name,
        name: repo.name,
        owner: repo.owner?.login || repo.full_name.split("/")[0],
        private: repo.private,
        url: repo.html_url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch || "main",
        description: repo.description || "",
      })),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not load GitHub repos.",
    }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      action?: string;
      agent?: AgentProfile;
      repo?: string;
      name?: string;
      description?: string;
      visibility?: string;
      owner?: string;
      autoPush?: boolean;
      autoIncrement?: boolean;
    };
    if (body.action === "delete") {
      const repo = await deleteRepo(body);
      return NextResponse.json({ ok: true, repo, deleted: true });
    }
    if (body.action === "create") {
      const result = await createRepo(body);
      await registerAeonEnvSyncRepo(result.repo.full_name, "github-repo:create").catch(() => undefined);
      return NextResponse.json({
        ok: true,
        repo: result.repo.full_name,
        branch: result.repo.default_branch || body.agent?.aeonBranch || "main",
        root: result.linked.root,
        remote: result.linked.remote,
        pushed: result.push.pushed,
        pushError: result.push.error,
      });
    }
    if (body.action === "fork-official") {
      const repo = await forkOfficialAeon({ name: body.name });
      await registerAeonEnvSyncRepo(repo.full_name, "github-repo:fork-official").catch(() => undefined);
      return NextResponse.json({
        ok: true,
        repo: repo.full_name,
        cloneUrl: repo.clone_url || `https://github.com/${repo.full_name}.git`,
        branch: repo.default_branch || "main",
      });
    }
    const repo = normalizeRepo(body.repo);
    const linked = await linkRepo(body.agent, repo);
    await registerAeonEnvSyncRepo(repo, "github-repo:link").catch(() => undefined);
    return NextResponse.json({
      ok: true,
      repo,
      branch: body.agent?.aeonBranch || "main",
      root: linked.root,
      remote: linked.remote,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not configure AEON GitHub repo.",
    }, { status: 400 });
  }
}
