#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  aggregateNansenSnapshot,
  appendLedgerEvent,
  buildEvolutionReadiness,
  buildScorecard,
  createChallengerRegistrationEvents,
  createForecastEvents,
  createSnapshotEvent,
  latestPriorSnapshot,
  marketSnapshotFromDexPair,
  missedResolutionEvent,
  readLedger,
  resolutionEvent,
  selectDeepestTokenPair,
  verifyLedger,
} from "./token-edge/onchain-forward-core.mjs";
import {
  TOKEN_EDGE_EXECUTION_POLICY,
  capacityAdjustedReturnPct,
  createExecutionPolicyRegistrationEvents,
} from "./token-edge/onchain-capacity-scorecard.mjs";
import {
  collectTokenEdgeSnapshots,
  discoverNansenTokenCandidates,
  fetchNansenAggregates,
  nansenBudgetPlan,
  recordDexCandidateConfirmation,
  registerTokenEdgeExecutionPolicy,
  registerTokenEdgeChallengers,
  recoverMissedFromPoolOhlcv,
  recoverMissedTokenEdgeForecasts,
  resolveTokenEdgeForecasts,
} from "./token-edge/onchain-forward-research.mjs";
import { LUNARCRUSH_SOLANA_DISCOVERY_RULE } from "./token-edge/onchain-lunarcrush-provider.mjs";
import {
  buildRetrospectiveReport,
  buildRetrospectiveSummary,
  classifyForecastOutcome,
  retrospectiveEvent,
} from "./token-edge/onchain-retrospective.mjs";
import { exactLiveOutcomeTimingReason } from "./token-edge/onchain-outcome-timing.mjs";
const observedAt = new Date("2026-07-29T18:00:00.000Z");
const tokenAddress = "TokenMint111111111111111111111111111111111";
const pair = dexPair({ priceUsd: "0.01", liquidityUsd: 100_000 });
for (const horizon of ["1h", "6h", "24h"]) {
  assert.equal(exactLiveOutcomeTimingReason({
    type: "resolution",
    status: "observed",
    observationMode: "live-point-in-time",
    horizon,
    dueAt: "2026-08-03T00:00:00.000Z",
    observedAt: "2026-08-03T00:06:00.000Z",
  }), "live-resolution-horizon-drift");
}
{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-undefined-integrity-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  await appendLedgerEvent(ledgerPath, {
    type: "integrity-fixture",
    id: "integrity-fixture-undefined",
    optionalField: undefined,
  });
  const events = await readLedger(ledgerPath);
  assert.equal("optionalField" in events[0], false);
  assert.equal(verifyLedger(events).ok, true);
}
{
  const registeredAt = new Date("2026-08-03T13:18:30.000Z");
  const registrations = createChallengerRegistrationEvents(registeredAt);
  assert.equal(registrations.length, 13);
  const liquidityRegistration = registrations.find((event) => (
    event.modelVersion === "frozen-onchain-rank-v4-liquidity-cap"
  ));
  const lunarcrushRegistration = registrations.find((event) => (
    event.modelVersion === "frozen-onchain-rank-v5-lunarcrush-move-gate"
  ));
  assert.equal(liquidityRegistration.type, "challenger-registration");
  assert.equal(liquidityRegistration.evidenceBoundary, "2026-08-03T00:04:55.356Z");
  assert.equal(liquidityRegistration.changedDimension, "maximumLiquidityUsd");
  assert.equal(liquidityRegistration.maximumLiquidityUsd, 50_000);
  assert.equal(lunarcrushRegistration.evidenceBoundary, "2026-08-03T02:03:12.525Z");
  assert.equal(lunarcrushRegistration.changedDimension, "exactMintLunarCrushMoveAlert");
  assert.equal(
    createChallengerRegistrationEvents(new Date("2026-08-03T13:30:00.000Z"))[0].id,
    registrations[0].id,
  );

  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-challenger-registration-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const first = await registerTokenEdgeChallengers({ ledgerPath }, { now: registeredAt });
  const second = await registerTokenEdgeChallengers({ ledgerPath }, {
    now: new Date("2026-08-03T13:30:00.000Z"),
  });
  assert.equal(first.appendedRegistrations, 13);
  assert.equal(second.appendedRegistrations, 0);
  assert.equal(second.registeredAt, registeredAt.toISOString());
  assert.ok(second.registrations.every((registration) => (
    registration.registeredAt === registeredAt.toISOString()
  )));
  const events = await readLedger(ledgerPath);
  assert.equal(events.filter((event) => event.type === "challenger-registration").length, 13);
  assert.equal(verifyLedger(events).ok, true);
  const reported = buildRetrospectiveReport(events).registeredChallengers;
  assert.equal(reported.length, 13);
  assert.ok(reported.some((event) => event.id === liquidityRegistration.id));
  assert.ok(reported.some((event) => event.id === lunarcrushRegistration.id));
}
{
  const registeredAt = new Date("2026-07-29T16:00:00.000Z");
  const registrations = createExecutionPolicyRegistrationEvents(registeredAt);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].type, "execution-policy-registration");
  assert.equal(registrations[0].policyVersion, "token-edge-capacity-v1");
  assert.equal(registrations[0].paperNotionalUsd, 100);
  assert.equal(registrations[0].baseRoundTripCostPct, 4);
  assert.equal(registrations[0].stressRoundTripCostPct, 12);
  assert.equal(registrations[0].ammImpactModel, "constant-product-symmetric-reserves-v1");
  assert.equal(
    createExecutionPolicyRegistrationEvents(new Date("2026-07-29T17:00:00.000Z"))[0].id,
    registrations[0].id,
  );

  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-execution-registration-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const first = await registerTokenEdgeExecutionPolicy({ ledgerPath }, { now: registeredAt });
  const second = await registerTokenEdgeExecutionPolicy({ ledgerPath }, {
    now: new Date("2026-07-29T17:00:00.000Z"),
  });
  assert.equal(first.appendedRegistrations, 1);
  assert.equal(second.appendedRegistrations, 0);
  assert.equal(second.registeredAt, registeredAt.toISOString());
  assert.equal(second.registrations[0].registeredAt, registeredAt.toISOString());
  const events = await readLedger(ledgerPath);
  assert.equal(events.filter((event) => event.type === "execution-policy-registration").length, 1);
  assert.equal(verifyLedger(events).ok, true);
  assert.equal(buildRetrospectiveReport(events).registeredExecutionPolicies.length, 1);
  assert.equal(buildRetrospectiveReport(events).registeredExecutionPolicies[0].id, registrations[0].id);
}
{
  const selected = selectDeepestTokenPair([
    dexPair({ pairAddress: "thin", liquidityUsd: 10_000 }),
    dexPair({ pairAddress: "quote-only", liquidityUsd: 1_000_000, baseAddress: "OtherToken" }),
    dexPair({ pairAddress: "deep", liquidityUsd: 100_000 }),
  ], tokenAddress);
  assert.equal(selected.pairAddress, "deep");
}
{
  const discovery = await discoverNansenTokenCandidates({
    maxCredits: 1,
    apiKey: "fixture-key",
    chain: "solana",
    timeframe: "1h",
  }, async (url, init) => {
    assert.ok(String(url).endsWith("/api/v1/token-screener"));
    const body = JSON.parse(init.body);
    assert.deepEqual(body.filters, { only_smart_money: true, token_age_days: { max: 30 } });
    assert.deepEqual(body.order_by, [{ field: "netflow", direction: "DESC" }]);
    return jsonResponse({ data: [
      {
        chain: "solana",
        token_address: tokenAddress,
        token_symbol: "EDGE",
        token_age_days: 2,
        market_cap_usd: 1_000_000,
        liquidity: 100_000,
        price_usd: 0.01,
        price_change: 5,
        buy_volume: 20_000,
        sell_volume: 10_000,
        volume: 30_000,
        netflow: 8_000,
        fdv: 1_000_000,
      },
      {
        chain: "solana",
        token_address: "AlreadyExploded",
        token_symbol: "LATE",
        token_age_days: 1,
        market_cap_usd: 1_000_000,
        liquidity: 100_000,
        price_change: 80,
        buy_volume: 20_000,
        sell_volume: 10_000,
        netflow: 8_000,
      },
    ] });
  });
  assert.equal(discovery.attemptedCredits, 1);
  assert.equal(discovery.candidates[0].status, "eligible");
  assert.equal(discovery.candidates[0].buySellVolumeRatio, 2);
  assert.equal(discovery.candidates[0].netflowToLiquidity, 0.08);
  assert.equal(discovery.candidates[1].status, "blocked");
  assert.match(discovery.candidates[1].blockers.join(" "), /already rose/);
  await assert.rejects(
    discoverNansenTokenCandidates({ maxCredits: 0, apiKey: "fixture-key" }),
    /requires --max-nansen-credits 1/,
  );
}

{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-confirm-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const lateToken = "AlreadyLate11111111111111111111111111111111";
  const confirmation = await recordDexCandidateConfirmation({
    ledgerPath,
    chain: "solana",
    tokenAddresses: [tokenAddress, lateToken],
    sourceEventId: "discovery-fixture",
  }, {
    now: observedAt,
    fetcher: async (url) => {
      const address = decodeURIComponent(String(url).split("/").at(-1));
      const responsePair = dexPair({ baseAddress: address });
      if (address === lateToken) responsePair.priceChange.h1 = 30;
      return jsonResponse([responsePair]);
    },
  });
  assert.equal(confirmation.sourceEventId, "discovery-fixture");
  assert.equal(confirmation.eligible.length, 1);
  assert.equal(confirmation.blockedCount, 1);
  assert.match(confirmation.eligible[0].market.pairUrl, /^https:\/\//);
  const events = await readLedger(ledgerPath);
  assert.equal(events[0].type, "market-confirmation");
  assert.equal(events[0].attemptedNansenCredits, 0);
  assert.equal(verifyLedger(events).ok, true);
}

{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-age-unbounded-live-path-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const oldToken = "OldSocialPair111111111111111111111111111111";
  const registeredAt = new Date("2026-08-03T19:08:00.000Z");
  await registerTokenEdgeChallengers({ ledgerPath }, { now: registeredAt });
  const discovery = {
    type: "discovery",
    id: "age-unbounded-discovery",
    observedAt: "2026-08-03T19:09:00.000Z",
    collectionStartedAt: "2026-08-03T19:08:58.000Z",
    availableAt: "2026-08-03T19:09:00.000Z",
    provider: "lunarcrush-coin-list",
    sourceProvider: "lunarcrush",
    chain: "solana",
    timeframe: "1h",
    ruleVersion: LUNARCRUSH_SOLANA_DISCOVERY_RULE.version,
    rule: LUNARCRUSH_SOLANA_DISCOVERY_RULE,
    universe: { complete: true, pagesFetched: 6, rowsFetched: 5_467, reportedRows: 5_467 },
    candidates: [{
      chain: "solana",
      tokenAddress: oldToken,
      symbol: "OLD",
      status: "eligible",
      lunarcrushCoinId: 123,
      marketCapUsd: 500_000,
      volume24hUsd: 100_000,
      interactions24h: 5_000,
      socialVolume24h: 50,
      altRank: 100,
      altRankPrevious: 1_200,
      altRankImprovement: 1_100,
      galaxyScore: 70,
      galaxyScorePrevious: 50,
      galaxyScoreImprovement: 20,
      priceChange1hPct: 1,
      priceChange24hPct: 5,
      ruleVersion: LUNARCRUSH_SOLANA_DISCOVERY_RULE.version,
    }],
    researchOnly: true,
    mutationAllowed: false,
  };
  await appendLedgerEvent(ledgerPath, discovery);
  const oldPairFetcher = async () => {
    const responsePair = dexPair({ baseAddress: oldToken, pairAddress: "OldSocialPairPool" });
    responsePair.pairCreatedAt = Date.parse("2026-08-03T19:10:00.000Z")
      - 45 * 24 * 60 * 60_000;
    return jsonResponse([responsePair]);
  };
  const confirmation = await recordDexCandidateConfirmation({
    ledgerPath,
    chain: "solana",
    tokenAddresses: [oldToken],
    sourceEventId: discovery.id,
  }, {
    now: new Date("2026-08-03T19:10:00.000Z"),
    fetcher: oldPairFetcher,
  });
  assert.equal(confirmation.eligible.length, 0);
  assert.equal(confirmation.ageUnboundedEligible.length, 1);
  assert.equal(confirmation.ageUnboundedEligible[0].ageUnboundedBlockers.length, 0);
  const collected = await collectTokenEdgeSnapshots({
    ledgerPath,
    chain: "solana",
    tokenAddresses: [oldToken],
    selectionConfirmationEventId: confirmation.confirmationId,
    nansenProfile: "off",
    lunarcrushProfile: "off",
  }, {
    clock: () => new Date("2026-08-03T19:11:00.000Z"),
    fetcher: oldPairFetcher,
  });
  assert.equal(collected.results[0].status, "recorded");
  const ageForecast = (await readLedger(ledgerPath)).find((event) => (
    event.type === "forecast"
    && event.modelVersion === "frozen-onchain-rank-v16-lunarcrush-age-unbounded"
  ));
  assert.equal(ageForecast.status, "ready");
  assert.equal(ageForecast.predictedRise, true);
  assert.equal(ageForecast.inputEvidence.entryProviderPriceIntegrity.priceRatio, 1);
}

{
  const market = marketSnapshotFromDexPair(pair, tokenAddress, observedAt);
  assert.equal(market.priceUsd, 0.01);
  assert.equal(market.liquidityUsd, 100_000);
  assert.equal(market.txns.h1.buys, 90);
  assert.equal(market.txns.h1.sells, 30);
  assert.equal(market.priceChangePct.h1, 5);
}

const nansenAggregates = aggregateNansenSnapshot({
  tokenInformation: {
    data: {
      token_address: tokenAddress,
      spot_metrics: {
        total_holders: 1_100,
        unique_buyers: 660,
        unique_sellers: 480,
        buy_volume_usd: 24_000,
        sell_volume_usd: 12_000,
        total_buys: 900,
        total_sells: 450,
      },
    },
  },
  flowIntelligence: {
    data: {
      top_pnl_net_flow_usd: 4_000,
      top_pnl_wallet_count: 7,
      whale_net_flow_usd: 2_000,
      whale_wallet_count: 3,
      smart_trader_net_flow_usd: 8_000,
      smart_trader_wallet_count: 12,
      fresh_wallets_net_flow_usd: 12_000,
      fresh_wallets_wallet_count: 30,
      exchange_net_flow_usd: -1_500,
      exchange_wallet_count: 2,
      public_figure_net_flow_usd: 500,
      public_figure_wallet_count: 1,
    },
  },
  holders: {
    data: [
      {
        address: "do-not-persist-a",
        ownership_percentage: 12,
        token_amount_change_24h: 100,
        total_inflow: 2_000,
        total_outflow: 500,
      },
      {
        address: "do-not-persist-b",
        ownership_percentage: 8,
        token_amount_change_24h: -25,
        total_inflow: 500,
        total_outflow: 750,
      },
      {
        address: "do-not-persist-c",
        ownership_percentage: 5,
        token_amount_change_24h: 50,
        total_inflow: 1_000,
        total_outflow: 100,
      },
    ],
  },
  whoBought: {
    data: [
      { address: "buyer-a", bought_volume_usd: 8_000 },
      { address: "buyer-b", bought_volume_usd: 4_000 },
    ],
  },
  whoSold: {
    data: [
      { address: "seller-a", sold_volume_usd: 1_000 },
      { address: "seller-b", sold_volume_usd: 2_000 },
    ],
  },
  pnlLeaderboard: {
    data: [
      {
        address: "winner-a",
        pnl_usd_realised: 10_000,
        pnl_usd_unrealised: 5_000,
        holding_usd: 15_000,
        still_holding_balance_ratio: 0.5,
        netflow_amount_usd: 3_000,
        nof_trades: 5,
      },
      {
        address: "winner-b",
        pnl_usd_realised: 2_000,
        pnl_usd_unrealised: 1_000,
        holding_usd: 3_000,
        still_holding_balance_ratio: 0.25,
        netflow_amount_usd: -500,
        nof_trades: 3,
      },
    ],
  },
});

{
  assert.equal(nansenAggregates.holderCount, 1_100);
  assert.equal(nansenAggregates.uniqueBuyerCount, 660);
  assert.equal(nansenAggregates.uniqueSellerCount, 480);
  assert.equal(nansenAggregates.buySellUsdRatio, 2);
  assert.equal(nansenAggregates.buyTransactionCount, 900);
  assert.equal(nansenAggregates.top10OwnershipPct, 25);
  assert.equal(nansenAggregates.accumulatingHolderShare, 0.666667);
  assert.equal(nansenAggregates.sampledHolderNetTokenAmount, 2_150);
  assert.equal(nansenAggregates.sampledHolderNetflowUsd, null);
  assert.equal(nansenAggregates.sampledBuySellUsdRatio, 4);
  assert.equal(nansenAggregates.topSampledBuyerVolumeShare, 0.666667);
  assert.equal(nansenAggregates.sampledBuyerVolumeHhi, 0.555556);
  assert.equal(nansenAggregates.topSampledSellerVolumeShare, 0.666667);
  assert.equal(nansenAggregates.sampledSellerVolumeHhi, 0.555556);
  assert.equal(nansenAggregates.flowSegments.freshWallet.netflowUsd, 12_000);
  assert.equal(nansenAggregates.flowSegments.smartTrader.walletCount, 12);
  assert.equal(nansenAggregates.flowSegments.exchange.netflowUsd, -1_500);
  assert.equal(nansenAggregates.flowSegments.publicFigure.walletCount, 1);
  assert.equal(nansenAggregates.positiveSelectiveNetflowShare, 0.5);
  assert.equal(nansenAggregates.medianTopPnlTradeCount, 4);
  assert.equal(nansenAggregates.meanTopPnlTradeCount, 4);
  assert.equal(nansenAggregates.sampledProfitOverhangUsd, 2_750);
  const serialized = JSON.stringify(nansenAggregates);
  assert.ok(!serialized.includes("do-not-persist"));
  assert.ok(!serialized.includes("winner-a"));
  assert.ok(!serialized.includes("buyer-a"));
  assert.ok(!serialized.includes('"address"'));
}

const market = marketSnapshotFromDexPair(pair, tokenAddress, observedAt);
const currentSnapshot = createSnapshotEvent({
  observedAt,
  chain: "solana",
  tokenAddress,
  cohort: "test",
  market,
  nansen: {
    status: "ok",
    profile: "full",
    attemptedCredits: 14,
    aggregates: nansenAggregates,
    sourceAttribution: "Powered by Nansen API",
    errors: [],
  },
});

const priorSnapshot = createSnapshotEvent({
  observedAt: new Date(observedAt.getTime() - 60 * 60_000),
  chain: "solana",
  tokenAddress,
  cohort: "test",
  market: {
    ...market,
    observedAt: new Date(observedAt.getTime() - 60 * 60_000).toISOString(),
  },
  nansen: {
    status: "ok",
    profile: "full",
    attemptedCredits: 14,
    aggregates: {
      ...nansenAggregates,
      holderCount: 1_000,
      uniqueBuyerCount: 550,
      top10OwnershipPct: 26,
    },
    sourceAttribution: "Powered by Nansen API",
    errors: [],
  },
});

{
  const marketOnlyIntermediate = createSnapshotEvent({
    observedAt: new Date(observedAt.getTime() - 30 * 60_000),
    chain: "solana",
    tokenAddress,
    cohort: "market-only-intermediate",
    market: {
      ...market,
      observedAt: new Date(observedAt.getTime() - 30 * 60_000).toISOString(),
    },
  });
  assert.equal(
    latestPriorSnapshot([priorSnapshot, marketOnlyIntermediate], currentSnapshot).id,
    priorSnapshot.id,
  );
  assert.equal(
    latestPriorSnapshot([priorSnapshot, marketOnlyIntermediate], marketOnlyIntermediate).id,
    priorSnapshot.id,
  );
}

{
  const firstForecasts = createForecastEvents(currentSnapshot, null);
  assert.equal(firstForecasts.length, 28);
  assert.ok(firstForecasts
    .filter((forecast) => forecast.candidateId !== "market-only-control")
    .every((forecast) => forecast.status === "blocked"));
  assert.ok(firstForecasts
    .filter((forecast) => forecast.candidateId === "market-only-control")
    .every((forecast) => forecast.status === "ready"));
  assert.ok(firstForecasts
    .filter((forecast) => forecast.candidateId === "market-only-control")
    .every((forecast) => forecast.inputEvidence.pairAgeHours === 2));

  const forecasts = createForecastEvents(currentSnapshot, priorSnapshot);
  assert.equal(forecasts.length, 28);
  assert.ok(forecasts
    .filter((forecast) => forecast.candidateId === "smart-money-selection")
    .every((forecast) => forecast.status === "blocked"));
  assert.ok(forecasts
    .filter((forecast) => (
      forecast.candidateId !== "smart-money-selection"
      && forecast.candidateId !== "smart-money-liquidity-cap"
      && forecast.candidateId !== "smart-money-exact-mint-social-move-gate"
      && forecast.candidateId !== "smart-money-pair-age-window"
      && forecast.candidateId !== "lunarcrush-social-discovery-rise"
      && forecast.candidateId !== "lunarcrush-social-discovery-creator-quality"
      && forecast.candidateId !== "lunarcrush-social-discovery-age-unbounded"
      && forecast.candidateId !== "smart-money-hourly-turnover-gate"
      && forecast.candidateId !== "smart-money-positive-momentum-gate"
      && forecast.candidateId !== "smart-money-social-magnitude-gate"
      && forecast.candidateId !== "dex-early-surface-rise"
    ))
    .every((forecast) => forecast.status === "ready"));
  const combined1h = forecasts.find((forecast) => (
    forecast.candidateId === "combined-onchain" && forecast.horizon === "1h"
  ));
  assert.equal(typeof combined1h.predictedRise, "boolean");
  assert.equal(typeof combined1h.predictedReturnPct, "number");
  assert.equal(combined1h.modelVersion, "frozen-onchain-rank-v3");
  assert.equal(combined1h.predictedRise, combined1h.predictedReturnPct > 0);
  assert.equal(combined1h.predictedRise, combined1h.predictedRiseProbability > 0.5);
  const authentic1h = forecasts.find((forecast) => (
    forecast.candidateId === "authentic-buyer-growth" && forecast.horizon === "1h"
  ));
  const supply1h = forecasts.find((forecast) => (
    forecast.candidateId === "supply-profit-overhang" && forecast.horizon === "1h"
  ));
  assert.equal(authentic1h.inputEvidence.sampledBuyerVolumeHhi, 0.555556);
  assert.equal(authentic1h.inputEvidence.topSampledBuyerVolumeShare, 0.666667);
  assert.equal(supply1h.inputEvidence.medianTopPnlTradeCount, 4);
  assert.equal(supply1h.inputEvidence.meanTopPnlTradeCount, 4);
}

{
  const registration = createExecutionPolicyRegistrationEvents(
    new Date(observedAt.getTime() - 60 * 60_000),
  )[0];
  const linkedForecasts = createForecastEvents(currentSnapshot, priorSnapshot, [], [registration]);
  const linkedForecast = linkedForecasts.find((forecast) => (
    forecast.status === "ready" && forecast.horizon === "1h" && forecast.predictedRise
  ));
  assert.ok(linkedForecast);
  assert.equal(linkedForecast.executionPolicyRegistrationId, registration.id);
  assert.equal(linkedForecast.executionPolicyRegisteredAt, registration.registeredAt);
  assert.equal(linkedForecast.executionPolicyVersion, TOKEN_EDGE_EXECUTION_POLICY.policyVersion);

  const lateRegistration = createExecutionPolicyRegistrationEvents(
    new Date(observedAt.getTime() + 60_000),
  )[0];
  assert.ok(createForecastEvents(currentSnapshot, priorSnapshot, [], [lateRegistration]).every(
    (forecast) => forecast.executionPolicyRegistrationId == null,
  ));

  const exitMarket = {
    ...market,
    observedAt: linkedForecast.dueAt,
    pairAddress: "ExitPair111",
    liquidityUsd: 80_000,
  };
  const outcome = resolutionEvent(
    linkedForecast,
    currentSnapshot,
    currentSnapshot.market.priceUsd * 1.2,
    new Date(linkedForecast.dueAt),
    exitMarket,
  );
  assert.deepEqual(outcome.executionEvidence, {
    entryMarketObservedAt: currentSnapshot.market.observedAt,
    entryPairAddress: currentSnapshot.market.pairAddress,
    entryLiquidityUsd: 100_000,
    exitMarketObservedAt: linkedForecast.dueAt,
    exitPairAddress: "ExitPair111",
    exitLiquidityUsd: 80_000,
  });
  assert.equal(capacityAdjustedReturnPct({
    grossReturnPct: 20,
    entryLiquidityUsd: 100_000,
    exitLiquidityUsd: 80_000,
    paperNotionalUsd: 100,
    roundTripCostPct: 4,
  }), 15.402985);

  const capacityAudit = buildScorecard([
    registration,
    currentSnapshot,
    linkedForecast,
    outcome,
  ]).capacityAudit;
  assert.equal(capacityAudit.policyStatus, "registered");
  assert.equal(capacityAudit.policyRegistrationId, registration.id);
  assert.equal(capacityAudit.eligibleLiveOutcomes, 1);
  assert.equal(capacityAudit.ineligibleLiveOutcomes, 0);
  assert.equal(capacityAudit.historicalRecoveryOutcomes, 0);
  const row = capacityAudit.rows.find((candidate) => (
    candidate.modelVersion === linkedForecast.modelVersion
    && candidate.candidateId === linkedForecast.candidateId
    && candidate.horizon === linkedForecast.horizon
  ));
  assert.equal(row.capacityEligibleLiveOutcomes, 1);
  assert.equal(row.portfolioAverageNetReturnPct, 15.402985);
  assert.equal(row.stressedPortfolioAverageNetReturnPct, 7.402985);
  assert.equal(row.paperCapitalAssignedUsd, 100);
  assert.equal(row.paperNotionalTradedUsd, 100);
  assert.equal(row.paperPnlAcrossEligibleSignalsUsd, 15.402985);
  assert.equal(row.evidenceStatus, "collecting");
  assert.equal(row.provisionalCapacityGate, false);
  const lateObservedAt = new Date(Date.parse(linkedForecast.dueAt) + 6 * 60_000).toISOString();
  const lateOutcomeScorecard = buildScorecard([
    registration,
    currentSnapshot,
    linkedForecast,
    resolutionEvent(
      linkedForecast,
      currentSnapshot,
      currentSnapshot.market.priceUsd * 1.2,
      new Date(lateObservedAt),
      { ...exitMarket, observedAt: lateObservedAt },
    ),
  ]);
  assert.equal(lateOutcomeScorecard.horizonDriftedLiveOutcomes, 1);
  assert.equal(lateOutcomeScorecard.capacityAudit.eligibleLiveOutcomes, 0);
  assert.equal(
    lateOutcomeScorecard.capacityAudit.ineligibilityCounts["live-resolution-horizon-drift"],
    1,
  );
  assert.equal(buildScorecard([
    registration,
    currentSnapshot,
    linkedForecast,
    outcome,
  ]).promotionPolicy.executionCapacityGate.required, true);

  const prePolicyForecast = createForecastEvents(currentSnapshot, priorSnapshot).find((forecast) => (
    forecast.id === linkedForecast.id
  ));
  const prePolicyOutcome = resolutionEvent(
    prePolicyForecast,
    currentSnapshot,
    currentSnapshot.market.priceUsd * 1.2,
    new Date(prePolicyForecast.dueAt),
    exitMarket,
  );
  const prePolicyAudit = buildScorecard([
    registration,
    currentSnapshot,
    prePolicyForecast,
    prePolicyOutcome,
  ]).capacityAudit;
  assert.equal(prePolicyAudit.eligibleLiveOutcomes, 0);
  assert.equal(prePolicyAudit.ineligibilityCounts["missing-execution-policy-link"], 1);

  const missingExitEvidenceAudit = buildScorecard([
    registration,
    currentSnapshot,
    linkedForecast,
    resolutionEvent(
      linkedForecast,
      currentSnapshot,
      currentSnapshot.market.priceUsd * 1.2,
      new Date(linkedForecast.dueAt),
      { ...exitMarket, liquidityUsd: null },
    ),
  ]).capacityAudit;
  assert.equal(missingExitEvidenceAudit.eligibleLiveOutcomes, 0);
  assert.equal(missingExitEvidenceAudit.ineligibilityCounts["missing-exit-liquidity"], 1);

  const recoveryOnlyAudit = buildScorecard([
    registration,
    currentSnapshot,
    linkedForecast,
    { ...outcome, type: "resolution-recovery", observationMode: "historical-ohlcv-recovery" },
  ]).capacityAudit;
  assert.equal(recoveryOnlyAudit.eligibleLiveOutcomes, 0);
  assert.equal(recoveryOnlyAudit.historicalRecoveryOutcomes, 1);

  const invalidRegistrationAudit = buildScorecard([
    { ...registration, paperNotionalUsd: 1_000 },
    currentSnapshot,
    linkedForecast,
    outcome,
  ]).capacityAudit;
  assert.equal(invalidRegistrationAudit.policyStatus, "unregistered");
  assert.equal(invalidRegistrationAudit.eligibleLiveOutcomes, 0);
  assert.equal(invalidRegistrationAudit.ineligibilityCounts["invalid-execution-policy-registration"], 1);

  const invalidTimestampAudit = buildScorecard([
    { ...registration, registeredAt: "not-a-time" },
    currentSnapshot,
    linkedForecast,
    outcome,
  ]).capacityAudit;
  assert.equal(invalidTimestampAudit.policyStatus, "unregistered");
  assert.equal(invalidTimestampAudit.ineligibilityCounts["invalid-execution-policy-registration"], 1);

  const exitTimeMismatchAudit = buildScorecard([
    registration,
    currentSnapshot,
    linkedForecast,
    {
      ...outcome,
      executionEvidence: {
        ...outcome.executionEvidence,
        exitMarketObservedAt: new Date(Date.parse(outcome.observedAt) - 1).toISOString(),
      },
    },
  ]).capacityAudit;
  assert.equal(exitTimeMismatchAudit.eligibleLiveOutcomes, 0);
  assert.equal(exitTimeMismatchAudit.ineligibilityCounts["exit-market-time-mismatch"], 1);
}

{
  const selectedSnapshot = createSnapshotEvent({
    observedAt,
    chain: "solana",
    tokenAddress,
    cohort: "selected-test",
    market,
    selection: {
      status: "verified",
      provider: "nansen-token-screener",
      timeframe: "1h",
      discoveryEventId: "discovery-test",
      confirmationEventId: "confirmation-test",
      metrics: {
        netflowUsd: 8_000,
        netflowToLiquidity: 0.08,
        buySellVolumeRatio: 2,
        priceChangePct: 5,
        confirmedLiquidityUsd: 100_000,
      },
    },
  });
  const selectionForecast = createForecastEvents(selectedSnapshot, priorSnapshot).find((forecast) => (
    forecast.candidateId === "smart-money-selection" && forecast.horizon === "1h"
  ));
  assert.equal(selectionForecast.status, "ready");
  assert.equal(selectionForecast.predictedRise, true);
  assert.equal(selectionForecast.predictedRiseProbability, 0.6);
  assert.equal(selectionForecast.predictedReturnPct, 6.4);
  assert.equal(selectionForecast.selectionTimeframe, "1h");
  const selectedResolution = resolutionEvent(
    selectionForecast,
    selectedSnapshot,
    selectedSnapshot.market.priceUsd * 1.1,
    new Date(selectionForecast.dueAt),
  );
  const selectionRow = buildScorecard([
    selectedSnapshot,
    selectionForecast,
    selectedResolution,
  ]).selectionRows[0];
  assert.equal(selectionRow.selectionProvider, "nansen-token-screener");
  assert.equal(selectionRow.selectionTimeframe, "1h");
  assert.equal(selectionRow.predictedRiseForecasts, 1);
  assert.equal(selectionRow.independentTradedFrames, 1);
  assert.equal(selectionRow.portfolioAverageNetReturnPct, 6);
  assert.deepEqual(selectionRow.portfolioBootstrapMeanNetReturnCi95Pct, [null, null]);
  assert.equal(selectionRow.portfolioProfitFactor, 999);
  assert.equal(selectionRow.portfolioMaxDrawdownPct, 0);
  assert.equal(selectionRow.largestWinningFrameShare, 1);
  assert.equal(selectionRow.stressedPortfolioAverageNetReturnPct, -2);

  const challengerObservedAt = new Date("2026-08-03T01:00:00.000Z");
  const challengerSelection = {
    status: "verified",
    provider: "nansen-token-screener",
    timeframe: "6h",
    discoveryEventId: "discovery-challenger",
    confirmationEventId: "confirmation-challenger",
    discoveryObservedAt: "2026-08-03T00:30:00.000Z",
    confirmationObservedAt: "2026-08-03T00:45:00.000Z",
    metrics: {
      netflowUsd: 2_000,
      netflowToLiquidity: 0.05,
      buySellVolumeRatio: 1.5,
      priceChangePct: 0,
      confirmedLiquidityUsd: 40_000,
    },
  };
  const lowLiquiditySnapshot = createSnapshotEvent({
    observedAt: challengerObservedAt,
    chain: "solana",
    tokenAddress: "LowLiquidityToken111111111111111111111111111",
    cohort: "challenger-test",
    market: {
      ...market,
      observedAt: challengerObservedAt.toISOString(),
      liquidityUsd: 40_000,
    },
    selection: challengerSelection,
  });
  const highLiquiditySnapshot = createSnapshotEvent({
    observedAt: challengerObservedAt,
    chain: "solana",
    tokenAddress: "HighLiquidityToken11111111111111111111111111",
    cohort: "challenger-test",
    market: {
      ...market,
      observedAt: challengerObservedAt.toISOString(),
      liquidityUsd: 100_000,
    },
    selection: {
      ...challengerSelection,
      confirmationEventId: "confirmation-challenger-high",
      metrics: {
        ...challengerSelection.metrics,
        confirmedLiquidityUsd: 100_000,
      },
    },
  });
  const earlyRegistration = createChallengerRegistrationEvents(
    new Date("2026-08-03T00:20:00.000Z"),
  )[0];
  const lowForecasts = createForecastEvents(lowLiquiditySnapshot, null, [earlyRegistration]);
  const highForecasts = createForecastEvents(highLiquiditySnapshot, null, [earlyRegistration]);
  const lowChallenger = lowForecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v4-liquidity-cap"
    && forecast.candidateId === "smart-money-liquidity-cap"
  ));
  const highChallenger = highForecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v4-liquidity-cap"
    && forecast.candidateId === "smart-money-liquidity-cap"
  ));
  assert.equal(lowChallenger.horizon, "1h");
  assert.equal(lowChallenger.status, "ready");
  assert.equal(lowChallenger.predictedRise, true);
  assert.equal(lowChallenger.decision, "paper-long");
  assert.equal(lowChallenger.changedDimension, "maximumLiquidityUsd");
  assert.equal(lowChallenger.maximumLiquidityUsd, 50_000);
  assert.equal(lowChallenger.evidenceBoundary, "2026-08-03T00:04:55.356Z");
  assert.equal(lowChallenger.challengerRegistrationId, earlyRegistration.id);
  assert.equal(lowChallenger.challengerRegisteredAt, earlyRegistration.registeredAt);
  assert.equal(highChallenger.status, "ready");
  assert.equal(highChallenger.predictedRise, false);
  assert.equal(highChallenger.decision, "paper-cash");
  const leakedLineageSnapshot = createSnapshotEvent({
    observedAt: challengerObservedAt,
    chain: "solana",
    tokenAddress: "LeakedLineageToken1111111111111111111111111",
    cohort: "challenger-test",
    market: {
      ...market,
      observedAt: challengerObservedAt.toISOString(),
      liquidityUsd: 40_000,
    },
    selection: {
      ...challengerSelection,
      discoveryEventId: "discovery-before-boundary",
      confirmationEventId: "confirmation-before-boundary",
      discoveryObservedAt: "2026-08-03T00:02:00.000Z",
      confirmationObservedAt: "2026-08-03T00:03:00.000Z",
    },
  });
  const leakedLineageChallenger = createForecastEvents(
    leakedLineageSnapshot,
    null,
    [earlyRegistration],
  ).find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v4-liquidity-cap"
  ));
  assert.equal(leakedLineageChallenger.status, "blocked");
  assert.ok(leakedLineageChallenger.blockers.includes(
    "selection lineage is not strictly after the challenger evidence boundary",
  ));

  const missingRegistrationChallenger = createForecastEvents(lowLiquiditySnapshot, null).find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v4-liquidity-cap"
  ));
  assert.equal(missingRegistrationChallenger.status, "blocked");
  assert.ok(missingRegistrationChallenger.blockers.includes("challenger registration is missing"));

  const lateRegistration = createChallengerRegistrationEvents(
    new Date("2026-08-03T00:35:00.000Z"),
  )[0];
  const preRegistrationLineageChallenger = createForecastEvents(
    lowLiquiditySnapshot,
    null,
    [lateRegistration],
  ).find((forecast) => forecast.modelVersion === "frozen-onchain-rank-v4-liquidity-cap");
  assert.equal(preRegistrationLineageChallenger.status, "blocked");
  assert.ok(preRegistrationLineageChallenger.blockers.includes(
    "selection lineage is not strictly after the challenger registration",
  ));

  const lowBaseline = lowForecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v3"
    && forecast.candidateId === "smart-money-selection"
    && forecast.horizon === "1h"
  ));
  const highBaseline = highForecasts.find((forecast) => (
    forecast.modelVersion === "frozen-onchain-rank-v3"
    && forecast.candidateId === "smart-money-selection"
    && forecast.horizon === "1h"
  ));
  const challengerDiscovery = {
    type: "discovery",
    id: "discovery-challenger",
    observedAt: challengerSelection.discoveryObservedAt,
    provider: "nansen-token-screener",
    timeframe: "6h",
    candidates: [lowLiquiditySnapshot, highLiquiditySnapshot].map((snapshot) => ({
      chain: snapshot.chain,
      tokenAddress: snapshot.tokenAddress,
      status: "eligible",
    })),
  };
  const challengerConfirmations = [lowLiquiditySnapshot, highLiquiditySnapshot].map((snapshot) => ({
    type: "market-confirmation",
    id: snapshot.selection.confirmationEventId,
    observedAt: snapshot.selection.confirmationObservedAt,
    sourceEventId: challengerDiscovery.id,
    candidates: [{
      chain: snapshot.chain,
      tokenAddress: snapshot.tokenAddress,
      status: "eligible",
    }],
  }));
  const pairedScorecard = buildScorecard([
    earlyRegistration,
    challengerDiscovery,
    ...challengerConfirmations,
    lowLiquiditySnapshot,
    highLiquiditySnapshot,
    lowBaseline,
    highBaseline,
    lowChallenger,
    highChallenger,
    resolutionEvent(lowBaseline, lowLiquiditySnapshot, market.priceUsd * 1.2, new Date(lowBaseline.dueAt)),
    resolutionEvent(highBaseline, highLiquiditySnapshot, market.priceUsd * 0.9, new Date(highBaseline.dueAt)),
    resolutionEvent(lowChallenger, lowLiquiditySnapshot, market.priceUsd * 1.2, new Date(lowChallenger.dueAt)),
    resolutionEvent(highChallenger, highLiquiditySnapshot, market.priceUsd * 0.9, new Date(highChallenger.dueAt)),
  ]);
  const challengerRow = pairedScorecard.rows.find((row) => (
    row.modelVersion === "frozen-onchain-rank-v4-liquidity-cap"
    && row.candidateId === "smart-money-liquidity-cap"
    && row.horizon === "1h"
  ));
  assert.equal(challengerRow.maturedForecasts, 2);
  assert.equal(challengerRow.predictedRiseForecasts, 1);
  assert.equal(challengerRow.portfolioAverageNetReturnPct, 16);
  const pairedComparison = pairedScorecard.challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v4-liquidity-cap"
  ));
  assert.equal(pairedComparison.matchedForecasts, 2);
  assert.equal(pairedComparison.independentPairedFrames, 1);
  assert.equal(pairedComparison.baselineAverageNetReturnPct, 1);
  assert.equal(pairedComparison.challengerAverageNetReturnPct, 8);
  assert.equal(pairedComparison.averagePairedDeltaPct, 7);
  assert.deepEqual(pairedComparison.pairedBootstrapMeanDeltaCi95Pct, [null, null]);
  assert.equal(pairedComparison.provisionalPairedGate, false);

  const delayedPairedScorecard = buildScorecard([
    earlyRegistration,
    challengerDiscovery,
    challengerConfirmations[0],
    lowLiquiditySnapshot,
    lowBaseline,
    lowChallenger,
    resolutionEvent(
      lowBaseline,
      lowLiquiditySnapshot,
      market.priceUsd * 1.2,
      new Date(Date.parse(lowBaseline.dueAt) + 6 * 60_000),
    ),
    resolutionEvent(
      lowChallenger,
      lowLiquiditySnapshot,
      market.priceUsd * 1.2,
      new Date(Date.parse(lowChallenger.dueAt) + 6 * 60_000),
    ),
  ]).challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v4-liquidity-cap"
  ));
  assert.equal(delayedPairedScorecard.matchedForecasts, 0);
  assert.equal(delayedPairedScorecard.horizonDriftedOutcomePairs, 1);

  const unregisteredComparison = buildScorecard([
    lowLiquiditySnapshot,
    lowBaseline,
    lowChallenger,
    resolutionEvent(lowBaseline, lowLiquiditySnapshot, market.priceUsd * 1.2, new Date(lowBaseline.dueAt)),
    resolutionEvent(lowChallenger, lowLiquiditySnapshot, market.priceUsd * 1.2, new Date(lowChallenger.dueAt)),
  ]).challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v4-liquidity-cap"
  ));
  assert.equal(unregisteredComparison.matchedForecasts, 0);

  const missingSourceLineageScorecard = buildScorecard([
    earlyRegistration,
    lowLiquiditySnapshot,
    lowBaseline,
    lowChallenger,
    resolutionEvent(lowBaseline, lowLiquiditySnapshot, market.priceUsd * 1.2, new Date(lowBaseline.dueAt)),
    resolutionEvent(lowChallenger, lowLiquiditySnapshot, market.priceUsd * 1.2, new Date(lowChallenger.dueAt)),
  ]);
  const missingSourceLineageComparison = missingSourceLineageScorecard.challengerComparisons.find((row) => (
    row.challengerModelVersion === "frozen-onchain-rank-v4-liquidity-cap"
  ));
  assert.equal(missingSourceLineageComparison.matchedForecasts, 0);
  assert.equal(missingSourceLineageComparison.lineageRejectedForecasts, 1);
  assert.equal(missingSourceLineageScorecard.rows.find((row) => (
    row.modelVersion === "frozen-onchain-rank-v4-liquidity-cap"
    && row.candidateId === "smart-money-liquidity-cap"
    && row.horizon === "1h"
  )).maturedForecasts, 0);

  const ineligibleConfirmation = {
    ...challengerConfirmations[0],
    candidates: challengerConfirmations[0].candidates.map((candidate) => ({
      ...candidate,
      status: "blocked",
    })),
  };
  const ineligibleLineageScorecard = buildScorecard([
    earlyRegistration,
    challengerDiscovery,
    ineligibleConfirmation,
    lowLiquiditySnapshot,
    lowBaseline,
    lowChallenger,
    resolutionEvent(lowBaseline, lowLiquiditySnapshot, market.priceUsd * 1.2, new Date(lowBaseline.dueAt)),
    resolutionEvent(lowChallenger, lowLiquiditySnapshot, market.priceUsd * 1.2, new Date(lowChallenger.dueAt)),
  ]);
  assert.equal(ineligibleLineageScorecard.challengerComparisons[0].matchedForecasts, 0);
  assert.equal(ineligibleLineageScorecard.challengerComparisons[0].lineageRejectedForecasts, 1);

  const profitableNote = retrospectiveEvent(
    selectionForecast,
    selectedResolution,
    new Date("2026-07-29T20:00:00.000Z"),
  );
  assert.equal(profitableNote.classification, "profitable-rise");
  assert.equal(profitableNote.magnitudeJudgment, "roughly-calibrated");
  assert.ok(profitableNote.causeTags.includes("selection-timeframe:1h"));

  const missedForecastBase = createForecastEvents(selectedSnapshot, priorSnapshot).find((forecast) => (
    forecast.candidateId === "market-only-control" && forecast.horizon === "1h"
  ));
  const missedForecast = {
    ...missedForecastBase,
    predictedRise: false,
    predictedRiseProbability: 0.4,
    predictedReturnPct: -1,
  };
  const missedOutcome = resolutionEvent(
    missedForecast,
    selectedSnapshot,
    selectedSnapshot.market.priceUsd * 1.5,
    new Date(missedForecast.dueAt),
  );
  assert.equal(classifyForecastOutcome(missedForecast, missedOutcome), "missed-explosion");
  const missedNote = retrospectiveEvent(missedForecast, missedOutcome, observedAt);
  assert.equal(missedNote.magnitudeJudgment, "underestimated");
  const duplicatedOpportunityNote = {
    ...missedNote,
    id: "retrospective-same-opportunity-different-model-row",
    forecastId: "forecast-same-opportunity-different-model-row",
    candidateId: "combined-onchain",
  };
  const retrospectiveSummary = buildRetrospectiveSummary([
    profitableNote,
    missedNote,
    duplicatedOpportunityNote,
  ]);
  assert.equal(retrospectiveSummary.totalReviewed, 3);
  assert.equal(retrospectiveSummary.missedExplosionCount, 2);
  assert.equal(retrospectiveSummary.uniqueMissedExplosionOpportunityCount, 1);
  assert.equal(retrospectiveSummary.topMissedExplosionCooccurrences.find((row) => (
    row.tag === "called-no-rise"
  )).count, 2);
  assert.equal(retrospectiveSummary.topUniqueMissedExplosionCooccurrences.find((row) => (
    row.tag === "called-no-rise"
  )).count, 1);
  assert.equal(retrospectiveSummary.classificationCounts["profitable-rise"], 1);
}

{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-ledger-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  await appendLedgerEvent(ledgerPath, priorSnapshot);
  await appendLedgerEvent(ledgerPath, currentSnapshot);
  const forecast = createForecastEvents(currentSnapshot, priorSnapshot)[0];
  await appendLedgerEvent(ledgerPath, forecast);
  const events = await readLedger(ledgerPath);
  assert.deepEqual(verifyLedger(events), { ok: true, errors: [], eventCount: 3 });

  const tampered = structuredClone(events);
  tampered[1].market.priceUsd = 100;
  assert.equal(verifyLedger(tampered).ok, false);

  const resolution = resolutionEvent(
    forecast,
    currentSnapshot,
    currentSnapshot.market.priceUsd * 1.25,
    new Date(forecast.dueAt),
  );
  assert.equal(resolution.grossReturnPct, 25);
  assert.equal(resolution.netReturnPct, 21);
  assert.equal(resolution.exploded25Pct, true);
  assert.equal(resolution.modelVersion, "frozen-onchain-rank-v3");
}

{
  assert.throws(
    () => nansenBudgetPlan("full", 2, 27),
    /requires 28/,
  );
  assert.deepEqual(nansenBudgetPlan("core", 2, 18), {
    profile: "core",
    tokenCount: 2,
    creditsPerToken: 9,
    requiredCredits: 18,
    endpoints: [
      { name: "tokenInformation", endpoint: "/api/v1/tgm/token-information", credits: 1 },
      { name: "flowIntelligence", endpoint: "/api/v1/tgm/flow-intelligence", credits: 1 },
      { name: "holders", endpoint: "/api/v1/tgm/holders", credits: 5 },
      { name: "whoBought", endpoint: "/api/v1/tgm/who-bought-sold", credits: 1 },
      { name: "whoSold", endpoint: "/api/v1/tgm/who-bought-sold", credits: 1 },
    ],
  });
}

{
  const requests = [];
  const nansen = await fetchNansenAggregates({
    profile: "core",
    maxCredits: 9,
    apiKey: "fixture-key",
    chain: "solana",
    tokenAddress,
    observedAt,
  }, async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body });
    if (String(url).endsWith("/token-information")) {
      return jsonResponse({ data: { spot_metrics: { total_holders: 100, unique_buyers: 20 } } });
    }
    if (String(url).endsWith("/flow-intelligence")) {
      return jsonResponse({
        data: {
          fresh_wallets_net_flow_usd: 500,
          smart_trader_net_flow_usd: 250,
        },
      });
    }
    if (String(url).endsWith("/holders")) {
      return jsonResponse({ data: [{ address: "stripped", ownership_percentage: 5 }] });
    }
    return jsonResponse({ data: [{
      address: "stripped",
      ...(body.buy_or_sell === "BUY"
        ? { bought_volume_usd: 100 }
        : { sold_volume_usd: 25 }),
    }] });
  });
  assert.equal(nansen.status, "ok");
  assert.equal(nansen.attemptedCredits, 9);
  assert.equal(nansen.aggregates.holderCount, 100);
  assert.equal(nansen.aggregates.flowSegments.freshWallet.netflowUsd, 500);
  assert.ok(!JSON.stringify(nansen.aggregates).includes("stripped"));
  const tokenInformationRequest = requests.find(({ url }) => url.endsWith("/token-information"));
  assert.deepEqual(tokenInformationRequest.body, {
    chain: "solana",
    token_address: tokenAddress,
    timeframe: "1d",
  });
  const holderRequest = requests.find(({ url }) => url.endsWith("/holders"));
  assert.equal(holderRequest.body.aggregate_by_entity, false);
  const boughtSoldRequests = requests.filter(({ url }) => url.endsWith("/who-bought-sold"));
  assert.deepEqual(
    boughtSoldRequests.map(({ body }) => body.buy_or_sell).sort(),
    ["BUY", "SELL"],
  );
  assert.equal(nansen.aggregates.sampledBuySellUsdRatio, 4);
}

{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-collect-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const fetcher = async (url) => {
    assert.ok(String(url).includes("/token-pairs/v1/solana/"));
    return jsonResponse([pair]);
  };
  const executionRegistration = (await registerTokenEdgeExecutionPolicy({ ledgerPath }, {
    now: new Date(observedAt.getTime() - 60 * 60_000),
  })).registrations[0];
  const first = await collectTokenEdgeSnapshots({
    ledgerPath,
    chain: "solana",
    tokenAddresses: [tokenAddress],
    selectionControlTimeframe: "1h",
    nansenProfile: "off",
    maxNansenCredits: 0,
  }, { fetcher, now: observedAt });
  assert.equal(first.results[0].status, "recorded");
  assert.equal(first.results[0].forecasts.length, 28);
  assert.equal(first.results[0].forecasts
    .filter((forecast) => forecast.status === "ready").length, 3);
  assert.deepEqual(first.results[0].forecasts.find((forecast) => (
    forecast.candidateId === "smart-money-liquidity-cap"
  )), {
    modelVersion: "frozen-onchain-rank-v4-liquidity-cap",
    candidateId: "smart-money-liquidity-cap",
    horizon: "1h",
    status: "blocked",
    blockers: [
      "missing verified Nansen-to-DEX selection lineage",
      "selection provider is not nansen-token-screener",
      "selection timeframe is not 6h",
      "snapshot is not strictly after the challenger evidence boundary",
      "challenger registration is missing",
    ],
    predictedRise: null,
    predictedReturnPct: null,
    decision: null,
    evidenceBoundary: "2026-08-03T00:04:55.356Z",
    challengerRegistrationId: null,
    challengerRegisteredAt: null,
    executionPolicyRegistrationId: executionRegistration.id,
    executionPolicyRegisteredAt: executionRegistration.registeredAt,
    executionPolicyVersion: "token-edge-capacity-v1",
    additionalEvidenceEventId: null,
  });

  const events = await readLedger(ledgerPath);
  assert.equal(events.filter((event) => event.type === "snapshot").length, 1);
  assert.equal(events.filter((event) => event.type === "forecast").length, 28);
  assert.equal(events.find((event) => event.type === "snapshot").selection.provider, "unscreened-market-control");

  const resolvedAt = new Date(observedAt.getTime() + 60 * 60_000);
  const resolutionResult = await resolveTokenEdgeForecasts({ ledgerPath }, {
    fetcher: async () => jsonResponse([{ ...pair, priceUsd: "0.011" }]),
    now: resolvedAt,
  });
  assert.equal(resolutionResult.dueForecasts, 1);
  assert.equal(resolutionResult.observed, 1);

  const finalEvents = await readLedger(ledgerPath);
  assert.equal(verifyLedger(finalEvents).ok, true);
  const observedResolution = finalEvents.find((event) => (
    event.type === "resolution" && event.status === "observed"
  ));
  assert.deepEqual(observedResolution.executionEvidence, {
    entryMarketObservedAt: observedAt.toISOString(),
    entryPairAddress: "Pair111",
    entryLiquidityUsd: 100_000,
    exitMarketObservedAt: resolvedAt.toISOString(),
    exitPairAddress: "Pair111",
    exitLiquidityUsd: 100_000,
  });
  const scorecard = buildScorecard([
    ...finalEvents,
    {
      ...observedResolution,
      id: "legacy-v1-resolution",
      forecastId: "legacy-v1-forecast",
      modelVersion: "frozen-onchain-rank-v1",
    },
  ]);
  const control1h = scorecard.rows.find((row) => (
    row.modelVersion === "frozen-onchain-rank-v3"
    && row.candidateId === "market-only-control"
    && row.horizon === "1h"
  ));
  assert.equal(control1h.maturedForecasts, 1);
  assert.equal(control1h.independentSignalFrames, 1);
  assert.equal(control1h.evidenceStatus, "collecting");
  assert.equal(control1h.evidenceShortfall.maturedForecasts, 251);
  assert.equal(control1h.evidenceShortfall.independentSignalFrames, 251);
  assert.equal(scorecard.capacityAudit.eligibleLiveOutcomes, 1);
  const legacyControl1h = scorecard.rows.find((row) => (
    row.modelVersion === "frozen-onchain-rank-v1"
    && row.candidateId === "market-only-control"
    && row.horizon === "1h"
  ));
  assert.equal(legacyControl1h.maturedForecasts, 1);
  assert.deepEqual(scorecard.modelVersions, [
    "frozen-onchain-rank-v1",
    "frozen-onchain-rank-v10-social-magnitude-direction",
    "frozen-onchain-rank-v11-dex-early-surface",
    "frozen-onchain-rank-v12-dex-early-surface-6h",
    "frozen-onchain-rank-v13-dex-early-surface-24h",
    "frozen-onchain-rank-v14-dex-positive-momentum-gate",
    "frozen-onchain-rank-v15-lunarcrush-creator-distribution-gate",
    "frozen-onchain-rank-v16-lunarcrush-age-unbounded",
    "frozen-onchain-rank-v3",
    "frozen-onchain-rank-v4-liquidity-cap",
    "frozen-onchain-rank-v5-lunarcrush-move-gate",
    "frozen-onchain-rank-v6-lunarcrush-next-day-move-gate",
    "frozen-onchain-rank-v7-pair-age-window",
    "frozen-onchain-rank-v8-lunarcrush-social-discovery",
    "frozen-onchain-rank-v9-hourly-turnover-gate",
  ]);
  const sameFrameScorecard = buildScorecard([
    ...finalEvents,
    {
      ...observedResolution,
      id: "same-frame-cross-sectional-resolution",
      forecastId: "same-frame-cross-sectional-forecast",
      tokenAddress: "CrossSectionalToken111111111111111111111111111",
    },
  ]);
  const sameFrameControl = sameFrameScorecard.rows.find((row) => (
    row.modelVersion === "frozen-onchain-rank-v3"
    && row.candidateId === "market-only-control"
    && row.horizon === "1h"
  ));
  assert.equal(sameFrameControl.maturedForecasts, 2);
  assert.equal(sameFrameControl.independentSignalFrames, 1);
  assert.equal(sameFrameControl.portfolioWeightedForecasts, 2);
  assert.equal(sameFrameControl.sameAssetOverlappingForecasts, 0);

  const sourceSnapshot = finalEvents.find((event) => event.type === "snapshot");
  const sourceForecast = finalEvents.find((event) => (
    event.type === "forecast"
    && event.candidateId === "market-only-control"
    && event.horizon === "1h"
  ));
  const repeatAt = new Date(observedAt.getTime() + 10 * 60_000);
  const repeatDueAt = new Date(repeatAt.getTime() + 60 * 60_000);
  const repeatSnapshot = {
    ...sourceSnapshot,
    id: "same-asset-repeat-snapshot",
    observedAt: repeatAt.toISOString(),
    market: { ...sourceSnapshot.market, observedAt: repeatAt.toISOString() },
  };
  const repeatForecast = {
    ...sourceForecast,
    id: "same-asset-repeat-forecast",
    snapshotId: repeatSnapshot.id,
    createdAt: repeatAt.toISOString(),
    dueAt: repeatDueAt.toISOString(),
    expiresAt: new Date(repeatDueAt.getTime() + 30 * 60_000).toISOString(),
  };
  const repeatResolution = {
    ...observedResolution,
    id: "same-asset-repeat-resolution",
    forecastId: repeatForecast.id,
    snapshotId: repeatSnapshot.id,
    dueAt: repeatForecast.dueAt,
    observedAt: repeatDueAt.toISOString(),
    executionEvidence: {
      ...observedResolution.executionEvidence,
      entryMarketObservedAt: repeatAt.toISOString(),
      exitMarketObservedAt: repeatDueAt.toISOString(),
    },
  };
  const repeatedAssetScorecard = buildScorecard([
    ...finalEvents,
    repeatSnapshot,
    repeatForecast,
    repeatResolution,
  ]);
  const repeatedAssetControl = repeatedAssetScorecard.rows.find((row) => (
    row.modelVersion === "frozen-onchain-rank-v3"
    && row.candidateId === "market-only-control"
    && row.horizon === "1h"
  ));
  assert.equal(repeatedAssetControl.maturedForecasts, 2);
  assert.equal(repeatedAssetControl.portfolioWeightedForecasts, 1);
  assert.equal(repeatedAssetControl.sameAssetOverlappingForecasts, 1);
  const repeatedAssetCapacity = repeatedAssetScorecard.capacityAudit.rows.find((row) => (
    row.modelVersion === "frozen-onchain-rank-v3"
    && row.candidateId === "market-only-control"
    && row.horizon === "1h"
  ));
  assert.equal(repeatedAssetCapacity.capacityEligibleLiveOutcomes, 2);
  assert.equal(repeatedAssetCapacity.capacityWeightedUniqueAssetOutcomes, 1);
  assert.equal(repeatedAssetCapacity.sameAssetOverlappingOutcomes, 1);
  assert.equal(repeatedAssetCapacity.paperCapitalAssignedUsd, 100);
  assert.equal(buildEvolutionReadiness(scorecard, "combined-onchain", "1h").status, "blocked");
  assert.deepEqual(buildEvolutionReadiness({
    rows: [{
      modelVersion: "frozen-onchain-rank-v4-liquidity-cap",
      candidateId: "smart-money-liquidity-cap",
      horizon: "1h",
      evidenceStatus: "eligible-for-frozen-audit",
      provisionalPromotionGate: true,
    }],
    challengerComparisons: [{
      challengerModelVersion: "frozen-onchain-rank-v4-liquidity-cap",
      challengerCandidateId: "smart-money-liquidity-cap",
      horizon: "1h",
      provisionalPairedGate: false,
    }],
  }, "smart-money-liquidity-cap", "1h", "frozen-onchain-rank-v4-liquidity-cap"), {
    status: "retain",
    candidateId: "smart-money-liquidity-cap",
    horizon: "1h",
    modelVersion: "frozen-onchain-rank-v4-liquidity-cap",
    reason: "The challenger did not beat its frozen parent on the paired forward-evidence gate.",
    mutationAllowed: false,
  });
  assert.equal(buildEvolutionReadiness({
    rows: [{
      modelVersion: "frozen-onchain-rank-v3",
      candidateId: "combined-onchain",
      horizon: "1h",
      evidenceStatus: "eligible-for-frozen-audit",
      provisionalPromotionGate: true,
    }],
    challengerComparisons: [],
  }, "combined-onchain", "1h").reason,
  "Insufficient prospectively registered live execution-capacity evidence.");
  assert.equal(buildEvolutionReadiness({
    rows: [{
      modelVersion: "frozen-onchain-rank-v3",
      candidateId: "combined-onchain",
      horizon: "1h",
      evidenceStatus: "eligible-for-frozen-audit",
      provisionalPromotionGate: true,
    }],
    challengerComparisons: [],
    capacityAudit: { rows: [{
      modelVersion: "frozen-onchain-rank-v3",
      candidateId: "combined-onchain",
      horizon: "1h",
      evidenceStatus: "eligible-for-frozen-capacity-audit",
      provisionalCapacityGate: true,
    }] },
  }, "combined-onchain", "1h").status, "audit-eligible");
  assert.ok((await readFile(ledgerPath, "utf8")).endsWith("\n"));
}

{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-selected-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  await appendLedgerEvent(ledgerPath, {
    type: "discovery",
    id: "discovery-selected",
    observedAt: observedAt.toISOString(),
    provider: "nansen-token-screener",
    timeframe: "1h",
    candidates: [{
      chain: "solana",
      tokenAddress,
      status: "eligible",
      netflowUsd: 8_000,
      netflowToLiquidity: 0.08,
      buySellVolumeRatio: 2,
      priceChangePct: 5,
      liquidityUsd: 100_000,
    }],
  });
  await appendLedgerEvent(ledgerPath, {
    type: "market-confirmation",
    id: "confirmation-selected",
    observedAt: observedAt.toISOString(),
    sourceEventId: "discovery-selected",
    candidates: [{
      chain: "solana",
      tokenAddress,
      status: "eligible",
      market: { liquidityUsd: 100_000, priceChangeH1Pct: 5 },
    }],
  });
  const collected = await collectTokenEdgeSnapshots({
    ledgerPath,
    chain: "solana",
    tokenAddresses: [tokenAddress],
    selectionConfirmationEventId: "confirmation-selected",
    nansenProfile: "off",
    maxNansenCredits: 0,
  }, {
    now: observedAt,
    fetcher: async () => jsonResponse([pair]),
  });
  const selection = collected.results[0].forecasts.find((forecast) => (
    forecast.candidateId === "smart-money-selection" && forecast.horizon === "1h"
  ));
  assert.equal(selection.status, "ready");
  const events = await readLedger(ledgerPath);
  const snapshot = events.find((event) => event.type === "snapshot");
  assert.equal(snapshot.selection.discoveryEventId, "discovery-selected");
  assert.equal(snapshot.selection.confirmationEventId, "confirmation-selected");
}

{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-registered-challenger-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const registration = createChallengerRegistrationEvents(
    new Date("2026-08-03T00:20:00.000Z"),
  )[0];
  await appendLedgerEvent(ledgerPath, registration);
  await appendLedgerEvent(ledgerPath, {
    type: "discovery",
    id: "discovery-registered-challenger",
    observedAt: "2026-08-03T00:30:00.000Z",
    provider: "nansen-token-screener",
    timeframe: "6h",
    candidates: [{
      chain: "solana",
      tokenAddress,
      status: "eligible",
      netflowUsd: 8_000,
      netflowToLiquidity: 0.08,
      buySellVolumeRatio: 2,
      priceChangePct: 5,
      liquidityUsd: 100_000,
    }],
  });
  await appendLedgerEvent(ledgerPath, {
    type: "market-confirmation",
    id: "confirmation-registered-challenger",
    observedAt: "2026-08-03T00:45:00.000Z",
    sourceEventId: "discovery-registered-challenger",
    candidates: [{
      chain: "solana",
      tokenAddress,
      status: "eligible",
      market: { liquidityUsd: 100_000, priceChangeH1Pct: 5 },
    }],
  });
  const collected = await collectTokenEdgeSnapshots({
    ledgerPath,
    chain: "solana",
    tokenAddresses: [tokenAddress],
    selectionConfirmationEventId: "confirmation-registered-challenger",
    nansenProfile: "off",
    maxNansenCredits: 0,
  }, {
    now: new Date("2026-08-03T01:00:00.000Z"),
    fetcher: async () => jsonResponse([pair]),
  });
  const challenger = collected.results[0].forecasts.find((forecast) => (
    forecast.candidateId === "smart-money-liquidity-cap"
  ));
  assert.equal(challenger.status, "ready");
  assert.equal(challenger.challengerRegistrationId, registration.id);
  assert.equal(challenger.challengerRegisteredAt, registration.registeredAt);
  const events = await readLedger(ledgerPath);
  const storedChallenger = events.find((event) => (
    event.type === "forecast" && event.candidateId === "smart-money-liquidity-cap"
  ));
  assert.equal(storedChallenger.challengerRegistrationId, registration.id);
  assert.equal(verifyLedger(events).ok, true);
}

{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-exact-resolution-expiry-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const snapshot = createSnapshotEvent({
    observedAt,
    chain: "solana",
    tokenAddress,
    cohort: "exact-resolution-expiry-test",
    market,
  });
  const forecast = createForecastEvents(snapshot, null).find((row) => (
    row.candidateId === "market-only-control" && row.horizon === "1h"
  ));
  await appendLedgerEvent(ledgerPath, snapshot);
  await appendLedgerEvent(ledgerPath, forecast);
  let providerCalls = 0;
  const result = await resolveTokenEdgeForecasts({ ledgerPath }, {
    now: new Date(Date.parse(forecast.dueAt) + (5 * 60_000) + 1),
    fetcher: async () => {
      providerCalls += 1;
      return jsonResponse([{ ...pair, priceUsd: "0.011" }]);
    },
  });
  assert.equal(result.dueForecasts, 1);
  assert.equal(result.observed, 0);
  assert.equal(result.missed, 1);
  assert.equal(providerCalls, 0);
  const events = await readLedger(ledgerPath);
  const missed = events.find((event) => event.type === "resolution");
  assert.equal(missed.status, "missed");
  assert.equal(missed.reason, "observation-window-expired");
}

{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-recovery-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const snapshot = createSnapshotEvent({
    observedAt,
    chain: "solana",
    tokenAddress,
    cohort: "recovery-test",
    market,
  });
  const forecast = createForecastEvents(snapshot, null).find((row) => (
    row.candidateId === "market-only-control" && row.horizon === "1h"
  ));
  const missed = missedResolutionEvent(
    forecast,
    new Date(Date.parse(forecast.expiresAt) + 1),
    "observation-window-expired",
  );
  await appendLedgerEvent(ledgerPath, snapshot);
  await appendLedgerEvent(ledgerPath, forecast);
  await appendLedgerEvent(ledgerPath, missed);
  const dueMinute = Math.floor(Date.parse(forecast.dueAt) / 60_000) * 60_000;
  const recovered = await recoverMissedTokenEdgeForecasts({
    ledgerPath,
    maxNansenCredits: 1,
    nansenApiKey: "fixture-key",
  }, {
    now: new Date(Date.parse(forecast.expiresAt) + 60_000),
    fetcher: async (url, init) => {
      assert.ok(String(url).endsWith("/api/v1/tgm/token-ohlcv"));
      const body = JSON.parse(init.body);
      assert.equal(body.timeframe, "1m");
      assert.equal(body.token_address, tokenAddress);
      return jsonResponse({
        token_address: tokenAddress,
        timeframe: "1m",
        truncated: false,
        data: [{ interval_start: new Date(dueMinute).toISOString(), close: 0.012 }],
      });
    },
  });
  assert.equal(recovered.requiredCredits, 1);
  assert.equal(recovered.recovered, 1);
  const events = await readLedger(ledgerPath);
  const recovery = events.find((event) => event.type === "resolution-recovery");
  assert.equal(recovery.missedResolutionId, missed.id);
  assert.equal(recovery.observationMode, "historical-ohlcv-recovery");
  assert.equal(recovery.grossReturnPct, 20);
  const row = buildScorecard(events).rows.find((item) => (
    item.modelVersion === "frozen-onchain-rank-v3"
    && item.candidateId === "market-only-control"
    && item.horizon === "1h"
  ));
  assert.equal(row.maturedForecasts, 1);
  assert.equal(row.liveMaturedForecasts, 0);
  assert.equal(row.recoveredMaturedForecasts, 1);
}

{
  const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-pool-recovery-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const snapshot = createSnapshotEvent({
    observedAt,
    chain: "solana",
    tokenAddress,
    cohort: "pool-recovery-test",
    market,
  });
  const forecast = createForecastEvents(snapshot, null).find((row) => (
    row.candidateId === "market-only-control" && row.horizon === "1h"
  ));
  const missed = missedResolutionEvent(
    forecast,
    new Date(Date.parse(forecast.expiresAt) + 1),
    "observation-window-expired",
  );
  await appendLedgerEvent(ledgerPath, snapshot);
  await appendLedgerEvent(ledgerPath, forecast);
  await appendLedgerEvent(ledgerPath, missed);
  const dueMinuteSeconds = Math.floor(Date.parse(forecast.dueAt) / 60_000) * 60;
  const recovered = await recoverMissedFromPoolOhlcv({
    ledgerPath,
    maxRequests: 1,
  }, {
    now: new Date(Date.parse(forecast.expiresAt) + 60_000),
    fetcher: async (url) => {
      assert.ok(String(url).includes(`/pools/${market.pairAddress}/ohlcv/minute`));
      assert.ok(String(url).includes("include_empty_intervals=true"));
      return jsonResponse({
        data: {
          attributes: {
            ohlcv_list: [[dueMinuteSeconds, 0.011, 0.012, 0.011, 0.012, 0]],
          },
        },
      });
    },
  });
  assert.equal(recovered.requiredRequests, 1);
  assert.equal(recovered.recovered, 1);
  const events = await readLedger(ledgerPath);
  const recovery = events.find((event) => event.type === "resolution-recovery");
  assert.equal(recovery.provider, "geckoterminal-pool-ohlcv");
  assert.equal(recovery.candle.pairAddress, market.pairAddress);
  assert.equal(recovery.candle.emptyIntervalFilled, true);
}

console.log("token-edge prospective on-chain research checks passed.");

function dexPair(input = {}) {
  return {
    chainId: "solana",
    dexId: "raydium",
    pairAddress: input.pairAddress ?? "Pair111",
    url: "https://dexscreener.com/solana/Pair111",
    baseToken: {
      address: input.baseAddress ?? tokenAddress,
      symbol: "EDGE",
    },
    quoteToken: { address: "So111", symbol: "SOL" },
    priceUsd: input.priceUsd ?? "0.01",
    liquidity: { usd: input.liquidityUsd ?? 50_000 },
    marketCap: 1_000_000,
    fdv: 1_000_000,
    pairCreatedAt: observedAt.getTime() - 2 * 60 * 60_000,
    volume: { m5: 500, h1: 20_000, h6: 60_000, h24: 100_000 },
    priceChange: { m5: 1, h1: 5, h6: 8, h24: 15 },
    txns: {
      m5: { buys: 10, sells: 5 },
      h1: { buys: 90, sells: 30 },
      h6: { buys: 200, sells: 100 },
      h24: { buys: 500, sells: 300 },
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
