#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  chooseQueenBeeDelegate,
  inferQueenBeeWorkerClass,
} = await import("../src/lib/services/queen-bee/router.ts");

const urlBackedMachine = {
  key: "this-mac",
  collector: "http://127.0.0.1:8789",
  device: {
    self: true,
    name: "This Mac",
    os: "darwin",
    online: true,
    collectorUrl: "http://127.0.0.1:8789",
  },
  capabilities: {
    chat: true,
    runtimes: ["aeon", "hermes"],
    skillInventory: true,
    syncthing: true,
  },
  agents: [
    {
      id: "aeon-ops",
      name: "Aeon on This Mac",
      runtime: "aeon",
      beeRole: "worker",
      workerClass: "ops",
      runtimeCapabilities: { chat: true },
    },
    {
      id: "ada-code",
      name: "Ada Lovelace",
      runtime: "hermes",
      beeRole: "worker",
      workerClass: "code",
      runtimeCapabilities: { chat: true },
    },
    {
      id: "adaptive-general",
      name: "AdaptiveAgent",
      runtime: "hermes",
      beeRole: "worker",
      workerClass: "general",
      runtimeCapabilities: { chat: true },
    },
  ],
};

{
  const workerClass = inferQueenBeeWorkerClass({
    title: "Implement",
    body: "Implement the next concrete increment for a zero-human company.",
    skills: ["code"],
  });
  assert.equal(workerClass, "code");
}

{
  const delegate = chooseQueenBeeDelegate({
    title: "Implement",
    body: "Implement the next concrete increment for a zero-human company.",
    skills: ["code"],
  }, [urlBackedMachine]);

  assert.equal(delegate.status, "delegated");
  assert.equal(delegate.workerClass, "code");
  assert.equal(delegate.agent?.name, "Ada Lovelace");
  assert.equal(delegate.machine?.device?.collectorUrl, "http://127.0.0.1:8789");
}

{
  const delegate = chooseQueenBeeDelegate({
    title: "Audit",
    body: "Audit risks, spend, and compliance for a zero-human company.",
    skills: ["qa"],
  }, [{ ...urlBackedMachine, collector: "offline" }]);

  assert.equal(delegate.status, "pending");
}

console.log("Queen Bee router delegation tests passed.");
