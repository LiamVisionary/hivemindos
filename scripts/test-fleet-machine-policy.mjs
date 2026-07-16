#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";
import {
  FleetMachinePolicyError,
  claimFleetPolicyMaster,
  defaultFleetMachinePolicy,
  effectiveFleetAccess,
  fleetMachinePolicyFailureSummary,
  fleetMachinePolicyPrompt,
  fleetPolicyRuntimeFlags,
  readFleetMachinePolicy,
  releaseFleetPolicyMaster,
  resolveFleetAccessRequest,
  updateFleetMachinePolicy,
} from "./lib/fleet-machine-policy.mjs";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const { resolveFleetMachineAccessAnswer } = await import(
  "../src/lib/services/fleet/machine-access-approval.ts"
);
const { parseFleetMachineAccessRequest } = await import(
  "../src/lib/types/fleet-machine-policy.ts"
);

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

async function waitForCollector(baseUrl, stderr) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Collector startup is asynchronous.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Collector did not start. ${stderr()}`);
}

const sandbox = await mkdtemp(join(tmpdir(), "hive-machine-policy-"));
const policyPath = join(sandbox, "policy.json");
const master = { id: "tailnet-node:main-hub", label: "Main Hub" };
const secondary = { id: "tailnet-node:secondary-hub", label: "Secondary Hub" };

let collector;
try {
  const initial = defaultFleetMachinePolicy({ machineId: "gpu-box", now: 1_000 });
  assert.equal(initial.authority, null);
  assert.ok(Object.values(initial.access).every((decision) => decision === "ask"));

  const claimed = await claimFleetPolicyMaster({
    caller: master,
    filePath: policyPath,
    machineId: "gpu-box",
    now: 2_000,
  });
  assert.equal(claimed.authority?.masterHubId, master.id);

  await assert.rejects(
    updateFleetMachinePolicy({ caller: secondary, filePath: policyPath, access: { sharedBrain: "allow" } }),
    (error) => error instanceof FleetMachinePolicyError && error.status === 403,
  );

  const updated = await updateFleetMachinePolicy({
    caller: master,
    filePath: policyPath,
    machineId: "gpu-box",
    access: { ...claimed.access, sharedBrain: "allow", sharedEnv: "deny" },
    performance: { enabled: true, ignore: false, maxCpuPct: 72, maxRamPct: 81, maxDiskPct: 93 },
    now: 3_000,
  });
  assert.equal(updated.access.sharedBrain, "allow");
  assert.equal(updated.access.sharedEnv, "deny");
  assert.equal(updated.performance.maxCpuPct, 72);

  const temporarilyAllowed = await resolveFleetAccessRequest({
    caller: master,
    capability: "connectedApps",
    decision: "allow-temporary",
    filePath: policyPath,
    machineId: "gpu-box",
    now: 4_000,
  });
  assert.equal(effectiveFleetAccess(temporarilyAllowed, 4_001).connectedApps, "allow");
  assert.equal(effectiveFleetAccess(temporarilyAllowed, 4_000 + 15 * 60_000 + 1).connectedApps, "ask");

  const prompt = fleetMachinePolicyPrompt(temporarilyAllowed, 4_001);
  assert.match(prompt, /Treat ASK as DENY/);
  assert.match(prompt, /^FLEET ACCESS REQUEST: <capability>$/m);
  assert.match(prompt, /^OPTIONS: Allow 15 min \| Always allow \| Deny$/m);
  assert.equal(fleetPolicyRuntimeFlags(temporarilyAllowed, 4_001).HIVEMINDOS_SHARED_ENV_ACCESS, "deny");
  assert.deepEqual(parseFleetMachineAccessRequest("FLEET ACCESS REQUEST: sharedBrain"), {
    requested: true,
    capability: "sharedBrain",
    rawCapability: "sharedBrain",
  });
  const needsHumanControllerSource = await readFile(
    new URL("../src/features/dashboard/hooks/use-kanban-needs-human-controller.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    needsHumanControllerSource,
    /!fleetAccessRequest\s*&&\s*task\.id === selectedKanbanTask\?\.id/,
    "Fleet access answers must bypass live steering and use the collector-first durable answer route",
  );

  let capturedRequest;
  const approval = await resolveFleetMachineAccessAnswer({
    result: [
      "ACTION NEEDED: Approve or deny this machine access before I continue.",
      "FLEET ACCESS REQUEST: sharedBrain",
      "OPTIONS: Allow 15 min | Always allow | Deny",
    ].join("\n"),
    targetMachine: { key: "gpu-box", name: "GPU Box", collectorUrl: "http://127.0.0.1:8787" },
  }, "Allow 15 min", async (url, init) => {
    capturedRequest = { url: String(url), body: JSON.parse(String(init?.body || "{}")) };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  assert.equal(approval.handled, true);
  assert.deepEqual(capturedRequest, {
    url: "http://127.0.0.1:8787/fleet-policy",
    body: { action: "resolve-access", capability: "sharedBrain", decision: "allow-temporary" },
  });
  await assert.rejects(
    resolveFleetMachineAccessAnswer({
      result: "FLEET ACCESS REQUEST: sharedEnv",
      targetMachine: { key: "gpu-box", name: "GPU Box", collectorUrl: "http://127.0.0.1:8787" },
    }, "maybe later"),
    /Choose Allow 15 min, Always allow, or Deny/,
  );

  const released = await releaseFleetPolicyMaster({ caller: master, filePath: policyPath, machineId: "gpu-box", now: 5_000 });
  assert.equal(released.authority, null);
  assert.deepEqual(released.temporaryGrants, {});

  const racePolicyPath = join(sandbox, "claim-race.json");
  const racingClaims = await Promise.allSettled([
    claimFleetPolicyMaster({ caller: master, filePath: racePolicyPath, machineId: "race-box" }),
    claimFleetPolicyMaster({ caller: secondary, filePath: racePolicyPath, machineId: "race-box" }),
  ]);
  assert.equal(racingClaims.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(racingClaims.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await readFleetMachinePolicy({ filePath: racePolicyPath })).authority?.masterHubId, master.id);

  const corruptPolicyPath = join(sandbox, "corrupt-policy.json");
  await writeFile(corruptPolicyPath, "{ definitely-not-json", "utf8");
  await assert.rejects(
    readFleetMachinePolicy({ filePath: corruptPolicyPath }),
    (error) => error instanceof FleetMachinePolicyError && error.status === 500,
  );
  assert.deepEqual(fleetMachinePolicyFailureSummary().performance.ignore, true);

  const home = join(sandbox, "collector-home");
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let collectorStderr = "";
  collector = spawn(process.execPath, [new URL("./agent-telemetry-collector.mjs", import.meta.url).pathname], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      AGENT_TELEMETRY_PORT: String(port),
      AGENT_TELEMETRY_HOST: "127.0.0.1",
      AGENT_TELEMETRY_CHAT_DISABLED: "1",
      AGENT_TELEMETRY_DISABLE_SELF_RELOAD: "1",
      AGENT_TELEMETRY_ENV_SYNC_DISABLED: "1",
      AGENT_TELEMETRY_HEALTH_CACHE_MS: "0",
      HIVE_COLLECTOR_ONLY: "1",
      HIVEMINDOS_MDNS_DISABLE: "1",
      HIVEMINDOS_SYNC_PATH: join(sandbox, "vault"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  collector.stderr.on("data", (chunk) => { collectorStderr += chunk.toString(); });
  await waitForCollector(baseUrl, () => collectorStderr.slice(-600));

  const beforeClaim = await (await fetch(`${baseUrl}/fleet-policy`)).json();
  assert.equal(beforeClaim.configured, false);
  assert.equal(beforeClaim.canManage, true);

  const prematureUpdate = await fetch(`${baseUrl}/fleet-policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "update", performance: { ignore: true } }),
  });
  assert.equal(prematureUpdate.status, 409, "policy updates require a claimed master hub");

  const claimResponse = await fetch(`${baseUrl}/fleet-policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "claim-master" }),
  });
  assert.equal(claimResponse.status, 200);
  assert.equal((await claimResponse.json()).configured, true);

  const updateResponse = await fetch(`${baseUrl}/fleet-policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "update",
      access: { sharedBrain: "deny" },
      performance: { enabled: true, ignore: false, maxCpuPct: 70, maxRamPct: 80, maxDiskPct: 90 },
    }),
  });
  assert.equal(updateResponse.status, 200);
  const collectorPolicy = await updateResponse.json();
  assert.equal(collectorPolicy.policy.access.sharedBrain, "deny");
  assert.equal(collectorPolicy.policy.performance.maxCpuPct, 70);

  const resolveResponse = await fetch(`${baseUrl}/fleet-policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "resolve-access", capability: "sharedEnv", decision: "allow-temporary" }),
  });
  assert.equal(resolveResponse.status, 200);
  assert.equal((await resolveResponse.json()).effectiveAccess.sharedEnv, "allow");

  const health = await (await fetch(`${baseUrl}/health`)).json();
  assert.equal(health.capabilities.machinePolicy, true);
  assert.equal(health.fleetPolicy.configured, true);
  assert.equal(health.fleetPolicy.performance.maxCpuPct, 70);

  const stored = await readFleetMachinePolicy({ filePath: join(home, ".hivemindos", "fleet-machine-policy.json") });
  assert.equal(stored.access.sharedBrain, "deny");

  console.log("Fleet machine policy tests passed.");
} finally {
  if (collector && !collector.killed) collector.kill("SIGTERM");
  await rm(sandbox, { recursive: true, force: true });
}
