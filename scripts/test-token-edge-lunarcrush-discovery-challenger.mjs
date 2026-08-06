#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildScorecard,
  createChallengerRegistrationEvents,
  createForecastEvents,
  createSnapshotEvent,
  digestValue,
  readLedger,
  resolutionEvent,
  verifyLedger,
} from "./token-edge/onchain-forward-core.mjs";
import { collectTokenEdgeLunarDiscovery } from "./token-edge/onchain-lunarcrush-discovery.mjs";
import {
  LUNARCRUSH_SOLANA_DISCOVERY_RULE,
  collectSolanaLunarCrushDiscovery,
} from "./token-edge/onchain-lunarcrush-provider.mjs";

const tokenAddress = "LunarDiscovery11111111111111111111111111111";
const boundary = "2026-08-03T06:37:48.300Z";
const registeredAt = new Date("2026-08-03T06:40:00.000Z");
const discoveryAt = "2026-08-03T06:41:00.000Z";
const confirmationAt = "2026-08-03T06:42:00.000Z";
const snapshotAt = new Date("2026-08-03T06:43:00.000Z");
const registration = createChallengerRegistrationEvents(registeredAt).find((event) => (
  event.modelVersion === "frozen-onchain-rank-v8-lunarcrush-social-discovery"
));

assert.ok(registration);
assert.equal(registration.changedDimension, "lunarcrushSocialDiscoveryRise");
assert.equal(registration.evidenceBoundary, boundary);
assert.equal(registration.provider, "lunarcrush-coin-list");
assert.equal(registration.selectionTimeframe, "1h");
assert.equal(registration.posthocDerived, false);
assert.equal(registration.prospectiveDerivation.outcomesObservedBeforeFreeze, 0);
assert.deepEqual(registration.lunarcrushDiscoveryRule, LUNARCRUSH_SOLANA_DISCOVERY_RULE);

const candidate = lunarCandidate();
const discovery = discoveryEvent(candidate);
const confirmation = confirmationEvent(discovery.id);
const snapshot = selectedSnapshot(candidate, discovery, confirmation);
const forecasts = createForecastEvents(snapshot, null, [registration]);
assert.equal(forecasts.length, 28);

const parent = parentForecast(forecasts);
const challenger = v8Forecast(forecasts);
const nansenParent = forecasts.find((forecast) => (
  forecast.modelVersion === "frozen-onchain-rank-v3"
  && forecast.candidateId === "smart-money-selection"
  && forecast.horizon === "1h"
));
assert.equal(parent.status, "ready");
assert.equal(parent.predictedRise, true);
assert.equal(nansenParent.status, "blocked");
assert.ok(nansenParent.blockers.includes("selection provider is not nansen-token-screener"));
assert.equal(challenger.status, "ready");
assert.equal(challenger.predictedRise, true);
assert.equal(challenger.decision, "paper-long");
assert.equal(challenger.score, 0.74);
assert.equal(challenger.predictedRiseProbability, 0.64);
assert.equal(challenger.predictedReturnPct, 8);
assert.equal(challenger.challengerRegistrationId, registration.id);
assert.equal(challenger.inputEvidence.discoveryAvailableAt, discovery.availableAt);
assert.deepEqual(challenger.inputEvidence.lunarcrushDiscoveryMetrics, selectionMetrics(candidate));

const ageBoundary = "2026-08-03T19:07:22.300Z";
const ageRegisteredAt = new Date("2026-08-03T19:08:00.000Z");
const ageRegistration = createChallengerRegistrationEvents(ageRegisteredAt).find((event) => (
  event.modelVersion === "frozen-onchain-rank-v16-lunarcrush-age-unbounded"
));
assert.ok(ageRegistration);
assert.equal(ageRegistration.evidenceBoundary, ageBoundary);
assert.equal(ageRegistration.changedDimension, "removeMaximumDexPairAge");
assert.equal(ageRegistration.removedBlocker, "pair older than 30 days");
assert.deepEqual(ageRegistration.posthocDerivation.excludedTokens, ["MINI", "ALTSZN"]);

const ageDiscovery = {
  ...discoveryEvent(candidate),
  id: "lunar-discovery-age-unbounded",
  observedAt: "2026-08-03T19:09:00.000Z",
  availableAt: "2026-08-03T19:09:00.000Z",
  collectionStartedAt: "2026-08-03T19:08:58.000Z",
};
const ageConfirmation = {
  ...confirmationEvent(ageDiscovery.id),
  id: "lunar-confirmation-age-unbounded",
  observedAt: "2026-08-03T19:10:00.000Z",
  candidates: [{
    chain: "solana",
    tokenAddress,
    status: "blocked",
    blockers: ["pair older than 30 days"],
    ageUnboundedStatus: "eligible",
    ageUnboundedBlockers: [],
  }],
};
const ageSnapshotAt = new Date("2026-08-03T19:11:00.000Z");
const ageMarket = {
  ...marketSnapshot(),
  observedAt: ageSnapshotAt.toISOString(),
  pairCreatedAt: ageSnapshotAt.getTime() - 45 * 24 * 60 * 60_000,
  providerPriceIntegrity: {
    ruleVersion: "token-edge-dex-execution-cross-endpoint-v1",
    tokenPairsPriceUsd: 0.0102,
    tokenBatchPriceUsd: 0.01,
    priceRatio: 1.02,
    tokenPairsLiquidityUsd: 41_000,
    tokenBatchLiquidityUsd: 40_000,
    liquidityRatio: 1.025,
    selectedQuotePolicy: "lower-price-and-lower-liquidity",
  },
};
const ageSnapshot = createSnapshotEvent({
  observedAt: ageSnapshotAt,
  chain: "solana",
  tokenAddress,
  cohort: "lunarcrush-age-unbounded-test",
  selection: {
    status: "verified",
    provider: ageDiscovery.provider,
    timeframe: ageDiscovery.timeframe,
    ruleVersion: ageDiscovery.ruleVersion,
    discoveryEventId: ageDiscovery.id,
    confirmationEventId: ageConfirmation.id,
    discoveryObservedAt: ageDiscovery.observedAt,
    discoveryAvailableAt: ageDiscovery.availableAt,
    confirmationObservedAt: ageConfirmation.observedAt,
    metrics: selectionMetrics(candidate),
  },
  market: ageMarket,
});
const ageForecasts = createForecastEvents(ageSnapshot, null, [registration, ageRegistration]);
const oldPairParent = parentForecast(ageForecasts);
const oldPairV8 = v8Forecast(ageForecasts);
const ageUnbounded = v16Forecast(ageForecasts);
assert.ok(oldPairParent.blockers.includes("pair older than 30 days"));
assert.ok(oldPairV8.blockers.includes("pair older than 30 days"));
assert.equal(ageUnbounded.status, "ready");
assert.equal(ageUnbounded.predictedRise, true);
assert.equal(ageUnbounded.pairAgeHours, 45 * 24);
assert.equal(ageUnbounded.removedMarketBlocker, "pair older than 30 days");
assert.equal(ageUnbounded.inputEvidence.entryProviderPriceIntegrity.priceRatio, 1.02);

const ageResolution = resolutionEvent(
  ageUnbounded,
  ageSnapshot,
  0.012,
  new Date(ageUnbounded.dueAt),
);
const ageComparison = challengerComparison([
  registration,
  ageRegistration,
  ageDiscovery,
  ageConfirmation,
  ageSnapshot,
  oldPairV8,
  ageUnbounded,
  ageResolution,
], ageRegistration.modelVersion);
assert.equal(ageComparison.comparisonPopulation, "incremental-coverage-only");
assert.equal(ageComparison.matchedForecasts, 1);
assert.equal(ageComparison.independentPairedFrames, 1);
assert.equal(ageComparison.uniqueTokens, 1);
assert.equal(ageComparison.lineageRejectedForecasts, 0);
assert.equal(ageComparison.unchangedPopulationForecastsExcluded, 0);
assert.equal(ageComparison.baselineAverageNetReturnPct, 0);
assert.equal(ageComparison.challengerAverageNetReturnPct, 16);
assert.equal(ageComparison.averagePairedDeltaPct, 16);

const ageStandardConfirmation = {
  ...ageConfirmation,
  id: "lunar-confirmation-age-standard-pair",
  observedAt: "2026-08-03T19:10:30.000Z",
  candidates: [{
    chain: "solana",
    tokenAddress,
    status: "eligible",
    blockers: [],
    ageUnboundedStatus: "eligible",
    ageUnboundedBlockers: [],
  }],
};
const ageStandardSnapshotAt = new Date("2026-08-03T19:11:30.000Z");
const ageStandardSnapshot = createSnapshotEvent({
  observedAt: ageStandardSnapshotAt,
  chain: "solana",
  tokenAddress,
  cohort: "lunarcrush-age-standard-pair-test",
  selection: {
    ...ageSnapshot.selection,
    confirmationEventId: ageStandardConfirmation.id,
    confirmationObservedAt: ageStandardConfirmation.observedAt,
  },
  market: {
    ...ageMarket,
    observedAt: ageStandardSnapshotAt.toISOString(),
    pairCreatedAt: ageStandardSnapshotAt.getTime() - 2 * 60 * 60_000,
  },
});
const ageStandardForecasts = createForecastEvents(
  ageStandardSnapshot,
  null,
  [registration, ageRegistration],
);
const standardPairV8 = v8Forecast(ageStandardForecasts);
const standardPairV16 = v16Forecast(ageStandardForecasts);
assert.equal(standardPairV8.status, "ready");
assert.equal(standardPairV16.status, "ready");
const standardPairV16Resolution = resolutionEvent(
  standardPairV16,
  ageStandardSnapshot,
  0.012,
  new Date(standardPairV16.dueAt),
);
const ageComparisonWithUnchangedPopulation = challengerComparison([
  registration,
  ageRegistration,
  ageDiscovery,
  ageStandardConfirmation,
  ageStandardSnapshot,
  standardPairV8,
  standardPairV16,
  standardPairV16Resolution,
  ageConfirmation,
  ageSnapshot,
  oldPairV8,
  ageUnbounded,
  ageResolution,
], ageRegistration.modelVersion);
assert.equal(ageComparisonWithUnchangedPopulation.matchedForecasts, 1);
assert.equal(ageComparisonWithUnchangedPopulation.unchangedPopulationForecastsExcluded, 1);

const forgedAgeSnapshot = {
  ...ageSnapshot,
  market: { ...ageSnapshot.market, providerPriceIntegrity: null },
};
const forgedAgeForecast = v16Forecast(createForecastEvents(
  forgedAgeSnapshot,
  null,
  [registration, ageRegistration],
));
assert.equal(forgedAgeForecast.status, "blocked");
assert.ok(forgedAgeForecast.blockers.includes("cross-endpoint entry execution evidence is invalid"));

const preRegistration = selectedSnapshot(candidate, {
  ...discovery,
  id: "lunar-discovery-before-registration",
  observedAt: "2026-08-03T06:39:00.000Z",
  availableAt: "2026-08-03T06:39:00.000Z",
  collectionStartedAt: "2026-08-03T06:38:58.000Z",
}, {
  ...confirmation,
  id: "lunar-confirmation-before-registration",
  sourceEventId: "lunar-discovery-before-registration",
  observedAt: "2026-08-03T06:39:30.000Z",
});
const preRegistrationV8 = v8Forecast(createForecastEvents(preRegistration, null, [registration]));
assert.equal(preRegistrationV8.status, "blocked");
assert.ok(preRegistrationV8.blockers.includes(
  "selection lineage is not strictly after the challenger registration",
));

const wrongProviderSnapshot = {
  ...snapshot,
  selection: { ...snapshot.selection, provider: "nansen-token-screener" },
};
const wrongProviderV8 = v8Forecast(createForecastEvents(wrongProviderSnapshot, null, [registration]));
assert.equal(wrongProviderV8.status, "blocked");
assert.ok(wrongProviderV8.blockers.includes("selection provider is not lunarcrush-coin-list"));

const wrongRuleSnapshot = {
  ...snapshot,
  selection: { ...snapshot.selection, ruleVersion: "future-edited-rule" },
};
const wrongRuleV8 = v8Forecast(createForecastEvents(wrongRuleSnapshot, null, [registration]));
assert.equal(wrongRuleV8.status, "blocked");
assert.ok(wrongRuleV8.blockers.includes("LunarCrush discovery used a different frozen rule"));

const parentResolution = resolutionEvent(parent, snapshot, 0.012, new Date(parent.dueAt));
const challengerResolution = resolutionEvent(challenger, snapshot, 0.012, new Date(challenger.dueAt));
const comparison = challengerComparison([
  registration,
  discovery,
  confirmation,
  snapshot,
  parent,
  challenger,
  parentResolution,
  challengerResolution,
]);
assert.equal(comparison.matchedForecasts, 1);
assert.equal(comparison.independentPairedFrames, 1);
assert.equal(comparison.uniqueTokens, 1);
assert.equal(comparison.outcomeMismatchCount, 0);
assert.equal(comparison.lineageRejectedForecasts, 0);
assert.equal(comparison.baselineAverageNetReturnPct, 16);
assert.equal(comparison.challengerAverageNetReturnPct, 16);
assert.equal(comparison.averagePairedDeltaPct, 0);

for (const forgedDiscovery of [
  { ...discovery, rule: { ...discovery.rule, maximumAltRankInclusive: 201 } },
  { ...discovery, availableAt: "2026-08-03T06:44:00.000Z" },
  { ...discovery, universe: { ...discovery.universe, complete: false } },
  {
    ...discovery,
    candidates: [{ ...candidate, interactions24h: 499 }],
  },
  {
    ...discovery,
    candidates: [
      candidate,
      lunarCandidate({
        tokenAddress: "OrderedLunarDiscovery111111111111111111111111",
        lunarcrushCoinId: 102,
        altRank: 90,
        altRankPrevious: 1_100,
        altRankImprovement: 1_010,
      }),
    ],
  },
]) {
  const rejected = challengerComparison([
    registration,
    forgedDiscovery,
    confirmation,
    snapshot,
    parent,
    challenger,
    parentResolution,
    challengerResolution,
  ]);
  assert.equal(rejected.matchedForecasts, 0);
  assert.equal(rejected.lineageRejectedForecasts, 1);
}

const forgedDecision = {
  ...challenger,
  predictedRise: false,
  decision: "paper-cash",
  score: 0.5,
  predictedRiseProbability: 0.36,
  predictedReturnPct: 0,
};
const forgedDecisionComparison = challengerComparison([
  registration,
  discovery,
  confirmation,
  snapshot,
  parent,
  forgedDecision,
  parentResolution,
  resolutionEvent(forgedDecision, snapshot, 0.012, new Date(forgedDecision.dueAt)),
]);
assert.equal(forgedDecisionComparison.matchedForecasts, 0);
assert.equal(forgedDecisionComparison.lineageRejectedForecasts, 1);

{
  const creatorRegistration = createChallengerRegistrationEvents(
    new Date("2026-08-03T16:18:00.000Z"),
  ).find((event) => (
    event.modelVersion === "frozen-onchain-rank-v15-lunarcrush-creator-distribution-gate"
  ));
  assert.ok(creatorRegistration);
  assert.equal(creatorRegistration.changedDimension, "lunarcrushCreatorDistributionGate");
  assert.equal(creatorRegistration.evidenceBoundary, "2026-08-03T16:17:30.000Z");
  assert.equal(creatorRegistration.minimumCreatorCountInclusive, 10);
  assert.equal(creatorRegistration.maximumTopCreatorInteractionShareInclusive, 0.5);
  assert.equal(creatorRegistration.maximumCreatorInteractionHhiInclusive, 0.35);

  const creatorCandidate = lunarCandidate({
    tokenAddress: "CreatorDistribution111111111111111111111111111",
    lunarcrushCoinId: 501,
  });
  const creatorDiscovery = {
    ...discoveryEvent(creatorCandidate),
    id: "lunar-discovery-v15",
    observedAt: "2026-08-03T16:18:20.000Z",
    collectionStartedAt: "2026-08-03T16:18:18.000Z",
    availableAt: "2026-08-03T16:18:20.000Z",
    universe: {
      ...discovery.universe,
      generatedAt: "2026-08-03T16:18:20.000Z",
    },
  };
  const creatorConfirmation = {
    ...confirmationEvent(creatorDiscovery.id),
    id: "lunar-confirmation-v15",
    observedAt: "2026-08-03T16:18:30.000Z",
    candidates: [{
      chain: "solana",
      tokenAddress: creatorCandidate.tokenAddress,
      status: "eligible",
    }],
  };
  const creatorSnapshotAt = new Date("2026-08-03T16:18:50.000Z");
  const creatorSnapshot = createSnapshotEvent({
    observedAt: creatorSnapshotAt,
    chain: "solana",
    tokenAddress: creatorCandidate.tokenAddress,
    cohort: "lunarcrush-creator-v15-test",
    selection: {
      status: "verified",
      provider: creatorDiscovery.provider,
      timeframe: creatorDiscovery.timeframe,
      ruleVersion: creatorDiscovery.ruleVersion,
      discoveryEventId: creatorDiscovery.id,
      confirmationEventId: creatorConfirmation.id,
      discoveryObservedAt: creatorDiscovery.observedAt,
      discoveryAvailableAt: creatorDiscovery.availableAt,
      confirmationObservedAt: creatorConfirmation.observedAt,
      metrics: selectionMetrics(creatorCandidate),
    },
    market: {
      ...marketSnapshot(),
      observedAt: creatorSnapshotAt.toISOString(),
      tokenAddress: creatorCandidate.tokenAddress,
      pairCreatedAt: creatorSnapshotAt.getTime() - 2 * 60 * 60_000,
    },
  });
  const broadMetrics = {
    creatorCount: 20,
    interactions24h: 20_000,
    topCreatorInteractionShare: 0.4,
    creatorInteractionHhi: 0.2,
    medianCreatorFollowers: 2_000,
    medianCreatorRank: 10,
    networkCounts: { unspecified: 20 },
  };
  const broadCreatorEvidence = creatorEvidence({
    id: "creator-evidence-broad-v15",
    tokenAddress: creatorCandidate.tokenAddress,
    discoveryId: creatorDiscovery.id,
    metrics: broadMetrics,
  });
  const concentratedMetrics = {
    ...broadMetrics,
    creatorCount: 8,
    topCreatorInteractionShare: 0.6,
    creatorInteractionHhi: 0.4,
  };
  const concentratedCreatorEvidence = creatorEvidence({
    id: "creator-evidence-concentrated-v15",
    tokenAddress: creatorCandidate.tokenAddress,
    discoveryId: creatorDiscovery.id,
    metrics: concentratedMetrics,
  });
  const registrations = [registration, creatorRegistration];
  const broadForecasts = createForecastEvents(
    creatorSnapshot, null, registrations, [], [creatorDiscovery, broadCreatorEvidence],
  );
  const concentratedForecasts = createForecastEvents(
    creatorSnapshot, null, registrations, [], [creatorDiscovery, concentratedCreatorEvidence],
  );
  const creatorParent = v8Forecast(broadForecasts);
  const broadV15 = v15Forecast(broadForecasts);
  const concentratedV15 = v15Forecast(concentratedForecasts);
  assert.equal(broadV15.status, "ready");
  assert.equal(broadV15.predictedRise, true);
  assert.equal(broadV15.decision, "paper-long");
  assert.equal(broadV15.additionalEvidenceEventId, broadCreatorEvidence.id);
  assert.deepEqual(broadV15.inputEvidence.creatorMetrics, broadMetrics);
  assert.equal(concentratedV15.status, "ready");
  assert.equal(concentratedV15.predictedRise, false);
  assert.equal(concentratedV15.decision, "paper-cash");

  const parentResolution = resolutionEvent(
    creatorParent, creatorSnapshot, 0.012, new Date(creatorParent.dueAt),
  );
  const broadResolution = resolutionEvent(
    broadV15, creatorSnapshot, 0.012, new Date(broadV15.dueAt),
  );
  const creatorComparison = buildScorecard([
    creatorRegistration,
    creatorDiscovery,
    creatorConfirmation,
    broadCreatorEvidence,
    creatorSnapshot,
    creatorParent,
    broadV15,
    parentResolution,
    broadResolution,
  ]).challengerComparisons.find((row) => (
    row.challengerModelVersion === creatorRegistration.modelVersion
  ));
  assert.equal(creatorComparison.matchedForecasts, 1);
  assert.equal(creatorComparison.averagePairedDeltaPct, 0);

  for (const forgedEvidence of [
    { ...broadCreatorEvidence, sourceDiscoveryEventId: "wrong-discovery" },
    { ...broadCreatorEvidence, availableAt: "2026-08-03T16:19:00.000Z" },
    { ...broadCreatorEvidence, creatorAggregateDigest: "forged" },
    { ...broadCreatorEvidence, rawCreatorIdentitiesRetained: true },
  ]) {
    const rejected = buildScorecard([
      creatorRegistration,
      creatorDiscovery,
      creatorConfirmation,
      forgedEvidence,
      creatorSnapshot,
      creatorParent,
      broadV15,
      parentResolution,
      broadResolution,
    ]).challengerComparisons.find((row) => (
      row.challengerModelVersion === creatorRegistration.modelVersion
    ));
    assert.equal(rejected.matchedForecasts, 0);
  }
}

{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-lunar-discovery-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const now = new Date("2026-08-03T07:00:00.000Z");
  const availableAt = new Date("2026-08-03T07:00:05.000Z");
  let calls = 0;
  const fetcher = async (url) => {
    calls += 1;
    if (String(url).includes("/time-series/v2")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          config: { generated: Math.floor(availableAt.getTime() / 1_000) },
          data: lunarUniverseHistoryRows(now),
        }),
      };
    }
    if (String(url).includes("/creators/v1")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { creator_id: "raw-one", creator_name: "Never Retain One", creator_rank: 1, interactions_24h: 600, creator_followers: 1_000 },
            { creator_id: "raw-two", creator_name: "Never Retain Two", creator_rank: 3, interactions_24h: 400, creator_followers: 2_000 },
          ],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        config: { total_rows: 1, generated: Math.floor(availableAt.getTime() / 1_000) },
        data: [lunarUniverseCoin()],
      }),
    };
  };
  const first = await collectTokenEdgeLunarDiscovery({
    ledgerPath,
    lunarcrushApiKey: "fixture-key",
    maxRequests: 10,
  }, { now, clock: () => availableAt, fetcher });
  assert.equal(first.status, "recorded");
  assert.equal(first.requestsAttempted, 3);
  assert.equal(first.candidates, 1);
  assert.equal(first.monitoringCandidates, 1);
  assert.equal(first.readyFollowupHistories, 1);
  assert.equal(first.blockedFollowupHistories, 0);
  assert.equal(first.readyCreatorAggregates, 1);
  assert.equal(first.blockedCreatorAggregates, 0);
  assert.equal(calls, 3);
  const second = await collectTokenEdgeLunarDiscovery({
    ledgerPath,
    lunarcrushApiKey: "fixture-key",
    maxRequests: 10,
  }, {
    now: new Date("2026-08-03T07:30:00.000Z"),
    clock: () => new Date("2026-08-03T07:30:05.000Z"),
    fetcher,
  });
  assert.equal(second.status, "skipped-existing-hour");
  assert.equal(second.requestsAttempted, 0);
  assert.equal(second.discoveryEventId, first.discoveryEventId);
  assert.equal(calls, 3);
  const events = await readLedger(ledgerPath);
  assert.equal(events.length, 3);
  assert.equal(events[0].provider, "lunarcrush-coin-list");
  assert.equal(events[0].observedAt, availableAt.toISOString());
  assert.equal(events[1].profile, "social-discovery-hourly-followup");
  assert.equal(events[1].sourceDiscoveryEventId, events[0].id);
  assert.equal(events[1].socialFeatures.contributorsActive, 60);
  assert.equal(events[2].type, "lunarcrush-creator-aggregate");
  assert.equal(events[2].sourceDiscoveryEventId, events[0].id);
  assert.equal(events[2].creatorMetrics.creatorCount, 2);
  assert.equal(events[2].creatorMetrics.topCreatorInteractionShare, 0.6);
  assert.equal(events[2].creatorMetrics.creatorInteractionHhi, 0.52);
  assert.equal(events[2].creatorMetrics.medianCreatorFollowers, 1_500);
  assert.equal(events[2].creatorMetrics.medianCreatorRank, 2);
  assert.deepEqual(events[2].creatorMetrics.networkCounts, { unspecified: 2 });
  assert.equal(events[2].providerGenerationReported, false);
  assert.equal(events[2].rawCreatorIdentitiesRetained, false);
  assert.equal(JSON.stringify(events).includes("Never Retain"), false);
  assert.equal(Object.hasOwn(events[2], "creatorResponseDigest"), false);
  assert.equal(verifyLedger(events).ok, true);
}

{
  const now = new Date("2026-08-03T07:00:00.000Z");
  const duplicateTopicCoin = {
    ...lunarUniverseCoin(),
    id: 202,
    blockchains: [{ network: "solana", address: "OtherTopicMint111111111111111111111111111111" }],
    market_cap: null,
  };
  let creatorCalls = 0;
  const collected = await collectSolanaLunarCrushDiscovery({
    apiKey: "fixture-key",
    chain: "solana",
    observedAt: now,
    maxRequests: 10,
  }, {
    clock: () => new Date("2026-08-03T07:00:05.000Z"),
    fetcher: async (url) => {
      if (String(url).includes("/creators/v1")) creatorCalls += 1;
      if (String(url).includes("/time-series/v2")) {
        return { ok: true, status: 200, json: async () => ({
          config: { generated: Math.floor(now.getTime() / 1_000) },
          data: lunarUniverseHistoryRows(now),
        }) };
      }
      return { ok: true, status: 200, json: async () => ({
        config: { total_rows: 2, generated: Math.floor(now.getTime() / 1_000) },
        data: [lunarUniverseCoin(), duplicateTopicCoin],
      }) };
    },
  });
  assert.equal(creatorCalls, 0);
  assert.equal(collected.requestBudget.attempted, 2);
  assert.equal(collected.creatorEvents.length, 1);
  assert.equal(collected.creatorEvents[0].status, "blocked");
  assert.equal(collected.creatorEvents[0].identity.topicUniverseCoinRowCount, 2);
  assert.equal(collected.creatorEvents[0].topicJoinStatus, "provider-coin-row-ambiguous-topic");
  assert.deepEqual(collected.creatorEvents[0].blockers, [
    "provider topic maps to multiple LunarCrush coin rows",
  ]);
}

{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-lunar-attempt-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { ok: false, status: 503, json: async () => ({}) };
  };
  const first = await collectTokenEdgeLunarDiscovery({
    ledgerPath,
    lunarcrushApiKey: "fixture-key",
    maxRequests: 10,
  }, {
    now: new Date("2026-08-03T08:00:00.000Z"),
    clock: () => new Date("2026-08-03T08:00:02.000Z"),
    fetcher,
  });
  assert.equal(first.status, "blocked");
  assert.equal(first.requestsAttempted, 1);
  assert.ok(first.attemptEventId);
  const second = await collectTokenEdgeLunarDiscovery({
    ledgerPath,
    lunarcrushApiKey: "fixture-key",
    maxRequests: 10,
  }, {
    now: new Date("2026-08-03T08:15:00.000Z"),
    clock: () => new Date("2026-08-03T08:15:02.000Z"),
    fetcher,
  });
  assert.equal(second.status, "skipped-existing-hour");
  assert.equal(second.requestsAttempted, 0);
  assert.equal(calls, 1);
  const events = await readLedger(ledgerPath);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "lunarcrush-discovery-attempt");
  assert.equal(events[0].status, "blocked");
  assert.equal(verifyLedger(events).ok, true);
}

console.log("token-edge LunarCrush discovery challenger checks passed.");

function lunarCandidate(overrides = {}) {
  return {
    chain: "solana",
    tokenAddress,
    symbol: "LUNAR",
    name: "Lunar Discovery",
    status: "eligible",
    ruleVersion: LUNARCRUSH_SOLANA_DISCOVERY_RULE.version,
    lunarcrushCoinId: 101,
    marketCapUsd: 500_000,
    volume24hUsd: 100_000,
    interactions24h: 10_000,
    socialVolume24h: 100,
    altRank: 100,
    altRankPrevious: 1_100,
    altRankImprovement: 1_000,
    galaxyScore: 60,
    galaxyScorePrevious: 50,
    galaxyScoreImprovement: 10,
    priceChange1hPct: 0,
    priceChange24hPct: 0,
    ...overrides,
  };
}

function lunarUniverseCoin() {
  const selected = lunarCandidate();
  return {
    id: selected.lunarcrushCoinId,
    symbol: selected.symbol,
    name: selected.name,
    topic: "lunar-discovery",
    blockchains: [{ network: "solana", address: tokenAddress, decimals: 6 }],
    market_cap: selected.marketCapUsd,
    volume_24h: selected.volume24hUsd,
    interactions_24h: selected.interactions24h,
    social_volume_24h: selected.socialVolume24h,
    alt_rank: selected.altRank,
    alt_rank_previous: selected.altRankPrevious,
    galaxy_score: selected.galaxyScore,
    galaxy_score_previous: selected.galaxyScorePrevious,
    percent_change_1h: selected.priceChange1hPct,
    percent_change_24h: selected.priceChange24hPct,
    price: 0.001,
  };
}

function lunarUniverseHistoryRows(at) {
  const lastClosedStart = Math.floor(at.getTime() / 3_600_000) * 3_600 - 3_600;
  return Array.from({ length: 25 }, (_, index) => ({
    time: lastClosedStart - ((24 - index) * 3_600),
    interactions: index === 24 ? 600 : 90 + (index % 5),
    posts_active: index === 24 ? 90 : 18 + (index % 3),
    contributors_active: index === 24 ? 60 : 12 + (index % 4),
    alt_rank: index === 24 ? 40 : 140 - index,
    galaxy_score: index === 24 ? 82 : 60 + (index % 4),
    sentiment: 70,
    spam: 2,
    social_dominance: 0.01,
    close: 0.001,
  }));
}

function discoveryEvent(selected) {
  return {
    type: "discovery",
    id: "lunar-discovery-v8",
    observedAt: discoveryAt,
    collectionStartedAt: "2026-08-03T06:40:58.000Z",
    availableAt: discoveryAt,
    provider: "lunarcrush-coin-list",
    sourceProvider: "lunarcrush",
    chain: "solana",
    timeframe: "1h",
    ruleVersion: LUNARCRUSH_SOLANA_DISCOVERY_RULE.version,
    rule: LUNARCRUSH_SOLANA_DISCOVERY_RULE,
    universe: {
      endpoint: "https://lunarcrush.com/api4/public/coins/list/v1",
      complete: true,
      pagesFetched: 6,
      rowsFetched: 5_463,
      reportedRows: 5_463,
      generatedAt: "2026-08-03T06:41:00.000Z",
      error: null,
    },
    candidates: [selected],
    researchOnly: true,
    mutationAllowed: false,
  };
}

function confirmationEvent(sourceEventId) {
  return {
    type: "market-confirmation",
    id: "lunar-confirmation-v8",
    observedAt: confirmationAt,
    sourceEventId,
    candidates: [{ chain: "solana", tokenAddress, status: "eligible" }],
  };
}

function selectedSnapshot(selected, sourceDiscovery, sourceConfirmation) {
  return createSnapshotEvent({
    observedAt: snapshotAt,
    chain: "solana",
    tokenAddress,
    cohort: "lunarcrush-discovery-v8-test",
    selection: {
      status: "verified",
      provider: sourceDiscovery.provider,
      timeframe: sourceDiscovery.timeframe,
      ruleVersion: sourceDiscovery.ruleVersion,
      discoveryEventId: sourceDiscovery.id,
      confirmationEventId: sourceConfirmation.id,
      discoveryObservedAt: sourceDiscovery.observedAt,
      discoveryAvailableAt: sourceDiscovery.availableAt,
      confirmationObservedAt: sourceConfirmation.observedAt,
      metrics: selectionMetrics(selected),
    },
    market: marketSnapshot(),
  });
}

function marketSnapshot() {
  return {
    source: "dexscreener",
    observedAt: snapshotAt.toISOString(),
    tokenAddress,
    pairAddress: "lunar-discovery-pool",
    symbol: "LUNAR",
    priceUsd: 0.01,
    liquidityUsd: 40_000,
    marketCapUsd: 500_000,
    fdvUsd: 500_000,
    volumeUsd: { m5: 1_000, h1: 20_000, h6: 60_000, h24: 100_000 },
    priceChangePct: { m5: 1, h1: 5, h6: 8, h24: 15 },
    txns: {
      m5: { buys: 10, sells: 5 },
      h1: { buys: 90, sells: 30 },
      h6: { buys: 200, sells: 100 },
      h24: { buys: 500, sells: 300 },
    },
    pairCreatedAt: snapshotAt.getTime() - 2 * 60 * 60_000,
  };
}

function selectionMetrics(selected) {
  return {
    lunarcrushCoinId: selected.lunarcrushCoinId,
    marketCapUsd: selected.marketCapUsd,
    volume24hUsd: selected.volume24hUsd,
    interactions24h: selected.interactions24h,
    socialVolume24h: selected.socialVolume24h,
    altRank: selected.altRank,
    altRankPrevious: selected.altRankPrevious,
    altRankImprovement: selected.altRankImprovement,
    galaxyScore: selected.galaxyScore,
    galaxyScorePrevious: selected.galaxyScorePrevious,
    galaxyScoreImprovement: selected.galaxyScoreImprovement,
    priceChange1hPct: selected.priceChange1hPct,
    priceChange24hPct: selected.priceChange24hPct,
  };
}

function parentForecast(rows) {
  return rows.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v3"
    && forecast.candidateId === "market-only-control"
    && forecast.horizon === "1h"
  ));
}

function v8Forecast(rows) {
  return rows.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v8-lunarcrush-social-discovery"
  ));
}

function v15Forecast(rows) {
  return rows.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v15-lunarcrush-creator-distribution-gate"
  ));
}

function v16Forecast(rows) {
  return rows.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v16-lunarcrush-age-unbounded"
  ));
}

function creatorEvidence({ id, tokenAddress: address, discoveryId, metrics }) {
  return {
    type: "lunarcrush-creator-aggregate",
    id,
    digest: "creator-event-digest",
    observedAt: "2026-08-03T16:18:20.000Z",
    collectionStartedAt: "2026-08-03T16:18:20.000Z",
    availableAt: "2026-08-03T16:18:40.000Z",
    provider: "lunarcrush",
    profile: "social-discovery-creator-aggregate",
    chain: "solana",
    tokenAddress: address,
    status: "ready",
    blockers: [],
    universe: { complete: true },
    identity: {
      matchStatus: "exact-single-contract-topic-match",
      network: "solana",
      contractAddress: address,
      topicUniverseCoinRowCount: 1,
    },
    topicJoinStatus: "provider-coin-row-exact-contract-unique-topic",
    creatorAggregateDigest: digestValue(metrics),
    creatorMetrics: metrics,
    aggregateOnly: true,
    rawCreatorIdentitiesRetained: false,
    researchOnly: true,
    mutationAllowed: false,
    sourceDiscoveryEventId: discoveryId,
  };
}

function challengerComparison(events, modelVersion = registration.modelVersion) {
  return buildScorecard(events).challengerComparisons.find((row) => (
    row.challengerModelVersion === modelVersion
  ));
}
