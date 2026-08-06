#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendLedgerEvent,
  buildScorecard,
  createChallengerRegistrationEvents,
  createForecastEvents,
  createSnapshotEvent,
  eventWithIntegrity,
  readLedger,
  resolutionEvent,
} from "./token-edge/onchain-forward-core.mjs";
import {
  LUNARCRUSH_MOVE_ALERT_RULE,
  LUNARCRUSH_EXACT_CONTRACT_TOPIC_RULE,
  LUNARCRUSH_EXACT_CONTRACT_TOPIC_STRUCTURE_RULE,
  LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE,
  LUNARCRUSH_SOLANA_DISCOVERY_RULE,
  LUNARCRUSH_SOLANA_MONITORING_RULE,
  collectExactMintLunarCrushEvidence,
  collectExactMintLunarCrushTopicEvidence,
  collectExactMintLunarCrushTopicStructureEvidence,
  collectExactMintLunarCrushPostsEvidence,
  deriveLunarCrushSolanaDiscoveryCandidates,
  deriveLunarCrushSolanaMonitoringCandidates,
} from "./token-edge/onchain-lunarcrush-provider.mjs";
import { createExecutionPolicyRegistrationEvents } from "./token-edge/onchain-capacity-scorecard.mjs";
import { collectTokenEdgeSnapshots } from "./token-edge/onchain-forward-research.mjs";

const tokenAddress = "ExactMint11111111111111111111111111111111";
const unmatchedAddress = "UnmatchedMint1111111111111111111111111111";
const observedAt = new Date("2026-08-03T03:15:00.000Z");
const generatedAt = Math.floor(observedAt.getTime() / 1_000) - 60;

{
  const calls = [];
  const result = await collectExactMintLunarCrushEvidence({
    apiKey: "test-key",
    chain: "solana",
    tokenAddresses: [tokenAddress, unmatchedAddress],
    observedAt,
    maxRequests: 10,
  }, {
    clock: () => observedAt,
    fetcher: async (url, init) => {
      calls.push(String(url));
      assert.equal(init.headers.Authorization, "Bearer test-key");
      if (String(url).includes("/coins/list/v1")) {
        return jsonResponse({
          config: { generated: generatedAt, total_rows: 1 },
          data: [coinRecord(101, tokenAddress)],
        });
      }
      assert.match(String(url), /\/coins\/101\/time-series\/v2/);
      return jsonResponse({ config: { id: "coins:101", generated: generatedAt }, data: socialRows() });
    },
  });
  assert.equal(result.requestBudget.attempted, 2);
  assert.equal(result.universe.complete, true);
  assert.equal(result.discovery.provider, "lunarcrush-coin-list");
  assert.equal(result.discovery.observedAt, observedAt.toISOString());
  assert.deepEqual(result.discovery.candidates, []);
  assert.equal(result.events.length, 2);
  const exact = result.events.find((event) => event.tokenAddress === tokenAddress);
  assert.equal(exact.status, "ready");
  assert.equal(exact.identity.matchStatus, "exact-single-contract-match");
  assert.equal(exact.identity.contractAddress, tokenAddress);
  assert.equal(exact.availableAt, observedAt.toISOString());
  assert.equal(exact.ruleVersion, LUNARCRUSH_MOVE_ALERT_RULE.version);
  assert.equal(exact.socialFeatures.largeMoveAlert, true);
  assert.equal(exact.historyRows.length, 25);
  assert.ok(exact.historyRows.every((row) => (
    row.time + 3_600 <= Math.floor(observedAt.getTime() / 1_000)
  )));
  const unmatched = result.events.find((event) => event.tokenAddress === unmatchedAddress);
  assert.equal(unmatched.status, "blocked");
  assert.deepEqual(unmatched.blockers, ["contract address is not tracked in the complete LunarCrush coin universe"]);
  assert.equal(calls.length, 2);

  const registrations = createChallengerRegistrationEvents(new Date("2026-08-03T02:30:00.000Z"));
  assert.equal(registrations.length, 13);
  const lunarRegistration = registrations.find((event) => (
    event.modelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  ));
  assert.ok(lunarRegistration);
  const snapshot = createSnapshotEvent({
    observedAt,
    chain: "solana",
    tokenAddress,
    selection: {
      status: "verified",
      provider: "nansen-token-screener",
      timeframe: "6h",
      discoveryEventId: "discovery-fixture",
      confirmationEventId: "confirmation-fixture",
      discoveryObservedAt: "2026-08-03T02:40:00.000Z",
      confirmationObservedAt: "2026-08-03T02:50:00.000Z",
      metrics: {},
    },
    market: marketSnapshot(),
  });
  const forecasts = createForecastEvents(snapshot, null, registrations, [], [exact]);
  assert.equal(forecasts.length, 28);
  const lunarForecast = forecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  ));
  assert.equal(lunarForecast.status, "ready");
  assert.equal(lunarForecast.predictedRise, true);
  assert.equal(lunarForecast.decision, "paper-long");
  assert.equal(lunarForecast.additionalEvidenceEventId, exact.id);
  assert.equal(lunarForecast.inputEvidence.additionalEvidenceDigest, exact.digest ?? null);
}

{
  const eligible = socialDiscoveryCoin();
  const candidates = deriveLunarCrushSolanaDiscoveryCandidates([
    eligible,
    socialDiscoveryCoin({
      id: 202,
      symbol: "SECOND",
      blockchains: [{ network: "solana", address: unmatchedAddress, decimals: 6 }],
      alt_rank: 50,
      alt_rank_previous: 1_100,
      galaxy_score: 60,
      galaxy_score_previous: 50,
    }),
  ]);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].tokenAddress, unmatchedAddress);
  assert.equal(candidates[1].tokenAddress, tokenAddress);
  assert.equal(candidates[1].ruleVersion, LUNARCRUSH_SOLANA_DISCOVERY_RULE.version);
  assert.equal(candidates[1].altRankImprovement, 1_000);
  assert.equal(candidates[1].galaxyScoreImprovement, 10);
  assert.deepEqual(deriveLunarCrushSolanaDiscoveryCandidates([
    eligible,
    socialDiscoveryCoin({ id: 303, symbol: "DUPLICATE" }),
  ]), []);
  const monitoring = deriveLunarCrushSolanaMonitoringCandidates([
    socialDiscoveryCoin({ price: 0.001 }),
  ]);
  assert.equal(monitoring.length, 1);
  assert.equal(monitoring[0].status, "monitoring-only");
  assert.equal(monitoring[0].ruleVersion, LUNARCRUSH_SOLANA_MONITORING_RULE.version);
  assert.equal(monitoring[0].priceUsd, 0.001);
  assert.deepEqual(deriveLunarCrushSolanaMonitoringCandidates([
    socialDiscoveryCoin({ price: 0.001, market_cap: 20_000_000 }),
  ]), []);
  for (const excluded of [
    { market_cap: 5_000_000 },
    { percent_change_1h: 10 },
    { percent_change_24h: 30 },
    { alt_rank: 201 },
    { alt_rank_previous: 1_199 },
    { galaxy_score_previous: 50.001 },
    { blockchains: [
      { network: "solana", address: tokenAddress, decimals: 6 },
      { network: "solana", address: unmatchedAddress, decimals: 6 },
    ] },
  ]) {
    assert.deepEqual(deriveLunarCrushSolanaDiscoveryCandidates([
      socialDiscoveryCoin(excluded),
    ]), []);
  }
}

{
  const signalAt = new Date("2026-08-03T06:15:00.000Z");
  const providerGeneratedAt = Math.floor(signalAt.getTime() / 1_000) - 60;
  const registrations = createChallengerRegistrationEvents(
    new Date("2026-08-03T05:30:00.000Z"),
  );
  const registration = eventWithIntegrity(registrations.find((event) => (
    event.modelVersion === "frozen-onchain-rank-v6-lunarcrush-next-day-move-gate"
  )));
  assert.equal(registration.horizon, "24h");
  assert.equal(registration.changedDimension, "exactMintLunarCrushMoveAlert24h");
  const discovery = eventWithIntegrity({
    type: "discovery",
    id: "v6-discovery-fixture",
    observedAt: "2026-08-03T05:45:00.000Z",
    provider: "nansen-token-screener",
    chain: "solana",
    timeframe: "6h",
    candidates: [{ chain: "solana", tokenAddress, status: "eligible" }],
  });
  const confirmation = eventWithIntegrity({
    type: "market-confirmation",
    id: "v6-confirmation-fixture",
    observedAt: "2026-08-03T06:00:00.000Z",
    sourceEventId: discovery.id,
    chain: "solana",
    candidates: [{ chain: "solana", tokenAddress, status: "eligible" }],
  });
  const evidence = eventWithIntegrity((await collectExactMintLunarCrushEvidence({
    apiKey: "test-key",
    chain: "solana",
    tokenAddresses: [tokenAddress],
    observedAt: signalAt,
    maxRequests: 10,
  }, {
    clock: () => signalAt,
    fetcher: async (url) => String(url).includes("/coins/list/v1")
      ? jsonResponse({
        config: { generated: providerGeneratedAt, total_rows: 1 },
        data: [coinRecord(101, tokenAddress)],
      })
      : jsonResponse({
        config: { id: "coins:101", generated: providerGeneratedAt },
        data: socialRows(signalAt),
      }),
  })).events[0]);
  const snapshot = eventWithIntegrity(createSnapshotEvent({
    observedAt: signalAt,
    chain: "solana",
    tokenAddress,
    selection: {
      status: "verified",
      provider: discovery.provider,
      timeframe: discovery.timeframe,
      discoveryEventId: discovery.id,
      confirmationEventId: confirmation.id,
      discoveryObservedAt: discovery.observedAt,
      confirmationObservedAt: confirmation.observedAt,
      metrics: {},
    },
    market: marketSnapshot(signalAt),
  }));
  const forecasts = createForecastEvents(snapshot, null, [registration], [], [evidence]);
  const parent = eventWithIntegrity(forecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v3"
    && forecast.candidateId === "smart-money-selection"
    && forecast.horizon === "24h"
  )));
  const challenger = eventWithIntegrity(forecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v6-lunarcrush-next-day-move-gate"
  )));
  assert.equal(challenger.status, "ready");
  assert.equal(challenger.predictedRise, true);
  assert.equal(challenger.predictedReturnPct, 19.2);
  assert.equal(challenger.additionalEvidenceEventId, evidence.id);
  const resolvedAt = new Date("2026-08-04T06:15:00.000Z");
  const exitMarket = { ...marketSnapshot(resolvedAt), priceUsd: 0.0012 };
  const comparison = buildScorecard([
    registration,
    discovery,
    confirmation,
    evidence,
    snapshot,
    parent,
    challenger,
    eventWithIntegrity(resolutionEvent(parent, snapshot, 0.0012, resolvedAt, exitMarket)),
    eventWithIntegrity(resolutionEvent(challenger, snapshot, 0.0012, resolvedAt, exitMarket)),
  ]).challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v6-lunarcrush-next-day-move-gate"
  ));
  assert.equal(comparison.lineageRejectedForecasts, 0);
  assert.equal(comparison.matchedForecasts, 1);
  assert.equal(comparison.outcomeMismatchCount, 0);
}

{
  const registration = eventWithIntegrity(createChallengerRegistrationEvents(
    new Date("2026-08-03T02:30:00.000Z"),
  ).find((event) => event.modelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"));
  const executionRegistration = eventWithIntegrity(createExecutionPolicyRegistrationEvents(
    new Date("2026-08-03T02:35:00.000Z"),
  )[0]);
  const discovery = eventWithIntegrity({
    type: "discovery",
    id: "discovery-fixture",
    observedAt: "2026-08-03T02:40:00.000Z",
    provider: "nansen-token-screener",
    chain: "solana",
    timeframe: "6h",
    candidates: [{ chain: "solana", tokenAddress, status: "eligible" }],
  });
  const confirmation = eventWithIntegrity({
    type: "market-confirmation",
    id: "confirmation-fixture",
    observedAt: "2026-08-03T02:50:00.000Z",
    sourceEventId: discovery.id,
    chain: "solana",
    candidates: [{ chain: "solana", tokenAddress, status: "eligible" }],
  });
  const evidence = eventWithIntegrity((await collectExactMintLunarCrushEvidence({
    apiKey: "test-key",
    chain: "solana",
    tokenAddresses: [tokenAddress],
    observedAt,
    maxRequests: 10,
  }, {
    clock: () => observedAt,
    fetcher: async (url) => String(url).includes("/coins/list/v1")
      ? jsonResponse({ config: { generated: generatedAt, total_rows: 1 }, data: [coinRecord(101, tokenAddress)] })
      : jsonResponse({ config: { id: "coins:101", generated: generatedAt }, data: socialRows() }),
  })).events[0]);
  const snapshot = eventWithIntegrity(createSnapshotEvent({
    observedAt,
    chain: "solana",
    tokenAddress,
    selection: {
      status: "verified",
      provider: discovery.provider,
      timeframe: discovery.timeframe,
      discoveryEventId: discovery.id,
      confirmationEventId: confirmation.id,
      discoveryObservedAt: discovery.observedAt,
      confirmationObservedAt: confirmation.observedAt,
      metrics: {},
    },
    market: marketSnapshot(),
  }));
  const forecasts = createForecastEvents(
    snapshot,
    null,
    [registration],
    [executionRegistration],
    [evidence],
  );
  const parent = eventWithIntegrity(forecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v3"
    && forecast.candidateId === "smart-money-selection"
    && forecast.horizon === "1h"
  )));
  const challenger = eventWithIntegrity(forecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  )));
  const resolvedAt = new Date("2026-08-03T04:15:00.000Z");
  const exitMarket = { ...marketSnapshot(), observedAt: resolvedAt.toISOString(), priceUsd: 0.0011 };
  const parentOutcome = eventWithIntegrity(resolutionEvent(parent, snapshot, 0.0011, resolvedAt, exitMarket));
  const challengerOutcome = eventWithIntegrity(resolutionEvent(challenger, snapshot, 0.0011, resolvedAt, exitMarket));
  const events = [
    registration,
    executionRegistration,
    discovery,
    confirmation,
    evidence,
    snapshot,
    parent,
    challenger,
    parentOutcome,
    challengerOutcome,
  ];
  const validScorecard = buildScorecard(events);
  const comparison = validScorecard.challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  ));
  assert.equal(comparison.lineageRejectedForecasts, 0);
  assert.equal(comparison.matchedForecasts, 1);
  assert.equal(comparison.outcomeMismatchCount, 0);
  assert.equal(validScorecard.capacityAudit.rows.find((row) => (
    row.modelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  )).capacityEligibleLiveOutcomes, 1);
  const withoutSocialEvidenceScorecard = buildScorecard(events.filter((event) => (
    event.id !== evidence.id
  )));
  const withoutSocialEvidence = withoutSocialEvidenceScorecard.challengerComparisons.find((row) => (
      row.challengerModelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  ));
  assert.equal(withoutSocialEvidence.lineageRejectedForecasts, 1);
  assert.equal(withoutSocialEvidence.matchedForecasts, 0);
  assert.equal(withoutSocialEvidenceScorecard.capacityAudit.rows.find((row) => (
    row.modelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  )).capacityEligibleLiveOutcomes, 0);
  assert.equal(
    withoutSocialEvidenceScorecard.capacityAudit.ineligibilityCounts["challenger-lineage-rejected"],
    1,
  );

  const decisionTampered = eventWithIntegrity({
    ...challenger,
    predictedRise: false,
    predictedRiseProbability: 0.38,
    predictedReturnPct: 0,
    score: 0.5,
    decision: "paper-cash",
  });
  const decisionTamperedOutcome = eventWithIntegrity(resolutionEvent(
    decisionTampered,
    snapshot,
    0.0011,
    resolvedAt,
    exitMarket,
  ));
  const decisionTamperedScorecard = buildScorecard([
    registration,
    executionRegistration,
    discovery,
    confirmation,
    evidence,
    snapshot,
    parent,
    decisionTampered,
    parentOutcome,
    decisionTamperedOutcome,
  ]);
  const decisionTamperedComparison = decisionTamperedScorecard.challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  ));
  assert.equal(decisionTamperedComparison.lineageRejectedForecasts, 1);
  assert.equal(decisionTamperedComparison.matchedForecasts, 0);
  assert.equal(decisionTamperedScorecard.capacityAudit.rows.find((row) => (
    row.modelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  )).capacityEligibleLiveOutcomes, 0);
  assert.equal(
    decisionTamperedScorecard.capacityAudit.ineligibilityCounts["challenger-lineage-rejected"],
    1,
  );

  const evidenceAvailableAfterForecast = eventWithIntegrity({
    ...evidence,
    availableAt: new Date(observedAt.getTime() + 60_000).toISOString(),
  });
  const availabilityBlockedAtCreation = createForecastEvents(
    snapshot,
    null,
    [registration],
    [],
    [evidenceAvailableAfterForecast],
  ).find((forecast) => forecast.modelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate");
  assert.equal(availabilityBlockedAtCreation.status, "blocked");
  assert.ok(availabilityBlockedAtCreation.blockers.includes(
    "LunarCrush evidence was not available before the forecast",
  ));
  const evidenceGeneratedAfterForecast = eventWithIntegrity({
    ...evidence,
    historyGeneratedAt: new Date(observedAt.getTime() + 1_000).toISOString(),
  });
  const providerTimeBlockedAtCreation = createForecastEvents(
    snapshot,
    null,
    [registration],
    [],
    [evidenceGeneratedAfterForecast],
  ).find((forecast) => forecast.modelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate");
  assert.equal(providerTimeBlockedAtCreation.status, "blocked");
  assert.ok(providerTimeBlockedAtCreation.blockers.includes(
    "LunarCrush provider evidence was generated after the forecast",
  ));
  const availabilityTamperedChallenger = eventWithIntegrity({
    ...challenger,
    additionalEvidenceDigest: evidenceAvailableAfterForecast.digest,
    additionalEvidenceAvailableAt: evidenceAvailableAfterForecast.availableAt,
    inputEvidence: {
      ...challenger.inputEvidence,
      additionalEvidenceDigest: evidenceAvailableAfterForecast.digest,
      additionalEvidenceAvailableAt: evidenceAvailableAfterForecast.availableAt,
    },
  });
  const availabilityTamperedOutcome = eventWithIntegrity(resolutionEvent(
    availabilityTamperedChallenger,
    snapshot,
    0.0011,
    resolvedAt,
    exitMarket,
  ));
  const availabilityTamperedComparison = buildScorecard([
    registration,
    discovery,
    confirmation,
    evidenceAvailableAfterForecast,
    snapshot,
    parent,
    availabilityTamperedChallenger,
    parentOutcome,
    availabilityTamperedOutcome,
  ]).challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  ));
  assert.equal(availabilityTamperedComparison.lineageRejectedForecasts, 1);
  assert.equal(availabilityTamperedComparison.matchedForecasts, 0);

  const ruleTamperedEvidence = eventWithIntegrity({
    ...evidence,
    rule: { ...evidence.rule, maximumAltRank: 999 },
  });
  const ruleTamperedForecasts = createForecastEvents(
    snapshot,
    null,
    [registration],
    [],
    [ruleTamperedEvidence],
  );
  const ruleTamperedChallenger = eventWithIntegrity(ruleTamperedForecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  )));
  const ruleTamperedOutcome = eventWithIntegrity(resolutionEvent(
    ruleTamperedChallenger,
    snapshot,
    0.0011,
    resolvedAt,
    exitMarket,
  ));
  const ruleTamperedComparison = buildScorecard([
    registration,
    discovery,
    confirmation,
    ruleTamperedEvidence,
    snapshot,
    parent,
    ruleTamperedChallenger,
    parentOutcome,
    ruleTamperedOutcome,
  ]).challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  ));
  assert.equal(ruleTamperedComparison.lineageRejectedForecasts, 1);
  assert.equal(ruleTamperedComparison.matchedForecasts, 0);

  const featureTamperedEvidence = eventWithIntegrity({
    ...evidence,
    socialFeatures: { ...evidence.socialFeatures, largeMoveAlert: false },
  });
  const featureTamperedForecasts = createForecastEvents(
    snapshot,
    null,
    [registration],
    [],
    [featureTamperedEvidence],
  );
  const featureTamperedChallenger = eventWithIntegrity(featureTamperedForecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  )));
  const featureTamperedOutcome = eventWithIntegrity(resolutionEvent(
    featureTamperedChallenger,
    snapshot,
    0.0011,
    resolvedAt,
    exitMarket,
  ));
  const featureTamperedComparison = buildScorecard([
    registration,
    discovery,
    confirmation,
    featureTamperedEvidence,
    snapshot,
    parent,
    featureTamperedChallenger,
    parentOutcome,
    featureTamperedOutcome,
  ]).challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  ));
  assert.equal(featureTamperedComparison.lineageRejectedForecasts, 1);
  assert.equal(featureTamperedComparison.matchedForecasts, 0);

  const registrationTampered = eventWithIntegrity({
    ...registration,
    lunarcrushRule: { ...registration.lunarcrushRule, maximumAltRank: 999 },
  });
  const registrationTamperedComparison = buildScorecard([
    registrationTampered,
    discovery,
    confirmation,
    evidence,
    snapshot,
    parent,
    challenger,
    parentOutcome,
    challengerOutcome,
  ]).challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  ));
  assert.equal(registrationTamperedComparison.lineageRejectedForecasts, 1);
  assert.equal(registrationTamperedComparison.matchedForecasts, 0);

  const lowerTokenAddress = tokenAddress.toLowerCase();
  const caseTamperedEvidence = eventWithIntegrity({
    ...evidence,
    tokenAddress: lowerTokenAddress,
    identity: {
      ...evidence.identity,
      contractAddress: lowerTokenAddress,
    },
  });
  const caseTamperedChallenger = eventWithIntegrity({
    ...challenger,
    tokenAddress: lowerTokenAddress,
    additionalEvidenceDigest: caseTamperedEvidence.digest,
    inputEvidence: {
      ...challenger.inputEvidence,
      additionalEvidenceDigest: caseTamperedEvidence.digest,
      lunarcrushContractAddress: lowerTokenAddress,
    },
  });
  const caseTamperedOutcome = eventWithIntegrity(resolutionEvent(
    caseTamperedChallenger,
    snapshot,
    0.0011,
    resolvedAt,
    exitMarket,
  ));
  const caseTamperedComparison = buildScorecard([
    registration,
    discovery,
    confirmation,
    caseTamperedEvidence,
    snapshot,
    parent,
    caseTamperedChallenger,
    parentOutcome,
    caseTamperedOutcome,
  ]).challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  ));
  assert.equal(caseTamperedComparison.lineageRejectedForecasts, 1);
  assert.equal(caseTamperedComparison.matchedForecasts, 0);
}

{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-lunar-clock-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const discoveryAt = new Date("2026-08-03T09:58:30.000Z");
  const confirmationAt = new Date("2026-08-03T09:59:00.000Z");
  const collectionStartedAt = new Date("2026-08-03T10:00:00.000Z");
  const availableAt = new Date("2026-08-03T10:00:00.050Z");
  const rawDecisionAt = new Date("2026-08-03T10:00:00.080Z");
  const providerEvidenceAt = new Date("2026-08-03T10:00:00.100Z");
  const clockValues = [collectionStartedAt, availableAt, rawDecisionAt];
  const registrations = createChallengerRegistrationEvents(
    new Date("2026-08-03T09:58:00.000Z"),
  );
  for (const registration of registrations) await appendLedgerEvent(ledgerPath, registration);
  await appendLedgerEvent(ledgerPath, {
    type: "discovery",
    id: "lunar-clock-discovery",
    observedAt: discoveryAt.toISOString(),
    provider: "nansen-token-screener",
    chain: "solana",
    timeframe: "6h",
    candidates: [{
      chain: "solana",
      tokenAddress,
      status: "eligible",
      netflowUsd: 8_000,
      netflowToLiquidity: 0.08,
      buySellVolumeRatio: 2,
      priceChangePct: 5,
      liquidityUsd: 30_000,
    }],
  });
  await appendLedgerEvent(ledgerPath, {
    type: "market-confirmation",
    id: "lunar-clock-confirmation",
    observedAt: confirmationAt.toISOString(),
    sourceEventId: "lunar-clock-discovery",
    chain: "solana",
    candidates: [{
      chain: "solana",
      tokenAddress,
      status: "eligible",
      market: { liquidityUsd: 30_000, priceChangeH1Pct: 5 },
    }],
  });
  const collected = await collectTokenEdgeSnapshots({
    ledgerPath,
    chain: "solana",
    tokenAddresses: [tokenAddress],
    selectionConfirmationEventId: "lunar-clock-confirmation",
    nansenProfile: "off",
    maxNansenCredits: 0,
    lunarcrushProfile: "exact-mint-hourly",
    lunarcrushApiKey: "test-key",
    maxLunarcrushRequests: 10,
  }, {
    clock: () => clockValues.shift() ?? rawDecisionAt,
    fetcher: async (url) => {
      const target = String(url);
      if (target.includes("/coins/list/v1")) {
        return jsonResponse({
          config: { generated: providerEvidenceAt.getTime() / 1_000, total_rows: 1 },
          data: [coinRecord(101, tokenAddress)],
        });
      }
      if (target.includes("/coins/101/time-series/v2")) {
        return jsonResponse({
          config: { id: "coins:101", generated: providerEvidenceAt.getTime() / 1_000 },
          data: socialRows(collectionStartedAt),
        });
      }
      assert.match(target, /\/token-pairs\/v1\/solana\//);
      return jsonResponse([{
        chainId: "solana",
        dexId: "raydium",
        pairAddress: "PairClock111",
        url: "https://dexscreener.com/solana/PairClock111",
        baseToken: { address: tokenAddress, symbol: "EXACT" },
        priceUsd: "0.001",
        liquidity: { usd: 30_000 },
        marketCap: 250_000,
        fdv: 250_000,
        pairCreatedAt: collectionStartedAt.getTime() - (3 * 60 * 60_000),
        volume: { m5: 2_000, h1: 20_000, h6: 80_000, h24: 200_000 },
        priceChange: { m5: 1, h1: 2, h6: 5, h24: 10 },
        txns: {
          m5: { buys: 10, sells: 5 },
          h1: { buys: 50, sells: 20 },
          h6: { buys: 100, sells: 50 },
          h24: { buys: 250, sells: 100 },
        },
      }]);
    },
  });
  assert.equal(collected.results[0].status, "recorded");
  const events = await readLedger(ledgerPath);
  const snapshot = events.find((event) => event.type === "snapshot");
  const evidence = events.find((event) => event.type === "lunarcrush-social-snapshot");
  const discovery = events.find((event) => (
    event.type === "discovery" && event.provider === "lunarcrush-coin-list"
  ));
  assert.equal(collected.lunarcrush.discoveryEventId, discovery.id);
  assert.equal(collected.lunarcrush.discoveryCandidates, 0);
  assert.equal(discovery.availableAt, availableAt.toISOString());
  assert.equal(evidence.availableAt, availableAt.toISOString());
  assert.equal(evidence.historyGeneratedAt, providerEvidenceAt.toISOString());
  assert.equal(snapshot.market.observedAt, rawDecisionAt.toISOString());
  assert.equal(snapshot.observedAt, providerEvidenceAt.toISOString());
  for (const modelVersion of [
    "frozen-onchain-rank-v5-lunarcrush-move-gate",
    "frozen-onchain-rank-v6-lunarcrush-next-day-move-gate",
    "frozen-onchain-rank-v10-social-magnitude-direction",
  ]) {
    const forecast = events.find((event) => event.type === "forecast" && event.modelVersion === modelVersion);
    assert.equal(forecast.status, "ready");
    const comparison = buildScorecard(events).challengerComparisons.find((row) => (
      row.challengerModelVersion === modelVersion
    ));
    assert.equal(comparison.lineageRejectedForecasts, 0);
  }
  const freshMagnitudeForecast = events.find((event) => (
    event.type === "forecast"
    && event.modelVersion === "frozen-onchain-rank-v10-social-magnitude-direction"
  ));
  assert.equal(freshMagnitudeForecast.status, "ready");
  assert.equal(freshMagnitudeForecast.decision, "paper-cash");
  assert.equal(freshMagnitudeForecast.additionalEvidenceEventId, discovery.id);

  const futureEvidenceAt = new Date("2026-08-03T10:02:00.000Z");
  const { digest: discardedDigest, ...unsignedEvidence } = evidence;
  void discardedDigest;
  await appendLedgerEvent(ledgerPath, {
    ...unsignedEvidence,
    id: "lunar-future-evidence",
    observedAt: futureEvidenceAt.toISOString(),
    availableAt: futureEvidenceAt.toISOString(),
    historyGeneratedAt: futureEvidenceAt.toISOString(),
  });
  const reusedAt = new Date("2026-08-03T10:01:30.000Z");
  const reused = await collectTokenEdgeSnapshots({
    ledgerPath,
    chain: "solana",
    tokenAddresses: [tokenAddress],
    selectionConfirmationEventId: "lunar-clock-confirmation",
    nansenProfile: "off",
    maxNansenCredits: 0,
    lunarcrushProfile: "off",
  }, {
    clock: () => reusedAt,
    fetcher: async (url) => {
      assert.match(String(url), /\/token-pairs\/v1\/solana\//);
      return jsonResponse([{
        chainId: "solana",
        dexId: "raydium",
        pairAddress: "PairClockReuse111",
        url: "https://dexscreener.com/solana/PairClockReuse111",
        baseToken: { address: tokenAddress, symbol: "EXACT" },
        priceUsd: "0.001",
        liquidity: { usd: 30_000 },
        marketCap: 250_000,
        fdv: 250_000,
        pairCreatedAt: collectionStartedAt.getTime() - (3 * 60 * 60_000),
        volume: { m5: 2_000, h1: 20_000, h6: 80_000, h24: 200_000 },
        priceChange: { m5: 1, h1: 2, h6: 5, h24: 10 },
        txns: {
          m5: { buys: 10, sells: 5 },
          h1: { buys: 50, sells: 20 },
          h6: { buys: 100, sells: 50 },
          h24: { buys: 250, sells: 100 },
        },
      }]);
    },
  });
  assert.equal(reused.lunarcrush.requestBudget.attempted, 0);
  assert.equal(reused.lunarcrush.reusedEvidence, 1);
  const reusedEvents = await readLedger(ledgerPath);
  const reusedForecast = reusedEvents.find((event) => (
    event.type === "forecast"
    && event.snapshotId === reused.results[0].snapshotId
    && event.modelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  ));
  assert.equal(reusedForecast.status, "ready");
  assert.equal(reusedForecast.additionalEvidenceEventId, evidence.id);
  const reusedMagnitudeForecast = reusedEvents.find((event) => (
    event.type === "forecast"
    && event.snapshotId === reused.results[0].snapshotId
    && event.modelVersion === "frozen-onchain-rank-v10-social-magnitude-direction"
  ));
  assert.equal(reusedMagnitudeForecast.status, "ready");
  assert.equal(reusedMagnitudeForecast.additionalEvidenceEventId, discovery.id);
}

{
  const calls = [];
  const broadDiscoveryAddress = "BroadDiscoveryMint22222222222222222222222222";
  const result = await collectExactMintLunarCrushEvidence({
    apiKey: "test-key",
    chain: "solana",
    tokenAddresses: [tokenAddress],
    creatorTokenAddresses: [tokenAddress],
    observedAt,
    maxRequests: 10,
  }, {
    clock: () => observedAt,
    fetcher: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/coins/list/v1")) {
        return jsonResponse({
          config: { generated: generatedAt, total_rows: 2 },
          data: [
            socialDiscoveryCoin(),
            socialDiscoveryCoin({
              id: 202,
              symbol: "BROAD",
              name: "Broad Coin",
              topic: "broad coin",
              blockchains: [{ network: "solana", address: broadDiscoveryAddress, decimals: 6 }],
              alt_rank: 1,
              alt_rank_previous: 2_000,
            }),
          ],
        });
      }
      if (String(url).includes("/topic/")) {
        assert.match(String(url), /\/topic\/exact%20coin\/creators\/v1/);
        return jsonResponse({
          config: { generated: generatedAt },
          data: [
            { interactions_24h: 800, creator_followers: 5_000, creator_rank: 20, network: "twitter" },
            { interactions_24h: 200, creator_followers: 1_000, creator_rank: 80, network: "twitter" },
          ],
        });
      }
      return jsonResponse({ config: { generated: generatedAt }, data: socialRows() });
    },
  });
  assert.equal(result.creatorEvents.length, 1);
  assert.equal(result.creatorEvents[0].tokenAddress, tokenAddress);
  assert.equal(result.creatorEvents[0].status, "ready");
  assert.equal(result.creatorEvents[0].creatorMetrics.creatorCount, 2);
  assert.equal(result.creatorEvents[0].creatorMetrics.interactions24h, 1_000);
  assert.equal(result.creatorEvents[0].aggregateOnly, true);
  assert.equal(result.creatorEvents[0].rawCreatorIdentitiesRetained, false);
  assert.equal(calls.filter((url) => url.includes("/topic/")).length, 1);
  assert.ok(calls.every((url) => !url.includes("/topic/broad%20coin/")));
}

{
  const result = await collectExactMintLunarCrushEvidence({
    apiKey: "test-key",
    chain: "solana",
    tokenAddresses: [tokenAddress],
    observedAt,
    maxRequests: 10,
  }, {
    clock: () => observedAt,
    fetcher: async (url) => {
      assert.match(String(url), /\/coins\/list\/v1/);
      return jsonResponse({
        config: { generated: generatedAt, total_rows: 2 },
        data: [coinRecord(101, tokenAddress), coinRecord(202, tokenAddress)],
      });
    },
  });
  assert.equal(result.requestBudget.attempted, 1);
  assert.equal(result.events[0].status, "blocked");
  assert.deepEqual(result.events[0].blockers, ["contract address maps to multiple LunarCrush coins"]);
}

{
  const result = await collectExactMintLunarCrushEvidence({
    apiKey: "test-key",
    chain: "solana",
    tokenAddresses: [tokenAddress],
    observedAt,
    maxRequests: 10,
  }, {
    clock: () => observedAt,
    fetcher: async () => jsonResponse({
      config: { generated: generatedAt, total_rows: 1 },
      data: [coinRecord(303, tokenAddress.toLowerCase())],
    }),
  });
  assert.equal(result.events[0].status, "blocked");
  assert.equal(result.events[0].identity.matchStatus, "untracked-contract");
}

{
  const result = await collectExactMintLunarCrushTopicEvidence({
    apiKey: "test-key",
    chain: "solana",
    tokenAddresses: [tokenAddress, unmatchedAddress],
    observedAt,
    maxRequests: 2,
  }, {
    clock: () => observedAt,
    fetcher: async (url, init) => {
      assert.equal(init.headers.Authorization, "Bearer test-key");
      const address = decodeURIComponent(String(url).split("/topic/")[1].split("/v1")[0]);
      return jsonResponse({
        data: address === tokenAddress ? {
          topic: tokenAddress.toLowerCase(),
          title: tokenAddress,
          interactions_24h: 9_284,
          num_contributors: 11,
          num_posts: 13,
          trend: "flat",
          types_count: { tweet: 13 },
          types_interactions: { tweet: 9_284 },
          types_sentiment: { tweet: 100 },
          related_topics: [{ topic: "must-not-be-retained" }],
        } : {
          topic: unmatchedAddress.toLowerCase(),
          title: unmatchedAddress.toLowerCase(),
          interactions_24h: null,
          num_contributors: null,
          num_posts: null,
          trend: null,
        },
      });
    },
  });
  assert.equal(result.requestBudget.attempted, 2);
  assert.equal(result.requestBudget.succeeded, 2);
  const ready = result.events.find((event) => event.tokenAddress === tokenAddress);
  assert.equal(ready.status, "ready");
  assert.equal(ready.ruleVersion, LUNARCRUSH_EXACT_CONTRACT_TOPIC_RULE.version);
  assert.equal(ready.identity.matchStatus, "exact-contract-topic-and-title");
  assert.equal(ready.topicMetrics.interactions24h, 9_284);
  assert.equal(ready.topicMetrics.contributorCount, 11);
  assert.equal(ready.topicMetrics.postCount, 13);
  assert.equal(ready.topicMetrics.interactionsPerPost, 714.153846);
  assert.equal(ready.topicMetrics.typeSentiment.tweet, 100);
  assert.equal(ready.rawPostsRetained, false);
  assert.equal(ready.rawCreatorIdentitiesRetained, false);
  assert.equal(JSON.stringify(ready).includes("must-not-be-retained"), false);
  const blocked = result.events.find((event) => event.tokenAddress === unmatchedAddress);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.topicMetrics, null);
  assert.ok(blocked.blockers.includes("topic title does not preserve the exact contract"));
}

{
  const calls = [];
  const result = await collectExactMintLunarCrushTopicStructureEvidence({
    apiKey: "test-key",
    chain: "solana",
    tokenAddresses: [tokenAddress],
    observedAt,
    maxRequests: 2,
  }, {
    clock: () => observedAt,
    fetcher: async (url, init) => {
      calls.push(String(url));
      assert.equal(init.headers.Authorization, "Bearer test-key");
      if (String(url).includes("/creators/")) {
        return jsonResponse({
          data: [
            {
              creator_id: "private-creator-one",
              creator_name: "must-not-be-retained",
              creator_avatar: "https://private.invalid/one.png",
              creator_followers: 5_000,
              creator_rank: 20,
              interactions_24h: 600,
            },
            {
              creator_id: "private-creator-two",
              creator_name: "also-must-not-be-retained",
              creator_followers: 1_000,
              creator_rank: 80,
              interactions_24h: 400,
            },
          ],
        });
      }
      return jsonResponse({
        config: { id: tokenAddress, topic: tokenAddress.toLowerCase(), type: "topic" },
        data: [
          {
            id: "private-post-one",
            creator_id: "private-creator-one",
            creator_name: "must-not-be-retained",
            post_description: "private raw post text",
            post_link: "https://private.invalid/post-one",
            post_type: "tweet",
            post_sentiment: 4,
            interactions_24h: 600,
          },
          {
            id: "private-post-two",
            creator_id: "private-creator-two",
            post_title: "private raw title",
            post_type: "tweet",
            post_sentiment: 3,
            interactions_24h: 400,
          },
        ],
      });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.requestBudget.attempted, 2);
  assert.equal(result.requestBudget.succeeded, 2);
  const ready = result.events[0];
  assert.equal(ready.status, "ready");
  assert.equal(ready.ruleVersion, LUNARCRUSH_EXACT_CONTRACT_TOPIC_STRUCTURE_RULE.version);
  assert.equal(ready.identity.matchStatus, "exact-contract-post-config");
  assert.equal(ready.topicStructureMetrics.creator.creatorCount, 2);
  assert.equal(ready.topicStructureMetrics.creator.topCreatorInteractionShare, 0.6);
  assert.equal(ready.topicStructureMetrics.creator.creatorInteractionHhi, 0.52);
  assert.equal(ready.topicStructureMetrics.post.postCount, 2);
  assert.equal(ready.topicStructureMetrics.post.uniqueCreatorCount, 2);
  assert.equal(ready.topicStructureMetrics.post.topPostInteractionShare, 0.6);
  assert.equal(ready.topicStructureMetrics.post.postInteractionHhi, 0.52);
  assert.equal(ready.topicStructureMetrics.post.meanPostSentiment, 3.5);
  assert.equal(ready.topicStructureMetrics.post.positivePostShare, 0.5);
  assert.equal(ready.topicStructureMetrics.endpointInteractionRatio, 1);
  assert.equal(ready.rawPostsRetained, false);
  assert.equal(ready.rawPostTextRetained, false);
  assert.equal(ready.rawCreatorIdentitiesRetained, false);
  assert.equal(ready.rawCreatorIdsRetained, false);
  const serialized = JSON.stringify(ready);
  assert.equal(serialized.includes("must-not-be-retained"), false);
  assert.equal(serialized.includes("private raw post text"), false);
  assert.equal(serialized.includes("private-creator-one"), false);
}

{
  const result = await collectExactMintLunarCrushPostsEvidence({
    apiKey: "test-key",
    chain: "solana",
    tokenAddresses: [tokenAddress],
    observedAt,
    maxRequests: 1,
  }, {
    clock: () => observedAt,
    fetcher: async (url, init) => {
      assert.match(String(url), /\/posts\/v1$/);
      assert.equal(init.headers.Authorization, "Bearer test-key");
      return jsonResponse({
        config: { id: tokenAddress, topic: tokenAddress.toLowerCase(), type: "topic" },
        data: [
          {
            id: "private-post-one",
            creator_id: "private-creator-one",
            creator_name: "must-not-be-retained",
            post_description: "private raw post text",
            post_type: "tweet",
            post_sentiment: 4,
            interactions_24h: 600,
          },
          {
            id: "private-post-two",
            creator_id: "private-creator-two",
            post_type: "tweet",
            post_sentiment: 3,
            interactions_24h: 400,
          },
        ],
      });
    },
  });
  assert.equal(result.requestBudget.attempted, 1);
  assert.equal(result.requestBudget.succeeded, 1);
  const ready = result.events[0];
  assert.equal(ready.status, "ready");
  assert.equal(ready.ruleVersion, LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE.version);
  assert.equal(ready.postMetrics.postCount, 2);
  assert.equal(ready.postMetrics.uniqueCreatorCount, 2);
  assert.equal(ready.postMetrics.interactions24h, 1_000);
  assert.equal(ready.postMetrics.meanPostSentiment, 3.5);
  assert.equal(ready.rawPostsRetained, false);
  assert.equal(ready.rawCreatorIdsRetained, false);
  const serialized = JSON.stringify(ready);
  assert.equal(serialized.includes("must-not-be-retained"), false);
  assert.equal(serialized.includes("private raw post text"), false);
  assert.equal(serialized.includes("private-creator-one"), false);
}

process.stdout.write("Token-edge exact-mint LunarCrush contracts pass.\n");

function coinRecord(id, address) {
  return {
    id,
    symbol: "EXACT",
    name: "Exact Coin",
    topic: "exact coin",
    blockchains: [{ network: "solana", address, decimals: 6 }],
  };
}

function socialDiscoveryCoin(overrides = {}) {
  return {
    ...coinRecord(101, tokenAddress),
    market_cap: 50_000,
    volume_24h: 20_000,
    interactions_24h: 500,
    social_volume_24h: 10,
    alt_rank: 200,
    alt_rank_previous: 1_200,
    galaxy_score: 60,
    galaxy_score_previous: 50,
    percent_change_1h: -10,
    percent_change_24h: -20,
    ...overrides,
  };
}

function socialRows(at = observedAt) {
  const lastClosedStart = Math.floor(at.getTime() / 3_600_000) * 3_600 - 3_600;
  const rows = [];
  for (let index = 0; index < 30; index += 1) {
    rows.push({
      time: lastClosedStart - ((29 - index) * 3_600),
      interactions: 90 + (index % 5),
      posts_active: 18 + (index % 3),
      contributors_active: 12 + (index % 4),
      alt_rank: 140 - index,
      galaxy_score: 60 + (index % 4),
      sentiment: 70,
      spam: 2,
      social_dominance: 0.01,
      close: 0.001,
    });
  }
  rows.at(-1).interactions = 600;
  rows.at(-1).posts_active = 90;
  rows.at(-1).contributors_active = 60;
  rows.at(-1).alt_rank = 40;
  rows.at(-1).galaxy_score = 82;
  rows.push({
    ...rows.at(-1),
    time: lastClosedStart + 3_600,
    interactions: 99_999,
  });
  return rows;
}

function marketSnapshot(at = observedAt) {
  return {
    source: "dexscreener",
    observedAt: at.toISOString(),
    tokenAddress,
    pairAddress: "Pair111",
    pairUrl: "https://dexscreener.com/solana/pair111",
    dexId: "raydium",
    symbol: "EXACT",
    priceUsd: 0.001,
    liquidityUsd: 30_000,
    marketCapUsd: 250_000,
    fdvUsd: 250_000,
    volumeUsd: { m5: 2_000, h1: 20_000, h6: 80_000, h24: 200_000 },
    priceChangePct: { m5: 1, h1: 2, h6: 5, h24: 10 },
    txns: { m5: { buys: 10, sells: 5 }, h1: { buys: 50, sells: 20 } },
    pairCreatedAt: at.getTime() - (2 * 24 * 60 * 60_000),
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}
