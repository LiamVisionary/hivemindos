#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readLedger, verifyLedger } from "./token-edge/onchain-forward-core.mjs";
import {
  GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_DANGER_COUNT_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_LOW_MOMENTUM_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_PATH_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_TURNOVER_RULE,
  GECKOTERMINAL_NEW_POOL_MARKET_CAP_FLOOR_REMOVED_RULE,
  activateGeckoTerminalNewPools,
  buildGeckoTerminalNewPoolBirthEntryScorecard,
  buildGeckoTerminalNewPoolBirthCreatorBalanceScorecard,
  buildGeckoTerminalNewPoolBirthDangerCountScorecard,
  buildGeckoTerminalNewPoolBirthJupiterExecutableScorecard,
  buildGeckoTerminalNewPoolBirthJupiterRoundTripScorecard,
  buildGeckoTerminalNewPoolBirthLpProviderScorecard,
  buildGeckoTerminalNewPoolBirthLowMomentumScorecard,
  buildGeckoTerminalNewPoolBirthMarketCapFloorRemovedScorecard,
  buildGeckoTerminalNewPoolBirthUpperMomentumScorecard,
  buildGeckoTerminalNewPoolBirthPairAgeScorecard,
  buildGeckoTerminalNewPoolBirthRugCheckPanelScorecard,
  buildGeckoTerminalNewPoolBirthSocialPresenceScorecard,
  buildGeckoTerminalNewPoolBirthTurnoverScorecard,
  buildGeckoTerminalNewPoolMarketCapFloorRemovedScorecard,
  buildGeckoTerminalNewPoolScorecard,
  captureGeckoTerminalNewPoolBirthEntries,
  geckoNewbornCandidate,
  markOpenGeckoTerminalNewPoolBirthPaths,
  registerGeckoTerminalNewPoolActivation,
  registerGeckoTerminalNewPoolBirthEntry,
  registerGeckoTerminalNewPoolBirthCreatorBalance,
  registerGeckoTerminalNewPoolBirthDangerCount,
  registerGeckoTerminalNewPoolBirthJupiterExecutable,
  registerGeckoTerminalNewPoolBirthJupiterRoundTrip,
  registerGeckoTerminalNewPoolBirthLpProvider,
  registerGeckoTerminalNewPoolBirthLowMomentum,
  registerGeckoTerminalNewPoolBirthMarketCapFloorRemoved,
  registerGeckoTerminalNewPoolBirthUpperMomentum,
  registerGeckoTerminalNewPoolBirthPairAge,
  registerGeckoTerminalNewPoolBirthPath,
  registerGeckoTerminalNewPoolBirthRugCheckPanel,
  registerGeckoTerminalNewPoolBirthSocialPresence,
  registerGeckoTerminalNewPoolBirthTurnover,
  registerGeckoTerminalNewPoolMarketCapFloorRemoved,
  readJupiterExactInQuote,
  resolveGeckoTerminalNewPoolBirthJupiterExecutable,
  resolveGeckoTerminalNewPoolForecasts,
  watchGeckoTerminalNewPools,
} from "./token-edge/onchain-geckoterminal-new-pool-activation.mjs";
import {
  registerGeckoTerminalLiquidityCollapseScoring,
} from "./token-edge/onchain-geckoterminal-trending-monitoring.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "token-edge-gecko-new-pool-"));
try {
  const ledgerPath = path.join(root, "ledger.jsonl");
  await assert.rejects(
    registerGeckoTerminalNewPoolActivation(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const registration = await registerGeckoTerminalNewPoolActivation(
    { ledgerPath },
    { now: new Date("2026-08-04T03:58:30.000Z") },
  );
  assert.equal(registration.status, "registered");
  const repeatedRegistration = await registerGeckoTerminalNewPoolActivation(
    { ledgerPath },
    { now: new Date("2026-08-04T03:58:45.000Z") },
  );
  assert.equal(repeatedRegistration.status, "existing");
  const liquidityRegistration = await registerGeckoTerminalLiquidityCollapseScoring(
    { ledgerPath },
    { now: new Date("2026-08-04T03:59:00.000Z") },
  );
  assert.equal(liquidityRegistration.status, "registered");

  const watchAt = new Date("2026-08-04T04:00:00.000Z");
  const eligibleBirth = poolRow({
    tokenAddress: "TokenNewborn111111111111111111111111111111",
    pairAddress: "PoolNewborn1111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T03:59:00.000Z",
  });
  const blockedBirth = poolRow({
    tokenAddress: "TokenBlocked111111111111111111111111111111",
    pairAddress: "PoolBlocked1111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T03:59:15.000Z",
    liquidityUsd: 5_000,
  });
  const preRegistrationBirth = poolRow({
    tokenAddress: "TokenOld111111111111111111111111111111111",
    pairAddress: "PoolOld1111111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T03:58:00.000Z",
  });
  assert.equal(geckoNewbornCandidate(eligibleBirth, 1, watchAt).status, "watchable");
  assert.equal(geckoNewbornCandidate(preRegistrationBirth, 3, watchAt).status, "watchable");
  const unsafeSymbol = structuredClone(eligibleBirth);
  unsafeSymbol.attributes.name = "\u202eGDSU / SOL";
  assert.equal(geckoNewbornCandidate(unsafeSymbol, 1, watchAt).symbol, "GDSU");

  const watch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: watchAt,
      clock: () => watchAt,
      fetcher: fakeProvider({ newPoolRows: [eligibleBirth, blockedBirth, preRegistrationBirth] }),
    },
  );
  assert.equal(watch.status, "recorded");
  assert.equal(watch.returnedRows, 3);
  assert.equal(watch.watchedCandidates, 2);
  assert.deepEqual(watch.activationDueAtRange, [
    "2026-08-04T04:14:00.000Z",
    "2026-08-04T04:14:15.000Z",
  ]);
  const watchedEvents = await readLedger(ledgerPath);
  const watchedDiscovery = watchedEvents.find((event) => (
    event.id === watch.discoveryEventId
  ));
  assert.deepEqual(watchedDiscovery.candidates.map((candidate) => candidate.sourceRank), [1, 2]);
  assert.equal(watchedDiscovery.candidates[0].activationDueAt, "2026-08-04T04:14:00.000Z");

  const repeatedWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T04:01:00.000Z"),
      fetcher: async () => {
        throw new Error("duplicate cadence must not call provider");
      },
    },
  );
  assert.equal(repeatedWatch.status, "skipped-existing-cadence");
  const duplicateLaterWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T04:05:00.000Z"),
      clock: () => new Date("2026-08-04T04:05:00.000Z"),
      fetcher: fakeProvider({ newPoolRows: [eligibleBirth, blockedBirth] }),
    },
  );
  assert.equal(duplicateLaterWatch.watchedCandidates, 0);

  const earlyActivation = await activateGeckoTerminalNewPools(
    { ledgerPath },
    { now: new Date("2026-08-04T04:13:59.000Z") },
  );
  assert.equal(earlyActivation.dueCandidates, 0);
  const activationAt = new Date("2026-08-04T04:15:00.000Z");
  const entryPair = dexPair({
    tokenAddress: eligibleBirth.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: eligibleBirth.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const activation = await activateGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: activationAt,
      clock: () => activationAt,
      captureClock: () => activationAt,
      fetcher: fakeProvider({
        multiPoolRows: [eligibleBirth, blockedBirth],
        directPairs: [entryPair],
      }),
    },
  );
  assert.equal(activation.dueCandidates, 2);
  assert.equal(activation.recordedActivations, 2);
  assert.equal(activation.observedActivations, 2);
  assert.equal(activation.recordedForecasts, 1);
  assert.equal(activation.forecasts[0].dueAt, "2026-08-04T05:15:00.000Z");
  const openScore = buildGeckoTerminalNewPoolScorecard(await readLedger(ledgerPath));
  assert.equal(openScore.candidateForecasts, 1);
  assert.equal(openScore.openForecasts, 1);
  assert.equal(openScore.eligibleLiveObservations, 0);
  assert.equal(openScore.provisionalGate, false);

  const exitRow = poolRow({
    tokenAddress: entryPair.baseToken.address,
    pairAddress: entryPair.pairAddress,
    poolCreatedAt: eligibleBirth.attributes.pool_created_at,
    priceUsd: 0.00012,
    liquidityUsd: 24_000,
  });
  const exitPair = dexPair({
    tokenAddress: entryPair.baseToken.address,
    pairAddress: entryPair.pairAddress,
    priceUsd: 0.00012,
    liquidityUsd: 24_000,
  });
  const resolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T05:15:30.000Z"),
      fetcher: fakeProvider({ exactPoolRows: [exitRow], directPairs: [exitPair] }),
    },
  );
  assert.equal(resolution.dueForecasts, 1);
  assert.equal(resolution.observed, 1);
  assert.equal(resolution.missed, 0);

  const events = await readLedger(ledgerPath);
  assert.deepEqual(verifyLedger(events), {
    ok: true,
    errors: [],
    eventCount: events.length,
  });
  const score = buildGeckoTerminalNewPoolScorecard(events);
  assert.equal(score.candidateForecasts, 1);
  assert.equal(score.openForecasts, 0);
  assert.equal(score.eligibleLiveObservations, 1);
  assert.equal(score.portfolioWeightedObservations, 1);
  assert.equal(score.uniqueTokens, 1);
  assert.equal(score.netWinRate, 1);
  assert.ok(score.portfolioAverageCapacityReturnPct > 0);
  assert.ok(score.stressPortfolioAverageCapacityReturnPct > 0);
  assert.equal(score.provisionalGate, false);

  const tampered = structuredClone(events);
  const readyActivation = tampered.find((event) => (
    event.type === "geckoterminal-new-pool-activation" && event.entryStatus === "ready"
  ));
  readyActivation.candidate.priceChangeH1Pct = 99;
  const rejected = buildGeckoTerminalNewPoolScorecard(tampered);
  assert.equal(rejected.eligibleLiveObservations, 0);
  assert.deepEqual(rejected.rejectionCounts, { "activation-mismatch": 1 });

  const collapseWatchAt = new Date("2026-08-04T05:20:00.000Z");
  const collapseBirth = poolRow({
    tokenAddress: "TokenDrain11111111111111111111111111111111",
    pairAddress: "PoolDrain111111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T05:19:00.000Z",
  });
  const collapseWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: collapseWatchAt,
      clock: () => collapseWatchAt,
      fetcher: fakeProvider({ newPoolRows: [collapseBirth] }),
    },
  );
  assert.equal(collapseWatch.watchedCandidates, 1);
  const collapseEntryPair = dexPair({
    tokenAddress: collapseBirth.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: collapseBirth.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const collapseActivationAt = new Date("2026-08-04T05:35:00.000Z");
  const collapseActivation = await activateGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: collapseActivationAt,
      clock: () => collapseActivationAt,
      captureClock: () => collapseActivationAt,
      fetcher: fakeProvider({
        multiPoolRows: [collapseBirth],
        directPairs: [collapseEntryPair],
      }),
    },
  );
  assert.equal(collapseActivation.recordedForecasts, 1);
  const collapsedRow = poolRow({
    tokenAddress: collapseEntryPair.baseToken.address,
    pairAddress: collapseEntryPair.pairAddress,
    poolCreatedAt: collapseBirth.attributes.pool_created_at,
    priceUsd: 0.00005,
    liquidityUsd: 0,
  });
  const collapsedPair = dexPair({
    tokenAddress: collapseEntryPair.baseToken.address,
    pairAddress: collapseEntryPair.pairAddress,
    priceUsd: 0.00005,
    liquidityUsd: 0,
  });
  const collapseResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T06:35:30.000Z"),
      fetcher: fakeProvider({ exactPoolRows: [collapsedRow], directPairs: [collapsedPair] }),
    },
  );
  assert.equal(collapseResolution.liquidityCollapses, 1);
  const collapsedEvents = await readLedger(ledgerPath);
  const collapsedOutcome = collapsedEvents.find((event) => (
    event.type === "geckoterminal-new-pool-resolution"
      && event.forecastId === collapseActivation.forecasts[0].id
  ));
  assert.equal(collapsedOutcome.status, "liquidity-collapse");
  assert.equal(collapsedOutcome.grossReturnPct, -100);
  assert.equal(collapsedOutcome.exitLiquidityUsd, 0);
  const collapseScore = buildGeckoTerminalNewPoolScorecard(collapsedEvents);
  assert.equal(collapseScore.eligibleLiveObservations, 2);
  assert.equal(collapseScore.liquidityCollapseCount, 1);
  assert.equal(collapseScore.netWinRate, 0.5);
  assert.ok(collapseScore.portfolioAverageCapacityReturnPct < 0);

  await assert.rejects(
    registerGeckoTerminalNewPoolMarketCapFloorRemoved(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_MARKET_CAP_FLOOR_REMOVED_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const marketCapRegistration = await registerGeckoTerminalNewPoolMarketCapFloorRemoved(
    { ledgerPath },
    { now: new Date("2026-08-04T06:36:00.000Z") },
  );
  assert.equal(marketCapRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolMarketCapFloorRemoved(
    { ledgerPath },
    { now: new Date("2026-08-04T06:36:01.000Z") },
  )).status, "existing");

  const lowCapWatchAt = new Date("2026-08-04T06:40:00.000Z");
  const lowCapBirth = poolRow({
    tokenAddress: "TokenLowCap1111111111111111111111111111111",
    pairAddress: "PoolLowCap11111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T06:39:00.000Z",
    marketCapUsd: 12_000,
  });
  const lowCapWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: lowCapWatchAt,
      clock: () => lowCapWatchAt,
      fetcher: fakeProvider({ newPoolRows: [lowCapBirth] }),
    },
  );
  assert.equal(lowCapWatch.watchedCandidates, 1);
  const lowCapEntryPair = dexPair({
    tokenAddress: lowCapBirth.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: lowCapBirth.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const lowCapActivation = await activateGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T06:55:00.000Z"),
      clock: () => new Date("2026-08-04T06:55:00.000Z"),
      captureClock: () => new Date("2026-08-04T06:55:00.000Z"),
      fetcher: fakeProvider({
        multiPoolRows: [lowCapBirth],
        directPairs: [lowCapEntryPair],
      }),
    },
  );
  assert.equal(lowCapActivation.recordedActivations, 1);
  assert.equal(lowCapActivation.recordedForecasts, 1);
  const lowCapForecast = (await readLedger(ledgerPath)).find((event) => (
    event.id === lowCapActivation.forecasts[0].id
  ));
  assert.equal(
    lowCapForecast.ruleVersion,
    GECKOTERMINAL_NEW_POOL_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  );
  assert.equal(lowCapForecast.registrationId, marketCapRegistration.registrationId);
  const lowCapOpenScore = buildGeckoTerminalNewPoolMarketCapFloorRemovedScorecard(
    await readLedger(ledgerPath),
  );
  assert.equal(lowCapOpenScore.candidateForecasts, 1);
  assert.equal(lowCapOpenScore.openForecasts, 1);

  const lowCapExitRow = poolRow({
    tokenAddress: lowCapEntryPair.baseToken.address,
    pairAddress: lowCapEntryPair.pairAddress,
    poolCreatedAt: lowCapBirth.attributes.pool_created_at,
    priceUsd: 0.00013,
    liquidityUsd: 24_000,
    marketCapUsd: 15_600,
  });
  const lowCapExitPair = dexPair({
    tokenAddress: lowCapEntryPair.baseToken.address,
    pairAddress: lowCapEntryPair.pairAddress,
    priceUsd: 0.00013,
    liquidityUsd: 24_000,
  });
  const lowCapResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T07:55:30.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [lowCapExitRow],
        directPairs: [lowCapExitPair],
      }),
    },
  );
  assert.equal(lowCapResolution.observed, 1);
  const lowCapScore = buildGeckoTerminalNewPoolMarketCapFloorRemovedScorecard(
    await readLedger(ledgerPath),
  );
  assert.equal(lowCapScore.eligibleLiveObservations, 1);
  assert.ok(lowCapScore.portfolioAverageCapacityReturnPct > 0);
  assert.ok(lowCapScore.stressPortfolioAverageCapacityReturnPct > 0);
  assert.equal(lowCapScore.provisionalGate, false);

  const retryableProviderBirth = poolRow({
    tokenAddress: "TokenRetryableProvider11111111111111111111111",
    pairAddress: "PoolRetryableProvider111111111111111111111111",
    poolCreatedAt: "2026-08-04T07:29:00.000Z",
    liquidityUsd: 5_000,
  });
  const retryableWatchAt = new Date("2026-08-04T07:30:00.000Z");
  const retryableWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: retryableWatchAt,
      clock: () => retryableWatchAt,
      fetcher: fakeProvider({ newPoolRows: [retryableProviderBirth] }),
    },
  );
  assert.equal(retryableWatch.watchedCandidates, 1);
  const providerFailureAt = new Date("2026-08-04T07:45:00.000Z");
  const providerFailure = await activateGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: providerFailureAt,
      fetcher: async (url) => {
        if (url.includes("/pools/multi/")) return jsonResponse({}, 429);
        throw new Error(`Unexpected retryable provider URL: ${url}`);
      },
    },
  );
  assert.equal(providerFailure.dueCandidates, 1);
  assert.equal(providerFailure.requestsAttempted, 1);
  assert.equal(providerFailure.recordedActivations, 0);
  assert.equal(providerFailure.missedActivations, 0);
  assert.match(providerFailure.failures[0], /HTTP 429/);
  assert.equal((await readLedger(ledgerPath)).some((event) => (
    event.type === "geckoterminal-new-pool-activation"
      && event.pairAddress === retryableProviderBirth.attributes.address
  )), false);
  const providerRetryAt = new Date("2026-08-04T07:46:00.000Z");
  const providerRetry = await activateGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: providerRetryAt,
      clock: () => providerRetryAt,
      captureClock: () => providerRetryAt,
      fetcher: fakeProvider({ multiPoolRows: [retryableProviderBirth] }),
    },
  );
  assert.equal(providerRetry.dueCandidates, 1);
  assert.equal(providerRetry.recordedActivations, 1);
  assert.equal(providerRetry.observedActivations, 1);
  assert.equal(providerRetry.missedActivations, 0);
  assert.equal(providerRetry.recordedForecasts, 0);

  const mismatchWatchAt = new Date("2026-08-04T08:00:00.000Z");
  const mismatchBirth = poolRow({
    tokenAddress: "TokenMismatch11111111111111111111111111111",
    pairAddress: "PoolMismatch111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T07:59:00.000Z",
  });
  const mismatchWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: mismatchWatchAt,
      clock: () => mismatchWatchAt,
      fetcher: fakeProvider({ newPoolRows: [mismatchBirth] }),
    },
  );
  assert.equal(mismatchWatch.watchedCandidates, 1);
  const changedIdentity = poolRow({
    tokenAddress: "DifferentToken1111111111111111111111111111",
    pairAddress: mismatchBirth.attributes.address,
    poolCreatedAt: mismatchBirth.attributes.pool_created_at,
  });
  const mismatchActivationAt = new Date("2026-08-04T08:15:00.000Z");
  const mismatchActivation = await activateGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: mismatchActivationAt,
      clock: () => mismatchActivationAt,
      captureClock: () => mismatchActivationAt,
      fetcher: fakeProvider({ multiPoolRows: [changedIdentity] }),
    },
  );
  assert.equal(mismatchActivation.dueCandidates, 1);
  assert.equal(mismatchActivation.recordedActivations, 1);
  assert.equal(mismatchActivation.missedActivations, 1);
  assert.equal(mismatchActivation.recordedForecasts, 0);
  const sealedMismatch = (await readLedger(ledgerPath)).find((event) => (
    event.type === "geckoterminal-new-pool-activation"
      && event.pairAddress === mismatchBirth.attributes.address
  ));
  assert.equal(sealedMismatch.reason, "activation-identity-mismatch");
  assert.equal(sealedMismatch.entryStatus, "cash");
  const mismatchRetry = await activateGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: new Date("2026-08-04T08:16:00.000Z"),
      fetcher: async () => {
        throw new Error("sealed identity mismatch must not retry a provider");
      },
    },
  );
  assert.equal(mismatchRetry.dueCandidates, 0);

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthEntry(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const birthEntryRegistration = await registerGeckoTerminalNewPoolBirthEntry(
    { ledgerPath },
    { now: new Date("2026-08-04T08:27:00.000Z") },
  );
  assert.equal(birthEntryRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthEntry(
    { ledgerPath },
    { now: new Date("2026-08-04T08:27:01.000Z") },
  )).status, "existing");

  const birthEntryWatchAt = new Date("2026-08-04T08:30:00.000Z");
  const birthEntryPool = poolRow({
    tokenAddress: "TokenBirthEntry111111111111111111111111111",
    pairAddress: "PoolBirthEntry1111111111111111111111111111",
    poolCreatedAt: "2026-08-04T08:29:00.000Z",
  });
  const birthEntryWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: birthEntryWatchAt,
      clock: () => birthEntryWatchAt,
      fetcher: fakeProvider({ newPoolRows: [birthEntryPool] }),
    },
  );
  assert.equal(birthEntryWatch.watchedCandidates, 1);
  const birthDiscovery = (await readLedger(ledgerPath)).find((event) => (
    event.id === birthEntryWatch.discoveryEventId
  ));
  assert.equal(birthDiscovery.candidates[0].birthQuote.status, "eligible");
  assert.equal(birthDiscovery.candidates[0].birthQuote.pairAgeMinutes, 1);

  const birthEntryPair = dexPair({
    tokenAddress: birthEntryPool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: birthEntryPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const birthCaptureAt = new Date("2026-08-04T08:30:10.000Z");
  const birthCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: birthCaptureAt,
      captureClock: () => birthCaptureAt,
      fetcher: fakeProvider({ directPairs: [birthEntryPair] }),
    },
  );
  assert.equal(birthCapture.status, "recorded");
  assert.equal(birthCapture.recordedForecasts, 1);
  assert.equal(birthCapture.forecasts[0].dueAt, "2026-08-04T09:30:10.000Z");
  const birthOpenScore = buildGeckoTerminalNewPoolBirthEntryScorecard(
    await readLedger(ledgerPath),
  );
  assert.equal(birthOpenScore.candidateForecasts, 1);
  assert.equal(birthOpenScore.openForecasts, 1);

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthPath(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_PATH_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const birthPathRegistration = await registerGeckoTerminalNewPoolBirthPath(
    { ledgerPath },
    { now: new Date("2026-08-04T09:10:00.000Z") },
  );
  assert.equal(birthPathRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthPath(
    { ledgerPath },
    { now: new Date("2026-08-04T09:10:01.000Z") },
  )).status, "existing");
  const preRegistrationForecastPath = await markOpenGeckoTerminalNewPoolBirthPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T09:15:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: birthEntryPair.baseToken.address,
          pairAddress: birthEntryPair.pairAddress,
          poolCreatedAt: birthEntryPool.attributes.pool_created_at,
          priceUsd: 0.00012,
          liquidityUsd: 22_000,
        })],
        directPairs: [dexPair({
          tokenAddress: birthEntryPair.baseToken.address,
          pairAddress: birthEntryPair.pairAddress,
          priceUsd: 0.00012,
          liquidityUsd: 22_000,
        })],
      }),
    },
  );
  assert.equal(preRegistrationForecastPath.recordedObservations, 1);
  assert.equal(preRegistrationForecastPath.observations[0].grossReturnFromEntryPct, 20);
  assert.equal(preRegistrationForecastPath.observations[0].sourceForecastPreRegistration, true);
  const repeatedBirthPath = await markOpenGeckoTerminalNewPoolBirthPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T09:15:11.000Z"),
      fetcher: async () => { throw new Error("same birth-path bucket must spend zero calls"); },
    },
  );
  assert.equal(repeatedBirthPath.recordedObservations, 0);
  assert.equal(repeatedBirthPath.requestsAttempted, 0);

  const birthExitRow = poolRow({
    tokenAddress: birthEntryPair.baseToken.address,
    pairAddress: birthEntryPair.pairAddress,
    poolCreatedAt: birthEntryPool.attributes.pool_created_at,
    priceUsd: 0.00014,
    liquidityUsd: 25_000,
  });
  const birthExitPair = dexPair({
    tokenAddress: birthEntryPair.baseToken.address,
    pairAddress: birthEntryPair.pairAddress,
    priceUsd: 0.00014,
    liquidityUsd: 25_000,
  });
  const birthResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T09:30:40.000Z"),
      fetcher: fakeProvider({ exactPoolRows: [birthExitRow], directPairs: [birthExitPair] }),
    },
  );
  assert.equal(birthResolution.observed, 1);
  const birthEvents = await readLedger(ledgerPath);
  const birthScore = buildGeckoTerminalNewPoolBirthEntryScorecard(birthEvents);
  assert.equal(birthScore.eligibleLiveObservations, 1);
  assert.equal(birthScore.netWinRate, 1);
  assert.ok(birthScore.portfolioAverageCapacityReturnPct > 0);
  assert.ok(birthScore.stressPortfolioAverageCapacityReturnPct > 0);
  const tamperedBirth = structuredClone(birthEvents);
  const birthDiscoveryToTamper = tamperedBirth.find((event) => (
    event.id === birthEntryWatch.discoveryEventId
  ));
  birthDiscoveryToTamper.candidates[0].birthQuote.priceChangeH1Pct = 99;
  assert.deepEqual(
    buildGeckoTerminalNewPoolBirthEntryScorecard(tamperedBirth).rejectionCounts,
    { "newborn-birth-quote-mismatch": 1 },
  );

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthMarketCapFloorRemoved(
      { ledgerPath },
      {
        now: new Date(
          GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.evidenceBoundary,
        ),
      },
    ),
    /strictly after its evidence boundary/,
  );
  const birthLowCapRegistration = await registerGeckoTerminalNewPoolBirthMarketCapFloorRemoved(
    { ledgerPath },
    { now: new Date("2026-08-04T09:31:00.000Z") },
  );
  assert.equal(birthLowCapRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthMarketCapFloorRemoved(
    { ledgerPath },
    { now: new Date("2026-08-04T09:31:01.000Z") },
  )).status, "existing");

  const birthLowCapPool = poolRow({
    tokenAddress: "TokenBirthLowCap11111111111111111111111111",
    pairAddress: "PoolBirthLowCap111111111111111111111111111",
    poolCreatedAt: "2026-08-04T09:34:00.000Z",
    marketCapUsd: 25_000,
  });
  const birthLowCapWatchAt = new Date("2026-08-04T09:35:00.000Z");
  const birthLowCapWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: birthLowCapWatchAt,
      clock: () => birthLowCapWatchAt,
      fetcher: fakeProvider({ newPoolRows: [birthLowCapPool] }),
    },
  );
  const birthLowCapDiscovery = (await readLedger(ledgerPath)).find((event) => (
    event.id === birthLowCapWatch.discoveryEventId
  ));
  assert.deepEqual(
    birthLowCapDiscovery.candidates[0].birthQuote.blockers,
    ["market-cap-outside-50000-5000000"],
  );

  const birthLowCapPair = dexPair({
    tokenAddress: birthLowCapPool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: birthLowCapPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const birthLowCapCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: new Date("2026-08-04T09:35:10.000Z"),
      captureClock: () => new Date("2026-08-04T09:35:10.000Z"),
      fetcher: fakeProvider({ directPairs: [birthLowCapPair] }),
    },
  );
  assert.equal(birthLowCapCapture.recordedForecasts, 1);
  const birthLowCapForecast = (await readLedger(ledgerPath)).find((event) => (
    event.id === birthLowCapCapture.forecasts[0].id
  ));
  assert.equal(
    birthLowCapForecast.ruleVersion,
    GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  );
  assert.equal(birthLowCapCapture.forecasts[0].dueAt, "2026-08-04T10:35:10.000Z");
  const birthLowCapPath = await markOpenGeckoTerminalNewPoolBirthPaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T09:40:10.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: birthLowCapPair.baseToken.address,
          pairAddress: birthLowCapPair.pairAddress,
          poolCreatedAt: birthLowCapPool.attributes.pool_created_at,
          priceUsd: 0.00013,
          liquidityUsd: 24_000,
          marketCapUsd: 30_000,
        })],
        directPairs: [dexPair({
          tokenAddress: birthLowCapPair.baseToken.address,
          pairAddress: birthLowCapPair.pairAddress,
          priceUsd: 0.00013,
          liquidityUsd: 24_000,
        })],
      }),
    },
  );
  assert.equal(birthLowCapPath.recordedObservations, 1);
  assert.equal(birthLowCapPath.observations[0].grossReturnFromEntryPct, 30);
  assert.equal(birthLowCapPath.observations[0].sourceForecastPreRegistration, false);

  const birthLowCapExitRow = poolRow({
    tokenAddress: birthLowCapPair.baseToken.address,
    pairAddress: birthLowCapPair.pairAddress,
    poolCreatedAt: birthLowCapPool.attributes.pool_created_at,
    priceUsd: 0.00016,
    liquidityUsd: 30_000,
    marketCapUsd: 40_000,
  });
  const birthLowCapExitPair = dexPair({
    tokenAddress: birthLowCapPair.baseToken.address,
    pairAddress: birthLowCapPair.pairAddress,
    priceUsd: 0.00016,
    liquidityUsd: 30_000,
  });
  const birthLowCapResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T10:35:40.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [birthLowCapExitRow],
        directPairs: [birthLowCapExitPair],
      }),
    },
  );
  assert.equal(birthLowCapResolution.observed, 1);
  const birthLowCapEvents = await readLedger(ledgerPath);
  const birthLowCapScore = buildGeckoTerminalNewPoolBirthMarketCapFloorRemovedScorecard(
    birthLowCapEvents,
  );
  assert.equal(birthLowCapScore.eligibleLiveObservations, 1);
  assert.equal(birthLowCapScore.netWinRate, 1);
  assert.ok(birthLowCapScore.portfolioAverageCapacityReturnPct > 0);
  assert.ok(birthLowCapScore.stressPortfolioAverageCapacityReturnPct > 0);
  const tamperedBirthLowCap = structuredClone(birthLowCapEvents);
  const birthLowCapDiscoveryToTamper = tamperedBirthLowCap.find((event) => (
    event.id === birthLowCapWatch.discoveryEventId
  ));
  birthLowCapDiscoveryToTamper.candidates[0].birthQuote.marketCapUsd = 60_000;
  assert.deepEqual(
    buildGeckoTerminalNewPoolBirthMarketCapFloorRemovedScorecard(
      tamperedBirthLowCap,
    ).rejectionCounts,
    { "newborn-birth-quote-mismatch": 1 },
  );

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthCreatorBalance(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const creatorRegistration = await registerGeckoTerminalNewPoolBirthCreatorBalance(
    { ledgerPath },
    { now: new Date("2026-08-04T10:36:00.000Z") },
  );
  assert.equal(creatorRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthCreatorBalance(
    { ledgerPath },
    { now: new Date("2026-08-04T10:36:01.000Z") },
  )).status, "existing");

  const lowCreatorPool = poolRow({
    tokenAddress: "TokenLowCreator111111111111111111111111111",
    pairAddress: "PoolLowCreator1111111111111111111111111111",
    poolCreatedAt: "2026-08-04T10:39:00.000Z",
    marketCapUsd: 20_000,
  });
  const highCreatorPool = poolRow({
    tokenAddress: "TokenHighCreator11111111111111111111111111",
    pairAddress: "PoolHighCreator111111111111111111111111111",
    poolCreatedAt: "2026-08-04T10:39:05.000Z",
    marketCapUsd: 20_000,
  });
  const creatorWatchAt = new Date("2026-08-04T10:40:00.000Z");
  const creatorWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: creatorWatchAt,
      clock: () => creatorWatchAt,
      fetcher: fakeProvider({ newPoolRows: [lowCreatorPool, highCreatorPool] }),
    },
  );
  assert.equal(creatorWatch.watchedCandidates, 2);
  const lowCreatorPair = dexPair({
    tokenAddress: lowCreatorPool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: lowCreatorPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const highCreatorPair = dexPair({
    tokenAddress: highCreatorPool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: highCreatorPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  let rugCheckRequests = 0;
  const creatorCaptureAt = new Date("2026-08-04T10:40:10.000Z");
  const creatorCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: creatorWatchAt,
      captureClock: () => creatorCaptureAt,
      evidenceClock: () => new Date("2026-08-04T10:40:05.000Z"),
      fetcher: fakeProvider({ directPairs: [lowCreatorPair, highCreatorPair] }),
      rugCheckReader: async (tokenAddress) => {
        rugCheckRequests += 1;
        return {
          mint: tokenAddress,
          creatorBalance: tokenAddress === lowCreatorPair.baseToken.address ? 50 : 800,
          token: { supply: 1_000 },
          totalHolders: 100,
        };
      },
    },
  );
  assert.equal(creatorCapture.recordedForecasts, 2);
  assert.equal(rugCheckRequests, 2);
  const creatorOpenEvents = await readLedger(ledgerPath);
  const creatorForecasts = creatorOpenEvents.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && event.creatorBalanceChallengerRegistrationId === creatorRegistration.registrationId
  ));
  assert.equal(creatorForecasts.length, 2);
  assert.deepEqual(
    creatorForecasts.map((forecast) => forecast.creatorBalanceChallengerDecision).sort(),
    ["paper-cash", "paper-long"],
  );
  const creatorEvidence = creatorOpenEvents.filter((event) => (
    event.type === "geckoterminal-new-pool-creator-balance-snapshot"
  ));
  assert.equal(creatorEvidence.length, 2);
  assert.ok(creatorEvidence.every((event) => (
    event.aggregateOnly === true && event.rawIdentitiesRetained === false
  )));
  const openCreatorScore = buildGeckoTerminalNewPoolBirthCreatorBalanceScorecard(
    creatorOpenEvents,
  );
  assert.equal(openCreatorScore.candidateForecasts, 2);
  assert.equal(openCreatorScore.openForecasts, 2);
  assert.equal(openCreatorScore.eligibleLiveObservations, 0);

  const lowCreatorExitRow = poolRow({
    tokenAddress: lowCreatorPair.baseToken.address,
    pairAddress: lowCreatorPair.pairAddress,
    poolCreatedAt: lowCreatorPool.attributes.pool_created_at,
    priceUsd: 0.0002,
    liquidityUsd: 30_000,
    marketCapUsd: 40_000,
  });
  const highCreatorExitRow = poolRow({
    tokenAddress: highCreatorPair.baseToken.address,
    pairAddress: highCreatorPair.pairAddress,
    poolCreatedAt: highCreatorPool.attributes.pool_created_at,
    priceUsd: 0.00005,
    liquidityUsd: 15_000,
    marketCapUsd: 10_000,
  });
  const creatorResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T11:40:40.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [lowCreatorExitRow, highCreatorExitRow],
        directPairs: [
          dexPair({
            tokenAddress: lowCreatorPair.baseToken.address,
            pairAddress: lowCreatorPair.pairAddress,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
          }),
          dexPair({
            tokenAddress: highCreatorPair.baseToken.address,
            pairAddress: highCreatorPair.pairAddress,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
          }),
        ],
      }),
    },
  );
  assert.equal(creatorResolution.observed, 2);
  const creatorEvents = await readLedger(ledgerPath);
  const creatorScore = buildGeckoTerminalNewPoolBirthCreatorBalanceScorecard(creatorEvents);
  assert.equal(creatorScore.eligibleLiveObservations, 2);
  assert.equal(creatorScore.portfolioWeightedObservations, 2);
  assert.equal(creatorScore.independentHourlyFrames, 1);
  assert.equal(creatorScore.selectedRiseCalls, 1);
  assert.equal(creatorScore.selectedRisePrecision, 1);
  assert.equal(creatorScore.selectedNetWinRate, 1);
  assert.ok(creatorScore.portfolioAverageCapacityReturnPct > 0);
  assert.ok(creatorScore.pairedCapacityDeltaPct > 0);
  assert.equal(creatorScore.provisionalGate, false);
  const tamperedCreator = structuredClone(creatorEvents);
  const evidenceToTamper = tamperedCreator.find((event) => (
    event.type === "geckoterminal-new-pool-creator-balance-snapshot"
  ));
  evidenceToTamper.aggregate.creatorBalancePct = 99;
  assert.deepEqual(
    buildGeckoTerminalNewPoolBirthCreatorBalanceScorecard(tamperedCreator).rejectionCounts,
    { "missing-or-invalid-exact-mint-evidence": 1 },
  );

  const creatorOnlyBeforeLpPool = poolRow({
    tokenAddress: "TokenCreatorOnlyBeforeLp111111111111111111111",
    pairAddress: "PoolCreatorOnlyBeforeLp1111111111111111111111",
    poolCreatedAt: "2026-08-04T11:40:00.000Z",
    marketCapUsd: 20_000,
  });
  const creatorOnlyWatchAt = new Date("2026-08-04T11:41:00.000Z");
  const creatorOnlyWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: creatorOnlyWatchAt,
      clock: () => creatorOnlyWatchAt,
      fetcher: fakeProvider({ newPoolRows: [creatorOnlyBeforeLpPool] }),
    },
  );
  assert.equal(creatorOnlyWatch.watchedCandidates, 1);

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthLpProvider(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const lpRegistration = await registerGeckoTerminalNewPoolBirthLpProvider(
    { ledgerPath },
    { now: new Date("2026-08-04T11:41:50.000Z") },
  );
  assert.equal(lpRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthLpProvider(
    { ledgerPath },
    { now: new Date("2026-08-04T11:41:51.000Z") },
  )).status, "existing");
  const creatorOnlyCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: new Date("2026-08-04T11:42:00.000Z"),
      captureClock: () => new Date("2026-08-04T11:42:10.000Z"),
      evidenceClock: () => new Date("2026-08-04T11:42:05.000Z"),
      fetcher: fakeProvider({ directPairs: [] }),
      rugCheckReader: async (tokenAddress) => ({
        mint: tokenAddress,
        creatorBalance: 0,
        token: { supply: 1_000 },
        totalHolders: 20,
        totalLPProviders: 7,
      }),
    },
  );
  assert.equal(creatorOnlyCapture.recordedForecasts, 0);
  const creatorOnlyEvents = await readLedger(ledgerPath);
  const creatorOnlyToken = creatorOnlyBeforeLpPool.relationships.base_token.data.id
    .slice("solana_".length);
  assert.equal(creatorOnlyEvents.filter((event) => (
    event.type === "geckoterminal-new-pool-creator-balance-snapshot"
      && event.tokenAddress === creatorOnlyToken
  )).length, 1);
  assert.equal(creatorOnlyEvents.filter((event) => (
    event.type === "geckoterminal-new-pool-lp-provider-snapshot"
      && event.tokenAddress === creatorOnlyToken
  )).length, 0);

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthRugCheckPanel(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const rugCheckPanelRegistration = await registerGeckoTerminalNewPoolBirthRugCheckPanel(
    { ledgerPath },
    { now: new Date("2026-08-04T11:44:30.000Z") },
  );
  assert.equal(rugCheckPanelRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthRugCheckPanel(
    { ledgerPath },
    { now: new Date("2026-08-04T11:44:31.000Z") },
  )).status, "existing");

  const lpPresentPool = poolRow({
    tokenAddress: "TokenLpPresent1111111111111111111111111111",
    pairAddress: "PoolLpPresent11111111111111111111111111111",
    poolCreatedAt: "2026-08-04T11:45:00.000Z",
    marketCapUsd: 20_000,
  });
  const lpAbsentPool = poolRow({
    tokenAddress: "TokenLpAbsent11111111111111111111111111111",
    pairAddress: "PoolLpAbsent111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T11:45:05.000Z",
    marketCapUsd: 20_000,
  });
  const lpWatchAt = new Date("2026-08-04T11:46:00.000Z");
  const lpWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: lpWatchAt,
      clock: () => lpWatchAt,
      fetcher: fakeProvider({ newPoolRows: [lpPresentPool, lpAbsentPool] }),
    },
  );
  assert.equal(lpWatch.watchedCandidates, 2);
  const lpPresentPair = dexPair({
    tokenAddress: lpPresentPool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: lpPresentPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const lpAbsentPair = dexPair({
    tokenAddress: lpAbsentPool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: lpAbsentPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  let sharedRugCheckRequests = 0;
  const lpCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: lpWatchAt,
      captureClock: () => new Date("2026-08-04T11:46:10.000Z"),
      evidenceClock: () => new Date("2026-08-04T11:46:05.000Z"),
      fetcher: fakeProvider({ directPairs: [lpPresentPair, lpAbsentPair] }),
      rugCheckReader: async (tokenAddress) => {
        sharedRugCheckRequests += 1;
        return {
          mint: tokenAddress,
          creatorBalance: 0,
          token: { supply: 1_000 },
          totalHolders: 100,
          totalLPProviders: tokenAddress === lpPresentPair.baseToken.address ? 1 : 0,
          score_normalised: 12,
          rugged: false,
          risks: [{ level: "warn", name: "Synthetic warning" }],
          graphInsidersDetected: 0,
          markets: [{
            pubkey: tokenAddress === lpPresentPair.baseToken.address
              ? lpPresentPair.pairAddress : lpAbsentPair.pairAddress,
            lp: { lpLockedPct: 95, lpLockedUSD: 19_000 },
          }],
        };
      },
    },
  );
  assert.equal(lpCapture.recordedForecasts, 2);
  assert.equal(sharedRugCheckRequests, 2);
  const lpOpenEvents = await readLedger(ledgerPath);
  const lpForecasts = lpOpenEvents.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && event.lpProviderChallengerRegistrationId === lpRegistration.registrationId
  ));
  assert.equal(lpForecasts.length, 2);
  assert.deepEqual(
    lpForecasts.map((forecast) => forecast.lpProviderChallengerDecision).sort(),
    ["paper-cash", "paper-long"],
  );
  assert.equal(
    lpOpenEvents.filter((event) => (
      event.type === "geckoterminal-new-pool-lp-provider-snapshot"
    )).length,
    2,
  );
  const rugCheckRiskEvidence = lpOpenEvents.filter((event) => (
    event.type === "geckoterminal-new-pool-rugcheck-risk-snapshot"
  ));
  assert.equal(rugCheckRiskEvidence.length, 2);
  assert.ok(rugCheckRiskEvidence.every((event) => (
    event.registrationId === rugCheckPanelRegistration.registrationId
      && event.aggregateOnly === true
      && event.rawIdentitiesRetained === false
      && event.aggregate.coverage === "complete"
      && event.aggregate.normalizedRiskScore === 12
      && event.aggregate.warningRiskCount === 1
      && event.aggregate.mainPairLockedPct === 95
  )));
  const openLpScore = buildGeckoTerminalNewPoolBirthLpProviderScorecard(lpOpenEvents);
  assert.equal(openLpScore.candidateForecasts, 2);
  assert.equal(openLpScore.openForecasts, 2);
  const openRiskPanelScore = buildGeckoTerminalNewPoolBirthRugCheckPanelScorecard(
    lpOpenEvents,
  );
  assert.equal(openRiskPanelScore.candidateForecasts, 2);
  assert.equal(openRiskPanelScore.openForecasts, 2);
  assert.equal(openRiskPanelScore.eligibleLiveObservations, 0);
  assert.equal(openRiskPanelScore.provisionalGate, false);

  const lpResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T12:46:40.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [
          poolRow({
            tokenAddress: lpPresentPair.baseToken.address,
            pairAddress: lpPresentPair.pairAddress,
            poolCreatedAt: lpPresentPool.attributes.pool_created_at,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
            marketCapUsd: 40_000,
          }),
          poolRow({
            tokenAddress: lpAbsentPair.baseToken.address,
            pairAddress: lpAbsentPair.pairAddress,
            poolCreatedAt: lpAbsentPool.attributes.pool_created_at,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
            marketCapUsd: 10_000,
          }),
        ],
        directPairs: [
          dexPair({
            tokenAddress: lpPresentPair.baseToken.address,
            pairAddress: lpPresentPair.pairAddress,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
          }),
          dexPair({
            tokenAddress: lpAbsentPair.baseToken.address,
            pairAddress: lpAbsentPair.pairAddress,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
          }),
        ],
      }),
    },
  );
  assert.equal(lpResolution.observed, 2);
  const lpEvents = await readLedger(ledgerPath);
  const lpScore = buildGeckoTerminalNewPoolBirthLpProviderScorecard(lpEvents);
  assert.equal(lpScore.eligibleLiveObservations, 2);
  assert.equal(lpScore.selectedRiseCalls, 1);
  assert.equal(lpScore.selectedNetWinRate, 1);
  assert.ok(lpScore.portfolioAverageCapacityReturnPct > 0);
  assert.ok(lpScore.pairedCapacityDeltaPct > 0);
  assert.equal(lpScore.provisionalGate, false);
  const riskPanelScore = buildGeckoTerminalNewPoolBirthRugCheckPanelScorecard(lpEvents);
  assert.equal(riskPanelScore.candidateForecasts, 2);
  assert.equal(riskPanelScore.openForecasts, 0);
  assert.equal(riskPanelScore.eligibleLiveObservations, 2);
  assert.equal(riskPanelScore.completeEvidenceCount, 2);
  assert.equal(riskPanelScore.independentHourlyFrames, 1);
  assert.equal(riskPanelScore.overall.netWinRate, 0.5);
  assert.equal(riskPanelScore.provisionalGate, false);
  assert.deepEqual(
    riskPanelScore.featureSlices.find((slice) => (
      slice.field === "normalizedRiskScore" && slice.bucket === "00-20"
    )),
    {
      field: "normalizedRiskScore",
      bucket: "00-20",
      observations: 2,
      riseRate: 0.5,
      netWinRate: 0.5,
      averageGrossReturnPct: 25,
      averageBaseCapacityReturnPct: 18.310034,
      averageStressCapacityReturnPct: 10.310034,
      explosion25Count: 1,
      explosion50Count: 1,
      explosion100Count: 1,
      liquidityCollapseCount: 0,
    },
  );
  assert.equal(riskPanelScore.dangerNameSlices.length, 0);
  const tamperedRiskPanel = structuredClone(lpEvents);
  const riskEvidenceToTamper = tamperedRiskPanel.find((event) => (
    event.type === "geckoterminal-new-pool-rugcheck-risk-snapshot"
  ));
  riskEvidenceToTamper.aggregate.normalizedRiskScore = 99;
  assert.deepEqual(
    buildGeckoTerminalNewPoolBirthRugCheckPanelScorecard(
      tamperedRiskPanel,
    ).rejectionCounts,
    { "missing-or-invalid-panel-evidence": 1 },
  );
  const tamperedLp = structuredClone(lpEvents);
  const lpEvidenceToTamper = tamperedLp.find((event) => (
    event.type === "geckoterminal-new-pool-lp-provider-snapshot"
  ));
  lpEvidenceToTamper.aggregate.totalLpProviders = 99;
  assert.deepEqual(
    buildGeckoTerminalNewPoolBirthLpProviderScorecard(tamperedLp).rejectionCounts,
    { "missing-or-invalid-exact-mint-evidence": 1 },
  );

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthPairAge(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const pairAgeRegistration = await registerGeckoTerminalNewPoolBirthPairAge(
    { ledgerPath },
    { now: new Date("2026-08-04T14:00:00.000Z") },
  );
  assert.equal(pairAgeRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthPairAge(
    { ledgerPath },
    { now: new Date("2026-08-04T14:00:01.000Z") },
  )).status, "existing");

  const maturePairAgePool = poolRow({
    tokenAddress: "TokenPairAgeTwoMinutes1111111111111111111111",
    pairAddress: "PoolPairAgeTwoMinutes11111111111111111111111",
    poolCreatedAt: "2026-08-04T14:01:00.000Z",
    marketCapUsd: 20_000,
  });
  const youngPairAgePool = poolRow({
    tokenAddress: "TokenPairAgeOneMinute11111111111111111111111",
    pairAddress: "PoolPairAgeOneMinute111111111111111111111111",
    poolCreatedAt: "2026-08-04T14:02:00.000Z",
    marketCapUsd: 20_000,
  });
  const pairAgeWatchAt = new Date("2026-08-04T14:03:00.000Z");
  const pairAgeWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: pairAgeWatchAt,
      clock: () => pairAgeWatchAt,
      fetcher: fakeProvider({ newPoolRows: [maturePairAgePool, youngPairAgePool] }),
    },
  );
  assert.equal(pairAgeWatch.watchedCandidates, 2);
  const maturePairAgePair = dexPair({
    tokenAddress: maturePairAgePool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: maturePairAgePool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const youngPairAgePair = dexPair({
    tokenAddress: youngPairAgePool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: youngPairAgePool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const pairAgeCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: pairAgeWatchAt,
      captureClock: () => new Date("2026-08-04T14:03:10.000Z"),
      evidenceClock: () => new Date("2026-08-04T14:03:05.000Z"),
      fetcher: fakeProvider({ directPairs: [maturePairAgePair, youngPairAgePair] }),
      rugCheckReader: async (tokenAddress) => ({
        mint: tokenAddress,
        creatorBalance: 0,
        token: { supply: 1_000 },
        totalHolders: 100,
        totalLPProviders: 1,
        score_normalised: 10,
        rugged: false,
        risks: [],
        graphInsidersDetected: 0,
        markets: [],
      }),
    },
  );
  assert.equal(pairAgeCapture.recordedForecasts, 2);
  const pairAgeOpenEvents = await readLedger(ledgerPath);
  const pairAgeForecasts = pairAgeOpenEvents.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && event.pairAgeChallengerRegistrationId === pairAgeRegistration.registrationId
  ));
  assert.equal(pairAgeForecasts.length, 2);
  assert.deepEqual(
    pairAgeForecasts.map((forecast) => ({
      age: forecast.pairAgeMinutes,
      decision: forecast.pairAgeChallengerDecision,
    })).sort((left, right) => left.age - right.age),
    [
      { age: 1, decision: "paper-cash" },
      { age: 2, decision: "paper-long" },
    ],
  );
  const openPairAgeScore = buildGeckoTerminalNewPoolBirthPairAgeScorecard(
    pairAgeOpenEvents,
  );
  assert.equal(openPairAgeScore.candidateForecasts, 2);
  assert.equal(openPairAgeScore.openForecasts, 2);
  assert.equal(openPairAgeScore.eligibleLiveObservations, 0);

  const pairAgeResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T15:03:20.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [
          poolRow({
            tokenAddress: maturePairAgePair.baseToken.address,
            pairAddress: maturePairAgePair.pairAddress,
            poolCreatedAt: maturePairAgePool.attributes.pool_created_at,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
            marketCapUsd: 40_000,
          }),
          poolRow({
            tokenAddress: youngPairAgePair.baseToken.address,
            pairAddress: youngPairAgePair.pairAddress,
            poolCreatedAt: youngPairAgePool.attributes.pool_created_at,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
            marketCapUsd: 10_000,
          }),
        ],
        directPairs: [
          dexPair({
            tokenAddress: maturePairAgePair.baseToken.address,
            pairAddress: maturePairAgePair.pairAddress,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
          }),
          dexPair({
            tokenAddress: youngPairAgePair.baseToken.address,
            pairAddress: youngPairAgePair.pairAddress,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
          }),
        ],
      }),
    },
  );
  assert.equal(pairAgeResolution.observed, 2);
  const pairAgeEvents = await readLedger(ledgerPath);
  const pairAgeScore = buildGeckoTerminalNewPoolBirthPairAgeScorecard(pairAgeEvents);
  assert.equal(pairAgeScore.eligibleLiveObservations, 2);
  assert.equal(pairAgeScore.independentHourlyFrames, 1);
  assert.equal(pairAgeScore.selectedRiseCalls, 1);
  assert.equal(pairAgeScore.selectedRisePrecision, 1);
  assert.equal(pairAgeScore.selectedNetWinRate, 1);
  assert.ok(pairAgeScore.portfolioAverageCapacityReturnPct > 0);
  assert.ok(pairAgeScore.pairedCapacityDeltaPct > 0);
  assert.equal(pairAgeScore.provisionalGate, false);
  const tamperedPairAge = structuredClone(pairAgeEvents);
  const pairAgeForecastToTamper = tamperedPairAge.find((event) => (
    event.pairAgeChallengerRegistrationId === pairAgeRegistration.registrationId
  ));
  pairAgeForecastToTamper.pairAgeMinutes = 99;
  assert.deepEqual(
    buildGeckoTerminalNewPoolBirthPairAgeScorecard(tamperedPairAge).rejectionCounts,
    { "forecast-pair-age-decision-mismatch": 1 },
  );

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthTurnover(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_TURNOVER_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const turnoverRegistration = await registerGeckoTerminalNewPoolBirthTurnover(
    { ledgerPath },
    { now: new Date("2026-08-04T15:04:00.000Z") },
  );
  assert.equal(turnoverRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthTurnover(
    { ledgerPath },
    { now: new Date("2026-08-04T15:04:01.000Z") },
  )).status, "existing");

  const lowTurnoverPool = poolRow({
    tokenAddress: "TokenLowTurnover1111111111111111111111111111",
    pairAddress: "PoolLowTurnover11111111111111111111111111111",
    poolCreatedAt: "2026-08-04T15:04:00.000Z",
    marketCapUsd: 20_000,
    volumeM5Usd: 1_000,
  });
  const highTurnoverPool = poolRow({
    tokenAddress: "TokenHighTurnover111111111111111111111111111",
    pairAddress: "PoolHighTurnover1111111111111111111111111111",
    poolCreatedAt: "2026-08-04T15:05:00.000Z",
    marketCapUsd: 20_000,
    volumeM5Usd: 4_000,
  });
  const turnoverWatchAt = new Date("2026-08-04T15:06:00.000Z");
  const turnoverWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: turnoverWatchAt,
      clock: () => turnoverWatchAt,
      fetcher: fakeProvider({ newPoolRows: [lowTurnoverPool, highTurnoverPool] }),
    },
  );
  assert.equal(turnoverWatch.watchedCandidates, 2);
  const lowTurnoverPair = dexPair({
    tokenAddress: lowTurnoverPool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: lowTurnoverPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const highTurnoverPair = dexPair({
    tokenAddress: highTurnoverPool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: highTurnoverPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const turnoverCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: turnoverWatchAt,
      captureClock: () => new Date("2026-08-04T15:06:10.000Z"),
      evidenceClock: () => new Date("2026-08-04T15:06:05.000Z"),
      fetcher: fakeProvider({ directPairs: [lowTurnoverPair, highTurnoverPair] }),
      rugCheckReader: async (tokenAddress) => ({
        mint: tokenAddress,
        creatorBalance: 0,
        token: { supply: 1_000 },
        totalHolders: 100,
        totalLPProviders: 1,
        score_normalised: 10,
        rugged: false,
        risks: [],
        graphInsidersDetected: 0,
        markets: [],
      }),
    },
  );
  assert.equal(turnoverCapture.recordedForecasts, 2);
  const turnoverOpenEvents = await readLedger(ledgerPath);
  const turnoverForecasts = turnoverOpenEvents.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && event.turnoverChallengerRegistrationId === turnoverRegistration.registrationId
  ));
  assert.equal(turnoverForecasts.length, 2);
  assert.deepEqual(
    turnoverForecasts.map((forecast) => ({
      turnover: forecast.fiveMinuteTurnover,
      decision: forecast.turnoverChallengerDecision,
    })).sort((left, right) => left.turnover - right.turnover),
    [
      { turnover: 0.05, decision: "paper-long" },
      { turnover: 0.2, decision: "paper-cash" },
    ],
  );
  const openTurnoverScore = buildGeckoTerminalNewPoolBirthTurnoverScorecard(
    turnoverOpenEvents,
  );
  assert.equal(openTurnoverScore.candidateForecasts, 2);
  assert.equal(openTurnoverScore.openForecasts, 2);
  assert.equal(openTurnoverScore.eligibleLiveObservations, 0);

  const turnoverResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T16:06:20.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [
          poolRow({
            tokenAddress: lowTurnoverPair.baseToken.address,
            pairAddress: lowTurnoverPair.pairAddress,
            poolCreatedAt: lowTurnoverPool.attributes.pool_created_at,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
            marketCapUsd: 40_000,
          }),
          poolRow({
            tokenAddress: highTurnoverPair.baseToken.address,
            pairAddress: highTurnoverPair.pairAddress,
            poolCreatedAt: highTurnoverPool.attributes.pool_created_at,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
            marketCapUsd: 10_000,
          }),
        ],
        directPairs: [
          dexPair({
            tokenAddress: lowTurnoverPair.baseToken.address,
            pairAddress: lowTurnoverPair.pairAddress,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
          }),
          dexPair({
            tokenAddress: highTurnoverPair.baseToken.address,
            pairAddress: highTurnoverPair.pairAddress,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
          }),
        ],
      }),
    },
  );
  assert.equal(turnoverResolution.observed, 2);
  const turnoverEvents = await readLedger(ledgerPath);
  const turnoverScore = buildGeckoTerminalNewPoolBirthTurnoverScorecard(turnoverEvents);
  assert.equal(turnoverScore.eligibleLiveObservations, 2);
  assert.equal(turnoverScore.independentHourlyFrames, 1);
  assert.equal(turnoverScore.selectedRiseCalls, 1);
  assert.equal(turnoverScore.selectedRisePrecision, 1);
  assert.equal(turnoverScore.selectedNetWinRate, 1);
  assert.ok(turnoverScore.portfolioAverageCapacityReturnPct > 0);
  assert.ok(turnoverScore.pairedCapacityDeltaPct > 0);
  assert.equal(turnoverScore.provisionalGate, false);
  const tamperedTurnover = structuredClone(turnoverEvents);
  const turnoverForecastToTamper = tamperedTurnover.find((event) => (
    event.turnoverChallengerRegistrationId === turnoverRegistration.registrationId
  ));
  turnoverForecastToTamper.fiveMinuteTurnover = 99;
  assert.deepEqual(
    buildGeckoTerminalNewPoolBirthTurnoverScorecard(tamperedTurnover).rejectionCounts,
    { "forecast-turnover-decision-mismatch": 1 },
  );

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthSocialPresence(
      { ledgerPath },
      { now: new Date(
        GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE.evidenceBoundary,
      ) },
    ),
    /strictly after its evidence boundary/,
  );
  const socialPresenceRegistration =
    await registerGeckoTerminalNewPoolBirthSocialPresence(
      { ledgerPath },
      { now: new Date("2026-08-04T17:00:00.000Z") },
    );
  assert.equal(socialPresenceRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthSocialPresence(
    { ledgerPath },
    { now: new Date("2026-08-04T17:00:01.000Z") },
  )).status, "existing");

  const socialRichPool = poolRow({
    tokenAddress: "TokenSocialRich11111111111111111111111111111",
    pairAddress: "PoolSocialRich111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T17:01:00.000Z",
    marketCapUsd: 20_000,
  });
  const socialBarePool = poolRow({
    tokenAddress: "TokenSocialBare11111111111111111111111111111",
    pairAddress: "PoolSocialBare111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T17:02:00.000Z",
    marketCapUsd: 20_000,
  });
  const socialWatchAt = new Date("2026-08-04T17:03:00.000Z");
  const socialWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: socialWatchAt,
      clock: () => socialWatchAt,
      fetcher: fakeProvider({ newPoolRows: [socialRichPool, socialBarePool] }),
    },
  );
  assert.equal(socialWatch.watchedCandidates, 2);
  const socialRichPair = dexPair({
    tokenAddress: socialRichPool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: socialRichPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
    info: {
      websites: [{ url: "https://example.invalid" }, { url: "https://docs.invalid" }],
      socials: [
        { platform: "twitter", handle: "must-not-be-retained" },
        { platform: "telegram", handle: "must-not-be-retained" },
        { platform: "discord", handle: "must-not-be-retained" },
        { platform: "unknown-network", handle: "must-not-be-retained" },
      ],
    },
  });
  const socialBarePair = dexPair({
    tokenAddress: socialBarePool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: socialBarePool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const socialCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: socialWatchAt,
      captureClock: () => new Date("2026-08-04T17:03:10.000Z"),
      evidenceClock: () => new Date("2026-08-04T17:03:05.000Z"),
      fetcher: fakeProvider({ directPairs: [socialRichPair, socialBarePair] }),
      rugCheckReader: async (tokenAddress) => ({
        mint: tokenAddress,
        creatorBalance: 0,
        token: { supply: 1_000 },
        totalHolders: 100,
        totalLPProviders: 1,
        score_normalised: 10,
        rugged: false,
        risks: [],
        graphInsidersDetected: 0,
        markets: [],
      }),
    },
  );
  assert.equal(socialCapture.recordedForecasts, 2);
  const socialOpenEvents = await readLedger(ledgerPath);
  const socialForecasts = socialOpenEvents.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && event.socialPresenceObservationRegistrationId
        === socialPresenceRegistration.registrationId
  ));
  assert.equal(socialForecasts.length, 2);
  const richSocialForecast = socialForecasts.find((forecast) => (
    forecast.tokenAddress === socialRichPair.baseToken.address
  ));
  assert.deepEqual(richSocialForecast.socialPresenceAggregate, {
    infoPresent: true,
    websiteCount: 2,
    socialCount: 4,
    retainedPlatformCount: 3,
    unrecognizedPlatformCount: 1,
    hasWebsite: true,
    hasAnySocial: true,
    hasTwitter: true,
    hasTelegram: true,
    hasDiscord: true,
    hasYoutube: false,
    hasTiktok: false,
    hasInstagram: false,
    hasReddit: false,
  });
  assert.equal(richSocialForecast.socialPresenceRawLinksRetained, false);
  assert.ok(!JSON.stringify(richSocialForecast.socialPresenceAggregate)
    .includes("must-not-be-retained"));
  const bareSocialForecast = socialForecasts.find((forecast) => (
    forecast.tokenAddress === socialBarePair.baseToken.address
  ));
  assert.equal(bareSocialForecast.socialPresenceAggregate.infoPresent, false);
  assert.equal(bareSocialForecast.socialPresenceAggregate.socialCount, 0);
  const openSocialScore = buildGeckoTerminalNewPoolBirthSocialPresenceScorecard(
    socialOpenEvents,
  );
  assert.equal(openSocialScore.candidateForecasts, 2);
  assert.equal(openSocialScore.openForecasts, 2);
  assert.equal(openSocialScore.eligibleLiveObservations, 0);
  assert.equal(openSocialScore.decisionAuthority, false);
  assert.equal(openSocialScore.promotionAuthority, false);

  const socialResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T18:03:20.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [
          poolRow({
            tokenAddress: socialRichPair.baseToken.address,
            pairAddress: socialRichPair.pairAddress,
            poolCreatedAt: socialRichPool.attributes.pool_created_at,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
            marketCapUsd: 40_000,
          }),
          poolRow({
            tokenAddress: socialBarePair.baseToken.address,
            pairAddress: socialBarePair.pairAddress,
            poolCreatedAt: socialBarePool.attributes.pool_created_at,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
            marketCapUsd: 10_000,
          }),
        ],
        directPairs: [
          dexPair({
            tokenAddress: socialRichPair.baseToken.address,
            pairAddress: socialRichPair.pairAddress,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
          }),
          dexPair({
            tokenAddress: socialBarePair.baseToken.address,
            pairAddress: socialBarePair.pairAddress,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
          }),
        ],
      }),
    },
  );
  assert.equal(socialResolution.observed, 2);
  const socialEvents = await readLedger(ledgerPath);
  const socialScore = buildGeckoTerminalNewPoolBirthSocialPresenceScorecard(socialEvents);
  assert.equal(socialScore.eligibleLiveObservations, 2);
  assert.equal(socialScore.independentHourlyFrames, 1);
  assert.equal(socialScore.overall.netWinRate, 0.5);
  assert.equal(socialScore.provisionalGate, false);
  assert.equal(
    socialScore.featureSlices.find((slice) => (
      slice.field === "hasAnySocial" && slice.bucket === "true"
    )).netWinRate,
    1,
  );
  assert.equal(
    socialScore.featureSlices.find((slice) => (
      slice.field === "hasAnySocial" && slice.bucket === "false"
    )).netWinRate,
    0,
  );
  const tamperedSocial = structuredClone(socialEvents);
  const socialForecastToTamper = tamperedSocial.find((event) => (
    event.socialPresenceObservationRegistrationId
      === socialPresenceRegistration.registrationId
  ));
  socialForecastToTamper.socialPresenceAggregate.socialCount = 20;
  assert.deepEqual(
    buildGeckoTerminalNewPoolBirthSocialPresenceScorecard(tamperedSocial).rejectionCounts,
    { "forecast-social-presence-lineage-mismatch": 1 },
  );

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthDangerCount(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_DANGER_COUNT_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const dangerCountRegistration = await registerGeckoTerminalNewPoolBirthDangerCount(
    { ledgerPath },
    { now: new Date("2026-08-04T19:00:00.000Z") },
  );
  assert.equal(dangerCountRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthDangerCount(
    { ledgerPath },
    { now: new Date("2026-08-04T19:00:01.000Z") },
  )).status, "existing");

  const preRegistrationDangerPool = poolRow({
    tokenAddress: "TokenDangerPreRegistration111111111111111111111",
    pairAddress: "PoolDangerPreRegistration1111111111111111111111",
    poolCreatedAt: "2026-08-04T18:59:30.000Z",
    marketCapUsd: 20_000,
  });
  const preRegistrationDangerPair = dexPair({
    tokenAddress: preRegistrationDangerPool.relationships.base_token.data.id
      .slice("solana_".length),
    pairAddress: preRegistrationDangerPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const preRegistrationDangerWatchAt = new Date("2026-08-04T19:00:30.000Z");
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: preRegistrationDangerWatchAt,
      clock: () => preRegistrationDangerWatchAt,
      fetcher: fakeProvider({ newPoolRows: [preRegistrationDangerPool] }),
    },
  );
  const preRegistrationDangerCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: preRegistrationDangerWatchAt,
      captureClock: () => new Date("2026-08-04T19:00:40.000Z"),
      evidenceClock: () => new Date("2026-08-04T19:00:35.000Z"),
      fetcher: fakeProvider({ directPairs: [preRegistrationDangerPair] }),
      rugCheckReader: async (tokenAddress) => ({
        mint: tokenAddress,
        creatorBalance: 0,
        token: { supply: 1_000 },
        totalHolders: 100,
        totalLPProviders: 1,
        score_normalised: 50,
        rugged: false,
        risks: [{ level: "danger", name: "Synthetic danger" }],
        graphInsidersDetected: 0,
        markets: [],
      }),
    },
  );
  assert.equal(preRegistrationDangerCapture.recordedForecasts, 1);
  assert.equal(
    preRegistrationDangerCapture.forecasts[0].dangerCountChallengerRegistrationId,
    undefined,
  );

  const selectedDangerPool = poolRow({
    tokenAddress: "TokenDangerCountOne11111111111111111111111111",
    pairAddress: "PoolDangerCountOne111111111111111111111111111",
    poolCreatedAt: "2026-08-04T19:04:00.000Z",
    marketCapUsd: 20_000,
  });
  const rejectedDangerPool = poolRow({
    tokenAddress: "TokenDangerCountThree111111111111111111111111",
    pairAddress: "PoolDangerCountThree11111111111111111111111111",
    poolCreatedAt: "2026-08-04T19:05:00.000Z",
    marketCapUsd: 20_000,
  });
  const dangerWatchAt = new Date("2026-08-04T19:06:00.000Z");
  const dangerWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: dangerWatchAt,
      clock: () => dangerWatchAt,
      fetcher: fakeProvider({ newPoolRows: [selectedDangerPool, rejectedDangerPool] }),
    },
  );
  assert.equal(dangerWatch.watchedCandidates, 2);
  const selectedDangerPair = dexPair({
    tokenAddress: selectedDangerPool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: selectedDangerPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const rejectedDangerPair = dexPair({
    tokenAddress: rejectedDangerPool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: rejectedDangerPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const dangerCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: dangerWatchAt,
      captureClock: () => new Date("2026-08-04T19:06:10.000Z"),
      evidenceClock: () => new Date("2026-08-04T19:06:05.000Z"),
      fetcher: fakeProvider({ directPairs: [selectedDangerPair, rejectedDangerPair] }),
      rugCheckReader: async (tokenAddress) => ({
        mint: tokenAddress,
        creatorBalance: 0,
        token: { supply: 1_000 },
        totalHolders: 100,
        totalLPProviders: 1,
        score_normalised: 50,
        rugged: false,
        risks: Array.from({
          length: tokenAddress === selectedDangerPair.baseToken.address ? 1 : 3,
        }, (_, index) => ({ level: "danger", name: `Synthetic danger ${index}` })),
        graphInsidersDetected: 0,
        markets: [],
      }),
    },
  );
  assert.equal(dangerCapture.recordedForecasts, 2);
  const dangerOpenEvents = await readLedger(ledgerPath);
  const dangerForecasts = dangerOpenEvents.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && event.dangerCountChallengerRegistrationId
        === dangerCountRegistration.registrationId
  ));
  assert.equal(dangerForecasts.length, 2);
  assert.deepEqual(
    dangerForecasts.map((forecast) => ({
      dangerRiskCount: forecast.dangerRiskCount,
      decision: forecast.dangerCountChallengerDecision,
    })).sort((left, right) => left.dangerRiskCount - right.dangerRiskCount),
    [
      { dangerRiskCount: 1, decision: "paper-long" },
      { dangerRiskCount: 3, decision: "paper-cash" },
    ],
  );
  const openDangerScore = buildGeckoTerminalNewPoolBirthDangerCountScorecard(
    dangerOpenEvents,
  );
  assert.equal(openDangerScore.candidateForecasts, 2);
  assert.equal(openDangerScore.openForecasts, 2);
  assert.equal(openDangerScore.eligibleLiveObservations, 0);

  const preRegistrationDangerResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T20:00:45.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [poolRow({
          tokenAddress: preRegistrationDangerPair.baseToken.address,
          pairAddress: preRegistrationDangerPair.pairAddress,
          poolCreatedAt: preRegistrationDangerPool.attributes.pool_created_at,
          priceUsd: 0.0001,
          liquidityUsd: 20_000,
          marketCapUsd: 20_000,
        })],
        directPairs: [dexPair({
          tokenAddress: preRegistrationDangerPair.baseToken.address,
          pairAddress: preRegistrationDangerPair.pairAddress,
          priceUsd: 0.0001,
          liquidityUsd: 20_000,
        })],
      }),
    },
  );
  assert.equal(preRegistrationDangerResolution.observed, 1);

  const dangerResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T20:06:20.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [
          poolRow({
            tokenAddress: preRegistrationDangerPair.baseToken.address,
            pairAddress: preRegistrationDangerPair.pairAddress,
            poolCreatedAt: preRegistrationDangerPool.attributes.pool_created_at,
            priceUsd: 0.0001,
            liquidityUsd: 20_000,
            marketCapUsd: 20_000,
          }),
          poolRow({
            tokenAddress: selectedDangerPair.baseToken.address,
            pairAddress: selectedDangerPair.pairAddress,
            poolCreatedAt: selectedDangerPool.attributes.pool_created_at,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
            marketCapUsd: 40_000,
          }),
          poolRow({
            tokenAddress: rejectedDangerPair.baseToken.address,
            pairAddress: rejectedDangerPair.pairAddress,
            poolCreatedAt: rejectedDangerPool.attributes.pool_created_at,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
            marketCapUsd: 10_000,
          }),
        ],
        directPairs: [
          dexPair({
            tokenAddress: preRegistrationDangerPair.baseToken.address,
            pairAddress: preRegistrationDangerPair.pairAddress,
            priceUsd: 0.0001,
            liquidityUsd: 20_000,
          }),
          dexPair({
            tokenAddress: selectedDangerPair.baseToken.address,
            pairAddress: selectedDangerPair.pairAddress,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
          }),
          dexPair({
            tokenAddress: rejectedDangerPair.baseToken.address,
            pairAddress: rejectedDangerPair.pairAddress,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
          }),
        ],
      }),
    },
  );
  assert.equal(dangerResolution.observed, 2);
  const dangerEvents = await readLedger(ledgerPath);
  const dangerScore = buildGeckoTerminalNewPoolBirthDangerCountScorecard(dangerEvents);
  assert.equal(dangerScore.eligibleLiveObservations, 2);
  assert.equal(dangerScore.independentHourlyFrames, 1);
  assert.equal(dangerScore.selectedRiseCalls, 1);
  assert.equal(dangerScore.selectedRisePrecision, 1);
  assert.equal(dangerScore.selectedNetWinRate, 1);
  assert.equal(dangerScore.completeEvidenceCount, 2);
  assert.deepEqual(dangerScore.rejectionCounts, { "not-captured-under-policy": 1 });
  assert.ok(dangerScore.portfolioAverageCapacityReturnPct > 0);
  assert.ok(dangerScore.pairedCapacityDeltaPct > 0);
  assert.equal(dangerScore.provisionalGate, false);
  const tamperedDanger = structuredClone(dangerEvents);
  const dangerForecastToTamper = tamperedDanger.find((event) => (
    event.dangerCountChallengerRegistrationId === dangerCountRegistration.registrationId
  ));
  const dangerEvidenceToTamper = tamperedDanger.find((event) => (
    event.id === dangerForecastToTamper.dangerCountEvidenceId
  ));
  dangerEvidenceToTamper.aggregate.dangerRiskCount = 99;
  assert.deepEqual(
    buildGeckoTerminalNewPoolBirthDangerCountScorecard(tamperedDanger).rejectionCounts,
    {
      "not-captured-under-policy": 1,
      "missing-or-invalid-panel-evidence": 1,
    },
  );

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthJupiterRoundTrip(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const jupiterRegistration = await registerGeckoTerminalNewPoolBirthJupiterRoundTrip(
    { ledgerPath },
    { now: new Date("2026-08-04T21:00:00.000Z") },
  );
  assert.equal(jupiterRegistration.status, "registered");
  const repeatedJupiterRegistration = await registerGeckoTerminalNewPoolBirthJupiterRoundTrip(
    { ledgerPath },
    { now: new Date("2026-08-04T21:00:10.000Z") },
  );
  assert.equal(repeatedJupiterRegistration.status, "existing");

  const quotedJupiter = await readJupiterExactInQuote({
    inputMint: GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE.inputMint,
    outputMint: "TokenJupiterQuote111111111111111111111111111",
    amountAtomic: "100000000",
    fetcher: async (url) => {
      assert.equal(url.searchParams.get("amount"), "100000000");
      assert.equal(url.searchParams.get("slippageBps"), "100");
      assert.equal(url.searchParams.get("swapMode"), "ExactIn");
      assert.equal(url.searchParams.get("restrictIntermediateTokens"), "true");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          outAmount: "123456",
          priceImpactPct: "0.1",
          swapUsdValue: "99.9",
          routePlan: [{}, {}],
        }),
      };
    },
  });
  assert.deepEqual(quotedJupiter, {
    status: "quoted",
    outputAmountAtomic: "123456",
    priceImpactPct: 0.1,
    swapUsdValue: 99.9,
    routeHopCount: 2,
  });
  assert.deepEqual(await readJupiterExactInQuote({
    inputMint: GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE.inputMint,
    outputMint: "TokenJupiterNoRoute1111111111111111111111111",
    amountAtomic: "100000000",
    fetcher: async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: "The token is not tradable",
        errorCode: "TOKEN_NOT_TRADABLE",
      }),
    }),
  }), { status: "no-route" });

  const preJupiterPool = poolRow({
    tokenAddress: "TokenJupiterPreRegistration111111111111111111111",
    pairAddress: "PoolJupiterPreRegistration1111111111111111111111",
    poolCreatedAt: "2026-08-04T20:59:30.000Z",
    marketCapUsd: 20_000,
  });
  const preJupiterWatchAt = new Date("2026-08-04T21:00:30.000Z");
  const preJupiterWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: preJupiterWatchAt,
      clock: () => preJupiterWatchAt,
      fetcher: fakeProvider({ newPoolRows: [preJupiterPool] }),
    },
  );
  assert.equal(preJupiterWatch.watchedCandidates, 1);
  const preJupiterPair = dexPair({
    tokenAddress: preJupiterPool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: preJupiterPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  let preJupiterQuoteRequests = 0;
  const preJupiterCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: preJupiterWatchAt,
      captureClock: () => new Date("2026-08-04T21:00:40.000Z"),
      evidenceClock: () => new Date("2026-08-04T21:00:35.000Z"),
      jupiterEvidenceClock: () => new Date("2026-08-04T21:00:36.000Z"),
      fetcher: fakeProvider({ directPairs: [preJupiterPair] }),
      rugCheckReader: async (tokenAddress) => ({
        mint: tokenAddress,
        creatorBalance: 0,
        token: { supply: 1_000 },
        totalHolders: 100,
        totalLPProviders: 1,
        score_normalised: 50,
        rugged: false,
        risks: [{ level: "danger", name: "Synthetic danger" }],
        graphInsidersDetected: 0,
        markets: [],
      }),
      jupiterQuoteReader: async () => {
        preJupiterQuoteRequests += 1;
        return { status: "no-route" };
      },
    },
  );
  assert.equal(preJupiterCapture.recordedForecasts, 1);
  assert.equal(preJupiterQuoteRequests, 0);

  const quotedRoundTripPool = poolRow({
    tokenAddress: "TokenJupiterQuotedRoundTrip111111111111111111111",
    pairAddress: "PoolJupiterQuotedRoundTrip1111111111111111111111",
    poolCreatedAt: "2026-08-04T21:03:00.000Z",
    marketCapUsd: 20_000,
  });
  const noSellRoutePool = poolRow({
    tokenAddress: "TokenJupiterNoSellRoute11111111111111111111111",
    pairAddress: "PoolJupiterNoSellRoute111111111111111111111111",
    poolCreatedAt: "2026-08-04T21:04:00.000Z",
    marketCapUsd: 20_000,
  });
  const jupiterWatchAt = new Date("2026-08-04T21:05:00.000Z");
  const jupiterWatch = await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: jupiterWatchAt,
      clock: () => jupiterWatchAt,
      fetcher: fakeProvider({ newPoolRows: [quotedRoundTripPool, noSellRoutePool] }),
    },
  );
  assert.equal(jupiterWatch.watchedCandidates, 2);
  const quotedRoundTripPair = dexPair({
    tokenAddress: quotedRoundTripPool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: quotedRoundTripPool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const noSellRoutePair = dexPair({
    tokenAddress: noSellRoutePool.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: noSellRoutePool.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const jupiterQuoteRequests = [];
  const jupiterCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: jupiterWatchAt,
      captureClock: () => new Date("2026-08-04T21:05:10.000Z"),
      evidenceClock: () => new Date("2026-08-04T21:05:04.000Z"),
      jupiterEvidenceClock: () => new Date("2026-08-04T21:05:05.000Z"),
      fetcher: fakeProvider({ directPairs: [quotedRoundTripPair, noSellRoutePair] }),
      rugCheckReader: async (tokenAddress) => ({
        mint: tokenAddress,
        creatorBalance: 0,
        token: { supply: 1_000 },
        totalHolders: 100,
        totalLPProviders: 1,
        score_normalised: 50,
        rugged: false,
        risks: [{ level: "danger", name: "Synthetic danger" }],
        graphInsidersDetected: 0,
        markets: [],
      }),
      jupiterQuoteReader: async ({ inputMint, outputMint, amountAtomic }) => {
        jupiterQuoteRequests.push({ inputMint, outputMint, amountAtomic });
        const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE;
        if (inputMint === rule.inputMint) {
          assert.equal(amountAtomic, "100000000");
          assert.ok([
            quotedRoundTripPair.baseToken.address,
            noSellRoutePair.baseToken.address,
          ].includes(outputMint));
          return {
            status: "quoted",
            outputAmountAtomic: "1000000",
            priceImpactPct: 0.01,
            swapUsdValue: 100,
            routeHopCount: 1,
          };
        }
        assert.equal(outputMint, rule.inputMint);
        assert.equal(amountAtomic, "1000000");
        if (inputMint === noSellRoutePair.baseToken.address) return { status: "no-route" };
        assert.equal(inputMint, quotedRoundTripPair.baseToken.address);
        return {
          status: "quoted",
          outputAmountAtomic: "95000000",
          priceImpactPct: 0.02,
          swapUsdValue: 95,
          routeHopCount: 2,
        };
      },
    },
  );
  assert.equal(jupiterCapture.recordedForecasts, 2);
  assert.equal(jupiterQuoteRequests.length, 4);
  const jupiterOpenEvents = await readLedger(ledgerPath);
  const jupiterEvidence = jupiterOpenEvents.filter((event) => (
    event.type === "geckoterminal-new-pool-jupiter-roundtrip-snapshot"
      && event.registrationId === jupiterRegistration.registrationId
  ));
  assert.equal(jupiterEvidence.length, 2);
  assert.ok(jupiterEvidence.every((event) => (
    event.aggregateOnly === true && event.rawRoutesRetained === false
  )));
  assert.deepEqual(jupiterEvidence.map((event) => ({
    status: event.aggregate.status,
    roundTripReturnPct: event.aggregate.roundTripReturnPct,
  })).sort((left, right) => left.status.localeCompare(right.status)), [
    { status: "no-sell-route", roundTripReturnPct: null },
    { status: "round-trip-quoted", roundTripReturnPct: -5 },
  ]);
  const openJupiterScore = buildGeckoTerminalNewPoolBirthJupiterRoundTripScorecard(
    jupiterOpenEvents,
  );
  assert.equal(openJupiterScore.futureParentForecasts, 3);
  assert.equal(openJupiterScore.candidateForecasts, 2);
  assert.equal(openJupiterScore.openForecasts, 2);
  assert.equal(openJupiterScore.eligibleLiveObservations, 0);
  assert.deepEqual(openJupiterScore.rejectionCounts, { "missing-panel-evidence": 1 });
  assert.equal(openJupiterScore.provisionalGate, false);

  const jupiterResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath },
    {
      now: new Date("2026-08-04T22:05:20.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [
          poolRow({
            tokenAddress: preJupiterPair.baseToken.address,
            pairAddress: preJupiterPair.pairAddress,
            poolCreatedAt: preJupiterPool.attributes.pool_created_at,
            priceUsd: 0.0001,
            liquidityUsd: 20_000,
            marketCapUsd: 20_000,
          }),
          poolRow({
            tokenAddress: quotedRoundTripPair.baseToken.address,
            pairAddress: quotedRoundTripPair.pairAddress,
            poolCreatedAt: quotedRoundTripPool.attributes.pool_created_at,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
            marketCapUsd: 40_000,
          }),
          poolRow({
            tokenAddress: noSellRoutePair.baseToken.address,
            pairAddress: noSellRoutePair.pairAddress,
            poolCreatedAt: noSellRoutePool.attributes.pool_created_at,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
            marketCapUsd: 10_000,
          }),
        ],
        directPairs: [
          dexPair({
            tokenAddress: preJupiterPair.baseToken.address,
            pairAddress: preJupiterPair.pairAddress,
            priceUsd: 0.0001,
            liquidityUsd: 20_000,
          }),
          dexPair({
            tokenAddress: quotedRoundTripPair.baseToken.address,
            pairAddress: quotedRoundTripPair.pairAddress,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
          }),
          dexPair({
            tokenAddress: noSellRoutePair.baseToken.address,
            pairAddress: noSellRoutePair.pairAddress,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
          }),
        ],
      }),
    },
  );
  assert.equal(jupiterResolution.observed, 3);
  const jupiterEvents = await readLedger(ledgerPath);
  const jupiterScore = buildGeckoTerminalNewPoolBirthJupiterRoundTripScorecard(jupiterEvents);
  assert.equal(jupiterScore.eligibleLiveObservations, 2);
  assert.equal(jupiterScore.independentHourlyFrames, 1);
  assert.equal(jupiterScore.completeEvidenceCount, 2);
  assert.equal(jupiterScore.roundTripQuotedCount, 1);
  assert.equal(jupiterScore.noSellRouteCount, 1);
  assert.equal(jupiterScore.providerUnavailableCount, 0);
  assert.equal(jupiterScore.overall.riseRate, 0.5);
  assert.equal(jupiterScore.provisionalGate, false);
  assert.deepEqual(jupiterScore.rejectionCounts, { "missing-panel-evidence": 1 });
  const statusSlices = jupiterScore.featureSlices.filter((slice) => slice.field === "status");
  assert.deepEqual(statusSlices.map((slice) => ({
    bucket: slice.bucket,
    averageGrossReturnPct: slice.averageGrossReturnPct,
  })), [
    { bucket: "no-sell-route", averageGrossReturnPct: -50 },
    { bucket: "round-trip-quoted", averageGrossReturnPct: 100 },
  ]);
  const tamperedJupiter = structuredClone(jupiterEvents);
  const jupiterEvidenceToTamper = tamperedJupiter.find((event) => (
    event.type === "geckoterminal-new-pool-jupiter-roundtrip-snapshot"
      && event.aggregate.status === "round-trip-quoted"
  ));
  jupiterEvidenceToTamper.aggregate.roundTripReturnPct = 0;
  assert.deepEqual(
    buildGeckoTerminalNewPoolBirthJupiterRoundTripScorecard(
      tamperedJupiter,
    ).rejectionCounts,
    {
      "missing-panel-evidence": 1,
      "missing-or-invalid-panel-evidence": 1,
    },
  );

  await assert.rejects(
    registerGeckoTerminalNewPoolBirthJupiterExecutable(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const jupiterExecutableRegistration =
    await registerGeckoTerminalNewPoolBirthJupiterExecutable(
      { ledgerPath },
      { now: new Date("2026-08-04T23:00:00.000Z") },
    );
  assert.equal(jupiterExecutableRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthJupiterExecutable(
    { ledgerPath },
    { now: new Date("2026-08-04T23:00:10.000Z") },
  )).status, "existing");

  const preExecutablePool = poolRow({
    tokenAddress: "TokenJupiterExecutablePreReg1111111111111111111",
    pairAddress: "PoolJupiterExecutablePreReg11111111111111111111",
    poolCreatedAt: "2026-08-04T22:59:30.000Z",
    marketCapUsd: 20_000,
  });
  const preExecutableAt = new Date("2026-08-04T23:00:30.000Z");
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: preExecutableAt,
      clock: () => preExecutableAt,
      fetcher: fakeProvider({ newPoolRows: [preExecutablePool] }),
    },
  );
  const preExecutableCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: preExecutableAt,
      captureClock: () => new Date("2026-08-04T23:00:40.000Z"),
      evidenceClock: () => new Date("2026-08-04T23:00:35.000Z"),
      jupiterEvidenceClock: () => new Date("2026-08-04T23:00:36.000Z"),
      jupiterExecutableClock: () => new Date("2026-08-04T23:00:37.000Z"),
      fetcher: fakeProvider({
        directPairs: [dexPair({
          tokenAddress: preExecutablePool.relationships.base_token.data.id.slice("solana_".length),
          pairAddress: preExecutablePool.attributes.address,
          priceUsd: 0.0001,
          liquidityUsd: 20_000,
        })],
      }),
      rugCheckReader: completeRugCheck,
      jupiterQuoteReader: async () => ({ status: "no-route" }),
    },
  );
  assert.equal(preExecutableCapture.recordedJupiterExecutableDecisions, 0);

  const executableLongPool = poolRow({
    tokenAddress: "TokenJupiterExecutableLong111111111111111111111",
    pairAddress: "PoolJupiterExecutableLong1111111111111111111111",
    poolCreatedAt: "2026-08-04T23:03:00.000Z",
    marketCapUsd: 20_000,
  });
  const executableCashPool = poolRow({
    tokenAddress: "TokenJupiterExecutableCash111111111111111111111",
    pairAddress: "PoolJupiterExecutableCash1111111111111111111111",
    poolCreatedAt: "2026-08-04T23:04:00.000Z",
    marketCapUsd: 20_000,
  });
  const executableUnsharedPool = poolRow({
    tokenAddress: "TokenJupiterExecutableUnshared111111111111111111",
    pairAddress: "PoolJupiterExecutableUnshared1111111111111111111",
    poolCreatedAt: "2026-08-04T23:04:30.000Z",
    marketCapUsd: 20_000,
  });
  const executableWatchAt = new Date("2026-08-04T23:05:00.000Z");
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: executableWatchAt,
      clock: () => executableWatchAt,
      fetcher: fakeProvider({
        newPoolRows: [executableLongPool, executableCashPool, executableUnsharedPool],
      }),
    },
  );
  const executableLongToken = executableLongPool.relationships.base_token.data.id
    .slice("solana_".length);
  const executableCashToken = executableCashPool.relationships.base_token.data.id
    .slice("solana_".length);
  const executableUnsharedToken = executableUnsharedPool.relationships.base_token.data.id
    .slice("solana_".length);
  const executableQuoteRequests = [];
  const executableCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: executableWatchAt,
      captureClock: () => new Date("2026-08-04T23:05:10.000Z"),
      evidenceClock: () => new Date("2026-08-04T23:05:04.000Z"),
      jupiterEvidenceClock: () => new Date("2026-08-04T23:05:05.000Z"),
      jupiterExecutableClock: () => new Date("2026-08-04T23:05:06.000Z"),
      fetcher: fakeProvider({
        directPairs: [
          dexPair({
            tokenAddress: executableLongToken,
            pairAddress: executableLongPool.attributes.address,
            priceUsd: 0.001,
            liquidityUsd: 20_000,
          }),
          dexPair({
            tokenAddress: executableCashToken,
            pairAddress: executableCashPool.attributes.address,
            priceUsd: 0.0001,
            liquidityUsd: 20_000,
          }),
          dexPair({
            tokenAddress: executableUnsharedToken,
            pairAddress: executableUnsharedPool.attributes.address,
            priceUsd: 0.0001,
            liquidityUsd: 20_000,
          }),
        ],
      }),
      rugCheckReader: completeRugCheck,
      jupiterQuoteReader: async ({ inputMint, outputMint, amountAtomic }) => {
        executableQuoteRequests.push({ inputMint, outputMint, amountAtomic });
        const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE;
        if (inputMint === rule.inputMint) {
          assert.equal(amountAtomic, "100000000");
          return {
            status: "quoted",
            outputAmountAtomic: "1000000",
            priceImpactPct: 0.01,
            swapUsdValue: 100,
            routeHopCount: 1,
          };
        }
        assert.equal(outputMint, rule.inputMint);
        assert.equal(amountAtomic, "1000000");
        if (inputMint === executableCashToken) return { status: "no-route" };
        assert.equal(inputMint, executableLongToken);
        return {
          status: "quoted",
          outputAmountAtomic: "97000000",
          priceImpactPct: 0.02,
          swapUsdValue: 97,
          routeHopCount: 2,
        };
      },
    },
  );
  assert.equal(executableCapture.recordedForecasts, 2);
  assert.equal(executableCapture.recordedJupiterExecutableDecisions, 2);
  assert.equal(executableQuoteRequests.length, 4);
  const executableOpenEvents = await readLedger(ledgerPath);
  assert.equal(executableOpenEvents.some((event) => (
    event.type === "geckoterminal-new-pool-jupiter-roundtrip-snapshot"
      && event.tokenAddress === executableUnsharedToken
  )), false);
  const executableDecisions = executableOpenEvents.filter((event) => (
    event.type === "geckoterminal-new-pool-jupiter-executable-decision"
      && event.registrationId === jupiterExecutableRegistration.registrationId
  ));
  assert.deepEqual(executableDecisions.map((event) => ({
    tokenAddress: event.tokenAddress,
    decision: event.decision,
    predictedRise: event.predictedRise,
    entryTokenAmountAtomic: event.entryTokenAmountAtomic,
  })).sort((left, right) => left.tokenAddress.localeCompare(right.tokenAddress)), [
    {
      tokenAddress: executableCashToken,
      decision: "paper-cash",
      predictedRise: false,
      entryTokenAmountAtomic: null,
    },
    {
      tokenAddress: executableLongToken,
      decision: "paper-long",
      predictedRise: true,
      entryTokenAmountAtomic: "1000000",
    },
  ]);
  assert.equal((await resolveGeckoTerminalNewPoolBirthJupiterExecutable(
    { ledgerPath },
    { now: new Date("2026-08-05T00:05:05.000Z"), jupiterQuoteReader: async () => {
      throw new Error("No pre-due quote expected.");
    } },
  )).dueDecisions, 0);
  let exitQuoteRequests = 0;
  const executableResolution = await resolveGeckoTerminalNewPoolBirthJupiterExecutable(
    { ledgerPath },
    {
      now: new Date("2026-08-05T00:05:20.000Z"),
      responseClock: () => new Date("2026-08-05T00:05:21.000Z"),
      jupiterQuoteReader: async ({ inputMint, outputMint, amountAtomic }) => {
        exitQuoteRequests += 1;
        assert.equal(inputMint, executableLongToken);
        assert.equal(outputMint, GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE.inputMint);
        assert.equal(amountAtomic, "1000000");
        return {
          status: "quoted",
          outputAmountAtomic: "120000000",
          priceImpactPct: 0.03,
          swapUsdValue: 120,
          routeHopCount: 2,
        };
      },
    },
  );
  assert.equal(executableResolution.dueDecisions, 2);
  assert.equal(executableResolution.recordedResolutions, 2);
  assert.equal(exitQuoteRequests, 1);
  const executableEvents = await readLedger(ledgerPath);
  const executableScore = buildGeckoTerminalNewPoolBirthJupiterExecutableScorecard(
    executableEvents,
  );
  assert.equal(executableScore.candidateDecisions, 2);
  assert.equal(executableScore.eligibleLiveObservations, 2);
  assert.equal(executableScore.paperLongDecisions, 1);
  assert.equal(executableScore.paperCashDecisions, 1);
  assert.equal(executableScore.unavailableDecisions, 0);
  assert.equal(executableScore.independentHourlyFrames, 1);
  assert.equal(executableScore.selectedRiseCalls, 1);
  assert.equal(executableScore.selectedNetWinRate, 1);
  assert.equal(executableScore.portfolioAverageBaseReturnPct, 8);
  assert.equal(executableScore.portfolioAverageStressReturnPct, 4);
  assert.equal(executableScore.statisticalCandidateGate, false);
  assert.equal(executableScore.independentQuantValidationRequired, true);
  assert.equal(executableScore.independentQuantValidationStatus, "not-run");
  assert.equal(executableScore.promotionAuthority, false);
  assert.equal(executableScore.provisionalGate, false);

  const executableCollapsePool = poolRow({
    tokenAddress: "TokenJupiterExecutableCollapse111111111111111111",
    pairAddress: "PoolJupiterExecutableCollapse1111111111111111111",
    poolCreatedAt: "2026-08-04T23:09:00.000Z",
    marketCapUsd: 20_000,
  });
  const executableUnavailablePool = poolRow({
    tokenAddress: "TokenJupiterExecutableUnavailable111111111111111",
    pairAddress: "PoolJupiterExecutableUnavailable1111111111111111",
    poolCreatedAt: "2026-08-04T23:09:30.000Z",
    marketCapUsd: 20_000,
  });
  const executableFailureWatchAt = new Date("2026-08-04T23:10:00.000Z");
  await watchGeckoTerminalNewPools(
    { ledgerPath },
    {
      now: executableFailureWatchAt,
      clock: () => executableFailureWatchAt,
      fetcher: fakeProvider({
        newPoolRows: [executableCollapsePool, executableUnavailablePool],
      }),
    },
  );
  const executableCollapseToken = executableCollapsePool.relationships.base_token.data.id
    .slice("solana_".length);
  const executableUnavailableToken = executableUnavailablePool.relationships.base_token.data.id
    .slice("solana_".length);
  let failureEntryQuoteRequests = 0;
  const executableFailureCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath },
    {
      now: executableFailureWatchAt,
      captureClock: () => new Date("2026-08-04T23:10:10.000Z"),
      evidenceClock: () => new Date("2026-08-04T23:10:04.000Z"),
      jupiterEvidenceClock: () => new Date("2026-08-04T23:10:05.000Z"),
      jupiterExecutableClock: () => new Date("2026-08-04T23:10:06.000Z"),
      fetcher: fakeProvider({
        directPairs: [
          dexPair({
            tokenAddress: executableCollapseToken,
            pairAddress: executableCollapsePool.attributes.address,
            priceUsd: 0.0001,
            liquidityUsd: 20_000,
          }),
          dexPair({
            tokenAddress: executableUnavailableToken,
            pairAddress: executableUnavailablePool.attributes.address,
            priceUsd: 0.0001,
            liquidityUsd: 20_000,
          }),
        ],
      }),
      rugCheckReader: completeRugCheck,
      jupiterQuoteReader: async ({ inputMint, outputMint }) => {
        failureEntryQuoteRequests += 1;
        if (outputMint === executableUnavailableToken) {
          throw new Error("synthetic provider outage");
        }
        if (inputMint === GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE.inputMint) {
          assert.equal(outputMint, executableCollapseToken);
          return {
            status: "quoted",
            outputAmountAtomic: "2000000",
            priceImpactPct: 0.01,
            swapUsdValue: 100,
            routeHopCount: 1,
          };
        }
        assert.equal(inputMint, executableCollapseToken);
        return {
          status: "quoted",
          outputAmountAtomic: "96000000",
          priceImpactPct: 0.02,
          swapUsdValue: 96,
          routeHopCount: 2,
        };
      },
    },
  );
  assert.equal(executableFailureCapture.recordedJupiterExecutableDecisions, 2);
  assert.equal(failureEntryQuoteRequests, 3);
  const failureEntryEvents = await readLedger(ledgerPath);
  const unavailableDecision = failureEntryEvents.find((event) => (
    event.type === "geckoterminal-new-pool-jupiter-executable-decision"
      && event.tokenAddress === executableUnavailableToken
  ));
  assert.equal(unavailableDecision.decision, "unavailable");
  assert.equal(unavailableDecision.predictedRise, false);
  assert.equal(unavailableDecision.entryTokenAmountAtomic, null);
  let failureExitQuoteRequests = 0;
  const executableFailureResolution =
    await resolveGeckoTerminalNewPoolBirthJupiterExecutable(
      { ledgerPath },
      {
        now: new Date("2026-08-05T00:10:20.000Z"),
        responseClock: () => new Date("2026-08-05T00:10:21.000Z"),
        jupiterQuoteReader: async ({ inputMint, amountAtomic }) => {
          failureExitQuoteRequests += 1;
          assert.equal(inputMint, executableCollapseToken);
          assert.equal(amountAtomic, "2000000");
          return { status: "no-route" };
        },
      },
    );
  assert.equal(
    executableFailureResolution.recordedResolutions,
    2,
    JSON.stringify(executableFailureResolution),
  );
  assert.equal(executableFailureResolution.liquidityCollapses, 1);
  assert.equal(executableFailureResolution.unavailable, 1);
  assert.equal(failureExitQuoteRequests, 1);
  const executableFailureEvents = await readLedger(ledgerPath);
  const executableFailureScore =
    buildGeckoTerminalNewPoolBirthJupiterExecutableScorecard(executableFailureEvents);
  assert.equal(executableFailureScore.candidateDecisions, 4);
  assert.equal(executableFailureScore.eligibleLiveObservations, 3);
  assert.equal(executableFailureScore.unavailableDecisions, 1);
  assert.equal(executableFailureScore.liquidityCollapseCount, 1);
  assert.equal(executableFailureScore.openDecisions, 0);
  assert.equal(executableFailureScore.resolvedDecisionCoverageRate, 0.75);

  const tamperedExecutable = structuredClone(executableFailureEvents);
  const executableDecisionToTamper = tamperedExecutable.find((event) => (
    event.type === "geckoterminal-new-pool-jupiter-executable-decision"
      && event.decision === "paper-long"
  ));
  executableDecisionToTamper.quoteAggregate.roundTripReturnPct = 0;
  assert.deepEqual(
    buildGeckoTerminalNewPoolBirthJupiterExecutableScorecard(tamperedExecutable)
      .rejectionCounts,
    { "decision-integrity-mismatch": 1 },
  );

  const upperMomentumLedgerPath = path.join(root, "upper-momentum-ledger.jsonl");
  await registerGeckoTerminalNewPoolActivation(
    { ledgerPath: upperMomentumLedgerPath },
    { now: new Date("2026-08-04T17:58:00.000Z") },
  );
  await registerGeckoTerminalLiquidityCollapseScoring(
    { ledgerPath: upperMomentumLedgerPath },
    { now: new Date("2026-08-04T17:58:10.000Z") },
  );
  await registerGeckoTerminalNewPoolBirthEntry(
    { ledgerPath: upperMomentumLedgerPath },
    { now: new Date("2026-08-04T17:58:20.000Z") },
  );
  await registerGeckoTerminalNewPoolBirthMarketCapFloorRemoved(
    { ledgerPath: upperMomentumLedgerPath },
    { now: new Date("2026-08-04T17:58:30.000Z") },
  );
  const preUpperMomentumBirth = poolRow({
    tokenAddress: "TokenPreUpperMomentum111111111111111111111111",
    pairAddress: "PoolPreUpperMomentum1111111111111111111111111",
    poolCreatedAt: "2026-08-04T17:59:00.000Z",
    marketCapUsd: 40_000,
    priceChangeH1Pct: 60,
    priceChangeH24Pct: 80,
  });
  await watchGeckoTerminalNewPools(
    { ledgerPath: upperMomentumLedgerPath },
    {
      now: new Date("2026-08-04T17:59:20.000Z"),
      clock: () => new Date("2026-08-04T17:59:20.000Z"),
      fetcher: fakeProvider({ newPoolRows: [preUpperMomentumBirth] }),
    },
  );
  await assert.rejects(
    registerGeckoTerminalNewPoolBirthUpperMomentum(
      { ledgerPath: upperMomentumLedgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const upperMomentumRegistration = await registerGeckoTerminalNewPoolBirthUpperMomentum(
    { ledgerPath: upperMomentumLedgerPath },
    { now: new Date("2026-08-04T18:00:01.000Z") },
  );
  assert.equal(upperMomentumRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthUpperMomentum(
    { ledgerPath: upperMomentumLedgerPath },
    { now: new Date("2026-08-04T18:00:02.000Z") },
  )).status, "existing");
  const baselineFutureBirth = poolRow({
    tokenAddress: "TokenUpperMomentumBaseline111111111111111111111",
    pairAddress: "PoolUpperMomentumBaseline1111111111111111111111",
    poolCreatedAt: "2026-08-04T18:04:00.000Z",
    marketCapUsd: 40_000,
    priceChangeH1Pct: 10,
    priceChangeH24Pct: 20,
  });
  const upperMomentumFutureBirth = poolRow({
    tokenAddress: "TokenUpperMomentumFuture11111111111111111111111",
    pairAddress: "PoolUpperMomentumFuture111111111111111111111111",
    poolCreatedAt: "2026-08-04T18:04:10.000Z",
    marketCapUsd: 40_000,
    priceChangeH1Pct: 60,
    priceChangeH24Pct: 80,
  });
  const upperMomentumWatch = await watchGeckoTerminalNewPools(
    { ledgerPath: upperMomentumLedgerPath },
    {
      now: new Date("2026-08-04T18:05:00.000Z"),
      clock: () => new Date("2026-08-04T18:05:00.000Z"),
      fetcher: fakeProvider({
        newPoolRows: [baselineFutureBirth, upperMomentumFutureBirth],
      }),
    },
  );
  assert.equal(upperMomentumWatch.watchedCandidates, 2);
  const baselineUpperPair = dexPair({
    tokenAddress: baselineFutureBirth.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: baselineFutureBirth.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const treatmentUpperPair = dexPair({
    tokenAddress: upperMomentumFutureBirth.relationships.base_token.data.id.slice("solana_".length),
    pairAddress: upperMomentumFutureBirth.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const upperMomentumCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath: upperMomentumLedgerPath },
    {
      now: new Date("2026-08-04T18:05:01.000Z"),
      captureClock: () => new Date("2026-08-04T18:05:01.000Z"),
      fetcher: fakeProvider({ directPairs: [baselineUpperPair, treatmentUpperPair] }),
    },
  );
  assert.equal(upperMomentumCapture.recordedForecasts, 2);
  const upperMomentumCapturedEvents = await readLedger(upperMomentumLedgerPath);
  assert.deepEqual(
    upperMomentumCapturedEvents.filter((event) => (
      event.type === "geckoterminal-new-pool-forecast"
    )).map((forecast) => forecast.ruleVersion).sort(),
    [
      GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
      GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE.version,
    ].sort(),
  );
  const upperMomentumOpenScore = buildGeckoTerminalNewPoolBirthUpperMomentumScorecard(
    upperMomentumCapturedEvents,
  );
  assert.equal(upperMomentumOpenScore.candidateForecasts, 1);
  assert.equal(upperMomentumOpenScore.openForecasts, 1);
  assert.equal(upperMomentumOpenScore.eligibleLiveObservations, 0);
  assert.equal(upperMomentumOpenScore.independentQuantValidationStatus, "not-run");
  assert.equal(upperMomentumOpenScore.promotionAuthority, false);
  assert.equal(upperMomentumOpenScore.provisionalGate, false);
  const upperMomentumExit = poolRow({
    tokenAddress: treatmentUpperPair.baseToken.address,
    pairAddress: treatmentUpperPair.pairAddress,
    poolCreatedAt: upperMomentumFutureBirth.attributes.pool_created_at,
    priceUsd: 0.00015,
    liquidityUsd: 24_000,
  });
  const upperMomentumExitPair = dexPair({
    tokenAddress: treatmentUpperPair.baseToken.address,
    pairAddress: treatmentUpperPair.pairAddress,
    priceUsd: 0.00015,
    liquidityUsd: 24_000,
  });
  const baselineUpperExit = poolRow({
    tokenAddress: baselineUpperPair.baseToken.address,
    pairAddress: baselineUpperPair.pairAddress,
    poolCreatedAt: baselineFutureBirth.attributes.pool_created_at,
    priceUsd: 0.00011,
    liquidityUsd: 22_000,
  });
  const baselineUpperExitPair = dexPair({
    tokenAddress: baselineUpperPair.baseToken.address,
    pairAddress: baselineUpperPair.pairAddress,
    priceUsd: 0.00011,
    liquidityUsd: 22_000,
  });
  const upperMomentumResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath: upperMomentumLedgerPath },
    {
      now: new Date("2026-08-04T19:05:30.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [baselineUpperExit, upperMomentumExit],
        directPairs: [baselineUpperExitPair, upperMomentumExitPair],
      }),
    },
  );
  assert.equal(upperMomentumResolution.dueForecasts, 2);
  assert.equal(upperMomentumResolution.observed, 2);
  const upperMomentumEvents = await readLedger(upperMomentumLedgerPath);
  const upperMomentumScore = buildGeckoTerminalNewPoolBirthUpperMomentumScorecard(
    upperMomentumEvents,
  );
  assert.equal(upperMomentumScore.candidateForecasts, 1);
  assert.equal(upperMomentumScore.eligibleLiveObservations, 1);
  assert.equal(upperMomentumScore.maturedForecastCount, 1);
  assert.equal(upperMomentumScore.resolvedForecastCoverageRate, 1);
  assert.equal(upperMomentumScore.minimumResolvedForecastCoverageRate, 0.95);
  assert.ok(upperMomentumScore.portfolioAverageCapacityReturnPct > 0);
  assert.equal(upperMomentumScore.statisticalCandidateGate, false);
  assert.equal(upperMomentumScore.independentQuantValidationStatus, "not-run");
  assert.equal(upperMomentumScore.promotionAuthority, false);
  assert.equal(upperMomentumScore.provisionalGate, false);
  const tamperedUpperMomentum = structuredClone(upperMomentumEvents);
  const upperMomentumDiscovery = tamperedUpperMomentum.find((event) => (
    event.id === upperMomentumWatch.discoveryEventId
  ));
  const tamperedUpperCandidate = upperMomentumDiscovery.candidates.find((candidate) => (
    candidate.tokenAddress === treatmentUpperPair.baseToken.address
  ));
  tamperedUpperCandidate.birthQuote.priceChangeH1Pct = 10;
  assert.deepEqual(
    buildGeckoTerminalNewPoolBirthUpperMomentumScorecard(tamperedUpperMomentum)
      .rejectionCounts,
    { "newborn-birth-quote-mismatch": 1 },
  );
  const missedUpperMomentumBirth = poolRow({
    tokenAddress: "TokenUpperMomentumMissed11111111111111111111111",
    pairAddress: "PoolUpperMomentumMissed111111111111111111111111",
    poolCreatedAt: "2026-08-04T18:09:00.000Z",
    marketCapUsd: 40_000,
    priceChangeH1Pct: 60,
    priceChangeH24Pct: 80,
  });
  await watchGeckoTerminalNewPools(
    { ledgerPath: upperMomentumLedgerPath },
    {
      now: new Date("2026-08-04T18:10:00.000Z"),
      clock: () => new Date("2026-08-04T18:10:00.000Z"),
      fetcher: fakeProvider({ newPoolRows: [missedUpperMomentumBirth] }),
    },
  );
  const missedUpperPair = dexPair({
    tokenAddress: missedUpperMomentumBirth.relationships.base_token.data.id
      .slice("solana_".length),
    pairAddress: missedUpperMomentumBirth.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const missedUpperCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath: upperMomentumLedgerPath },
    {
      now: new Date("2026-08-04T18:10:01.000Z"),
      captureClock: () => new Date("2026-08-04T18:10:01.000Z"),
      fetcher: fakeProvider({ directPairs: [missedUpperPair] }),
    },
  );
  assert.equal(missedUpperCapture.recordedForecasts, 1);
  const missedUpperResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath: upperMomentumLedgerPath },
    {
      now: new Date("2026-08-04T19:15:02.000Z"),
      fetcher: fakeProvider({}),
    },
  );
  assert.equal(missedUpperResolution.dueForecasts, 1);
  assert.equal(missedUpperResolution.missed, 1);
  const coverageFailedUpperScore = buildGeckoTerminalNewPoolBirthUpperMomentumScorecard(
    await readLedger(upperMomentumLedgerPath),
  );
  assert.equal(coverageFailedUpperScore.candidateForecasts, 2);
  assert.equal(coverageFailedUpperScore.eligibleLiveObservations, 1);
  assert.equal(coverageFailedUpperScore.maturedForecastCount, 2);
  assert.equal(coverageFailedUpperScore.resolvedForecastCoverageRate, 0.5);
  assert.equal(
    coverageFailedUpperScore.evidenceShortfall.resolvedForecastCoverageRate,
    0.45,
  );
  assert.equal(coverageFailedUpperScore.statisticalCandidateGate, false);
  assert.equal(coverageFailedUpperScore.promotionAuthority, false);
  assert.equal(coverageFailedUpperScore.provisionalGate, false);

  const lowMomentumLedgerPath = path.join(root, "low-momentum-ledger.jsonl");
  await registerGeckoTerminalNewPoolActivation(
    { ledgerPath: lowMomentumLedgerPath },
    { now: new Date("2026-08-04T19:08:31.000Z") },
  );
  await registerGeckoTerminalLiquidityCollapseScoring(
    { ledgerPath: lowMomentumLedgerPath },
    { now: new Date("2026-08-04T19:08:32.000Z") },
  );
  await registerGeckoTerminalNewPoolBirthEntry(
    { ledgerPath: lowMomentumLedgerPath },
    { now: new Date("2026-08-04T19:08:33.000Z") },
  );
  await registerGeckoTerminalNewPoolBirthMarketCapFloorRemoved(
    { ledgerPath: lowMomentumLedgerPath },
    { now: new Date("2026-08-04T19:08:34.000Z") },
  );
  await assert.rejects(
    registerGeckoTerminalNewPoolBirthLowMomentum(
      { ledgerPath: lowMomentumLedgerPath },
      { now: new Date(GECKOTERMINAL_NEW_POOL_BIRTH_LOW_MOMENTUM_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const lowMomentumRegistration = await registerGeckoTerminalNewPoolBirthLowMomentum(
    { ledgerPath: lowMomentumLedgerPath },
    { now: new Date("2026-08-04T19:09:00.000Z") },
  );
  assert.equal(lowMomentumRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalNewPoolBirthLowMomentum(
    { ledgerPath: lowMomentumLedgerPath },
    { now: new Date("2026-08-04T19:09:01.000Z") },
  )).status, "existing");
  const lowMomentumWinnerBirth = poolRow({
    tokenAddress: "TokenLowMomentumWinner111111111111111111111111",
    pairAddress: "PoolLowMomentumWinner1111111111111111111111111",
    poolCreatedAt: "2026-08-04T19:09:30.000Z",
    marketCapUsd: 40_000,
    priceChangeM5Pct: 5,
    priceChangeH1Pct: 5,
  });
  const chasedMomentumLoserBirth = poolRow({
    tokenAddress: "TokenChasedMomentumLoser1111111111111111111111",
    pairAddress: "PoolChasedMomentumLoser11111111111111111111111",
    poolCreatedAt: "2026-08-04T19:09:40.000Z",
    marketCapUsd: 40_000,
    priceChangeM5Pct: 6,
    priceChangeH1Pct: 6,
  });
  const lowMomentumWatch = await watchGeckoTerminalNewPools(
    { ledgerPath: lowMomentumLedgerPath },
    {
      now: new Date("2026-08-04T19:10:00.000Z"),
      clock: () => new Date("2026-08-04T19:10:00.000Z"),
      fetcher: fakeProvider({
        newPoolRows: [lowMomentumWinnerBirth, chasedMomentumLoserBirth],
      }),
    },
  );
  assert.equal(lowMomentumWatch.watchedCandidates, 2);
  const lowMomentumWinnerPair = dexPair({
    tokenAddress: lowMomentumWinnerBirth.relationships.base_token.data.id
      .slice("solana_".length),
    pairAddress: lowMomentumWinnerBirth.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const chasedMomentumLoserPair = dexPair({
    tokenAddress: chasedMomentumLoserBirth.relationships.base_token.data.id
      .slice("solana_".length),
    pairAddress: chasedMomentumLoserBirth.attributes.address,
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const lowMomentumCapture = await captureGeckoTerminalNewPoolBirthEntries(
    { ledgerPath: lowMomentumLedgerPath },
    {
      now: new Date("2026-08-04T19:10:01.000Z"),
      captureClock: () => new Date("2026-08-04T19:10:01.000Z"),
      fetcher: fakeProvider({
        directPairs: [lowMomentumWinnerPair, chasedMomentumLoserPair],
      }),
    },
  );
  assert.equal(lowMomentumCapture.recordedForecasts, 2);
  const lowMomentumOpenEvents = await readLedger(lowMomentumLedgerPath);
  const lowMomentumForecasts = lowMomentumOpenEvents.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && event.ruleVersion
        === GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version
  ));
  assert.deepEqual(
    lowMomentumForecasts.map((forecast) => ({
      tokenAddress: forecast.tokenAddress,
      decision: forecast.lowMomentumChallengerDecision,
    })),
    [
      { tokenAddress: lowMomentumWinnerPair.baseToken.address, decision: "paper-long" },
      { tokenAddress: chasedMomentumLoserPair.baseToken.address, decision: "paper-cash" },
    ],
  );
  const lowMomentumOpenScore = buildGeckoTerminalNewPoolBirthLowMomentumScorecard(
    lowMomentumOpenEvents,
  );
  assert.equal(lowMomentumOpenScore.candidateForecasts, 2);
  assert.equal(lowMomentumOpenScore.openForecasts, 2);
  assert.equal(lowMomentumOpenScore.eligibleLiveObservations, 0);
  assert.equal(lowMomentumOpenScore.provisionalGate, false);
  const lowMomentumWinnerExit = poolRow({
    tokenAddress: lowMomentumWinnerPair.baseToken.address,
    pairAddress: lowMomentumWinnerPair.pairAddress,
    poolCreatedAt: lowMomentumWinnerBirth.attributes.pool_created_at,
    priceUsd: 0.0002,
    liquidityUsd: 30_000,
  });
  const chasedMomentumLoserExit = poolRow({
    tokenAddress: chasedMomentumLoserPair.baseToken.address,
    pairAddress: chasedMomentumLoserPair.pairAddress,
    poolCreatedAt: chasedMomentumLoserBirth.attributes.pool_created_at,
    priceUsd: 0.00005,
    liquidityUsd: 15_000,
  });
  const lowMomentumResolution = await resolveGeckoTerminalNewPoolForecasts(
    { ledgerPath: lowMomentumLedgerPath },
    {
      now: new Date("2026-08-04T20:10:02.000Z"),
      fetcher: fakeProvider({
        exactPoolRows: [lowMomentumWinnerExit, chasedMomentumLoserExit],
        directPairs: [
          dexPair({
            tokenAddress: lowMomentumWinnerPair.baseToken.address,
            pairAddress: lowMomentumWinnerPair.pairAddress,
            priceUsd: 0.0002,
            liquidityUsd: 30_000,
          }),
          dexPair({
            tokenAddress: chasedMomentumLoserPair.baseToken.address,
            pairAddress: chasedMomentumLoserPair.pairAddress,
            priceUsd: 0.00005,
            liquidityUsd: 15_000,
          }),
        ],
      }),
    },
  );
  assert.equal(lowMomentumResolution.observed, 2);
  const lowMomentumEvents = await readLedger(lowMomentumLedgerPath);
  const lowMomentumScore = buildGeckoTerminalNewPoolBirthLowMomentumScorecard(
    lowMomentumEvents,
  );
  assert.equal(lowMomentumScore.candidateForecasts, 2);
  assert.equal(lowMomentumScore.eligibleLiveObservations, 2);
  assert.equal(lowMomentumScore.maturedForecastCount, 2);
  assert.equal(lowMomentumScore.resolvedForecastCoverageRate, 1);
  assert.equal(lowMomentumScore.selectedRiseCalls, 1);
  assert.ok(lowMomentumScore.portfolioAverageCapacityReturnPct > 0);
  assert.ok(lowMomentumScore.pairedCapacityDeltaPct > 0);
  assert.deepEqual(lowMomentumScore.evidenceShortfall, {
    observations: 250,
    independentFrames: 251,
    uniqueSelectedTokens: 29,
    selectedRiseCalls: 49,
    independentTradedFrames: 63,
    resolvedForecastCoverageRate: 0,
  });
  assert.equal(lowMomentumScore.independentQuantValidationStatus, "not-run");
  assert.equal(lowMomentumScore.promotionAuthority, false);
  assert.equal(lowMomentumScore.provisionalGate, false);
  const tamperedLowMomentum = structuredClone(lowMomentumEvents);
  const lowMomentumForecastToTamper = tamperedLowMomentum.find((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && event.tokenAddress === lowMomentumWinnerPair.baseToken.address
  ));
  lowMomentumForecastToTamper.lowMomentumChallengerPredictedRise = false;
  lowMomentumForecastToTamper.lowMomentumChallengerDecision = "paper-cash";
  assert.deepEqual(
    buildGeckoTerminalNewPoolBirthLowMomentumScorecard(tamperedLowMomentum)
      .rejectionCounts,
    { "forecast-low-momentum-decision-mismatch": 1 },
  );

  console.log("token-edge GeckoTerminal new-pool activation checks passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}

function poolRow({
  tokenAddress,
  pairAddress,
  poolCreatedAt,
  priceUsd = 0.0001,
  liquidityUsd = 20_000,
  marketCapUsd = 100_000,
  volumeM5Usd = 1_000,
  priceChangeM5Pct = 2,
  priceChangeH1Pct = 10,
  priceChangeH24Pct = 20,
}) {
  return {
    id: `solana_${pairAddress}`,
    type: "pool",
    attributes: {
      address: pairAddress,
      name: "NEW / SOL",
      pool_created_at: poolCreatedAt,
      base_token_price_usd: String(priceUsd),
      reserve_in_usd: String(liquidityUsd),
      market_cap_usd: String(marketCapUsd),
      fdv_usd: String(marketCapUsd),
      price_change_percentage: {
        m5: String(priceChangeM5Pct),
        h1: String(priceChangeH1Pct),
        h24: String(priceChangeH24Pct),
      },
      transactions: {
        m5: { buys: 12, sells: 6 },
        h1: { buys: 100, sells: 50 },
      },
      volume_usd: { m5: String(volumeM5Usd), h1: String(Math.max(5_000, volumeM5Usd)) },
    },
    relationships: {
      base_token: { data: { id: `solana_${tokenAddress}`, type: "token" } },
      quote_token: { data: { id: "solana_So11111111111111111111111111111111111111112", type: "token" } },
    },
  };
}

function dexPair({ tokenAddress, pairAddress, priceUsd, liquidityUsd, info = null }) {
  return {
    chainId: "solana",
    pairAddress,
    baseToken: { address: tokenAddress, symbol: "NEW" },
    quoteToken: { address: "So11111111111111111111111111111111111111112", symbol: "SOL" },
    priceUsd: String(priceUsd),
    liquidity: { usd: liquidityUsd },
    ...(info ? { info } : {}),
  };
}

function completeRugCheck(tokenAddress) {
  return {
    mint: tokenAddress,
    creatorBalance: 0,
    token: { supply: 1_000 },
    totalHolders: 100,
    totalLPProviders: 1,
    score_normalised: 50,
    rugged: false,
    risks: [{ level: "danger", name: "Synthetic danger" }],
    graphInsidersDetected: 0,
    markets: [],
  };
}

function fakeProvider({
  newPoolRows = [],
  multiPoolRows = [],
  exactPoolRows = [],
  directPairs = [],
}) {
  return async (url) => {
    if (url.includes("/new_pools")) return jsonResponse({ data: newPoolRows });
    if (url.includes("/pools/multi/")) return jsonResponse({ data: multiPoolRows });
    if (url.includes("/token-pairs/v1/")) {
      const tokenAddress = decodeURIComponent(url.split("/").at(-1));
      return jsonResponse(directPairs.filter((pair) => pair.baseToken.address === tokenAddress));
    }
    if (url.includes("/pools/")) {
      const pairAddress = decodeURIComponent(url.split("/").at(-1));
      const row = exactPoolRows.find((candidate) => candidate.attributes.address === pairAddress);
      return jsonResponse({ data: row ?? null });
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return structuredClone(payload);
    },
  };
}
