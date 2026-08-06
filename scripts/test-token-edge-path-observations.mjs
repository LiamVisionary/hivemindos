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
  verifyLedger,
} from "./token-edge/onchain-forward-core.mjs";
import {
  TOKEN_EDGE_PATH_BUCKET_MS,
  buildPendingPathObservationTargets,
  createPathObservationEvent,
} from "./token-edge/onchain-path-observations.mjs";
import { recordOpenForecastPathObservations } from "./token-edge/onchain-forward-research.mjs";

const signalAt = new Date("2026-08-03T04:00:00.000Z");
const markAt = new Date("2026-08-03T04:15:01.000Z");
const tokenAddress = "PathToken111111111111111111111111111111111";
const snapshot = createSnapshotEvent({
  observedAt: signalAt,
  chain: "solana",
  tokenAddress,
  cohort: "path-observation-test",
  selection: {
    status: "verified",
    provider: "nansen-token-screener",
    timeframe: "6h",
    discoveryEventId: "path-discovery",
    confirmationEventId: "path-confirmation",
    discoveryObservedAt: "2026-08-03T03:40:00.000Z",
    confirmationObservedAt: "2026-08-03T03:50:00.000Z",
    metrics: {
      netflowUsd: 5_000,
      netflowToLiquidity: 0.05,
      buySellVolumeRatio: 2,
      priceChangePct: 2,
      confirmedLiquidityUsd: 100_000,
    },
  },
  market: marketAt(signalAt, 0.01, 100_000),
});
const forecasts = createForecastEvents(snapshot, null);
const events = [snapshot, ...forecasts];
assert.equal(TOKEN_EDGE_PATH_BUCKET_MS, 5 * 60_000);
const targets = buildPendingPathObservationTargets(events, markAt, {
  horizon: "1h",
  maximumTargets: 20,
});
assert.equal(targets.length, 1);
assert.equal(targets[0].snapshotId, snapshot.id);
assert.equal(targets[0].bucketStartedAt, "2026-08-03T04:15:00.000Z");
assert.ok(targets[0].forecastIds.length >= 1);
assert.ok(targets[0].forecastIds.every((forecastId) => (
  forecasts.find((forecast) => forecast.id === forecastId)?.predictedRise === true
)));
assert.equal(buildPendingPathObservationTargets(events, markAt, {
  horizon: "1h",
  maximumTargets: 20,
  modelVersion: "frozen-onchain-rank-v3",
  candidateId: "smart-money-selection",
  selectionProvider: "nansen-token-screener",
  selectionTimeframe: "6h",
}).length, 1);
assert.equal(buildPendingPathObservationTargets(events, markAt, {
  horizon: "1h",
  maximumTargets: 20,
  modelVersion: "frozen-onchain-rank-v3",
  candidateId: "smart-money-selection",
  selectionProvider: "nansen-token-screener",
  selectionTimeframe: "24h",
}).length, 0);
assert.equal(buildPendingPathObservationTargets(events, markAt, {
  horizon: "1h",
  maximumTargets: 20,
  createdAfter: signalAt.toISOString(),
}).length, 0);

const pathEvent = createPathObservationEvent(
  targets[0],
  marketAt(markAt, 0.015, 80_000),
  markAt,
);
assert.equal(pathEvent.type, "forecast-path-observation");
assert.equal(pathEvent.observationMode, "live-point-in-time-path");
assert.equal(pathEvent.grossReturnFromEntryPct, 50);
assert.equal(pathEvent.entryLiquidityUsd, 100_000);
assert.equal(pathEvent.observedLiquidityUsd, 80_000);
assert.equal(pathEvent.researchOnly, true);
assert.equal(pathEvent.mutationAllowed, false);
assert.equal(buildPendingPathObservationTargets(
  [...events, pathEvent],
  markAt,
  { horizon: "1h", maximumTargets: 20 },
).length, 0);
assert.equal(buildPendingPathObservationTargets(
  [...events, pathEvent],
  markAt,
  { horizon: "6h", maximumTargets: 20 },
).length, 1);
assert.equal(buildPendingPathObservationTargets(
  [...events, pathEvent],
  new Date("2026-08-03T04:20:01.000Z"),
  { horizon: "1h", maximumTargets: 20 },
).length, 1);
assert.equal(buildPendingPathObservationTargets(
  events,
  new Date("2026-08-03T05:00:01.000Z"),
  { horizon: "1h", maximumTargets: 20 },
).length, 0);

{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-path-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  await appendLedgerEvent(ledgerPath, snapshot);
  for (const forecast of forecasts) await appendLedgerEvent(ledgerPath, forecast);
  const first = await recordOpenForecastPathObservations({
    ledgerPath,
    horizon: "1h",
    maxTokens: 20,
  }, {
    now: markAt,
    fetcher: async (url) => {
      assert.ok(String(url).includes(tokenAddress));
      return jsonResponse([dexPair(markAt, 0.015, 80_000)]);
    },
  });
  assert.equal(first.pendingTargets, 1);
  assert.equal(first.requiredRequests, 2);
  assert.equal(first.recordedObservations, 1);
  assert.equal(first.observations[0].grossReturnFromEntryPct, 50);

  const second = await recordOpenForecastPathObservations({
    ledgerPath,
    horizon: "1h",
    maxTokens: 20,
  }, {
    now: markAt,
    fetcher: async () => {
      throw new Error("duplicate bucket must make zero requests");
    },
  });
  assert.equal(second.pendingTargets, 0);
  assert.equal(second.requiredRequests, 0);
  assert.equal(second.recordedObservations, 0);
  const inconsistent = await recordOpenForecastPathObservations({
    ledgerPath,
    horizon: "1h",
    maxTokens: 20,
  }, {
    now: new Date("2026-08-03T04:20:01.000Z"),
    fetcher: async (url) => jsonResponse([dexPair(
      new Date("2026-08-03T04:20:01.000Z"),
      String(url).includes("/tokens/v1/") ? 0.3 : 0.015,
      80_000,
    )]),
  });
  assert.equal(inconsistent.pendingTargets, 1);
  assert.equal(inconsistent.requiredRequests, 2);
  assert.equal(inconsistent.recordedObservations, 0);
  assert.ok(inconsistent.failures[0].error.includes("cross-endpoint-price-disagreement"));
  const consistentRetry = await recordOpenForecastPathObservations({
    ledgerPath,
    horizon: "1h",
    maxTokens: 20,
  }, {
    now: new Date("2026-08-03T04:20:02.000Z"),
    fetcher: async () => jsonResponse([dexPair(
      new Date("2026-08-03T04:20:02.000Z"),
      0.016,
      80_000,
    )]),
  });
  assert.equal(consistentRetry.recordedObservations, 1);
  assert.equal(consistentRetry.observations[0].grossReturnFromEntryPct, 60);
  let releaseConcurrentFetch;
  let reportConcurrentFetchStarted;
  const concurrentFetchStarted = new Promise((resolve) => {
    reportConcurrentFetchStarted = resolve;
  });
  const concurrentFetchRelease = new Promise((resolve) => {
    releaseConcurrentFetch = resolve;
  });
  const firstConcurrent = recordOpenForecastPathObservations({
    ledgerPath,
    horizon: "1h",
    maxTokens: 20,
  }, {
    now: new Date("2026-08-03T04:25:01.000Z"),
    fetcher: async () => {
      reportConcurrentFetchStarted();
      await concurrentFetchRelease;
      return jsonResponse([dexPair(new Date("2026-08-03T04:25:01.000Z"), 0.017, 80_000)]);
    },
  });
  await concurrentFetchStarted;
  const secondConcurrent = await recordOpenForecastPathObservations({
    ledgerPath,
    horizon: "1h",
    maxTokens: 20,
  }, {
    now: new Date("2026-08-03T04:25:02.000Z"),
    fetcher: async () => { throw new Error("concurrent path mark must spend zero requests"); },
  });
  assert.equal(secondConcurrent.pendingTargets, 0);
  assert.equal(secondConcurrent.requiredRequests, 0);
  assert.equal(secondConcurrent.recordedObservations, 0);
  releaseConcurrentFetch();
  const completedConcurrent = await firstConcurrent;
  assert.equal(completedConcurrent.recordedObservations, 1);
  const postConcurrentReplay = await recordOpenForecastPathObservations({
    ledgerPath,
    horizon: "1h",
    maxTokens: 20,
  }, {
    now: new Date("2026-08-03T04:25:03.000Z"),
    fetcher: async () => { throw new Error("completed path bucket must spend zero requests"); },
  });
  assert.equal(postConcurrentReplay.recordedObservations, 0);
  assert.equal(postConcurrentReplay.requiredRequests, 0);
  const finalEvents = await readLedger(ledgerPath);
  assert.equal(finalEvents.filter((event) => event.type === "forecast-path-observation").length, 3);
  assert.equal(verifyLedger(finalEvents).ok, true);
}

console.log("Token-edge prospective path-observation contracts pass.");

function marketAt(observedAt, priceUsd, liquidityUsd) {
  return {
    source: "dexscreener",
    observedAt: observedAt.toISOString(),
    tokenAddress,
    pairAddress: "PathPair1111111111111111111111111111111111",
    pairUrl: "https://dexscreener.com/solana/pathpair",
    dexId: "test-dex",
    symbol: "PATH",
    priceUsd,
    liquidityUsd,
    marketCapUsd: 1_000_000,
    fdvUsd: 1_000_000,
    volumeUsd: { m5: 1_000, h1: 20_000, h6: 100_000, h24: 300_000 },
    priceChangePct: { m5: 1, h1: 2, h6: 5, h24: 10 },
    txns: {
      m5: { buys: 10, sells: 5 },
      h1: { buys: 100, sells: 50 },
      h6: { buys: 500, sells: 250 },
      h24: { buys: 1_000, sells: 500 },
    },
    pairCreatedAt: signalAt.getTime() - (24 * 60 * 60_000),
  };
}

function dexPair(observedAt, priceUsd, liquidityUsd) {
  const market = marketAt(observedAt, priceUsd, liquidityUsd);
  return {
    chainId: "solana",
    dexId: market.dexId,
    pairAddress: market.pairAddress,
    url: market.pairUrl,
    baseToken: { address: tokenAddress, symbol: market.symbol },
    quoteToken: { address: "So111", symbol: "SOL" },
    priceUsd: String(priceUsd),
    liquidity: { usd: liquidityUsd },
    marketCap: market.marketCapUsd,
    fdv: market.fdvUsd,
    pairCreatedAt: market.pairCreatedAt,
    volume: market.volumeUsd,
    priceChange: market.priceChangePct,
    txns: market.txns,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
