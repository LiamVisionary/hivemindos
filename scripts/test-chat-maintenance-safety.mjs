#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseCollectorRestartWindow, reserveCollectorRestartWindow } from "./lib/fleet-watchdog-local-collector.mjs";

const [
  collectorSource,
  collectorMaintenanceSource,
  collectorUpdateLauncherSource,
  collectorInstallerSource,
  fleetUpdateSource,
  autoUpdateSource,
  dashboardSource,
  messageThreadSource,
  chatCssSource,
] = await Promise.all([
  readFile(new URL("./agent-telemetry-collector.mjs", import.meta.url), "utf8"),
  readFile(new URL("./lib/collector-maintenance.mjs", import.meta.url), "utf8"),
  readFile(new URL("./lib/collector-update-launcher.mjs", import.meta.url), "utf8"),
  readFile(new URL("./install-telemetry-collector.sh", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/fleet/update/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/features/dashboard/hooks/use-fleet-auto-update.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/dashboard/DashboardApp.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/dashboard/views/chat/exchange/MessageThread.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/dashboard/views/chat/exchange/chat-exchange-errors.css", import.meta.url), "utf8"),
]);

assert.match(collectorSource, /activeCollectorChatRuns/, "collector tracks live chat processes");
assert.match(collectorSource, /\/maintenance\/reserve-update/, "collector exposes an atomic maintenance reservation");
assert.match(collectorMaintenanceSource, /active chat/i, "collector refuses maintenance around active chat work");
assert.match(collectorMaintenanceSource, /updateQueued/, "collector can reserve the next idle maintenance window");
assert.match(collectorMaintenanceSource, /releaseCollectorChatRun/, "collector releases chat activity when the runtime process exits");
assert.match(collectorSource, /skillInventoryCache/, "ordinary skill inventory polling uses a cache");
assert.match(collectorSource, /includeSourceFiles, force/, "source exports and explicit refreshes bypass stale summaries");
assert.match(collectorUpdateLauncherSource, /systemd-run/, "Linux updates leave the collector service cgroup");
assert.match(collectorUpdateLauncherSource, /--no-block/, "the collector does not hold the update request open");
assert.match(collectorSource, /\.hivemindos["), ]+["']logs/, "update logs live outside the disposable Next build directory");
assert.doesNotMatch(collectorSource, /\.next\/agent-update\.log/, "the build cannot delete its own update log");
assert.match(collectorInstallerSource, /reserve_collector_restart_window/, "direct setup reserves a safe collector restart window");
assert.match(collectorInstallerSource, /activeChatRunCount/, "direct setup waits for active chats to drain before restarting the collector");
assert.ok(
  collectorInstallerSource.indexOf("reserve_collector_restart_window")
    < collectorInstallerSource.indexOf('bootout "gui/$(id -u)/com.agent-control-room.telemetry"'),
  "the installer must reserve maintenance before stopping the collector",
);

assert.match(fleetUpdateSource, /reserveCollectorUpdate/, "fleet updates reserve collector maintenance before mutating a machine");
assert.match(fleetUpdateSource, /releaseCollectorUpdateReservation/, "failed update starts release their reservation");
assert.match(fleetUpdateSource, /maintenanceReservationToken/, "collector fallback carries the reservation token");

// A dirty-but-current checkout must be a no-op, not a reinstall. Agent work
// (chat App Builder projects under scratchpad/) dirties fleet checkouts, the
// update never deletes it, and each reinstall restarts the collector — killing
// app-preview children — so dirty-as-update-needed looped restarts forever
// (six on one box, 2026-07-18).
const updateNeededSource = fleetUpdateSource.match(
  /function updateNeededBefore[\s\S]*?\n\}/,
)?.[0];
assert.ok(updateNeededSource, "updateNeededBefore must exist in the fleet update route");
assert.doesNotMatch(
  updateNeededSource,
  /dirty/,
  "local changes alone must never trigger an update run — that loop restarts the collector and kills app previews without ever converging",
);
assert.match(
  fleetUpdateSource,
  /already-current[\s\S]*?up to date with local changes/i,
  "a dirty-but-current machine should report an explicit up-to-date-with-local-changes result",
);
const collectorVersionSource = await readFile(
  new URL("./lib/collector-source-version.mjs", import.meta.url),
  "utf8",
);
assert.match(
  collectorVersionSource,
  /dirty:\s*collectorCheckoutDirty\(/,
  "the collector /health dirty flag must exclude untracked agent droppings (scratchpad/)",
);
const rootGitignore = await readFile(
  new URL("../.gitignore", import.meta.url),
  "utf8",
);
assert.match(
  rootGitignore,
  /^scratchpad\/$/m,
  "chat App Builder scratchpad projects must be gitignored so fleet checkouts stop reporting dirty forever",
);

assert.match(autoUpdateSource, /activeAgentIds/, "automatic fleet updates receive the active-chat agent set");
assert.match(autoUpdateSource, /candidate\.agents\.some/, "automatic fleet updates skip a machine running an active chat");
assert.match(dashboardSource, /activeChatAgentIds/, "the dashboard supplies live chat activity to automatic updates");

assert.match(messageThreadSource, /There was an error/, "failed assistant messages render a clear error title");
assert.match(messageThreadSource, /Retry failed message/, "failed assistant messages expose an accessible retry action");
assert.match(messageThreadSource, /role="alert"/, "the error container is announced to assistive technology");
assert.match(chatCssSource, /\.fr-chat-error-card/, "the chat error container has dedicated styling");

const { createAsyncTtlCache } = await import("./lib/async-ttl-cache.mjs");
const { collectorUpdateLaunchSpec } = await import("./lib/collector-update-launcher.mjs");
const systemdLaunch = collectorUpdateLaunchSpec("do-update", {
  platform: "linux",
  pathExists: (candidate) => candidate === "/usr/bin/systemd-run",
  now: () => 123,
});
assert.equal(systemdLaunch.executable, "/usr/bin/systemd-run");
assert.deepEqual(systemdLaunch.args, [
  "--user",
  "--no-block",
  "--collect",
  "--unit=hivemindos-update-123",
  "sh",
  "-lc",
  "do-update",
]);
assert.equal(
  collectorUpdateLaunchSpec("do-update", { platform: "darwin" }).launcher,
  "detached-process",
);
let cacheLoadCount = 0;
const inventoryCache = createAsyncTtlCache({
  ttlMs: 60_000,
  load: async () => ({ generation: ++cacheLoadCount }),
});
const [firstInventory, concurrentInventory] = await Promise.all([
  inventoryCache.get(),
  inventoryCache.get(),
]);
assert.equal(cacheLoadCount, 1, "concurrent skill polls share one filesystem scan");
assert.equal(firstInventory, concurrentInventory);
assert.equal((await inventoryCache.get()).generation, 1, "fresh summary inventory is reused");
assert.equal((await inventoryCache.get({ force: true })).generation, 2, "explicit refresh bypasses the TTL");
inventoryCache.invalidate();
assert.equal((await inventoryCache.get()).generation, 3, "inventory invalidation forces a fresh scan");

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
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

const sandbox = await mkdtemp(join(tmpdir(), "hive-chat-maintenance-"));
const fakeHermes = join(sandbox, "fake-hermes");
await writeFile(fakeHermes, `#!/bin/sh\necho $$ > "${fakeHermes}.pid"\nexec sleep 120\n`);
await chmod(fakeHermes, 0o755);
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const collector = spawn(process.execPath, [new URL("./agent-telemetry-collector.mjs", import.meta.url).pathname], {
  env: {
    ...process.env,
    HOME: join(sandbox, "home"),
    USERPROFILE: join(sandbox, "home"),
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

  const chatAbort = new AbortController();
  const chatRequest = fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stream: false, message: "hold maintenance open" }),
    signal: chatAbort.signal,
  }).catch(() => null);
  await waitFor(
    () => readFile(`${fakeHermes}.pid`, "utf8").then(Boolean, () => false),
    "fake Hermes did not start",
  );

  const activeChatRestart = await reserveCollectorRestartWindow(baseUrl);
  assert.deepEqual(
    activeChatRestart,
    { deferRestart: true, activeChatRunCount: 1 },
    "the watchdog must not reserve a restart while chat work is active",
  );

  const maintenanceRequestId = "test-maintenance-request";
  const queuedReservation = await fetch(`${baseUrl}/maintenance/reserve-update`, {
    method: "POST",
    headers: { "x-hivemind-maintenance-request-id": maintenanceRequestId },
  });
  const queuedPayload = await queuedReservation.json();
  assert.equal(queuedReservation.status, 202, "maintenance should reserve the next safe window");
  assert.equal(queuedPayload.activeChatRunCount, 1);
  assert.equal(queuedPayload.updateQueued, true);
  assert.ok(queuedPayload.reservationToken);

  const blockedChat = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stream: false, message: "must wait" }),
  });
  assert.equal(blockedChat.status, 503, "new chats must wait once maintenance is queued");

  chatAbort.abort();
  await chatRequest;
  await waitFor(
    () => fetch(`${baseUrl}/maintenance/readiness`)
      .then((response) => response.json())
      .then((payload) => payload.activeChatRunCount === 0 && payload.updateStarting === true, () => false),
    "collector did not release the completed chat run",
  );

  const reservationResponse = await fetch(`${baseUrl}/maintenance/reserve-update`, {
    method: "POST",
    headers: { "x-hivemind-maintenance-request-id": maintenanceRequestId },
  });
  const reservationPayload = await reservationResponse.json();
  assert.equal(reservationResponse.status, 200);
  assert.equal(reservationPayload.updateQueued, false);
  assert.equal(reservationPayload.reservationToken, queuedPayload.reservationToken);

  const competingReservation = await fetch(`${baseUrl}/maintenance/reserve-update`, {
    method: "POST",
    headers: { "x-hivemind-maintenance-request-id": "different-request" },
  });
  assert.equal(competingReservation.status, 409, "another updater cannot steal the reservation");

  const releaseResponse = await fetch(`${baseUrl}/maintenance/reserve-update`, {
    method: "DELETE",
    headers: {
      "x-hivemind-maintenance-reservation": queuedPayload.reservationToken,
    },
  });
  assert.equal(releaseResponse.status, 200);

  const idleRestart = await reserveCollectorRestartWindow(baseUrl);
  assert.equal(idleRestart.deferRestart, false);
  assert.equal(idleRestart.activeChatRunCount, 0);
  assert.ok(idleRestart.reservationToken, "an idle collector should grant an atomic restart window");
  assert.equal(
    await releaseCollectorRestartWindow(baseUrl, idleRestart.reservationToken),
    true,
    "a failed restart can release its maintenance reservation",
  );
} finally {
  if (!collector.killed) collector.kill("SIGTERM");
  await rm(sandbox, { recursive: true, force: true });
}

console.log("chat maintenance safety tests passed");
