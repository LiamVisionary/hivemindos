import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const monitor = await import(new URL(
  "../src/lib/services/trading/prediction-proper-betting-monitor.ts",
  import.meta.url,
));
const cli = await import(new URL("./prediction-proper-betting-monitor.mjs", import.meta.url));

assert.deepEqual(
  cli.parseProperBettingMonitorArguments([
    "--experiment-dir", "/tmp/current",
    "--include-experiment-dir", "/tmp/older",
  ]),
  {
    experimentDir: "/tmp/current",
    includeExperimentDirs: ["/tmp/older"],
  },
);

function position({
  arm,
  marketId,
  eventKey,
  side,
  capitalUsd,
  shares,
}) {
  return {
    arm,
    marketId,
    eventKey,
    category: "Fixture",
    title: `Will ${marketId} happen?`,
    slug: `will-${marketId}-happen`,
    resolutionDate: "2026-08-02T20:00:00.000Z",
    side,
    outcomeId: `${marketId}-${side}`,
    forecastYesProbability: side === "yes" ? 0.7 : 0.3,
    marketYesMidpoint: 0.5,
    netForecastEdge: 0.1,
    brierGradientMagnitude: 0.4,
    shares,
    averagePrice: capitalUsd / shares,
    grossCostUsd: capitalUsd,
    feeUsd: 0,
    capitalUsd,
    status: "open",
  };
}

function run(runId, cohortId, fillObservedAt, positions) {
  return {
    type: "prediction-proper-betting-paper-run",
    runId,
    cohortId,
    snapshotDigest: `digest-${runId}`,
    policy: {
      id: "fixture-policy",
      researchOnly: true,
      startingCapitalUsd: 500,
      minimumLagMs: 300_000,
      minimumDaysToResolution: 2,
      maximumDaysToResolution: 14,
      haltHoursBeforeResolution: 3,
      minimumLiquidityUsd: 5_000,
      minimumNetForecastEdge: 0.02,
      portfolioRiskFraction: 0.15,
      maxMarketFraction: 0.05,
      maxEventFraction: 0.2,
      maxCategoryFraction: 0.25,
      maxDepthFraction: 0.25,
      minimumSettledMarkets: 252,
      minimumForwardCohorts: 4,
      minimumAbsoluteTStatistic: 3,
      maximumPValue: 0.01,
      bootstrapSamples: 10_000,
      placeboTrials: 2_000,
      maximumPbo: 0.5,
      minimumDeflatedSharpeProbability: 0.95,
    },
    forecastCreatedAt: fillObservedAt,
    fillObservedAt,
    researchOnly: true,
    ordersSubmitted: 0,
    signals: [],
    rejections: [],
    positions,
    arms: {
      "brier-treatment": { startingCapitalUsd: 500, deployedCapitalUsd: 30, cashUsd: 470 },
      "equal-notional-control": { startingCapitalUsd: 500, deployedCapitalUsd: 30, cashUsd: 470 },
      cash: { startingCapitalUsd: 500, deployedCapitalUsd: 0, cashUsd: 500 },
    },
    claimLimit: "fixture",
  };
}

const closedYesMarket = {
  id: "closed-yes",
  status: "closed",
  outcomes: [
    { id: "yes", marketId: "closed-yes", label: "Yes", price: 1 },
    { id: "no", marketId: "closed-yes", label: "No", price: 0 },
  ],
};
assert.deepEqual(
  monitor.deriveResolvedPredictionOutcome(closedYesMarket, "2026-08-03T00:00:00.000Z"),
  {
    type: "prediction-proper-betting-outcome",
    marketId: "closed-yes",
    outcome: "yes",
    observedAt: "2026-08-03T00:00:00.000Z",
    sourceStatus: "closed",
    sourcePrices: { yes: 1, no: 0 },
  },
);
assert.equal(monitor.deriveResolvedPredictionOutcome({
  ...closedYesMarket,
  id: "open",
  status: "active",
}, "2026-08-03T00:00:00.000Z"), null);
assert.equal(monitor.deriveResolvedPredictionOutcome({
  ...closedYesMarket,
  id: "ambiguous",
  outcomes: [
    { id: "yes", marketId: "ambiguous", label: "Yes", price: 0.6 },
    { id: "no", marketId: "ambiguous", label: "No", price: 0.4 },
  ],
}, "2026-08-03T00:00:00.000Z"), null);

const runOne = run("run-1", "cohort-a", "2026-07-29T20:00:00.000Z", [
  position({ arm: "brier-treatment", marketId: "m1", eventKey: "event-a", side: "yes", capitalUsd: 10, shares: 20 }),
  position({ arm: "brier-treatment", marketId: "m2", eventKey: "event-a", side: "no", capitalUsd: 10, shares: 20 }),
  position({ arm: "equal-notional-control", marketId: "m1", eventKey: "event-a", side: "yes", capitalUsd: 15, shares: 20 }),
  position({ arm: "equal-notional-control", marketId: "m2", eventKey: "event-a", side: "no", capitalUsd: 15, shares: 20 }),
]);
const runTwo = run("run-2", "cohort-b", "2026-07-30T20:00:00.000Z", [
  position({ arm: "brier-treatment", marketId: "m1", eventKey: "event-a", side: "yes", capitalUsd: 10, shares: 20 }),
  position({ arm: "brier-treatment", marketId: "m3", eventKey: "event-b", side: "yes", capitalUsd: 10, shares: 20 }),
  position({ arm: "brier-treatment", marketId: "open-market", eventKey: "event-c", side: "yes", capitalUsd: 10, shares: 20 }),
  position({ arm: "equal-notional-control", marketId: "m1", eventKey: "event-a", side: "yes", capitalUsd: 10, shares: 20 }),
  position({ arm: "equal-notional-control", marketId: "m3", eventKey: "event-b", side: "yes", capitalUsd: 10, shares: 20 }),
  position({ arm: "equal-notional-control", marketId: "open-market", eventKey: "event-c", side: "yes", capitalUsd: 10, shares: 20 }),
]);

const scorecard = monitor.buildProperBettingScorecard({
  runs: [runOne, runTwo],
  outcomes: [
    { marketId: "m1", outcome: "yes", observedAt: "2026-08-03T00:00:00.000Z" },
    { marketId: "m2", outcome: "yes", observedAt: "2026-08-03T00:00:00.000Z" },
    { marketId: "m3", outcome: "no", observedAt: "2026-08-03T00:00:00.000Z" },
  ],
  forecastEvaluations: [
    { runId: "run-1", marketId: "m1", eventKey: "event-a", forecastYesProbability: 0.8, marketYesMidpoint: 0.55 },
    { runId: "run-1", marketId: "m2", eventKey: "event-a", forecastYesProbability: 0.4, marketYesMidpoint: 0.45 },
    { runId: "run-2", marketId: "m3", eventKey: "event-b", forecastYesProbability: 0.3, marketYesMidpoint: 0.5 },
    { runId: "run-2", marketId: "open-market", eventKey: "event-c", forecastYesProbability: 0.7, marketYesMidpoint: 0.5 },
  ],
  observedAt: "2026-08-03T01:00:00.000Z",
});

const treatment = scorecard.arms["brier-treatment"];
assert.equal(scorecard.cohorts.total, 2);
assert.equal(scorecard.cohorts.withClosedPositions, 2);
assert.equal(treatment.closedPositions, 4);
assert.equal(treatment.openPositions, 1);
assert.equal(treatment.openCapitalUsd, 10);
assert.equal(treatment.wins, 2);
assert.equal(treatment.losses, 2);
assert.equal(treatment.rawPositionWinRate, 0.5);
assert.equal(treatment.uniqueMarkets.closed, 3);
assert.equal(treatment.uniqueMarkets.winRate, 1 / 3);
assert.equal(treatment.eventClusters.closed, 2);
assert.equal(treatment.eventClusters.winRate, 0.5);
assert.equal(treatment.pnlUsd, 0);
assert.equal(treatment.deployedCapitalUsd, 40);
assert.equal(treatment.returnOnDeployedCapital, 0);
assert.equal(scorecard.forecasts.settled, 3);
assert.ok(scorecard.forecasts.forecasterBrierScore < scorecard.forecasts.marketBrierScore);
assert.ok(scorecard.forecasts.brierImprovement > 0);
assert.equal(scorecard.readiness.ready, false);
assert.match(scorecard.readiness.reasons.join(" "), /252/);
assert.equal(scorecard.edgeEvidence.status, "insufficient-data");
assert.match(scorecard.claimLimit, /descriptive/i);
const aliasedScorecard = monitor.buildProperBettingScorecard({
  runs: [runOne, runTwo],
  outcomes: [
    { marketId: "m1", outcome: "yes", observedAt: "2026-08-03T00:00:00.000Z" },
    { marketId: "m2", outcome: "yes", observedAt: "2026-08-03T00:00:00.000Z" },
    { marketId: "m3", outcome: "no", observedAt: "2026-08-03T00:00:00.000Z" },
  ],
  forecastEvaluations: [],
  eventClusterAliases: { "event-b": "event-a" },
  observedAt: "2026-08-03T01:00:00.000Z",
});
assert.equal(aliasedScorecard.eventClustering.aliasesApplied, 1);
assert.equal(aliasedScorecard.arms["brier-treatment"].eventClusters.closed, 1);

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "hive-proper-monitor-"));
await mkdir(path.join(fixtureRoot, "snapshots"), { recursive: true });
await mkdir(path.join(fixtureRoot, "forecasts"), { recursive: true });
await mkdir(path.join(fixtureRoot, "runs"), { recursive: true });
await writeFile(path.join(fixtureRoot, "preregistration-v1.json"), JSON.stringify({
  type: "prediction-proper-betting-preregistration",
  policy: runOne.policy,
}), "utf8");
await writeFile(path.join(fixtureRoot, "event-cluster-aliases.json"), JSON.stringify({
  type: "prediction-proper-betting-event-cluster-aliases",
  aliases: { "monitor-event": "canonical-monitor-event" },
}), "utf8");
await writeFile(path.join(fixtureRoot, "snapshots", "cohort-monitor.json"), JSON.stringify({
  type: "prediction-proper-betting-snapshot",
  cohortId: "cohort-monitor",
  snapshotDigest: "digest-monitor",
  observedAt: "2026-07-29T20:00:00.000Z",
  policyId: runOne.policy.id,
  markets: [{
    market: {
      id: "monitor-market",
      slug: "will-monitor-market-happen",
      outcomes: [
        { id: "monitor-yes", marketId: "monitor-market", label: "Yes", price: 0.45 },
        { id: "monitor-no", marketId: "monitor-market", label: "No", price: 0.55 },
      ],
    },
    books: [
      { outcomeId: "monitor-yes", bids: [{ price: 0.44, size: 100 }], asks: [{ price: 0.46, size: 100 }], midpoint: 0.45 },
      { outcomeId: "monitor-no", bids: [{ price: 0.54, size: 100 }], asks: [{ price: 0.56, size: 100 }], midpoint: 0.55 },
    ],
    category: "Fixture",
    eventKey: "monitor-event",
    criteriaReviewed: true,
  }],
}), "utf8");
await writeFile(path.join(fixtureRoot, "forecasts", "cohort-monitor.reviewed.json"), JSON.stringify({
  type: "prediction-proper-betting-forecasts",
  cohortId: "cohort-monitor",
  snapshotDigest: "digest-monitor",
  createdAt: "2026-07-29T20:05:00.000Z",
  forecaster: "fixture",
  forecasts: [{
    marketId: "monitor-market",
    yesProbability: 0.7,
    rationale: "fixture",
    sources: [],
    criteriaReviewed: true,
  }],
}), "utf8");
await writeFile(path.join(fixtureRoot, "forecasts", "cohort-monitor.template.json"), JSON.stringify({
  type: "prediction-proper-betting-forecasts",
  cohortId: "cohort-monitor",
  snapshotDigest: "digest-monitor",
  createdAt: null,
  forecaster: null,
  forecasts: [],
}), "utf8");
const monitorRun = run("run-monitor", "cohort-monitor", "2026-07-29T20:10:00.000Z", [
  position({ arm: "brier-treatment", marketId: "monitor-market", eventKey: "monitor-event", side: "yes", capitalUsd: 10, shares: 20 }),
  position({ arm: "equal-notional-control", marketId: "monitor-market", eventKey: "monitor-event", side: "yes", capitalUsd: 10, shares: 20 }),
]);
monitorRun.snapshotDigest = "digest-monitor";
await writeFile(path.join(fixtureRoot, "runs", "run-monitor.json"), JSON.stringify(monitorRun), "utf8");
const gammaFetcher = async (url) => {
  const parsed = new URL(String(url));
  if (parsed.pathname !== "/markets/slug/will-monitor-market-happen") {
    return new Response("not found", { status: 404 });
  }
  return Response.json({
    id: "monitor-market",
    conditionId: "condition-monitor",
    question: "Will the monitor fixture happen?",
    description: "Fixture description.",
    slug: "will-monitor-market-happen",
    outcomes: "[\"Yes\",\"No\"]",
    outcomePrices: "[\"1\",\"0\"]",
    clobTokenIds: "[\"monitor-yes\",\"monitor-no\"]",
    endDate: "2026-08-02T20:00:00.000Z",
    volume24hr: "10000",
    volume: "100000",
    liquidity: "0",
    orderPriceMinTickSize: 0.01,
    orderMinSize: 5,
    active: false,
    closed: true,
    acceptingOrders: false,
  });
};
const monitored = await cli.monitorProperBettingExperiments(
  { experimentDir: fixtureRoot, includeExperimentDirs: [] },
  gammaFetcher,
  new Date("2026-08-03T01:00:00.000Z"),
);
assert.equal(monitored.ordersSubmitted, 0);
assert.equal(monitored.forecasts, 1);
assert.equal(monitored.scorecard.eventClustering.aliasesApplied, 1);
assert.equal(monitored.publicChecks[0].status, "resolved");
assert.equal(monitored.scorecard.arms["brier-treatment"].rawPositionWinRate, 1);
assert.equal(JSON.parse(await readFile(monitored.scorecardPath, "utf8")).forecasts.settled, 1);
await rm(fixtureRoot, { recursive: true });

console.log("Prediction proper-betting monitor scorecard contracts pass.");
