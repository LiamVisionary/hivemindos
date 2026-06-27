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

// Built-in "security" class is now first-class (was previously collapsed to "general").
{
  const workerClass = inferQueenBeeWorkerClass({
    title: "Security review",
    body: "Threat model the auth flow and scan dependencies for known vulnerabilities.",
  });
  assert.equal(workerClass, "security");

  const securityMachine = {
    ...urlBackedMachine,
    agents: [
      ...urlBackedMachine.agents,
      { id: "sec-1", name: "Sentinel", runtime: "hermes", beeRole: "worker", workerClass: "security", runtimeCapabilities: { chat: true } },
    ],
  };
  const delegate = chooseQueenBeeDelegate({
    title: "Security review",
    body: "Threat model the auth flow and scan dependencies for known vulnerabilities.",
  }, [securityMachine]);
  assert.equal(delegate.status, "delegated");
  assert.equal(delegate.agent?.name, "Sentinel");
}

// Custom, user-defined worker classes win when the request names the specialty.
{
  const legalMachine = {
    ...urlBackedMachine,
    agents: [
      ...urlBackedMachine.agents,
      { id: "legal-1", name: "Counsel", runtime: "hermes", beeRole: "worker", workerClass: "legal", runtimeCapabilities: { chat: true } },
    ],
  };
  const delegate = chooseQueenBeeDelegate({
    title: "Contract review",
    body: "Review this vendor MSA for legal risk and flag indemnification gaps.",
  }, [legalMachine]);
  assert.equal(delegate.status, "delegated");
  assert.equal(delegate.agent?.name, "Counsel");
}

// Recency bonus is class-scoped: a recently-busy OFF-class generalist must not outrank a
// fresh peer on a task it does not match. Two general agents on a research task; outcomes
// strongly favor the busy one. With the fix, recency is suppressed (off-class) so the tie
// breaks on stable name (a- < z-), NOT on recency.
{
  const researchMachine = {
    ...urlBackedMachine,
    agents: [
      { id: "a-fresh-gen", name: "Fresh Generalist", runtime: "hermes", beeRole: "worker", workerClass: "general", runtimeCapabilities: { chat: true } },
      { id: "z-busy-gen", name: "Busy Generalist", runtime: "hermes", beeRole: "worker", workerClass: "general", runtimeCapabilities: { chat: true } },
    ],
  };
  const researchTask = { title: "Research", body: "Research the market landscape and compare sources.", skills: ["research"] };
  assert.equal(inferQueenBeeWorkerClass(researchTask), "research");
  const delegate = chooseQueenBeeDelegate(researchTask, [researchMachine], {
    outcomes: { "z-busy-gen": { completed: 9, failed: 0 } },
  });
  assert.equal(delegate.status, "delegated");
  assert.equal(delegate.agent?.name, "Fresh Generalist", "off-class recency must NOT lift a busy generalist over a fresh peer");
}

// Positive control: when the busy agent IS the exact class, in-class recency still helps it
// win against an otherwise tie-breaking fresh specialist.
{
  const researchMachine = {
    ...urlBackedMachine,
    agents: [
      { id: "a-fresh-research", name: "Fresh Researcher", runtime: "hermes", beeRole: "worker", workerClass: "research", runtimeCapabilities: { chat: true } },
      { id: "z-busy-research", name: "Busy Researcher", runtime: "hermes", beeRole: "worker", workerClass: "research", runtimeCapabilities: { chat: true } },
    ],
  };
  const researchTask = { title: "Research", body: "Research the market landscape and compare sources.", skills: ["research"] };
  const delegate = chooseQueenBeeDelegate(researchTask, [researchMachine], {
    outcomes: { "z-busy-research": { completed: 9, failed: 0 } },
  });
  assert.equal(delegate.agent?.name, "Busy Researcher", "in-class recency should still reward a proven specialist");
}

// Load-aware routing: among equally-good agents, an in-flight load penalty spreads a burst
// off the agent that would otherwise win the deterministic tie-break.
{
  const burstMachine = {
    ...urlBackedMachine,
    agents: [
      { id: "a-busy", name: "Busy One", runtime: "hermes", beeRole: "worker", workerClass: "general", runtimeCapabilities: { chat: true } },
      { id: "b-free", name: "Free One", runtime: "hermes", beeRole: "worker", workerClass: "general", runtimeCapabilities: { chat: true } },
    ],
  };
  const generalTask = { title: "Do a thing", body: "Propose one small thing to do.", skills: [] };
  // Without load info, the alphabetical tie-break picks Busy One.
  const baseline = chooseQueenBeeDelegate(generalTask, [burstMachine]);
  assert.equal(baseline.agent?.name, "Busy One", "tie-break baseline should be the alphabetically-first agent");
  // With Busy One already holding in-flight work, the free agent should win.
  const spread = chooseQueenBeeDelegate(generalTask, [burstMachine], { assignments: { "Busy One": 3 } });
  assert.equal(spread.agent?.name, "Free One", "an in-flight load penalty should steer the burst to the free agent");
  // A single in-flight task is a small nudge; a large class advantage still wins.
  const stillSpecialist = chooseQueenBeeDelegate(
    { title: "Security review", body: "Threat model the auth flow.", skills: [] },
    [{ ...urlBackedMachine, agents: [
      ...burstMachine.agents,
      { id: "sec", name: "Sentinel", runtime: "hermes", beeRole: "worker", workerClass: "security", runtimeCapabilities: { chat: true } },
    ] }],
    { assignments: { "Sentinel": 1 } },
  );
  assert.equal(stillSpecialist.agent?.name, "Sentinel", "a small load penalty must not override an exact specialist match");
}

// Cross-machine outcomes: a board-derived record keyed by AGENT NAME (not id) still applies,
// so routing learns from remote agents whose chat sessions never reach this machine.
{
  const twoResearchers = {
    ...urlBackedMachine,
    agents: [
      { id: "r-proven", name: "Proven Researcher", runtime: "hermes", beeRole: "worker", workerClass: "research", runtimeCapabilities: { chat: true } },
      { id: "r-fresh", name: "Fresh Researcher", runtime: "hermes", beeRole: "worker", workerClass: "research", runtimeCapabilities: { chat: true } },
    ],
  };
  const researchTask = { title: "Research", body: "Research the market landscape.", skills: ["research"] };
  // Outcome keyed by NAME (as the board-derived stats are) should lift the proven researcher,
  // even though no id-keyed stat exists for it.
  const delegate = chooseQueenBeeDelegate(researchTask, [twoResearchers], {
    outcomes: { "Proven Researcher": { completed: 8, failed: 0 } },
  });
  assert.equal(delegate.agent?.name, "Proven Researcher", "name-keyed (cross-machine) outcomes should influence routing");
}

console.log("Queen Bee router delegation tests passed.");
