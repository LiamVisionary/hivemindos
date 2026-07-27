#!/usr/bin/env node
// Hermetic coverage for Website Outreach Agency runtime safeguards: 429s retry,
// no-final/empty outreach completions fail closed, and sent/blocked outreach
// results require explicit Work Board evidence fields.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  classifyKanbanFailure,
  isRetryableFailureReason,
} = await import("../src/lib/services/kanban/kanban-failure-classification.ts");
const { runQueenBeeAutonomousPickup } = await import("../src/lib/services/queen-bee/autonomous-worker.ts");
const { classifyRuntimeFailureOutput } = await import("../src/lib/services/queen-bee/worker-output-failure.ts");
const {
  createTask,
  claimTask,
  completeTask,
  failTask,
  patchTask,
  readBoard,
} = await import("../src/lib/services/kanban/local-kanban-store.ts");

assert.equal(classifyKanbanFailure("HTTP 429 Usage Limit: too many requests"), "rate-limit", "429s classify separately from generic agent errors");
assert.equal(isRetryableFailureReason("rate-limit"), true, "429/rate-limit failures are retryable");
assert.equal(
  classifyRuntimeFailureOutput("HTTP 429 Usage Limit: too many requests"),
  "HTTP 429 Usage Limit: too many requests",
  "runtime 429 text is recognized as provider failure, not a valid final response",
);

const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-outreach-safeguards-"));
const options = { vaultPath, kanbanFolder: "Operations/Work Board" };
const source = "company:df5c0f4a-4c12-4c5a-a923-0abb35c14e7a:test-run";
const body = [
  "Company: Website Outreach Agency (Web Development)",
  "Request",
  "Send or block a Sarasota outreach email pitch with evidence.",
].join("\n");

async function outreachTask(title) {
  const { task } = await createTask(null, {
    title,
    body,
    source,
    status: "ready",
    maxAttempts: 3,
  }, options);
  await claimTask(null, task.id, { claimer: `test:${task.id}` }, options);
  return task.id;
}

try {
  let autonomousFailureReason = "";
  const autonomous429 = await runQueenBeeAutonomousPickup({
    task: {
      id: "t_runtime_429",
      title: "Outreach runtime 429 guard",
      body,
      source,
      status: "ready",
      assignee: "Rate Limit Worker",
      maxAttempts: 3,
      attempt: 1,
      targetMachine: { key: "local", name: "local", collectorUrl: "http://collector.test" },
    },
    delegation: {
      status: "available",
      agent: { id: "rate-limit-worker", name: "Rate Limit Worker", runtime: "hermes" },
      machine: { key: "local", collector: "http://collector.test" },
    },
  }, {
    claim: async () => ({ task: {
      id: "t_runtime_429",
      title: "Outreach runtime 429 guard",
      body,
      source,
      status: "running",
      assignee: "Rate Limit Worker",
      maxAttempts: 3,
      attempt: 1,
      targetMachine: { key: "local", name: "local", collectorUrl: "http://collector.test" },
    }, board: {} }),
    complete: async () => { throw new Error("runtime 429 must not complete"); },
    block: async () => { throw new Error("runtime 429 with attempts left must retry, not block"); },
    reroute: async () => { throw new Error("single-delegate runtime 429 should use failTask retry"); },
    fail: async (_slug, _taskId, input) => {
      autonomousFailureReason = String(input?.failureReason || "");
      return { task: { id: "t_runtime_429", title: "Outreach runtime 429 guard", body, source, status: "ready" }, board: {}, retried: true, failureReason: autonomousFailureReason };
    },
    fetchJson: async () => ({ text: "HTTP 429 Usage Limit: too many requests" }),
  });
  assert.equal(autonomous429.status, "skipped", "autonomous runtime 429 is returned to the queue while attempts remain");
  assert.equal(autonomousFailureReason, "rate-limit", "autonomous exhausted 429 uses the typed rate-limit retry reason");

  const rateLimited = await outreachTask("Outreach email to rate-limited prospect");
  const failed = await failTask(null, rateLimited, {
    error: "Provider returned HTTP 429 Usage Limit while sending outreach.",
  }, options);
  assert.equal(failed.failureReason, "rate-limit", "failTask reports the normalized 429 reason");
  assert.equal(failed.retried, true, "rate-limited outreach is re-queued while attempts remain");
  assert.equal(failed.task.status, "ready", "429 retry returns the card to Ready instead of Needs You");
  assert.equal(failed.task.attempt, 2, "retry increments the attempt counter");

  const emptyFinal = await outreachTask("Outreach no-final-response guard");
  const emptyCompletion = await completeTask(null, emptyFinal, {}, options);
  assert.equal(emptyCompletion.blocked, true, "empty outreach completion is blocked");
  assert.equal(emptyCompletion.outreachEvidenceBlocked, true, "block is tagged as outreach evidence guard");
  assert.equal(emptyCompletion.task.status, "needs-human", "empty completion fails closed to Needs You");
  assert.match(emptyCompletion.task.result, /Status: sent\|blocked/, "result tells the worker the required status field");
  // Parked for the OWNER: the human sees a plain-language ask, not the worker-facing
  // "re-run or revise the worker result" retry directive (real leak 2026-07-08).
  assert.doesNotMatch(emptyCompletion.task.result, /Re-run or revise the worker result/i, "needs-human result must not show the worker retry directive to the owner");
  assert.match(emptyCompletion.task.result, /ACTION NEEDED: The crew finished this/i, "needs-human result carries a human-facing ask");

  const sentMissingReceipt = await outreachTask("Outreach sent without receipt guard");
  await assert.rejects(
    patchTask(null, sentMissingReceipt, {
      status: "done",
      result: "Status: sent\nProspect: Example Co\nEvidence: link probed before sending",
    }, options),
    /sent status needs a clear Work Board receipt/i,
    "patch-to-done rejects sent outreach without a receipt",
  );

  const sentGood = await completeTask(null, sentMissingReceipt, {
    result: [
      "Status: sent",
      "Prospect: Example Co",
      "Receipt: provider message id msg_test_123 at 2026-07-07T22:00:00Z",
      "Evidence: booking and offer links probed 200 before sending",
    ].join("\n"),
  }, options);
  assert.equal(sentGood.task.status, "done", "sent outreach with receipt can complete");

  const sentGoodWithRuntimeLearning = await outreachTask("Outreach sent with runtime learning note");
  const sentGoodWith429Learning = await completeTask(null, sentGoodWithRuntimeLearning, {
    result: [
      "Status: sent",
      "Prospect: Example Co",
      "Receipt: provider message id msg_test_429_learning at 2026-07-07T22:05:00Z",
      "Evidence: booking and offer links probed 200 before sending; regression also covers 429 retry safeguards",
    ].join("\n"),
  }, options);
  assert.equal(sentGoodWith429Learning.task.status, "done", "valid sent receipts can mention 429 retry learning without being mistaken for raw runtime failure");

  const blockedMissing = await outreachTask("Outreach blocked without blocker guard");
  const blockedAttempt = await completeTask(null, blockedMissing, {
    result: "Status: blocked\nEvidence: form rejected submit without sender phone",
  }, options);
  assert.equal(blockedAttempt.task.status, "needs-human", "blocked outreach without blocker stays Needs You");
  assert.match(blockedAttempt.task.result, /Blocker:\/ACTION NEEDED:/, "blocked status requires blocker/action-needed field");

  const board = await readBoard(null, options);
  assert.ok(board.events.some((event) => event.kind === "task.outreach-evidence-blocked"), "outreach guard leaves a Work Board event receipt");

  console.log("outreach-runtime-safeguards: all assertions passed");
} finally {
  await rm(vaultPath, { recursive: true, force: true });
}
