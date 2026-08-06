#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readLedger, verifyLedger } from "./token-edge/onchain-forward-core.mjs";
import {
  GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE,
  GECKOTERMINAL_PRICE_AGNOSTIC_COLLAPSE_SCORING_RULE,
  GECKOTERMINAL_TRENDING_RULE,
  buildGeckoTerminalFastNativeQuoteScorecard,
  buildGeckoTerminalFastNativeRugCheckHolderScorecard,
  buildGeckoTerminalTrendingScorecard,
  captureGeckoTerminalFastNativeQuote,
  captureGeckoTerminalFastNativeRugCheckHolder,
  captureGeckoTerminalFastTrending,
  captureGeckoTerminalTrending,
  geckoTrendingCandidate,
  geckoDexDirectExitAssessment,
  markOpenGeckoTerminalFastNativePaths,
  registerGeckoTerminalFastNativeQuote,
  registerGeckoTerminalFastNativePath,
  registerGeckoTerminalFastNativeRugCheckHolder,
  registerGeckoTerminalFastNativeScoring,
  registerGeckoTerminalFastTrending,
  registerGeckoTerminalLiquidityCollapseScoring,
  registerGeckoTerminalPriceAgnosticCollapseScoring,
  registerGeckoTerminalTrending,
  resolveGeckoTerminalTrending,
} from "./token-edge/onchain-geckoterminal-trending-monitoring.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "token-edge-gecko-trending-"));
try {
  const ledgerPath = path.join(root, "ledger.jsonl");
  const boundary = new Date(GECKOTERMINAL_TRENDING_RULE.evidenceBoundary);
  await assert.rejects(
    registerGeckoTerminalTrending({ ledgerPath }, { now: boundary }),
    /strictly after its evidence boundary/,
  );

  const registeredAt = new Date("2026-08-04T02:29:00.000Z");
  const registration = await registerGeckoTerminalTrending(
    { ledgerPath },
    { now: registeredAt },
  );
  assert.equal(registration.status, "registered");
  const repeatedRegistration = await registerGeckoTerminalTrending(
    { ledgerPath },
    { now: new Date("2026-08-04T02:29:30.000Z") },
  );
  assert.equal(repeatedRegistration.status, "existing");
  assert.equal(repeatedRegistration.registrationId, registration.registrationId);

  const liquidityRegistration = await registerGeckoTerminalLiquidityCollapseScoring(
    { ledgerPath },
    { now: new Date("2026-08-04T03:59:00.000Z") },
  );
  assert.equal(liquidityRegistration.status, "registered");
  await assert.rejects(
    registerGeckoTerminalPriceAgnosticCollapseScoring(
      { ledgerPath },
      { now: new Date(GECKOTERMINAL_PRICE_AGNOSTIC_COLLAPSE_SCORING_RULE.evidenceBoundary) },
    ),
    /strictly after its evidence boundary/,
  );
  const priceAgnosticRegistration =
    await registerGeckoTerminalPriceAgnosticCollapseScoring(
      { ledgerPath },
      { now: new Date("2026-08-04T09:43:00.000Z") },
    );
  assert.equal(priceAgnosticRegistration.status, "registered");
  const priceDisagreeingCollapseProvider = {
    geckoCandidatesByPair: new Map([["PairDrain", {
      priceUsd: 0.00003,
      liquidityUsd: 0.000001,
    }]]),
    directPairsByToken: new Map([["TokenDrain", [dexPair({
      tokenAddress: "TokenDrain",
      pairAddress: "PairDrain",
      priceUsd: 0.00001,
      liquidityUsd: 0,
    })]]]),
  };
  const priceDisagreeingForecast = {
    tokenAddress: "TokenDrain",
    pairAddress: "PairDrain",
  };
  assert.equal(geckoDexDirectExitAssessment(
    priceDisagreeingForecast,
    priceDisagreeingCollapseProvider,
    GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE,
  ).reason, "cross-provider-price-disagreement");
  const priceAgnosticAssessment = geckoDexDirectExitAssessment(
    priceDisagreeingForecast,
    priceDisagreeingCollapseProvider,
    GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE,
    { allowPriceDisagreementOnCollapse: true },
  );
  assert.equal(priceAgnosticAssessment.status, "liquidity-collapse");
  assert.equal(priceAgnosticAssessment.pair.liquidity.usd, 0);
  assert.equal(
    priceAgnosticAssessment.integrity.ruleVersion,
    "geckoterminal-dex-direct-zero-liquidity-collapse-v2",
  );

  const captureAt = new Date("2026-08-04T04:00:00.000Z");
  const eligibleRow = trendingRow({
    tokenAddress: "TokenEligible111111111111111111111111111111",
    pairAddress: "PoolEligible1111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T03:30:00.000Z",
  });
  const exploded = trendingRow({
    tokenAddress: "TokenExploded111111111111111111111111111111",
    pairAddress: "PoolExploded1111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T03:30:00.000Z",
    priceChangeH1Pct: 300,
  });
  const illiquid = trendingRow({
    tokenAddress: "TokenIlliquid111111111111111111111111111111",
    pairAddress: "PoolIlliquid1111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T03:30:00.000Z",
    liquidityUsd: 5_000,
  });
  assert.equal(geckoTrendingCandidate(eligibleRow, 1, captureAt).status, "eligible");
  assert.deepEqual(
    geckoTrendingCandidate(exploded, 2, captureAt).blockers,
    ["one-hour-price-change-outside-minus20-to-25"],
  );
  assert.ok(geckoTrendingCandidate(illiquid, 3, captureAt).blockers
    .includes("liquidity-below-10000"));

  const pair = dexPair({
    tokenAddress: "TokenEligible111111111111111111111111111111",
    pairAddress: "PoolEligible1111111111111111111111111111111",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const capture = await captureGeckoTerminalTrending(
    { ledgerPath },
    {
      now: captureAt,
      clock: () => captureAt,
      captureClock: () => captureAt,
      fetcher: fakeProvider({ trendingRows: [eligibleRow, exploded, illiquid], pair }),
    },
  );
  assert.equal(capture.status, "recorded");
  assert.equal(capture.eligibleCandidates, 1);
  assert.equal(capture.recordedForecasts, 1);
  assert.equal(capture.forecasts[0].sourceRank, 1);
  assert.equal(capture.forecasts[0].dueAt, "2026-08-04T05:00:00.000Z");

  const repeatedCapture = await captureGeckoTerminalTrending(
    { ledgerPath },
    {
      now: new Date("2026-08-04T04:01:00.000Z"),
      fetcher: async () => {
        throw new Error("idempotent cadence capture must not call a provider");
      },
    },
  );
  assert.equal(repeatedCapture.status, "skipped-existing-cadence");
  assert.equal(repeatedCapture.existingForecasts, 1);

  const exitPair = dexPair({
    tokenAddress: pair.baseToken.address,
    pairAddress: pair.pairAddress,
    priceUsd: 0.00012,
    liquidityUsd: 24_000,
  });
  const resolution = await resolveGeckoTerminalTrending(
    { ledgerPath },
    {
      now: new Date("2026-08-04T05:00:30.000Z"),
      fetcher: fakeProvider({ trendingRows: [], pair: exitPair }),
    },
  );
  assert.equal(resolution.dueForecasts, 1);
  assert.equal(resolution.observed, 1);
  assert.equal(resolution.missed, 0);

  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  assert.equal(verification.ok, true);
  assert.deepEqual(verification.errors, []);
  const scorecard = buildGeckoTerminalTrendingScorecard(events);
  assert.equal(scorecard.candidateForecasts, 1);
  assert.equal(scorecard.openForecasts, 0);
  assert.equal(scorecard.eligibleLiveObservations, 1);
  assert.equal(scorecard.portfolioWeightedObservations, 1);
  assert.equal(scorecard.independentHourlyFrames, 1);
  assert.equal(scorecard.uniqueTokens, 1);
  assert.equal(scorecard.riseRate, 1);
  assert.equal(scorecard.netWinRate, 1);
  assert.ok(scorecard.portfolioAverageCapacityReturnPct > 0);
  assert.ok(scorecard.stressPortfolioAverageCapacityReturnPct > 0);
  assert.equal(scorecard.evidenceStatus, "collecting");
  assert.equal(scorecard.provisionalGate, false);

  const tampered = structuredClone(events);
  const forecast = tampered.find((event) => event.type === "geckoterminal-trending-forecast");
  forecast.metrics.sourceRank = 9;
  const tamperedScorecard = buildGeckoTerminalTrendingScorecard(tampered);
  assert.equal(tamperedScorecard.eligibleLiveObservations, 0);
  assert.deepEqual(tamperedScorecard.rejectionCounts, { "source-candidate-mismatch": 1 });

  const fastRegistration = await registerGeckoTerminalFastTrending(
    { ledgerPath },
    { now: new Date("2026-08-04T04:10:00.000Z") },
  );
  assert.equal(fastRegistration.status, "registered");
  const fastCaptureAt = new Date("2026-08-04T04:15:00.000Z");
  const fastRow = trendingRow({
    tokenAddress: "TokenFast111111111111111111111111111111111",
    pairAddress: "PoolFast1111111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T03:50:00.000Z",
  });
  const fastPair = dexPair({
    tokenAddress: "TokenFast111111111111111111111111111111111",
    pairAddress: "PoolFast1111111111111111111111111111111111",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const fastCapture = await captureGeckoTerminalFastTrending(
    { ledgerPath },
    {
      now: fastCaptureAt,
      clock: () => fastCaptureAt,
      captureClock: () => fastCaptureAt,
      fetcher: fakeProvider({ trendingRows: [fastRow], pair: fastPair }),
    },
  );
  assert.equal(fastCapture.status, "recorded");
  assert.equal(fastCapture.recordedForecasts, 1);
  const afterFast = await readLedger(ledgerPath);
  const fastForecast = afterFast.find((event) => (
    event.id === fastCapture.forecasts[0].id
  ));
  assert.equal(
    fastForecast.ruleVersion,
    "geckoterminal-solana-five-minute-trending-pools-shadow-v2",
  );
  assert.equal(fastForecast.registrationId, fastRegistration.registrationId);

  const nativeRegistration = await registerGeckoTerminalFastNativeQuote(
    { ledgerPath },
    { now: new Date("2026-08-04T04:25:00.000Z") },
  );
  assert.equal(nativeRegistration.status, "registered");
  const nativeCaptureAt = new Date("2026-08-04T04:30:00.000Z");
  const nativeCapture = await captureGeckoTerminalFastNativeQuote(
    { ledgerPath },
    {
      now: nativeCaptureAt,
      clock: () => nativeCaptureAt,
      captureClock: () => nativeCaptureAt,
      fetcher: fakeProvider({ trendingRows: [fastRow], pair: fastPair }),
    },
  );
  assert.equal(nativeCapture.status, "recorded");
  assert.equal(nativeCapture.recordedForecasts, 1);
  const afterNative = await readLedger(ledgerPath);
  const nativeForecast = afterNative.find((event) => (
    event.id === nativeCapture.forecasts[0].id
  ));
  assert.equal(
    nativeForecast.ruleVersion,
    "geckoterminal-solana-five-minute-trending-native-quote-shadow-v3",
  );
  assert.equal(nativeForecast.registrationId, nativeRegistration.registrationId);
  assert.equal(
    nativeForecast.entryProviderPriceIntegrity.ruleVersion,
    "geckoterminal-dex-direct-price-integrity-v1",
  );
  const nativeResolution = await resolveGeckoTerminalTrending(
    { ledgerPath },
    {
      now: new Date("2026-08-04T05:30:30.000Z"),
      fetcher: fakeProvider({ trendingRows: [], pair: fastPair }),
    },
  );
  assert.equal(nativeResolution.dueForecasts, 2);
  assert.equal(nativeResolution.observed, 1);
  assert.equal(nativeResolution.missed, 1);
  const resolvedNativeEvents = await readLedger(ledgerPath);
  const nativeOutcome = resolvedNativeEvents.find((event) => (
    event.type === "geckoterminal-trending-resolution"
      && event.forecastId === nativeForecast.id
  ));
  assert.equal(nativeOutcome.status, "observed");
  assert.equal(nativeOutcome.ruleVersion, nativeForecast.ruleVersion);
  assert.equal(
    nativeOutcome.providerPriceIntegrity.ruleVersion,
    "geckoterminal-dex-direct-price-integrity-v1",
  );
  const nativeScoringRegistration = await registerGeckoTerminalFastNativeScoring(
    { ledgerPath },
    { now: new Date("2026-08-04T05:31:00.000Z") },
  );
  assert.equal(nativeScoringRegistration.status, "registered");
  const diagnosticOnlyScore = buildGeckoTerminalFastNativeQuoteScorecard(
    await readLedger(ledgerPath),
  );
  assert.equal(diagnosticOnlyScore.eligibleLiveObservations, 0);
  assert.deepEqual(diagnosticOnlyScore.rejectionCounts, {
    "forecast-not-strictly-after-scoring-registration": 1,
  });

  const pathRegistration = await registerGeckoTerminalFastNativePath(
    { ledgerPath },
    { now: new Date("2026-08-04T05:40:00.000Z") },
  );
  assert.equal(pathRegistration.status, "registered");
  const repeatedPathRegistration = await registerGeckoTerminalFastNativePath(
    { ledgerPath },
    { now: new Date("2026-08-04T05:41:00.000Z") },
  );
  assert.equal(repeatedPathRegistration.status, "existing");
  assert.equal(repeatedPathRegistration.registrationId, pathRegistration.registrationId);

  const cleanCaptureAt = new Date("2026-08-04T05:45:00.000Z");
  const cleanRow = trendingRow({
    tokenAddress: "TokenClean11111111111111111111111111111111",
    pairAddress: "PoolClean111111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T05:15:00.000Z",
  });
  const cleanPair = dexPair({
    tokenAddress: "TokenClean11111111111111111111111111111111",
    pairAddress: "PoolClean111111111111111111111111111111111",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const cleanCapture = await captureGeckoTerminalFastNativeQuote(
    { ledgerPath },
    {
      now: cleanCaptureAt,
      clock: () => cleanCaptureAt,
      captureClock: () => cleanCaptureAt,
      fetcher: fakeProvider({ trendingRows: [cleanRow], pair: cleanPair }),
    },
  );
  assert.equal(cleanCapture.status, "recorded");
  assert.equal(cleanCapture.recordedForecasts, 1);
  const cleanPathPair = dexPair({
    tokenAddress: cleanPair.baseToken.address,
    pairAddress: cleanPair.pairAddress,
    priceUsd: 0.00011,
    liquidityUsd: 22_000,
  });
  const cleanPath = await markOpenGeckoTerminalFastNativePaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T05:50:00.000Z"),
      fetcher: fakeProvider({ trendingRows: [], pair: cleanPathPair }),
    },
  );
  assert.equal(cleanPath.pendingForecasts, 1);
  assert.equal(cleanPath.recordedObservations, 1);
  assert.equal(cleanPath.observations[0].grossReturnFromEntryPct, 10);
  const repeatedCleanPath = await markOpenGeckoTerminalFastNativePaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T05:50:30.000Z"),
      fetcher: async () => {
        throw new Error("idempotent path mark must not call a provider");
      },
    },
  );
  assert.equal(repeatedCleanPath.pendingForecasts, 0);
  assert.equal(repeatedCleanPath.recordedObservations, 0);
  const pathEvents = await readLedger(ledgerPath);
  const pathObservation = pathEvents.find((event) => (
    event.type === "geckoterminal-trending-path"
      && event.forecastId === cleanCapture.forecasts[0].id
  ));
  assert.equal(pathObservation.pathRegistrationId, pathRegistration.registrationId);
  assert.equal(pathObservation.observationMode, "live-point-in-time-path");
  assert.equal(pathObservation.providerPriceIntegrity.ruleVersion,
    "geckoterminal-dex-direct-price-integrity-v1");
  const cleanExitPair = dexPair({
    tokenAddress: cleanPair.baseToken.address,
    pairAddress: cleanPair.pairAddress,
    priceUsd: 0.00012,
    liquidityUsd: 24_000,
  });
  const cleanResolution = await resolveGeckoTerminalTrending(
    { ledgerPath },
    {
      now: new Date("2026-08-04T06:45:30.000Z"),
      fetcher: fakeProvider({ trendingRows: [], pair: cleanExitPair }),
    },
  );
  assert.equal(cleanResolution.dueForecasts, 1);
  assert.equal(cleanResolution.observed, 1);
  const cleanEvents = await readLedger(ledgerPath);
  const cleanScore = buildGeckoTerminalFastNativeQuoteScorecard(cleanEvents);
  assert.equal(cleanScore.candidateForecasts, 2);
  assert.equal(cleanScore.eligibleLiveObservations, 1);
  assert.equal(cleanScore.portfolioWeightedObservations, 1);
  assert.equal(cleanScore.netWinRate, 1);
  assert.ok(cleanScore.portfolioAverageCapacityReturnPct > 0);
  assert.ok(cleanScore.stressPortfolioAverageCapacityReturnPct > 0);
  assert.equal(cleanScore.provisionalGate, false);
  const tamperedNative = structuredClone(cleanEvents);
  const cleanForecast = tamperedNative.find((event) => (
    event.id === cleanCapture.forecasts[0].id
  ));
  cleanForecast.entryProviderPriceIntegrity.geckoPriceUsd *= 2;
  const rejectedNative = buildGeckoTerminalFastNativeQuoteScorecard(tamperedNative);
  assert.equal(rejectedNative.eligibleLiveObservations, 0);
  assert.equal(rejectedNative.rejectionCounts["entry-provider-price-integrity-mismatch"], 1);

  const collapseCaptureAt = new Date("2026-08-04T06:50:00.000Z");
  const collapseRow = trendingRow({
    tokenAddress: "TokenCollapse111111111111111111111111111111",
    pairAddress: "PoolCollapse1111111111111111111111111111111",
    poolCreatedAt: "2026-08-04T06:20:00.000Z",
  });
  const collapseEntryPair = dexPair({
    tokenAddress: "TokenCollapse111111111111111111111111111111",
    pairAddress: "PoolCollapse1111111111111111111111111111111",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const collapseCapture = await captureGeckoTerminalFastNativeQuote(
    { ledgerPath },
    {
      now: collapseCaptureAt,
      clock: () => collapseCaptureAt,
      captureClock: () => collapseCaptureAt,
      fetcher: fakeProvider({ trendingRows: [collapseRow], pair: collapseEntryPair }),
    },
  );
  assert.equal(collapseCapture.recordedForecasts, 1);
  const collapsedPair = dexPair({
    tokenAddress: collapseEntryPair.baseToken.address,
    pairAddress: collapseEntryPair.pairAddress,
    priceUsd: 0.00008,
    liquidityUsd: 0,
  });
  const collapsePath = await markOpenGeckoTerminalFastNativePaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T06:55:00.000Z"),
      fetcher: fakeProvider({ trendingRows: [], pair: collapsedPair }),
    },
  );
  assert.equal(collapsePath.liquidityCollapses, 1);
  const postCollapsePath = await markOpenGeckoTerminalFastNativePaths(
    { ledgerPath },
    {
      now: new Date("2026-08-04T07:00:00.000Z"),
      fetcher: async () => {
        throw new Error("terminal path collapse must not call a provider again");
      },
    },
  );
  assert.equal(postCollapsePath.pendingForecasts, 0);
  assert.equal(postCollapsePath.requestsAttempted, 0);
  assert.equal(postCollapsePath.recordedObservations, 0);
  const collapseResolution = await resolveGeckoTerminalTrending(
    { ledgerPath },
    {
      now: new Date("2026-08-04T07:50:30.000Z"),
      fetcher: fakeProvider({ trendingRows: [], pair: collapsedPair }),
    },
  );
  assert.equal(collapseResolution.liquidityCollapses, 1);
  const collapsedEvents = await readLedger(ledgerPath);
  const collapsedOutcome = collapsedEvents.find((event) => (
    event.type === "geckoterminal-trending-resolution"
      && event.forecastId === collapseCapture.forecasts[0].id
  ));
  assert.equal(collapsedOutcome.status, "liquidity-collapse");
  assert.equal(collapsedOutcome.grossReturnPct, -100);
  assert.equal(collapsedOutcome.exitLiquidityUsd, 0);
  const collapseScore = buildGeckoTerminalFastNativeQuoteScorecard(collapsedEvents);
  assert.equal(collapseScore.eligibleLiveObservations, 2);
  assert.equal(collapseScore.liquidityCollapseCount, 1);
  assert.equal(collapseScore.netWinRate, 0.5);
  assert.ok(collapseScore.portfolioAverageCapacityReturnPct < 0);
  const tamperedCollapse = structuredClone(collapsedEvents);
  const tamperedCollapseOutcome = tamperedCollapse.find((event) => (
    event.id === collapsedOutcome.id
  ));
  tamperedCollapseOutcome.providerPriceIntegrity.maximumProviderLiquidityUsd = 999;
  const rejectedCollapse = buildGeckoTerminalFastNativeQuoteScorecard(tamperedCollapse);
  assert.equal(rejectedCollapse.eligibleLiveObservations, 1);
  assert.equal(rejectedCollapse.rejectionCounts["liquidity-collapse-integrity-mismatch"], 1);

  await assert.rejects(
    registerGeckoTerminalFastNativeRugCheckHolder(
      { ledgerPath },
      { now: new Date("2026-08-04T05:57:30.000Z") },
    ),
    /strictly after its evidence boundary/,
  );
  const rugCheckRegistration = await registerGeckoTerminalFastNativeRugCheckHolder(
    { ledgerPath },
    { now: new Date("2026-08-04T08:00:00.000Z") },
  );
  assert.equal(rugCheckRegistration.status, "registered");
  assert.equal((await registerGeckoTerminalFastNativeRugCheckHolder(
    { ledgerPath },
    { now: new Date("2026-08-04T08:00:01.000Z") },
  )).status, "existing");

  const holderPassAt = new Date("2026-08-04T08:15:00.000Z");
  const holderPassRow = trendingRow({
    tokenAddress: "TokenHolderPass1111111111111111111111111111",
    pairAddress: "PoolHolderPass11111111111111111111111111111",
    poolCreatedAt: "2026-08-04T07:45:00.000Z",
  });
  const holderPassPair = dexPair({
    tokenAddress: "TokenHolderPass1111111111111111111111111111",
    pairAddress: "PoolHolderPass11111111111111111111111111111",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const holderPassCapture = await captureGeckoTerminalFastNativeRugCheckHolder(
    { ledgerPath },
    {
      now: holderPassAt,
      clock: () => holderPassAt,
      captureClock: () => holderPassAt,
      rugCheckClock: () => holderPassAt,
      rugCheckReader: async () => rugCheckReport(holderPassPair.baseToken.address, 20),
      fetcher: fakeProvider({ trendingRows: [holderPassRow], pair: holderPassPair }),
    },
  );
  assert.equal(holderPassCapture.recordedForecasts, 1);
  await resolveGeckoTerminalTrending(
    { ledgerPath },
    {
      now: new Date("2026-08-04T09:15:30.000Z"),
      fetcher: fakeProvider({
        trendingRows: [],
        pair: dexPair({
          tokenAddress: holderPassPair.baseToken.address,
          pairAddress: holderPassPair.pairAddress,
          priceUsd: 0.00012,
          liquidityUsd: 24_000,
        }),
      }),
    },
  );

  const holderBlockAt = new Date("2026-08-04T09:30:00.000Z");
  const holderBlockRow = trendingRow({
    tokenAddress: "TokenHolderBlock111111111111111111111111111",
    pairAddress: "PoolHolderBlock1111111111111111111111111111",
    poolCreatedAt: "2026-08-04T09:00:00.000Z",
  });
  const holderBlockPair = dexPair({
    tokenAddress: "TokenHolderBlock111111111111111111111111111",
    pairAddress: "PoolHolderBlock1111111111111111111111111111",
    priceUsd: 0.0001,
    liquidityUsd: 20_000,
  });
  const holderBlockCapture = await captureGeckoTerminalFastNativeRugCheckHolder(
    { ledgerPath },
    {
      now: holderBlockAt,
      clock: () => holderBlockAt,
      captureClock: () => holderBlockAt,
      rugCheckClock: () => holderBlockAt,
      rugCheckReader: async () => rugCheckReport(holderBlockPair.baseToken.address, 80),
      fetcher: fakeProvider({ trendingRows: [holderBlockRow], pair: holderBlockPair }),
    },
  );
  assert.equal(holderBlockCapture.recordedForecasts, 1);
  await resolveGeckoTerminalTrending(
    { ledgerPath },
    {
      now: new Date("2026-08-04T10:30:30.000Z"),
      fetcher: fakeProvider({
        trendingRows: [],
        pair: dexPair({
          tokenAddress: holderBlockPair.baseToken.address,
          pairAddress: holderBlockPair.pairAddress,
          priceUsd: 0.00005,
          liquidityUsd: 0,
        }),
      }),
    },
  );
  const holderEvents = await readLedger(ledgerPath);
  const holderScore = buildGeckoTerminalFastNativeRugCheckHolderScorecard(holderEvents);
  assert.equal(holderScore.candidateForecasts, 2);
  assert.equal(holderScore.eligibleResolvedObservations, 2);
  assert.equal(holderScore.tradedObservations, 1);
  assert.equal(holderScore.cashObservations, 1);
  assert.equal(holderScore.evidenceCashCounts["invalid-rugcheck-holder-aggregate"], undefined);
  assert.ok(holderScore.parentFrameMeanCapacityReturnPct < 0);
  assert.ok(holderScore.childFrameMeanCapacityReturnPct > 0);
  assert.ok(holderScore.childStressFrameMeanCapacityReturnPct > 0);
  assert.ok(holderScore.pairedFrameMeanDeltaPct > 0);
  assert.equal(holderScore.provisionalGate, false);
  const tamperedHolder = structuredClone(holderEvents);
  const holderPassForecast = tamperedHolder.find((event) => (
    event.id === holderPassCapture.forecasts[0].id
  ));
  const holderEvidence = tamperedHolder.find((event) => (
    event.id === holderPassForecast.rugCheckHolderEvidenceId
  ));
  holderEvidence.aggregate.unknownTop20Pct = 99;
  const rejectedHolder = buildGeckoTerminalFastNativeRugCheckHolderScorecard(
    tamperedHolder,
  );
  assert.equal(rejectedHolder.tradedObservations, 0);
  assert.equal(rejectedHolder.evidenceCashCounts["invalid-rugcheck-holder-aggregate"], 1);

  const mistimedHolder = structuredClone(holderEvents);
  const mistimedPassForecast = mistimedHolder.find((event) => (
    event.id === holderPassCapture.forecasts[0].id
  ));
  const mistimedEvidence = mistimedHolder.find((event) => (
    event.id === mistimedPassForecast.rugCheckHolderEvidenceId
  ));
  mistimedEvidence.observedAt = "2026-08-04T08:14:59.000Z";
  const timingRejectedHolder = buildGeckoTerminalFastNativeRugCheckHolderScorecard(
    mistimedHolder,
  );
  assert.equal(timingRejectedHolder.tradedObservations, 0);
  assert.equal(timingRejectedHolder.evidenceCashCounts["invalid-evidence-timing"], 1);

  console.log("token-edge GeckoTerminal trending monitoring tests passed");
} finally {
  await rm(root, { recursive: true, force: true });
}

function trendingRow({
  tokenAddress,
  pairAddress,
  poolCreatedAt,
  priceChangeH1Pct = 10,
  liquidityUsd = 20_000,
}) {
  return {
    id: `solana_${pairAddress}`,
    type: "pool",
    attributes: {
      address: pairAddress,
      name: "EDGE / SOL",
      pool_created_at: poolCreatedAt,
      base_token_price_usd: "0.0001",
      reserve_in_usd: String(liquidityUsd),
      market_cap_usd: null,
      fdv_usd: "100000",
      price_change_percentage: {
        m5: "2",
        h1: String(priceChangeH1Pct),
        h24: "20",
      },
      transactions: {
        m5: { buys: 12, sells: 6 },
        h1: { buys: 100, sells: 50 },
      },
      volume_usd: { m5: "1000", h1: "5000" },
    },
    relationships: {
      base_token: { data: { id: `solana_${tokenAddress}`, type: "token" } },
      quote_token: {
        data: { id: "solana_So11111111111111111111111111111111111111112", type: "token" },
      },
      dex: { data: { id: "mock-dex", type: "dex" } },
    },
  };
}

function dexPair({ tokenAddress, pairAddress, priceUsd, liquidityUsd }) {
  return {
    chainId: "solana",
    pairAddress,
    baseToken: { address: tokenAddress, symbol: "EDGE" },
    quoteToken: {
      address: "So11111111111111111111111111111111111111112",
      symbol: "SOL",
    },
    priceUsd: String(priceUsd),
    liquidity: { usd: liquidityUsd },
  };
}

function fakeProvider({ trendingRows, pair }) {
  return async (url) => {
    if (url.includes("api.geckoterminal.com/api/v2/networks/solana/pools/")) {
      return response({
        data: {
          id: `solana_${pair.pairAddress}`,
          type: "pool",
          attributes: {
            address: pair.pairAddress,
            base_token_price_usd: pair.priceUsd,
            reserve_in_usd: String(pair.liquidity.usd),
          },
        },
      });
    }
    if (url.includes("api.geckoterminal.com")) {
      return response({ data: trendingRows });
    }
    if (url.includes("/tokens/v1/solana/")) return response([pair]);
    if (url.includes("/token-pairs/v1/solana/")) return response([pair]);
    throw new Error(`Unexpected test URL: ${url}`);
  };
}

function rugCheckReport(tokenAddress, unknownTop20Pct) {
  return {
    mint: tokenAddress,
    topHolders: [{
      address: "anonymous-holder",
      owner: "anonymous-owner",
      pct: unknownTop20Pct,
      insider: false,
    }],
    knownAccounts: {},
    markets: [{ marketType: "pump_fun_amm" }],
    totalLPProviders: 2,
    token: { mintAuthority: null, freezeAuthority: null },
    tokenMeta: { mutable: false },
  };
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return structuredClone(payload);
    },
  };
}
