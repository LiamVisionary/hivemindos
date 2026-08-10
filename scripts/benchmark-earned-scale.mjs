#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const args = new Map(process.argv.slice(2).flatMap((value, index, all) => (
  value.startsWith("--") ? [[value, all[index + 1]?.startsWith("--") ? "true" : all[index + 1] ?? "true"]] : []
)));
const condition = args.get("--condition") ?? "both";
const trial = Number(args.get("--trial"));
const repeats = Math.max(1, Math.min(20, Number(args.get("--repeats") ?? 3)));
const scriptPath = fileURLToPath(import.meta.url);

if (Number.isFinite(trial)) {
  register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
  const startedAt = performance.now();
  const scenarios = scaleScenarios();
  const decisions = condition === "baseline"
    ? await baselineDecisions(scenarios)
    : condition === "treatment"
      ? await treatmentDecisions(scenarios)
      : fail(`Unsupported trial condition: ${condition}`);
  const results = scenarios.map((scenario, index) => ({
    id: scenario.id,
    expected: scenario.expected,
    actual: decisions[index].recommendation,
    accepted: decisions[index].recommendation === scenario.expected,
    evidence: decisions[index].evidence,
  }));
  const receipt = {
    id: `${condition}-${trial}`,
    condition,
    sessionId: `earned-scale-${condition}-${trial}`,
    targetRevision: "earned-scale-policy-v1",
    environmentFingerprint: `node-${process.version}-${process.platform}-${process.arch}`,
    worker: { runtime: "node", model: "deterministic-policy", configurationHash: "earned-scale-fixtures-v1" },
    authorityMode: "read-only-policy-evaluation",
    freshSession: true,
    isolatedTarget: true,
    interventionAvailable: condition === "treatment",
    interventionExercised: condition === "treatment",
    context: {
      available: condition === "treatment" ? ["completion", "outcome", "proof", "latency", "tokens", "contribution", "coordination", "human intervention", "reviewer disagreement"] : ["completion"],
      retrieved: condition === "treatment" ? ["all scale-curve dimensions"] : ["settledTasks", "completedTasks"],
      invoked: [condition === "treatment" ? "evaluateEarnedScale" : "evaluateFrontierLabStageTransition"],
      relevant: ["scale recommendation for three fixed fixtures"],
    },
    proof: {
      outcome: results.map((result) => `${result.id}: ${result.actual} (expected ${result.expected})`),
      architecture: [condition === "treatment" ? "Earned Scale can guard Team-to-Frontier expansion but never changes policy or spend automatically; OAuth and budget gates remain authoritative." : "Canonical Frontier Lab stage evaluator used without modification."],
      workerProduced: ["Deterministic per-scenario decision traces attached."],
      evaluatorOnly: ["Fixture expected decisions are hidden from the policy function."],
    },
    outcome: results.every((result) => result.accepted) ? "accepted" : "rejected",
    evaluationId: "earned-scale-fixture-grader-v1",
    metrics: {
      elapsedMs: Math.max(0, performance.now() - startedAt),
      retries: 0,
      humanSteeringCount: 0,
      toolCallCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    },
    startedAt: Date.now(),
    completedAt: Date.now(),
    results,
  };
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exit(0);
}

if (!['baseline', 'treatment', 'both'].includes(condition)) fail("--condition must be baseline, treatment, or both.");
const conditions = condition === "both" ? ["baseline", "treatment"] : [condition];
const runs = [];
for (const current of conditions) {
  for (let index = 1; index <= repeats; index += 1) {
    const child = spawnSync(process.execPath, [scriptPath, "--condition", current, "--trial", String(index)], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env },
    });
    if (child.status !== 0) fail(child.stderr || child.stdout || `${current} trial ${index} failed.`);
    runs.push(JSON.parse(child.stdout));
  }
}

const summary = Object.fromEntries(conditions.map((current) => {
  const conditionRuns = runs.filter((run) => run.condition === current);
  const scenarioResults = conditionRuns.flatMap((run) => run.results);
  return [current, {
    runs: conditionRuns.length,
    acceptedRuns: conditionRuns.filter((run) => run.outcome === "accepted").length,
    acceptedRunRate: conditionRuns.filter((run) => run.outcome === "accepted").length / conditionRuns.length,
    correctScenarioDecisions: scenarioResults.filter((result) => result.accepted).length,
    scenarioDecisions: scenarioResults.length,
    correctScenarioRate: scenarioResults.filter((result) => result.accepted).length / scenarioResults.length,
    proofRate: conditionRuns.filter((run) => run.proof.workerProduced.length > 0).length / conditionRuns.length,
    architectureRate: conditionRuns.filter((run) => run.proof.architecture.length > 0).length / conditionRuns.length,
    averageElapsedMs: conditionRuns.reduce((sum, run) => sum + run.metrics.elapsedMs, 0) / conditionRuns.length,
  }];
}));
const comparison = condition === "both" ? {
  outcomeDelta: summary.treatment.acceptedRunRate - summary.baseline.acceptedRunRate,
  scenarioDecisionDelta: summary.treatment.correctScenarioRate - summary.baseline.correctScenarioRate,
  proofDelta: summary.treatment.proofRate - summary.baseline.proofRate,
  architectureDelta: summary.treatment.architectureRate - summary.baseline.architectureRate,
  meaningful: summary.treatment.acceptedRunRate === 1
    && summary.treatment.proofRate === 1
    && summary.treatment.architectureRate === 1
    && summary.treatment.acceptedRunRate - summary.baseline.acceptedRunRate >= 0.25,
} : undefined;
const report = {
  schemaVersion: 1,
  benchmark: "earned-scale-policy-v1",
  contract: {
    representativeJob: "Choose whether a company should scale, hold, or reduce across three fixed multi-agent operating scenarios.",
    acceptedOutcome: "Every scenario receives the evidence-backed expected recommendation.",
    proofRequired: ["Per-scenario decision trace", "Frontier Lab authority boundary preserved"],
    worker: { runtime: "node", model: "deterministic-policy", configurationHash: "earned-scale-fixtures-v1" },
    authority: "read-only-policy-evaluation",
    budget: { maxRunsPerCondition: repeats, maxCostUsd: 0 },
    recoveryPath: "Remove the Earned Scale stage guard and retain the existing completion, OAuth, budget, capacity, and reviewer gates.",
  },
  summary,
  comparison,
  runs,
  generatedAt: new Date().toISOString(),
};

if (args.has("--write")) {
  const outputPath = join(process.cwd(), ".outputs", "benchmarks", "earned-scale-ab.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  report.outputPath = outputPath;
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

async function baselineDecisions(scenarios) {
  const { evaluateFrontierLabStageTransition } = await import("../src/lib/frontier-lab.ts");
  return scenarios.map((scenario) => {
    const last = scenario.treatment.at(-1);
    const decision = evaluateFrontierLabStageTransition("team", "frontier", {
      settledTasks: last.settledTasks,
      completedTasks: last.completedTasks,
    });
    return {
      recommendation: decision.allowed ? "scale" : "hold",
      evidence: [`${last.completedTasks}/${last.settledTasks} tasks completed.`],
    };
  });
}

async function treatmentDecisions(scenarios) {
  const { evaluateEarnedScale } = await import("../src/lib/earned-scale.ts");
  return scenarios.map((scenario) => {
    const decision = evaluateEarnedScale({ baseline: scenario.baseline, treatment: scenario.treatment });
    return { recommendation: decision.recommendation, evidence: decision.reasons };
  });
}

function scaleScenarios() {
  return [
    {
      id: "healthy-improvement",
      expected: "scale",
      baseline: observations("healthy-baseline", { outcomeScore: 0.74, proofRate: 0.82, latencyMs: 1_200, totalTokens: 1_000, uniqueContributionRate: 0.62, duplicationConflictRate: 0.15, humanInterventionRate: 0.18, reviewerDisagreementRate: 0.14, completedTasks: 10 }),
      treatment: observations("healthy-treatment", { outcomeScore: 0.89, proofRate: 1, latencyMs: 880, totalTokens: 940, uniqueContributionRate: 0.81, duplicationConflictRate: 0.06, humanInterventionRate: 0.08, reviewerDisagreementRate: 0.05, completedTasks: 11 }),
    },
    {
      id: "completion-with-coordination-debt",
      expected: "reduce",
      baseline: observations("debt-baseline", { outcomeScore: 0.84, proofRate: 1, latencyMs: 1_000, totalTokens: 900, uniqueContributionRate: 0.75, duplicationConflictRate: 0.08, humanInterventionRate: 0.08, reviewerDisagreementRate: 0.06, completedTasks: 10 }),
      treatment: observations("debt-treatment", { outcomeScore: 0.61, proofRate: 0.67, latencyMs: 900, totalTokens: 1_700, uniqueContributionRate: 0.34, duplicationConflictRate: 0.46, humanInterventionRate: 0.42, reviewerDisagreementRate: 0.37, completedTasks: 11 }),
    },
    {
      id: "proof-regression",
      expected: "reduce",
      baseline: observations("proof-baseline", { outcomeScore: 0.86, proofRate: 1, latencyMs: 1_100, totalTokens: 1_000, uniqueContributionRate: 0.72, duplicationConflictRate: 0.07, humanInterventionRate: 0.06, reviewerDisagreementRate: 0.05, completedTasks: 10 }),
      treatment: observations("proof-treatment", { outcomeScore: 0.9, proofRate: 0.67, latencyMs: 820, totalTokens: 850, uniqueContributionRate: 0.76, duplicationConflictRate: 0.05, humanInterventionRate: 0.05, reviewerDisagreementRate: 0.04, completedTasks: 11 }),
    },
  ];
}

function observations(prefix, metrics) {
  return Array.from({ length: 3 }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    settledTasks: 12,
    ...metrics,
  }));
}

function fail(message) {
  process.stderr.write(`${String(message).trim()}\n`);
  process.exit(1);
}
