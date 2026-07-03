// Verifies the collector kills the spawned hermes CLI when the /chat caller
// disconnects (stream:false path). Queen-bee delegates abort at 240s while the
// collector chat timeout is 20 minutes; before the abort wiring every
// abandoned `hermes -z` kept running as a zombie worker (the 2026-07-03
// hel1-2 pile-up amplifier). Also proves AGENT_TELEMETRY_CHAT_ABORT_KILL=0
// restores the old detached behavior.
//
// Hermetic: sandbox HOME, free loopback ports, HERMES_BIN pointed at a fake
// script that records its PID and sleeps.
//
// Run: node scripts/test-collector-chat-abort.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(base, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`collector at ${base} did not come up in time`);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check, ms, message) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(message);
}

const sandbox = await mkdtemp(join(tmpdir(), "hive-chat-abort-"));
const collectors = [];
const strayPids = [];

// The fake hermes records its PID next to itself, then `exec sleep` so the
// recorded PID is the exact process execFile owns (and kills).
async function makeFakeHermes(name) {
  const path = join(sandbox, name);
  await writeFile(path, `#!/bin/sh\necho $$ > "$0.pid"\nexec sleep 120\n`);
  await chmod(path, 0o755);
  return path;
}

async function bootCollector(hermesBin, extraEnv = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const collectorPath = new URL("./agent-telemetry-collector.mjs", import.meta.url).pathname;
  const child = spawn(process.execPath, [collectorPath], {
    env: {
      ...process.env,
      HOME: join(sandbox, "home"),
      USERPROFILE: join(sandbox, "home"),
      HERMES_BIN: hermesBin,
      AGENT_TELEMETRY_PORT: String(port),
      AGENT_TELEMETRY_HOST: "127.0.0.1",
      AGENT_TELEMETRY_CHAT_TIMEOUT_MS: "30000",
      HIVEMINDOS_MDNS_DISABLE: "1",
      AGENT_TELEMETRY_DISABLE_SELF_RELOAD: "1",
      AGENT_TELEMETRY_ENV_SYNC_DISABLED: "1",
      HIVE_COLLECTOR_ONLY: "1",
      HIVEMINDOS_SYNC_PATH: join(sandbox, "vault"),
      ...extraEnv,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  collectors.push(child);
  await waitForServer(base);
  return base;
}

// Fire a non-streaming /chat and abort it client-side, mirroring queen-bee's
// AbortSignal.timeout delegate wiring. Returns the fake hermes PID.
async function abortedChat(base, fakeBin, abortAfterMs) {
  const request = fetch(`${base}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stream: false, message: "abort wiring test" }),
    signal: AbortSignal.timeout(abortAfterMs),
  }).then(
    () => {
      throw new Error("chat unexpectedly completed before the client abort");
    },
    () => undefined,
  );
  const pid = await waitFor(
    () => readFile(`${fakeBin}.pid`, "utf8").then((t) => Number(t.trim()) || 0, () => 0),
    5000,
    "fake hermes never started (no pidfile)",
  );
  assert.ok(pidAlive(pid), "fake hermes should be running before the abort");
  await request;
  return pid;
}

try {
  const fakeKill = await makeFakeHermes("fake-hermes-kill");
  const fakeDetach = await makeFakeHermes("fake-hermes-detach");
  const [killBase, detachBase] = await Promise.all([
    bootCollector(fakeKill),
    bootCollector(fakeDetach, { AGENT_TELEMETRY_CHAT_ABORT_KILL: "0" }),
  ]);

  await Promise.all([
    // --- 1. Default: client abort SIGTERMs the hermes child ---
    (async () => {
      const pid = await abortedChat(killBase, fakeKill, 1500);
      await waitFor(
        () => !pidAlive(pid),
        5000,
        `hermes child ${pid} survived the client abort (zombie worker)`,
      );
      console.log("✓ client abort kills the spawned hermes CLI");
    })(),
    // --- 2. Kill-switch: AGENT_TELEMETRY_CHAT_ABORT_KILL=0 detaches again ---
    (async () => {
      const pid = await abortedChat(detachBase, fakeDetach, 1500);
      strayPids.push(pid);
      await new Promise((r) => setTimeout(r, 2000));
      assert.ok(
        pidAlive(pid),
        "with AGENT_TELEMETRY_CHAT_ABORT_KILL=0 the hermes child must outlive the abort",
      );
      console.log("✓ AGENT_TELEMETRY_CHAT_ABORT_KILL=0 keeps the old detached behavior");
    })(),
  ]);

  console.log("\nCollector chat abort wiring test passed.");
} finally {
  for (const pid of strayPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  for (const child of collectors) {
    if (!child.killed) child.kill("SIGTERM");
  }
  await rm(sandbox, { recursive: true, force: true });
}
