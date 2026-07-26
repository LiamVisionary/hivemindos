#!/usr/bin/env node
// Hermetic coverage for planner dependency edges:
//  - PRD decomposition fans out as a DAG (no blanket predecessor chain; QA drafts
//    depend on the build drafts they verify).
//  - The company goal-planner JSON contract's optional `dependsOn` parses safely
//    (earlier indexes only) and threads into draft dependencies.
//  - Dedupe-surviving drafts get their dependency indexes remapped (dropped
//    drafts' edges vanish instead of pointing at the wrong task).
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const { decomposePrdToTaskDrafts } = await import("../src/lib/services/queen-bee/prd-decomposition.ts");
const { extractTasks, toDrafts } = await import("../src/lib/services/companies-goal-planner.ts");
const { remapDraftDependencies } = await import("../src/lib/services/companies-orchestration.ts");

// 1. PRD decomposition: independent by default, QA verifies its build drafts.
{
  const prd = [
    "# Checkout revamp",
    "",
    "## Requirements",
    "- Build the checkout API endpoints",
    "- Research competitor checkout funnels",
    "- Deploy the payments service to Cloudflare",
    "- Test the checkout API end-to-end",
    "- Verify acceptance criteria coverage",
  ].join("\n");
  const { drafts } = decomposePrdToTaskDrafts(prd);
  assert.equal(drafts.length, 5);
  assert.deepEqual(drafts[0].dependsOnDraftIndexes, [], "first build draft has no dependencies");
  assert.deepEqual(drafts[1].dependsOnDraftIndexes, [], "research draft is independent (no blanket chain)");
  assert.deepEqual(drafts[2].dependsOnDraftIndexes, [], "second build draft does not depend on its predecessor");
  assert.ok(drafts[3].skills.includes("qa"), "the test bullet classifies as qa");
  assert.deepEqual(
    drafts[3].dependsOnDraftIndexes,
    [0],
    "a QA draft naming a specific build target depends on exactly that build draft",
  );
  assert.deepEqual(
    drafts[4].dependsOnDraftIndexes,
    [0, 2],
    "a generic verification draft depends on every earlier build (code/ops) draft",
  );
}

// 1b. A QA bullet with no earlier build drafts has no dependencies.
{
  const prd = [
    "## Requirements",
    "- Test the onboarding flow for regressions",
    "- Build the onboarding flow screens",
  ].join("\n");
  const { drafts } = decomposePrdToTaskDrafts(prd);
  assert.deepEqual(drafts[0].dependsOnDraftIndexes, [], "qa first in document order cannot depend forward");
  assert.deepEqual(drafts[1].dependsOnDraftIndexes, []);
}

// 2. Goal-planner JSON contract: dependsOn parses; forward/self/junk refs drop.
{
  const raw = JSON.stringify({
    tasks: [
      { title: "Research target law firms in Sarasota", detail: "d", role: "Research" },
      { title: "Draft the outreach email sequence", detail: "d", role: "Growth", dependsOn: [0] },
      { title: "Send the first outreach batch", detail: "d", role: "Growth", dependsOn: [1, 1, 2, 5, -1, "x", 0.5] },
    ],
  });
  const tasks = extractTasks(raw, 6);
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks[0].dependsOn, [], "missing dependsOn parses as []");
  assert.deepEqual(tasks[1].dependsOn, [0]);
  assert.deepEqual(
    tasks[2].dependsOn,
    [1],
    "self/forward/negative/non-integer refs are dropped and duplicates collapse",
  );

  const company = {
    id: "co-1",
    name: "Test Co",
    agentIds: [],
    frozen: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    apexGoal: { title: "Earn revenue", metric: "weekly revenue", target: "1000" },
  };
  const drafts = toDrafts(tasks, company);
  assert.deepEqual(
    drafts.map((d) => d.dependsOnDraftIndexes),
    [[], [0], [1]],
    "dependsOn threads into draft dependency indexes",
  );
}

// 3. Dedupe remap: dropping a draft remaps survivors' indexes and drops its edges.
{
  const a = { title: "A", body: "", skills: [], dependsOnDraftIndexes: [] };
  const b = { title: "B", body: "", skills: [], dependsOnDraftIndexes: [0] };
  const c = { title: "C", body: "", skills: [], dependsOnDraftIndexes: [0, 1] };
  const original = [a, b, c];
  // Simulate dedupe dropping b (e.g. it already exists on the board).
  const fresh = [a, c];
  const remapped = remapDraftDependencies(original, fresh);
  assert.deepEqual(remapped.map((d) => d.title), ["A", "C"]);
  assert.deepEqual(remapped[0].dependsOnDraftIndexes, []);
  assert.deepEqual(
    remapped[1].dependsOnDraftIndexes,
    [0],
    "C's edge to A remaps to A's new index; the edge to dropped B vanishes",
  );
  // Inputs are not mutated.
  assert.deepEqual(c.dependsOnDraftIndexes, [0, 1]);
}

console.log("planner dependency suite passed");
process.exit(0);
