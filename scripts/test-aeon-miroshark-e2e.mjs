#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

const vaultRoot = process.env.HIVE_AEON_MIROSHARK_E2E_VAULT || "/Users/liam/Documents/Obsidian/hivemindos-vault";
const aeonRepoUrl = process.env.HIVE_AEON_MIROSHARK_E2E_REPO || "https://github.com/aaronjmars/aeon.git";
const aeonRepoIdentity = repoIdentity(aeonRepoUrl);
const projectRoot = await prepareIsolatedProject();
const workspaceRoot = await mkdtemp(join(tmpdir(), "hivemindos-aeon-workspace-"));
const aeonWorkspacePath = join(workspaceRoot, "aeon-miroshark-e2e");
const port = await freePort(5021);
const localToken = crypto.randomBytes(24).toString("hex");
const discoveredMiroSharkBaseUrl = await discoverMiroSharkBaseUrl();
const existingSimulationId = process.env.HIVE_AEON_MIROSHARK_E2E_SIMULATION_ID?.trim();
const scenario = `AEON MiroShark hivenet e2e ${new Date().toISOString()}: users debate whether HivemindOS should route AEON verdicts and MiroShark simulation artifacts into the shared vault.`;

const server = spawn("pnpm", ["dev", "--port", String(port)], {
  cwd: projectRoot,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
  env: {
    ...process.env,
    PORT: String(port),
    NEXT_PUBLIC_OBSIDIAN_VAULT_PATH: vaultRoot,
    HIVE_AEON_BRAIN_LOCAL_TOKEN: localToken,
    HIVE_AEON_HIVE_ALLOW_PUBLIC_REHEARSAL: "true",
    HIVE_AEON_BRAIN_VISIBILITY_CACHE_TTL_MS: "0",
    HIVE_LINK_CONTROL_URL: process.env.HIVE_LINK_CONTROL_URL || "http://127.0.0.1:8788",
    HIVEMIND_LINK_APP_PEERS: process.env.HIVEMIND_LINK_APP_PEERS || process.env.HIVE_AEON_MIROSHARK_E2E_PEERS || "",
    ...(discoveredMiroSharkBaseUrl ? {
      MIROSHARK_BASE_URL: discoveredMiroSharkBaseUrl,
      NEXT_PUBLIC_MIROSHARK_BASE_URL: discoveredMiroSharkBaseUrl,
    } : {}),
  },
});

let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });

try {
  await waitForServer(port);

  const status = await getJson(`http://127.0.0.1:${port}/api/miroshark/status?refresh=1`, 120_000);
  if (status.ok !== true) {
    const apps = await getJson(`http://127.0.0.1:${port}/api/fleet/apps?refresh=1`, 120_000).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    const discover = await getJson(`http://127.0.0.1:${port}/api/fleet/discover?includeSnapshots=0`, 120_000).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    throw new Error(`MiroShark should be discovered and connected.\nstatus=${JSON.stringify(status).slice(0, 1800)}\napps=${JSON.stringify(apps).slice(0, 1800)}\ndiscover=${JSON.stringify(discover).slice(0, 1800)}`);
  }
  assert(/app-proxy\/5101/.test(status.baseUrl) || /5101/.test(status.baseUrl), `MiroShark baseUrl should point at discovered 5101 service, got ${status.baseUrl}`);
  await assertMiroSharkApiReady(status.baseUrl);

  const clone = await postJson(`http://127.0.0.1:${port}/api/runtimes/aeon/workspaces`, {
    action: "clone",
    repoUrl: aeonRepoUrl,
    path: aeonWorkspacePath,
    name: "aeon-miroshark-e2e",
    cache: true,
  }, {}, 900_000);
  assert(clone.ok === true, `AEON clone route failed: ${JSON.stringify(clone).slice(0, 1200)}`);
  assert(clone.agent?.useSharedVault === true, "Cloned AEON agent should have shared brain injection enabled.");
  assert(clone.agent?.aeonLocalPath || clone.agent?.localDataDir, "Cloned AEON agent should include a local workspace path.");

  const identity = {
    repository: aeonRepoIdentity,
    eventName: "workflow_dispatch",
    ref: "refs/heads/main",
    actor: "hivemindos-e2e",
    runId: `aeon-miroshark-${Date.now()}`,
    workflow: "AEON MiroShark E2E",
  };
  const rehearsal = await postJson(`http://127.0.0.1:${port}/api/runtimes/aeon/hive/miroshark`, {
    action: "rehearse",
    identity,
    vaultPath: vaultRoot,
    scenario,
    ...(existingSimulationId ? { simulationId: existingSimulationId, startExisting: true } : {}),
    projectName: "AEON MiroShark Hivenet E2E",
    platform: "twitter",
    rounds: 1,
    waitForPosts: false,
    maxWaitMs: 0,
  }, {
    "x-hive-aeon-local-token": localToken,
  }, 900_000);
  assert(rehearsal.ok === true, `AEON MiroShark rehearsal failed: ${JSON.stringify(rehearsal).slice(0, 1800)}`);
  assert(rehearsal.summary?.folder, "Rehearsal response should include the vault archive folder.");
  assert(rehearsal.verdict?.markdownPath, "Rehearsal response should include AEON verdict markdown path.");

  const runFolder = join(vaultRoot, "Projects", "HivemindOS", "MiroShark Simulations", rehearsal.summary.folder);
  const runMd = await readFile(join(runFolder, "run.md"), "utf8");
  const verdictMd = await readFile(join(runFolder, "aeon-rehearsal.md"), "utf8");
  assert(runMd.includes(String(rehearsal.summary.simulationId)), "MiroShark run.md should include the simulation id.");
  assert(verdictMd.includes("AEON MiroShark Rehearsal"), "AEON verdict markdown should be saved to the vault.");

  console.log("AEON MiroShark E2E passed.");
  console.log(`- App server: http://127.0.0.1:${port}`);
  console.log(`- AEON clone root: ${clone.root}`);
  console.log(`- MiroShark base: ${status.baseUrl}`);
  console.log(`- Vault run: ${join(runFolder, "run.md")}`);
  console.log(`- Vault verdict: ${join(runFolder, "aeon-rehearsal.md")}`);
} finally {
  await terminateServer(server);
  await rmRetry(projectRoot);
  await rmRetry(workspaceRoot);
}

async function waitForServer(port) {
  const deadline = Date.now() + 120_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/miroshark/status`, { signal: AbortSignal.timeout(8_000) });
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(1_000);
  }
  throw new Error(`Next dev server did not become ready on ${port}. Last error: ${lastError}\n${serverLog.slice(-3000)}`);
}

async function getJson(url, timeoutMs) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const payload = await response.json().catch(() => ({}));
  assert(response.ok, `GET ${url} failed with HTTP ${response.status}: ${payload.error ?? ""}`);
  return payload;
}

async function assertMiroSharkApiReady(baseUrl) {
  const templatesUrl = `${baseUrl.replace(/\/+$/, "")}/api/templates/list`;
  const response = await fetch(templatesUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  assert(
    response.ok && payload?.error !== "Service not configured - missing internal key",
    `MiroShark API is not ready at ${templatesUrl}. HTTP ${response.status}: ${payload.error ?? JSON.stringify(payload).slice(0, 800)}`,
  );
}

async function postJson(url, body, headers = {}, timeoutMs = 120_000) {
  const { statusCode, payload } = await postJsonViaHttp(url, body, headers, timeoutMs);
  assert(statusCode >= 200 && statusCode < 300, `POST ${url} failed with HTTP ${statusCode}: ${payload.error ?? ""}`);
  return payload;
}

function postJsonViaHttp(url, body, headers = {}, timeoutMs = 120_000) {
  const target = new URL(url);
  const data = JSON.stringify(body);
  const client = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(data),
        ...headers,
      },
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        let payload = {};
        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          payload = { error: raw.slice(0, 1200) };
        }
        resolve({ statusCode: response.statusCode || 0, payload });
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`POST ${url} timed out after ${timeoutMs}ms`));
    });
    request.on("error", reject);
    request.write(data);
    request.end();
  });
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

function repoIdentity(repoUrl) {
  return repoUrl
    .replace(/^git@github\.com:/, "")
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
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
  await delay(500);
}

async function prepareIsolatedProject() {
  const sourceRoot = process.cwd();
  const targetRoot = await mkdtemp(join(tmpdir(), "hivemindos-aeon-miroshark-project-"));
  execFileSync("rsync", [
    "-a",
    "--delete",
    "--exclude", ".git",
    "--exclude", ".next",
    "--exclude", ".next-tauri",
    "--exclude", "src-tauri/target",
    "--exclude", "src-tauri/resources/hivemindos-next",
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

async function discoverMiroSharkBaseUrl() {
  const linkBase = (process.env.HIVE_LINK_CONTROL_URL || "http://127.0.0.1:8788").replace(/\/+$/, "");
  for (const ip of tailscalePeerIps()) {
    for (const collectorPort of [8787, 8789, 8790, 8791, 8792]) {
      const peer = encodeURIComponent(`${ip}:${collectorPort}`);
      const appsUrl = `${linkBase}/peer/${peer}/apps?refresh=1`;
      const apps = await getJsonNoThrow(appsUrl, 10_000);
      for (const app of apps?.apps ?? []) {
        if (Number(app.port) !== 5101) continue;
        const baseUrl = `${linkBase}/peer/${peer}/app-proxy/5101`;
        const health = await getJsonNoThrow(`${baseUrl}/health`, 5_000);
        if (/miroshark/i.test(String(health?.service || "")) && health?.status === "ok") return baseUrl;
      }
    }
  }
  return "";
}

function tailscalePeerIps() {
  const explicitPeers = (process.env.HIVE_AEON_MIROSHARK_E2E_PEERS || "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d+\.\d+\.\d+\.\d+$/.test(value));
  if (explicitPeers.length > 0) return explicitPeers;

  for (const command of ["tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]) {
    try {
      const raw = execFileSync(command, ["status", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 });
      const status = JSON.parse(raw);
      return Object.values(status.Peer ?? {})
        .filter((peer) => peer?.Online)
        .flatMap((peer) => peer?.TailscaleIPs ?? [])
        .filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
    } catch {
      continue;
    }
  }
  return [];
}

async function getJsonNoThrow(url, timeoutMs) {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function rmRetry(path) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
