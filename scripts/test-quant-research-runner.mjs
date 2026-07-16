#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const runner = await import("../src/lib/services/quant-research/runner.ts");

function buildFixture(count = 300) {
  let close = 100;
  const bars = [];
  for (let index = 0; index < count; index += 1) {
    const regime = index < 100 ? -0.0004 : index < 200 ? 0.0002 : 0.0012;
    const assetReturn = regime + Math.sin(index / 8) * 0.003;
    close *= 1 + assetReturn;
    bars.push({
      date: new Date(Date.UTC(2023, 0, index + 1)).toISOString().slice(0, 10),
      symbol: "TEST",
      close: Number(close.toFixed(8)),
      volume: 2_000_000 + index * 500,
    });
  }
  const marketReturns = bars.slice(1).map((bar, index) => bar.close / bars[index].close - 1);
  return {
    bars,
    marketReturns,
    factorReturns: {
      MKT: marketReturns,
      SMB: marketReturns.map((_, index) => Math.sin(index / 3) * 0.001),
      HML: marketReturns.map((_, index) => Math.cos(index / 5) * 0.001),
      RMW: marketReturns.map((_, index) => Math.sin(index / 7 + 0.2) * 0.001),
      CMA: marketReturns.map((_, index) => Math.cos(index / 9 + 0.4) * 0.001),
      MOM: marketReturns.map((_, index) => Math.sin(index / 11 + 0.6) * 0.001),
      LOW_VOL: marketReturns.map((_, index) => Math.cos(index / 13 + 0.8) * 0.001),
    },
  };
}

const fixture = buildFixture();
const request = {
  schemaVersion: 1,
  researchOnly: true,
  dataset: {
    id: "integration-fixture-v1",
    source: "test fixture",
    asOf: "2025-01-01T00:00:00Z",
    pointInTime: true,
    survivorshipBiasControlled: true,
    adjustedPrices: "split-and-dividend-adjusted",
    bars: fixture.bars,
  },
  candidates: [
    {
      id: "momentum-12",
      hypothesis: "Persistent twelve-day moves continue after a one-bar execution lag.",
      economicRationale: "Slow information diffusion.",
      strategy: { id: "momentum-12", signal: { kind: "momentum", lookback: 12, threshold: 0 }, executionLagBars: 1, allowShort: true },
    },
    {
      id: "mean-reversion-6",
      hypothesis: "Short six-day dislocations mean revert after a one-bar lag.",
      economicRationale: "Temporary liquidity pressure.",
      strategy: { id: "mean-reversion-6", signal: { kind: "mean-reversion", lookback: 6, threshold: 0 }, executionLagBars: 1, allowShort: true },
    },
    {
      id: "moving-average-20",
      hypothesis: "Price above a twenty-day average identifies a persistent state.",
      economicRationale: "Gradual portfolio rebalancing.",
      strategy: { id: "moving-average-20", signal: { kind: "moving-average", lookback: 20, threshold: 0 }, executionLagBars: 1, allowShort: true },
    },
  ],
  costs: { commissionBps: 1, slippageBps: 2, annualBorrowBps: 50 },
  split: { trainFraction: 0.6, purgeBars: 5 },
  validation: {
    marketReturns: fixture.marketReturns,
    factorReturns: fixture.factorReturns,
    policy: { seed: 29, bootstrapIterations: 1_000, placeboIterations: 500 },
  },
  assignments: {
    "idea-generator": { agentId: "research", provider: "openai", model: "gpt-5" },
    "feature-engineer": { agentId: "code", provider: "anthropic", model: "claude-opus-4-1" },
    validator: { agentId: "qa", provider: "google", model: "gemini-2.5-pro" },
  },
};

const runRoot = mkdtempSync(join(tmpdir(), "quant-runner-"));
const result = await runner.executeQuantResearchRun(request, {
  runRoot,
  runId: "integration-run",
});
assert.equal(result.status, "completed");
assert.equal(result.researchOnly, true);
assert.equal(result.liveTradingEnabled, false);
assert.equal(result.candidates.length, 3);
assert.equal(result.audits.length, 3);
assert.ok(existsSync(result.manifestPath));
assert.ok(existsSync(result.reportPath));
const report = readFileSync(result.reportPath, "utf8");
assert.match(report, /integration-fixture-v1/);
assert.match(report, /Candidate decisions/);
assert.match(report, /Failed gates/);
assert.match(report, /[a-f0-9]{64}/);
for (const candidate of result.candidates) {
  assert.ok(existsSync(candidate.backtestArtifactPath));
  assert.ok(existsSync(candidate.validationArtifactPath));
  assert.match(candidate.backtestArtifactHash, /^[a-f0-9]{64}$/);
  assert.match(candidate.validationArtifactHash, /^[a-f0-9]{64}$/);
  const validation = JSON.parse(readFileSync(candidate.validationArtifactPath, "utf8"));
  assert.equal(validation.researchOnly, true);
  assert.ok(validation.gates.some((gate) => gate.id === "multiple_testing_fdr"));
  assert.equal(validation.statistics.pbo.coverage, "complete");
}
const persisted = JSON.parse(readFileSync(result.manifestPath, "utf8"));
assert.equal(persisted.liveTradingEnabled, false);
assert.equal(persisted.dataset.id, "integration-fixture-v1");
assert.equal(persisted.validationPolicy.minHacTStat, 3, "run policy must enforce the article-strengthened t-stat floor");
assert.equal(persisted.validationPolicy.bootstrapIterations, 10_000, "weak caller bootstrap settings must be raised to the hard floor");

const listed = await runner.listQuantResearchRuns({ runRoot });
assert.equal(listed.length, 1);
assert.equal(listed[0].runId, "integration-run");
const loaded = await runner.getQuantResearchRun("integration-run", { runRoot });
assert.equal(loaded?.runId, "integration-run");
await assert.rejects(
  () => runner.executeQuantResearchRun(request, { runRoot, runId: "integration-run" }),
  /already exists/i,
  "run ids must be append-only so prior lineage cannot be overwritten",
);

await assert.rejects(
  () => runner.executeQuantResearchRun({
    ...request,
    validation: {
      ...request.validation,
      marketReturns: request.validation.marketReturns.slice(1),
    },
  }, { runRoot, runId: "failed-alignment" }),
  /marketReturns.*expected/i,
);
const failedRun = await runner.getQuantResearchRun("failed-alignment", { runRoot });
assert.equal(failedRun?.status, "failed", "failed research must retain queryable lineage");
assert.match(failedRun?.failureReason ?? "", /marketReturns.*expected/i);
assert.deepEqual(failedRun?.rejectedCandidateIds, request.candidates.map((candidate) => candidate.id));
assert.ok(existsSync(failedRun?.reportPath));

await assert.rejects(
  () => runner.executeQuantResearchRun({ ...request, researchOnly: false }, { runRoot, runId: "live" }),
  /research.only/i,
);
const partialFactors = { ...request.validation.factorReturns };
delete partialFactors.LOW_VOL;
await assert.rejects(
  () => runner.executeQuantResearchRun({
    ...request,
    validation: { ...request.validation, factorReturns: partialFactors },
  }, { runRoot, runId: "partial-factors" }),
  /factor.*LOW_VOL/i,
);
await assert.rejects(
  () => runner.executeQuantResearchRun({
    ...request,
    assignments: {
      "idea-generator": { agentId: "research", provider: "openai", model: "gpt-5" },
      validator: { agentId: "research", provider: "openai", model: "gpt-5" },
    },
  }, { runRoot, runId: "self-review" }),
  /independent/i,
);

console.log("Quant research real runner integration passed.");
