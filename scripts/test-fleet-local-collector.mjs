import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const dashboardUrl = process.env.DASHBOARD_URL || "http://127.0.0.1:5020";
const collectorUrl = process.env.COLLECTOR_URL || "http://127.0.0.1:8787";

// Dashboard /api routes 401 tokenless since the API auth gate moved to
// src/proxy.ts (same resolution order as scripts/fleet-health-watchdog.mjs).
// The collector /health probe stays tokenless — the token is dashboard-only.
function envFileValue(path, key) {
  if (!existsSync(path)) return "";
  const match = readFileSync(path, "utf8").match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.+)\\s*$`, "m"));
  let value = match?.[1]?.trim() ?? "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return value.trim();
}

const deviceToken = (
  process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || envFileValue(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN")
  || envFileValue(join(homedir(), ".hivemindos", ".env"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN")
).trim();

async function readJson(url, timeoutMs = 10_000, headers = undefined) {
  const response = await fetch(url, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  assert.equal(response.ok, true, `${url} returned ${response.status} ${response.statusText}`);
  return response.json();
}

const dashboardHeaders = deviceToken ? { "x-hivemindos-device-token": deviceToken } : undefined;

const collectorHealth = await readJson(`${collectorUrl}/health`, 3_000);
assert.equal(collectorHealth.ok, true, "Local collector health should be ok");

const tailscaleDevices = await readJson(`${dashboardUrl}/api/tailscale/devices`, 5_000, dashboardHeaders);
const selfDevice = tailscaleDevices.devices?.find((device) => device.self);
assert.ok(selfDevice, "Tailscale device discovery should include a self device");
assert.equal(
  selfDevice.collectorUrl,
  collectorUrl,
  "The self Tailscale device must use localhost for collector checks",
);

const startedAt = performance.now();
const fleetDiscovery = await readJson(`${dashboardUrl}/api/fleet/discover`, 12_000, dashboardHeaders);
const elapsedMs = performance.now() - startedAt;
const selfMachine = fleetDiscovery.machines?.find((machine) => machine.device?.self);

assert.ok(selfMachine, "Fleet discovery should include this machine");
assert.equal(
  selfMachine.device.collectorUrl,
  collectorUrl,
  "Fleet discovery must use localhost for this machine's collector",
);
assert.equal(selfMachine.collector, "ready", "This Mac should be ready when local collector health is ok");
assert.ok(
  elapsedMs < 8_000,
  `Fleet discovery should not hang on unreachable peers; took ${Math.round(elapsedMs)}ms`,
);

console.log(`Fleet local collector e2e passed in ${Math.round(elapsedMs)}ms.`);
