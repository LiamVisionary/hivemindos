// Boots the real collector in a sandbox HOME and proves client-supplied
// reserved Hermes profiles cannot expose their internal sessions through
// /snapshot. This is the path a stale persisted dashboard agent used to leak
// fleet-watchdog probes back into the chat tree.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // Collector is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("collector did not come up in time");
}

async function waitForChildExit(childProcess, timeoutMs) {
  if (childProcess.exitCode !== null) return true;
  return new Promise((resolve) => {
    const finish = (exited) => {
      clearTimeout(timer);
      childProcess.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    childProcess.once("exit", onExit);
    if (childProcess.exitCode !== null) finish(true);
  });
}

function seedHermesSession(profileDir) {
  const dbPath = join(profileDir, "state.db");
  const sql = `
    create table sessions (
      id text primary key,
      source text,
      started_at real,
      ended_at real,
      end_reason text,
      title text,
      message_count integer,
      tool_call_count integer
    );
    create table messages (
      id integer primary key,
      session_id text,
      role text,
      content text,
      tool_name text,
      timestamp real
    );
    insert into sessions values ('probe-session', 'state.db', 1783676705, 1783676711, 'completed', 'reply with the single word OK', 2, 0);
    insert into messages values (1, 'probe-session', 'user', 'reply with the single word OK', null, 1783676705);
    insert into messages values (2, 'probe-session', 'assistant', 'OK', null, 1783676711);
  `;
  const result = spawnSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
  assert.equal(result.status, 0, `could not seed Hermes state: ${result.stderr}`);
}

async function snapshotFor(baseUrl, agent) {
  const response = await fetch(`${baseUrl}/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

const sandbox = await mkdtemp(join(tmpdir(), "hive-reserved-snapshot-"));
const home = join(sandbox, "home");
const ordinaryProfileDir = join(home, ".hermes", "profiles", "emerson");
const reservedProfileDir = join(home, ".hermes", "profiles", "runtime-capability-probe");
let child;

try {
  await Promise.all([
    mkdir(ordinaryProfileDir, { recursive: true }),
    mkdir(reservedProfileDir, { recursive: true }),
  ]);
  seedHermesSession(ordinaryProfileDir);
  seedHermesSession(reservedProfileDir);

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const collectorPath = new URL("./agent-telemetry-collector.mjs", import.meta.url).pathname;
  child = spawn(process.execPath, [collectorPath], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      AGENT_TELEMETRY_PORT: String(port),
      AGENT_TELEMETRY_HOST: "127.0.0.1",
      HIVEMINDOS_MDNS_DISABLE: "1",
      AGENT_TELEMETRY_DISABLE_SELF_RELOAD: "1",
      AGENT_TELEMETRY_ENV_SYNC_DISABLED: "1",
      AGENT_TELEMETRY_CHAT_DISABLED: "1",
      HIVE_COLLECTOR_ONLY: "1",
      AGENT_TELEMETRY_HEALTH_CACHE_MS: "0",
      HIVEMINDOS_SYNC_PATH: join(sandbox, "vault"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  await waitForServer(baseUrl);

  const ordinary = await snapshotFor(baseUrl, {
    id: "hermes-emerson",
    name: "Emerson",
    runtime: "hermes",
    localDataDir: ordinaryProfileDir,
  });
  assert.equal(ordinary.snapshots.length, 1, `ordinary profile should remain readable (${stderr.slice(-300)})`);
  assert.equal(ordinary.snapshot?.tasks?.[0]?.title, "reply with the single word OK");

  const reserved = await snapshotFor(baseUrl, {
    id: "hermes-runtime-capability-probe",
    name: "Runtime Capability Probe",
    runtime: "hermes",
    localDataDir: reservedProfileDir,
  });
  assert.deepEqual(reserved.snapshots, [], "reserved profile snapshots must be omitted");
  assert.equal(reserved.snapshot, null, "a reserved-only snapshot request must not expose a primary snapshot");

  console.log("Collector omits client-supplied reserved Hermes profiles from /snapshot.");
} finally {
  if (child?.exitCode === null) {
    child.kill("SIGTERM");
    await waitForChildExit(child, 5_000);
  }
  if (child?.exitCode === null) {
    child.kill("SIGKILL");
    await waitForChildExit(child, 5_000);
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await rm(sandbox, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}
