#!/usr/bin/env node
// End-to-end contract for Queen Bee's default proof composition:
// dashboard/API request -> server template -> persisted Work Board task, plus
// PRD decomposition -> role-specific child loops. This is hermetic: a temporary
// vault and an explicit empty fleet prevent model/provider calls.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const {
  buildQueenBeePrdTaskLoop,
  parseQueenBeeLoopTemplateId,
  prdLoopTemplateForSkills,
  queenBeeLoopPolicyKey,
  resolveQueenBeeTaskLoop,
} = await import("../src/lib/services/queen-bee/task-loop-policy.ts");
const { NextRequest } = await import("next/server");
const { POST } = await import("../src/app/api/queen-bee/route.ts");
const { readBoard } = await import("../src/lib/services/kanban/local-kanban-store.ts");

const NOW = Date.UTC(2026, 7, 12, 16, 0, 0);
const verifierSet = (loop) => new Set(loop.evalGates.map((gate) => gate.verifier));

// Pure policy: registered templates build fresh gates; explicit caller input
// remains authoritative, including null as a deliberate opt-out.
assert.equal(parseQueenBeeLoopTemplateId("app-build-harness"), "app-build-harness");
assert.throws(() => parseQueenBeeLoopTemplateId("invented-template"), /registered Queen Bee loop template/);
assert.throws(() => parseQueenBeeLoopTemplateId("toString"), /registered Queen Bee loop template/, "prototype keys are not templates");
const appLoop = resolveQueenBeeTaskLoop({
  title: "Build a ride",
  message: "Build and verify a rendered roller coaster experience.",
  loopTemplateId: "app-build-harness",
  now: NOW,
});
assert.ok(appLoop, "the requested server template composes a loop");
for (const verifier of ["agent:judge", "command:lint", "command:typecheck", "command:playwright", "artifact:exists", "receipt:evidence"]) {
  assert.ok(verifierSet(appLoop).has(verifier), `app loop includes ${verifier}`);
}
assert.equal(appLoop.evaluationRubric?.title, "App/product evaluator rubric");
assert.match(appLoop.handoffRules.join("\n"), /planning, building, and independent evaluation/i);

const explicitLoop = buildQueenBeePrdTaskLoop({ title: "Research", body: "Research sources", skills: ["research"] }, NOW);
assert.equal(resolveQueenBeeTaskLoop({ title: "x", message: "x", loop: explicitLoop, loopTemplateId: "app-build-harness" }), explicitLoop, "explicit loop wins");
assert.equal(resolveQueenBeeTaskLoop({ title: "x", message: "x", loop: null, loopTemplateId: "app-build-harness" }), undefined, "explicit null opts out");
assert.equal(resolveQueenBeeTaskLoop({ title: "x", message: "x" }), undefined, "ordinary tasks remain unchanged");
assert.equal(
  queenBeeLoopPolicyKey({ loop: explicitLoop }),
  queenBeeLoopPolicyKey({ loop: { ...explicitLoop, observation: { ...explicitLoop.observation, updatedAt: NOW + 10_000 } } }),
  "volatile loop timestamps do not break request dedupe",
);
assert.notEqual(
  queenBeeLoopPolicyKey({ loop: explicitLoop }),
  queenBeeLoopPolicyKey({ loop: { ...explicitLoop, goal: "A materially different explicit goal" } }),
  "materially different explicit loops cannot dedupe to one task",
);

assert.equal(prdLoopTemplateForSkills(["code"]), "engineering-discipline");
assert.equal(prdLoopTemplateForSkills(["ops"]), "engineering-discipline");
assert.equal(prdLoopTemplateForSkills(["qa"]), "engineering-discipline");
assert.equal(prdLoopTemplateForSkills(["writer"]), "content");
assert.equal(prdLoopTemplateForSkills(["research"]), "research");

const vaultPath = mkdtempSync(join(tmpdir(), "queen-loop-e2e-"));
const storage = {
  vaultPath,
  brainServicesFolder: "Operations/Brain Services",
  kanbanFolder: "Operations/Work Board",
};

async function post(body) {
  const response = await POST(new NextRequest("http://127.0.0.1:5021/api/queen-bee", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...storage, fleetSnapshot: [], ...body }),
  }));
  return { response, data: await response.json() };
}

// Real route and storage path for /swarm-goal's payload.
const swarm = await post({
  message: "Build a first-person roller coaster POV ride in Three.js and test the rendered workflow.",
  source: "dashboard-swarm-goal",
  mode: "act",
  priority: "high",
  taskTitle: "Swarm goal: Rollercoaster Sim",
  skills: ["planner", "code", "qa"],
  loopTemplateId: "app-build-harness",
});
assert.equal(swarm.response.status, 200);
assert.equal(swarm.data.ok, true);
assert.ok(swarm.data.task.loop, "API response carries the server-built loop");
assert.ok(swarm.data.task.skills.includes("engineering-discipline"));
assert.ok(swarm.data.task.skills.includes("harness-engineering"));

let board = await readBoard(null, storage);
const persistedSwarm = board.tasks.find((task) => task.id === swarm.data.task.id);
assert.equal(persistedSwarm?.loop?.contract?.title, "Swarm goal: Rollercoaster Sim done contract");
assert.ok(verifierSet(persistedSwarm.loop).has("agent:judge"));

const repeatedSwarm = await post({
  message: "Build a first-person roller coaster POV ride in Three.js and test the rendered workflow.",
  source: "dashboard-swarm-goal",
  mode: "act",
  priority: "high",
  taskTitle: "Swarm goal: Rollercoaster Sim",
  skills: ["planner", "code", "qa"],
  loopTemplateId: "app-build-harness",
});
assert.equal(repeatedSwarm.data.created, false, "the same template policy dedupes normally");
assert.equal(repeatedSwarm.data.task.id, swarm.data.task.id);

const legacyPolicy = await post({
  message: "Build a first-person roller coaster POV ride in Three.js and test the rendered workflow.",
  source: "dashboard-swarm-goal",
  mode: "act",
  taskTitle: "Legacy ungated request",
});
assert.equal(legacyPolicy.data.created, true, "an ungated legacy request cannot reuse the gated task");
assert.equal(legacyPolicy.data.task.loop, undefined);

const explicitOptOut = await post({
  message: "Build a first-person roller coaster POV ride in Three.js and test the rendered workflow.",
  source: "dashboard-swarm-goal",
  mode: "act",
  taskTitle: "Explicit loop opt-out",
  loop: null,
  loopTemplateId: "app-build-harness",
});
assert.equal(explicitOptOut.data.created, true, "explicit null has its own dedupe policy");
assert.equal(explicitOptOut.data.task.loop, undefined, "explicit null remains authoritative through the route and store");

// The API rejects unknown policy names rather than silently dropping evidence.
const invalid = await post({ message: "test", mode: "plan", loopTemplateId: "not-real" });
assert.equal(invalid.response.status, 400);
assert.match(invalid.data.error, /registered Queen Bee loop template/);

// Real PRD route and storage path: every execution child gets a loop selected
// from its worker class; the planning epic remains a non-executing idea.
const prd = await post({
  action: "decompose-prd",
  title: "Proof-gated checkout",
  source: "test-prd",
  prd: [
    "# Proof-gated checkout",
    "",
    "## Requirements",
    "- Build the checkout API endpoints",
    "- Research competitor checkout failure states",
    "- Document the checkout recovery guide",
    "- Test the checkout API end-to-end",
    "",
    "## Acceptance criteria",
    "- The core checkout succeeds",
    "- Failed payments can recover",
  ].join("\n"),
});
assert.equal(prd.response.status, 200);
assert.equal(prd.data.tasks.length, 4);

board = await readBoard(null, storage);
const epic = board.tasks.find((task) => task.id === prd.data.epic.id);
assert.equal(epic?.loop, undefined, "the planning epic itself is not executable");
const children = prd.data.tasks.map((summary) => board.tasks.find((task) => task.id === summary.id));
assert.ok(children.every((task) => task?.loop), "every PRD child persists an evidence loop");

const codeTask = children.find((task) => task.skills.includes("code"));
const researchTask = children.find((task) => task.skills.includes("research"));
const writerTask = children.find((task) => task.skills.includes("writer"));
const qaTask = children.find((task) => task.skills.includes("qa"));
for (const task of [codeTask, researchTask, writerTask, qaTask]) assert.ok(task, "all expected worker classes were created");
assert.ok(codeTask.skills.includes("engineering-discipline"));
assert.ok(verifierSet(codeTask.loop).has("command:test"));
assert.ok(verifierSet(codeTask.loop).has("agent:judge"));
assert.deepEqual(verifierSet(researchTask.loop), new Set(["receipt:evidence", "agent:judge"]));
assert.ok(verifierSet(writerTask.loop).has("artifact:exists"));
assert.ok(verifierSet(writerTask.loop).has("agent:judge"));
assert.ok(verifierSet(qaTask.loop).has("command:test"));
assert.ok(verifierSet(qaTask.loop).has("agent:judge"));
assert.ok(board.links.some((link) => link.parentId === codeTask.id && link.childId === qaTask.id), "QA remains parent-gated behind its matching build task");

console.log("Queen Bee default loop end-to-end checks passed.");
