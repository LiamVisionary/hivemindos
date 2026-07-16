#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const policy = await import("../src/lib/services/quant-research/policy.ts");
const workflow = await import("../src/lib/services/quant-research/workflow.ts");

assert.deepEqual(
  policy.QUANT_RESEARCH_ROLE_MATRIX.map((role) => role.id),
  [
    "idea-generator",
    "feature-engineer",
    "backtester",
    "validator",
    "regime-auditor",
    "factor-decomposer",
  ],
);
assert.equal(policy.QUANT_RESEARCH_POLICY.researchOnly, true);
assert.equal(policy.QUANT_RESEARCH_POLICY.liveTradingEnabled, false);
assert.deepEqual(policy.QUANT_RESEARCH_POLICY.requiredFactorSeries, [
  "MKT", "SMB", "HML", "RMW", "CMA", "MOM", "LOW_VOL",
]);
assert.equal(policy.QUANT_RESEARCH_ROLE_MATRIX.find((role) => role.id === "backtester").implementation, "rust");
assert.equal(policy.QUANT_RESEARCH_ROLE_MATRIX.find((role) => role.id === "validator").implementation, "python");

const sameMakerChecker = policy.validateQuantResearchAssignments({
  "idea-generator": { agentId: "research", provider: "openai", model: "gpt-5" },
  "feature-engineer": { agentId: "code", provider: "openai", model: "gpt-5" },
  validator: { agentId: "research", provider: "openai", model: "gpt-5" },
});
assert.equal(sameMakerChecker.ok, false);
assert.match(sameMakerChecker.errors.join("\n"), /independent/i);

const independent = policy.validateQuantResearchAssignments({
  "idea-generator": { agentId: "research", provider: "openai", model: "gpt-5" },
  "feature-engineer": { agentId: "code", provider: "anthropic", model: "claude-opus-4-1" },
  validator: { agentId: "qa", provider: "google", model: "gemini-2.5-pro" },
});
assert.equal(independent.ok, true, independent.errors?.join("\n"));

const graph = workflow.buildQuantResearchWorkflow({ candidateIds: ["a", "b", "c"] });
assert.equal(graph.researchOnly, true);
assert.deepEqual(graph.stages.map((stage) => stage.id), [
  "idea-generation",
  "feature-engineering",
  "backtesting",
  "independent-validation",
  "robustness-audits",
  "synthesis",
]);
assert.equal(graph.stages.find((stage) => stage.id === "backtesting").mode, "parallel-map");
assert.equal(graph.stages.find((stage) => stage.id === "robustness-audits").mode, "parallel-fan-in");

const runRoot = mkdtempSync(join(tmpdir(), "quant-workflow-"));
let active = 0;
let peak = 0;
const result = await workflow.runQuantResearchWorkflow({
  runRoot,
  runId: "test-run",
  candidateIds: ["a", "b", "c"],
  executeCandidate: async (candidateId) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return { candidateId, passed: candidateId !== "c", artifactHash: `hash-${candidateId}` };
  },
  executeAudits: async (candidate) => ({
    candidateId: candidate.candidateId,
    regimePassed: candidate.passed,
    factorPassed: candidate.passed,
  }),
});
assert.ok(peak > 1, "candidate stage should execute in parallel");
assert.equal(result.status, "completed");
assert.equal(result.promotedCandidateIds.length, 2);
assert.equal(result.rejectedCandidateIds.length, 1);
assert.match(result.manifestPath, /manifest\.json$/);
assert.equal(result.graph.stages.at(-1).mode, "barrier");

console.log("Quant research workflow policy contract passed.");
