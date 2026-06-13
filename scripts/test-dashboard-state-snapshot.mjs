import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Regression guard: a transient dashboard-state outage (restarting dev server,
// proxy 503) must never resolve the boot snapshot to {} — hydration seeds
// in-memory state from it and the next persist would overwrite the server's
// stored values, including the full chat history.

const sourcePath = new URL("../src/lib/services/dashboard-state-client.ts", import.meta.url);
const source = readFileSync(sourcePath, "utf8")
  .replace(/\bexport\s+/g, "")
  + "\n;globalThis.__dashboardStateTest = { loadDashboardStateSnapshot };";

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function freshLoader({ fetchImpl }) {
  const recordedDelays = [];
  const context = vm.createContext({
    URL,
    console: { warn: () => {} },
    fetch: fetchImpl,
    clearTimeout,
    // Instant timers: record the requested delay, fire on the next tick.
    setTimeout: (fn, delay) => {
      recordedDelays.push(delay);
      return setTimeout(fn, 0);
    },
  });
  vm.runInContext(compiled, context, { filename: "dashboard-state-client.ts" });
  return { loadDashboardStateSnapshot: context.__dashboardStateTest.loadDashboardStateSnapshot, recordedDelays };
}

// 1. Outage then recovery: retries through failures, returns real values, caches.
{
  let attempts = 0;
  const { loadDashboardStateSnapshot, recordedDelays } = freshLoader({
    fetchImpl: async () => {
      attempts += 1;
      if (attempts <= 2) throw new TypeError("fetch failed");
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, values: { "hivemindos.chatMessages.v1": "{}" } }),
      };
    },
  });
  const snapshot = await loadDashboardStateSnapshot();
  assert.equal(attempts, 3, "loader must retry through transient outages");
  assert.equal(snapshot["hivemindos.chatMessages.v1"], "{}", "loader must return server values after recovery");
  assert.deepEqual([...recordedDelays], [1000, 2000], "loader must back off between retries");
  await loadDashboardStateSnapshot();
  assert.equal(attempts, 3, "a successful snapshot must be cached");
}

// 2. A 5xx (dev proxy 503) is an outage, not an answer: must retry.
{
  let attempts = 0;
  const { loadDashboardStateSnapshot } = freshLoader({
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return { ok: false, status: 503, json: async () => ({ ok: false, error: "DEV_PROXY_UNAVAILABLE" }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, values: {} }) };
    },
  });
  await loadDashboardStateSnapshot();
  assert.equal(attempts, 2, "a 503 must be retried, not treated as an empty snapshot");
}

// 3. Auth denied is not a dashboard state snapshot: it must not boot empty.
{
  let attempts = 0;
  const { loadDashboardStateSnapshot } = freshLoader({
    fetchImpl: async () => {
      attempts += 1;
      return { ok: false, status: 401, json: async () => ({ ok: false, error: "auth required" }) };
    },
  });
  await assert.rejects(
    loadDashboardStateSnapshot(),
    { name: "DashboardStateAuthError" },
    "auth-denied must throw instead of resolving an empty snapshot",
  );
  assert.equal(attempts, 1, "auth-denied must not retry as an outage");
}

// 4. A legitimate empty server store is still a successful snapshot and caches.
{
  let attempts = 0;
  const { loadDashboardStateSnapshot } = freshLoader({
    fetchImpl: async () => {
      attempts += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true, values: {} }) };
    },
  });
  const empty = await loadDashboardStateSnapshot();
  assert.deepEqual({ ...empty }, {}, "an authenticated empty store remains a valid snapshot");
  assert.equal(attempts, 1, "the empty store should load once");
  await loadDashboardStateSnapshot();
  assert.equal(attempts, 1, "a successful empty snapshot must be cached");
}

console.log("Snapshot loader retries outages, treats 503 as an outage, rejects auth-denied boot, and accepts authenticated empty stores.");
