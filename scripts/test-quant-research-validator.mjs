#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const validator = "scripts/quant-research-validator.py";

function series(count, fn) {
  return Array.from({ length: count }, (_, index) => Number(fn(index).toFixed(10)));
}

const count = 300;
const marketReturns = series(count, (i) => {
  if (i < 100) return -0.0015 + Math.sin(i * 1.7) * 0.004;
  if (i < 200) return Math.sin(i * 1.3) * 0.002;
  return 0.0018 + Math.sin(i * 1.1) * 0.003;
});
const factorReturns = {
  MKT: marketReturns,
  SMB: series(count, (i) => Math.sin(i / 3) * 0.0015),
  HML: series(count, (i) => Math.cos(i / 5) * 0.0012),
  RMW: series(count, (i) => Math.sin(i / 7 + 0.2) * 0.0011),
  CMA: series(count, (i) => Math.cos(i / 9 + 0.4) * 0.0010),
  MOM: series(count, (i) => Math.sin(i / 11 + 0.6) * 0.0014),
  LOW_VOL: series(count, (i) => Math.cos(i / 13 + 0.8) * 0.0009),
};
const assetReturns = series(count, (i) => marketReturns[i] + Math.sin(i / 2.3) * 0.002);
const positions = series(count, (i) => (Math.sin((i - 3) / 11) >= -0.15 ? 1 : -1));
const strongReturns = series(
  count,
  (i) => 0.0022 + 0.08 * marketReturns[i] + Math.sin(i * 2.1) * 0.0012,
);
const siblingReturns = [
  strongReturns,
  series(count, (i) => 0.00015 + Math.sin(i * 1.9) * 0.004),
  series(count, (i) => -0.0001 + Math.cos(i * 1.4) * 0.004),
  series(count, (i) => Math.sin(i * 0.7) * 0.003),
];

function validationRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    researchOnly: true,
    candidateId: "strong-candidate",
    returns: strongReturns,
    inSampleReturns: strongReturns.slice(0, 180),
    outOfSampleReturns: strongReturns.slice(182),
    marketReturns,
    factorReturns,
    positions,
    assetReturns,
    siblingCandidateReturns: siblingReturns,
    otherCandidateReturns: siblingReturns.slice(1),
    trialPValues: [0.000001, 0.12, 0.41, 0.78],
    claimedMetrics: {
      meanReturn: strongReturns.reduce((sum, value) => sum + value, 0) / strongReturns.length,
    },
    costs: { commissionBps: 0, slippageBps: 0, annualBorrowBps: 0 },
    policy: {
      minObservations: 120,
      minHacTStat: 1,
      maxHacPValue: 0.5,
      maxFdrQValue: 0.5,
      bootstrapIterations: 1_000,
      bootstrapBlockSize: 8,
      placeboIterations: 500,
      maxPlaceboPValue: 0.5,
      maxOosSharpeDegradation: 0.9,
      maxProbabilityBacktestOverfit: 0.9,
      minPositiveRegimes: 1,
      maxSingleRegimePnlShare: 0.95,
      minFactorAlphaTStat: 1,
      hacLags: 1,
      hmmStates: 3,
      hmmIterations: 10,
      seed: 17,
    },
    ...overrides,
  };
}

function run(input) {
  const result = spawnSync("python3", [validator], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const first = run(validationRequest());
const second = run(validationRequest());
assert.deepEqual(first, second, "fixed-seed validation must be deterministic");
assert.equal(first.validator, "hivemindos-python-independent-validator");
assert.equal(first.researchOnly, true);
assert.equal(first.regimeModel.kind, "gaussian-hmm");
assert.deepEqual(first.regimeModel.features, ["marketReturn", "trailingVolatility"]);
for (const gate of [
  "minimum_observations",
  "hac_significance",
  "block_bootstrap",
  "multiple_testing_fdr",
  "oos_degradation",
  "probability_backtest_overfit",
  "signal_placebo",
  "factor_residual_alpha",
  "regime_robustness",
  "metric_reconciliation",
]) {
  assert.ok(first.gates.some((item) => item.id === gate), `missing validation gate ${gate}`);
}
assert.ok(Number.isFinite(first.statistics.hacTStat));
assert.equal(first.statistics.bootstrap.iterations, 10_000, "the validator must independently enforce the bootstrap floor");
assert.equal(first.statistics.placebo.iterations, 2_000, "the validator must independently enforce the placebo floor");
assert.equal(first.statistics.hac.lags, 5, "the validator must independently enforce the HAC lag floor");
assert.equal(first.regimeModel.iterations, 40, "the validator must independently enforce the HMM iteration floor");
assert.equal(first.gates.find((item) => item.id === "minimum_observations").threshold.min, 252);
assert.equal(first.gates.find((item) => item.id === "hac_significance").threshold.minAbsTStat, 3);
assert.equal(first.gates.find((item) => item.id === "multiple_testing_fdr").threshold.maxQValue, 0.05);
assert.equal(first.statistics.pbo.coverage, "complete");
assert.equal(first.factorModel.coverage, "complete");
assert.equal(first.regimeModel.coverage, "complete");

const weak = run(validationRequest({
  candidateId: "weak-candidate",
  returns: series(count, (i) => Math.sin(i * 1.73) * 0.003),
  inSampleReturns: series(180, (i) => 0.002 + Math.sin(i) * 0.001),
  outOfSampleReturns: series(118, (i) => -0.001 + Math.cos(i) * 0.002),
  trialPValues: [0.2, 0.3, 0.4, 0.5],
  claimedMetrics: { meanReturn: 99 },
}));
assert.equal(weak.passed, false, "weak, degraded, mismatched research must fail closed");
assert.ok(weak.failedGateIds.includes("hac_significance"));
assert.ok(weak.failedGateIds.includes("oos_degradation"));
assert.ok(weak.failedGateIds.includes("metric_reconciliation"));

const uncovered = run(validationRequest({ factorReturns: undefined }));
assert.equal(uncovered.passed, false, "missing factor coverage must not be treated as zero alpha exposure");
assert.ok(uncovered.failedGateIds.includes("factor_residual_alpha"));

const partialFactors = { ...factorReturns };
delete partialFactors.LOW_VOL;
const partialCoverage = run(validationRequest({ factorReturns: partialFactors }));
assert.equal(partialCoverage.passed, false, "partial article factor coverage must fail closed");
assert.ok(partialCoverage.failedGateIds.includes("factor_residual_alpha"));

console.log("Quant research Python validator contract passed.");
