#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { NextRequest } = await import("next/server");
const loopsRoute = await import("../src/app/api/loops/route.ts");
const kanbanRoute = await import("../src/app/api/kanban/route.ts");

const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-loop-kanban-real-"));
const kanbanFolder = "Operations/Work Board";
const boardSlug = "real-loop-tasks";
const baseUrl = `http://127.0.0.1/api`;

try {
  const createdTasks = [];
  for (const spec of realisticLoopTasks()) {
    const created = await loopsPost({
      action: "create-task",
      board: boardSlug,
      vaultPath,
      kanbanFolder,
      status: "ready",
      priority: spec.priority,
      templateId: spec.templateId,
      taskTitle: spec.title,
      title: spec.title,
      goal: spec.goal,
      body: spec.body,
      skills: spec.skills,
      successCriteria: spec.successCriteria,
      optionalVerifierIds: ["human:approval"],
      maxAttempts: spec.maxAttempts,
      maxTokens: spec.maxTokens,
      maxCostUsd: spec.maxCostUsd,
      benchmarkCommand: spec.benchmarkCommand,
      benchmarkMetricName: spec.benchmarkMetricName,
      benchmarkTarget: spec.benchmarkTarget,
    });
    assert.equal(created.ok, true);
    assert(created.task.loop, `${spec.title} should carry a loop`);
    assert.equal(created.task.loop.mode, spec.mode);
    assert(created.task.loop.evalGates.length > 0, `${spec.title} should have eval gates`);
    assert(created.task.loop.budget?.maxAttempts, `${spec.title} should have an attempt budget`);

    const patched = await kanbanPatch(created.task.id, {
      source: `queen-bee:test:${spec.templateId}`,
      workspace: spec.workspace,
      maxAttempts: spec.maxAttempts,
    });
    createdTasks.push({ ...spec, task: patched.task });
  }

  const [codeTask, briefTask, evoTask] = createdTasks;

  await claim(codeTask.task.id, "Loop Code Agent");
  const blocked = await complete(codeTask.task.id, {
    summary: "Attempted code fix without receipts.",
    result: "Changed the auth refresh retry path.\nVerification attempted: lint/typecheck/focused auth test.\nDeliverable: /tmp/auth-refresh-fix.diff",
    loopReceipts: [],
  });
  assert.equal(blocked.blocked, true, "code-fix task should block without required receipts");
  assert.equal(blocked.task.status, "needs-human");
  assert(blocked.task.result.includes("Loop gate block"), "blocked result should explain missing loop gates");
  assert(/\nACTION NEEDED:/.test(blocked.task.result), "blocked result should carry an explicit ACTION NEEDED ask for the Work Board headline");

  // Human answers the blocked ask: the answer lands in the task body (so the
  // next worker run sees it), the card returns to Ready with the SAME assignee,
  // and a comment records the reply on the timeline.
  const answered = await kanbanPost({
    action: "answer",
    taskId: codeTask.task.id,
    answer: "Use the existing corepack pnpm shim; approved to continue.",
  });
  assert.equal(answered.ok, true);
  assert.equal(answered.task.status, "ready", "answered task returns to the dispatch queue");
  assert.equal(answered.task.assignee, "Loop Code Agent", "answer preserves the asking agent");
  assert(answered.task.body.includes("Human answer"), "answer is stamped into the task body");
  assert(answered.task.body.includes("corepack pnpm shim"), "answer text reaches the body");
  assert.equal(answered.pickupScheduled, false, "no autonomous pickup without a delegated collector target");
  assert(
    answered.board.comments.some((comment) => comment.taskId === codeTask.task.id && comment.body.includes("corepack pnpm shim")),
    "answer recorded as a task comment",
  );

  const codeDone = await complete(codeTask.task.id, {
    summary: "Code fix completed with loop receipts.",
    result: "Auth refresh retry path fixed.\nVerification: lint, typecheck, and focused auth refresh tests passed.\nDeliverable: /tmp/auth-refresh-fix.diff",
    loopReceipts: passingReceipts(blocked.task, "code"),
  });
  assert.equal(codeDone.task.status, "done");
  assert(codeDone.task.loop.evalGates.some((gate) => gate.status === "passed"), "code gates should be marked passed");

  await claim(briefTask.task.id, "Loop Research Agent");
  const briefDone = await complete(briefTask.task.id, {
    summary: "Daily brief completed with source and delivery receipts.",
    result: "Published the AI agent market brief with cited funding, launch, and policy sections.\nDeliverable: /tmp/agent-market-brief.md",
    loopReceipts: passingReceipts(briefTask.task, "brief"),
  });
  assert.equal(briefDone.task.status, "done");

  const discovered = await kanbanPost({
    action: "loop-discover",
    taskId: evoTask.task.id,
    goal: evoTask.goal,
    target: "routing benchmark",
    command: "pnpm test:routing -- --json",
    metricName: "held_out_routing_score",
    metricDirection: "max",
    scoreFloor: 0.82,
    resourceProfile: "small-batch",
    instrumentation: "manual",
    notes: ["Fixture benchmark discovery for loop test."],
    frontierStrategy: { kind: "pareto_per_task", params: { k: 3, task_floor: 0.75 } },
  });
  assert.equal(discovered.ok, true);
  assert.equal(discovered.task.loop.benchmark.metricName, "held_out_routing_score");

  const recorded = await kanbanPost({
    action: "loop-record",
    taskId: evoTask.task.id,
    experiment: {
      id: "exp-routing-prompt-budget",
      hypothesis: "A shorter routing prompt plus explicit evidence gates improves held-out routing.",
      status: "committed",
      score: 0.87,
      agent: "Loop Optimizer",
      result: "Routing score improved from 0.81 to 0.87 in fixture.",
    },
    antiPatterns: [{
      id: "anti-pattern-broad-scan",
      title: "Broad repo scan before benchmark",
      reason: "Spent context without improving routing score.",
      evidence: ["Fixture experiment discarded broad scan approach."],
    }],
  });
  assert.equal(recorded.ok, true);
  assert.equal(recorded.observation.bestScore, 0.87);
  assert.equal(recorded.observation.antiPatternCount, 1);

  await claim(evoTask.task.id, "Loop Optimizer");
  const evoDone = await complete(evoTask.task.id, {
    summary: "Benchmark loop completed with score receipts.",
    result: "Committed routing prompt budget improvement.\nVerification: held_out_routing_score=0.87.\nDeliverable: /tmp/routing-loop-result.json",
    loopReceipts: passingReceipts(recorded.task, "evo"),
  });
  assert.equal(evoDone.task.status, "done");

  const boardState = await kanbanGet();
  assert.equal(boardState.board.tasks.length, 3);
  assert(boardState.board.tasks.every((task) => task.status === "done"), "all realistic loop tasks should finish done after receipts");
  assert(boardState.board.events.some((event) => event.kind === "loop.eval-blocked"), "blocked completion should leave a loop eval event");
  assert(boardState.board.events.some((event) => event.kind === "loop.recorded"), "optimizer evidence should leave a loop recorded event");

  const readiness = await loopsGet("readiness=true&artifacts=true&title=Realistic%20Loop%20Task%20Fixture");
  assert.equal(readiness.ok, true);
  assert.equal(readiness.readiness.level, "L3", "realistic loop task board should audit as L3 after receipts");
  assert.equal(readiness.readiness.totals.loopTasks, 3);
  assert(readiness.readiness.totals.receipts >= 6, "readiness should count loop receipts");
  assert(readiness.artifacts.loopMd.includes("Realistic Loop Task Fixture"));
  assert(readiness.artifacts.registryYaml.includes("app-build-harness"));

  console.log("realistic loop Kanban task tests passed");
} finally {
  await rm(vaultPath, { recursive: true, force: true });
}

function realisticLoopTasks() {
  return [
    {
      templateId: "code-fix",
      mode: "closed",
      title: "Fix flaky auth refresh retry",
      goal: "Repair the flaky auth refresh retry path until lint, typecheck, and the focused auth test are clean.",
      body: "A code agent should reproduce the flaky auth refresh failure, repair it, rerun focused gates, and return receipts before completion.",
      successCriteria: ["Flake is reproduced", "Focused auth test passes", "Lint and typecheck pass", "Evidence receipts are attached"],
      skills: ["code", "qa"],
      priority: "high",
      workspace: "worktree",
      maxAttempts: 3,
      maxTokens: 180000,
      maxCostUsd: 2,
    },
    {
      templateId: "daily-brief",
      mode: "open",
      title: "Publish AI agent market brief",
      goal: "Every weekday, scan AI agent market news, cite sources, and deliver a brief with evidence and delivery receipts.",
      body: "A research agent should collect source-backed updates, prioritize them, write the brief, and attach evidence/delivery receipts.",
      successCriteria: ["Sources are cited", "Brief artifact exists", "Delivery receipt exists"],
      skills: ["research", "writer"],
      priority: "normal",
      workspace: "scratch",
      maxAttempts: 2,
      maxTokens: 90000,
      maxCostUsd: 1,
    },
    {
      templateId: "evo-benchmark",
      mode: "optimizer",
      title: "Improve routing benchmark score",
      goal: "Improve held-out routing benchmark score with bounded experiments, evidence receipts, and anti-pattern memory.",
      body: "An optimizer should discover the benchmark, record experiment lineage, avoid repeated bad approaches, and complete only with score receipts.",
      successCriteria: ["Benchmark is discovered", "Experiment lineage is recorded", "Score receipt passes", "Anti-pattern memory is preserved"],
      skills: ["evo", "qa"],
      priority: "high",
      workspace: "worktree",
      maxAttempts: 4,
      maxTokens: 220000,
      maxCostUsd: 3,
      benchmarkCommand: "pnpm test:routing -- --json",
      benchmarkMetricName: "held_out_routing_score",
      benchmarkTarget: "routing benchmark",
    },
  ];
}

async function loopsPost(body) {
  const response = await loopsRoute.POST(jsonRequest(`${baseUrl}/loops?board=${boardSlug}`, body));
  return response.json();
}

async function loopsGet(query) {
  const url = `${baseUrl}/loops?board=${boardSlug}&vaultPath=${encodeURIComponent(vaultPath)}&kanbanFolder=${encodeURIComponent(kanbanFolder)}&${query}`;
  const response = await loopsRoute.GET(new NextRequest(url));
  return response.json();
}

async function kanbanPost(body) {
  const response = await kanbanRoute.POST(jsonRequest(`${baseUrl}/kanban?board=${boardSlug}`, {
    ...body,
    vaultPath,
    kanbanFolder,
  }));
  return response.json();
}

async function kanbanPatch(taskId, patch) {
  const response = await kanbanRoute.PATCH(jsonRequest(`${baseUrl}/kanban?board=${boardSlug}`, {
    taskId,
    patch,
    vaultPath,
    kanbanFolder,
  }, "PATCH"));
  const payload = await response.json();
  assert.equal(payload.ok, true);
  return payload;
}

async function kanbanGet() {
  const response = await kanbanRoute.GET(new NextRequest(`${baseUrl}/kanban?board=${boardSlug}&vaultPath=${encodeURIComponent(vaultPath)}&kanbanFolder=${encodeURIComponent(kanbanFolder)}`));
  const payload = await response.json();
  assert.equal(payload.ok, true);
  return payload;
}

async function claim(taskId, assignee) {
  const payload = await kanbanPost({ action: "claim", taskId, assignee, claimer: assignee, runtime: "test" });
  assert.equal(payload.ok, true);
  assert.equal(payload.task.status, "working");
  return payload;
}

async function complete(taskId, body) {
  const payload = await kanbanPost({ action: "complete", taskId, ...body });
  assert.equal(payload.ok, true);
  return payload;
}

function passingReceipts(task, prefix) {
  return (task.loop?.evalGates ?? [])
    .filter((gate) => gate.required)
    .map((gate, index) => ({
      id: `${prefix}-${gate.id}`,
      gateId: gate.id,
      status: "passed",
      summary: `${gate.title} passed in realistic fixture`,
      evidence: [`fixture evidence ${prefix}-${index}`],
      verifier: gate.verifier,
      createdAt: Date.now() + index,
    }));
}

function jsonRequest(url, body, method = "POST") {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
