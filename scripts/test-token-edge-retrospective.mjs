#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendLedgerEvent,
  createForecastEvents,
  createSnapshotEvent,
  readLedger,
  resolutionEvent,
  verifyLedger,
} from "./token-edge/onchain-forward-core.mjs";
import { recordTokenEdgeRetrospectives } from "./token-edge/onchain-forward-research.mjs";
import {
  buildPendingRetrospectives,
  buildRetrospectiveSummary,
} from "./token-edge/onchain-retrospective.mjs";

const observedAt = new Date("2026-07-29T18:00:00.000Z");
const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-retrospective-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
const snapshot = createSnapshotEvent({
  observedAt,
  chain: "solana",
  tokenAddress: "TokenMint111111111111111111111111111111111",
  cohort: "retrospective-test",
  market: {
    source: "dexscreener",
    observedAt: observedAt.toISOString(),
    tokenAddress: "TokenMint111111111111111111111111111111111",
    pairAddress: "Pair111111111111111111111111111111111111",
    pairUrl: "https://dexscreener.com/solana/pair111111111111111111111111111111111111",
    dexId: "test-dex",
    symbol: "TEST",
    priceUsd: 0.01,
    liquidityUsd: 100_000,
    marketCapUsd: 1_000_000,
    fdvUsd: 1_000_000,
    volumeUsd: { m5: 1_000, h1: 20_000, h6: 100_000, h24: 250_000 },
    priceChangePct: { m5: 1, h1: 2, h6: 4, h24: 8 },
    txns: {
      m5: { buys: 10, sells: 8 },
      h1: { buys: 100, sells: 80 },
      h6: { buys: 500, sells: 400 },
      h24: { buys: 1_000, sells: 800 },
    },
    pairCreatedAt: observedAt.getTime() - (24 * 60 * 60 * 1_000),
  },
});
const forecast = createForecastEvents(snapshot, null).find((row) => (
  row.candidateId === "market-only-control" && row.horizon === "1h"
));
const outcome = resolutionEvent(
  forecast,
  snapshot,
  snapshot.market.priceUsd * 0.9,
  new Date(forecast.dueAt),
);
await appendLedgerEvent(ledgerPath, snapshot);
await appendLedgerEvent(ledgerPath, forecast);
await appendLedgerEvent(ledgerPath, outcome);
assert.equal(buildPendingRetrospectives(await readLedger(ledgerPath), observedAt).length, 1);

const firstReview = await recordTokenEdgeRetrospectives({ ledgerPath }, { now: observedAt });
assert.equal(firstReview.appendedRetrospectives, 1);
assert.equal(firstReview.appendedEvolutionReview, true);
assert.equal(firstReview.report.summary.totalReviewed, 1);
assert.equal(firstReview.report.summary.scoreableReviewed, 1);
assert.equal(firstReview.report.summary.diagnosticOnlyReviewed, 0);
assert.equal(firstReview.report.latestEvolutionReview.hypotheses.length, 4);
assert.equal(firstReview.report.latestEvolutionReview.evidenceVersion, "exact-live-all-horizons-v2");
assert.equal(firstReview.report.latestEvolutionReview.executionCapacity.policyStatus, "unregistered");
assert.deepEqual(firstReview.report.latestEvolutionReview.provisionalCapacityRows, []);
assert.ok(firstReview.report.latestEvolutionReview.hypotheses.every((item) => (
  item.status === "proposal-only" && item.eligibleOutcomesAfter === outcome.observedAt
)));

const secondReview = await recordTokenEdgeRetrospectives({ ledgerPath }, { now: observedAt });
assert.equal(secondReview.appendedRetrospectives, 0);
assert.equal(secondReview.appendedEvolutionReview, false);
const finalEvents = await readLedger(ledgerPath);
assert.equal(finalEvents.filter((event) => event.type === "retrospective").length, 1);
assert.equal(finalEvents.filter((event) => event.type === "evolution-review").length, 1);
assert.equal(verifyLedger(finalEvents).ok, true);

const delayedForecast = { ...forecast, id: "forecast-delayed-24h", horizon: "24h" };
const delayedOutcome = {
  ...outcome,
  id: "resolution-delayed-24h",
  forecastId: delayedForecast.id,
  horizon: "24h",
  dueAt: "2026-07-30T18:00:00.000Z",
  observedAt: "2026-07-30T18:06:00.000Z",
  grossReturnPct: 100,
  netReturnPct: 96,
};
const delayedEvents = [delayedForecast, delayedOutcome];
const [delayedReview] = buildPendingRetrospectives(delayedEvents, delayedOutcome.observedAt);
assert.equal(delayedReview.evidenceEligibility, "diagnostic-only");
assert.equal(delayedReview.evidenceExclusionReason, "live-resolution-horizon-drift");
const delayedSummary = buildRetrospectiveSummary([...delayedEvents, delayedReview]);
assert.equal(delayedSummary.totalReviewed, 1);
assert.equal(delayedSummary.scoreableReviewed, 0);
assert.equal(delayedSummary.diagnosticOnlyReviewed, 1);
assert.equal(delayedSummary.diagnosticExclusionCounts["live-resolution-horizon-drift"], 1);
assert.equal(delayedSummary.missedExplosionCount, 0);

console.log("Token-edge retrospective persistence contracts pass.");
