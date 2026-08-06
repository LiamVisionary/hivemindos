#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const simulation = await import("../src/lib/services/penny-stock-paper/simulation.ts");
const research = await import("../src/lib/services/penny-stock-paper/research.ts");
const evolution = await import("../src/lib/services/penny-stock-paper/evolution.ts");
const runner = await import("../src/lib/services/penny-stock-paper/runner.ts");
const cadence = await import("../src/lib/services/penny-stock-paper/cadence.ts");
const executionResearch = await import(
  "../src/lib/services/penny-stock-paper/execution-research.ts"
);
const statistics = await import("../src/lib/services/penny-stock-paper/statistics.ts");
const outcomesService = await import("../src/lib/services/penny-stock-paper/outcomes.ts");
const riskIntelligence = await import(
  "../src/lib/services/penny-stock-paper/risk-intelligence.ts"
);

const zeroCost = {
  startingCashUsd: 100,
  notionalUsdPerSymbol: 100,
  executionCostBpsPerSide: 0,
};

{
  const bars = [
    bar("2026-01-02", 0.1, 0.105, 0.095, 0.1, 1_000_000),
    bar("2026-01-03", 0.08, 0.09, 0.071, 0.08, 1_000_000),
    bar("2026-01-04", 0.08, 0.09, 0.069, 0.08, 1_000_000),
    bar("2026-01-05", 0.08, 0.101, 0.075, 0.1, 1_000_000),
  ];
  const result = simulation.simulatePennyLimitPortfolio({
    barsBySymbol: { TEST: bars },
    strategy: simulation.DEFAULT_PENNY_PAPER_STRATEGY,
    assumptions: zeroCost,
  });
  const buy = result.trades.find((trade) => trade.side === "buy");
  const sell = result.trades.find((trade) => trade.side === "sell");
  assert.equal(buy?.date, "2026-01-04", "standing limit must not fill before the low reaches the limit");
  assert.equal(buy?.priceUsd, 0.07, "an intraday limit touch fills conservatively at the limit");
  assert.equal(sell?.date, "2026-01-05");
  assert.equal(sell?.reason, "take-profit");
  assert.ok(result.totalPnlUsd > 0);
}

{
  const strategy = {
    entryDiscountPct: 10,
    takeProfitPct: 10,
    stopLossPct: 10,
    maxHoldDays: 10,
    orderExpiryDays: 10,
  };
  const bars = [
    bar("2026-03-01", 1, 1.01, 0.99, 1, 1_000_000),
    bar("2026-03-02", 0.9, 0.92, 0.88, 0.9, 1_000_000),
    bar("2026-03-03", 1, 1.02, 0.98, 1, 1_000_000),
  ];
  const quotes = [
    quote("2026-03-02T15:00:00Z", 0.895, 0.9, 25, 20),
    quote("2026-03-03T15:00:00Z", 1, 1.01, 50_000, 50_000),
  ];
  const result = simulation.simulatePennyLimitPortfolio({
    barsBySymbol: { TEST: bars },
    quotesBySymbol: { TEST: quotes },
    strategy,
    assumptions: {
      ...zeroCost,
      adverseSelectionBps: 0,
      maximumQuoteParticipationPct: 10,
    },
  });
  const buy = result.trades.find((trade) => trade.side === "buy");
  assert.equal(buy?.executionModel, "sip-quote");
  assert.ok((buy?.fillRatioPct ?? 100) < 5, "displayed quote size must cause a partial fill");
  assert.equal(result.partialFills, 1);
}

{
  const evidence = executionResearch.summarizeQuoteExecution([
    quote("2026-03-01T15:00:00Z", 0.09, 0.1, 1_000, 800),
    quote("2026-03-01T15:01:00Z", 0.095, 0.1, 900, 700),
  ], 0.1);
  assert.equal(evidence.source, "alpaca-sip-quotes");
  assert.equal(evidence.quoteObservations, 2);
  assert.ok((evidence.medianSpreadBps ?? 0) > 0);
}

{
  const fetchFn = async (rawUrl) => {
    const url = String(rawUrl);
    if (url.includes("company_tickers.json")) {
      return jsonResponse({ 0: { ticker: "TA", cik_str: 123 } });
    }
    if (url.includes("/submissions/")) {
      return jsonResponse({
        filings: {
          recent: {
            form: ["10-Q"],
            filingDate: ["2026-05-01"],
            accessionNumber: ["0000000123-26-000001"],
            primaryDocument: ["ta-10q.htm"],
          },
        },
      });
    }
    if (url.includes("/companyfacts/")) {
      return jsonResponse({
        facts: {
          dei: {
            EntityCommonStockSharesOutstanding: {
              units: {
                shares: [
                  { val: 50, end: "2025-01-01", filed: "2025-02-01", form: "10-K" },
                  { val: 200, end: "2026-04-01", filed: "2026-05-01", form: "10-Q" },
                ],
              },
            },
          },
          "us-gaap": {
            CashAndCashEquivalentsAtCarryingValue: {
              units: {
                USD: [
                  { val: 100, end: "2026-04-01", filed: "2026-05-01", form: "10-Q" },
                ],
              },
            },
            NetCashProvidedByUsedInOperatingActivities: {
              units: {
                USD: [
                  {
                    val: -1_000,
                    start: "2026-01-01",
                    end: "2026-04-01",
                    filed: "2026-05-01",
                    form: "10-Q",
                  },
                ],
              },
            },
          },
        },
      });
    }
    if (url.includes("/Archives/edgar/")) {
      return new Response(
        "<html>Management found substantial doubt about our ability to continue as a going concern. The board also approved a reverse stock split.</html>",
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }
    if (url.includes("/corporate-actions")) {
      return jsonResponse({
        reverse_splits: [{ symbol: "TA", process_date: "2026-06-01" }],
      });
    }
    return new Response("not found", { status: 404 });
  };
  const result = await riskIntelligence.fetchPennyRiskIntelligence({
    symbols: ["TA"],
    asOf: new Date("2026-07-01T00:00:00.000Z"),
    alpacaHeaders: {},
    fetchFn,
  });
  assert.ok(result.filings.TA.vetoReasons.length >= 3);
  assert.ok(result.filings.TA.riskEvidence.some((row) => row.flag === "going-concern"));
  assert.equal(result.corporateActions.TA[0].type, "reverse_split");
  const updates = await riskIntelligence.fetchPennyRiskUpdateSignals({
    symbols: ["TA"],
    asOf: new Date("2026-07-01T00:00:00.000Z"),
    alpacaHeaders: {},
    fetchFn,
  });
  assert.equal(updates.TA.secCoverage, "available");
  assert.equal(updates.TA.corporateActionCoverage, "available");
  assert.equal(updates.TA.filingMarkers[0].form, "10-Q");
  assert.match(updates.TA.filingMarkers[0].sourceUrl, /Archives\/edgar/);
}

{
  const boilerplate = riskIntelligence.classifyPennySecRiskText({
    flag: "reverse-split",
    text: "The merger agreement provides a proportionate conversion-price adjustment in the event of any stock split or reverse stock split.",
  });
  assert.equal(boilerplate.eventStatus, "boilerplate");
  assert.equal(boilerplate.severity, "info");
  const conditional = riskIntelligence.classifyPennySecRiskText({
    flag: "reverse-split",
    text: "The company may effect a reverse stock split if necessary to regain compliance with the minimum bid price rule.",
  });
  assert.equal(conditional.eventStatus, "conditional");
  assert.equal(conditional.severity, "warning");
  const confirmed = riskIntelligence.classifyPennySecRiskText({
    flag: "reverse-split",
    text: "Following the reverse stock split, every twenty pre-split shares became one common share.",
  });
  assert.equal(confirmed.eventStatus, "confirmed");
  assert.equal(confirmed.severity, "veto");
}

{
  const strategy = {
    entryDiscountPct: 10,
    takeProfitPct: 20,
    stopLossPct: 10,
    maxHoldDays: 10,
    orderExpiryDays: 10,
  };
  const bars = [
    bar("2026-02-01", 1, 1.01, 0.99, 1, 1_000_000),
    bar("2026-02-02", 0.9, 0.92, 0.89, 0.9, 1_000_000),
    bar("2026-02-03", 0.9, 1.2, 0.75, 1, 1_000_000),
  ];
  const result = simulation.simulatePennyLimitPortfolio({
    barsBySymbol: { TEST: bars },
    strategy,
    assumptions: zeroCost,
  });
  assert.equal(
    result.trades.find((trade) => trade.side === "sell")?.reason,
    "stop-loss",
    "when a daily bar crosses both exits, the simulator must assume the stop happened first",
  );
}

{
  const universe = Array.from({ length: 12 }, (_, index) => ({
    symbol: `T${String.fromCharCode(65 + index)}`,
    name: `Test ${index} Common Stock`,
    exchange: "NASDAQ",
    country: "United States",
    sector: index % 2 ? "Technology" : "Health Care",
    industry: "Testing",
    priceUsd: 0.2 + index * 0.02,
    marketCapUsd: 10_000_000 + index * 10_000_000,
    currentVolume: 200_000 + index * 100_000,
  }));
  const barsBySymbol = Object.fromEntries(universe.map((row, index) => [
    row.symbol,
    makeResearchBars(90, row.priceUsd, 200_000 + index * 150_000, index),
  ]));
  const ranked = research.rankPennyStockCandidates({ universe, barsBySymbol });
  assert.equal(ranked.length, 12);
  assert.deepEqual(ranked.map((row) => row.rank), Array.from({ length: 12 }, (_, index) => index + 1));
  assert.ok(ranked[0].score >= ranked.at(-1).score);
  assert.equal(ranked[0].bars90, 90);
  assert.ok(ranked.every((row) => row.methodEvidence.observations === 89));
}

{
  const universe = [{
    symbol: "HASH",
    name: "Hash Common Stock",
    exchange: "NASDAQ",
    country: "United States",
    sector: "Technology",
    industry: "Testing",
    priceUsd: 0.1,
    marketCapUsd: 10_000_000,
    currentVolume: 1_000_000,
  }];
  const candidates = [fixtureResearchRow(0)];
  const first = runner.pennyResearchSnapshotIdentityHash({
    universe,
    rankedCandidates: candidates,
  });
  const repeated = runner.pennyResearchSnapshotIdentityHash({
    universe: structuredClone(universe),
    rankedCandidates: structuredClone(candidates),
  });
  const changed = runner.pennyResearchSnapshotIdentityHash({
    universe: [{ ...universe[0], currentVolume: 1_000_001 }],
    rankedCandidates: candidates,
  });
  assert.equal(first, repeated, "run metadata must not make an unchanged data snapshot look new");
  assert.notEqual(first, changed, "a changed data snapshot must receive a new identity");
}

{
  const runRoot = await mkdtemp(join(tmpdir(), "penny-paper-review-"));
  const runId = "review-test";
  const runDirectory = join(runRoot, "runs", runId);
  await mkdir(runDirectory, { recursive: true });
  const candidates = Array.from({ length: 10 }, (_, index) => fixtureResearchRow(index));
  const artifact = {
    schemaVersion: 2,
    runId,
    researchedAt: "2026-01-01T00:00:00.000Z",
    asOf: "2026-01-01T00:00:00.000Z",
    universe: {
      minimumPriceUsd: 0.02,
      maximumPriceUsd: 1,
      minimumMarketCapUsd: 5_000_000,
      maximumMarketCapUsd: 300_000_000,
      minimumCurrentVolume: 100_000,
      eligibleBeforeHistory: 20,
      historyCandidates: 20,
      snapshotPath: join(runRoot, "snapshot.json"),
      snapshotHash: "b".repeat(64),
      pointInTimeCoverage: "current-snapshot-only",
    },
    method: {
      description: "fixture",
      baselineStrategy: simulation.DEFAULT_PENNY_PAPER_STRATEGY,
      selectorWeights: research.DEFAULT_PENNY_SELECTOR_WEIGHTS,
    },
    candidates,
    dataSources: [],
    limitations: [],
    artifactHash: "a".repeat(64),
    researchOnly: true,
    liveTradingEnabled: false,
  };
  await writeFile(join(runDirectory, "research.json"), JSON.stringify(artifact));
  const reviewed = await runner.reviewPennyStockSelection({
    runRoot,
    runId,
    symbols: ["TA", "TB", "TC"],
    reviewedBy: "test reasoner",
    rationale: "Select three fixture names with distinct evidence for a paper-only test.",
  });
  assert.deepEqual(reviewed.selection.selectedSymbols, ["TA", "TB", "TC"]);
  assert.equal(reviewed.selection.researchOnly, true);
  await assert.rejects(
    () => runner.reviewPennyStockSelection({
      runRoot,
      runId,
      symbols: ["TA", "TB", "TC"],
      reviewedBy: "test reasoner",
      rationale: "A second review must not overwrite the first append-only selection.",
    }),
    /append-only/i,
  );
  const persisted = JSON.parse(await readFile(reviewed.path, "utf8"));
  assert.equal(persisted.researchArtifactHash, artifact.artifactHash);

  const cashRunId = "cash-review-test";
  const cashRunDirectory = join(runRoot, "runs", cashRunId);
  await mkdir(cashRunDirectory, { recursive: true });
  await writeFile(
    join(cashRunDirectory, "research.json"),
    JSON.stringify({ ...artifact, runId: cashRunId }),
  );
  const cash = await runner.reviewPennyStockSelection({
    runRoot,
    runId: cashRunId,
    symbols: [],
    reviewedBy: "test reasoner",
    rationale: "Hold cash because no paper candidate is required to be selected.",
  });
  assert.deepEqual(cash.selection.selectedSymbols, []);
  assert.equal(cash.selection.heldCash, true);
  assert.deepEqual(runner.reasonPennyStockSelection(artifact), ["TJ", "TI", "TH"]);

  const vetoRunId = "veto-review-test";
  const vetoRunDirectory = join(runRoot, "runs", vetoRunId);
  await mkdir(vetoRunDirectory, { recursive: true });
  await writeFile(
    join(vetoRunDirectory, "research.json"),
    JSON.stringify({
      ...artifact,
      runId: vetoRunId,
      candidates: [
        {
          ...candidates[0],
          vetoed: true,
          vetoReasons: ["Recent reverse split."],
        },
        ...candidates.slice(1),
      ],
    }),
  );
  await assert.rejects(
    () => runner.reviewPennyStockSelection({
      runRoot,
      runId: vetoRunId,
      symbols: ["TA"],
      reviewedBy: "test reasoner",
      rationale: "This should be blocked by the evidence-based hard veto.",
    }),
    /blocked by evidence vetoes/i,
  );

  const quarantineRunId = "quarantine-review-test";
  const quarantineRunDirectory = join(runRoot, "runs", quarantineRunId);
  await mkdir(quarantineRunDirectory, { recursive: true });
  await writeFile(
    join(quarantineRunDirectory, "research.json"),
    JSON.stringify({
      ...artifact,
      runId: quarantineRunId,
      candidates: [
        {
          ...candidates[0],
          reviewRequired: true,
          reviewReasons: ["Conditional reverse-split evidence needs resolution."],
        },
        ...candidates.slice(1),
      ],
    }),
  );
  await assert.rejects(
    () => runner.reviewPennyStockSelection({
      runRoot,
      runId: quarantineRunId,
      symbols: ["TA"],
      reviewedBy: "test reasoner",
      rationale: "Unresolved issuer evidence must remain quarantined from the paper basket.",
    }),
    /quarantined pending issuer-risk review/i,
  );

  const failedRunDirectory = join(runRoot, "runs", "failed-run");
  await mkdir(failedRunDirectory, { recursive: true });
  await writeFile(
    join(failedRunDirectory, "failure.json"),
    JSON.stringify({ failedAt: "2026-01-01T00:00:00.000Z" }),
  );
  const failedRun = (await runner.listPennyPaperRuns({ runRoot }))
    .find((run) => run.runId === "failed-run");
  assert.equal(failedRun?.status, "failed");

  await mkdir(join(runRoot, "runs", "incomplete-run"), { recursive: true });
  const incompleteRun = (await runner.listPennyPaperRuns({ runRoot }))
    .find((run) => run.runId === "incomplete-run");
  assert.equal(incompleteRun?.status, "incomplete");
}

{
  const runRoot = await mkdtemp(join(tmpdir(), "penny-paper-cadence-"));
  const runId = "cadence-source";
  const runDirectory = join(runRoot, "runs", runId);
  await mkdir(runDirectory, { recursive: true });
  const artifact = fixtureResearchArtifact(runRoot, runId, "2026-07-28T20:30:00.000Z");
  await writeFile(join(runDirectory, "research.json"), JSON.stringify(artifact));
  await writeFile(join(runDirectory, "manifest.json"), JSON.stringify({
    schemaVersion: 2,
    runId,
    status: "completed",
    selectedSymbols: ["TA"],
    researchOnly: true,
    liveTradingEnabled: false,
  }));
  const filingMarker = {
    form: "8-K",
    filedAt: "2026-07-29",
    accessionNumber: "0000000001-26-000001",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/1/test.htm",
  };
  const evidenceAt = (quoteEndAt) => ({
    execution: Object.fromEntries(artifact.candidates.map((candidate) => [
      candidate.symbol,
      {
        ...candidate.executionEvidence,
        quoteEndAt,
        p90SpreadBps: candidate.symbol === "TA" ? 1_800 : 220,
        estimatedFillRatioPct: candidate.symbol === "TA" ? 20 : 70,
      },
    ])),
    riskUpdates: Object.fromEntries(artifact.candidates.map((candidate) => [
      candidate.symbol,
      {
        cik: candidate.symbol === "TA" ? "0000000001" : null,
        filingMarkers: candidate.symbol === "TA" ? [filingMarker] : [],
        corporateActions: [],
        secCoverage: candidate.symbol === "TA" ? "available" : "missing",
        corporateActionCoverage: "available",
      },
    ])),
    refreshedFilings: {
      TA: {
        ...artifact.candidates[0].filings,
        cik: "0000000001",
        latestEventForm: "8-K",
        latestEventFiledAt: "2026-07-29",
        vetoReasons: ["Recent 8-K describes a reverse split."],
        coverage: "complete",
      },
    },
    deepRiskRefreshSymbols: ["TA"],
  });
  const first = await cadence.runPennyStockEvidenceMonitor({
    runRoot,
    monitorId: "monitor-fixture",
    asOf: new Date("2026-07-29T15:30:00.000Z"),
    evidenceProvider: async () => evidenceAt("2026-07-29T15:10:00.000Z"),
  });
  assert.equal(first.status, "recorded");
  assert.equal(first.artifact.policyMutationAllowed, false);
  assert.equal(first.artifact.deepRiskRefreshSymbols[0], "TA");
  assert.ok(first.artifact.materialAlerts.some((value) => value.includes("New SEC markers")));
  assert.equal(first.artifact.marketSession.withinScheduledRegularHours, true);

  const skipped = await cadence.runPennyStockEvidenceMonitor({
    runRoot,
    monitorId: "monitor-fixture-same-evidence",
    asOf: new Date("2026-07-29T16:30:00.000Z"),
    evidenceProvider: async (input) => {
      assert.ok(input.knownFilingKeys.TA.includes(
        riskIntelligence.pennyFilingMarkerKey(filingMarker),
      ));
      return evidenceAt("2026-07-29T15:10:00.000Z");
    },
  });
  assert.equal(skipped.status, "skipped");

  await assert.rejects(
    () => cadence.runPennyStockEvidenceMonitor({
      runRoot,
      monitorId: "monitor-fixture",
      asOf: new Date("2026-07-29T17:30:00.000Z"),
      evidenceProvider: async () => evidenceAt("2026-07-29T17:10:00.000Z"),
    }),
    /append-only/i,
  );

  await writeFile(join(runDirectory, "evolution.json"), JSON.stringify({
    schemaVersion: 2,
    decision: "rejected",
    baselineAggregatePnlUsd: -2,
    treatmentAggregatePnlUsd: 1,
    treatmentMaxDrawdownPct: 8,
    gates: {
      enoughForwardWindows: true,
      positiveAggregatePnl: true,
      placebo: false,
    },
    statisticalEvidence: {
      costStress: [
        { multiplier: 1, pnlUsd: 1, maxDrawdownPct: 8 },
        { multiplier: 2, pnlUsd: -1, maxDrawdownPct: 9 },
        { multiplier: 3, pnlUsd: -2, maxDrawdownPct: 10 },
      ],
    },
    researchOnly: true,
    liveTradingEnabled: false,
  }));
  await writeFile(join(runDirectory, "outcomes.json"), JSON.stringify({
    schemaVersion: 1,
    evaluatedAt: "2026-07-29T20:30:00.000Z",
    outcomes: [{
      symbol: "TA",
      sourceRunId: runId,
      sourceAsOf: artifact.asOf,
      sourceRank: 1,
      selected: true,
      observedThrough: "2026-07-29",
      horizons: {
        "1": maturedHorizon(1),
        "5": maturedHorizon(2),
        "10": maturedHorizon(3),
        "20": maturedHorizon(4),
      },
    }],
    completeTwentySessionOutcomes: 1,
    selectorPolicyVersionBefore: 1,
    selectorPolicyVersionAfter: 1,
    proposedWeights: research.DEFAULT_PENNY_SELECTOR_WEIGHTS,
    promoted: false,
    promotionReason: "fixture",
    researchOnly: true,
  }));
  const failedDirectory = join(runRoot, "runs", "failed-cadence-run");
  await mkdir(failedDirectory, { recursive: true });
  await writeFile(join(failedDirectory, "failure.json"), JSON.stringify({
    failedAt: "2026-07-30T20:30:00.000Z",
    phase: "research",
    researchOnly: true,
    liveTradingEnabled: false,
  }));
  const audit = await cadence.runPennyPaperWeeklyAudit({
    runRoot,
    auditId: "weekly-fixture",
    asOf: new Date("2026-07-31T21:15:00.000Z"),
  });
  assert.equal(audit.artifact.policyMutationAllowed, false);
  assert.equal(audit.artifact.window.completedRuns, 1);
  assert.equal(audit.artifact.window.failedRuns, 1);
  assert.equal(audit.artifact.window.distinctUniverseSnapshots, 1);
  assert.equal(audit.artifact.maturedOutcomes.horizon20, 1);
  assert.equal(audit.artifact.evaluationMetrics.meanTreatmentPnlUsd, 1);
  assert.equal(audit.artifact.readinessGates.selectorSampleSize, false);
  await assert.rejects(
    () => cadence.runPennyPaperWeeklyAudit({
      runRoot,
      auditId: "weekly-fixture",
      asOf: new Date("2026-07-31T21:15:00.000Z"),
    }),
    /append-only/i,
  );
}

{
  const bars = makeEvolutionBars(630);
  const result = evolution.evaluatePennyPaperEvolution({
    runId: "evolution-test",
    symbols: ["AAA", "BBB", "CCC"],
    barsBySymbol: { AAA: bars, BBB: bars, CCC: bars },
    policy: {
      schemaVersion: 2,
      version: 1,
      strategy: simulation.DEFAULT_PENNY_PAPER_STRATEGY,
      selectorWeights: research.DEFAULT_PENNY_SELECTOR_WEIGHTS,
      selectorPolicyVersion: 1,
      acceptedAt: null,
      acceptedFromRunId: null,
      lastEvidenceAsOf: null,
      researchOnly: true,
      liveTradingEnabled: false,
    },
    assumptions: {
      startingCashUsd: 300,
      notionalUsdPerSymbol: 100,
      executionCostBpsPerSide: 100,
    },
    asOf: "2026-01-01T00:00:00.000Z",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(result.windows.length, 4);
  assert.ok(result.training.variantsEvaluated > 0);
  assert.equal(changedFields(result.baselineStrategy, result.proposedStrategy).length, 1);
  assert.equal(result.statisticalEvidence.costStress.length, 3);
  assert.equal(typeof result.statisticalEvidence.pbo.probability, "number");
  assert.equal(result.decision, "rejected", "the full gate stack must fail closed");
  assert.equal(result.policyVersionAfter, 1);
  assert.equal(result.loop.experiments.length, 2);
  assert.equal(result.loop.observation?.committedExperiments, 1);
}

{
  const cash = evolution.evaluatePennyPaperEvolution({
    runId: "cash-evolution",
    symbols: [],
    barsBySymbol: {},
    policy: {
      schemaVersion: 2,
      version: 1,
      strategy: simulation.DEFAULT_PENNY_PAPER_STRATEGY,
      selectorWeights: research.DEFAULT_PENNY_SELECTOR_WEIGHTS,
      selectorPolicyVersion: 1,
      acceptedAt: null,
      acceptedFromRunId: null,
      lastEvidenceAsOf: null,
      researchOnly: true,
      liveTradingEnabled: false,
    },
    assumptions: {
      ...simulation.DEFAULT_PENNY_PAPER_ASSUMPTIONS,
      startingCashUsd: 100,
      maxConcurrentPositions: 1,
    },
    asOf: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(cash.decision, "cash");
  assert.equal(cash.treatmentAggregatePnlUsd, 0);
  assert.equal(cash.statisticalEvidence.costStress[2].pnlUsd, 0);
}

{
  const candidates = Array.from({ length: 10 }, (_, index) => fixtureResearchRow(index));
  const barsBySymbol = Object.fromEntries(candidates.map((candidate) => [
    candidate.symbol,
    makeEvolutionBars(80),
  ]));
  const learning = outcomesService.evaluatePennyCandidateOutcomes({
    runs: [{
      research: {
        schemaVersion: 2,
        runId: "outcome-source",
        researchedAt: "2023-01-01T00:00:00.000Z",
        asOf: "2023-01-05T00:00:00.000Z",
        universe: {
          minimumPriceUsd: 0.02,
          maximumPriceUsd: 1,
          minimumMarketCapUsd: 5_000_000,
          maximumMarketCapUsd: 300_000_000,
          minimumCurrentVolume: 100_000,
          eligibleBeforeHistory: 10,
          historyCandidates: 10,
          snapshotPath: "/tmp/snapshot.json",
          snapshotHash: "c".repeat(64),
          pointInTimeCoverage: "current-snapshot-only",
        },
        method: {
          description: "fixture",
          baselineStrategy: simulation.DEFAULT_PENNY_PAPER_STRATEGY,
          selectorWeights: research.DEFAULT_PENNY_SELECTOR_WEIGHTS,
          prospectiveEntryDiscountsPct: [10, 20, 30],
          prospectiveRegisteredAt: "2023-01-01T00:00:00.000Z",
        },
        candidates,
        dataSources: [],
        limitations: [],
        artifactHash: "d".repeat(64),
        researchOnly: true,
        liveTradingEnabled: false,
      },
      selectedSymbols: ["TA", "TB", "TC"],
    }],
    barsBySymbol,
    policy: {
      schemaVersion: 2,
      version: 1,
      strategy: simulation.DEFAULT_PENNY_PAPER_STRATEGY,
      selectorWeights: research.DEFAULT_PENNY_SELECTOR_WEIGHTS,
      selectorPolicyVersion: 1,
      acceptedAt: null,
      acceptedFromRunId: null,
      lastEvidenceAsOf: null,
      researchOnly: true,
      liveTradingEnabled: false,
    },
    evaluatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(learning.completeTwentySessionOutcomes, 10);
  assert.equal(learning.promoted, false, "sparse selector evidence must fail closed");
  assert.equal(learning.outcomes[0].horizons["20"].matured, true);
  assert.equal(learning.learningTarget, "standing-limit-counterfactual-return");
  assert.equal(learning.outcomes[0].referenceCloseUsd, 1.04);
  assert.equal(typeof learning.outcomes[0].horizons["20"].observedCloseUsd, "number");
  assert.equal(
    typeof learning.outcomes[0].decisionReviews["20"].methodCounterfactual.returnPct,
    "number",
  );
  assert.equal(learning.decisionCalibration.latestMaturedCandidateReviews, 10);
  assert.equal(learning.labelCoverage.sourceCoveragePct, 100);
  assert.equal(learning.labelCoverage.maturityCoveragePct20, 100);
  assert.equal(learning.labelCoverage.promotionCoverageGate, true);
  assert.equal(learning.entryDistanceLearning.maturedPanelObservations20, 10);
  assert.deepEqual(
    learning.entryDistanceLearning.variants.map((row) => row.entryDiscountPct),
    [10, 20, 30],
  );
  assert.equal(learning.entryDistanceLearning.promotionEligible, false);

  const noEvidence = outcomesService.evaluatePennyCandidateOutcomes({
    runs: [],
    barsBySymbol: {},
    policy: {
      schemaVersion: 2,
      version: 1,
      strategy: simulation.DEFAULT_PENNY_PAPER_STRATEGY,
      selectorWeights: research.DEFAULT_PENNY_SELECTOR_WEIGHTS,
      selectorPolicyVersion: 1,
      acceptedAt: null,
      acceptedFromRunId: null,
      lastEvidenceAsOf: null,
      researchOnly: true,
      liveTradingEnabled: false,
    },
    evaluatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(noEvidence.labelCoverage.promotionCoverageGate, false);
  assert.match(noEvidence.promotionReason, /no candidate is mature-eligible/i);
}

{
  const rise = {
    ...fixtureResearchRow(0),
    symbol: "RISE",
    priceUsd: 0.1,
    medianDailyVolume90: 1_000_000,
    conservativeEv: {
      ...fixtureResearchRow(0).conservativeEv,
      expectedValueLowPctPerOrder: -1,
      positive: false,
    },
  };
  const missed = {
    ...fixtureResearchRow(1),
    symbol: "MISS",
    priceUsd: 0.2,
    medianDailyVolume90: 1_000_000,
    conservativeEv: {
      ...fixtureResearchRow(1).conservativeEv,
      expectedValueLowPctPerOrder: -0.5,
      positive: false,
    },
  };
  const artifact = {
    ...fixtureResearchArtifact("/tmp", "decision-audit-source", "2023-01-01T20:30:00.000Z"),
    candidates: [rise, missed],
  };
  const learning = outcomesService.evaluatePennyCandidateOutcomes({
    runs: [{ research: artifact, selectedSymbols: [] }],
    barsBySymbol: {
      RISE: [
        bar("2023-01-01", 1, 1.01, 0.99, 1, 1_000_000),
        bar("2023-01-02", 1.25, 1.3, 1.1, 1.2, 5_000_000),
      ],
      MISS: [
        bar("2023-01-01", 1, 1.01, 0.99, 1, 1_000_000),
        bar("2023-01-02", 0.7, 0.72, 0.69, 0.7, 4_000_000),
        bar("2023-01-03", 1, 1.03, 0.95, 1, 2_000_000),
        bar("2023-01-04", 1, 1.01, 0.99, 1, 1_000_000),
        bar("2023-01-05", 1, 1.01, 0.99, 1, 1_000_000),
        bar("2023-01-06", 1, 1.01, 0.99, 1, 1_000_000),
      ],
    },
    riskUpdatesBySymbol: {
      RISE: {
        cik: "0000000001",
        filingMarkers: [{
          form: "8-K",
          filedAt: "2023-01-02",
          accessionNumber: "0000000001-23-000001",
          sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/test.htm",
        }],
        corporateActions: [],
        secCoverage: "available",
        corporateActionCoverage: "available",
      },
    },
    policy: {
      schemaVersion: 2,
      version: 1,
      strategy: simulation.DEFAULT_PENNY_PAPER_STRATEGY,
      selectorWeights: research.DEFAULT_PENNY_SELECTOR_WEIGHTS,
      selectorPolicyVersion: 1,
      acceptedAt: null,
      acceptedFromRunId: null,
      lastEvidenceAsOf: null,
      researchOnly: true,
      liveTradingEnabled: false,
    },
    evaluatedAt: new Date("2023-01-06T21:00:00.000Z"),
  });
  const riseOutcome = learning.outcomes.find((row) => row.symbol === "RISE");
  const riseReview = riseOutcome.decisionReviews["1"];
  assert.equal(riseOutcome.sourceScreenPriceUsd, 0.1);
  assert.equal(riseOutcome.referenceCloseUsd, 1);
  assert.equal(riseOutcome.horizons["1"].observedCloseUsd, 1.2);
  assert.equal(riseReview.methodCounterfactual.fills, 0);
  assert.equal(riseReview.status, "supported");
  assert.equal(riseReview.logicErrorCandidate, false);
  assert.equal(riseReview.causalClaimEstablished, false);
  assert.ok(riseReview.catalystHypotheses.some((row) => row.kind === "sec-filing"));
  assert.ok(riseReview.catalystHypotheses.some((row) => row.kind === "overnight-gap"));

  const missedReview = learning.outcomes
    .find((row) => row.symbol === "MISS")
    .decisionReviews["5"];
  assert.equal(missedReview.methodCounterfactual.fills, 1);
  assert.ok(missedReview.methodCounterfactual.returnPct > 0);
  assert.equal(missedReview.status, "challenged");
  assert.equal(missedReview.logicErrorCandidate, true);
  assert.equal(learning.decisionCalibration.logicErrorCandidates, 1);
  assert.ok(learning.catalystReviewSymbols.includes("RISE"));
  assert.deepEqual(
    outcomesService.selectPennyOutcomeCatalystReviewSymbols(
      learning.outcomes,
      20,
      learning,
    ),
    [],
    "an unchanged matured material-move review must not trigger repeated evidence mining",
  );
  const withoutExternalEvidence = outcomesService.evaluatePennyCandidateOutcomes({
    runs: [{ research: artifact, selectedSymbols: [] }],
    barsBySymbol: {
      RISE: [
        bar("2023-01-01", 1, 1.01, 0.99, 1, 1_000_000),
        bar("2023-01-02", 1.25, 1.3, 1.1, 1.2, 5_000_000),
      ],
      MISS: [
        bar("2023-01-01", 1, 1.01, 0.99, 1, 1_000_000),
        bar("2023-01-02", 0.7, 0.72, 0.69, 0.7, 4_000_000),
        bar("2023-01-03", 1, 1.03, 0.95, 1, 2_000_000),
        bar("2023-01-04", 1, 1.01, 0.99, 1, 1_000_000),
        bar("2023-01-05", 1, 1.01, 0.99, 1, 1_000_000),
        bar("2023-01-06", 1, 1.01, 0.99, 1, 1_000_000),
      ],
    },
    policy: {
      schemaVersion: 2,
      version: 1,
      strategy: simulation.DEFAULT_PENNY_PAPER_STRATEGY,
      selectorWeights: research.DEFAULT_PENNY_SELECTOR_WEIGHTS,
      selectorPolicyVersion: 1,
      acceptedAt: null,
      acceptedFromRunId: null,
      lastEvidenceAsOf: null,
      researchOnly: true,
      liveTradingEnabled: false,
    },
    evaluatedAt: new Date("2023-01-07T21:00:00.000Z"),
  });
  outcomesService.carryForwardPennyOutcomeCatalystEvidence(
    withoutExternalEvidence,
    learning,
  );
  assert.ok(
    withoutExternalEvidence.outcomes
      .find((row) => row.symbol === "RISE")
      .decisionReviews["1"].catalystHypotheses
      .some((row) => row.kind === "sec-filing"),
    "confirmed catalyst evidence must survive later unchanged daily reviews",
  );
}

{
  const legacyCandidate = { ...fixtureResearchRow(0) };
  delete legacyCandidate.conservativeEv;
  delete legacyCandidate.executionEvidence;
  delete legacyCandidate.vetoed;
  delete legacyCandidate.vetoReasons;
  const legacyResearch = {
    ...fixtureResearchArtifact("/tmp", "legacy-outcome-source", "2023-01-01T20:30:00.000Z"),
    schemaVersion: 1,
    candidates: [legacyCandidate],
  };
  delete legacyResearch.method.selectorWeights;
  const learning = outcomesService.evaluatePennyCandidateOutcomes({
    runs: [{ research: legacyResearch, selectedSymbols: [legacyCandidate.symbol] }],
    barsBySymbol: {
      [legacyCandidate.symbol]: [
        bar("2023-01-01", 1, 1.01, 0.99, 1, 1_000_000),
        bar("2023-01-02", 1.02, 1.03, 1, 1.01, 1_000_000),
      ],
    },
    policy: {
      schemaVersion: 2,
      version: 1,
      strategy: simulation.DEFAULT_PENNY_PAPER_STRATEGY,
      selectorWeights: research.DEFAULT_PENNY_SELECTOR_WEIGHTS,
      selectorPolicyVersion: 1,
      acceptedAt: null,
      acceptedFromRunId: null,
      lastEvidenceAsOf: null,
      researchOnly: true,
      liveTradingEnabled: false,
    },
    evaluatedAt: new Date("2023-01-02T21:00:00.000Z"),
  });
  assert.equal(learning.outcomes[0].decisionReviews["1"].status, "inconclusive");
  assert.equal(learning.outcomes[0].decisionReviews["1"].rejectionBasis, "selected");
}

{
  const pbo = statistics.probabilityBacktestOverfit([
    Array.from({ length: 64 }, (_, index) => index % 2 ? 1 : -0.5),
    Array.from({ length: 64 }, (_, index) => index % 3 ? 0.2 : -0.1),
  ]);
  assert.equal(pbo.coverage, "complete");
  const fdr = statistics.benjaminiHochberg(0.01, [0.02, 0.5, 0.9]);
  assert.ok(fdr.candidateQValue <= 0.04);
}

console.log("Penny-stock paper research, limit simulation, reasoner review, and evolution tests passed.");

function bar(date, open, high, low, close, volume) {
  return { date, open, high, low, close, volume };
}

function quote(timestamp, bidPriceUsd, askPriceUsd, bidSize, askSize) {
  return { timestamp, bidPriceUsd, askPriceUsd, bidSize, askSize };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeResearchBars(count, base, volume, seed) {
  return Array.from({ length: count }, (_, index) => {
    const wave = 1 + Math.sin((index + seed) / 5) * 0.05;
    const close = base * wave;
    return bar(
      isoDate(index),
      close * 0.99,
      close * 1.04,
      index % (12 + seed % 4) === 0 ? close * 0.65 : close * 0.96,
      close,
      volume + index * 1_000,
    );
  });
}

function makeEvolutionBars(count) {
  const cycle = [
    { open: 1, high: 1.01, low: 0.99, close: 1 },
    { open: 0.84, high: 0.86, low: 0.83, close: 0.85 },
    { open: 0.92, high: 0.94, low: 0.91, close: 0.93 },
    { open: 1.03, high: 1.05, low: 1.02, close: 1.04 },
    { open: 1.05, high: 1.06, low: 1.03, close: 1.04 },
    { open: 1, high: 1.01, low: 0.99, close: 1 },
    { open: 1, high: 1.01, low: 0.99, close: 1 },
  ];
  return Array.from({ length: count }, (_, index) => {
    const row = cycle[index % cycle.length];
    return bar(isoDate(index), row.open, row.high, row.low, row.close, 2_000_000);
  });
}

function fixtureResearchRow(index) {
  const symbol = `T${String.fromCharCode(65 + index)}`;
  return {
    symbol,
    name: `${symbol} Common Stock`,
    exchange: "NASDAQ",
    country: "United States",
    sector: index % 2 ? "Technology" : "Health Care",
    industry: "Testing",
    priceUsd: 0.2 + index * 0.01,
    marketCapUsd: 20_000_000 + index * 1_000_000,
    currentVolume: 1_000_000,
    rank: index + 1,
    score: 90 - index,
    bars90: 90,
    averageDailyVolume90: 1_000_000,
    medianDailyVolume90: 900_000,
    averageDailyDollarVolume90: 250_000 + index * 10_000,
    volumeTrend20VsPriorPct: 10,
    volatility90Pct: 8,
    maxDrawdown90Pct: 20,
    return90Pct: 5,
    zeroVolumeDays90: 0,
    methodEvidence: {
      observations: 89,
      limitTouches: 10,
      limitTouchRatePct: 11.23,
      limitTouchWilsonLowPct: 5.5,
      bouncesAfterTouch: 5,
      bounceRatePct: 50,
      bounceWilsonLowPct: 23,
    },
    executionEvidence: {
      quoteObservations: 100,
      quoteStartAt: "2026-01-01T00:00:00.000Z",
      quoteEndAt: "2026-01-02T00:00:00.000Z",
      medianSpreadBps: 100,
      p90SpreadBps: 200,
      medianBidSize: 1_000,
      medianAskSize: 1_000,
      estimatedFillRatioPct: 75,
      source: "alpaca-sip-quotes",
    },
    conservativeEv: {
      touchProbabilityLowPct: 5.5,
      bounceProbabilityLowPct: 60,
      roundTripFrictionPct: 5,
      expectedValueLowPctPerOrder: 0.5 + index * 0.01,
      positive: true,
    },
    filings: {
      cik: null,
      latestPeriodicForm: null,
      latestPeriodicFiledAt: null,
      latestEventForm: null,
      latestEventFiledAt: null,
      sharesOutstandingLatest: null,
      sharesOutstandingPrior: null,
      sharesOutstandingGrowthPct: null,
      cashUsd: null,
      annualizedOperatingCashBurnUsd: null,
      estimatedCashRunwayMonths: null,
      riskEvidence: [],
      vetoReasons: [],
      coverage: "missing",
    },
    corporateActions: [],
    vetoed: false,
    vetoReasons: [],
    evidence: [],
    risks: [],
  };
}

function fixtureResearchArtifact(runRoot, runId, asOf) {
  return {
    schemaVersion: 2,
    runId,
    researchedAt: asOf,
    asOf,
    universe: {
      minimumPriceUsd: 0.02,
      maximumPriceUsd: 1,
      minimumMarketCapUsd: 5_000_000,
      maximumMarketCapUsd: 300_000_000,
      minimumCurrentVolume: 100_000,
      eligibleBeforeHistory: 20,
      historyCandidates: 20,
      snapshotPath: join(runRoot, "snapshot.json"),
      snapshotHash: "e".repeat(64),
      pointInTimeCoverage: "multi-snapshot",
    },
    method: {
      description: "fixture",
      baselineStrategy: simulation.DEFAULT_PENNY_PAPER_STRATEGY,
      selectorWeights: research.DEFAULT_PENNY_SELECTOR_WEIGHTS,
    },
    candidates: Array.from({ length: 10 }, (_, index) => fixtureResearchRow(index)),
    dataSources: [],
    limitations: [],
    artifactHash: "f".repeat(64),
    researchOnly: true,
    liveTradingEnabled: false,
  };
}

function maturedHorizon(closeReturnPct) {
  return {
    matured: true,
    closeReturnPct,
    maximumFavorableExcursionPct: closeReturnPct + 1,
    maximumAdverseExcursionPct: -1,
  };
}

function changedFields(left, right) {
  return Object.keys(left).filter((key) => left[key] !== right[key]);
}

function isoDate(index) {
  return new Date(Date.UTC(2023, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
}
