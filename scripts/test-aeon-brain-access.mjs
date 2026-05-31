#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import crypto from "node:crypto";

const publicRepo = process.env.HIVE_AEON_BRAIN_E2E_PUBLIC_REPO || "LiamVisionary/hivemindos";
const privateRepo = process.env.HIVE_AEON_BRAIN_E2E_PRIVATE_REPO || "LiamVisionary/claw-code-mobile-private";

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || readGitHubToken();
if (!token) {
  throw new Error("Set GITHUB_TOKEN/GH_TOKEN or authenticate gh before running the AEON brain E2E test.");
}

const publicVisibility = await githubVisibility(publicRepo, token);
const privateVisibility = await githubVisibility(privateRepo, token);
assert(publicVisibility === "public", `${publicRepo} must be public for this E2E; GitHub reported ${publicVisibility}.`);
assert(privateVisibility === "private", `${privateRepo} must be private and token-visible for this E2E; GitHub reported ${privateVisibility}.`);

const vaultRoot = await mkdtemp(join(tmpdir(), "hivemindos-aeon-brain-"));
const projectRoot = await prepareIsolatedProject();
await mkdir(join(vaultRoot, "PRIVATE"), { recursive: true });
await mkdir(join(vaultRoot, "Nested"), { recursive: true });
await writeFile(join(vaultRoot, "Project Alpha.md"), "# Project Alpha\n\nalpha launch memory should be searchable by public runs.\n", "utf8");
await writeFile(join(vaultRoot, "Nested", "Architecture.md"), "# Architecture\n\nTailnet brain endpoints serve retrieval safely.\n", "utf8");
await writeFile(join(vaultRoot, "PRIVATE", "Secret Omega.md"), "# Secret Omega\n\nomega-private-token must never be returned to a public repository run.\n", "utf8");

const port = await freePort(5021);
const localToken = crypto.randomBytes(24).toString("hex");
const server = spawn("pnpm", ["dev", "--port", String(port)], {
  cwd: projectRoot,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
  env: {
    ...process.env,
    PORT: String(port),
    NEXT_PUBLIC_OBSIDIAN_VAULT_PATH: vaultRoot,
    GITHUB_TOKEN: token,
    GH_TOKEN: token,
    HIVE_AEON_BRAIN_LOCAL_TOKEN: localToken,
    HIVE_AEON_BRAIN_VISIBILITY_CACHE_TTL_MS: "0",
  },
});

let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

try {
  await waitForServer(port, localToken);

  const publicIdentity = identity(publicRepo, "e2e-public");
  const privateIdentity = identity(privateRepo, "e2e-private");

  const publicPolicy = await post(port, localToken, { action: "policy", identity: publicIdentity });
  assert(publicPolicy.ok === true, "public policy request should succeed");
  assert(publicPolicy.policy.mode === "restricted", "public repo should receive restricted policy");
  assert(publicPolicy.repository.visibility === "public", "public repo visibility should be verified as public");

  const publicSearch = await post(port, localToken, { action: "search", query: "alpha launch", identity: publicIdentity });
  assert(publicSearch.ok === true, "public search should succeed");
  assert(publicSearch.results.some((result) => result.path === "Project Alpha.md"), "public search should return allowed vault results");

  const publicSecretSearch = await post(port, localToken, { action: "search", query: "omega-private-token", identity: publicIdentity });
  assert(publicSecretSearch.ok === true, "public secret search request should still succeed");
  assert(publicSecretSearch.results.length === 0, "public restricted search must not return PRIVATE results");

  const publicRead = await post(port, localToken, { action: "read", path: "PRIVATE/Secret Omega.md", identity: publicIdentity }, 403);
  assert(publicRead.ok === false, "public exact note read should be rejected");

  const publicList = await post(port, localToken, { action: "list", identity: publicIdentity }, 403);
  assert(publicList.ok === false, "public directory listing should be rejected");

  const appendPath = `Agents/AEON/Runs/${repoSlug(publicRepo)}/e2e-public/notes.md`;
  const publicAppend = await post(port, localToken, { action: "append", path: appendPath, content: "public append audit\n", identity: publicIdentity });
  assert(publicAppend.ok === true, "public append to scoped run path should succeed");
  const appended = await readFile(join(vaultRoot, appendPath), "utf8");
  assert(appended.includes("public append audit"), "public append should write to the real vault");

  const privatePolicy = await post(port, localToken, { action: "policy", identity: privateIdentity });
  assert(privatePolicy.ok === true, "private policy request should succeed");
  assert(privatePolicy.policy.mode === "unrestricted", "private repo should receive unrestricted policy");
  assert(privatePolicy.repository.visibility === "private", "private repo visibility should be verified as private");

  const privateList = await post(port, localToken, { action: "list", identity: privateIdentity });
  assert(privateList.ok === true, "private list should succeed");
  assert(privateList.files.includes("PRIVATE/Secret Omega.md"), "private unrestricted list should include PRIVATE notes");

  const privateRead = await post(port, localToken, { action: "read", path: "PRIVATE/Secret Omega.md", identity: privateIdentity });
  assert(privateRead.ok === true, "private read should succeed");
  assert(privateRead.note.content.includes("omega-private-token"), "private unrestricted read should return PRIVATE note content");

  console.log("AEON brain access E2E passed.");
  console.log(`- Public ${publicRepo}: restricted retrieval, no list/read/private leakage, scoped append verified.`);
  console.log(`- Private ${privateRepo}: unrestricted list/read verified against live GitHub visibility.`);
} finally {
  await terminateServer(server);
  await rmRetry(vaultRoot);
  await rmRetry(projectRoot);
}

function identity(repository, runId) {
  return {
    repository,
    eventName: "workflow_dispatch",
    ref: "refs/heads/main",
    actor: "hivemindos-e2e",
    runId,
    workflow: "AEON Brain E2E",
  };
}

async function post(port, localToken, body, expectedStatus = 200) {
  const response = await fetch(`http://127.0.0.1:${port}/api/runtimes/aeon/brain`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hive-aeon-local-token": localToken,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  assert(response.status === expectedStatus, `expected HTTP ${expectedStatus}, got ${response.status}: ${payload.error ?? ""}`);
  return payload;
}

async function waitForServer(port, localToken) {
  const deadline = Date.now() + 90_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      await post(port, localToken, { action: "policy", identity: identity(publicRepo, "wait") });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`Next dev server did not become ready on ${port}. Last error: ${lastError}\n${serverLog.slice(-2000)}`);
}

async function githubVisibility(repository, token) {
  const response = await fetch(`https://api.github.com/repos/${repository}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "hivemindos-aeon-brain-e2e",
    },
  });
  if (!response.ok) return "unknown";
  const payload = await response.json();
  return String(payload.visibility || (payload.private ? "private" : "public")).toLowerCase();
}

function readGitHubToken() {
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

async function freePort(start) {
  for (let port = start; port < start + 100; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free port found from ${start}.`);
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

function repoSlug(repo) {
  return repo.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown-repo";
}

async function terminateServer(server) {
  if (server.exitCode !== null || server.signalCode) return;
  if (server.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  } else {
    server.kill("SIGTERM");
  }
  const exited = await Promise.race([
    new Promise((resolve) => server.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (!exited && server.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function prepareIsolatedProject() {
  const sourceRoot = process.cwd();
  const targetRoot = await mkdtemp(join(tmpdir(), "hivemindos-aeon-project-"));
  execFileSync("rsync", [
    "-a",
    "--delete",
    "--exclude", ".git",
    "--exclude", ".next",
    "--exclude", "node_modules",
    "--exclude", ".env.local",
    "--exclude", ".env.local.meta.json",
    "--exclude", "tsconfig.tsbuildinfo",
    "./",
    `${targetRoot}/`,
  ], { cwd: sourceRoot, stdio: "ignore" });
  await symlink(join(sourceRoot, "node_modules"), join(targetRoot, "node_modules"), "dir");
  return targetRoot;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rmRetry(path) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}
