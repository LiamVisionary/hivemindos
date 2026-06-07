#!/usr/bin/env node
import assert from "node:assert/strict";
import { chooseQueenBeeDelegate, inferQueenBeeWorkerClass } from "../src/lib/services/queen-bee/router.ts";

const baseAgent = {
  id: "agent-general",
  name: "General Worker",
  runtime: "hermes",
  gatewayUrl: "",
  beeRole: "worker",
  workerClass: "general",
  runtimeCapabilities: { chat: true },
  collectorCapabilities: { chat: true },
};

function machine(key, name, agents, extra = {}) {
  return {
    key,
    collector: "ready",
    device: {
      self: false,
      name,
      os: "linux",
      online: true,
      collectorUrl: `http://${key}.local:5055`,
      ...extra.device,
    },
    capabilities: { chat: true, runtimes: ["hermes", "codex"], ...extra.capabilities },
    agents,
  };
}

assert.equal(inferQueenBeeWorkerClass({ title: "fix the TypeScript API tests", body: "" }), "code");
assert.equal(inferQueenBeeWorkerClass({ title: "verify this UI with screenshots", body: "" }), "vision");
assert.equal(inferQueenBeeWorkerClass({ title: "deploy the collector and check Tailscale", body: "" }), "ops");

const codeMachine = machine("ubuntu", "Ubuntu Build Box", [{
  ...baseAgent,
  id: "codex-code",
  name: "Codex Code Bee",
  runtime: "codex",
  workerClass: "code",
  machineName: "Ubuntu Build Box",
}]);
const localQueen = machine("mac", "This Mac", [{
  ...baseAgent,
  id: "queen-local",
  name: "Local Queen",
  beeRole: "queen",
  workerClass: "planner",
  machineName: "This Mac",
}], { device: { self: true, os: "darwin" } });
const visionMachine = machine("studio", "Vision Studio", [{
  ...baseAgent,
  id: "vision-worker",
  name: "Vision Bee",
  runtime: "openclaw",
  workerClass: "vision",
  machineName: "Vision Studio",
}]);

const codeRoute = chooseQueenBeeDelegate({
  title: "Implement API route and TypeScript tests",
  body: "Need repository edits, lint, and typecheck.",
}, [localQueen, visionMachine, codeMachine]);
assert.equal(codeRoute.status, "delegated");
assert.equal(codeRoute.workerClass, "code");
assert.equal(codeRoute.agent?.id, "codex-code");
assert.equal(codeRoute.machine?.key, "ubuntu");
assert.match(codeRoute.reason, /best available code worker/i);

const visionRoute = chooseQueenBeeDelegate({
  title: "Inspect the screenshot and verify CTA contrast",
  body: "Use visual QA on the rendered page.",
}, [codeMachine, localQueen, visionMachine]);
assert.equal(visionRoute.workerClass, "vision");
assert.equal(visionRoute.agent?.id, "vision-worker");
assert.equal(visionRoute.machine?.key, "studio");

const fallbackRoute = chooseQueenBeeDelegate({ title: "Summarize the release notes", body: "" }, [localQueen]);
assert.equal(fallbackRoute.status, "delegated");
assert.equal(fallbackRoute.agent?.id, "queen-local");
assert.equal(fallbackRoute.machine?.key, "mac");
assert.match(fallbackRoute.reason, /only available/i);

const pendingRoute = chooseQueenBeeDelegate({ title: "do work", body: "" }, [machine("offline", "Offline", [], { device: { online: false } })]);
assert.equal(pendingRoute.status, "pending");
assert.equal(pendingRoute.agent, undefined);
assert.match(pendingRoute.reason, /No chat-capable/i);

console.log("Queen Bee routing tests passed.");
