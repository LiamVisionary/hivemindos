#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const { createDefaultFleetMachinePolicy, parseFleetMachineAccessRequest } = await import(
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
  assert.equal(initial.access.sharedEnv, "allow", "shared hive env should be available to agents by default");
  assert.ok(
    Object.entries(initial.access)
      .filter(([capability]) => capability !== "sharedEnv")
      .every(([, decision]) => decision === "ask"),
  );
  assert.equal(
    createDefaultFleetMachinePolicy("gpu-box").access.sharedEnv,
    "allow",
    "the dashboard policy default must match the collector default",
  );

  const untouchedLegacyPolicyPath = join(sandbox, "untouched-legacy-policy.json");
  await writeFile(untouchedLegacyPolicyPath, `${JSON.stringify({
    version: 1,
    machineId: "legacy-box",
    authority: {
      masterHubId: master.id,
      masterHubLabel: master.label,
      claimedAt: new Date(2_000).toISOString(),
    },
    access: {
      sharedBrain: "ask",
      sharedEnv: "ask",
      chatHistory: "ask",
      connectedApps: "ask",
      messagingChannels: "ask",
      fileTransfers: "ask",
    },
    performance: { enabled: true, ignore: false, maxCpuPct: 85, maxRamPct: 90, maxDiskPct: 95 },
    temporaryGrants: {},
    updatedAt: new Date(2_000).toISOString(),
  }, null, 2)}\n`, "utf8");
  const migratedLegacyPolicy = await readFleetMachinePolicy({ filePath: untouchedLegacyPolicyPath });
  assert.equal(
    migratedLegacyPolicy.access.sharedEnv,
    "allow",
    "an untouched legacy all-Ask policy should inherit the new shared-env default",
  );

  const reviewedLegacyPolicyPath = join(sandbox, "reviewed-legacy-policy.json");
  await writeFile(reviewedLegacyPolicyPath, `${JSON.stringify({
    ...migratedLegacyPolicy,
    access: { ...migratedLegacyPolicy.access, sharedEnv: "ask" },
    updatedAt: new Date(3_000).toISOString(),
  }, null, 2)}\n`, "utf8");
  assert.equal(
    (await readFleetMachinePolicy({ filePath: reviewedLegacyPolicyPath })).access.sharedEnv,
    "ask",
    "a reviewed legacy Ask decision must remain explicit",
  );

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
  const fakeHermes = join(sandbox, "fake-hermes.mjs");
  const fakeHermesRunLog = join(sandbox, "fake-hermes-runs.log");
  await mkdir(join(home, ".hivemindos"), { recursive: true });
  await writeFile(join(home, ".hivemindos", ".env"), "OPENROUTER_API_KEY=test-shared-openrouter-key\n", "utf8");
  await writeFile(fakeHermes, `#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
await appendFile(process.env.FAKE_HERMES_RUN_LOG, "run\\n");
if (process.env.OPENROUTER_API_KEY !== "test-shared-openrouter-key") {
  console.error("Provider resolver returned an empty API key.");
  process.exit(1);
}
if (process.argv.includes("chat")) {
  console.log('__HIVEMIND_HERMES_EVENT__{"type":"assistant.delta","delta":"shared-env-present"}');
} else {
  console.log("shared-env-present");
}
`, "utf8");
  await chmod(fakeHermes, 0o755);
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
      AGENT_TELEMETRY_CHAT_DISABLED: "0",
      AGENT_TELEMETRY_DISABLE_SELF_RELOAD: "1",
      AGENT_TELEMETRY_ENV_SYNC_DISABLED: "1",
      AGENT_TELEMETRY_HEALTH_CACHE_MS: "0",
      HIVE_COLLECTOR_ONLY: "1",
      HERMES_BIN: fakeHermes,
      FAKE_HERMES_RUN_LOG: fakeHermesRunLog,
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
  const claimedCollectorPolicy = await claimResponse.json();
  assert.equal(claimedCollectorPolicy.configured, true);
  assert.equal(claimedCollectorPolicy.effectiveAccess.sharedEnv, "allow");

  const allowedChatResponse = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Confirm shared env",
      agent: { provider: "openrouter", model: "test/model" },
      agentEnv: { OPENROUTER_API_KEY: "test-shared-openrouter-key" },
    }),
  });
  assert.equal(allowedChatResponse.status, 200);
  assert.equal((await allowedChatResponse.json()).text, "shared-env-present");

  const allowedStreamResponse = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Confirm streamed shared env",
      stream: true,
      forceHermesCli: true,
      agent: { provider: "openrouter", model: "test/model" },
      agentEnv: { OPENROUTER_API_KEY: "test-shared-openrouter-key" },
    }),
  });
  assert.equal(allowedStreamResponse.status, 200);
  assert.match(await allowedStreamResponse.text(), /shared-env-present/);

  const updateResponse = await fetch(`${baseUrl}/fleet-policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "update",
      access: { sharedBrain: "deny", sharedEnv: "ask" },
      performance: { enabled: true, ignore: false, maxCpuPct: 70, maxRamPct: 80, maxDiskPct: 90 },
    }),
  });
  assert.equal(updateResponse.status, 200);
  const collectorPolicy = await updateResponse.json();
  assert.equal(collectorPolicy.policy.access.sharedBrain, "deny");
  assert.equal(collectorPolicy.policy.access.sharedEnv, "ask");
  assert.equal(collectorPolicy.policy.performance.maxCpuPct, 70);

  const blockedChatResponse = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Confirm blocked shared env",
      agent: { provider: "openrouter", model: "test/model" },
      agentEnv: { OPENROUTER_API_KEY: "test-shared-openrouter-key" },
    }),
  });
  assert.equal(blockedChatResponse.status, 403);
  const blockedChat = await blockedChatResponse.json();
  assert.equal(blockedChat.code, "fleet_shared_env_access_blocked");
  assert.equal(blockedChat.capability, "sharedEnv");
  assert.equal(blockedChat.decision, "ask");
  assert.deepEqual(blockedChat.blockedKeys, ["OPENROUTER_API_KEY"]);
  assert.match(blockedChat.error, /^FLEET ACCESS REQUEST: sharedEnv$/m);
  assert.equal((await readFile(fakeHermesRunLog, "utf8")).trim().split(/\r?\n/).length, 2);

  const blockedStreamResponse = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Confirm streamed blocked shared env",
      stream: true,
      forceHermesCli: true,
      agent: { provider: "openrouter", model: "test/model" },
      agentEnv: { OPENROUTER_API_KEY: "test-shared-openrouter-key" },
    }),
  });
  assert.equal(blockedStreamResponse.status, 403);
  assert.equal((await blockedStreamResponse.json()).code, "fleet_shared_env_access_blocked");
  assert.equal((await readFile(fakeHermesRunLog, "utf8")).trim().split(/\r?\n/).length, 2);

  const resolveResponse = await fetch(`${baseUrl}/fleet-policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "resolve-access", capability: "sharedEnv", decision: "allow-temporary" }),
  });
  assert.equal(resolveResponse.status, 200);
  assert.equal((await resolveResponse.json()).effectiveAccess.sharedEnv, "allow");

  const temporarilyAllowedChatResponse = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Confirm temporarily allowed shared env",
      agent: { provider: "openrouter", model: "test/model" },
      agentEnv: { OPENROUTER_API_KEY: "test-shared-openrouter-key" },
    }),
  });
  assert.equal(temporarilyAllowedChatResponse.status, 200);
  assert.equal((await temporarilyAllowedChatResponse.json()).text, "shared-env-present");
  assert.equal((await readFile(fakeHermesRunLog, "utf8")).trim().split(/\r?\n/).length, 3);

  const denyResponse = await fetch(`${baseUrl}/fleet-policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "resolve-access",
      capability: "sharedEnv",
      decision: "deny",
    }),
  });
  assert.equal(denyResponse.status, 200);
  const deniedChatResponse = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Confirm denied shared env",
      stream: true,
      forceHermesCli: true,
      agent: { provider: "openrouter", model: "test/model" },
      agentEnv: { OPENROUTER_API_KEY: "test-shared-openrouter-key" },
    }),
  });
  assert.equal(deniedChatResponse.status, 403);
  const deniedChat = await deniedChatResponse.json();
  assert.equal(deniedChat.decision, "deny");
  assert.doesNotMatch(deniedChat.error, /^FLEET ACCESS REQUEST:/m);
  assert.equal((await readFile(fakeHermesRunLog, "utf8")).trim().split(/\r?\n/).length, 3);

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
