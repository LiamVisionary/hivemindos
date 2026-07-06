#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  chooseQueenBeeDelegate,
  inferQueenBeeWorkerClass,
  rankQueenBeeDelegates,
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
  const ranked = rankQueenBeeDelegates({
    title: "Implement",
    body: "Implement the next concrete increment for a zero-human company.",
    skills: ["code"],
  }, [urlBackedMachine]);

  assert(ranked.length >= 2, "routing should expose a fallback chain, not only the top delegate");
  assert.equal(ranked[0].agent?.name, "Ada Lovelace");
  assert.equal(ranked[1].agent?.name, "AdaptiveAgent");
  assert.match(ranked[1].reason, /fallback #2/);
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

// Load-aware cross-machine spreading: two EQUALLY-capable code agents, one on a
// saturated machine (This Mac carrying several in-flight tasks) and one on an idle
// machine — the idle machine wins, so bursts fan out instead of piling onto one box.
{
  const busyMac = {
    ...urlBackedMachine,
    key: "this-mac",
    device: { ...urlBackedMachine.device, name: "This Mac", self: true },
    agents: [
      { id: "mac-coder", name: "Mac Coder", runtime: "hermes", beeRole: "worker", workerClass: "code", runtimeCapabilities: { chat: true } },
      { id: "mac-writer", name: "Mac Writer", runtime: "hermes", beeRole: "worker", workerClass: "writer", runtimeCapabilities: { chat: true } },
    ],
  };
  const idleVps = {
    key: "hel1-2",
    collector: "http://100.0.0.1:8787",
    device: { self: false, name: "hel1-2", os: "linux", online: true, collectorUrl: "http://100.0.0.1:8787" },
    capabilities: { chat: true, runtimes: ["hermes"] },
    agents: [
      { id: "vps-coder", name: "VPS Coder", runtime: "hermes", beeRole: "worker", workerClass: "code", runtimeCapabilities: { chat: true } },
    ],
  };
  const codeTask = { title: "Fix", body: "Fix the code bug.", skills: ["code"] };
  // This Mac is carrying 4 in-flight tasks across its agents; hel1-2 is idle.
  const busyAssignments = { "Mac Coder": 2, "Mac Writer": 2 };
  const spread = chooseQueenBeeDelegate(codeTask, [busyMac, idleVps], { assignments: busyAssignments });
  assert.equal(spread.machine?.key, "hel1-2", "an idle machine wins over a saturated one for equally-capable work");
  assert.equal(spread.agent?.name, "VPS Coder", "the burst spreads to the freer machine's coder");

  // Kill switch restores the old (machine-load-blind) behavior.
  process.env.QUEEN_BEE_MACHINE_LOAD_SPREADING = "0";
  try {
    const noSpread = chooseQueenBeeDelegate(codeTask, [busyMac, idleVps], { assignments: busyAssignments });
    // With spreading off, the This-Mac coder's only penalty is its own 2-task agent
    // load; the self tie-break (+1) keeps a same-score local pick, so it need not flip.
    assert.ok(noSpread.status === "delegated", "kill switch still yields a delegate");
    assert.ok(noSpread.reason && !/spreading to a freer machine/.test(noSpread.reason), "kill switch removes the machine-load spreading signal");
  } finally {
    delete process.env.QUEEN_BEE_MACHINE_LOAD_SPREADING;
  }

  // An explicit machine pin is still honored — spreading never overrides it.
  const pinned = chooseQueenBeeDelegate(codeTask, [busyMac, idleVps], { assignments: busyAssignments, targetMachineKey: "this-mac" });
  assert.equal(pinned.machine?.key, "this-mac", "an explicit pin overrides load spreading");

  // Spreading must NOT send specialized work to a wrong-but-idle agent: a code task
  // still goes to a code agent on the busy machine over a non-code agent on the idle one.
  const idleNonCoder = { ...idleVps, agents: [{ id: "vps-writer", name: "VPS Writer", runtime: "hermes", beeRole: "worker", workerClass: "writer", runtimeCapabilities: { chat: true } }] };
  const stillMatches = chooseQueenBeeDelegate(codeTask, [busyMac, idleNonCoder], { assignments: busyAssignments });
  assert.equal(stillMatches.agent?.name, "Mac Coder", "class match dominates: a code task stays with the coder even on the busier machine");
}

console.log("Queen Bee router delegation tests passed.");
