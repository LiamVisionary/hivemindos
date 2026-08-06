import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const proper = await import(new URL(
  "../src/lib/services/trading/prediction-proper-betting-paper.ts",
  import.meta.url,
));
const cli = await import(new URL("./prediction-proper-betting-paper.mjs", import.meta.url));

assert.deepEqual(
  cli.parseProperBettingArguments([
    "snapshot",
    "--experiment-dir", "/tmp/proper-paper",
    "--markets", "/tmp/reviewed-markets.json",
  ]),
  {
    command: "snapshot",
    experimentDir: "/tmp/proper-paper",
    marketsPath: "/tmp/reviewed-markets.json",
  },
);
assert.throws(() => cli.parseProperBettingArguments(["paper"]), /--snapshot/i);
assert.deepEqual(
  cli.parseProperBettingArguments([
    "init",
    "--experiment-dir", "/tmp/proper-paper",
    "--paper-capital-usd", "500",
  ]),
  {
    command: "init",
    experimentDir: "/tmp/proper-paper",
    paperCapitalUsd: 500,
  },
);

function market(id, options = {}) {
  return {
    id,
    conditionId: `condition-${id}`,
    eventId: options.eventId ?? `event-${id}`,
    title: options.title ?? `Will ${id} happen?`,
    description: options.description ?? "This fixture resolves Yes only when the stated event happens.",
    slug: options.slug ?? `will-${id}-happen`,
    url: `https://polymarket.com/event/${options.slug ?? `will-${id}-happen`}`,
    outcomes: [
      { id: `${id}-yes-1234567890`, marketId: id, label: "Yes", price: options.yesPrice ?? 0.5 },
      { id: `${id}-no-1234567890`, marketId: id, label: "No", price: 1 - (options.yesPrice ?? 0.5) },
    ],
    resolutionDate: options.resolutionDate ?? "2026-08-02T20:00:00.000Z",
    volume24h: 10_000,
    volume: 100_000,
    liquidity: options.liquidity ?? 20_000,
    tags: [],
    status: "active",
    acceptingOrders: true,
    restricted: options.restricted ?? false,
    feesEnabled: options.feesEnabled ?? true,
    feeSchedule: options.feeSchedule === null
      ? undefined
      : options.feeSchedule ?? { rate: 0.04, exponent: 1, takerOnly: true, rebateRate: 0.25 },
    minimumOrderSize: 5,
    minimumTickSize: 0.01,
    negRisk: false,
    negativeRiskOther: false,
    resolutionSource: "https://example.com/resolution",
    rewardsMinSize: 0,
    rewardsMaxSpread: 0,
  };
}

function book(outcomeId, bid, ask, size = 100) {
  return {
    outcomeId,
    bids: bid == null ? [] : [{ price: bid, size }],
    asks: ask == null ? [] : [{ price: ask, size }],
    midpoint: bid != null && ask != null ? (bid + ask) / 2 : null,
    spread: bid != null && ask != null ? ask - bid : null,
    timestamp: "1785355200000",
    minimumOrderSize: 5,
    tickSize: 0.01,
  };
}

function books(value, yesBid, yesAsk, noBid, noAsk, size = 100) {
  return [
    book(value.outcomes[0].id, yesBid, yesAsk, size),
    book(value.outcomes[1].id, noBid, noAsk, size),
  ];
}

const policy = {
  ...proper.DEFAULT_PROPER_BETTING_POLICY,
  minimumLagMs: 5 * 60_000,
  minimumNetForecastEdge: 0.02,
  portfolioRiskFraction: 0.15,
  maxMarketFraction: 0.05,
};
assert.equal(policy.researchOnly, true);
assert.equal(policy.minimumSettledMarkets, 252);
assert.equal(policy.bootstrapSamples, 10_000);

const observedAt = "2026-07-29T20:00:00.000Z";
const strong = market("strong", { eventId: "event-strong", restricted: true });
const smaller = market("smaller", { eventId: "event-smaller" });
const unknownFee = market("unknown-fee", { feeSchedule: null });
const snapshot = proper.createProperBettingSnapshot({
  cohortId: "proper-20260729-a",
  snapshotDigest: "fixture-digest",
  observedAt,
  policy,
  candidates: [
    { market: strong, books: books(strong, 0.39, 0.41, 0.58, 0.60), category: "Macro", criteriaReviewed: true },
    { market: smaller, books: books(smaller, 0.49, 0.51, 0.48, 0.50), category: "Technology", criteriaReviewed: true },
    { market: unknownFee, books: books(unknownFee, 0.49, 0.51, 0.48, 0.50), category: "Other", criteriaReviewed: true },
  ],
});
assert.equal(snapshot.markets.length, 2);
assert.equal(snapshot.exclusions.length, 1);
assert.match(snapshot.exclusions[0].reason, /fee schedule/i);

const forecasts = {
  type: "prediction-proper-betting-forecasts",
  cohortId: snapshot.cohortId,
  snapshotDigest: snapshot.snapshotDigest,
  createdAt: "2026-07-29T20:05:00.000Z",
  forecaster: "reviewed-fixture",
  forecasts: [
    {
      marketId: strong.id,
      yesProbability: 0.55,
      rationale: "Independent public evidence makes Yes materially more likely than the frozen market midpoint.",
      sources: [{ url: "https://example.com/strong", accessedAt: "2026-07-29T20:04:00.000Z" }],
      criteriaReviewed: true,
    },
    {
      marketId: smaller.id,
      yesProbability: 0.56,
      rationale: "A smaller but still tradeable gap remains after executable price and the stated fee schedule.",
      sources: [{ url: "https://example.com/smaller", accessedAt: "2026-07-29T20:04:30.000Z" }],
      criteriaReviewed: true,
    },
  ],
};
assert.equal(proper.validateProperBettingForecasts(snapshot, forecasts).length, 2);

assert.throws(
  () => proper.simulateProperBettingCohort({
    snapshot,
    forecasts,
    fillObservedAt: "2026-07-29T20:09:59.000Z",
    fillMarkets: [
      { market: strong, books: books(strong, 0.40, 0.42, 0.57, 0.59) },
      { market: smaller, books: books(smaller, 0.50, 0.52, 0.47, 0.49) },
    ],
    policy,
  }),
  /execution lag/i,
);

const run = proper.simulateProperBettingCohort({
  snapshot,
  forecasts,
  fillObservedAt: "2026-07-29T20:10:01.000Z",
  fillMarkets: [
    { market: strong, books: books(strong, 0.40, 0.42, 0.57, 0.59) },
    { market: smaller, books: books(smaller, 0.50, 0.52, 0.47, 0.49) },
  ],
  policy,
});
assert.equal(run.researchOnly, true);
assert.equal(run.ordersSubmitted, 0);
assert.equal(run.signals.length, 2);
assert.equal(run.positions.filter((position) => position.arm === "brier-treatment").length, 2);
assert.equal(run.positions.filter((position) => position.arm === "equal-notional-control").length, 2);
assert.ok(run.positions.every((position) => position.feeUsd > 0));
assert.ok(run.positions.every((position) => position.capitalUsd <= 5.00001));
const treatmentCapital = run.positions
  .filter((position) => position.arm === "brier-treatment")
  .map((position) => position.capitalUsd);
assert.notEqual(
  Math.round(treatmentCapital[0] * 1_000),
  Math.round(treatmentCapital[1] * 1_000),
  "Brier-gradient sizing should differ when forecast deviations differ",
);
const treatmentTotal = run.positions
  .filter((position) => position.arm === "brier-treatment")
  .reduce((sum, position) => sum + position.capitalUsd, 0);
const controlTotal = run.positions
  .filter((position) => position.arm === "equal-notional-control")
  .reduce((sum, position) => sum + position.capitalUsd, 0);
assert.ok(Math.abs(treatmentTotal - controlTotal) < 0.02, "treatment and control need capital parity");

const settlement = proper.settleProperBettingCohort(run, new Map([
  [strong.id, "yes"],
  [smaller.id, "no"],
]));
assert.equal(settlement.settledMarkets, 2);
assert.equal(settlement.readiness.ready, false);
assert.match(settlement.readiness.reasons.join(" "), /252/);
assert.ok(Number.isFinite(settlement.arms["brier-treatment"].pnlUsd));
assert.ok(Number.isFinite(settlement.forecasterBrierScore));
assert.ok(Number.isFinite(settlement.marketBrierScore));
assert.equal(settlement.claimLimit, "Open or undersized paper cohorts cannot establish future or constant profit.");

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "hive-proper-paper-"));
const initAt = new Date("2026-07-29T20:00:00.000Z");
const initialized = await cli.initializeProperBettingExperiment({
  experimentDir: fixtureRoot,
  paperCapitalUsd: 500,
}, initAt);
const preregistration = JSON.parse(await readFile(initialized.preregistrationPath, "utf8"));
assert.equal(preregistration.researchOnly, true);
assert.equal(preregistration.policy.startingCapitalUsd, 500);
assert.equal(preregistration.validation.minimumSettledMarkets, 252);
await assert.rejects(
  () => cli.initializeProperBettingExperiment({ experimentDir: fixtureRoot, paperCapitalUsd: 500 }, initAt),
  /EEXIST/i,
  "preregistration must be append-only",
);
const selectionPath = path.join(fixtureRoot, "reviewed-markets.json");
await writeFile(selectionPath, JSON.stringify({
  type: "prediction-proper-betting-market-selection",
  cohortId: "proper-20260729-fixture",
  markets: [{
    slug: "will-cli-fixture-happen",
    category: "Fixture",
    eventKey: "fixture-event",
    criteriaReviewed: true,
  }],
}), "utf8");

let bookCall = 0;
const cliFetcher = async (url, init = {}) => {
  const parsed = new URL(String(url));
  if (parsed.pathname === "/markets/slug/will-cli-fixture-happen") {
    return Response.json({
      id: "cli-fixture",
      conditionId: "condition-cli-fixture",
      question: "Will the CLI fixture happen?",
      description: "This fixture resolves Yes if and only if the documented test event occurs.",
      slug: "will-cli-fixture-happen",
      outcomes: "[\"Yes\",\"No\"]",
      outcomePrices: "[\"0.40\",\"0.60\"]",
      clobTokenIds: "[\"123456789012345678901\",\"987654321098765432109\"]",
      endDate: "2026-08-02T20:00:00.000Z",
      volume24hr: "10000",
      volume: "100000",
      liquidity: "20000",
      feesEnabled: true,
      feeSchedule: { rate: 0.04, exponent: 1, takerOnly: true, rebateRate: 0.25 },
      orderPriceMinTickSize: 0.01,
      orderMinSize: 5,
      active: true,
      closed: false,
      acceptingOrders: true,
      resolutionSource: "https://example.com/resolution",
    });
  }
  if (parsed.pathname === "/books") {
    const request = JSON.parse(String(init.body));
    assert.equal(request.length, 2);
    bookCall += 1;
    const yesAsk = bookCall === 1 ? "0.41" : "0.42";
    return Response.json([
      {
        asset_id: "123456789012345678901",
        timestamp: String(initAt.getTime() + bookCall),
        min_order_size: "5",
        tick_size: "0.01",
        bids: [{ price: "0.39", size: "100" }],
        asks: [{ price: yesAsk, size: "100" }],
      },
      {
        asset_id: "987654321098765432109",
        timestamp: String(initAt.getTime() + bookCall),
        min_order_size: "5",
        tick_size: "0.01",
        bids: [{ price: "0.58", size: "100" }],
        asks: [{ price: "0.60", size: "100" }],
      },
    ]);
  }
  return new Response("not found", { status: 404 });
};

const captured = await cli.captureProperBettingSnapshot({
  experimentDir: fixtureRoot,
  marketsPath: selectionPath,
}, cliFetcher, initAt);
assert.equal(captured.snapshot.markets.length, 1);
assert.equal(captured.snapshot.exclusions.length, 0);
assert.equal(captured.snapshot.policy.startingCapitalUsd, 500);
const template = JSON.parse(await readFile(captured.forecastTemplatePath, "utf8"));
const forecastsPath = path.join(fixtureRoot, "forecasts", "proper-20260729-fixture.reviewed.json");
await writeFile(forecastsPath, JSON.stringify({
  ...template,
  createdAt: "2026-07-29T20:05:00.000Z",
  forecaster: "fixture-reviewer",
  forecasts: template.forecasts.map((forecast) => ({
    marketId: forecast.marketId,
    yesProbability: 0.55,
    rationale: "The fixture's reviewed public evidence assigns a higher Yes probability than the frozen midpoint.",
    sources: [{ url: "https://example.com/evidence", accessedAt: "2026-07-29T20:04:00.000Z" }],
    criteriaReviewed: true,
  })),
}), "utf8");
const paper = await cli.runProperBettingPaper({
  experimentDir: fixtureRoot,
  snapshotPath: captured.snapshotPath,
  forecastsPath,
}, cliFetcher, new Date("2026-07-29T20:10:01.000Z"));
assert.equal(paper.run.ordersSubmitted, 0);
assert.equal(paper.run.positions.length, 2);
assert.equal(paper.run.arms["brier-treatment"].startingCapitalUsd, 500);
assert.equal(JSON.parse(await readFile(paper.runPath, "utf8")).runId, paper.run.runId);
await rm(fixtureRoot, { recursive: true });

const serviceSource = readFileSync(
  new URL("../src/lib/services/trading/prediction-proper-betting-paper.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(serviceSource, /private.?key|submitOrder|createOrder|wallet/i);

console.log("Prediction proper-betting prospective paper contracts pass.");
