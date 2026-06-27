#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createAgentProfile,
} from "../src/lib/types/agent-runtime.ts";
import {
  normalizeAgentProfile,
  parseStoredAgents,
} from "../src/features/dashboard/dashboard-storage.ts";

function openClawProfile(patch = {}) {
  return {
    id: "openclaw-local",
    name: "Open Claw",
    runtime: "openclaw",
    gatewayUrl: "ws://127.0.0.1:18789",
    chatPath: "",
    statusPath: "",
    agentId: "main",
    machineName: "This Mac",
    telemetryUrl: "http://127.0.0.1:8787",
    useSharedVault: true,
    workerClass: "general",
    ...patch,
  };
}

const firstOpenClaw = createAgentProfile("openclaw", 1);
assert.equal(
  firstOpenClaw.beeRole,
  "worker",
  "the first OpenClaw agent must no longer default to Queen Bee",
);

assert.equal(
  normalizeAgentProfile(openClawProfile({ beeRole: "queen" })).beeRole,
  "worker",
  "existing OpenClaw profiles persisted as Queen Bee must migrate back to worker",
);

assert.equal(
  normalizeAgentProfile(openClawProfile({ name: "OpenClaw Main" })).beeRole,
  "worker",
  "OpenClaw names like Main must not be inferred as Queen Bee",
);

assert.equal(
  normalizeAgentProfile({
    ...openClawProfile({
      id: "hive-queen",
      name: "Main Queen",
      runtime: "hivemind-os",
      beeRole: "queen",
    }),
  }).beeRole,
  "queen",
  "non-OpenClaw Queen Bee profiles should still be preserved",
);

const parsed = parseStoredAgents({
  "hivemindos.agentProfiles.v1": JSON.stringify([
    openClawProfile({ beeRole: "queen" }),
  ]),
});
assert.equal(parsed[0]?.beeRole, "worker", "stored OpenClaw Queen Bee profile should migrate during dashboard hydration");

console.log("Verified OpenClaw Queen Bee migration.");
