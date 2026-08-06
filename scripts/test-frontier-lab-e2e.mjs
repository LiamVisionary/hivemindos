#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { normalizeFrontierLabPolicy } = await import("../src/lib/frontier-lab.ts");
const { readCompanyIntelligenceSnapshot } = await import("../src/lib/services/company-intelligence-usage.ts");
const { buildLoopFromTemplate } = await import("../src/lib/services/loops/index.ts");
const { runQueenBeeAutonomousPickup } = await import("../src/lib/services/queen-bee/autonomous-worker.ts");

const tempRoot = await mkdtemp(join(tmpdir(), "hivemindos-frontier-e2e-"));
const ledgerPath = join(tempRoot, "intelligence.json");
const policy = normalizeFrontierLabPolicy({
  enabled: true,
  stage: "pilot",
  monthlyTokenLimit: 100_000,
  perTaskTokenLimit: 100_000,
  maxParallelTasks: 4,
  maxTasksPerCycle: 4,
  perMachineConcurrency: 1,
  elasticWorkers: true,
  requireIndependentReview: true,
});
const company = {
  id: "co-frontier-e2e",
  name: "Frontier E2E",
  agentIds: ["builder", "reviewer"],
  frozen: false,
  createdAt: new Date().toISOString(),
  createdAtMs: Date.now(),
  updatedAt: new Date().toISOString(),
  frontierLab: policy,
};

const worker = {
  status: "delegated",
  workerClass: "code",
  agent: { id: "builder", name: "Builder", runtime: "hermes", model: "legacy-model", runtimeCapabilities: { chat: true } },
  machine: { key: "builder-mac", device: { name: "Builder Mac", collectorUrl: "http://builder.local:5055" } },
};
const reviewer = {
  status: "delegated",
  workerClass: "qa",
  agent: { id: "reviewer", name: "Reviewer", runtime: "hermes", model: "legacy-reviewer", runtimeCapabilities: { chat: true } },
  machine: { key: "reviewer-mac", device: { name: "Reviewer Mac", collectorUrl: "http://reviewer.local:5055" } },
};

const baseTask = {
  id: "frontier-task-1",
  title: "Implement the checkout boundary",
  body: "Implement and verify the governed checkout boundary with concrete evidence.",
  assignee: "Builder",
  status: "ready",
  priority: "high",
  workspace: "scratch",
  source: `company:${company.id}:run-e2e`,
  skills: ["code", "frontier-lab:tier:builder"],
  loop: buildLoopFromTemplate({ templateId: "research", goal: "Verify the Frontier Lab execution boundary." }),
  attempt: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const calls = [];
const common = {
  getCompany: async (id) => id === company.id ? company : null,
  intelligenceLedgerOptions: { filePath: ledgerPath, now: () => Date.UTC(2026, 7, 2, 12, 0, 0) },
  claim: async (_slug, taskId, input) => {
    calls.push({ kind: "claim", taskId });
    return { task: { ...baseTask, status: "working", claimLock: input.claimer }, board: {} };
  },
  complete: async (_slug, taskId, input) => {
    calls.push({ kind: "complete", taskId });
    assert(input.loopReceipts?.some((receipt) => receipt.verifier === "agent:judge" && receipt.status === "passed"));
    return { task: { ...baseTask, status: "done", result: input.result }, board: {} };
  },
  block: async () => {
    throw new Error("successful Frontier Lab execution must not block");
  },
  reroute: async () => ({ task: { ...baseTask, status: "ready" }, board: {} }),
  fail: async () => ({ task: { ...baseTask, status: "needs-human" }, board: {}, retried: false }),
  fetchJson: async (url, init) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.agent.provider, "openai-codex", "all Frontier Lab turns use the OpenAI OAuth provider slug");
    assert.doesNotMatch(JSON.stringify(body.agent), /openrouter|claude/i);
    if (body.context?.queenBeeLoopJudge) {
      calls.push({ kind: "judge", url, model: body.agent.model });
      assert.equal(url, "http://reviewer.local:5055/chat");
      assert.equal(body.agent.model, "gpt-5.6-sol", "independent review is routed to Sol");
      return {
        text: '{"accepted":true,"confidence":0.95,"reason":"verified","axes":[]}',
        usage: { input_tokens: 15_000, output_tokens: 5_000, total_tokens: 20_000 },
      };
    }
    calls.push({ kind: "worker", url, model: body.agent.model });
    assert.equal(url, "http://builder.local:5055/chat");
    assert.equal(body.agent.model, "gpt-5.6-terra", "builder work is routed to Terra");
    assert.equal(body.context.frontierLabTier, "builder");
    return {
      text: "Implemented the governed checkout boundary and verified it with a focused integration test, exact file evidence, and a reproducible result.",
      usage: { prompt_tokens: 75_000, completion_tokens: 25_000, total_tokens: 100_000 },
    };
  },
};

try {
  const result = await runQueenBeeAutonomousPickup({ task: baseTask, delegation: worker, delegationChain: [worker, reviewer] }, common);
  assert.equal(result.status, "completed");
  assert.deepEqual(calls.map((call) => call.kind), ["claim", "worker", "judge", "complete"]);

  const snapshot = await readCompanyIntelligenceSnapshot(company.id, policy, common.intelligenceLedgerOptions);
  assert.equal(snapshot.settledTokens, 120_000, "worker and reviewer usage are attributed to the same company task reservation");
  assert.equal(snapshot.remainingTokens, 0, "observed overage is preserved and future capacity fails closed");
  assert.equal(snapshot.completedTasks, 1);
  assert.equal(snapshot.byTier.builder.settledTokens, 120_000);

  const blockedTask = { ...baseTask, id: "frontier-task-2", attempt: 1, updatedAt: Date.now() + 1 };
  let blockedReason = "";
  const blocked = await runQueenBeeAutonomousPickup({ task: blockedTask, delegation: worker, delegationChain: [worker, reviewer] }, {
    ...common,
    claim: async () => { throw new Error("budget exhaustion must block before claim or inference"); },
    fetchJson: async () => { throw new Error("budget exhaustion must block before inference"); },
    block: async (_slug, taskId, reason) => {
      assert.equal(taskId, blockedTask.id);
      blockedReason = reason;
      return { task: { ...blockedTask, status: "needs-human", result: reason }, board: {} };
    },
  });
  assert.equal(blocked.status, "blocked");
  assert.match(blockedReason, /token budget/i);

  const disabledCompany = { ...company, id: "co-frontier-disabled", frontierLab: { ...policy, enabled: false } };
  const disabledTask = { ...baseTask, id: "frontier-task-disabled", source: `company:${disabledCompany.id}:run-disabled` };
  let disabledReason = "";
  const disabled = await runQueenBeeAutonomousPickup({ task: disabledTask, delegation: worker, delegationChain: [worker, reviewer] }, {
    ...common,
    getCompany: async (id) => id === disabledCompany.id ? disabledCompany : null,
    claim: async () => { throw new Error("a queued Frontier task must not escape after policy disablement"); },
    fetchJson: async () => { throw new Error("a disabled Frontier task must not reach inference"); },
    block: async (_slug, taskId, reason) => {
      assert.equal(taskId, disabledTask.id);
      disabledReason = reason;
      return { task: { ...disabledTask, status: "needs-human", result: reason }, board: {} };
    },
  });
  assert.equal(disabled.status, "blocked");
  assert.match(disabledReason, /disabled/i);

  const missingPolicyCompany = { ...company, id: "co-frontier-missing-policy", frontierLab: undefined };
  const missingPolicyTask = { ...baseTask, id: "frontier-task-missing-policy", source: `company:${missingPolicyCompany.id}:run-missing` };
  let missingPolicyReason = "";
  const missingPolicy = await runQueenBeeAutonomousPickup({ task: missingPolicyTask, delegation: worker, delegationChain: [worker, reviewer] }, {
    ...common,
    getCompany: async (id) => id === missingPolicyCompany.id ? missingPolicyCompany : null,
    claim: async () => { throw new Error("a tagged task with missing policy must block before claim"); },
    fetchJson: async () => { throw new Error("a tagged task with missing policy must block before inference"); },
    block: async (_slug, taskId, reason) => {
      assert.equal(taskId, missingPolicyTask.id);
      missingPolicyReason = reason;
      return { task: { ...missingPolicyTask, status: "needs-human", result: reason }, board: {} };
    },
  });
  assert.equal(missingPolicy.status, "blocked");
  assert.match(missingPolicyReason, /cannot resolve its company policy/i);

  const legacyTask = {
    ...baseTask,
    id: "legacy-company-task",
    source: `company:${company.id}:run-before-frontier`,
    skills: ["code"],
    updatedAt: Date.now() + 2,
  };
  const legacyModels = [];
  const legacy = await runQueenBeeAutonomousPickup({ task: legacyTask, delegation: worker, delegationChain: [worker, reviewer] }, {
    ...common,
    claim: async (_slug, taskId, input) => ({ task: { ...legacyTask, status: "working", claimLock: input.claimer }, board: {} }),
    complete: async (_slug, taskId, input) => {
      assert(input.loopReceipts?.some((receipt) => receipt.verifier === "agent:judge" && receipt.status === "passed"));
      return { task: { ...legacyTask, status: "done", result: input.result }, board: {} };
    },
    fetchJson: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      legacyModels.push(body.agent.model);
      assert.equal(body.agent.provider, undefined, "an older untagged task keeps its established runtime configuration");
      if (body.context?.queenBeeLoopJudge) {
        return { text: '{"accepted":true,"confidence":0.95,"reason":"verified","axes":[]}' };
      }
      return { text: "Completed the legacy company task without retroactive Frontier routing." };
    },
  });
  assert.equal(legacy.status, "completed");
  assert.deepEqual(legacyModels, ["legacy-model", "legacy-reviewer"]);

  const timeoutLedgerPath = join(tempRoot, "timeout-intelligence.json");
  const timeoutCompany = {
    ...company,
    id: "co-frontier-timeout",
    frontierLab: normalizeFrontierLabPolicy({
      ...policy,
      monthlyTokenLimit: 50_000,
      perTaskTokenLimit: 50_000,
      maxParallelTasks: 1,
    }),
  };
  const timeoutTask = {
    ...baseTask,
    id: "frontier-task-timeout",
    source: `company:${timeoutCompany.id}:run-timeout`,
    updatedAt: Date.now() + 3,
  };
  const timeout = await runQueenBeeAutonomousPickup({ task: timeoutTask, delegation: worker, delegationChain: [worker] }, {
    ...common,
    getCompany: async (id) => id === timeoutCompany.id ? timeoutCompany : null,
    intelligenceLedgerOptions: { filePath: timeoutLedgerPath, now: () => Date.UTC(2026, 7, 2, 12, 30, 0) },
    claim: async (_slug, taskId, input) => ({ task: { ...timeoutTask, status: "working", claimLock: input.claimer }, board: {} }),
    fetchJson: async () => { throw new Error("connection reset after request dispatch"); },
    fail: async () => ({ task: { ...timeoutTask, status: "needs-human" }, board: {}, retried: false }),
    block: async () => ({ task: { ...timeoutTask, status: "needs-human" }, board: {} }),
  });
  assert.equal(timeout.status, "blocked");
  const timeoutSnapshot = await readCompanyIntelligenceSnapshot(timeoutCompany.id, timeoutCompany.frontierLab, {
    filePath: timeoutLedgerPath,
    now: () => Date.UTC(2026, 7, 2, 12, 30, 1),
  });
  assert.equal(timeoutSnapshot.settledTokens, 50_000, "an unobserved response after dispatch conservatively consumes the reservation");
  assert.equal(timeoutSnapshot.estimatedTokens, 50_000);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("Frontier Lab end-to-end pickup, OAuth routing, review, attribution, and budget-stop test passed");
