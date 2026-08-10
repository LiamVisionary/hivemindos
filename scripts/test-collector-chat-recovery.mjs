#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { recoverCollectorChatAfterFetchFailure } = await import(
  "../src/app/api/chat/agent-runtime/collector-chat-recovery.ts"
);
const { streamHttpRuntime } = await import(
  "../src/app/api/chat/agent-runtime/stream-http-runtime.ts"
);

const profile = {
  id: "recovery-hermes",
  name: "Recovery Hermes",
  runtime: "hermes",
  telemetryUrl: "http://127.0.0.1:8787",
};

{
  const result = await recoverCollectorChatAfterFetchFailure({
    profile,
    chatUrl: "http://127.0.0.1:8787/chat",
    runtimeSessionId: "dashboard-run",
    rawUserMessage: "recover me",
    fetchStartedAt: 1_000,
    fetchImpl: async (url) => String(url).endsWith("/health")
      ? Response.json({ ok: true })
      : Response.json({
          ok: true,
          recovered: true,
          session: { sessionId: "20260808_211500_recovered", runtime: "hermes" },
        }),
  });
  assert.equal(result.kind, "recovered");
  const reader = result.response.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /agent_bridge\.recovered/);
  await assert.rejects(() => reader.read(), /terminated/);
  assert.equal(result.sessionId, "20260808_211500_recovered");
}

{
  const result = await recoverCollectorChatAfterFetchFailure({
    profile,
    chatUrl: "http://127.0.0.1:8787/chat",
    runtimeSessionId: "dashboard-run",
    rawUserMessage: "retry me",
    fetchStartedAt: 1_000,
    fetchImpl: async (url) => String(url).endsWith("/health")
      ? Response.json({ ok: true })
      : Response.json({ ok: true, recovered: false, active: false, safeToRetry: true }),
  });
  assert.equal(result.kind, "retry");
}

{
  const originalFetch = globalThis.fetch;
  let chatAttempts = 0;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.endsWith("/health")) return Response.json({ ok: true });
    if (href.endsWith("/chat/recover")) {
      return Response.json({ ok: true, recovered: false, active: false, safeToRetry: true });
    }
    if (href.endsWith("/chat")) {
      chatAttempts += 1;
      if (chatAttempts === 1) throw new TypeError("fetch failed");
      return Response.json({ choices: [{ message: { content: "retry succeeded" } }] });
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  try {
    const response = await streamHttpRuntime(
      { ...profile, gatewayUrl: "http://127.0.0.1:8787", chatPath: "/chat" },
      [{ role: "user", content: "retry me" }],
      "retry me",
      null,
      "act",
    );
    assert.equal(response.status, 200);
    assert.match(await response.text(), /retry succeeded/);
    assert.equal(chatAttempts, 2, "the bridge request should retry exactly once after recovery confirms it is safe");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(check, message, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

const sandbox = await mkdtemp(join(tmpdir(), "hive-chat-recovery-"));
const home = join(sandbox, "home");
const hermesHome = join(home, ".hermes");
const fakeHermes = join(sandbox, "fake-hermes");
await mkdir(hermesHome, { recursive: true });
await writeFile(fakeHermes, "#!/bin/sh\nexec sleep 120\n");
await chmod(fakeHermes, 0o755);
const nowSeconds = Math.floor(Date.now() / 1000);
execFileSync("sqlite3", [join(hermesHome, "state.db"), `
create table sessions (id text primary key, source text, started_at real, ended_at real, end_reason text, title text, message_count integer, tool_call_count integer);
create table messages (id integer primary key autoincrement, session_id text, role text, content text, tool_name text, timestamp real);
insert into sessions values ('20260808_211500_recovered', 'hivemindos', ${nowSeconds}, null, null, 'Recovery', 1, 0);
insert into messages (session_id, role, content, timestamp) values ('20260808_211500_recovered', 'user', 'recover exact collector turn', ${nowSeconds});
`]);

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const collector = spawn(process.execPath, [new URL("./agent-telemetry-collector.mjs", import.meta.url).pathname], {
  env: {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HERMES_HOME: hermesHome,
    HERMES_BIN: fakeHermes,
    AGENT_TELEMETRY_PORT: String(port),
    AGENT_TELEMETRY_HOST: "127.0.0.1",
    AGENT_TELEMETRY_CHAT_TIMEOUT_MS: "30000",
    HIVEMINDOS_MDNS_DISABLE: "1",
    AGENT_TELEMETRY_DISABLE_SELF_RELOAD: "1",
    AGENT_TELEMETRY_ENV_SYNC_DISABLED: "1",
    HIVE_COLLECTOR_ONLY: "1",
    HIVEMINDOS_SYNC_PATH: join(sandbox, "vault"),
  },
  stdio: ["ignore", "ignore", "pipe"],
});

try {
  await waitFor(
    () => fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) })
      .then((response) => response.ok, () => false),
    "collector did not start",
  );

  const recovered = await fetch(`${baseUrl}/chat/recover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rawUserMessage: "recover exact collector turn", sinceMs: Date.now() - 5_000 }),
  }).then((response) => response.json());
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.session.sessionId, "20260808_211500_recovered");
  assert.equal(recovered.safeToRetry, false);

  const missing = await fetch(`${baseUrl}/chat/recover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rawUserMessage: "this turn never started", sinceMs: Date.now() - 5_000 }),
  }).then((response) => response.json());
  assert.equal(missing.recovered, false);
  assert.equal(missing.safeToRetry, true);
} finally {
  if (!collector.killed) collector.kill("SIGTERM");
  await rm(sandbox, { recursive: true, force: true });
}

console.log("collector chat recovery tests passed");
