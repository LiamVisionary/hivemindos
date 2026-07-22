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

async function makeNoisyStreamingHermes(name) {
  const path = join(sandbox, name);
  await writeFile(path, `#!/bin/sh
mkdir -p "$HERMES_HOME"
sqlite3 "$HERMES_HOME/state.db" "create table if not exists sessions (id text primary key, source text not null, started_at real not null, ended_at real, end_reason text, title text, message_count integer default 0, tool_call_count integer default 0); create table if not exists messages (id integer primary key autoincrement, session_id text not null, role text not null, content text, tool_name text, timestamp real not null); insert into sessions (id,source,started_at,message_count) values ('20260718_203500_deadbe','hivemindos',strftime('%s','now'),1); insert into messages (session_id,role,content,timestamp) values ('20260718_203500_deadbe','user','output contract test',strftime('%s','now'));"
printf '  ┊ review diff\\na/index.html → b/index.html\\n@@ -1 +1 @@\\n-old\\n+new\\n'
printf '%s\\n' '__HIVEMIND_HERMES_EVENT__{"type":"assistant.delta","delta":"I am checking the scaffold."}'
sleep 0.3
printf '%s\\n' '__HIVEMIND_HERMES_EVENT__{"type":"assistant.segment_end"}'
printf '%s\\n' '__HIVEMIND_HERMES_EVENT__{"type":"tool.started","name":"write_file","status":"running"}'
sleep 0.3
printf '%s\\n' '__HIVEMIND_HERMES_EVENT__{"type":"tool.completed","name":"write_file","status":"completed"}'
printf '%s\\n' '__HIVEMIND_HERMES_EVENT__{"type":"assistant.delta","delta":"## Build complete\\n\\n"}'
sleep 0.3
printf '%s\\n' '__HIVEMIND_HERMES_EVENT__{"type":"assistant.delta","delta":"Done from canonical Hermes session."}'
sqlite3 "$HERMES_HOME/state.db" "insert into messages (session_id,role,content,timestamp) values ('20260718_203500_deadbe','assistant','## Build complete\n\nDone from canonical Hermes session.',strftime('%s','now')); update sessions set message_count=2 where id='20260718_203500_deadbe';"
printf 'Done from noisy unmarked stdout.\\n'
printf 'session_id: 20260718_203500_deadbe\\n' >&2
`);
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

async function assertStreamingChatOutput(base) {
  const response = await fetch(`${base}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stream: true,
      forceHermesCli: true,
      message: "output contract test",
      rawUserMessage: "output contract test",
      agent: { id: "quiet-output-test", runtime: "hermes" },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let streamText = "";
  let interimAt = 0;
  let finalAt = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    streamText += decoder.decode(value, { stream: true });
    if (!interimAt && streamText.includes("I am checking the scaffold.")) interimAt = Date.now();
    if (!finalAt && streamText.includes("Done from canonical Hermes session.")) finalAt = Date.now();
  }
  assert.match(streamText, /20260718_203500_deadbe/, "collector should surface the pollable Hermes session id");
  assert.ok(interimAt > 0 && finalAt > interimAt, "interim assistant text must arrive before the delayed final response");
  assert.match(streamText, /assistant\.reset/, "a later Hermes response segment should replace interim narration");
  assert.match(streamText, /tool\.started/, "Hermes tool lifecycle should stream as process data");
  assert.match(streamText, /Done from canonical Hermes session\./, "collector should emit the canonical final assistant message");
  assert.doesNotMatch(streamText, /review diff|a\/index\.html|Done from noisy unmarked stdout/, "unmarked CLI terminal output must not become assistant chat text");
}

try {
  const fakeKill = await makeFakeHermes("fake-hermes-kill");
  const fakeDetach = await makeFakeHermes("fake-hermes-detach");
  const fakeNoisyStreaming = await makeNoisyStreamingHermes("fake-hermes-noisy-streaming");
  const [killBase, detachBase, quietBase] = await Promise.all([
    bootCollector(fakeKill),
    bootCollector(fakeDetach, { AGENT_TELEMETRY_CHAT_ABORT_KILL: "0" }),
    bootCollector(fakeNoisyStreaming),
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
    (async () => {
      await assertStreamingChatOutput(quietBase);
      console.log("✓ structured Hermes deltas stream while terminal diff output stays out of chat");
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
