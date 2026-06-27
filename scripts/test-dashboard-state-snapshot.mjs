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
  // Strip TS imports: the vm has no module resolver. The only runtime dependency
  // on the HTTP path is isTauriDesktopRuntime, which we mock in the context.
  .replace(/^\s*import\b.*$/gm, "")
  .replace(/\bexport\s+/g, "")
  + "\n;globalThis.__dashboardStateTest = { loadDashboardStateSnapshot, DashboardStateAuthError };";

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
    // Force the HTTP path under test; the native desktop branch is unrelated.
    isTauriDesktopRuntime: () => false,
    // Instant timers: record the requested delay, fire on the next tick.
    setTimeout: (fn, delay) => {
      recordedDelays.push(delay);
      return setTimeout(fn, 0);
    },
  });
  vm.runInContext(compiled, context, { filename: "dashboard-state-client.ts" });
  return {
    loadDashboardStateSnapshot: context.__dashboardStateTest.loadDashboardStateSnapshot,
    DashboardStateAuthError: context.__dashboardStateTest.DashboardStateAuthError,
    recordedDelays,
  };
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

// 3. Auth denial (401) is NOT an empty dashboard: it must surface to the unlock
//    flow, never resolve {} (which would hydrate a fake-empty UI), and not retry.
{
  let attempts = 0;
  const { loadDashboardStateSnapshot, DashboardStateAuthError } = freshLoader({
    fetchImpl: async () => {
      attempts += 1;
      return { ok: false, status: 401, json: async () => ({ ok: false, error: "auth required" }) };
    },
  });
  // No window in the vm (server/SSR path) so the redirect surfaces as an error.
  await assert.rejects(
    loadDashboardStateSnapshot(),
    (err) => err instanceof DashboardStateAuthError,
    "a 401 must raise DashboardStateAuthError instead of resolving {}",
  );
  assert.equal(attempts, 1, "auth denial is definitive: it must not retry");
}

// 4. A legitimately empty store (200 ok, values {}) resolves {} and is cached —
//    this must stay distinct from the auth-denied path above.
{
  let attempts = 0;
  const { loadDashboardStateSnapshot } = freshLoader({
    fetchImpl: async () => {
      attempts += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true, values: {} }) };
    },
  });
  const empty = await loadDashboardStateSnapshot();
  assert.deepEqual({ ...empty }, {}, "an empty store must resolve {}");
  await loadDashboardStateSnapshot();
  assert.equal(attempts, 1, "a real (non-auth) snapshot must be cached");
}

console.log("Snapshot loader retries outages instead of booting empty, treats 503 as an outage, redirects auth denial to unlock, and caches a real empty store.");
