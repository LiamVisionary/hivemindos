#!/usr/bin/env node

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendLedgerEvent,
  digestValue,
  latestLedgerOccurrenceAt,
  readLedger,
  verifyLedger,
} from "./onchain-forward-core.mjs";
import {
  TOKEN_EDGE_EXECUTION_POLICY,
  capacityAdjustedReturnPct,
} from "./onchain-capacity-scorecard.mjs";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  canonicalRugCheckAggregate,
  normalizeRugCheckReportAggregate,
  readRugCheckReport,
} from "./onchain-dex-pulse-rugcheck-monitoring.mjs";
import { DEX_EARLY_SURFACE_RULE } from "./onchain-dex-early-rule.mjs";
import {
  buildGeckoTerminalScorecard,
  collectDexDirectPairs,
  collectGeckoPoolDexDirectProvider,
  findGeckoLiquidityCollapseScoringRegistration,
  findGeckoPriceAgnosticCollapseScoringRegistration,
  geckoDexDirectConsensus,
  geckoDexDirectExitAssessment,
  geckoLiquidityScoringEligibilityReason,
  priceAgnosticCollapseEligibility,
  geckoTrendingCandidate,
  validGeckoDexDirectIntegrity,
  validGeckoLiquidityCollapseIntegrity,
  GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE,
} from "./onchain-geckoterminal-trending-monitoring.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const NEW_POOLS_URL =
  "https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1";
const JUPITER_LITE_BASE_URL = "https://lite-api.jup.ag";
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUPITER_ROUND_TRIP_INPUT_USDC_ATOMIC = 100_000_000;
const FIVE_MINUTES_MS = 5 * 60_000;
const TEN_MINUTES_MS = 10 * 60_000;
const FIFTEEN_MINUTES_MS = 15 * 60_000;
const HOUR_MS = 60 * 60_000;
const MAX_OUTCOME_LAG_MS = 5 * 60_000;
const MINIMUM_PROMOTION_RESOLVED_FORECAST_COVERAGE_RATE = 0.95;
const INDEPENDENT_QUANT_VALIDATION_REQUIREMENTS = Object.freeze([
  "newey-west-absolute-t-at-least-3-and-p-at-most-0.01",
  "benjamini-hochberg-family-q-control",
  "purged-out-of-sample-sharpe-degradation-at-most-30-percent",
  "cscv-probability-of-backtest-overfit-at-most-50-percent",
  "2000-shifted-signal-placebos-p-at-most-0.05",
  "deflated-sharpe-probability-at-least-95-percent",
  "factor-residual-alpha-absolute-t-at-least-3",
  "positive-in-at-least-two-regimes-and-no-regime-over-70-percent-pnl",
  "independent-mean-return-reconciliation",
]);
const PRE_FAIL_CLOSED_ACTIVATION_FAILURES = new Map([
  [
    "geckoterminal_new_pool_discovery_9a4802274de8c77c331a82fa:2WepqgW5SFkb63ACn39UKSrtaNT1krscKGctULSFKEeq",
    "activation-identity-mismatch-observed-before-fail-closed-sealing",
  ],
]);

export const GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-fifteen-minute-activation-shadow-v1",
  evidenceBoundary: "2026-08-04T03:27:20.000Z",
  parentRuleVersion: "geckoterminal-solana-five-minute-trending-native-quote-shadow-v3",
  changedDimension: "candidate-discovery-timing-from-five-minute-trending-rank-to-new-pool-birth-list",
  sourceProvider: "geckoterminal-new-pools",
  sourceEndpoint: NEW_POOLS_URL,
  network: "solana",
  sourcePage: 1,
  sourceMaximumRows: 20,
  cadenceMinutes: 5,
  maximumBirthObservationAgeMinutesInclusive: 5,
  minimumActivationAgeMinutesInclusive: 15,
  maximumActivationLagMinutesInclusive: 10,
  horizon: "1h",
  maximumOutcomeLagMinutes: 5,
  candidateScreens: {
    minimumPairAgeMinutesInclusive: DEX_EARLY_SURFACE_RULE.minimumPairAgeMinutesInclusive,
    maximumPairAgeHoursInclusive: DEX_EARLY_SURFACE_RULE.maximumPairAgeHoursInclusive,
    minimumLiquidityUsdInclusive: DEX_EARLY_SURFACE_RULE.minimumLiquidityUsdInclusive,
    minimumMarketCapUsdInclusive: DEX_EARLY_SURFACE_RULE.minimumMarketCapUsdInclusive,
    maximumMarketCapUsdInclusive: DEX_EARLY_SURFACE_RULE.maximumMarketCapUsdInclusive,
    minimumHourlyVolumeUsdInclusive: DEX_EARLY_SURFACE_RULE.minimumHourlyVolumeUsdInclusive,
    minimumHourlyPriceChangePctInclusive:
      DEX_EARLY_SURFACE_RULE.minimumHourlyPriceChangePctInclusive,
    maximumHourlyPriceChangePctInclusive:
      DEX_EARLY_SURFACE_RULE.maximumHourlyPriceChangePctInclusive,
    minimumDailyPriceChangePctInclusive:
      DEX_EARLY_SURFACE_RULE.minimumDailyPriceChangePctInclusive,
    maximumDailyPriceChangePctInclusive:
      DEX_EARLY_SURFACE_RULE.maximumDailyPriceChangePctInclusive,
  },
  maximumCandidates: DEX_EARLY_SURFACE_RULE.maximumCandidates,
  selectionOrder: "new-pool-birth-order-then-first-eligible-activation-per-base-token",
  decision: "paper-long-every-eligible-new-pool-activation",
  repeatedAssetPolicy: "one-watch-per-pool-one-open-forecast-per-token-and-independent-one-hour-asset-frames",
  activationQuoteProvider: "geckoterminal-multi-exact-pool",
  entryAndExitQuoteProvider:
    "geckoterminal-exact-pool-and-dexscreener-direct-exact-pair-lower-price-and-liquidity",
  maximumCrossProviderPriceRatioInclusive: 1.1,
  maximumCrossProviderLiquidityRatioInclusive: 1.25,
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  derivationStatus: "future-only-new-pool-liquidity-activation-source-challenger",
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_NEW_POOL_MARKET_CAP_FLOOR_REMOVED_RULE = Object.freeze({
  ...GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
  version: "geckoterminal-solana-new-pool-market-cap-floor-removed-v2",
  evidenceBoundary: "2026-08-04T05:02:00.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version,
  changedDimension: "remove-minimum-market-cap-screen-only",
  candidateScreens: Object.freeze({
    ...GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.candidateScreens,
    minimumMarketCapUsdInclusive: null,
  }),
  decision: "paper-long-new-pool-activations-with-positive-market-cap-at-or-below-5000000",
  derivationStatus: "posthoc-source-contract-transfer-hypothesis-only",
  derivation: Object.freeze({
    inspectedActivations: 194,
    qualifyingOnlyOnRemovedDimension: 1,
    warning: "WALDO passed every other frozen activation screen but had market cap below $50,000. WALDO, all inspected activations, and every earlier response are excluded. No WALDO one-hour outcome was inspected before this challenger was frozen.",
  }),
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE = Object.freeze({
  ...GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
  version: "geckoterminal-solana-new-pool-five-minute-birth-entry-shadow-v3",
  evidenceBoundary: "2026-08-04T08:26:55.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version,
  changedDimension: "entry-timing-from-fifteen-minute-activation-to-first-observed-newborn-quote",
  minimumActivationAgeMinutesInclusive: 0,
  maximumActivationLagMinutesInclusive: 5,
  candidateScreens: Object.freeze({
    ...GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.candidateScreens,
    minimumPairAgeMinutesInclusive: 0,
    maximumPairAgeHoursInclusive:
      GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.maximumBirthObservationAgeMinutesInclusive / 60,
  }),
  selectionOrder: "new-pool-birth-order-then-first-eligible-birth-quote-per-base-token",
  decision: "paper-long-every-eligible-new-pool-birth-quote",
  derivationStatus: "future-only-earlier-source-timing-transfer-without-outcome-tuning",
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE = Object.freeze({
  ...GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
  version: "geckoterminal-solana-new-pool-birth-market-cap-floor-removed-v4",
  evidenceBoundary: "2026-08-04T08:37:10.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.version,
  changedDimension: "remove-minimum-market-cap-screen-only",
  candidateScreens: Object.freeze({
    ...GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.candidateScreens,
    minimumMarketCapUsdInclusive: null,
  }),
  decision: "paper-long-newborn-birth-quotes-with-positive-market-cap-at-or-below-5000000",
  derivationStatus: "posthoc-one-screen-transfer-before-any-birth-entry-outcome",
  derivation: Object.freeze({
    inspectedFutureBirthSamples: 2,
    qualifyingOnlyOnRemovedDimension: 1,
    outcomeInspected: false,
    warning: "DREAM passed every other inherited birth-entry screen but was below the $50,000 market-cap floor. DREAM, both inspected birth samples, and every earlier quote are excluded.",
  }),
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE = Object.freeze({
  ...GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE,
  version: "geckoterminal-solana-new-pool-birth-upper-momentum-incremental-v15",
  evidenceBoundary: "2026-08-04T17:54:30.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  changedDimension: "admit-previously-excluded-hourly-price-change-above-25-through-100-percent-only",
  candidateScreens: Object.freeze({
    ...GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.candidateScreens,
    maximumHourlyPriceChangePctInclusive: 100,
  }),
  incrementalMinimumHourlyPriceChangePctExclusive:
    GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.candidateScreens
      .maximumHourlyPriceChangePctInclusive,
  incrementalMaximumHourlyPriceChangePctInclusive: 100,
  decision: "paper-long-only-for-newborns-newly-admitted-by-raising-the-hourly-upper-momentum-ceiling-from-25-to-100-percent",
  derivationStatus: "prospective-surface-exploratory-family-future-only-incremental-test",
  derivation: Object.freeze({
    sourceLedgerEventCount: 15_915,
    prospectiveDiscoveries: 93,
    prospectiveBirthCandidates: 1_754,
    observedBirthToFifteenMinuteReturns: 668,
    selectedIncrementalObservations: 14,
    selectedIncrementalHourlyFrames: 7,
    selectedIncrementalExplosionsAbove25Pct: 11,
    selectedIncrementalExplosionsAbove100Pct: 5,
    selectedIncrementalFrameMeanBaseReturnPct: 25.945779,
    selectedIncrementalFrameMeanStressReturnPct: 21.633931,
    selectedIncrementalBootstrapCi95Pct: Object.freeze([-66.906133, 175.974818]),
    selectedIncrementalMaxDrawdownPct: 100,
    selectedIncrementalLargestWinnerShare: 0.90853,
    exploratoryFamilyCandidateCount: 7,
    warning: "The exploratory fifteen-minute surface is multiple-tested, has a negative bootstrap lower bound, total drawdown, and 90.853% winner concentration. Every event at or before the boundary is derivation-only and excluded. This registration tests only later exact one-hour outcomes and has no evidentiary, promotion, or trading authority.",
  }),
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_LOW_MOMENTUM_RULE = Object.freeze({
  ...GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE,
  version: "geckoterminal-solana-new-pool-birth-low-momentum-filter-v16",
  evidenceBoundary: "2026-08-04T19:08:30.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  changedDimension: "require-decision-time-five-minute-price-change-at-most-5-percent",
  maximumFiveMinutePriceChangePctInclusive: 5,
  decision: "paper-long-low-cap-newborn-only-when-five-minute-price-change-is-at-most-5-percent",
  derivationStatus: "multiple-tested-fifteen-minute-surface-future-only-filter-test",
  derivation: Object.freeze({
    sourceLedgerEventCount: 15_986,
    declaredCandidateFamilyCount: 65,
    eligibleBirthToFifteenMinuteObservations: 18,
    selectedObservations: 7,
    selectedIndependentHourlyFrames: 4,
    selectedFrameMeanBaseReturnPct: 102.350506,
    selectedFrameMeanStressReturnPct: 95.349019,
    selectedMaxDrawdownPct: 72.10452,
    selectedLargestWinnerShare: 0.698428,
    selectedWorstLeaveOneTokenOutStressReturnPct: 12.802343,
    excludedTokenAddresses: Object.freeze([
      "2Ap8nYWZphtQDHxJeJVPNKFzUegcjW6YmuDxdfcrKMin",
      "2kaHqES5H3sm1uuK4snqti6bqkmSdENf9y8Q5TiW2NJN",
      "3EfBZYjwFGipg4Lo6um8MFeSGouPZxgCsu1cjtjremKN",
      "3K1jZjfygWHVFvmHYWG7HzsGXQaciAFGZfRyuuSEuhvE",
      "4xbTHPKY6c2CmVXCp1aJStQnLqaLApxZRENSW127pump",
      "84MbokjpF4T9NhyKmpTbpKjedwuKtYHRP8MNRvb5pump",
      "8JyH3tSV9yAkJ5B39GEHG5YX2NgzTWWPnQbgXhigV1H5",
      "8wPPzMm8cB4bR9phL2o9fYRdBsARkBY7rVvJZEeHpump",
      "Bt4faxPNLM1J8AWr736ddymEVYJsuLSFeec77MFU8Ha5",
      "CVZPsgkdeHq5L8pSnphGzdV7xzxFZgnJGXxcJzhV8dBe",
      "Df5kCMVJW5owmvZ4eF8sPpxGBqvPfuiKkZDNoJ5jpump",
      "EFSybXm4R8PSUwULtPXDNgGNiNz2fTzuydjndNg1Y8uV",
      "Evs9SHsTJqQZrds138dQ4o8G8erhpxtAzyZS8R6UGws4",
      "F2HHYsSrQ3wR389JxcLqk9yvTW8JBEizZrDUVq8Q9D6j",
      "H5g7NTcX93ve3ZhVrsgABRWy7WsaBbjADfCXNmB4H1cz",
      "J5NVZjRdPBNWQi4aLz6jyouxyznc7nZpJVBhJCiHpump",
      "QffnXRk2DzSLmPBVen4Sq3w2DWxXSG9uupZvG6Upump",
      "firm6svwGicMQERmL9qF7Ps1Gxc1s7h7hmwn32gm7Zh",
    ]),
    warning: "This was the top cost-adjusted mean in a 65-variant retrospective family, but only seven observations across four frames survived. Drawdown was 72.105% and one winner supplied 69.843% of gains. Every inspected token and all 15,986 earlier ledger events are excluded; this is a weak falsification test, not an edge.",
  }),
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-birth-creator-balance-v5",
  evidenceBoundary: "2026-08-04T09:54:30.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  changedDimension: "rugcheck-reported-creator-balance-at-most-ten-percent",
  sourceProvider: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.sourceProvider,
  evidenceProvider: "rugcheck",
  maximumSourceToEvidenceLagMinutes: 5,
  maximumEvidenceToForecastLagMinutes: 5,
  maximumCreatorBalancePctInclusive: 10,
  decision: "paper-long-only-when-pre-entry-rugcheck-creator-balance-is-at-most-ten-percent-otherwise-cash",
  horizon: "1h",
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  derivationStatus: "posthoc-three-token-separator-future-only-hypothesis",
  derivation: Object.freeze({
    inspectedTokens: 3,
    inspectedWinnerCount: 1,
    inspectedLikelyDrainCount: 2,
    excludedSymbols: Object.freeze(["TikTok", "MarsCoin", "WIZARD"]),
    excludedTokenAddresses: Object.freeze([
      "3K1jZjfygWHVFvmHYWG7HzsGXQaciAFGZfRyuuSEuhvE",
      "8JyH3tSV9yAkJ5B39GEHG5YX2NgzTWWPnQbgXhigV1H5",
      "Evs9SHsTJqQZrds138dQ4o8G8erhpxtAzyZS8R6UGws4",
    ]),
    warning: "The round 10% ceiling was frozen only after TikTok reported 0% creator balance while MarsCoin and WIZARD reported about 86.8% and 99.6%. Those reports, tokens, paths, and outcomes are permanently excluded and are not evidence of a profitable edge.",
  }),
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentSignalFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumRiseCalls: 50,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  bootstrapLower95MustExceedPct: TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-birth-lp-provider-presence-v6",
  evidenceBoundary: "2026-08-04T10:41:40.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  changedDimension: "rugcheck-reported-total-lp-providers-at-least-one",
  sourceProvider: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.sourceProvider,
  evidenceProvider: "rugcheck",
  maximumSourceToEvidenceLagMinutes: 5,
  maximumEvidenceToForecastLagMinutes: 5,
  minimumTotalLpProvidersInclusive: 1,
  decision: "paper-long-only-when-pre-entry-rugcheck-reports-at-least-one-lp-provider-otherwise-cash",
  horizon: "1h",
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  derivationStatus: "posthoc-five-token-separator-future-only-hypothesis",
  derivation: Object.freeze({
    inspectedTokens: 5,
    excludedTokenAddresses: Object.freeze([
      "3K1jZjfygWHVFvmHYWG7HzsGXQaciAFGZfRyuuSEuhvE",
      "8JyH3tSV9yAkJ5B39GEHG5YX2NgzTWWPnQbgXhigV1H5",
      "Evs9SHsTJqQZrds138dQ4o8G8erhpxtAzyZS8R6UGws4",
      "J5NVZjRdPBNWQi4aLz6jyouxyznc7nZpJVBhJCiHpump",
      "Df5kCMVJW5owmvZ4eF8sPpxGBqvPfuiKkZDNoJ5jpump",
    ]),
    warning: "Mutable post-outcome reports showed one LP provider for TikTok and zero for MarsCoin, WIZARD, PEPHEAD, and Hthcity. This perfect five-token separation is extreme overfit provenance, not evidence, and none of those reports can enter the child.",
  }),
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentSignalFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumRiseCalls: 50,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  bootstrapLower95MustExceedPct: TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-birth-rugcheck-panel-v7",
  evidenceBoundary: "2026-08-04T11:44:00.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  changedDimension: "observation-only-pre-entry-rugcheck-aggregate-risk-panel",
  sourceProvider: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.sourceProvider,
  evidenceProvider: "rugcheck",
  maximumSourceToEvidenceLagMinutes: 5,
  retainedAggregateFields: Object.freeze([
    "normalizedRiskScore",
    "rugged",
    "dangerRiskCount",
    "warningRiskCount",
    "dangerRiskNames",
    "graphInsidersDetected",
    "insiderNetworkCount",
    "maximumInsiderNetworkSize",
    "totalHolders",
    "creatorBalancePct",
    "mainPairLockedPct",
    "mainPairLockedUsd",
    "reportDetectedAt",
  ]),
  identityRetention: "aggregate-only-no-wallet-or-holder-identities",
  decision: "observation-only-no-entry-or-exit-effect",
  derivationStatus: "future-only-data-completeness-repair-after-dynamic-report-gap",
  derivation: Object.freeze({
    excludedTokenAddresses: Object.freeze([
      "3K1jZjfygWHVFvmHYWG7HzsGXQaciAFGZfRyuuSEuhvE",
      "8JyH3tSV9yAkJ5B39GEHG5YX2NgzTWWPnQbgXhigV1H5",
      "Evs9SHsTJqQZrds138dQ4o8G8erhpxtAzyZS8R6UGws4",
      "J5NVZjRdPBNWQi4aLz6jyouxyznc7nZpJVBhJCiHpump",
      "Df5kCMVJW5owmvZ4eF8sPpxGBqvPfuiKkZDNoJ5jpump",
      "H4ShhuzMpEJJZxr4pV7Cvk22HVvPnuTw8ekRqsgHjM5u",
    ]),
    warning: "Post-entry RugCheck reports changed materially after liquidity collapse. This panel preserves only future decision-time aggregates from the already shared request; excluded reports and tokens cannot be backfilled or scored.",
  }),
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-birth-minimum-two-minute-age-v8",
  evidenceBoundary: "2026-08-04T13:47:05.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  changedDimension: "minimum-decision-time-pair-age-two-minutes-inclusive",
  sourceProvider: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.sourceProvider,
  minimumPairAgeMinutesInclusive: 2,
  decision: "paper-long-only-when-decision-time-pair-age-is-at-least-two-minutes-otherwise-cash",
  horizon: "1h",
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  derivationStatus: "posthoc-natural-age-confirmation-threshold-future-only-hypothesis",
  derivation: Object.freeze({
    inspectedParentForecasts: 9,
    eligibleResolvedForecasts: 7,
    selectedResolvedForecasts: 2,
    selectedIndependentTradedFrames: 1,
    counterfactualPortfolioBaseReturnPct: 13.211999,
    counterfactualPortfolioStressReturnPct: 11.878666,
    counterfactualPairedBaseDeltaPct: 46.159569,
    excludedTokenAddresses: Object.freeze([
      "3K1jZjfygWHVFvmHYWG7HzsGXQaciAFGZfRyuuSEuhvE",
      "8JyH3tSV9yAkJ5B39GEHG5YX2NgzTWWPnQbgXhigV1H5",
      "Evs9SHsTJqQZrds138dQ4o8G8erhpxtAzyZS8R6UGws4",
      "J5NVZjRdPBNWQi4aLz6jyouxyznc7nZpJVBhJCiHpump",
      "Df5kCMVJW5owmvZ4eF8sPpxGBqvPfuiKkZDNoJ5jpump",
      "H4ShhuzMpEJJZxr4pV7Cvk22HVvPnuTw8ekRqsgHjM5u",
      "4FzRL2GUrUEvx1CzSDTXFmPkpnG2V9V1aU7oLQUzAVgi",
      "EFSybXm4R8PSUwULtPXDNgGNiNz2fTzuydjndNg1Y8uV",
      "F2HHYsSrQ3wR389JxcLqk9yvTW8JBEizZrDUVq8Q9D6j",
    ]),
    warning: "The natural two-minute confirmation threshold selected TikTok and MarsCoin in one historical frame while making every age-one parent forecast paper cash. The apparent positive portfolio is concentrated in TikTok and is derivation provenance only. All nine inspected parent forecasts, including missed or unresolved labels, are excluded.",
  }),
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentSignalFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumRiseCalls: 50,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  bootstrapLower95MustExceedPct: TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_TURNOVER_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-birth-five-minute-turnover-cap-v9",
  evidenceBoundary: "2026-08-04T14:02:40.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  changedDimension: "maximum-decision-time-five-minute-turnover-ten-percent-inclusive",
  sourceProvider: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.sourceProvider,
  maximumFiveMinuteTurnoverInclusive: 0.1,
  decision: "paper-long-only-when-decision-time-five-minute-turnover-is-at-most-ten-percent-otherwise-cash",
  horizon: "1h",
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  derivationStatus: "multiple-tested-natural-turnover-cap-future-only-hypothesis",
  derivation: Object.freeze({
    testedNaturalOneDimensionalCuts: 17,
    inspectedParentForecasts: 9,
    eligibleResolvedForecasts: 7,
    selectedResolvedForecasts: 4,
    selectedIndependentTradedFrames: 3,
    selectedNetWins: 2,
    selectedLiquidityCollapses: 1,
    counterfactualPortfolioBaseReturnPct: 11.496874,
    counterfactualPortfolioStressReturnPct: 8.669265,
    counterfactualPairedBaseDeltaPct: 44.444444,
    excludedTokenAddresses:
      GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE.derivation.excludedTokenAddresses,
    warning: "A round 10% turnover ceiling ranked second among 17 natural one-dimensional derivation cuts. It selected four tokens across three frames but remains multiple-tested and materially dependent on TikTok. All nine inspected parent forecasts, including missed labels, are excluded; this is a future test, not an edge claim.",
  }),
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentSignalFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumRiseCalls: 50,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  bootstrapLower95MustExceedPct: TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-birth-social-presence-panel-v10",
  evidenceBoundary: "2026-08-04T14:10:05.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  changedDimension: "observation-only-exact-pair-social-and-website-presence-aggregates",
  sourceProvider: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.sourceProvider,
  evidenceProvider: "dexscreener-token-pairs-exact-contract",
  officialSchemaUrl: "https://docs.dexscreener.com/api/reference",
  retainedPlatforms: Object.freeze([
    "twitter", "telegram", "discord", "youtube", "tiktok", "instagram", "reddit",
  ]),
  derivationStatus: "future-only-social-observation-after-lunarcrush-exact-contract-coverage-failure",
  derivation: Object.freeze({
    inspectedParentForecasts: 9,
    excludedTokenAddresses:
      GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE.derivation.excludedTokenAddresses,
    warning: "LunarCrush paid topic calls did not preserve exact newborn contract identity or valid aggregates. DexScreener documents optional website/social metadata on the exact token-pairs response already used for entry. No historical direct-pair metadata was retained, so all current parents are excluded and no backfill is permitted.",
  }),
  decisionAuthority: false,
  promotionAuthority: false,
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_DANGER_COUNT_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-birth-danger-count-one-to-two-v12",
  evidenceBoundary: "2026-08-04T16:20:00.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  evidenceRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.version,
  changedDimension: "complete-decision-time-rugcheck-danger-count-one-to-two-inclusive",
  sourceProvider: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.sourceProvider,
  evidenceProvider: GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.evidenceProvider,
  minimumDangerRiskCountInclusive: 1,
  maximumDangerRiskCountInclusive: 2,
  decision: "paper-long-only-when-complete-pre-entry-rugcheck-danger-count-is-one-or-two-otherwise-cash",
  horizon: "1h",
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  derivationStatus: "single-predeclared-panel-bucket-selected-posthoc-for-strictly-future-test",
  derivation: Object.freeze({
    inspectedPanelSnapshots: 11,
    eligibleResolvedForecasts: 5,
    selectedResolvedForecasts: 3,
    selectedIndependentFrames: 2,
    selectedNetWins: 2,
    selectedLiquidityCollapses: 1,
    selectedAverageGrossReturnPct: 281.202866,
    selectedAverageBaseCapacityReturnPct: 267.32607,
    excludedTokenAddresses: Object.freeze([
      "2kaHqES5H3sm1uuK4snqti6bqkmSdENf9y8Q5TiW2NJN",
      "3EfBZYjwFGipg4Lo6um8MFeSGouPZxgCsu1cjtjremKN",
      "4FzRL2GUrUEvx1CzSDTXFmPkpnG2V9V1aU7oLQUzAVgi",
      "4wZfTcijvqEYeueXHQL2PtGFCGib3osU4vWJBiy9san6",
      "84MbokjpF4T9NhyKmpTbpKjedwuKtYHRP8MNRvb5pump",
      "8wPPzMm8cB4bR9phL2o9fYRdBsARkBY7rVvJZEeHpump",
      "Bt4faxPNLM1J8AWr736ddymEVYJsuLSFeec77MFU8Ha5",
      "EFSybXm4R8PSUwULtPXDNgGNiNz2fTzuydjndNg1Y8uV",
      "F2HHYsSrQ3wR389JxcLqk9yvTW8JBEizZrDUVq8Q9D6j",
      "GPX9zjhWhssoGFNpcqvvydgizHqBHFUoGge4yEreC7A4",
      "QffnXRk2DzSLmPBVen4Sq3w2DWxXSG9uupZvG6Upump",
    ]),
    warning: "The 1-2 bucket was selected after inspecting a tiny five-outcome panel and is dominated by KIO's +914% gross move while still containing a total liquidity collapse. Every token with a decision-time panel snapshot available during derivation is excluded. This is a future falsification test, not evidence of an edge.",
  }),
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentSignalFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumRiseCalls: 50,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  bootstrapLower95MustExceedPct: TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-birth-jupiter-roundtrip-panel-v13",
  evidenceBoundary: "2026-08-04T16:45:45.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  changedDimension: "observation-only-decision-time-jupiter-usdc-token-usdc-roundtrip",
  evidenceProvider: "jupiter-lite-swap-v1-quote",
  evidenceBaseUrl: JUPITER_LITE_BASE_URL,
  inputMint: SOLANA_USDC_MINT,
  inputUsdcAtomic: JUPITER_ROUND_TRIP_INPUT_USDC_ATOMIC,
  inputUsd: 100,
  slippageBps: 100,
  swapMode: "ExactIn",
  restrictIntermediateTokens: true,
  maximumCandidatesPerCapture: 2,
  decision: "observation-only-no-entry-or-exit-effect",
  derivationStatus: "future-only-executable-route-panel-after-post-outcome-feasibility-probe",
  derivation: Object.freeze({
    inspectedPostOutcomeProbes: 5,
    excludedTokenAddresses: Object.freeze([
      "3K1jZjfygWHVFvmHYWG7HzsGXQaciAFGZfRyuuSEuhvE",
      "8JyH3tSV9yAkJ5B39GEHG5YX2NgzTWWPnQbgXhigV1H5",
      "Evs9SHsTJqQZrds138dQ4o8G8erhpxtAzyZS8R6UGws4",
      "J5NVZjRdPBNWQi4aLz6jyouxyznc7nZpJVBhJCiHpump",
      "Df5kCMVJW5owmvZ4eF8sPpxGBqvPfuiKkZDNoJ5jpump",
      "H4ShhuzMpEJJZxr4pV7Cvk22HVvPnuTw8ekRqsgHjM5u",
      "4FzRL2GUrUEvx1CzSDTXFmPkpnG2V9V1aU7oLQUzAVgi",
      "EFSybXm4R8PSUwULtPXDNgGNiNz2fTzuydjndNg1Y8uV",
      "F2HHYsSrQ3wR389JxcLqk9yvTW8JBEizZrDUVq8Q9D6j",
      "Bt4faxPNLM1J8AWr736ddymEVYJsuLSFeec77MFU8Ha5",
      "84MbokjpF4T9NhyKmpTbpKjedwuKtYHRP8MNRvb5pump",
      "GPX9zjhWhssoGFNpcqvvydgizHqBHFUoGge4yEreC7A4",
    ]),
    warning: "Read-only post-outcome feasibility probes found mutable current route failures and extreme round-trip asymmetry. They establish provider feasibility only, not predictive association. Every existing low-cap parent is excluded; no historical quote can be backfilled or scored.",
  }),
  decisionAuthority: false,
  promotionAuthority: false,
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-birth-jupiter-executable-paper-v14",
  evidenceBoundary: "2026-08-04T17:10:00.000Z",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  changedDimension:
    "entry-and-exit-execution-provider-from-geckoterminal-dexscreener-consensus-to-jupiter-exact-in",
  sourceProvider: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.sourceProvider,
  executionProvider: "jupiter-lite-swap-v1-quote",
  executionBaseUrl: JUPITER_LITE_BASE_URL,
  inputMint: SOLANA_USDC_MINT,
  inputUsdcAtomic: JUPITER_ROUND_TRIP_INPUT_USDC_ATOMIC,
  inputUsd: 100,
  slippageBps: 100,
  swapMode: "ExactIn",
  restrictIntermediateTokens: true,
  maximumCandidatesPerCapture: 2,
  maximumExitQuotesPerResolution: 4,
  horizon: "1h",
  maximumOutcomeLagMinutes: 5,
  decision:
    "paper-long-only-when-decision-time-jupiter-buy-and-immediate-reverse-routes-are-both-quoted-otherwise-paper-cash",
  providerUnavailablePolicy: "record-unavailable-no-paper-pnl-credit",
  minimumResolvedDecisionCoverageRate: 0.95,
  noRoutePolicy: "paper-cash-at-entry-and-minus-100-percent-if-held-token-has-no-exit-route",
  repeatedAssetPolicy: "one-open-jupiter-paper-decision-per-token",
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  derivationStatus:
    "future-only-executable-provider-replacement-after-unscored-price-disagreement-diagnostic",
  derivation: Object.freeze({
    inspectedDiagnosticTokens: 1,
    excludedTokenAddresses: Object.freeze([
      ...GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE.derivation
        .excludedTokenAddresses,
      "firm6svwGicMQERmL9qF7Ps1Gxc1s7h7hmwn32gm7Zh",
    ]),
    warning: "A read-only PF diagnostic showed that Jupiter could quote a token rejected by GeckoTerminal/DexScreener price disagreement, but its immediate round trip lost 3.842463%. PF, its discovery, every earlier parent token, all prior provider responses, and all outcomes are excluded. The diagnostic establishes only that executable-provider coverage differs; it provides no profit evidence.",
  }),
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentSignalFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumRiseCalls: 50,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  bootstrapLower95MustExceedPct: TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_NEW_POOL_BIRTH_PATH_RULE = Object.freeze({
  version: "geckoterminal-new-pool-birth-five-minute-path-observation-v1",
  evidenceBoundary: "2026-08-04T09:06:30.000Z",
  sourceRuleVersions: Object.freeze([
    GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.version,
    GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  ]),
  changedDimension: "observation-only-five-minute-executable-path-after-registration",
  cadenceMinutes: 5,
  entryAndObservationQuoteProvider:
    GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.entryAndExitQuoteProvider,
  maximumCrossProviderPriceRatioInclusive:
    GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.maximumCrossProviderPriceRatioInclusive,
  maximumCrossProviderLiquidityRatioInclusive:
    GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.maximumCrossProviderLiquidityRatioInclusive,
  preRegistrationOpenForecastPolicy:
    "may-observe-forward-points-as-diagnostic-seed-only-never-eligible-for-a-later-derived-exit-policy",
  researchOnly: true,
  mutationAllowed: false,
});

export function createGeckoTerminalNewPoolRegistrationEvent(registeredAt = new Date()) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolMarketCapFloorRemovedRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_MARKET_CAP_FLOOR_REMOVED_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthEntryRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthMarketCapFloorRemovedRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthUpperMomentumRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthLowMomentumRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_LOW_MOMENTUM_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthPathRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_PATH_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthCreatorBalanceRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthLpProviderRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthRugCheckPanelRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthPairAgeRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthTurnoverRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_TURNOVER_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthSocialPresenceRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthDangerCountRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_DANGER_COUNT_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthJupiterRoundTripRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export function createGeckoTerminalNewPoolBirthJupiterExecutableRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...registrationSpec,
  };
}

export async function registerGeckoTerminalNewPoolActivation(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createGeckoTerminalNewPoolRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.evidenceBoundary))) {
    throw new Error("New-pool activation registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error(`Existing new-pool activation registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolMarketCapFloorRemoved(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesRegistration)) {
    throw new Error("Register the frozen new-pool activation parent first.");
  }
  const proposed = createGeckoTerminalNewPoolMarketCapFloorRemovedRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_MARKET_CAP_FLOOR_REMOVED_RULE.evidenceBoundary))) {
    throw new Error("New-pool market-cap-floor registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesMarketCapFloorRemovedRegistration(existing)) {
    throw new Error(`Existing new-pool market-cap-floor registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthEntry(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesRegistration)) {
    throw new Error("Register the frozen new-pool activation parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthEntryRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.evidenceBoundary))) {
    throw new Error("New-pool birth-entry registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthEntryRegistration(existing)) {
    throw new Error(`Existing new-pool birth-entry registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthMarketCapFloorRemoved(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBirthEntryRegistration)) {
    throw new Error("Register the frozen new-pool birth-entry parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthMarketCapFloorRemovedRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.evidenceBoundary))) {
    throw new Error("New-pool birth market-cap-floor registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthMarketCapFloorRemovedRegistration(existing)) {
    throw new Error(`Existing new-pool birth market-cap-floor registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthUpperMomentum(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBirthMarketCapFloorRemovedRegistration)) {
    throw new Error("Register the frozen new-pool birth market-cap-floor parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthUpperMomentumRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE.evidenceBoundary))) {
    throw new Error("New-pool birth upper-momentum registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthUpperMomentumRegistration(existing)) {
    throw new Error(`Existing new-pool birth upper-momentum registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthLowMomentum(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBirthMarketCapFloorRemovedRegistration)) {
    throw new Error("Register the frozen newborn low-cap parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthLowMomentumRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_LOW_MOMENTUM_RULE.evidenceBoundary))) {
    throw new Error("New-pool birth low-momentum registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthLowMomentumRegistration(existing)) {
    throw new Error(`Existing new-pool birth low-momentum registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthPath(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBirthEntryRegistration)) {
    throw new Error("Register the frozen new-pool birth-entry parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthPathRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_PATH_RULE.evidenceBoundary))) {
    throw new Error("New-pool birth-path registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthPathRegistration(existing)) {
    throw new Error(`Existing new-pool birth-path registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthCreatorBalance(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBirthMarketCapFloorRemovedRegistration)) {
    throw new Error("Register the frozen newborn low-cap parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthCreatorBalanceRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE.evidenceBoundary))) {
    throw new Error("Newborn creator-balance registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthCreatorBalanceRegistration(existing)) {
    throw new Error(`Existing newborn creator-balance registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthLpProvider(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBirthMarketCapFloorRemovedRegistration)) {
    throw new Error("Register the frozen newborn low-cap parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthLpProviderRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE.evidenceBoundary))) {
    throw new Error("Newborn LP-provider registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthLpProviderRegistration(existing)) {
    throw new Error(`Existing newborn LP-provider registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthRugCheckPanel(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBirthMarketCapFloorRemovedRegistration)) {
    throw new Error("Register the frozen newborn low-cap parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthRugCheckPanelRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.evidenceBoundary))) {
    throw new Error("Newborn RugCheck-panel registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthRugCheckPanelRegistration(existing)) {
    throw new Error(`Existing newborn RugCheck-panel registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthPairAge(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBirthMarketCapFloorRemovedRegistration)) {
    throw new Error("Register the frozen newborn low-cap parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthPairAgeRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE.evidenceBoundary))) {
    throw new Error("Newborn pair-age registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthPairAgeRegistration(existing)) {
    throw new Error(`Existing newborn pair-age registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthTurnover(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBirthMarketCapFloorRemovedRegistration)) {
    throw new Error("Register the frozen newborn low-cap parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthTurnoverRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_TURNOVER_RULE.evidenceBoundary))) {
    throw new Error("Newborn turnover registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthTurnoverRegistration(existing)) {
    throw new Error(`Existing newborn turnover registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthSocialPresence(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBirthMarketCapFloorRemovedRegistration)) {
    throw new Error("Register the frozen newborn low-cap parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthSocialPresenceRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE.evidenceBoundary))) {
    throw new Error("Newborn social-presence registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthSocialPresenceRegistration(existing)) {
    throw new Error(`Existing newborn social-presence registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthDangerCount(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBirthMarketCapFloorRemovedRegistration)) {
    throw new Error("Register the frozen newborn low-cap parent first.");
  }
  if (!events.some(matchesBirthRugCheckPanelRegistration)) {
    throw new Error("Register the frozen newborn RugCheck panel first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthDangerCountRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_DANGER_COUNT_RULE.evidenceBoundary))) {
    throw new Error("Newborn danger-count registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthDangerCountRegistration(existing)) {
    throw new Error(`Existing newborn danger-count registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthJupiterRoundTrip(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBirthMarketCapFloorRemovedRegistration)) {
    throw new Error("Register the frozen newborn low-cap parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthJupiterRoundTripRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE.evidenceBoundary))) {
    throw new Error("Newborn Jupiter round-trip registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthJupiterRoundTripRegistration(existing)) {
    throw new Error(`Existing newborn Jupiter round-trip registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function registerGeckoTerminalNewPoolBirthJupiterExecutable(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesBirthMarketCapFloorRemovedRegistration)) {
    throw new Error("Register the frozen newborn low-cap parent first.");
  }
  const proposed = createGeckoTerminalNewPoolBirthJupiterExecutableRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE.evidenceBoundary))) {
    throw new Error("Newborn Jupiter-executable registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesBirthJupiterExecutableRegistration(existing)) {
    throw new Error(`Existing newborn Jupiter-executable registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export function geckoNewbornCandidate(row, sourceRank, observedAt = new Date()) {
  const attributes = row?.attributes ?? {};
  const relationshipId = text(row?.relationships?.base_token?.data?.id);
  const tokenAddress = relationshipId?.startsWith("solana_")
    ? relationshipId.slice("solana_".length) : null;
  const pairAddress = text(attributes.address)
    ?? (text(row?.id)?.startsWith("solana_") ? text(row.id).slice("solana_".length) : null);
  const poolCreatedAtMs = Date.parse(attributes.pool_created_at ?? "");
  const observedAtMs = observedAt instanceof Date ? observedAt.getTime() : Date.parse(observedAt);
  const birthAgeMinutes = Number.isFinite(poolCreatedAtMs) && Number.isFinite(observedAtMs)
    ? (observedAtMs - poolCreatedAtMs) / 60_000 : null;
  const blockers = [];
  if (!tokenAddress) blockers.push("missing-solana-base-token");
  if (!pairAddress) blockers.push("missing-pool-address");
  if (!Number.isFinite(poolCreatedAtMs)) blockers.push("missing-pool-created-at");
  if (!(birthAgeMinutes >= 0
    && birthAgeMinutes
      <= GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.maximumBirthObservationAgeMinutesInclusive)) {
    blockers.push("pool-outside-newborn-observation-window");
  }
  const birthQuote = geckoTrendingCandidate(
    row,
    sourceRank,
    observedAt,
    GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
  );
  return {
    chain: "solana",
    tokenAddress,
    symbol: safeDisplaySymbol(attributes.name),
    pairAddress,
    sourceRank,
    poolCreatedAt: Number.isFinite(poolCreatedAtMs)
      ? new Date(poolCreatedAtMs).toISOString() : null,
    birthAgeMinutes: nullableRound(birthAgeMinutes),
    activationDueAt: Number.isFinite(poolCreatedAtMs)
      ? new Date(poolCreatedAtMs + FIFTEEN_MINUTES_MS).toISOString() : null,
    status: blockers.length ? "blocked" : "watchable",
    blockers,
    birthQuote,
    ruleVersion: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version,
  };
}

export async function watchGeckoTerminalNewPools(options = {}, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const startedAt = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matchesRegistration);
  if (!registration) throw new Error("Register the new-pool activation policy before watch.");
  const cadenceBucket = Math.floor(startedAt.getTime() / FIVE_MINUTES_MS);
  const existing = events.find((event) => (
    event.type === "geckoterminal-new-pool-discovery"
      && event.registrationId === registration.id
      && event.cadenceBucket === cadenceBucket
  ));
  if (existing) return watchResult(ledgerPath, startedAt, "skipped-existing-cadence", existing);

  const response = await fetcher(GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.sourceEndpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GeckoTerminal new pools returned HTTP ${response.status}.`);
  const payload = await response.json();
  const rows = Array.isArray(payload?.data)
    ? payload.data.slice(0, GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.sourceMaximumRows) : [];
  const observedAt = dependencies.clock?.() ?? (dependencies.now ? startedAt : new Date());
  if (!(observedAt.getTime() > Date.parse(registration.registeredAt)
    && observedAt.getTime()
      > Date.parse(GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.evidenceBoundary))) {
    throw new Error("GeckoTerminal new-pool observation must be strictly future-only.");
  }
  const evaluated = rows.map((row, index) => geckoNewbornCandidate(row, index + 1, observedAt));
  const watchedPairs = new Set(events
    .filter((event) => (
      event.type === "geckoterminal-new-pool-discovery"
        && event.registrationId === registration.id
    ))
    .flatMap((event) => (event.candidates ?? []).map((candidate) => candidate.pairAddress)));
  const firstPoolByToken = new Map();
  const selectionReasons = [];
  for (const candidate of evaluated) {
    if (candidate.status !== "watchable") {
      selectionReasons.push("blocked");
      continue;
    }
    if (watchedPairs.has(candidate.pairAddress)) {
      selectionReasons.push("duplicate-pool");
      continue;
    }
    if (!(Date.parse(candidate.poolCreatedAt) > Date.parse(registration.registeredAt))) {
      selectionReasons.push("pool-not-strictly-after-registration");
      continue;
    }
    if (!(Date.parse(candidate.poolCreatedAt)
      > Date.parse(GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.evidenceBoundary))) {
      selectionReasons.push("pool-not-strictly-after-evidence-boundary");
      continue;
    }
    if (firstPoolByToken.has(candidate.tokenAddress)) {
      selectionReasons.push("duplicate-token-secondary-pool");
      continue;
    }
    firstPoolByToken.set(candidate.tokenAddress, candidate);
    selectionReasons.push("selected");
  }
  const candidates = [...firstPoolByToken.values()];
  const selectionCounts = countValues(selectionReasons);
  const discovery = {
    type: "geckoterminal-new-pool-discovery",
    id: `geckoterminal_new_pool_discovery_${digestValue({
      registrationId: registration.id,
      cadenceBucket,
      observedAt: observedAt.toISOString(),
      pools: rows.map((row) => row?.attributes?.address ?? row?.id ?? null),
    }).slice(0, 24)}`,
    ruleVersion: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    provider: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.sourceProvider,
    sourceAttribution: "GeckoTerminal public API",
    endpoint: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.sourceEndpoint,
    chain: "solana",
    cadenceBucket,
    collectionStartedAt: startedAt.toISOString(),
    availableAt: observedAt.toISOString(),
    observedAt: observedAt.toISOString(),
    returnedRows: rows.length,
    evaluatedRows: evaluated.length,
    duplicatePoolCount: evaluated.filter((candidate) => watchedPairs.has(candidate.pairAddress)).length,
    rejectionCounts: countValues(evaluated.flatMap((candidate) => candidate.blockers)),
    selectionCounts,
    selectionReconciliationGate:
      Object.values(selectionCounts).reduce((sum, count) => sum + count, 0)
        === evaluated.length,
    candidates,
    researchOnly: true,
    mutationAllowed: false,
  };
  await appendLedgerEvent(ledgerPath, discovery);
  return watchResult(ledgerPath, observedAt, "recorded", discovery);
}

export async function captureGeckoTerminalNewPoolBirthEntries(
  options = {},
  dependencies = {},
) {
  const fetcher = dependencies.fetcher ?? fetch;
  const rugCheckReader = dependencies.rugCheckReader ?? readRugCheckReport;
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matchesBirthEntryRegistration) ?? null;
  const marketCapFloorRegistration = events.find(
    matchesBirthMarketCapFloorRemovedRegistration,
  ) ?? null;
  const upperMomentumRegistration = events.find(
    matchesBirthUpperMomentumRegistration,
  ) ?? null;
  const lowMomentumRegistration = events.find(
    matchesBirthLowMomentumRegistration,
  ) ?? null;
  const creatorBalanceRegistration = events.find(
    matchesBirthCreatorBalanceRegistration,
  ) ?? null;
  const lpProviderRegistration = events.find(
    matchesBirthLpProviderRegistration,
  ) ?? null;
  const rugCheckPanelRegistration = events.find(
    matchesBirthRugCheckPanelRegistration,
  ) ?? null;
  const pairAgeRegistration = events.find(
    matchesBirthPairAgeRegistration,
  ) ?? null;
  const turnoverRegistration = events.find(
    matchesBirthTurnoverRegistration,
  ) ?? null;
  const socialPresenceRegistration = events.find(
    matchesBirthSocialPresenceRegistration,
  ) ?? null;
  const dangerCountRegistration = events.find(
    matchesBirthDangerCountRegistration,
  ) ?? null;
  const jupiterRoundTripRegistration = events.find(
    matchesBirthJupiterRoundTripRegistration,
  ) ?? null;
  const jupiterExecutableRegistration = events.find(
    matchesBirthJupiterExecutableRegistration,
  ) ?? null;
  const sourceRegistration = events.find(matchesRegistration) ?? null;
  if (!registration || !sourceRegistration) {
    throw new Error("Register the new-pool parent and birth-entry policy before capture.");
  }
  const discoveries = events.filter((event) => (
    event.type === "geckoterminal-new-pool-discovery"
      && event.registrationId === sourceRegistration.id
      && Date.parse(event.observedAt) > Date.parse(registration.registeredAt)
  )).sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt));
  const discovery = discoveries[0] ?? null;
  if (!discovery) return birthCaptureResult(ledgerPath, now, "no-future-discovery", null, [], 0, []);
  const sourceLagMs = now.getTime() - Date.parse(discovery.observedAt);
  if (sourceLagMs < 0 || sourceLagMs > FIVE_MINUTES_MS) {
    return birthCaptureResult(
      ledgerPath,
      now,
      "source-outside-capture-window",
      discovery.id,
      [],
      0,
      [],
    );
  }
  const resolvedIds = new Set(events
    .filter((event) => event.type === "geckoterminal-new-pool-resolution")
    .map((event) => event.forecastId));
  const openTokens = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && !resolvedIds.has(event.id)
  )).map(tokenEdgeAssetKey));
  const existingForecastKeys = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && event.discoveryEventId === discovery.id
  )).map((event) => `${event.registrationId}:${tokenEdgeAssetKey(event)}`));
  const candidates = [];
  const candidateCounts = new Map();
  for (const newborn of discovery.candidates ?? []) {
    const candidate = newborn.birthQuote;
    const policies = [
      {
        registration,
        rule: GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
        eligible: validBirthEntryCandidate(candidate, newborn, registration),
      },
      ...(marketCapFloorRegistration ? [{
        registration: marketCapFloorRegistration,
        rule: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE,
        eligible: validBirthMarketCapFloorRemovedCandidate(
          candidate,
          newborn,
          marketCapFloorRegistration,
        ),
      }] : []),
      ...(upperMomentumRegistration ? [{
        registration: upperMomentumRegistration,
        rule: GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE,
        eligible: validBirthUpperMomentumCandidate(
          candidate,
          newborn,
          upperMomentumRegistration,
        ),
      }] : []),
    ];
    for (const policy of policies) {
      const assetKey = tokenEdgeAssetKey(candidate);
      const policyKey = `${policy.registration.id}:${assetKey}`;
      const count = candidateCounts.get(policy.registration.id) ?? 0;
      if (!policy.eligible
        || openTokens.has(assetKey)
        || existingForecastKeys.has(policyKey)
        || count >= policy.rule.maximumCandidates
        || candidates.some((item) => tokenEdgeAssetKey(item.candidate) === assetKey)) continue;
      candidates.push({ newborn, candidate, ...policy });
      candidateCounts.set(policy.registration.id, count + 1);
    }
  }
  const activeJupiterExecutableRegistration = jupiterExecutableRegistration
    && Date.parse(discovery.observedAt) > Date.parse(jupiterExecutableRegistration.registeredAt)
    ? jupiterExecutableRegistration : null;
  const jupiterExecutableResolvedIds = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-jupiter-executable-resolution"
  )).map((event) => event.decisionId));
  const openJupiterExecutableTokens = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-jupiter-executable-decision"
      && !jupiterExecutableResolvedIds.has(event.id)
  )).map(tokenEdgeAssetKey));
  const existingJupiterExecutableKeys = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-jupiter-executable-decision"
      && event.discoveryEventId === discovery.id
  )).map((event) => `${event.registrationId}:${tokenEdgeAssetKey(event)}`));
  const jupiterExecutableCandidates = activeJupiterExecutableRegistration
    ? (discovery.candidates ?? []).map((newborn) => ({
      newborn,
      candidate: newborn.birthQuote,
      registration: activeJupiterExecutableRegistration,
      rule: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE,
    })).filter(({ newborn, candidate, registration: executableRegistration }) => {
      const assetKey = tokenEdgeAssetKey(candidate);
      return validBirthMarketCapFloorRemovedCandidate(
        candidate,
        newborn,
        executableRegistration,
      )
        && !GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE.derivation
          .excludedTokenAddresses.includes(candidate.tokenAddress)
        && !openJupiterExecutableTokens.has(assetKey)
        && !existingJupiterExecutableKeys.has(`${executableRegistration.id}:${assetKey}`);
    }).slice(
      0,
      GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE.maximumCandidatesPerCapture,
    ) : [];
  if (!candidates.length && !jupiterExecutableCandidates.length) {
    return birthCaptureResult(ledgerPath, now, "recorded-no-eligible-candidates", discovery.id, [], 0, []);
  }
  const activeCreatorBalanceRegistration = creatorBalanceRegistration
    && Date.parse(discovery.observedAt) > Date.parse(creatorBalanceRegistration.registeredAt)
    ? creatorBalanceRegistration : null;
  const activeLpProviderRegistration = lpProviderRegistration
    && Date.parse(discovery.observedAt) > Date.parse(lpProviderRegistration.registeredAt)
    ? lpProviderRegistration : null;
  const activeRugCheckPanelRegistration = rugCheckPanelRegistration
    && Date.parse(discovery.observedAt) > Date.parse(rugCheckPanelRegistration.registeredAt)
    ? rugCheckPanelRegistration : null;
  const activePairAgeRegistration = pairAgeRegistration
    && Date.parse(discovery.observedAt) > Date.parse(pairAgeRegistration.registeredAt)
    ? pairAgeRegistration : null;
  const activeTurnoverRegistration = turnoverRegistration
    && Date.parse(discovery.observedAt) > Date.parse(turnoverRegistration.registeredAt)
    ? turnoverRegistration : null;
  const activeLowMomentumRegistration = lowMomentumRegistration
    && Date.parse(discovery.observedAt) > Date.parse(lowMomentumRegistration.registeredAt)
    ? lowMomentumRegistration : null;
  const activeSocialPresenceRegistration = socialPresenceRegistration
    && Date.parse(discovery.observedAt) > Date.parse(socialPresenceRegistration.registeredAt)
    ? socialPresenceRegistration : null;
  const activeDangerCountRegistration = dangerCountRegistration
    && Date.parse(discovery.observedAt) > Date.parse(dangerCountRegistration.registeredAt)
    ? dangerCountRegistration : null;
  const activeJupiterRoundTripRegistration = jupiterRoundTripRegistration
    && Date.parse(discovery.observedAt) > Date.parse(jupiterRoundTripRegistration.registeredAt)
    ? jupiterRoundTripRegistration : null;
  const creatorEvidence = (activeCreatorBalanceRegistration
    || activeLpProviderRegistration
    || activeRugCheckPanelRegistration)
    ? await collectNewbornCreatorBalanceEvidence({
      candidates,
      creatorBalanceRegistration: activeCreatorBalanceRegistration,
      lpProviderRegistration: activeLpProviderRegistration,
      rugCheckPanelRegistration: activeRugCheckPanelRegistration,
      discovery,
      events,
      ledgerPath,
      now,
      responseClock: dependencies.evidenceClock
        ?? (() => (dependencies.now ? now : new Date())),
      rugCheckReader,
    })
    : {
      byToken: new Map(),
      lpByToken: new Map(),
      riskByToken: new Map(),
      requestsAttempted: 0,
      failures: [],
    };
  const jupiterQuoteReader = dependencies.jupiterQuoteReader
    ?? ((quoteOptions) => readJupiterExactInQuote({
      ...quoteOptions,
      fetcher: dependencies.jupiterFetcher ?? fetch,
    }));
  const jupiterExecutableQuotes = jupiterExecutableCandidates.length
    ? await collectNewbornJupiterExecutableQuotes({
      candidates: jupiterExecutableCandidates,
      responseClock: dependencies.jupiterExecutableClock
        ?? dependencies.jupiterEvidenceClock
        ?? dependencies.evidenceClock
        ?? (() => (dependencies.now ? now : new Date())),
      quoteReader: jupiterQuoteReader,
    })
    : { byToken: new Map(), requestsAttempted: 0, failures: [] };
  const direct = await collectDexDirectPairs(
    candidates.map(({ candidate }) => candidate.tokenAddress),
    fetcher,
  );
  const failures = [
    ...creatorEvidence.failures,
    ...jupiterExecutableQuotes.failures,
    ...direct.failures,
  ];
  const consensusCandidates = [];
  for (const candidateItem of candidates) {
    const consensus = geckoDexDirectConsensus(
      candidateItem.candidate,
      direct,
      candidateItem.rule,
    );
    if (consensus.reason) {
      failures.push(`New-pool birth entry rejected ${candidateItem.candidate.tokenAddress} ${candidateItem.candidate.pairAddress}: ${consensus.reason}`);
      continue;
    }
    consensusCandidates.push({ ...candidateItem, consensus });
  }
  const jupiterEvidence = activeJupiterRoundTripRegistration
    ? await collectNewbornJupiterRoundTripEvidence({
      candidates: activeJupiterExecutableRegistration
        ? consensusCandidates.filter(({ candidate }) => (
          jupiterExecutableQuotes.byToken.has(candidate.tokenAddress)
        ))
        : consensusCandidates,
      registration: activeJupiterRoundTripRegistration,
      discovery,
      events,
      ledgerPath,
      now,
      responseClock: dependencies.jupiterEvidenceClock
        ?? dependencies.evidenceClock
        ?? (() => (dependencies.now ? now : new Date())),
      quoteReader: jupiterQuoteReader,
      prefetchedByToken: jupiterExecutableQuotes.byToken,
    })
    : { byToken: new Map(), requestsAttempted: 0, failures: [] };
  failures.push(...jupiterEvidence.failures);
  const capturedAt = dependencies.captureClock?.()
    ?? (dependencies.now ? now : new Date());
  if (capturedAt.getTime() < Date.parse(discovery.observedAt)
    || capturedAt.getTime() - Date.parse(discovery.observedAt) > FIVE_MINUTES_MS) {
    return birthCaptureResult(
      ledgerPath,
      capturedAt,
      "source-outside-capture-window",
      discovery.id,
      [],
      direct.requestsAttempted
        + creatorEvidence.requestsAttempted
        + jupiterExecutableQuotes.requestsAttempted
        + jupiterEvidence.requestsAttempted,
      failures,
    );
  }
  const jupiterExecutableDecisions = [];
  for (const quote of jupiterExecutableQuotes.byToken.values()) {
    const availableAt = Date.parse(quote.availableAt);
    if (!(availableAt >= Date.parse(discovery.observedAt)
      && availableAt <= capturedAt.getTime())) {
      failures.push(`Jupiter executable decision timing invalid ${quote.candidate.tokenAddress}.`);
      continue;
    }
    const decision = jupiterExecutableDecisionEvent({
      registration: activeJupiterExecutableRegistration,
      discovery,
      newborn: quote.newborn,
      candidate: quote.candidate,
      quoteAggregate: quote.aggregate,
      quoteAvailableAt: quote.availableAt,
      quoteObservedAt: now,
      createdAt: capturedAt,
    });
    const signed = await appendLedgerEvent(ledgerPath, decision);
    events.push(signed);
    jupiterExecutableDecisions.push(signed);
  }
  const forecasts = [];
  for (const {
    newborn,
    candidate,
    registration: candidateRegistration,
    rule,
    consensus,
  } of consensusCandidates) {
    forecasts.push(await appendLedgerEvent(ledgerPath, newPoolBirthForecastEvent({
      registration: candidateRegistration,
      rule,
      discovery,
      candidate,
      consensus,
      createdAt: capturedAt,
      creatorBalanceRegistration: activeCreatorBalanceRegistration,
      creatorBalanceEvidence: creatorEvidence.byToken.get(candidate.tokenAddress) ?? null,
      lpProviderRegistration: activeLpProviderRegistration,
      lpProviderEvidence: creatorEvidence.lpByToken.get(candidate.tokenAddress) ?? null,
      pairAgeRegistration: activePairAgeRegistration,
      turnoverRegistration: activeTurnoverRegistration,
      lowMomentumRegistration: activeLowMomentumRegistration,
      socialPresenceRegistration: activeSocialPresenceRegistration,
      dangerCountRegistration: activeDangerCountRegistration
        && Date.parse(newborn.poolCreatedAt)
          > Date.parse(activeDangerCountRegistration.registeredAt)
        ? activeDangerCountRegistration : null,
      rugCheckRiskEvidence: creatorEvidence.riskByToken.get(candidate.tokenAddress) ?? null,
    })));
  }
  return birthCaptureResult(
    ledgerPath,
    capturedAt,
    "recorded",
    discovery.id,
    forecasts,
    direct.requestsAttempted
      + creatorEvidence.requestsAttempted
      + jupiterExecutableQuotes.requestsAttempted
      + jupiterEvidence.requestsAttempted,
    failures,
    jupiterExecutableDecisions,
  );
}

async function collectNewbornCreatorBalanceEvidence({
  candidates,
  creatorBalanceRegistration,
  lpProviderRegistration,
  rugCheckPanelRegistration,
  discovery,
  events,
  ledgerPath,
  now,
  responseClock,
  rugCheckReader,
}) {
  const byToken = new Map();
  const lpByToken = new Map();
  const riskByToken = new Map();
  const failures = [];
  let requestsAttempted = 0;
  const lowCapCandidates = candidates.filter(({ rule }) => (
    rule.version === GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version
  ));
  for (const { candidate, newborn } of lowCapCandidates) {
    const creatorEvidenceId = creatorBalanceRegistration
      ? `geckoterminal_new_pool_creator_balance_${digestValue({
        registrationId: creatorBalanceRegistration.id,
        discoveryEventId: discovery.id,
        tokenAddress: candidate.tokenAddress,
      }).slice(0, 24)}` : null;
    const lpEvidenceId = lpProviderRegistration
      ? `geckoterminal_new_pool_lp_provider_${digestValue({
        registrationId: lpProviderRegistration.id,
        discoveryEventId: discovery.id,
        tokenAddress: candidate.tokenAddress,
      }).slice(0, 24)}` : null;
    const riskPanelEligible = Boolean(
      rugCheckPanelRegistration
        && Date.parse(newborn.poolCreatedAt)
          > Date.parse(rugCheckPanelRegistration.registeredAt)
        && !GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.derivation
          .excludedTokenAddresses.includes(candidate.tokenAddress),
    );
    const riskEvidenceId = riskPanelEligible
      ? `geckoterminal_new_pool_rugcheck_risk_${digestValue({
        registrationId: rugCheckPanelRegistration.id,
        discoveryEventId: discovery.id,
        tokenAddress: candidate.tokenAddress,
      }).slice(0, 24)}` : null;
    const existingCreator = creatorEvidenceId
      ? events.find((event) => event.id === creatorEvidenceId) ?? null : null;
    const existingLp = lpEvidenceId
      ? events.find((event) => event.id === lpEvidenceId) ?? null : null;
    const existingRisk = riskEvidenceId
      ? events.find((event) => event.id === riskEvidenceId) ?? null : null;
    if (existingCreator) {
      if (!validNewbornCreatorBalanceEvidenceEnvelope({
        evidence: existingCreator,
        registration: creatorBalanceRegistration,
        discovery,
        tokenAddress: candidate.tokenAddress,
      })) throw new Error(`Existing newborn creator-balance evidence mismatch: ${creatorEvidenceId}`);
      byToken.set(candidate.tokenAddress, existingCreator);
    }
    if (existingLp) {
      if (!validNewbornLpProviderEvidenceEnvelope({
        evidence: existingLp,
        registration: lpProviderRegistration,
        discovery,
        tokenAddress: candidate.tokenAddress,
      })) throw new Error(`Existing newborn LP-provider evidence mismatch: ${lpEvidenceId}`);
      lpByToken.set(candidate.tokenAddress, existingLp);
    }
    if (existingRisk) {
      if (!validNewbornRugCheckRiskEvidenceEnvelope({
        evidence: existingRisk,
        registration: rugCheckPanelRegistration,
        discovery,
        tokenAddress: candidate.tokenAddress,
        pairAddress: candidate.pairAddress,
        poolCreatedAt: newborn.poolCreatedAt,
      })) throw new Error(`Existing newborn RugCheck risk evidence mismatch: ${riskEvidenceId}`);
      riskByToken.set(candidate.tokenAddress, existingRisk);
    }
    if ((!creatorBalanceRegistration || existingCreator)
      && (!lpProviderRegistration || existingLp)
      && (!riskPanelEligible || existingRisk)) continue;
    requestsAttempted += 1;
    let report = null;
    let reportError = null;
    try {
      report = await rugCheckReader(candidate.tokenAddress);
    } catch (error) {
      reportError = error instanceof Error ? error.message : String(error);
    }
    const availableAt = validIso(responseClock());
    if (creatorBalanceRegistration && !existingCreator) {
      let aggregate;
      try {
        if (!report) throw new Error(reportError ?? "missing-report");
        aggregate = normalizeNewbornCreatorBalanceAggregate(report, candidate.tokenAddress);
      } catch (error) {
        aggregate = canonicalNewbornCreatorBalanceAggregate({ coverage: "unavailable" });
        failures.push(`RugCheck creator balance unavailable ${candidate.tokenAddress}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (aggregate.coverage !== "complete" && !reportError) {
        failures.push(`RugCheck creator balance unavailable ${candidate.tokenAddress}: incomplete-report`);
      }
      const evidence = {
        type: "geckoterminal-new-pool-creator-balance-snapshot",
        id: creatorEvidenceId,
        ruleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE.version,
        registrationId: creatorBalanceRegistration.id,
        discoveryEventId: discovery.id,
        provider: GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE.evidenceProvider,
        chain: candidate.chain,
        tokenAddress: candidate.tokenAddress,
        observedAt: now.toISOString(),
        availableAt,
        aggregate,
        aggregateDigest: digestValue(aggregate),
        aggregateOnly: true,
        rawIdentitiesRetained: false,
        researchOnly: true,
        mutationAllowed: false,
      };
      const signed = await appendLedgerEvent(ledgerPath, evidence);
      events.push(signed);
      byToken.set(candidate.tokenAddress, signed);
    }
    if (lpProviderRegistration && !existingLp) {
      let aggregate;
      try {
        if (!report) throw new Error(reportError ?? "missing-report");
        aggregate = normalizeNewbornLpProviderAggregate(report, candidate.tokenAddress);
      } catch (error) {
        aggregate = canonicalNewbornLpProviderAggregate({ coverage: "unavailable" });
        failures.push(`RugCheck LP-provider count unavailable ${candidate.tokenAddress}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (aggregate.coverage !== "complete" && !reportError) {
        failures.push(`RugCheck LP-provider count unavailable ${candidate.tokenAddress}: incomplete-report`);
      }
      const evidence = {
        type: "geckoterminal-new-pool-lp-provider-snapshot",
        id: lpEvidenceId,
        ruleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE.version,
        registrationId: lpProviderRegistration.id,
        discoveryEventId: discovery.id,
        provider: GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE.evidenceProvider,
        chain: candidate.chain,
        tokenAddress: candidate.tokenAddress,
        observedAt: now.toISOString(),
        availableAt,
        aggregate,
        aggregateDigest: digestValue(aggregate),
        aggregateOnly: true,
        rawIdentitiesRetained: false,
        researchOnly: true,
        mutationAllowed: false,
      };
      const signed = await appendLedgerEvent(ledgerPath, evidence);
      events.push(signed);
      lpByToken.set(candidate.tokenAddress, signed);
    }
    if (riskPanelEligible && !existingRisk) {
      let aggregate;
      try {
        if (!report) throw new Error(reportError ?? "missing-report");
        aggregate = normalizeRugCheckReportAggregate(
          report,
          candidate.tokenAddress,
          candidate.pairAddress,
        );
      } catch (error) {
        aggregate = canonicalRugCheckAggregate({ coverage: "unavailable" });
        failures.push(`RugCheck risk panel unavailable ${candidate.tokenAddress}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const evidence = {
        type: "geckoterminal-new-pool-rugcheck-risk-snapshot",
        id: riskEvidenceId,
        ruleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.version,
        registrationId: rugCheckPanelRegistration.id,
        discoveryEventId: discovery.id,
        provider: GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.evidenceProvider,
        chain: candidate.chain,
        tokenAddress: candidate.tokenAddress,
        pairAddress: candidate.pairAddress,
        poolCreatedAt: newborn.poolCreatedAt,
        observedAt: now.toISOString(),
        availableAt,
        aggregate,
        aggregateDigest: digestValue(aggregate),
        aggregateOnly: true,
        rawIdentitiesRetained: false,
        researchOnly: true,
        mutationAllowed: false,
      };
      const signed = await appendLedgerEvent(ledgerPath, evidence);
      events.push(signed);
      riskByToken.set(candidate.tokenAddress, signed);
    }
  }
  return { byToken, lpByToken, riskByToken, requestsAttempted, failures };
}

async function collectNewbornJupiterRoundTripEvidence({
  candidates,
  registration,
  discovery,
  events,
  ledgerPath,
  now,
  responseClock,
  quoteReader,
  prefetchedByToken = new Map(),
}) {
  const byToken = new Map();
  const failures = [];
  let requestsAttempted = 0;
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE;
  const eligible = candidates.filter(({ candidate, newborn, rule: sourceRule }) => (
    sourceRule.version === GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version
      && Date.parse(newborn.poolCreatedAt) > Date.parse(registration.registeredAt)
      && !rule.derivation.excludedTokenAddresses.includes(candidate.tokenAddress)
  )).slice(0, rule.maximumCandidatesPerCapture);
  for (const { candidate, newborn } of eligible) {
    const evidenceId = `geckoterminal_new_pool_jupiter_roundtrip_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
      tokenAddress: candidate.tokenAddress,
    }).slice(0, 24)}`;
    const existing = events.find((event) => event.id === evidenceId) ?? null;
    if (existing) {
      if (!validNewbornJupiterRoundTripEvidenceEnvelope({
        evidence: existing,
        registration,
        discovery,
        tokenAddress: candidate.tokenAddress,
        pairAddress: candidate.pairAddress,
        poolCreatedAt: newborn.poolCreatedAt,
      })) throw new Error(`Existing newborn Jupiter round-trip evidence mismatch: ${evidenceId}`);
      byToken.set(candidate.tokenAddress, existing);
      continue;
    }
    const prefetched = prefetchedByToken.get(candidate.tokenAddress) ?? null;
    const quote = prefetched ?? await quoteNewbornJupiterRoundTrip({
      rule,
      tokenAddress: candidate.tokenAddress,
      quoteReader,
      responseClock,
    });
    requestsAttempted += prefetched ? 0 : quote.requestsAttempted;
    if (!prefetched && quote.failure) {
      failures.push(`Jupiter round-trip unavailable ${candidate.tokenAddress}: ${quote.failure}`);
    }
    const evidence = {
      type: "geckoterminal-new-pool-jupiter-roundtrip-snapshot",
      id: evidenceId,
      ruleVersion: rule.version,
      registrationId: registration.id,
      discoveryEventId: discovery.id,
      provider: rule.evidenceProvider,
      chain: candidate.chain,
      tokenAddress: candidate.tokenAddress,
      pairAddress: candidate.pairAddress,
      poolCreatedAt: newborn.poolCreatedAt,
      observedAt: now.toISOString(),
      availableAt: quote.availableAt,
      aggregate: quote.aggregate,
      aggregateDigest: digestValue(quote.aggregate),
      aggregateOnly: true,
      rawRoutesRetained: false,
      researchOnly: true,
      mutationAllowed: false,
    };
    const signed = await appendLedgerEvent(ledgerPath, evidence);
    events.push(signed);
    byToken.set(candidate.tokenAddress, signed);
  }
  return { byToken, requestsAttempted, failures };
}

async function quoteNewbornJupiterRoundTrip({
  rule,
  tokenAddress,
  quoteReader,
  responseClock,
}) {
  let requestsAttempted = 0;
  let aggregate;
  let failure = null;
  try {
    requestsAttempted += 1;
    const buy = await quoteReader({
      inputMint: rule.inputMint,
      outputMint: tokenAddress,
      amountAtomic: String(rule.inputUsdcAtomic),
    });
    if (buy?.status === "no-route") {
      aggregate = canonicalNewbornJupiterRoundTripAggregate({
        status: "no-buy-route",
        inputUsdcAtomic: String(rule.inputUsdcAtomic),
      });
    } else if (buy?.status === "quoted" && positiveAtomicString(buy.outputAmountAtomic)) {
      requestsAttempted += 1;
      const sell = await quoteReader({
        inputMint: tokenAddress,
        outputMint: rule.inputMint,
        amountAtomic: buy.outputAmountAtomic,
      });
      if (sell?.status === "no-route") {
        aggregate = canonicalNewbornJupiterRoundTripAggregate({
          status: "no-sell-route",
          inputUsdcAtomic: String(rule.inputUsdcAtomic),
          buyOutputTokenAtomic: buy.outputAmountAtomic,
          buyPriceImpactPct: buy.priceImpactPct,
          buySwapUsdValue: buy.swapUsdValue,
          buyRouteHopCount: buy.routeHopCount,
        });
      } else if (sell?.status === "quoted"
        && positiveAtomicString(sell.outputAmountAtomic)) {
        const roundTripReturnPct = ((Number(sell.outputAmountAtomic)
          / rule.inputUsdcAtomic) - 1) * 100;
        aggregate = canonicalNewbornJupiterRoundTripAggregate({
          status: "round-trip-quoted",
          inputUsdcAtomic: String(rule.inputUsdcAtomic),
          buyOutputTokenAtomic: buy.outputAmountAtomic,
          sellOutputUsdcAtomic: sell.outputAmountAtomic,
          roundTripReturnPct,
          buyPriceImpactPct: buy.priceImpactPct,
          sellPriceImpactPct: sell.priceImpactPct,
          buySwapUsdValue: buy.swapUsdValue,
          sellSwapUsdValue: sell.swapUsdValue,
          buyRouteHopCount: buy.routeHopCount,
          sellRouteHopCount: sell.routeHopCount,
        });
      } else {
        throw new Error("invalid-sell-quote");
      }
    } else {
      throw new Error("invalid-buy-quote");
    }
  } catch (error) {
    aggregate = canonicalNewbornJupiterRoundTripAggregate({
      status: "provider-unavailable",
      inputUsdcAtomic: String(rule.inputUsdcAtomic),
    });
    failure = error instanceof Error ? error.message : String(error);
  }
  return {
    aggregate,
    availableAt: validIso(responseClock()),
    requestsAttempted,
    failure,
  };
}

async function collectNewbornJupiterExecutableQuotes({
  candidates,
  responseClock,
  quoteReader,
}) {
  const byToken = new Map();
  const failures = [];
  let requestsAttempted = 0;
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE;
  for (const { candidate, newborn } of candidates.slice(0, rule.maximumCandidatesPerCapture)) {
    const quote = await quoteNewbornJupiterRoundTrip({
      rule,
      tokenAddress: candidate.tokenAddress,
      quoteReader,
      responseClock,
    });
    requestsAttempted += quote.requestsAttempted;
    if (quote.failure) {
      failures.push(`Jupiter executable entry unavailable ${candidate.tokenAddress}: ${quote.failure}`);
    }
    byToken.set(candidate.tokenAddress, { ...quote, candidate, newborn });
  }
  return { byToken, requestsAttempted, failures };
}

export function normalizeNewbornCreatorBalanceAggregate(report, tokenAddress) {
  if (report?.mint !== tokenAddress) throw new Error("RugCheck returned a mismatched mint.");
  const supply = positiveNumber(report?.token?.supply ?? report?.tokenMeta?.supply ?? report?.supply);
  const creatorBalance = nonnegativeNumber(report?.creatorBalance);
  const creatorBalancePct = Number.isFinite(supply) && Number.isFinite(creatorBalance)
    ? (creatorBalance / supply) * 100 : null;
  return canonicalNewbornCreatorBalanceAggregate({
    coverage: Number.isFinite(creatorBalancePct) && creatorBalancePct <= 100
      ? "complete" : "unavailable",
    creatorBalancePct,
    totalHolders: report?.totalHolders,
  });
}

export function canonicalNewbornCreatorBalanceAggregate(value) {
  const creatorBalancePct = nonnegativeNumber(value?.creatorBalancePct);
  return {
    coverage: value?.coverage === "complete"
      && Number.isFinite(creatorBalancePct)
      && creatorBalancePct <= 100 ? "complete" : "unavailable",
    creatorBalancePct: Number.isFinite(creatorBalancePct) && creatorBalancePct <= 100
      ? nullableRound(creatorBalancePct) : null,
    totalHolders: nonnegativeInteger(value?.totalHolders),
  };
}

export function normalizeNewbornLpProviderAggregate(report, tokenAddress) {
  if (report?.mint !== tokenAddress) throw new Error("RugCheck returned a mismatched mint.");
  return canonicalNewbornLpProviderAggregate({
    coverage: Number.isInteger(Number(report?.totalLPProviders)) ? "complete" : "unavailable",
    totalLpProviders: report?.totalLPProviders,
  });
}

export function canonicalNewbornLpProviderAggregate(value) {
  const totalLpProviders = nonnegativeInteger(value?.totalLpProviders);
  return {
    coverage: value?.coverage === "complete" && Number.isInteger(totalLpProviders)
      ? "complete" : "unavailable",
    totalLpProviders,
  };
}

export async function readJupiterExactInQuote({
  inputMint,
  outputMint,
  amountAtomic,
  fetcher = fetch,
}) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE;
  const url = new URL("/swap/v1/quote", rule.evidenceBaseUrl);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", String(amountAtomic));
  url.searchParams.set("slippageBps", String(rule.slippageBps));
  url.searchParams.set("swapMode", rule.swapMode);
  url.searchParams.set("restrictIntermediateTokens", String(rule.restrictIntermediateTokens));
  const response = await fetcher(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = text(payload?.error) ?? text(payload?.errorMessage) ?? "";
    const errorCode = text(payload?.errorCode);
    if (response.status === 400 && (
      /no routes? found|could not find any route|not tradable/i.test(message)
        || ["TOKEN_NOT_TRADABLE", "COULD_NOT_FIND_ANY_ROUTE"].includes(errorCode)
    )) {
      return { status: "no-route" };
    }
    throw new Error(`Jupiter quote returned HTTP ${response.status}.`);
  }
  const outputAmountAtomic = positiveAtomicString(payload?.outAmount);
  if (!outputAmountAtomic) throw new Error("Jupiter quote returned no positive output amount.");
  return {
    status: "quoted",
    outputAmountAtomic,
    priceImpactPct: nonnegativeNumber(payload?.priceImpactPct),
    swapUsdValue: nonnegativeNumber(payload?.swapUsdValue),
    routeHopCount: Math.min(20, Array.isArray(payload?.routePlan) ? payload.routePlan.length : 0),
  };
}

export function canonicalNewbornJupiterRoundTripAggregate(value) {
  const allowedStatuses = new Set([
    "round-trip-quoted",
    "no-buy-route",
    "no-sell-route",
    "provider-unavailable",
  ]);
  const status = allowedStatuses.has(value?.status)
    ? value.status : "provider-unavailable";
  const coverage = status === "provider-unavailable" ? "unavailable" : "complete";
  const inputUsdcAtomic = positiveAtomicString(value?.inputUsdcAtomic);
  const buyOutputTokenAtomic = positiveAtomicString(value?.buyOutputTokenAtomic);
  const sellOutputUsdcAtomic = positiveAtomicString(value?.sellOutputUsdcAtomic);
  const roundTripReturnPct = finiteNumber(value?.roundTripReturnPct);
  const buyPriceImpactPct = nonnegativeNumber(value?.buyPriceImpactPct);
  const sellPriceImpactPct = nonnegativeNumber(value?.sellPriceImpactPct);
  const buySwapUsdValue = nonnegativeNumber(value?.buySwapUsdValue);
  const sellSwapUsdValue = nonnegativeNumber(value?.sellSwapUsdValue);
  const buyRouteHopCount = nonnegativeInteger(value?.buyRouteHopCount);
  const sellRouteHopCount = nonnegativeInteger(value?.sellRouteHopCount);
  const completeRoundTrip = status === "round-trip-quoted"
    && inputUsdcAtomic
    && buyOutputTokenAtomic
    && sellOutputUsdcAtomic
    && Number.isFinite(roundTripReturnPct);
  const validNoSellRoute = status === "no-sell-route"
    && inputUsdcAtomic
    && buyOutputTokenAtomic;
  const validNoBuyRoute = status === "no-buy-route" && inputUsdcAtomic;
  const valid = status === "provider-unavailable"
    || completeRoundTrip
    || validNoSellRoute
    || validNoBuyRoute;
  return {
    coverage: valid ? coverage : "unavailable",
    status: valid ? status : "provider-unavailable",
    inputUsdcAtomic: inputUsdcAtomic ?? String(JUPITER_ROUND_TRIP_INPUT_USDC_ATOMIC),
    buyOutputTokenAtomic: valid && status !== "no-buy-route"
      ? buyOutputTokenAtomic : null,
    sellOutputUsdcAtomic: valid && status === "round-trip-quoted"
      ? sellOutputUsdcAtomic : null,
    roundTripReturnPct: valid && status === "round-trip-quoted"
      ? nullableRound(roundTripReturnPct) : null,
    buyPriceImpactPct: valid && status !== "no-buy-route"
      ? nullableRound(buyPriceImpactPct) : null,
    sellPriceImpactPct: valid && status === "round-trip-quoted"
      ? nullableRound(sellPriceImpactPct) : null,
    buySwapUsdValue: valid && status !== "no-buy-route"
      ? nullableRound(buySwapUsdValue) : null,
    sellSwapUsdValue: valid && status === "round-trip-quoted"
      ? nullableRound(sellSwapUsdValue) : null,
    buyRouteHopCount: valid && status !== "no-buy-route" ? buyRouteHopCount : null,
    sellRouteHopCount: valid && status === "round-trip-quoted"
      ? sellRouteHopCount : null,
  };
}

export async function activateGeckoTerminalNewPools(options = {}, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matchesRegistration);
  if (!registration) throw new Error("Register the new-pool activation policy before activation.");
  const marketCapFloorRegistration = events.find(
    matchesMarketCapFloorRemovedRegistration,
  ) ?? null;
  const activated = new Set(events
    .filter((event) => event.type === "geckoterminal-new-pool-activation")
    .map((event) => `${event.discoveryEventId}:${event.pairAddress}`));
  const due = events
    .filter((event) => (
      event.type === "geckoterminal-new-pool-discovery"
        && event.registrationId === registration.id
    ))
    .flatMap((discovery) => (discovery.candidates ?? []).map((candidate) => ({
      discovery,
      candidate,
      key: `${discovery.id}:${candidate.pairAddress}`,
      dueAtMs: Date.parse(candidate.activationDueAt),
    })))
    .filter((item) => !activated.has(item.key) && item.dueAtMs <= now.getTime())
    .sort((left, right) => left.dueAtMs - right.dueAtMs);
  if (!due.length) return activationResult(ledgerPath, now, 0, 0, [], [], []);

  const activationEvents = [];
  const preservedFailures = due.filter((item) => (
    PRE_FAIL_CLOSED_ACTIVATION_FAILURES.has(item.key)
  ));
  for (const item of preservedFailures) {
    const reason = PRE_FAIL_CLOSED_ACTIVATION_FAILURES.get(item.key);
    activationEvents.push(await appendLedgerEvent(ledgerPath, activationEvent({
      item,
      observedAt: now,
      status: "missed",
      reason,
      candidate: null,
      entryStatus: "cash",
      entryReason: reason,
    })));
  }
  const remainingDue = due.filter((item) => (
    !PRE_FAIL_CLOSED_ACTIVATION_FAILURES.has(item.key)
  ));
  const live = remainingDue.filter((item) => (
    now.getTime() - item.dueAtMs <= TEN_MINUTES_MS
  ));
  const expired = remainingDue.filter((item) => !live.includes(item));
  for (const item of expired) {
    activationEvents.push(await appendLedgerEvent(ledgerPath, activationEvent({
      item,
      observedAt: now,
      status: "missed",
      reason: "activation-window-expired",
      candidate: null,
      entryStatus: "cash",
      entryReason: "activation-window-expired",
    })));
  }
  if (!live.length) {
    return activationResult(ledgerPath, now, due.length, 0, activationEvents, [], []);
  }

  const multi = await collectGeckoMultiPools(
    live.map((item) => item.candidate.pairAddress),
    fetcher,
  );
  if (multi.failures.length && multi.rowsByPair.size === 0) {
    return activationResult(
      ledgerPath,
      now,
      due.length,
      multi.requestsAttempted,
      activationEvents,
      [],
      multi.failures,
    );
  }
  const sourceObservedAt = dependencies.clock?.() ?? (dependencies.now ? now : new Date());
  const prepared = [];
  const failures = [...multi.failures];
  for (const item of live) {
    const row = multi.rowsByPair.get(item.candidate.pairAddress);
    if (!row) {
      failures.push(`New-pool activation exact pool unavailable: ${item.candidate.pairAddress}`);
      activationEvents.push(await appendLedgerEvent(ledgerPath, activationEvent({
        item,
        observedAt: sourceObservedAt,
        status: "missed",
        reason: "activation-exact-pool-unavailable",
        candidate: null,
        entryStatus: "cash",
        entryReason: "activation-exact-pool-unavailable",
      })));
      continue;
    }
    const candidate = geckoTrendingCandidate(
      row,
      item.candidate.sourceRank,
      sourceObservedAt,
      GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
    );
    if (candidate.tokenAddress !== item.candidate.tokenAddress
      || candidate.pairAddress !== item.candidate.pairAddress
      || candidate.poolCreatedAt !== item.candidate.poolCreatedAt) {
      failures.push(`New-pool activation identity mismatch: ${item.candidate.pairAddress}`);
      activationEvents.push(await appendLedgerEvent(ledgerPath, activationEvent({
        item,
        observedAt: sourceObservedAt,
        status: "missed",
        reason: "activation-identity-mismatch",
        candidate: null,
        entryStatus: "cash",
        entryReason: "activation-identity-mismatch",
      })));
      continue;
    }
    prepared.push({ item, candidate });
  }
  const resolvedIds = new Set(events
    .filter((event) => event.type === "geckoterminal-new-pool-resolution")
    .map((event) => event.forecastId));
  const openTokens = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && !resolvedIds.has(event.id)
  )).map(tokenEdgeAssetKey));
  const eligible = prepared.filter(({ candidate }) => (
    candidate.status === "eligible"
    || (marketCapFloorRegistration
      && sourceObservedAt.getTime() > Date.parse(marketCapFloorRegistration.registeredAt)
      && marketCapFloorRemovedEligible(candidate))
  ));
  const uniqueEligible = [];
  for (const preparedItem of eligible) {
    const assetKey = tokenEdgeAssetKey(preparedItem.candidate);
    if (openTokens.has(assetKey) || uniqueEligible.some((item) => (
      tokenEdgeAssetKey(item.candidate) === assetKey
    ))) continue;
    uniqueEligible.push(preparedItem);
    if (uniqueEligible.length >= GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.maximumCandidates) break;
  }
  const direct = uniqueEligible.length
    ? await collectDexDirectPairs(
      uniqueEligible.map(({ candidate }) => candidate.tokenAddress),
      fetcher,
    )
    : { directPairsByToken: new Map(), failures: [], requestsAttempted: 0 };
  failures.push(...direct.failures);
  const createdAt = dependencies.captureClock?.()
    ?? (dependencies.now ? now : new Date());
  if (createdAt.getTime() < sourceObservedAt.getTime()
    || createdAt.getTime() - sourceObservedAt.getTime() > FIVE_MINUTES_MS) {
    return activationResult(
      ledgerPath,
      createdAt,
      due.length,
      1 + direct.requestsAttempted,
      activationEvents,
      [],
      [...failures, "activation source outside entry window"],
    );
  }
  const selectedKeys = new Set(uniqueEligible.map(({ item }) => item.key));
  const forecasts = [];
  for (const preparedItem of prepared) {
    const { item, candidate } = preparedItem;
    const parentEligible = candidate.status === "eligible";
    const childEligible = Boolean(
      marketCapFloorRegistration
      && sourceObservedAt.getTime() > Date.parse(marketCapFloorRegistration.registeredAt)
      && marketCapFloorRemovedEligible(candidate),
    );
    let entryStatus = "cash";
    let entryReason = parentEligible ? "capacity-or-open-token-suppression"
      : candidate.blockers.join("|");
    let consensus = null;
    if (selectedKeys.has(item.key)) {
      consensus = geckoDexDirectConsensus(
        candidate,
        direct,
        GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
      );
      if (consensus.reason) {
        entryReason = consensus.reason;
        failures.push(`New-pool entry rejected ${candidate.tokenAddress} ${candidate.pairAddress}: ${consensus.reason}`);
      } else if (parentEligible) {
        entryStatus = "ready";
        entryReason = null;
      }
    }
    const activation = await appendLedgerEvent(ledgerPath, activationEvent({
      item,
      observedAt: sourceObservedAt,
      status: "observed",
      reason: null,
      candidate,
      entryStatus,
      entryReason,
    }));
    activationEvents.push(activation);
    if (entryStatus === "ready") {
      forecasts.push(await appendLedgerEvent(ledgerPath, newPoolForecastEvent({
        registration,
        rule: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
        activation,
        item,
        candidate,
        consensus,
        createdAt,
        sourceObservedAt,
      })));
    }
    if (childEligible && selectedKeys.has(item.key) && consensus && !consensus.reason) {
      forecasts.push(await appendLedgerEvent(ledgerPath, newPoolForecastEvent({
        registration: marketCapFloorRegistration,
        rule: GECKOTERMINAL_NEW_POOL_MARKET_CAP_FLOOR_REMOVED_RULE,
        activation,
        item,
        candidate,
        consensus,
        createdAt,
        sourceObservedAt,
      })));
    }
  }
  return activationResult(
    ledgerPath,
    createdAt,
    due.length,
    1 + direct.requestsAttempted,
    activationEvents,
    forecasts,
    failures,
  );
}

function newPoolForecastEvent({
  registration,
  rule,
  activation,
  item,
  candidate,
  consensus,
  createdAt,
  sourceObservedAt,
}) {
  return {
    type: "geckoterminal-new-pool-forecast",
    id: `geckoterminal_new_pool_forecast_${digestValue({
      registrationId: registration.id,
      activationEventId: activation.id,
      tokenAddress: candidate.tokenAddress,
    }).slice(0, 24)}`,
    ruleVersion: rule.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: item.discovery.id,
    activationEventId: activation.id,
    chain: candidate.chain,
    tokenAddress: candidate.tokenAddress,
    symbol: candidate.symbol,
    createdAt: createdAt.toISOString(),
    sourceDiscoveryObservedAt: item.discovery.observedAt,
    activationObservedAt: sourceObservedAt.toISOString(),
    entryObservedAt: createdAt.toISOString(),
    dueAt: new Date(createdAt.getTime() + HOUR_MS).toISOString(),
    pairAddress: candidate.pairAddress,
    entryPriceUsd: positiveNumber(consensus.pair?.priceUsd),
    entryLiquidityUsd: positiveNumber(consensus.pair?.liquidity?.usd),
    entryProviderPriceIntegrity: consensus.integrity,
    metrics: activationMetrics(candidate),
    predictedRise: true,
    decision: rule.decision,
    researchOnly: true,
    mutationAllowed: false,
  };
}

function newPoolBirthForecastEvent({
  registration,
  rule,
  discovery,
  candidate,
  consensus,
  createdAt,
  creatorBalanceRegistration = null,
  creatorBalanceEvidence = null,
  lpProviderRegistration = null,
  lpProviderEvidence = null,
  pairAgeRegistration = null,
  turnoverRegistration = null,
  lowMomentumRegistration = null,
  socialPresenceRegistration = null,
  dangerCountRegistration = null,
  rugCheckRiskEvidence = null,
}) {
  return {
    type: "geckoterminal-new-pool-forecast",
    id: `geckoterminal_new_pool_forecast_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
      tokenAddress: candidate.tokenAddress,
    }).slice(0, 24)}`,
    ruleVersion: rule.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    activationEventId: null,
    entryMode: "newborn-birth-quote",
    chain: candidate.chain,
    tokenAddress: candidate.tokenAddress,
    symbol: candidate.symbol,
    createdAt: createdAt.toISOString(),
    sourceDiscoveryObservedAt: discovery.observedAt,
    activationObservedAt: null,
    entryObservedAt: createdAt.toISOString(),
    dueAt: new Date(createdAt.getTime() + HOUR_MS).toISOString(),
    pairAddress: candidate.pairAddress,
    entryPriceUsd: positiveNumber(consensus.pair?.priceUsd),
    entryLiquidityUsd: positiveNumber(consensus.pair?.liquidity?.usd),
    entryProviderPriceIntegrity: consensus.integrity,
    metrics: activationMetrics(candidate),
    predictedRise: true,
    decision: rule.decision,
    ...newbornCreatorBalanceForecastFields({
      rule,
      creatorBalanceRegistration,
      creatorBalanceEvidence,
    }),
    ...newbornLpProviderForecastFields({
      rule,
      lpProviderRegistration,
      lpProviderEvidence,
    }),
    ...newbornPairAgeForecastFields({
      rule,
      pairAgeRegistration,
      candidate,
    }),
    ...newbornTurnoverForecastFields({
      rule,
      turnoverRegistration,
      candidate,
    }),
    ...newbornLowMomentumForecastFields({
      rule,
      lowMomentumRegistration,
      candidate,
    }),
    ...newbornSocialPresenceForecastFields({
      rule,
      socialPresenceRegistration,
      directPair: consensus.pair,
    }),
    ...newbornDangerCountForecastFields({
      rule,
      dangerCountRegistration,
      rugCheckRiskEvidence,
    }),
    researchOnly: true,
    mutationAllowed: false,
  };
}

function jupiterExecutableDecisionEvent({
  registration,
  discovery,
  newborn,
  candidate,
  quoteAggregate,
  quoteAvailableAt,
  quoteObservedAt,
  createdAt,
}) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE;
  const quotedRoundTrip = quoteAggregate.status === "round-trip-quoted"
    && quoteAggregate.coverage === "complete";
  const unavailable = quoteAggregate.status === "provider-unavailable";
  const decision = quotedRoundTrip ? "paper-long"
    : (unavailable ? "unavailable" : "paper-cash");
  return {
    type: "geckoterminal-new-pool-jupiter-executable-decision",
    id: `geckoterminal_new_pool_jupiter_executable_decision_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
      tokenAddress: candidate.tokenAddress,
    }).slice(0, 24)}`,
    ruleVersion: rule.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    chain: candidate.chain,
    tokenAddress: candidate.tokenAddress,
    symbol: candidate.symbol,
    pairAddress: candidate.pairAddress,
    poolCreatedAt: newborn.poolCreatedAt,
    sourceDiscoveryObservedAt: discovery.observedAt,
    quoteObservedAt: quoteObservedAt.toISOString(),
    quoteAvailableAt,
    createdAt: createdAt.toISOString(),
    dueAt: new Date(createdAt.getTime() + HOUR_MS).toISOString(),
    inputMint: rule.inputMint,
    inputUsdcAtomic: String(rule.inputUsdcAtomic),
    quoteAggregate,
    quoteAggregateDigest: digestValue(quoteAggregate),
    quoteAggregateOnly: true,
    rawRoutesRetained: false,
    entryTokenAmountAtomic: quotedRoundTrip
      ? quoteAggregate.buyOutputTokenAtomic : null,
    predictedRise: quotedRoundTrip,
    decision,
    decisionReason: quoteAggregate.status,
    metrics: activationMetrics(candidate),
    researchOnly: true,
    mutationAllowed: false,
  };
}

function newbornDangerCountForecastFields({
  rule,
  dangerCountRegistration,
  rugCheckRiskEvidence,
}) {
  if (rule.version !== GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version
    || !dangerCountRegistration
    || !rugCheckRiskEvidence) return {};
  const dangerRiskCount = rugCheckRiskEvidence.aggregate?.dangerRiskCount;
  const selected = rugCheckRiskEvidence.aggregate?.coverage === "complete"
    && Number.isInteger(dangerRiskCount)
    && dangerRiskCount
      >= GECKOTERMINAL_NEW_POOL_BIRTH_DANGER_COUNT_RULE.minimumDangerRiskCountInclusive
    && dangerRiskCount
      <= GECKOTERMINAL_NEW_POOL_BIRTH_DANGER_COUNT_RULE.maximumDangerRiskCountInclusive;
  return {
    dangerCountChallengerRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_DANGER_COUNT_RULE.version,
    dangerCountChallengerRegistrationId: dangerCountRegistration.id,
    dangerCountChallengerRegisteredAt: dangerCountRegistration.registeredAt,
    dangerCountEvidenceId: rugCheckRiskEvidence.id,
    dangerCountEvidenceAvailableAt: rugCheckRiskEvidence.availableAt,
    dangerRiskCount: Number.isInteger(dangerRiskCount) ? dangerRiskCount : null,
    dangerCountChallengerPredictedRise: selected,
    dangerCountChallengerDecision: selected ? "paper-long" : "paper-cash",
  };
}

function newbornSocialPresenceForecastFields({
  rule,
  socialPresenceRegistration,
  directPair,
}) {
  if (rule.version !== GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version
    || !socialPresenceRegistration) return {};
  const aggregate = normalizeNewbornSocialPresenceAggregate(directPair);
  return {
    socialPresenceObservationRuleVersion:
      GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE.version,
    socialPresenceObservationRegistrationId: socialPresenceRegistration.id,
    socialPresenceObservationRegisteredAt: socialPresenceRegistration.registeredAt,
    socialPresenceAggregate: aggregate,
    socialPresenceAggregateDigest: digestValue(aggregate),
    socialPresenceRawLinksRetained: false,
  };
}

export function normalizeNewbornSocialPresenceAggregate(directPair) {
  const info = directPair?.info;
  const websites = Array.isArray(info?.websites) ? info.websites : [];
  const socials = Array.isArray(info?.socials) ? info.socials : [];
  const websiteCount = Math.min(20, websites.filter((row) => text(row?.url)).length);
  const observedPlatforms = socials.map((row) => normalizedSocialPlatform(row?.platform));
  const retainedPlatforms = new Set(observedPlatforms.filter((platform) => (
    GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE.retainedPlatforms
      .includes(platform)
  )));
  const socialCount = Math.min(20, socials.filter((row) => (
    text(row?.platform) || text(row?.handle)
  )).length);
  return Object.freeze({
    infoPresent: Boolean(info && typeof info === "object" && !Array.isArray(info)),
    websiteCount,
    socialCount,
    retainedPlatformCount: retainedPlatforms.size,
    unrecognizedPlatformCount: Math.min(20, observedPlatforms.filter((platform) => (
      platform && !GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE.retainedPlatforms
        .includes(platform)
    )).length),
    hasWebsite: websiteCount > 0,
    hasAnySocial: socialCount > 0,
    hasTwitter: retainedPlatforms.has("twitter"),
    hasTelegram: retainedPlatforms.has("telegram"),
    hasDiscord: retainedPlatforms.has("discord"),
    hasYoutube: retainedPlatforms.has("youtube"),
    hasTiktok: retainedPlatforms.has("tiktok"),
    hasInstagram: retainedPlatforms.has("instagram"),
    hasReddit: retainedPlatforms.has("reddit"),
  });
}

function normalizedSocialPlatform(value) {
  const platform = text(value)?.toLowerCase().replaceAll(/[^a-z0-9]/g, "") ?? null;
  if (platform === "x" || platform === "xcom") return "twitter";
  if (platform === "twitter" || platform === "twittercom") return "twitter";
  if (platform === "telegram" || platform === "tme") return "telegram";
  if (platform === "youtube" || platform === "youtubecom") return "youtube";
  if (platform === "tiktok" || platform === "tiktokcom") return "tiktok";
  if (platform === "instagram" || platform === "instagramcom") return "instagram";
  if (platform === "discord" || platform === "discordgg") return "discord";
  if (platform === "reddit" || platform === "redditcom") return "reddit";
  return platform;
}

function newbornTurnoverForecastFields({ rule, turnoverRegistration, candidate }) {
  if (rule.version !== GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version
    || !turnoverRegistration) return {};
  const fiveMinuteTurnover = finiteNumber(candidate?.fiveMinuteTurnover);
  const selected = Number.isFinite(fiveMinuteTurnover)
    && fiveMinuteTurnover <= GECKOTERMINAL_NEW_POOL_BIRTH_TURNOVER_RULE
      .maximumFiveMinuteTurnoverInclusive;
  return {
    turnoverChallengerRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_TURNOVER_RULE.version,
    turnoverChallengerRegistrationId: turnoverRegistration.id,
    turnoverChallengerRegisteredAt: turnoverRegistration.registeredAt,
    fiveMinuteTurnover,
    turnoverChallengerPredictedRise: selected,
    turnoverChallengerDecision: selected ? "paper-long" : "paper-cash",
  };
}

function newbornLowMomentumForecastFields({ rule, lowMomentumRegistration, candidate }) {
  if (rule.version !== GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version
    || !lowMomentumRegistration) return {};
  const priceChangeM5Pct = finiteNumber(candidate?.priceChangeM5Pct);
  const selected = Number.isFinite(priceChangeM5Pct)
    && priceChangeM5Pct
      <= GECKOTERMINAL_NEW_POOL_BIRTH_LOW_MOMENTUM_RULE
        .maximumFiveMinutePriceChangePctInclusive;
  return {
    lowMomentumChallengerRuleVersion:
      GECKOTERMINAL_NEW_POOL_BIRTH_LOW_MOMENTUM_RULE.version,
    lowMomentumChallengerRegistrationId: lowMomentumRegistration.id,
    lowMomentumChallengerRegisteredAt: lowMomentumRegistration.registeredAt,
    lowMomentumPriceChangeM5Pct: priceChangeM5Pct,
    lowMomentumChallengerPredictedRise: selected,
    lowMomentumChallengerDecision: selected ? "paper-long" : "paper-cash",
  };
}

function newbornPairAgeForecastFields({ rule, pairAgeRegistration, candidate }) {
  if (rule.version !== GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version
    || !pairAgeRegistration) return {};
  const pairAgeMinutes = finiteNumber(candidate?.pairAgeMinutes);
  const selected = Number.isFinite(pairAgeMinutes)
    && pairAgeMinutes >= GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE
      .minimumPairAgeMinutesInclusive;
  return {
    pairAgeChallengerRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE.version,
    pairAgeChallengerRegistrationId: pairAgeRegistration.id,
    pairAgeChallengerRegisteredAt: pairAgeRegistration.registeredAt,
    pairAgeMinutes,
    pairAgeChallengerPredictedRise: selected,
    pairAgeChallengerDecision: selected ? "paper-long" : "paper-cash",
  };
}

function newbornLpProviderForecastFields({
  rule,
  lpProviderRegistration,
  lpProviderEvidence,
}) {
  if (rule.version !== GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version
    || !lpProviderRegistration
    || !lpProviderEvidence) return {};
  const totalLpProviders = lpProviderEvidence.aggregate?.totalLpProviders;
  const selected = lpProviderEvidence.aggregate?.coverage === "complete"
    && Number.isInteger(totalLpProviders)
    && totalLpProviders
      >= GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE.minimumTotalLpProvidersInclusive;
  return {
    lpProviderChallengerRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE.version,
    lpProviderChallengerRegistrationId: lpProviderRegistration.id,
    lpProviderChallengerRegisteredAt: lpProviderRegistration.registeredAt,
    lpProviderEvidenceId: lpProviderEvidence.id,
    lpProviderEvidenceAvailableAt: lpProviderEvidence.availableAt,
    totalLpProviders: Number.isInteger(totalLpProviders) ? totalLpProviders : null,
    lpProviderChallengerPredictedRise: selected,
    lpProviderChallengerDecision: selected ? "paper-long" : "paper-cash",
  };
}

function newbornCreatorBalanceForecastFields({
  rule,
  creatorBalanceRegistration,
  creatorBalanceEvidence,
}) {
  if (rule.version !== GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version
    || !creatorBalanceRegistration
    || !creatorBalanceEvidence) return {};
  const creatorBalancePct = creatorBalanceEvidence.aggregate?.creatorBalancePct;
  const selected = creatorBalanceEvidence.aggregate?.coverage === "complete"
    && Number.isFinite(creatorBalancePct)
    && creatorBalancePct
      <= GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE
        .maximumCreatorBalancePctInclusive;
  return {
    creatorBalanceChallengerRuleVersion:
      GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE.version,
    creatorBalanceChallengerRegistrationId: creatorBalanceRegistration.id,
    creatorBalanceChallengerRegisteredAt: creatorBalanceRegistration.registeredAt,
    creatorBalanceEvidenceId: creatorBalanceEvidence.id,
    creatorBalanceEvidenceAvailableAt: creatorBalanceEvidence.availableAt,
    creatorBalancePct: Number.isFinite(creatorBalancePct) ? creatorBalancePct : null,
    creatorBalanceChallengerPredictedRise: selected,
    creatorBalanceChallengerDecision: selected ? "paper-long" : "paper-cash",
  };
}

function marketCapFloorRemovedEligible(candidate) {
  return candidate?.status === "blocked"
    && Array.isArray(candidate.blockers)
    && candidate.blockers.length === 1
    && candidate.blockers[0] === "market-cap-outside-50000-5000000"
    && candidate.marketCapUsd > 0
    && candidate.marketCapUsd
      < GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.candidateScreens
        .minimumMarketCapUsdInclusive;
}

export async function resolveGeckoTerminalNewPoolForecasts(options = {}, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const priceAgnosticCollapseRegistration =
    findGeckoPriceAgnosticCollapseScoringRegistration(events);
  const resolvedIds = new Set(events
    .filter((event) => event.type === "geckoterminal-new-pool-resolution")
    .map((event) => event.forecastId));
  const due = events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && !resolvedIds.has(event.id)
      && Date.parse(event.dueAt) <= now.getTime()
  ));
  if (!due.length) return resolutionResult(ledgerPath, now, 0, 0, [], []);
  const provider = await collectGeckoPoolDexDirectProvider(due, fetcher);
  const failures = [...provider.failures];
  const resolutions = [];
  for (const forecast of due) {
    const lagMs = now.getTime() - Date.parse(forecast.dueAt);
    const assessment = geckoDexDirectExitAssessment(
      forecast,
      provider,
      GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
      {
        allowPriceDisagreementOnCollapse: priceAgnosticCollapseEligibility(
          forecast,
          priceAgnosticCollapseRegistration,
        ),
      },
    );
    const exactWindowOpen = lagMs >= 0 && lagMs <= MAX_OUTCOME_LAG_MS;
    const collapsed = exactWindowOpen && assessment.status === "liquidity-collapse";
    const exitPriceUsd = assessment.reason ? null : positiveNumber(assessment.pair?.priceUsd);
    const exitLiquidityUsd = assessment.reason
      ? null : nonnegativeNumber(assessment.pair?.liquidity?.usd);
    if (exactWindowOpen && !collapsed
      && (assessment.reason || !(exitPriceUsd > 0) || !(exitLiquidityUsd > 0))) {
      failures.push(`New-pool outcome unavailable ${forecast.tokenAddress}: ${assessment.reason ?? "invalid-quote"}`);
      continue;
    }
    const observed = exactWindowOpen && exitPriceUsd > 0 && exitLiquidityUsd > 0;
    const resolvedStatus = collapsed ? "liquidity-collapse" : (observed ? "observed" : "missed");
    const resolution = {
      type: "geckoterminal-new-pool-resolution",
      id: `geckoterminal_new_pool_resolution_${digestValue({
        forecastId: forecast.id,
        observedAt: now.toISOString(),
        status: resolvedStatus,
      }).slice(0, 24)}`,
      ruleVersion: forecast.ruleVersion,
      registrationId: forecast.registrationId,
      forecastId: forecast.id,
      discoveryEventId: forecast.discoveryEventId,
      activationEventId: forecast.activationEventId,
      chain: forecast.chain,
      tokenAddress: forecast.tokenAddress,
      dueAt: forecast.dueAt,
      observedAt: now.toISOString(),
      observationLagMs: lagMs,
      status: resolvedStatus,
      reason: collapsed ? "both-providers-below-paper-notional-liquidity"
        : (observed ? null : "exact-one-hour-window-expired"),
      pairAddress: forecast.pairAddress,
      entryPriceUsd: forecast.entryPriceUsd,
      exitPriceUsd,
      entryLiquidityUsd: forecast.entryLiquidityUsd,
      exitLiquidityUsd,
      grossReturnPct: collapsed
        ? GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE.collapsedOutcomeGrossReturnPct
        : (observed
          ? round6(((exitPriceUsd / forecast.entryPriceUsd) - 1) * 100) : null),
      providerPriceIntegrity: observed || collapsed ? assessment.integrity : null,
      priceAgnosticCollapseRegistrationId:
        assessment.integrity?.ruleVersion
          === "geckoterminal-dex-direct-zero-liquidity-collapse-v2"
          ? priceAgnosticCollapseRegistration.id : null,
      researchOnly: true,
      mutationAllowed: false,
    };
    resolutions.push(await appendLedgerEvent(ledgerPath, resolution));
  }
  return resolutionResult(
    ledgerPath,
    now,
    due.length,
    provider.requestsAttempted,
    resolutions,
    failures,
  );
}

export async function resolveGeckoTerminalNewPoolBirthJupiterExecutable(
  options = {},
  dependencies = {},
) {
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matchesBirthJupiterExecutableRegistration) ?? null;
  const sourceRegistration = events.find(matchesRegistration) ?? null;
  if (!registration) {
    throw new Error("Register the newborn Jupiter-executable policy before resolution.");
  }
  const discoveries = new Map(events.filter((event) => (
    event.type === "geckoterminal-new-pool-discovery"
  )).map((event) => [event.id, event]));
  const resolvedIds = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-jupiter-executable-resolution"
  )).map((event) => event.decisionId));
  const due = events.filter((event) => (
    event.type === "geckoterminal-new-pool-jupiter-executable-decision"
      && event.registrationId === registration.id
      && !resolvedIds.has(event.id)
      && Date.parse(event.dueAt) <= now.getTime()
  )).sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt));
  if (!due.length) {
    return jupiterExecutableResolutionResult(ledgerPath, now, 0, 0, [], []);
  }
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE;
  const quoteReader = dependencies.jupiterQuoteReader
    ?? ((quoteOptions) => readJupiterExactInQuote({
      ...quoteOptions,
      fetcher: dependencies.jupiterFetcher ?? fetch,
    }));
  const responseClock = dependencies.responseClock
    ?? (() => (dependencies.now ? now : new Date()));
  const failures = [];
  const resolutions = [];
  let requestsAttempted = 0;
  for (const decision of due) {
    const discovery = discoveries.get(decision.discoveryEventId) ?? null;
    if (!validJupiterExecutableDecisionEnvelope({
      decision,
      registration,
      sourceRegistration,
      discovery,
    })) {
      failures.push(`Jupiter executable decision integrity mismatch ${decision.id}.`);
      continue;
    }
    const lagMs = now.getTime() - Date.parse(decision.dueAt);
    if (decision.decision === "paper-cash") {
      resolutions.push(await appendLedgerEvent(
        ledgerPath,
        jupiterExecutableResolutionEvent({
          decision,
          observedAt: now,
          status: "cash",
          reason: decision.decisionReason,
        }),
      ));
      continue;
    }
    if (decision.decision === "unavailable") {
      resolutions.push(await appendLedgerEvent(
        ledgerPath,
        jupiterExecutableResolutionEvent({
          decision,
          observedAt: now,
          status: "unavailable",
          reason: "entry-provider-unavailable",
        }),
      ));
      continue;
    }
    if (lagMs > MAX_OUTCOME_LAG_MS) {
      resolutions.push(await appendLedgerEvent(
        ledgerPath,
        jupiterExecutableResolutionEvent({
          decision,
          observedAt: now,
          status: "missed",
          reason: "exact-one-hour-window-expired",
        }),
      ));
      continue;
    }
    if (requestsAttempted >= rule.maximumExitQuotesPerResolution) {
      failures.push(`Jupiter executable exit request cap reached before ${decision.id}.`);
      continue;
    }
    let quote;
    try {
      requestsAttempted += 1;
      quote = await quoteReader({
        inputMint: decision.tokenAddress,
        outputMint: rule.inputMint,
        amountAtomic: decision.entryTokenAmountAtomic,
      });
    } catch (error) {
      failures.push(`Jupiter executable exit unavailable ${decision.tokenAddress}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const availableAt = new Date(validIso(responseClock()));
    const availableLagMs = availableAt.getTime() - Date.parse(decision.dueAt);
    if (availableAt.getTime() < now.getTime()) {
      failures.push(`Jupiter executable exit response clock preceded request ${decision.id}.`);
      continue;
    }
    if (availableLagMs > MAX_OUTCOME_LAG_MS) {
      resolutions.push(await appendLedgerEvent(
        ledgerPath,
        jupiterExecutableResolutionEvent({
          decision,
          observedAt: availableAt,
          status: "missed",
          reason: "quote-arrived-after-exact-window",
        }),
      ));
      continue;
    }
    const exitQuote = canonicalJupiterExecutableExitQuote(quote);
    if (exitQuote.status === "no-route") {
      resolutions.push(await appendLedgerEvent(
        ledgerPath,
        jupiterExecutableResolutionEvent({
          decision,
          observedAt: availableAt,
          status: "liquidity-collapse",
          reason: "held-token-no-exit-route",
          exitQuote,
        }),
      ));
    } else if (exitQuote.status === "quoted") {
      resolutions.push(await appendLedgerEvent(
        ledgerPath,
        jupiterExecutableResolutionEvent({
          decision,
          observedAt: availableAt,
          status: "observed",
          reason: null,
          exitQuote,
        }),
      ));
    } else {
      failures.push(`Jupiter executable exit invalid quote ${decision.tokenAddress}.`);
    }
  }
  return jupiterExecutableResolutionResult(
    ledgerPath,
    now,
    due.length,
    requestsAttempted,
    resolutions,
    failures,
  );
}

function canonicalJupiterExecutableExitQuote(value) {
  if (value?.status === "no-route") {
    return {
      status: "no-route",
      outputUsdcAtomic: null,
      priceImpactPct: null,
      swapUsdValue: null,
      routeHopCount: null,
    };
  }
  const outputUsdcAtomic = positiveAtomicString(
    value?.outputAmountAtomic ?? value?.outputUsdcAtomic,
  );
  if (value?.status !== "quoted" || !outputUsdcAtomic) {
    return {
      status: "invalid",
      outputUsdcAtomic: null,
      priceImpactPct: null,
      swapUsdValue: null,
      routeHopCount: null,
    };
  }
  return {
    status: "quoted",
    outputUsdcAtomic,
    priceImpactPct: nullableRound(nonnegativeNumber(value?.priceImpactPct)),
    swapUsdValue: nullableRound(nonnegativeNumber(value?.swapUsdValue)),
    routeHopCount: nonnegativeInteger(value?.routeHopCount),
  };
}

function jupiterExecutableResolutionEvent({
  decision,
  observedAt,
  status,
  reason,
  exitQuote = null,
}) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE;
  const grossReturnPct = status === "cash" ? 0
    : (status === "liquidity-collapse" ? -100
      : (status === "observed"
        ? ((Number(exitQuote.outputUsdcAtomic) / rule.inputUsdcAtomic) - 1) * 100
        : null));
  const baseReturnPct = Number.isFinite(grossReturnPct)
    ? (status === "cash" ? 0
      : Math.max(-100, grossReturnPct - rule.baseRoundTripCostPct)) : null;
  const stressReturnPct = Number.isFinite(grossReturnPct)
    ? (status === "cash" ? 0
      : Math.max(-100, grossReturnPct - rule.stressRoundTripCostPct)) : null;
  const canonicalExitQuote = exitQuote
    ? canonicalJupiterExecutableExitQuote(exitQuote) : null;
  return {
    type: "geckoterminal-new-pool-jupiter-executable-resolution",
    id: `geckoterminal_new_pool_jupiter_executable_resolution_${digestValue({
      decisionId: decision.id,
      observedAt: observedAt.toISOString(),
      status,
    }).slice(0, 24)}`,
    ruleVersion: rule.version,
    registrationId: decision.registrationId,
    decisionId: decision.id,
    discoveryEventId: decision.discoveryEventId,
    chain: decision.chain,
    tokenAddress: decision.tokenAddress,
    pairAddress: decision.pairAddress,
    dueAt: decision.dueAt,
    observedAt: observedAt.toISOString(),
    observationLagMs: observedAt.getTime() - Date.parse(decision.dueAt),
    status,
    reason,
    entryTokenAmountAtomic: decision.entryTokenAmountAtomic,
    exitQuote: canonicalExitQuote,
    exitQuoteDigest: canonicalExitQuote ? digestValue(canonicalExitQuote) : null,
    rawRoutesRetained: false,
    grossReturnPct: nullableRound(grossReturnPct),
    baseReturnPct: nullableRound(baseReturnPct),
    stressReturnPct: nullableRound(stressReturnPct),
    researchOnly: true,
    mutationAllowed: false,
  };
}

export async function markOpenGeckoTerminalNewPoolBirthPaths(
  options = {},
  dependencies = {},
) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const bucketStartedAt = new Date(
    Math.floor(now.getTime() / FIVE_MINUTES_MS) * FIVE_MINUTES_MS,
  ).toISOString();
  const lockPath = path.join(
    path.dirname(ledgerPath),
    `.gecko-new-pool-birth-path-${bucketStartedAt.replaceAll(/[^0-9]/g, "")}.lock`,
  );
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      return newPoolPathResult(ledgerPath, now, bucketStartedAt, 0, 0, [], []);
    }
    throw error;
  }
  try {
    const events = await verifiedLedger(ledgerPath);
    const priceAgnosticCollapseRegistration =
      findGeckoPriceAgnosticCollapseScoringRegistration(events);
    const registration = events.find(matchesBirthPathRegistration) ?? null;
    if (!registration) {
      throw new Error("Register the new-pool birth-path policy before marking.");
    }
    if (!(now.getTime() > Date.parse(registration.registeredAt))) {
      return newPoolPathResult(ledgerPath, now, bucketStartedAt, 0, 0, [], []);
    }
    const resolvedIds = new Set(events
      .filter((event) => event.type === "geckoterminal-new-pool-resolution")
      .map((event) => event.forecastId));
    const markedIds = new Set(events.filter((event) => (
      event.type === "geckoterminal-new-pool-path"
        && event.pathRegistrationId === registration.id
        && event.bucketStartedAt === bucketStartedAt
    )).map((event) => event.forecastId));
    const terminalIds = new Set(events.filter((event) => (
      event.type === "geckoterminal-new-pool-path"
        && event.pathRegistrationId === registration.id
        && event.status === "liquidity-collapse"
    )).map((event) => event.forecastId));
    const open = events.filter((event) => (
      event.type === "geckoterminal-new-pool-forecast"
        && GECKOTERMINAL_NEW_POOL_BIRTH_PATH_RULE.sourceRuleVersions.includes(
          event.ruleVersion,
        )
        && Date.parse(event.createdAt) <= now.getTime()
        && Date.parse(event.dueAt) > now.getTime()
        && !resolvedIds.has(event.id)
        && !markedIds.has(event.id)
        && !terminalIds.has(event.id)
    ));
    if (!open.length) {
      return newPoolPathResult(ledgerPath, now, bucketStartedAt, 0, 0, [], []);
    }
    const provider = await collectGeckoPoolDexDirectProvider(open, fetcher);
    const failures = [...provider.failures];
    const observations = [];
    for (const forecast of open) {
      const assessment = geckoDexDirectExitAssessment(
        forecast,
        provider,
        GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
        {
          allowPriceDisagreementOnCollapse: priceAgnosticCollapseEligibility(
            forecast,
            priceAgnosticCollapseRegistration,
          ),
        },
      );
      if (assessment.reason || !["quoted", "liquidity-collapse"].includes(assessment.status)) {
        failures.push(`New-pool birth path unavailable ${forecast.tokenAddress} ${forecast.pairAddress}: ${assessment.reason ?? assessment.status}`);
        continue;
      }
      const observedPriceUsd = positiveNumber(assessment.pair?.priceUsd);
      const observedLiquidityUsd = nonnegativeNumber(assessment.pair?.liquidity?.usd);
      if (!(observedPriceUsd > 0) || !Number.isFinite(observedLiquidityUsd)) continue;
      const collapsed = assessment.status === "liquidity-collapse";
      const event = {
        type: "geckoterminal-new-pool-path",
        id: `geckoterminal_new_pool_path_${digestValue({
          forecastId: forecast.id,
          pathRegistrationId: registration.id,
          bucketStartedAt,
        }).slice(0, 24)}`,
        pathRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_PATH_RULE.version,
        pathRegistrationId: registration.id,
        pathRegisteredAt: registration.registeredAt,
        sourceRuleVersion: forecast.ruleVersion,
        sourceRegistrationId: forecast.registrationId,
        sourceForecastPreRegistration:
          Date.parse(forecast.createdAt) <= Date.parse(registration.registeredAt),
        forecastId: forecast.id,
        discoveryEventId: forecast.discoveryEventId,
        chain: forecast.chain,
        tokenAddress: forecast.tokenAddress,
        symbol: forecast.symbol,
        pairAddress: forecast.pairAddress,
        signalCreatedAt: forecast.createdAt,
        dueAt: forecast.dueAt,
        bucketStartedAt,
        observedAt: now.toISOString(),
        status: collapsed ? "liquidity-collapse" : "observed",
        entryPriceUsd: forecast.entryPriceUsd,
        entryLiquidityUsd: forecast.entryLiquidityUsd,
        observedPriceUsd,
        observedLiquidityUsd,
        grossReturnFromEntryPct: collapsed
          ? GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE.collapsedOutcomeGrossReturnPct
          : round6(((observedPriceUsd / forecast.entryPriceUsd) - 1) * 100),
        providerPriceIntegrity: assessment.integrity,
        priceAgnosticCollapseRegistrationId:
          assessment.integrity?.ruleVersion
            === "geckoterminal-dex-direct-zero-liquidity-collapse-v2"
            ? priceAgnosticCollapseRegistration.id : null,
        observationMode: "live-point-in-time-path",
        researchOnly: true,
        mutationAllowed: false,
      };
      observations.push(await appendLedgerEvent(ledgerPath, event));
    }
    return newPoolPathResult(
      ledgerPath,
      now,
      bucketStartedAt,
      open.length,
      provider.requestsAttempted,
      observations,
      failures,
    );
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export function buildGeckoTerminalNewPoolScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolRows(events);
  return withChronologicalHalfValidation(
    buildGeckoTerminalScorecard(cohort, GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE, {
      type: "geckoterminal-new-pool-activation-monitoring-scorecard",
      note: "This future-only paper cohort changes candidate discovery timing from a five-minute trending rank to a page-one new-pool birth watch. It waits until the unchanged minimum pair age, then applies the unchanged tradability and anti-chase screens plus exact-pool/direct-pair quote consensus. All inspected pre-registration pools are excluded; blocked activations are cash and cannot be repaired, backfilled, promoted, mutated, or traded.",
    }),
    cohort,
  );
}

export function buildGeckoTerminalNewPoolMarketCapFloorRemovedScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolMarketCapFloorRemovedRows(events);
  return withChronologicalHalfValidation(
    buildGeckoTerminalScorecard(
      cohort,
      GECKOTERMINAL_NEW_POOL_MARKET_CAP_FLOOR_REMOVED_RULE,
      {
        type: "geckoterminal-new-pool-market-cap-floor-removed-scorecard",
        note: "This future-only paper challenger removes only the inherited $50,000 minimum market-cap screen from the newborn-pool activation parent. The $5 million ceiling and every age, liquidity, volume, anti-chase, quote-integrity, capacity, cost, outcome, and promotion contract remain unchanged. WALDO and all inspected activations are excluded.",
      },
    ),
    cohort,
  );
}

export function buildGeckoTerminalNewPoolBirthEntryScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolBirthEntryRows(events);
  return withChronologicalHalfValidation(
    buildGeckoTerminalScorecard(
      cohort,
      GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
      {
        type: "geckoterminal-new-pool-birth-entry-scorecard",
        note: "This future-only paper cohort changes only source-entry timing: it evaluates the inherited liquidity, market-cap, volume, and anti-chase screens on the first retained newborn quote at no more than five minutes of age instead of waiting until minute fifteen. Exact-pair cross-provider entry and exit integrity, one-hour outcomes, capacity, costs, independent frames, and promotion gates remain unchanged. All discoveries available when the rule was frozen are excluded.",
      },
    ),
    cohort,
  );
}

export function buildGeckoTerminalNewPoolBirthMarketCapFloorRemovedScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows(events);
  return withChronologicalHalfValidation(
    buildGeckoTerminalScorecard(
      cohort,
      GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE,
      {
        type: "geckoterminal-new-pool-birth-market-cap-floor-removed-scorecard",
        note: "This future-only paper child removes only the inherited $50,000 minimum market-cap screen from the at-most-five-minute newborn birth-entry parent. Every source-age, liquidity, volume, anti-chase, quote-integrity, capacity, cost, exact one-hour outcome, independent-frame, and promotion contract remains unchanged. DREAM, both inspected future birth samples, and every earlier quote are excluded.",
      },
    ),
    cohort,
  );
}

export function buildGeckoTerminalNewPoolBirthUpperMomentumScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolBirthUpperMomentumRows(events);
  const scorecard = withChronologicalHalfValidation(
    buildGeckoTerminalScorecard(
      cohort,
      GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE,
      {
        type: "geckoterminal-new-pool-birth-upper-momentum-incremental-scorecard",
        note: "This strictly future incremental paper cohort admits only newborns that pass every low-cap v4 screen except the inherited hourly upper anti-chase ceiling and have decision-time hourly price change above 25% through 100%. The exploratory 15-minute derivation family is excluded and explicitly failed its bootstrap, drawdown, and concentration checks. Exact one-hour capacity-adjusted outcomes must clear the frozen event floors and a separate independent quant audit before review; no result grants promotion or trading authority.",
      },
    ),
    cohort,
  );
  const coverage = forecastOutcomeCoverageValidation(cohort);
  const statisticalCandidateGate = scorecard.provisionalGate && coverage.gate;
  return {
    ...scorecard,
    ...coverage.summary,
    evidenceStatus: scorecard.evidenceStatus === "reviewable" && coverage.gate
      ? "reviewable" : "collecting",
    evidenceShortfall: {
      ...scorecard.evidenceShortfall,
      ...coverage.evidenceShortfall,
    },
    promotionAuthority: false,
    statisticalCandidateGate,
    independentQuantValidationRequired: true,
    independentQuantValidationStatus: "not-run",
    independentQuantValidationRequirements: INDEPENDENT_QUANT_VALIDATION_REQUIREMENTS,
    provisionalGate: false,
  };
}

export function buildGeckoTerminalNewPoolBirthSocialPresenceScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolBirthSocialPresenceRows(events);
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const uniqueTokens = new Set(weightedRows.map(tokenEdgeAssetKey)).size;
  const fields = [
    "infoPresent", "hasWebsite", "hasAnySocial", "hasTwitter", "hasTelegram",
    "hasDiscord", "hasYoutube", "hasTiktok", "hasInstagram", "hasReddit",
    "websiteCount", "socialCount", "retainedPlatformCount",
  ];
  const featureSlices = [];
  for (const field of fields) {
    const grouped = new Map();
    for (const row of weightedRows) {
      const bucket = socialPresenceBucket(field, row.socialPresenceAggregate);
      if (!grouped.has(bucket)) grouped.set(bucket, []);
      grouped.get(bucket).push(row);
    }
    for (const [bucket, rows] of [...grouped.entries()].sort(([left], [right]) => (
      left.localeCompare(right)
    ))) featureSlices.push(rugCheckPanelSlice(field, bucket, rows));
  }
  return {
    type: "geckoterminal-new-pool-birth-social-presence-scorecard",
    ruleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE.version,
    evidenceBoundary: GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE.evidenceBoundary,
    registrationId: cohort.registration?.id ?? null,
    registeredAt: cohort.registration?.registeredAt ?? null,
    parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE.parentRuleVersion,
    parentRegistrationId: cohort.parent.registration?.id ?? null,
    changedDimension: GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE.changedDimension,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    futureParentForecasts: cohort.futureParentForecasts.length,
    candidateForecasts: cohort.forecasts.length,
    openForecasts: cohort.openForecasts,
    eligibleLiveObservations: cohort.rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(cohort.rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens,
    overall: rugCheckPanelSlice("all", "all", weightedRows),
    featureSlices,
    rejectionCounts: cohort.rejectionCounts,
    evidenceStatus: "descriptive-only",
    provisionalGate: false,
    note: "This strictly future scorecard is descriptive only. It joins privacy-safe decision-time website and social-platform presence aggregates from the exact DexScreener pair already used for entry to exact parent outcomes. It stores no URL or handle, selects no threshold, changes no forecast decision, and grants no promotion or trading authority. Any later decision rule must freeze one field and threshold on a separately registered future cohort.",
  };
}

function socialPresenceBucket(field, aggregate) {
  const value = aggregate[field];
  if (typeof value === "boolean") return value ? "true" : "false";
  if (!Number.isInteger(value)) return "missing";
  if (value === 0) return "0";
  if (value === 1) return "1";
  return "2-plus";
}

export function buildGeckoTerminalNewPoolBirthJupiterRoundTripScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolBirthJupiterRoundTripRows(events);
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE;
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const fields = [
    "status",
    "roundTripReturnPct",
    "buyPriceImpactPct",
    "sellPriceImpactPct",
    "buyRouteHopCount",
    "sellRouteHopCount",
  ];
  const featureSlices = [];
  for (const field of fields) {
    const grouped = new Map();
    for (const row of weightedRows) {
      const bucket = jupiterRoundTripBucket(field, row.jupiterRoundTripAggregate);
      if (!grouped.has(bucket)) grouped.set(bucket, []);
      grouped.get(bucket).push(row);
    }
    for (const [bucket, rows] of [...grouped.entries()].sort(([left], [right]) => (
      left.localeCompare(right)
    ))) featureSlices.push(rugCheckPanelSlice(field, bucket, rows));
  }
  return {
    type: "geckoterminal-new-pool-birth-jupiter-roundtrip-scorecard",
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: cohort.registration?.id ?? null,
    registeredAt: cohort.registration?.registeredAt ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    parentRegistrationId: cohort.parent.registration?.id ?? null,
    changedDimension: rule.changedDimension,
    evidenceProvider: rule.evidenceProvider,
    inputUsd: rule.inputUsd,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    futureParentForecasts: cohort.futureParentForecasts.length,
    candidateForecasts: cohort.forecasts.length,
    openForecasts: cohort.openForecasts,
    eligibleLiveObservations: cohort.rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(cohort.rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    completeEvidenceCount: weightedRows.filter((row) => (
      row.jupiterRoundTripAggregate.coverage === "complete"
    )).length,
    unavailableEvidenceCount: weightedRows.filter((row) => (
      row.jupiterRoundTripAggregate.coverage !== "complete"
    )).length,
    roundTripQuotedCount: weightedRows.filter((row) => (
      row.jupiterRoundTripAggregate.status === "round-trip-quoted"
    )).length,
    noBuyRouteCount: weightedRows.filter((row) => (
      row.jupiterRoundTripAggregate.status === "no-buy-route"
    )).length,
    noSellRouteCount: weightedRows.filter((row) => (
      row.jupiterRoundTripAggregate.status === "no-sell-route"
    )).length,
    providerUnavailableCount: weightedRows.filter((row) => (
      row.jupiterRoundTripAggregate.status === "provider-unavailable"
    )).length,
    overall: rugCheckPanelSlice("all", "all", weightedRows),
    featureSlices,
    rejectionCounts: cohort.rejectionCounts,
    evidenceStatus: "descriptive-only",
    provisionalGate: false,
    note: "This strictly future scorecard is descriptive only. It joins an immutable decision-time $100 USDC-to-token-to-USDC Jupiter quote aggregate to the unchanged exact one-hour parent outcome. It stores no raw route, changes no forecast decision, selects no threshold, and grants no promotion or trading authority. Every token used in the feasibility probe or already present in the parent cohort is excluded. Any decision rule must freeze one predeclared route field and threshold on a separately registered future cohort.",
  };
}

export function buildGeckoTerminalNewPoolBirthJupiterExecutableScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolBirthJupiterExecutableRows(events);
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE;
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const selectedRows = weightedRows.filter((row) => row.decision.decision === "paper-long");
  const frameBaseReturns = frames.map((frame) => mean(
    frame.map((row) => row.baseReturnPct),
  ));
  const frameStressReturns = frames.map((frame) => mean(
    frame.map((row) => row.stressReturnPct),
  ));
  const baseCi = frameBaseReturns.length >= 2
    ? circularBlockBootstrapMeanInterval(frameBaseReturns, rule.bootstrapIterations)
    : [null, null];
  const chronological = chronologicalHalfValidation(
    frameBaseReturns,
    frameStressReturns,
    rule,
  );
  const uniqueTokens = new Set(weightedRows.map(tokenEdgeAssetKey)).size;
  const uniqueSelectedTokens = new Set(selectedRows.map(tokenEdgeAssetKey)).size;
  const independentTradedFrames = frames.filter((frame) => (
    frame.some((row) => row.decision.decision === "paper-long")
  )).length;
  const averageBase = mean(frameBaseReturns);
  const averageStress = mean(frameStressReturns);
  const factor = profitFactor(frameBaseReturns);
  const drawdown = maxDrawdownPct(frameBaseReturns);
  const largestWinnerShare = largestWinningShare(frameBaseReturns);
  const rowsByDecisionId = new Map(weightedRows.map((row) => [row.decisionId, row]));
  const missingAsLossRows = cohort.maturedDecisions.map((decision) => {
    const row = rowsByDecisionId.get(decision.id) ?? null;
    const selected = decision.decision === "paper-long";
    return {
      decisionId: decision.id,
      createdAt: decision.createdAt,
      chain: decision.chain,
      tokenAddress: decision.tokenAddress,
      selected,
      validOutcome: Boolean(row),
      baseReturnPct: selected ? (row?.baseReturnPct ?? -100) : 0,
      stressReturnPct: selected ? (row?.stressReturnPct ?? -100) : 0,
    };
  });
  const missingAsLossFrames = independentAssetFrames(missingAsLossRows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const missingAsLossBaseFrames = missingAsLossFrames.map((frame) => mean(
    frame.map((row) => row.baseReturnPct),
  ));
  const missingAsLossStressFrames = missingAsLossFrames.map((frame) => mean(
    frame.map((row) => row.stressReturnPct),
  ));
  const missingAsLossAverageBase = mean(missingAsLossBaseFrames);
  const missingAsLossAverageStress = mean(missingAsLossStressFrames);
  const missingAsLossSensitivityGate = Number.isFinite(missingAsLossAverageBase)
    && Number.isFinite(missingAsLossAverageStress)
    && missingAsLossAverageBase > 0
    && missingAsLossAverageStress > 0;
  const maturedDecisionCount = cohort.maturedDecisionCount;
  const resolvedDecisionCoverageRate = roundRatio(weightedRows.length, maturedDecisionCount);
  const resolvedCoverageGate = Number.isFinite(resolvedDecisionCoverageRate)
    && resolvedDecisionCoverageRate >= rule.minimumResolvedDecisionCoverageRate;
  const evidenceStatus = weightedRows.length >= rule.minimumMaturedForecasts
    && frames.length >= rule.minimumIndependentSignalFrames
    && uniqueTokens >= rule.minimumUniqueTokens
    && selectedRows.length >= rule.minimumRiseCalls
    && independentTradedFrames >= rule.minimumIndependentTradedFrames
    && resolvedCoverageGate
    ? "reviewable" : "collecting";
  const statisticalCandidateGate = evidenceStatus === "reviewable"
    && baseCi[0] > rule.bootstrapLower95MustExceedPct
    && averageStress > 0
    && factor >= rule.minimumProfitFactor
    && drawdown <= rule.maximumDrawdownPct
    && Number.isFinite(largestWinnerShare)
    && largestWinnerShare <= rule.maximumLargestWinningFrameShare
    && missingAsLossSensitivityGate
    && chronological.gate;
  const independentQuantValidationStatus = "not-run";
  const provisionalGate = statisticalCandidateGate
    && independentQuantValidationStatus === "passed";
  return {
    type: "geckoterminal-new-pool-birth-jupiter-executable-scorecard",
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: cohort.registration?.id ?? null,
    registeredAt: cohort.registration?.registeredAt ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    executionProvider: rule.executionProvider,
    inputUsd: rule.inputUsd,
    researchOnly: true,
    mutationAllowed: false,
    promotionAuthority: false,
    scorecardAsOf: cohort.scorecardAsOf,
    candidateDecisions: cohort.decisions.length,
    openDecisions: cohort.openDecisions,
    recordedMaturedResolutions: cohort.recordedMaturedResolutions,
    unrecordedMaturedDecisions: cohort.unrecordedMaturedDecisions,
    eligibleLiveObservations: cohort.rows.length,
    unavailableDecisions: cohort.decisions.filter((decision) => (
      decision.decision === "unavailable"
    )).length,
    paperLongDecisions: cohort.decisions.filter((decision) => (
      decision.decision === "paper-long"
    )).length,
    paperCashDecisions: cohort.decisions.filter((decision) => (
      decision.decision === "paper-cash"
    )).length,
    missedResolutions: cohort.missedResolutions,
    unavailableResolutions: cohort.unavailableResolutions,
    maturedDecisionCount,
    resolvedDecisionCoverageRate,
    minimumResolvedDecisionCoverageRate: rule.minimumResolvedDecisionCoverageRate,
    resolvedCoverageGate,
    liquidityCollapseCount: weightedRows.filter((row) => (
      row.resolution.status === "liquidity-collapse"
    )).length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(cohort.rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens,
    uniqueSelectedTokens,
    selectedRiseCalls: selectedRows.length,
    independentTradedFrames,
    selectedRisePrecision: roundRatio(
      selectedRows.filter((row) => row.grossReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedNetWinRate: roundRatio(
      selectedRows.filter((row) => row.baseReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedExplosion25Count: selectedRows.filter((row) => row.grossReturnPct >= 25).length,
    selectedExplosion50Count: selectedRows.filter((row) => row.grossReturnPct >= 50).length,
    selectedExplosion100Count: selectedRows.filter((row) => row.grossReturnPct >= 100).length,
    portfolioAverageBaseReturnPct: nullableRound(averageBase),
    portfolioAverageStressReturnPct: nullableRound(averageStress),
    portfolioBootstrapMeanReturnCi95Pct: baseCi.map(nullableRound),
    missingAsLossMaturedDecisions: cohort.maturedDecisions.length,
    missingAsLossUnscoredDecisions: missingAsLossRows.filter((row) => (
      !row.validOutcome
    )).length,
    missingAsLossSelectedDecisions: missingAsLossRows.filter((row) => (
      row.selected
    )).length,
    missingAsLossIndependentHourlyFrames: missingAsLossFrames.length,
    missingAsLossAverageBaseReturnPct: nullableRound(missingAsLossAverageBase),
    missingAsLossAverageStressReturnPct: nullableRound(missingAsLossAverageStress),
    missingAsLossSensitivityGate,
    chronologicalHalfValidation: chronological.validation,
    chronologicalHalfValidationGate: chronological.gate,
    profitFactor: nullableRound(factor),
    maxDrawdownPct: nullableRound(drawdown),
    largestWinningFrameShare: nullableRound(largestWinnerShare),
    rejectionCounts: cohort.rejectionCounts,
    evidenceStatus,
    evidenceShortfall: {
      observations: Math.max(0, rule.minimumMaturedForecasts - weightedRows.length),
      independentFrames: Math.max(0, rule.minimumIndependentSignalFrames - frames.length),
      uniqueTokens: Math.max(0, rule.minimumUniqueTokens - uniqueTokens),
      selectedRiseCalls: Math.max(0, rule.minimumRiseCalls - selectedRows.length),
      independentTradedFrames: Math.max(
        0,
        rule.minimumIndependentTradedFrames - independentTradedFrames,
      ),
      resolvedDecisionCoverageRate: Math.max(
        0,
        rule.minimumResolvedDecisionCoverageRate
          - (resolvedDecisionCoverageRate ?? 0),
      ),
      ...chronological.evidenceShortfall,
    },
    statisticalCandidateGate,
    independentQuantValidationRequired: true,
    independentQuantValidationStatus,
    independentQuantValidationRequirements: INDEPENDENT_QUANT_VALIDATION_REQUIREMENTS,
    provisionalGate,
    note: "This frozen future-only paper cohort changes one provider dimension: the low-cap newborn source is entered and exited with exact-in public Jupiter quotes rather than requiring GeckoTerminal/DexScreener price consensus. A $100 decision is paper-long only when both the buy and immediate reverse routes quote; definitive no-routes are cash, provider outages receive no PnL credit, and held tokens with no exact one-hour exit route score -100%. Maturity is derived from immutable dueAt values against the latest ledger occurrence, so an overdue unresolved paper-long remains in coverage and scores -100% in missing-as-loss sensitivity while paper-cash and unavailable entry decisions remain zero. Quote results already reflect route fees and price impact; the score still deducts the conservative 4% base and 12% stress cost haircuts. The statistical candidate gate cannot promote the rule: independent Newey-West, multiple-testing, placebo, overfit, deflated-Sharpe, factor, regime, and reconciliation audits remain mandatory and not run. All derivation tokens and pre-registration pools are excluded. No result grants live-trading authority.",
  };
}

function jupiterRoundTripBucket(field, aggregate) {
  const value = aggregate[field];
  if (field === "status") return text(value) ?? "missing";
  if (!Number.isFinite(value)) return "missing";
  if (field === "roundTripReturnPct") {
    if (value <= -75) return "minus100-to-minus75";
    if (value <= -25) return "minus75-to-minus25";
    if (value <= -10) return "minus25-to-minus10";
    if (value < 0) return "minus10-to-zero";
    return "zero-plus";
  }
  if (field === "buyPriceImpactPct" || field === "sellPriceImpactPct") {
    if (value <= 0.05) return "0-to-0.05";
    if (value <= 0.2) return "0.05-to-0.20";
    if (value <= 0.5) return "0.20-to-0.50";
    return "0.50-plus";
  }
  if (field === "buyRouteHopCount" || field === "sellRouteHopCount") {
    if (value === 0) return "0";
    if (value === 1) return "1";
    return "2-plus";
  }
  return "missing";
}

export function buildGeckoTerminalNewPoolBirthDangerCountScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolBirthDangerCountRows(events);
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_DANGER_COUNT_RULE;
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const selectedRows = weightedRows.filter((row) => row.dangerCountSelected);
  const parentBase = frames.map((frame) => mean(
    frame.map((row) => row.baseCapacityReturnPct),
  ));
  const parentStress = frames.map((frame) => mean(
    frame.map((row) => row.stressCapacityReturnPct),
  ));
  const childBase = frames.map((frame) => mean(
    frame.map((row) => row.dangerCountSelected ? row.baseCapacityReturnPct : 0),
  ));
  const childStress = frames.map((frame) => mean(
    frame.map((row) => row.dangerCountSelected ? row.stressCapacityReturnPct : 0),
  ));
  const pairedBaseDeltas = childBase.map((value, index) => value - parentBase[index]);
  const pairedStressDeltas = childStress.map((value, index) => value - parentStress[index]);
  const childCi = childBase.length >= 2
    ? circularBlockBootstrapMeanInterval(childBase, rule.bootstrapIterations)
    : [null, null];
  const pairedCi = pairedBaseDeltas.length >= 2
    ? circularBlockBootstrapMeanInterval(pairedBaseDeltas, rule.bootstrapIterations)
    : [null, null];
  const chronological = chronologicalHalfValidation(childBase, childStress, rule);
  const coverage = forecastOutcomeCoverageValidation(cohort, {
    selectionField: "dangerCountChallengerPredictedRise",
  });
  const uniqueSelectedTokens = new Set(selectedRows.map(tokenEdgeAssetKey)).size;
  const independentTradedFrames = frames.filter((frame) => (
    frame.some((row) => row.dangerCountSelected)
  )).length;
  const averageChildBase = mean(childBase);
  const averageChildStress = mean(childStress);
  const factor = profitFactor(childBase);
  const drawdown = maxDrawdownPct(childBase);
  const largestWinnerShare = largestWinningShare(childBase);
  const evidenceStatus = weightedRows.length >= rule.minimumMaturedForecasts
    && frames.length >= rule.minimumIndependentSignalFrames
    && uniqueSelectedTokens >= rule.minimumUniqueTokens
    && selectedRows.length >= rule.minimumRiseCalls
    && independentTradedFrames >= rule.minimumIndependentTradedFrames
    && coverage.gate
    ? "reviewable" : "collecting";
  const provisionalGate = evidenceStatus === "reviewable"
    && childCi[0] > rule.bootstrapLower95MustExceedPct
    && pairedCi[0] > rule.bootstrapLower95MustExceedPct
    && averageChildStress > 0
    && factor >= rule.minimumProfitFactor
    && drawdown <= rule.maximumDrawdownPct
    && Number.isFinite(largestWinnerShare)
    && largestWinnerShare <= rule.maximumLargestWinningFrameShare
    && coverage.missingAsLossGate
    && chronological.gate;
  return {
    type: "geckoterminal-new-pool-birth-danger-count-scorecard",
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: cohort.registration?.id ?? null,
    registeredAt: cohort.registration?.registeredAt ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    parentRegistrationId: cohort.parent.registration?.id ?? null,
    evidenceRuleVersion: rule.evidenceRuleVersion,
    evidenceRegistrationId: cohort.riskPanelRegistration?.id ?? null,
    changedDimension: rule.changedDimension,
    minimumDangerRiskCountInclusive: rule.minimumDangerRiskCountInclusive,
    maximumDangerRiskCountInclusive: rule.maximumDangerRiskCountInclusive,
    researchOnly: true,
    mutationAllowed: false,
    futureParentForecasts: cohort.futureParentForecasts.length,
    candidateForecasts: cohort.forecasts.length,
    openForecasts: cohort.openForecasts,
    eligibleLiveObservations: cohort.rows.length,
    ...coverage.summary,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(cohort.rows, frames),
    independentHourlyFrames: frames.length,
    selectedRiseCalls: selectedRows.length,
    independentTradedFrames,
    uniqueSelectedTokens,
    completeEvidenceCount: weightedRows.filter((row) => (
      row.dangerCountAggregate.coverage === "complete"
    )).length,
    unavailableEvidenceCount: weightedRows.filter((row) => (
      row.dangerCountAggregate.coverage !== "complete"
    )).length,
    selectedRisePrecision: roundRatio(
      selectedRows.filter((row) => row.grossReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedNetWinRate: roundRatio(
      selectedRows.filter((row) => row.baseCapacityReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedExplosion25Count: selectedRows.filter((row) => row.grossReturnPct >= 25).length,
    selectedExplosion50Count: selectedRows.filter((row) => row.grossReturnPct >= 50).length,
    selectedExplosion100Count: selectedRows.filter((row) => row.grossReturnPct >= 100).length,
    selectedLiquidityCollapseCount: selectedRows.filter((row) => (
      row.resolution.status === "liquidity-collapse"
    )).length,
    parentPortfolioAverageCapacityReturnPct: nullableRound(mean(parentBase)),
    portfolioAverageCapacityReturnPct: nullableRound(averageChildBase),
    pairedCapacityDeltaPct: nullableRound(mean(pairedBaseDeltas)),
    parentStressPortfolioAverageCapacityReturnPct: nullableRound(mean(parentStress)),
    stressPortfolioAverageCapacityReturnPct: nullableRound(averageChildStress),
    pairedStressCapacityDeltaPct: nullableRound(mean(pairedStressDeltas)),
    portfolioBootstrapMeanReturnCi95Pct: childCi.map(nullableRound),
    pairedDeltaBootstrapMeanCi95Pct: pairedCi.map(nullableRound),
    chronologicalHalfValidation: chronological.validation,
    chronologicalHalfValidationGate: chronological.gate,
    profitFactor: nullableRound(factor),
    maxDrawdownPct: nullableRound(drawdown),
    largestWinningFrameShare: nullableRound(largestWinnerShare),
    exactOutcomeMismatches: 0,
    rejectionCounts: cohort.rejectionCounts,
    evidenceStatus,
    evidenceShortfall: {
      observations: Math.max(0, rule.minimumMaturedForecasts - weightedRows.length),
      independentFrames: Math.max(0, rule.minimumIndependentSignalFrames - frames.length),
      uniqueSelectedTokens: Math.max(0, rule.minimumUniqueTokens - uniqueSelectedTokens),
      selectedRiseCalls: Math.max(0, rule.minimumRiseCalls - selectedRows.length),
      independentTradedFrames: Math.max(
        0,
        rule.minimumIndependentTradedFrames - independentTradedFrames,
      ),
      ...coverage.evidenceShortfall,
      ...chronological.evidenceShortfall,
    },
    provisionalGate,
    note: "This strictly future paper child keeps the low-cap newborn source, entry quote, exact one-hour outcome, capacity, costs, and promotion gates unchanged. It changes only whether a complete pre-entry immutable RugCheck aggregate has one or two danger risks; every other count and unavailable evidence is paper cash. All 11 tokens visible during derivation are excluded, including KIO, Shiro, and Doom. The tiny post-selected derivation has no evidentiary or trading authority.",
  };
}

export function buildGeckoTerminalNewPoolBirthTurnoverScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolBirthTurnoverRows(events);
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_TURNOVER_RULE;
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const selectedRows = weightedRows.filter((row) => row.turnoverSelected);
  const parentBase = frames.map((frame) => mean(
    frame.map((row) => row.baseCapacityReturnPct),
  ));
  const parentStress = frames.map((frame) => mean(
    frame.map((row) => row.stressCapacityReturnPct),
  ));
  const childBase = frames.map((frame) => mean(
    frame.map((row) => row.turnoverSelected ? row.baseCapacityReturnPct : 0),
  ));
  const childStress = frames.map((frame) => mean(
    frame.map((row) => row.turnoverSelected ? row.stressCapacityReturnPct : 0),
  ));
  const pairedBaseDeltas = childBase.map((value, index) => value - parentBase[index]);
  const pairedStressDeltas = childStress.map((value, index) => value - parentStress[index]);
  const childCi = childBase.length >= 2
    ? circularBlockBootstrapMeanInterval(childBase, rule.bootstrapIterations)
    : [null, null];
  const pairedCi = pairedBaseDeltas.length >= 2
    ? circularBlockBootstrapMeanInterval(pairedBaseDeltas, rule.bootstrapIterations)
    : [null, null];
  const chronological = chronologicalHalfValidation(childBase, childStress, rule);
  const coverage = forecastOutcomeCoverageValidation(cohort, {
    selectionField: "turnoverChallengerPredictedRise",
  });
  const uniqueSelectedTokens = new Set(selectedRows.map(tokenEdgeAssetKey)).size;
  const independentTradedFrames = frames.filter((frame) => (
    frame.some((row) => row.turnoverSelected)
  )).length;
  const averageChildBase = mean(childBase);
  const averageChildStress = mean(childStress);
  const factor = profitFactor(childBase);
  const drawdown = maxDrawdownPct(childBase);
  const largestWinnerShare = largestWinningShare(childBase);
  const evidenceStatus = weightedRows.length >= rule.minimumMaturedForecasts
    && frames.length >= rule.minimumIndependentSignalFrames
    && uniqueSelectedTokens >= rule.minimumUniqueTokens
    && selectedRows.length >= rule.minimumRiseCalls
    && independentTradedFrames >= rule.minimumIndependentTradedFrames
    && coverage.gate
    ? "reviewable" : "collecting";
  const provisionalGate = evidenceStatus === "reviewable"
    && childCi[0] > rule.bootstrapLower95MustExceedPct
    && pairedCi[0] > rule.bootstrapLower95MustExceedPct
    && averageChildStress > 0
    && factor >= rule.minimumProfitFactor
    && drawdown <= rule.maximumDrawdownPct
    && Number.isFinite(largestWinnerShare)
    && largestWinnerShare <= rule.maximumLargestWinningFrameShare
    && coverage.missingAsLossGate
    && chronological.gate;
  return {
    type: "geckoterminal-new-pool-birth-turnover-scorecard",
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: cohort.registration?.id ?? null,
    registeredAt: cohort.registration?.registeredAt ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    parentRegistrationId: cohort.parent.registration?.id ?? null,
    changedDimension: rule.changedDimension,
    maximumFiveMinuteTurnoverInclusive: rule.maximumFiveMinuteTurnoverInclusive,
    researchOnly: true,
    mutationAllowed: false,
    futureParentForecasts: cohort.futureParentForecasts.length,
    candidateForecasts: cohort.forecasts.length,
    openForecasts: cohort.openForecasts,
    eligibleLiveObservations: cohort.rows.length,
    ...coverage.summary,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(cohort.rows, frames),
    independentHourlyFrames: frames.length,
    selectedRiseCalls: selectedRows.length,
    independentTradedFrames,
    uniqueSelectedTokens,
    selectedRisePrecision: roundRatio(
      selectedRows.filter((row) => row.grossReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedNetWinRate: roundRatio(
      selectedRows.filter((row) => row.baseCapacityReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedExplosion25Count: selectedRows.filter((row) => row.grossReturnPct >= 25).length,
    selectedExplosion50Count: selectedRows.filter((row) => row.grossReturnPct >= 50).length,
    selectedExplosion100Count: selectedRows.filter((row) => row.grossReturnPct >= 100).length,
    selectedLiquidityCollapseCount: selectedRows.filter((row) => (
      row.resolution.status === "liquidity-collapse"
    )).length,
    parentPortfolioAverageCapacityReturnPct: nullableRound(mean(parentBase)),
    portfolioAverageCapacityReturnPct: nullableRound(averageChildBase),
    pairedCapacityDeltaPct: nullableRound(mean(pairedBaseDeltas)),
    parentStressPortfolioAverageCapacityReturnPct: nullableRound(mean(parentStress)),
    stressPortfolioAverageCapacityReturnPct: nullableRound(averageChildStress),
    pairedStressCapacityDeltaPct: nullableRound(mean(pairedStressDeltas)),
    portfolioBootstrapMeanReturnCi95Pct: childCi.map(nullableRound),
    pairedDeltaBootstrapMeanCi95Pct: pairedCi.map(nullableRound),
    chronologicalHalfValidation: chronological.validation,
    chronologicalHalfValidationGate: chronological.gate,
    profitFactor: nullableRound(factor),
    maxDrawdownPct: nullableRound(drawdown),
    largestWinningFrameShare: nullableRound(largestWinnerShare),
    exactOutcomeMismatches: 0,
    rejectionCounts: cohort.rejectionCounts,
    evidenceStatus,
    evidenceShortfall: {
      observations: Math.max(0, rule.minimumMaturedForecasts - weightedRows.length),
      independentFrames: Math.max(0, rule.minimumIndependentSignalFrames - frames.length),
      uniqueSelectedTokens: Math.max(0, rule.minimumUniqueTokens - uniqueSelectedTokens),
      selectedRiseCalls: Math.max(0, rule.minimumRiseCalls - selectedRows.length),
      independentTradedFrames: Math.max(
        0,
        rule.minimumIndependentTradedFrames - independentTradedFrames,
      ),
      ...coverage.evidenceShortfall,
      ...chronological.evidenceShortfall,
    },
    provisionalGate,
    note: "This strictly future paper child keeps the low-cap newborn source, entry quote, exact one-hour outcome, capacity, costs, and every promotion gate unchanged. It changes only whether decision-time five-minute volume/liquidity turnover is at most 10%; higher-turnover eligible parents are paper cash. All nine inspected parent forecasts are excluded, and the multiple-tested derivation has no evidentiary authority.",
  };
}

export function buildGeckoTerminalNewPoolBirthLowMomentumScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolBirthLowMomentumRows(events);
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_LOW_MOMENTUM_RULE;
  const promotionPolicy = TOKEN_EDGE_EXECUTION_POLICY;
  const minimumRiseCalls = 50;
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const selectedRows = weightedRows.filter((row) => row.lowMomentumSelected);
  const parentBase = frames.map((frame) => mean(
    frame.map((row) => row.baseCapacityReturnPct),
  ));
  const parentStress = frames.map((frame) => mean(
    frame.map((row) => row.stressCapacityReturnPct),
  ));
  const childBase = frames.map((frame) => mean(
    frame.map((row) => row.lowMomentumSelected ? row.baseCapacityReturnPct : 0),
  ));
  const childStress = frames.map((frame) => mean(
    frame.map((row) => row.lowMomentumSelected ? row.stressCapacityReturnPct : 0),
  ));
  const pairedBaseDeltas = childBase.map((value, index) => value - parentBase[index]);
  const pairedStressDeltas = childStress.map((value, index) => value - parentStress[index]);
  const childCi = childBase.length >= 2
    ? circularBlockBootstrapMeanInterval(childBase, promotionPolicy.bootstrapIterations)
    : [null, null];
  const pairedCi = pairedBaseDeltas.length >= 2
    ? circularBlockBootstrapMeanInterval(pairedBaseDeltas, promotionPolicy.bootstrapIterations)
    : [null, null];
  const chronological = chronologicalHalfValidation(
    childBase,
    childStress,
    promotionPolicy,
  );
  const uniqueSelectedTokens = new Set(selectedRows.map(tokenEdgeAssetKey)).size;
  const independentTradedFrames = frames.filter((frame) => (
    frame.some((row) => row.lowMomentumSelected)
  )).length;
  const averageChildBase = mean(childBase);
  const averageChildStress = mean(childStress);
  const factor = profitFactor(childBase);
  const drawdown = maxDrawdownPct(childBase);
  const largestWinnerShare = largestWinningShare(childBase);
  const coverage = forecastOutcomeCoverageValidation(cohort, {
    selectionField: "lowMomentumChallengerPredictedRise",
  });
  const evidenceStatus = weightedRows.length >= promotionPolicy.minimumMaturedForecasts
    && frames.length >= promotionPolicy.minimumIndependentSignalFrames
    && uniqueSelectedTokens >= promotionPolicy.minimumUniqueTokens
    && selectedRows.length >= minimumRiseCalls
    && independentTradedFrames >= promotionPolicy.minimumIndependentTradedFrames
    && coverage.gate
    ? "reviewable" : "collecting";
  const internalProvisionalGate = evidenceStatus === "reviewable"
    && childCi[0] > promotionPolicy.bootstrapLower95MustExceedPct
    && pairedCi[0] > promotionPolicy.bootstrapLower95MustExceedPct
    && averageChildStress > 0
    && factor >= promotionPolicy.minimumProfitFactor
    && drawdown <= promotionPolicy.maximumDrawdownPct
    && Number.isFinite(largestWinnerShare)
    && largestWinnerShare <= promotionPolicy.maximumLargestWinningFrameShare
    && coverage.missingAsLossGate
    && chronological.gate;
  return {
    type: "geckoterminal-new-pool-birth-low-momentum-scorecard",
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: cohort.registration?.id ?? null,
    registeredAt: cohort.registration?.registeredAt ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    parentRegistrationId: cohort.parent.registration?.id ?? null,
    changedDimension: rule.changedDimension,
    maximumFiveMinutePriceChangePctInclusive:
      rule.maximumFiveMinutePriceChangePctInclusive,
    researchOnly: true,
    mutationAllowed: false,
    futureParentForecasts: cohort.futureParentForecasts.length,
    candidateForecasts: cohort.forecasts.length,
    openForecasts: cohort.openForecasts,
    eligibleLiveObservations: cohort.rows.length,
    ...coverage.summary,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(cohort.rows, frames),
    independentHourlyFrames: frames.length,
    selectedRiseCalls: selectedRows.length,
    independentTradedFrames,
    uniqueSelectedTokens,
    selectedRisePrecision: roundRatio(
      selectedRows.filter((row) => row.grossReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedNetWinRate: roundRatio(
      selectedRows.filter((row) => row.baseCapacityReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedExplosion25Count: selectedRows.filter((row) => row.grossReturnPct >= 25).length,
    selectedExplosion50Count: selectedRows.filter((row) => row.grossReturnPct >= 50).length,
    selectedExplosion100Count: selectedRows.filter((row) => row.grossReturnPct >= 100).length,
    selectedLiquidityCollapseCount: selectedRows.filter((row) => (
      row.resolution.status === "liquidity-collapse"
    )).length,
    parentPortfolioAverageCapacityReturnPct: nullableRound(mean(parentBase)),
    portfolioAverageCapacityReturnPct: nullableRound(averageChildBase),
    pairedCapacityDeltaPct: nullableRound(mean(pairedBaseDeltas)),
    parentStressPortfolioAverageCapacityReturnPct: nullableRound(mean(parentStress)),
    stressPortfolioAverageCapacityReturnPct: nullableRound(averageChildStress),
    pairedStressCapacityDeltaPct: nullableRound(mean(pairedStressDeltas)),
    portfolioBootstrapMeanReturnCi95Pct: childCi.map(nullableRound),
    pairedDeltaBootstrapMeanCi95Pct: pairedCi.map(nullableRound),
    chronologicalHalfValidation: chronological.validation,
    chronologicalHalfValidationGate: chronological.gate,
    profitFactor: nullableRound(factor),
    maxDrawdownPct: nullableRound(drawdown),
    largestWinningFrameShare: nullableRound(largestWinnerShare),
    exactOutcomeMismatches: 0,
    rejectionCounts: cohort.rejectionCounts,
    evidenceStatus,
    evidenceShortfall: {
      observations: Math.max(
        0,
        promotionPolicy.minimumMaturedForecasts - weightedRows.length,
      ),
      independentFrames: Math.max(
        0,
        promotionPolicy.minimumIndependentSignalFrames - frames.length,
      ),
      uniqueSelectedTokens: Math.max(
        0,
        promotionPolicy.minimumUniqueTokens - uniqueSelectedTokens,
      ),
      selectedRiseCalls: Math.max(0, minimumRiseCalls - selectedRows.length),
      independentTradedFrames: Math.max(
        0,
        promotionPolicy.minimumIndependentTradedFrames - independentTradedFrames,
      ),
      ...coverage.evidenceShortfall,
      ...chronological.evidenceShortfall,
    },
    promotionAuthority: false,
    statisticalCandidateGate: internalProvisionalGate,
    independentQuantValidationRequired: true,
    independentQuantValidationStatus: "not-run",
    independentQuantValidationRequirements: INDEPENDENT_QUANT_VALIDATION_REQUIREMENTS,
    provisionalGate: false,
    note: "This strictly future paper child keeps the low-cap newborn source, entry quote, exact one-hour outcome, capacity, costs, and promotion floors unchanged. It changes only whether decision-time five-minute price change is at most +5%; higher-momentum eligible parents are paper cash. All 18 inspected tokens and all 15,986 earlier ledger events are excluded. The 65-variant retrospective search had only four selected frames, 72.105% drawdown, and 69.843% winner concentration, so it is a weak falsification test with no promotion or trading authority.",
  };
}

export function buildGeckoTerminalNewPoolBirthPairAgeScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolBirthPairAgeRows(events);
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE;
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const selectedRows = weightedRows.filter((row) => row.pairAgeSelected);
  const parentBase = frames.map((frame) => mean(
    frame.map((row) => row.baseCapacityReturnPct),
  ));
  const parentStress = frames.map((frame) => mean(
    frame.map((row) => row.stressCapacityReturnPct),
  ));
  const childBase = frames.map((frame) => mean(
    frame.map((row) => row.pairAgeSelected ? row.baseCapacityReturnPct : 0),
  ));
  const childStress = frames.map((frame) => mean(
    frame.map((row) => row.pairAgeSelected ? row.stressCapacityReturnPct : 0),
  ));
  const pairedBaseDeltas = childBase.map((value, index) => value - parentBase[index]);
  const pairedStressDeltas = childStress.map((value, index) => value - parentStress[index]);
  const childCi = childBase.length >= 2
    ? circularBlockBootstrapMeanInterval(childBase, rule.bootstrapIterations)
    : [null, null];
  const pairedCi = pairedBaseDeltas.length >= 2
    ? circularBlockBootstrapMeanInterval(pairedBaseDeltas, rule.bootstrapIterations)
    : [null, null];
  const chronological = chronologicalHalfValidation(childBase, childStress, rule);
  const coverage = forecastOutcomeCoverageValidation(cohort, {
    selectionField: "pairAgeChallengerPredictedRise",
  });
  const uniqueSelectedTokens = new Set(selectedRows.map(tokenEdgeAssetKey)).size;
  const independentTradedFrames = frames.filter((frame) => (
    frame.some((row) => row.pairAgeSelected)
  )).length;
  const averageChildBase = mean(childBase);
  const averageChildStress = mean(childStress);
  const factor = profitFactor(childBase);
  const drawdown = maxDrawdownPct(childBase);
  const largestWinnerShare = largestWinningShare(childBase);
  const evidenceStatus = weightedRows.length >= rule.minimumMaturedForecasts
    && frames.length >= rule.minimumIndependentSignalFrames
    && uniqueSelectedTokens >= rule.minimumUniqueTokens
    && selectedRows.length >= rule.minimumRiseCalls
    && independentTradedFrames >= rule.minimumIndependentTradedFrames
    && coverage.gate
    ? "reviewable" : "collecting";
  const provisionalGate = evidenceStatus === "reviewable"
    && childCi[0] > rule.bootstrapLower95MustExceedPct
    && pairedCi[0] > rule.bootstrapLower95MustExceedPct
    && averageChildStress > 0
    && factor >= rule.minimumProfitFactor
    && drawdown <= rule.maximumDrawdownPct
    && Number.isFinite(largestWinnerShare)
    && largestWinnerShare <= rule.maximumLargestWinningFrameShare
    && coverage.missingAsLossGate
    && chronological.gate;
  return {
    type: "geckoterminal-new-pool-birth-pair-age-scorecard",
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: cohort.registration?.id ?? null,
    registeredAt: cohort.registration?.registeredAt ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    parentRegistrationId: cohort.parent.registration?.id ?? null,
    changedDimension: rule.changedDimension,
    minimumPairAgeMinutesInclusive: rule.minimumPairAgeMinutesInclusive,
    researchOnly: true,
    mutationAllowed: false,
    futureParentForecasts: cohort.futureParentForecasts.length,
    candidateForecasts: cohort.forecasts.length,
    openForecasts: cohort.openForecasts,
    eligibleLiveObservations: cohort.rows.length,
    ...coverage.summary,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(cohort.rows, frames),
    independentHourlyFrames: frames.length,
    selectedRiseCalls: selectedRows.length,
    independentTradedFrames,
    uniqueSelectedTokens,
    selectedRisePrecision: roundRatio(
      selectedRows.filter((row) => row.grossReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedNetWinRate: roundRatio(
      selectedRows.filter((row) => row.baseCapacityReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedExplosion25Count: selectedRows.filter((row) => row.grossReturnPct >= 25).length,
    selectedExplosion50Count: selectedRows.filter((row) => row.grossReturnPct >= 50).length,
    selectedExplosion100Count: selectedRows.filter((row) => row.grossReturnPct >= 100).length,
    selectedLiquidityCollapseCount: selectedRows.filter((row) => (
      row.resolution.status === "liquidity-collapse"
    )).length,
    parentPortfolioAverageCapacityReturnPct: nullableRound(mean(parentBase)),
    portfolioAverageCapacityReturnPct: nullableRound(averageChildBase),
    pairedCapacityDeltaPct: nullableRound(mean(pairedBaseDeltas)),
    parentStressPortfolioAverageCapacityReturnPct: nullableRound(mean(parentStress)),
    stressPortfolioAverageCapacityReturnPct: nullableRound(averageChildStress),
    pairedStressCapacityDeltaPct: nullableRound(mean(pairedStressDeltas)),
    portfolioBootstrapMeanReturnCi95Pct: childCi.map(nullableRound),
    pairedDeltaBootstrapMeanCi95Pct: pairedCi.map(nullableRound),
    chronologicalHalfValidation: chronological.validation,
    chronologicalHalfValidationGate: chronological.gate,
    profitFactor: nullableRound(factor),
    maxDrawdownPct: nullableRound(drawdown),
    largestWinningFrameShare: nullableRound(largestWinnerShare),
    exactOutcomeMismatches: 0,
    rejectionCounts: cohort.rejectionCounts,
    evidenceStatus,
    evidenceShortfall: {
      observations: Math.max(0, rule.minimumMaturedForecasts - weightedRows.length),
      independentFrames: Math.max(0, rule.minimumIndependentSignalFrames - frames.length),
      uniqueSelectedTokens: Math.max(0, rule.minimumUniqueTokens - uniqueSelectedTokens),
      selectedRiseCalls: Math.max(0, rule.minimumRiseCalls - selectedRows.length),
      independentTradedFrames: Math.max(
        0,
        rule.minimumIndependentTradedFrames - independentTradedFrames,
      ),
      ...coverage.evidenceShortfall,
      ...chronological.evidenceShortfall,
    },
    provisionalGate,
    note: "This future-only paper child keeps the low-cap newborn source, entry quote, exact one-hour outcome, capacity, costs, and every promotion gate unchanged. It changes only whether decision-time pool age is at least two minutes; younger eligible parent forecasts are paper cash. All nine inspected parent forecasts and outcomes are excluded derivation provenance.",
  };
}

export function buildGeckoTerminalNewPoolBirthCreatorBalanceScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolBirthCreatorBalanceRows(events);
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE;
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const selectedRows = weightedRows.filter((row) => row.creatorBalanceSelected);
  const parentBase = frames.map((frame) => mean(
    frame.map((row) => row.baseCapacityReturnPct),
  ));
  const parentStress = frames.map((frame) => mean(
    frame.map((row) => row.stressCapacityReturnPct),
  ));
  const childBase = frames.map((frame) => mean(
    frame.map((row) => row.creatorBalanceSelected ? row.baseCapacityReturnPct : 0),
  ));
  const childStress = frames.map((frame) => mean(
    frame.map((row) => row.creatorBalanceSelected ? row.stressCapacityReturnPct : 0),
  ));
  const pairedBaseDeltas = childBase.map((value, index) => value - parentBase[index]);
  const pairedStressDeltas = childStress.map((value, index) => value - parentStress[index]);
  const childCi = childBase.length >= 2
    ? circularBlockBootstrapMeanInterval(childBase, rule.bootstrapIterations)
    : [null, null];
  const pairedCi = pairedBaseDeltas.length >= 2
    ? circularBlockBootstrapMeanInterval(pairedBaseDeltas, rule.bootstrapIterations)
    : [null, null];
  const chronological = chronologicalHalfValidation(childBase, childStress, rule);
  const coverage = forecastOutcomeCoverageValidation(cohort, {
    selectionField: "creatorBalanceChallengerPredictedRise",
  });
  const uniqueSelectedTokens = new Set(selectedRows.map(tokenEdgeAssetKey)).size;
  const independentTradedFrames = frames.filter((frame) => (
    frame.some((row) => row.creatorBalanceSelected)
  )).length;
  const averageChildBase = mean(childBase);
  const averageChildStress = mean(childStress);
  const factor = profitFactor(childBase);
  const drawdown = maxDrawdownPct(childBase);
  const largestWinnerShare = largestWinningShare(childBase);
  const evidenceStatus = weightedRows.length >= rule.minimumMaturedForecasts
    && frames.length >= rule.minimumIndependentSignalFrames
    && uniqueSelectedTokens >= rule.minimumUniqueTokens
    && selectedRows.length >= rule.minimumRiseCalls
    && independentTradedFrames >= rule.minimumIndependentTradedFrames
    && coverage.gate
    ? "reviewable" : "collecting";
  const provisionalGate = evidenceStatus === "reviewable"
    && childCi[0] > rule.bootstrapLower95MustExceedPct
    && pairedCi[0] > rule.bootstrapLower95MustExceedPct
    && averageChildStress > 0
    && factor >= rule.minimumProfitFactor
    && drawdown <= rule.maximumDrawdownPct
    && Number.isFinite(largestWinnerShare)
    && largestWinnerShare <= rule.maximumLargestWinningFrameShare
    && coverage.missingAsLossGate
    && chronological.gate;
  return {
    type: "geckoterminal-new-pool-birth-creator-balance-scorecard",
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: cohort.registration?.id ?? null,
    registeredAt: cohort.registration?.registeredAt ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    parentRegistrationId: cohort.parent.registration?.id ?? null,
    changedDimension: rule.changedDimension,
    researchOnly: true,
    mutationAllowed: false,
    futureParentForecasts: cohort.futureParentForecasts.length,
    candidateForecasts: cohort.forecasts.length,
    openForecasts: cohort.openForecasts,
    eligibleLiveObservations: cohort.rows.length,
    ...coverage.summary,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(cohort.rows, frames),
    independentHourlyFrames: frames.length,
    selectedRiseCalls: selectedRows.length,
    independentTradedFrames,
    uniqueSelectedTokens,
    exactEvidenceCoverageCount: weightedRows.filter((row) => (
      row.creatorBalanceAggregate.coverage === "complete"
    )).length,
    unavailableEvidenceCount: weightedRows.filter((row) => (
      row.creatorBalanceAggregate.coverage !== "complete"
    )).length,
    selectedRisePrecision: roundRatio(
      selectedRows.filter((row) => row.grossReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedNetWinRate: roundRatio(
      selectedRows.filter((row) => row.baseCapacityReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedExplosion25Count: selectedRows.filter((row) => row.grossReturnPct >= 25).length,
    selectedExplosion50Count: selectedRows.filter((row) => row.grossReturnPct >= 50).length,
    selectedExplosion100Count: selectedRows.filter((row) => row.grossReturnPct >= 100).length,
    selectedLiquidityCollapseCount: selectedRows.filter((row) => (
      row.resolution.status === "liquidity-collapse"
    )).length,
    parentPortfolioAverageCapacityReturnPct: nullableRound(mean(parentBase)),
    portfolioAverageCapacityReturnPct: nullableRound(averageChildBase),
    pairedCapacityDeltaPct: nullableRound(mean(pairedBaseDeltas)),
    parentStressPortfolioAverageCapacityReturnPct: nullableRound(mean(parentStress)),
    stressPortfolioAverageCapacityReturnPct: nullableRound(averageChildStress),
    pairedStressCapacityDeltaPct: nullableRound(mean(pairedStressDeltas)),
    portfolioBootstrapMeanReturnCi95Pct: childCi.map(nullableRound),
    pairedDeltaBootstrapMeanCi95Pct: pairedCi.map(nullableRound),
    chronologicalHalfValidation: chronological.validation,
    chronologicalHalfValidationGate: chronological.gate,
    profitFactor: nullableRound(factor),
    maxDrawdownPct: nullableRound(drawdown),
    largestWinningFrameShare: nullableRound(largestWinnerShare),
    exactOutcomeMismatches: 0,
    rejectionCounts: cohort.rejectionCounts,
    evidenceStatus,
    evidenceShortfall: {
      observations: Math.max(0, rule.minimumMaturedForecasts - weightedRows.length),
      independentFrames: Math.max(0, rule.minimumIndependentSignalFrames - frames.length),
      uniqueSelectedTokens: Math.max(0, rule.minimumUniqueTokens - uniqueSelectedTokens),
      selectedRiseCalls: Math.max(0, rule.minimumRiseCalls - selectedRows.length),
      independentTradedFrames: Math.max(
        0,
        rule.minimumIndependentTradedFrames - independentTradedFrames,
      ),
      ...coverage.evidenceShortfall,
      ...chronological.evidenceShortfall,
    },
    provisionalGate,
    note: "This future-only paper child keeps the low-cap newborn entry and exact outcome unchanged, and changes only whether complete pre-entry exact-mint RugCheck evidence reports creator balance at or below 10%. Missing or invalid evidence is paper cash. TikTok, MarsCoin, WIZARD, their reports, paths, and outcomes are excluded hypothesis provenance and cannot enter this scorecard.",
  };
}

export function buildGeckoTerminalNewPoolBirthLpProviderScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolBirthLpProviderRows(events);
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE;
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const selectedRows = weightedRows.filter((row) => row.lpProviderSelected);
  const parentBase = frames.map((frame) => mean(
    frame.map((row) => row.baseCapacityReturnPct),
  ));
  const parentStress = frames.map((frame) => mean(
    frame.map((row) => row.stressCapacityReturnPct),
  ));
  const childBase = frames.map((frame) => mean(
    frame.map((row) => row.lpProviderSelected ? row.baseCapacityReturnPct : 0),
  ));
  const childStress = frames.map((frame) => mean(
    frame.map((row) => row.lpProviderSelected ? row.stressCapacityReturnPct : 0),
  ));
  const pairedBaseDeltas = childBase.map((value, index) => value - parentBase[index]);
  const pairedStressDeltas = childStress.map((value, index) => value - parentStress[index]);
  const childCi = childBase.length >= 2
    ? circularBlockBootstrapMeanInterval(childBase, rule.bootstrapIterations)
    : [null, null];
  const pairedCi = pairedBaseDeltas.length >= 2
    ? circularBlockBootstrapMeanInterval(pairedBaseDeltas, rule.bootstrapIterations)
    : [null, null];
  const chronological = chronologicalHalfValidation(childBase, childStress, rule);
  const coverage = forecastOutcomeCoverageValidation(cohort, {
    selectionField: "lpProviderChallengerPredictedRise",
  });
  const uniqueSelectedTokens = new Set(selectedRows.map(tokenEdgeAssetKey)).size;
  const independentTradedFrames = frames.filter((frame) => (
    frame.some((row) => row.lpProviderSelected)
  )).length;
  const averageChildBase = mean(childBase);
  const averageChildStress = mean(childStress);
  const factor = profitFactor(childBase);
  const drawdown = maxDrawdownPct(childBase);
  const largestWinnerShare = largestWinningShare(childBase);
  const evidenceStatus = weightedRows.length >= rule.minimumMaturedForecasts
    && frames.length >= rule.minimumIndependentSignalFrames
    && uniqueSelectedTokens >= rule.minimumUniqueTokens
    && selectedRows.length >= rule.minimumRiseCalls
    && independentTradedFrames >= rule.minimumIndependentTradedFrames
    && coverage.gate
    ? "reviewable" : "collecting";
  const provisionalGate = evidenceStatus === "reviewable"
    && childCi[0] > rule.bootstrapLower95MustExceedPct
    && pairedCi[0] > rule.bootstrapLower95MustExceedPct
    && averageChildStress > 0
    && factor >= rule.minimumProfitFactor
    && drawdown <= rule.maximumDrawdownPct
    && Number.isFinite(largestWinnerShare)
    && largestWinnerShare <= rule.maximumLargestWinningFrameShare
    && coverage.missingAsLossGate
    && chronological.gate;
  return {
    type: "geckoterminal-new-pool-birth-lp-provider-scorecard",
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: cohort.registration?.id ?? null,
    registeredAt: cohort.registration?.registeredAt ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    parentRegistrationId: cohort.parent.registration?.id ?? null,
    changedDimension: rule.changedDimension,
    researchOnly: true,
    mutationAllowed: false,
    futureParentForecasts: cohort.futureParentForecasts.length,
    candidateForecasts: cohort.forecasts.length,
    openForecasts: cohort.openForecasts,
    eligibleLiveObservations: cohort.rows.length,
    ...coverage.summary,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(cohort.rows, frames),
    independentHourlyFrames: frames.length,
    selectedRiseCalls: selectedRows.length,
    independentTradedFrames,
    uniqueSelectedTokens,
    exactEvidenceCoverageCount: weightedRows.filter((row) => (
      row.lpProviderAggregate.coverage === "complete"
    )).length,
    unavailableEvidenceCount: weightedRows.filter((row) => (
      row.lpProviderAggregate.coverage !== "complete"
    )).length,
    selectedRisePrecision: roundRatio(
      selectedRows.filter((row) => row.grossReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedNetWinRate: roundRatio(
      selectedRows.filter((row) => row.baseCapacityReturnPct > 0).length,
      selectedRows.length,
    ),
    selectedExplosion25Count: selectedRows.filter((row) => row.grossReturnPct >= 25).length,
    selectedExplosion50Count: selectedRows.filter((row) => row.grossReturnPct >= 50).length,
    selectedExplosion100Count: selectedRows.filter((row) => row.grossReturnPct >= 100).length,
    selectedLiquidityCollapseCount: selectedRows.filter((row) => (
      row.resolution.status === "liquidity-collapse"
    )).length,
    parentPortfolioAverageCapacityReturnPct: nullableRound(mean(parentBase)),
    portfolioAverageCapacityReturnPct: nullableRound(averageChildBase),
    pairedCapacityDeltaPct: nullableRound(mean(pairedBaseDeltas)),
    parentStressPortfolioAverageCapacityReturnPct: nullableRound(mean(parentStress)),
    stressPortfolioAverageCapacityReturnPct: nullableRound(averageChildStress),
    pairedStressCapacityDeltaPct: nullableRound(mean(pairedStressDeltas)),
    portfolioBootstrapMeanReturnCi95Pct: childCi.map(nullableRound),
    pairedDeltaBootstrapMeanCi95Pct: pairedCi.map(nullableRound),
    chronologicalHalfValidation: chronological.validation,
    chronologicalHalfValidationGate: chronological.gate,
    profitFactor: nullableRound(factor),
    maxDrawdownPct: nullableRound(drawdown),
    largestWinningFrameShare: nullableRound(largestWinnerShare),
    exactOutcomeMismatches: 0,
    rejectionCounts: cohort.rejectionCounts,
    evidenceStatus,
    evidenceShortfall: {
      observations: Math.max(0, rule.minimumMaturedForecasts - weightedRows.length),
      independentFrames: Math.max(0, rule.minimumIndependentSignalFrames - frames.length),
      uniqueSelectedTokens: Math.max(0, rule.minimumUniqueTokens - uniqueSelectedTokens),
      selectedRiseCalls: Math.max(0, rule.minimumRiseCalls - selectedRows.length),
      independentTradedFrames: Math.max(
        0,
        rule.minimumIndependentTradedFrames - independentTradedFrames,
      ),
      ...coverage.evidenceShortfall,
      ...chronological.evidenceShortfall,
    },
    provisionalGate,
    note: "This future-only paper child keeps the low-cap newborn entry and exact outcome unchanged, and changes only whether complete pre-entry exact-mint RugCheck evidence reports at least one LP provider. Missing or invalid evidence is paper cash. TikTok, MarsCoin, WIZARD, PEPHEAD, Hthcity, their reports, paths, and outcomes are excluded hypothesis provenance and cannot enter this scorecard.",
  };
}

export function buildGeckoTerminalNewPoolBirthRugCheckPanelScorecard(events) {
  const cohort = validatedGeckoTerminalNewPoolBirthRugCheckPanelRows(events);
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const featureSlices = [
    "normalizedRiskScore",
    "rugged",
    "dangerRiskCount",
    "warningRiskCount",
    "graphInsidersDetected",
    "insiderNetworkCount",
    "maximumInsiderNetworkSize",
    "totalHolders",
    "creatorBalancePct",
    "mainPairLockedPct",
    "mainPairLockedUsd",
    "reportAgeSeconds",
  ].flatMap((field) => {
    const buckets = new Map();
    for (const row of weightedRows) {
      const bucket = rugCheckPanelBucket(field, row);
      const bucketRows = buckets.get(bucket) ?? [];
      bucketRows.push(row);
      buckets.set(bucket, bucketRows);
    }
    return [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([bucket, rows]) => rugCheckPanelSlice(field, bucket, rows));
  });
  const dangerNames = [...new Set(weightedRows.flatMap((row) => (
    row.rugCheckAggregate.dangerRiskNames
  )))].sort();
  return {
    type: "geckoterminal-new-pool-birth-rugcheck-panel-scorecard",
    ruleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.version,
    evidenceBoundary: GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.evidenceBoundary,
    registrationId: cohort.registration?.id ?? null,
    registeredAt: cohort.registration?.registeredAt ?? null,
    parentRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.parentRuleVersion,
    changedDimension: GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.changedDimension,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    futureParentForecasts: cohort.futureParentForecasts.length,
    candidateForecasts: cohort.forecasts.length,
    openForecasts: cohort.openForecasts,
    eligibleLiveObservations: cohort.rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(cohort.rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    completeEvidenceCount: weightedRows.filter((row) => (
      row.rugCheckAggregate.coverage === "complete"
    )).length,
    unavailableEvidenceCount: weightedRows.filter((row) => (
      row.rugCheckAggregate.coverage !== "complete"
    )).length,
    overall: rugCheckPanelSlice("all", "all", weightedRows),
    featureSlices,
    dangerNameSlices: dangerNames.map((name) => rugCheckPanelSlice(
      "dangerRiskName",
      name,
      weightedRows.filter((row) => row.rugCheckAggregate.dangerRiskNames.includes(name)),
    )),
    rejectionCounts: cohort.rejectionCounts,
    evidenceStatus: "descriptive-only",
    provisionalGate: false,
    note: "This future-only scorecard is descriptive only. It joins immutable decision-time RugCheck aggregates to exact one-hour outcomes and reports predeclared coarse slices without selecting a threshold, changing a forecast, or granting promotion authority. Any later decision rule must freeze one field and one threshold in a separate strictly future registration.",
  };
}

export function validatedGeckoTerminalNewPoolRows(events) {
  return validatedNewPoolRows(events, {
    rule: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
    registrationMatcher: matchesRegistration,
    marketCapFloorRemoved: false,
  });
}

export function validatedGeckoTerminalNewPoolMarketCapFloorRemovedRows(events) {
  return validatedNewPoolRows(events, {
    rule: GECKOTERMINAL_NEW_POOL_MARKET_CAP_FLOOR_REMOVED_RULE,
    registrationMatcher: matchesMarketCapFloorRemovedRegistration,
    marketCapFloorRemoved: true,
  });
}

export function validatedGeckoTerminalNewPoolBirthEntryRows(events) {
  return validatedBirthEntryRows(events, {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
    registrationMatcher: matchesBirthEntryRegistration,
    candidateValidator: validBirthEntryCandidate,
  });
}

export function validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows(events) {
  return validatedBirthEntryRows(events, {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE,
    registrationMatcher: matchesBirthMarketCapFloorRemovedRegistration,
    candidateValidator: validBirthMarketCapFloorRemovedCandidate,
  });
}

export function validatedGeckoTerminalNewPoolBirthUpperMomentumRows(events) {
  return validatedBirthEntryRows(events, {
    rule: GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE,
    registrationMatcher: matchesBirthUpperMomentumRegistration,
    candidateValidator: validBirthUpperMomentumCandidate,
  });
}

export function validatedGeckoTerminalNewPoolBirthDangerCountRows(events) {
  const registration = events.find(matchesBirthDangerCountRegistration) ?? null;
  const riskPanelRegistration = events.find(matchesBirthRugCheckPanelRegistration) ?? null;
  const parent = validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows(events);
  const discoveries = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-discovery")
    .map((event) => [event.id, event]));
  const evidenceById = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-rugcheck-risk-snapshot")
    .map((event) => [event.id, event]));
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_DANGER_COUNT_RULE;
  const futureParentForecasts = parent.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
      && Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary)
      && !rule.derivation.excludedTokenAddresses.includes(forecast.tokenAddress)
  ));
  const forecasts = futureParentForecasts.filter((forecast) => (
    forecast.dangerCountChallengerRegistrationId === registration?.id
      && forecast.dangerCountChallengerRuleVersion === rule.version
  ));
  const forecastIds = new Set(forecasts.map((forecast) => forecast.id));
  const rejectionCounts = {};
  for (const forecast of futureParentForecasts) {
    if (!forecastIds.has(forecast.id)) increment(rejectionCounts, "not-captured-under-policy");
  }
  const rows = [];
  for (const row of parent.rows) {
    const forecast = row.forecast;
    if (!forecastIds.has(forecast.id)) continue;
    const discovery = discoveries.get(forecast.discoveryEventId);
    const evidence = evidenceById.get(forecast.dangerCountEvidenceId);
    const newborn = (discovery?.candidates ?? []).find((candidate) => (
      candidate.tokenAddress === forecast.tokenAddress
        && candidate.pairAddress === forecast.pairAddress
    ));
    const reason = newbornDangerCountRowRejectionReason({
      registration,
      riskPanelRegistration,
      discovery,
      evidence,
      forecast,
      newborn,
    });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      ...row,
      dangerCountAggregate: evidence.aggregate,
      dangerCountEvidence: evidence,
      dangerCountSelected: forecast.dangerCountChallengerPredictedRise,
    });
  }
  return {
    registration,
    riskPanelRegistration,
    parent,
    futureParentForecasts,
    forecasts,
    ...forecastMaturityAtLedgerAsOf(events, forecasts),
    rejectionCounts,
    rows,
  };
}

export function validatedGeckoTerminalNewPoolBirthJupiterRoundTripRows(events) {
  const registration = events.find(matchesBirthJupiterRoundTripRegistration) ?? null;
  const parent = validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows(events);
  const discoveries = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-discovery")
    .map((event) => [event.id, event]));
  const evidenceByKey = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-jupiter-roundtrip-snapshot")
    .map((event) => [`${event.discoveryEventId}:${event.tokenAddress}`, event]));
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE;
  const futureParentForecasts = parent.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
      && Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary)
      && !rule.derivation.excludedTokenAddresses.includes(forecast.tokenAddress)
  ));
  const forecasts = futureParentForecasts.filter((forecast) => evidenceByKey.has(
    `${forecast.discoveryEventId}:${forecast.tokenAddress}`,
  ));
  const forecastIds = new Set(forecasts.map((forecast) => forecast.id));
  const rejectionCounts = {};
  for (const forecast of futureParentForecasts) {
    if (!forecastIds.has(forecast.id)) increment(rejectionCounts, "missing-panel-evidence");
  }
  const rows = [];
  for (const row of parent.rows) {
    const forecast = row.forecast;
    if (!forecastIds.has(forecast.id)) continue;
    const discovery = discoveries.get(forecast.discoveryEventId);
    const evidence = evidenceByKey.get(`${forecast.discoveryEventId}:${forecast.tokenAddress}`);
    const newborn = (discovery?.candidates ?? []).find((candidate) => (
      candidate.tokenAddress === forecast.tokenAddress
        && candidate.pairAddress === forecast.pairAddress
    ));
    const reason = newbornJupiterRoundTripRowRejectionReason({
      registration,
      discovery,
      evidence,
      forecast,
      newborn,
    });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      ...row,
      jupiterRoundTripAggregate: evidence.aggregate,
      jupiterRoundTripEvidence: evidence,
    });
  }
  return {
    registration,
    parent,
    futureParentForecasts,
    forecasts,
    ...forecastMaturityAtLedgerAsOf(events, forecasts),
    rejectionCounts,
    rows,
  };
}

export function validatedGeckoTerminalNewPoolBirthJupiterExecutableRows(events) {
  const registration = events.find(matchesBirthJupiterExecutableRegistration) ?? null;
  const sourceRegistration = events.find(matchesRegistration) ?? null;
  const discoveries = new Map(events.filter((event) => (
    event.type === "geckoterminal-new-pool-discovery"
  )).map((event) => [event.id, event]));
  const candidateDecisions = events.filter((event) => (
    event.type === "geckoterminal-new-pool-jupiter-executable-decision"
      && event.registrationId === registration?.id
  ));
  const resolutionGroups = new Map();
  for (const resolution of events.filter((event) => (
    event.type === "geckoterminal-new-pool-jupiter-executable-resolution"
      && event.registrationId === registration?.id
  ))) {
    if (!resolutionGroups.has(resolution.decisionId)) {
      resolutionGroups.set(resolution.decisionId, []);
    }
    resolutionGroups.get(resolution.decisionId).push(resolution);
  }
  const rejectionCounts = {};
  const decisions = [];
  const rows = [];
  const validResolutionDecisionIds = new Set();
  let missedResolutions = 0;
  let unavailableResolutions = 0;
  for (const decision of candidateDecisions) {
    const discovery = discoveries.get(decision.discoveryEventId) ?? null;
    if (!validJupiterExecutableDecisionEnvelope({
      decision,
      registration,
      sourceRegistration,
      discovery,
    })) {
      increment(rejectionCounts, "decision-integrity-mismatch");
      continue;
    }
    decisions.push(decision);
    const resolutions = resolutionGroups.get(decision.id) ?? [];
    if (!resolutions.length) {
      continue;
    }
    if (resolutions.length !== 1
      || !validJupiterExecutableResolutionEnvelope({
        decision,
        resolution: resolutions[0],
      })) {
      increment(rejectionCounts, "resolution-integrity-mismatch");
      continue;
    }
    const resolution = resolutions[0];
    validResolutionDecisionIds.add(decision.id);
    if (resolution.status === "missed") {
      missedResolutions += 1;
      continue;
    }
    if (resolution.status === "unavailable") {
      unavailableResolutions += 1;
      continue;
    }
    rows.push({
      decision,
      resolution,
      decisionId: decision.id,
      createdAt: decision.createdAt,
      chain: decision.chain,
      tokenAddress: decision.tokenAddress,
      grossReturnPct: resolution.grossReturnPct,
      baseReturnPct: resolution.baseReturnPct,
      stressReturnPct: resolution.stressReturnPct,
      ...decision.metrics,
    });
  }
  const scorecardAsOf = latestLedgerOccurrenceAt(events);
  const scorecardAsOfMs = scorecardAsOf?.getTime() ?? null;
  const maturedDecisions = Number.isFinite(scorecardAsOfMs)
    ? decisions.filter((decision) => {
      const dueAt = Date.parse(decision.dueAt);
      return Number.isFinite(dueAt) && dueAt <= scorecardAsOfMs;
    })
    : [];
  const maturedDecisionIds = new Set(maturedDecisions.map((decision) => decision.id));
  const recordedMaturedResolutions = [...validResolutionDecisionIds].filter((decisionId) => (
    maturedDecisionIds.has(decisionId)
  )).length;
  return {
    registration,
    decisions,
    scorecardAsOf: scorecardAsOf?.toISOString() ?? null,
    maturedDecisions,
    maturedDecisionCount: maturedDecisions.length,
    recordedMaturedResolutions,
    unrecordedMaturedDecisions: maturedDecisions.filter((decision) => (
      !validResolutionDecisionIds.has(decision.id)
    )).length,
    openDecisions: decisions.length - maturedDecisions.length,
    missedResolutions,
    unavailableResolutions,
    rejectionCounts,
    rows,
  };
}

export function validatedGeckoTerminalNewPoolBirthPairAgeRows(events) {
  const registration = events.find(matchesBirthPairAgeRegistration) ?? null;
  const parent = validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows(events);
  const futureParentForecasts = parent.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
      && Date.parse(forecast.createdAt)
        > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE.evidenceBoundary)
      && !GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE.derivation
        .excludedTokenAddresses.includes(forecast.tokenAddress)
  ));
  const forecasts = futureParentForecasts.filter((forecast) => (
    forecast.pairAgeChallengerRegistrationId === registration?.id
      && forecast.pairAgeChallengerRuleVersion
        === GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE.version
  ));
  const forecastIds = new Set(forecasts.map((forecast) => forecast.id));
  const rejectionCounts = {};
  for (const forecast of futureParentForecasts) {
    if (!forecastIds.has(forecast.id)) increment(rejectionCounts, "not-captured-under-policy");
  }
  const rows = [];
  for (const row of parent.rows) {
    const forecast = row.forecast;
    if (!forecastIds.has(forecast.id)) continue;
    const reason = newbornPairAgeRowRejectionReason({ registration, forecast });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      ...row,
      pairAgeSelected: forecast.pairAgeChallengerPredictedRise,
    });
  }
  return {
    registration,
    parent,
    futureParentForecasts,
    forecasts,
    ...forecastMaturityAtLedgerAsOf(events, forecasts),
    rejectionCounts,
    rows,
  };
}

export function validatedGeckoTerminalNewPoolBirthTurnoverRows(events) {
  const registration = events.find(matchesBirthTurnoverRegistration) ?? null;
  const parent = validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows(events);
  const futureParentForecasts = parent.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
      && Date.parse(forecast.createdAt)
        > Date.parse(GECKOTERMINAL_NEW_POOL_BIRTH_TURNOVER_RULE.evidenceBoundary)
      && !GECKOTERMINAL_NEW_POOL_BIRTH_TURNOVER_RULE.derivation
        .excludedTokenAddresses.includes(forecast.tokenAddress)
  ));
  const forecasts = futureParentForecasts.filter((forecast) => (
    forecast.turnoverChallengerRegistrationId === registration?.id
      && forecast.turnoverChallengerRuleVersion
        === GECKOTERMINAL_NEW_POOL_BIRTH_TURNOVER_RULE.version
  ));
  const forecastIds = new Set(forecasts.map((forecast) => forecast.id));
  const rejectionCounts = {};
  for (const forecast of futureParentForecasts) {
    if (!forecastIds.has(forecast.id)) increment(rejectionCounts, "not-captured-under-policy");
  }
  const rows = [];
  for (const row of parent.rows) {
    const forecast = row.forecast;
    if (!forecastIds.has(forecast.id)) continue;
    const reason = newbornTurnoverRowRejectionReason({ registration, forecast });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      ...row,
      turnoverSelected: forecast.turnoverChallengerPredictedRise,
    });
  }
  return {
    registration,
    parent,
    futureParentForecasts,
    forecasts,
    ...forecastMaturityAtLedgerAsOf(events, forecasts),
    rejectionCounts,
    rows,
  };
}

export function validatedGeckoTerminalNewPoolBirthLowMomentumRows(events) {
  const registration = events.find(matchesBirthLowMomentumRegistration) ?? null;
  const parent = validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows(events);
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_LOW_MOMENTUM_RULE;
  const futureParentForecasts = parent.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
      && Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary)
      && !rule.derivation.excludedTokenAddresses.includes(forecast.tokenAddress)
  ));
  const forecasts = futureParentForecasts.filter((forecast) => (
    forecast.lowMomentumChallengerRegistrationId === registration?.id
      && forecast.lowMomentumChallengerRuleVersion === rule.version
  ));
  const forecastIds = new Set(forecasts.map((forecast) => forecast.id));
  const rejectionCounts = {};
  for (const forecast of futureParentForecasts) {
    if (!forecastIds.has(forecast.id)) increment(rejectionCounts, "not-captured-under-policy");
  }
  const rows = [];
  for (const row of parent.rows) {
    const forecast = row.forecast;
    if (!forecastIds.has(forecast.id)) continue;
    const reason = newbornLowMomentumRowRejectionReason({ registration, forecast });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      ...row,
      lowMomentumSelected: forecast.lowMomentumChallengerPredictedRise,
    });
  }
  return {
    registration,
    parent,
    futureParentForecasts,
    forecasts,
    ...forecastMaturityAtLedgerAsOf(events, forecasts),
    rejectionCounts,
    rows,
  };
}

export function validatedGeckoTerminalNewPoolBirthSocialPresenceRows(events) {
  const registration = events.find(matchesBirthSocialPresenceRegistration) ?? null;
  const parent = validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows(events);
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE;
  const futureParentForecasts = parent.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
      && Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary)
      && !rule.derivation.excludedTokenAddresses.includes(forecast.tokenAddress)
  ));
  const forecasts = futureParentForecasts.filter((forecast) => (
    forecast.socialPresenceObservationRegistrationId === registration?.id
      && forecast.socialPresenceObservationRuleVersion === rule.version
  ));
  const forecastIds = new Set(forecasts.map((forecast) => forecast.id));
  const rejectionCounts = {};
  for (const forecast of futureParentForecasts) {
    if (!forecastIds.has(forecast.id)) increment(rejectionCounts, "not-captured-under-policy");
  }
  const rows = [];
  for (const row of parent.rows) {
    const forecast = row.forecast;
    if (!forecastIds.has(forecast.id)) continue;
    const reason = newbornSocialPresenceRowRejectionReason({ registration, forecast });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      ...row,
      socialPresenceAggregate: forecast.socialPresenceAggregate,
    });
  }
  return {
    registration,
    parent,
    futureParentForecasts,
    forecasts,
    ...forecastMaturityAtLedgerAsOf(events, forecasts),
    rejectionCounts,
    rows,
  };
}

export function validatedGeckoTerminalNewPoolBirthCreatorBalanceRows(events) {
  const registration = events.find(matchesBirthCreatorBalanceRegistration) ?? null;
  const parent = validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows(events);
  const discoveries = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-discovery")
    .map((event) => [event.id, event]));
  const evidenceById = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-creator-balance-snapshot")
    .map((event) => [event.id, event]));
  const futureParentForecasts = parent.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  const forecasts = futureParentForecasts.filter((forecast) => (
    forecast.creatorBalanceChallengerRegistrationId === registration?.id
      && forecast.creatorBalanceChallengerRuleVersion
        === GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE.version
  ));
  const forecastIds = new Set(forecasts.map((forecast) => forecast.id));
  const rejectionCounts = {};
  for (const forecast of futureParentForecasts) {
    if (!forecastIds.has(forecast.id)) increment(rejectionCounts, "not-captured-under-policy");
  }
  const rows = [];
  for (const row of parent.rows) {
    const forecast = row.forecast;
    if (!forecastIds.has(forecast.id)) continue;
    const discovery = discoveries.get(forecast.discoveryEventId);
    const evidence = evidenceById.get(forecast.creatorBalanceEvidenceId);
    const reason = newbornCreatorBalanceRowRejectionReason({
      registration,
      discovery,
      evidence,
      forecast,
    });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      ...row,
      creatorBalanceAggregate: evidence.aggregate,
      creatorBalanceEvidence: evidence,
      creatorBalanceSelected: forecast.creatorBalanceChallengerPredictedRise,
    });
  }
  return {
    registration,
    parent,
    futureParentForecasts,
    forecasts,
    ...forecastMaturityAtLedgerAsOf(events, forecasts),
    rejectionCounts,
    rows,
  };
}

export function validatedGeckoTerminalNewPoolBirthLpProviderRows(events) {
  const registration = events.find(matchesBirthLpProviderRegistration) ?? null;
  const parent = validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows(events);
  const discoveries = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-discovery")
    .map((event) => [event.id, event]));
  const evidenceById = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-lp-provider-snapshot")
    .map((event) => [event.id, event]));
  const futureParentForecasts = parent.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  const forecasts = futureParentForecasts.filter((forecast) => (
    forecast.lpProviderChallengerRegistrationId === registration?.id
      && forecast.lpProviderChallengerRuleVersion
        === GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE.version
  ));
  const forecastIds = new Set(forecasts.map((forecast) => forecast.id));
  const rejectionCounts = {};
  for (const forecast of futureParentForecasts) {
    if (!forecastIds.has(forecast.id)) increment(rejectionCounts, "not-captured-under-policy");
  }
  const rows = [];
  for (const row of parent.rows) {
    const forecast = row.forecast;
    if (!forecastIds.has(forecast.id)) continue;
    const discovery = discoveries.get(forecast.discoveryEventId);
    const evidence = evidenceById.get(forecast.lpProviderEvidenceId);
    const reason = newbornLpProviderRowRejectionReason({
      registration,
      discovery,
      evidence,
      forecast,
    });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      ...row,
      lpProviderAggregate: evidence.aggregate,
      lpProviderEvidence: evidence,
      lpProviderSelected: forecast.lpProviderChallengerPredictedRise,
    });
  }
  return {
    registration,
    parent,
    futureParentForecasts,
    forecasts,
    ...forecastMaturityAtLedgerAsOf(events, forecasts),
    rejectionCounts,
    rows,
  };
}

export function validatedGeckoTerminalNewPoolBirthRugCheckPanelRows(events) {
  const registration = events.find(matchesBirthRugCheckPanelRegistration) ?? null;
  const parent = validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows(events);
  const discoveries = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-discovery")
    .map((event) => [event.id, event]));
  const evidenceByKey = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-rugcheck-risk-snapshot")
    .map((event) => [`${event.discoveryEventId}:${event.tokenAddress}`, event]));
  const futureParentForecasts = parent.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
      && !GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.derivation
        .excludedTokenAddresses.includes(forecast.tokenAddress)
  ));
  const forecasts = futureParentForecasts.filter((forecast) => evidenceByKey.has(
    `${forecast.discoveryEventId}:${forecast.tokenAddress}`,
  ));
  const forecastIds = new Set(forecasts.map((forecast) => forecast.id));
  const rejectionCounts = {};
  for (const forecast of futureParentForecasts) {
    if (!forecastIds.has(forecast.id)) increment(rejectionCounts, "missing-panel-evidence");
  }
  const rows = [];
  for (const row of parent.rows) {
    const forecast = row.forecast;
    if (!forecastIds.has(forecast.id)) continue;
    const discovery = discoveries.get(forecast.discoveryEventId);
    const evidence = evidenceByKey.get(`${forecast.discoveryEventId}:${forecast.tokenAddress}`);
    const newborn = (discovery?.candidates ?? []).find((candidate) => (
      candidate.tokenAddress === forecast.tokenAddress
        && candidate.pairAddress === forecast.pairAddress
    ));
    const reason = newbornRugCheckPanelRowRejectionReason({
      registration,
      discovery,
      evidence,
      forecast,
      newborn,
    });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      ...row,
      rugCheckAggregate: evidence.aggregate,
      rugCheckEvidence: evidence,
    });
  }
  return {
    registration,
    parent,
    futureParentForecasts,
    forecasts,
    ...forecastMaturityAtLedgerAsOf(events, forecasts),
    rejectionCounts,
    rows,
  };
}

function forecastMaturityAtLedgerAsOf(events, forecasts) {
  const scorecardAsOf = latestLedgerOccurrenceAt(events);
  const scorecardAsOfMs = scorecardAsOf?.getTime() ?? null;
  const maturedForecasts = Number.isFinite(scorecardAsOfMs)
    ? forecasts.filter((forecast) => {
      const dueAt = Date.parse(forecast.dueAt);
      return Number.isFinite(dueAt) && dueAt <= scorecardAsOfMs;
    })
    : [];
  const maturedForecastIds = new Set(maturedForecasts.map((forecast) => forecast.id));
  const recordedMaturedResolutionIds = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-resolution"
      && maturedForecastIds.has(event.forecastId)
  )).map((event) => event.forecastId));
  return {
    scorecardAsOf: scorecardAsOf?.toISOString() ?? null,
    maturedForecasts,
    openForecasts: forecasts.length - maturedForecasts.length,
    maturedForecastCount: maturedForecasts.length,
    recordedMaturedResolutions: recordedMaturedResolutionIds.size,
    unrecordedMaturedForecasts: maturedForecasts.filter((forecast) => (
      !recordedMaturedResolutionIds.has(forecast.id)
    )).length,
  };
}

function validatedBirthEntryRows(events, {
  rule,
  registrationMatcher,
  candidateValidator,
}) {
  const registration = events.find(registrationMatcher) ?? null;
  const sourceRegistration = events.find(matchesRegistration) ?? null;
  const liquidityScoringRegistration = findGeckoLiquidityCollapseScoringRegistration(events);
  const discoveries = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-discovery")
    .map((event) => [event.id, event]));
  const resolutions = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-resolution")
    .map((event) => [event.forecastId, event]));
  const forecasts = events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && event.registrationId === registration?.id
  ));
  const rejectionCounts = {};
  const rows = [];
  for (const forecast of forecasts) {
    const liquidityEligibilityReason = geckoLiquidityScoringEligibilityReason(
      forecast,
      liquidityScoringRegistration,
    );
    if (liquidityEligibilityReason) {
      increment(rejectionCounts, liquidityEligibilityReason);
      continue;
    }
    const discovery = discoveries.get(forecast.discoveryEventId);
    const resolution = resolutions.get(forecast.id);
    if (!resolution) continue;
    const reason = newPoolBirthEntryRowRejectionReason({
      rule,
      registrationMatcher,
      candidateValidator,
      registration,
      sourceRegistration,
      discovery,
      forecast,
      resolution,
    });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      forecast,
      resolution,
      forecastId: forecast.id,
      createdAt: forecast.createdAt,
      chain: forecast.chain,
      tokenAddress: forecast.tokenAddress,
      grossReturnPct: resolution.grossReturnPct,
      baseCapacityReturnPct: resolution.status === "liquidity-collapse"
        ? GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE.collapsedOutcomeGrossReturnPct
        : capacityAdjustedReturnPct({
          grossReturnPct: resolution.grossReturnPct,
          entryLiquidityUsd: forecast.entryLiquidityUsd,
          exitLiquidityUsd: resolution.exitLiquidityUsd,
          paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
          roundTripCostPct: rule.baseRoundTripCostPct,
        }),
      stressCapacityReturnPct: resolution.status === "liquidity-collapse"
        ? GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE.collapsedOutcomeGrossReturnPct
        : capacityAdjustedReturnPct({
          grossReturnPct: resolution.grossReturnPct,
          entryLiquidityUsd: forecast.entryLiquidityUsd,
          exitLiquidityUsd: resolution.exitLiquidityUsd,
          paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
          roundTripCostPct: rule.stressRoundTripCostPct,
        }),
      ...forecast.metrics,
    });
  }
  return {
    registration,
    liquidityScoringRegistration,
    forecasts,
    ...forecastMaturityAtLedgerAsOf(events, forecasts),
    rejectionCounts,
    rows,
  };
}

function newPoolBirthEntryRowRejectionReason({
  rule,
  registrationMatcher,
  candidateValidator,
  registration,
  sourceRegistration,
  discovery,
  forecast,
  resolution,
}) {
  if (!registration || !registrationMatcher(registration)) {
    return "missing-or-invalid-registration";
  }
  if (!sourceRegistration || !matchesRegistration(sourceRegistration)) {
    return "missing-or-invalid-source-registration";
  }
  if (!(Date.parse(discovery?.observedAt) > Date.parse(registration.registeredAt)
    && Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))) {
    return "not-strictly-future";
  }
  if (!discovery
    || discovery.registrationId !== sourceRegistration.id
    || discovery.ruleVersion !== GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version
    || discovery.provider !== rule.sourceProvider
    || discovery.researchOnly !== true
    || discovery.mutationAllowed !== false) return "source-discovery-mismatch";
  const newborn = (discovery.candidates ?? []).find((candidate) => (
    candidate.tokenAddress === forecast.tokenAddress
      && candidate.pairAddress === forecast.pairAddress
  ));
  const candidate = newborn?.birthQuote;
  if (!candidateValidator(candidate, newborn, registration)
    || canonical(forecast.metrics) !== canonical(activationMetrics(candidate))) {
    return "newborn-birth-quote-mismatch";
  }
  if (forecast.ruleVersion !== rule.version
    || forecast.registrationId !== registration.id
    || forecast.registeredAt !== registration.registeredAt
    || forecast.activationEventId !== null
    || forecast.entryMode !== "newborn-birth-quote"
    || forecast.predictedRise !== true
    || forecast.decision !== rule.decision
    || forecast.discoveryEventId !== discovery.id
    || forecast.sourceDiscoveryObservedAt !== discovery.observedAt
    || forecast.activationObservedAt !== null
    || forecast.entryObservedAt !== forecast.createdAt
    || Date.parse(forecast.createdAt) - Date.parse(discovery.observedAt) > FIVE_MINUTES_MS
    || forecast.dueAt !== new Date(Date.parse(forecast.createdAt) + HOUR_MS).toISOString()
    || forecast.researchOnly !== true
    || forecast.mutationAllowed !== false
    || !validGeckoDexDirectIntegrity(
      forecast.entryProviderPriceIntegrity,
      forecast.entryPriceUsd,
      forecast.entryLiquidityUsd,
      rule,
    )) return "forecast-or-entry-mismatch";
  if (!["observed", "liquidity-collapse"].includes(resolution.status)
    || resolution.ruleVersion !== forecast.ruleVersion
    || resolution.registrationId !== forecast.registrationId
    || resolution.discoveryEventId !== forecast.discoveryEventId
    || resolution.activationEventId !== null
    || resolution.forecastId !== forecast.id
    || resolution.chain !== forecast.chain
    || resolution.tokenAddress !== forecast.tokenAddress
    || resolution.pairAddress !== forecast.pairAddress
    || resolution.dueAt !== forecast.dueAt
    || resolution.entryPriceUsd !== forecast.entryPriceUsd
    || resolution.entryLiquidityUsd !== forecast.entryLiquidityUsd
    || resolution.observationLagMs < 0
    || resolution.observationLagMs > MAX_OUTCOME_LAG_MS
    || resolution.researchOnly !== true
    || resolution.mutationAllowed !== false) return "resolution-mismatch";
  if (resolution.status === "liquidity-collapse") {
    return resolution.reason === "both-providers-below-paper-notional-liquidity"
      && resolution.grossReturnPct
        === GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE.collapsedOutcomeGrossReturnPct
      && validGeckoLiquidityCollapseIntegrity(
        resolution.providerPriceIntegrity,
        resolution.exitPriceUsd,
        resolution.exitLiquidityUsd,
      ) ? null : "liquidity-collapse-integrity-mismatch";
  }
  if (!(resolution.exitPriceUsd > 0)
    || !(resolution.exitLiquidityUsd > 0)
    || resolution.grossReturnPct
      !== round6(((resolution.exitPriceUsd / forecast.entryPriceUsd) - 1) * 100)) {
    return "resolution-return-mismatch";
  }
  return validGeckoDexDirectIntegrity(
    resolution.providerPriceIntegrity,
    resolution.exitPriceUsd,
    resolution.exitLiquidityUsd,
    rule,
  ) ? null : "exit-provider-price-integrity-mismatch";
}

function newbornSocialPresenceRowRejectionReason({ registration, forecast }) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE;
  if (!registration || !matchesBirthSocialPresenceRegistration(registration)) {
    return "missing-or-invalid-registration";
  }
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary))) {
    return "not-strictly-future";
  }
  if (rule.derivation.excludedTokenAddresses.includes(forecast.tokenAddress)) {
    return "derivation-token-excluded";
  }
  const aggregate = canonicalNewbornSocialPresenceAggregate(
    forecast.socialPresenceAggregate,
  );
  if (!aggregate
    || forecast.socialPresenceObservationRuleVersion !== rule.version
    || forecast.socialPresenceObservationRegistrationId !== registration.id
    || forecast.socialPresenceObservationRegisteredAt !== registration.registeredAt
    || canonical(aggregate) !== canonical(forecast.socialPresenceAggregate)
    || forecast.socialPresenceAggregateDigest !== digestValue(aggregate)
    || forecast.socialPresenceRawLinksRetained !== false) {
    return "forecast-social-presence-lineage-mismatch";
  }
  return null;
}

function canonicalNewbornSocialPresenceAggregate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const countFields = [
    "websiteCount", "socialCount", "retainedPlatformCount", "unrecognizedPlatformCount",
  ];
  const booleanFields = [
    "infoPresent", "hasWebsite", "hasAnySocial", "hasTwitter", "hasTelegram",
    "hasDiscord", "hasYoutube", "hasTiktok", "hasInstagram", "hasReddit",
  ];
  if (!countFields.every((field) => (
    Number.isInteger(value[field]) && value[field] >= 0 && value[field] <= 20
  )) || !booleanFields.every((field) => typeof value[field] === "boolean")) return null;
  if (value.retainedPlatformCount
      > GECKOTERMINAL_NEW_POOL_BIRTH_SOCIAL_PRESENCE_RULE.retainedPlatforms.length
    || value.hasWebsite !== (value.websiteCount > 0)
    || value.hasAnySocial !== (value.socialCount > 0)) return null;
  return Object.fromEntries([...countFields, ...booleanFields].map((field) => [field, value[field]]));
}

function newbornDangerCountRowRejectionReason({
  registration,
  riskPanelRegistration,
  discovery,
  evidence,
  forecast,
  newborn,
}) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_DANGER_COUNT_RULE;
  if (!registration || !matchesBirthDangerCountRegistration(registration)) {
    return "missing-or-invalid-registration";
  }
  if (!riskPanelRegistration
    || !matchesBirthRugCheckPanelRegistration(riskPanelRegistration)) {
    return "missing-or-invalid-rugcheck-panel-registration";
  }
  if (!discovery
    || !newborn
    || !(Date.parse(newborn.poolCreatedAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(discovery.observedAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary))) {
    return "not-strictly-future";
  }
  if (rule.derivation.excludedTokenAddresses.includes(forecast.tokenAddress)) {
    return "derivation-token-excluded";
  }
  if (!validNewbornRugCheckRiskEvidenceEnvelope({
    evidence,
    registration: riskPanelRegistration,
    discovery,
    tokenAddress: forecast.tokenAddress,
    pairAddress: forecast.pairAddress,
    poolCreatedAt: newborn.poolCreatedAt,
  })) return "missing-or-invalid-panel-evidence";
  const availableAt = Date.parse(evidence.availableAt);
  const createdAt = Date.parse(forecast.createdAt);
  if (!(availableAt <= createdAt
    && createdAt - availableAt <= FIVE_MINUTES_MS)) return "invalid-evidence-to-forecast-timing";
  const dangerRiskCount = evidence.aggregate.dangerRiskCount;
  const expectedSelected = evidence.aggregate.coverage === "complete"
    && Number.isInteger(dangerRiskCount)
    && dangerRiskCount >= rule.minimumDangerRiskCountInclusive
    && dangerRiskCount <= rule.maximumDangerRiskCountInclusive;
  if (forecast.dangerCountChallengerRuleVersion !== rule.version
    || forecast.dangerCountChallengerRegistrationId !== registration.id
    || forecast.dangerCountChallengerRegisteredAt !== registration.registeredAt
    || forecast.dangerCountEvidenceId !== evidence.id
    || forecast.dangerCountEvidenceAvailableAt !== evidence.availableAt
    || forecast.dangerRiskCount !== (Number.isInteger(dangerRiskCount) ? dangerRiskCount : null)
    || forecast.dangerCountChallengerPredictedRise !== expectedSelected
    || forecast.dangerCountChallengerDecision
      !== (expectedSelected ? "paper-long" : "paper-cash")) {
    return "forecast-danger-count-decision-mismatch";
  }
  return null;
}

function newbornTurnoverRowRejectionReason({ registration, forecast }) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_TURNOVER_RULE;
  if (!registration || !matchesBirthTurnoverRegistration(registration)) {
    return "missing-or-invalid-registration";
  }
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary))) {
    return "not-strictly-future";
  }
  if (rule.derivation.excludedTokenAddresses.includes(forecast.tokenAddress)) {
    return "derivation-token-excluded";
  }
  const fiveMinuteTurnover = forecast.metrics?.fiveMinuteTurnover;
  const expectedSelected = Number.isFinite(fiveMinuteTurnover)
    && fiveMinuteTurnover <= rule.maximumFiveMinuteTurnoverInclusive;
  if (forecast.turnoverChallengerRuleVersion !== rule.version
    || forecast.turnoverChallengerRegistrationId !== registration.id
    || forecast.turnoverChallengerRegisteredAt !== registration.registeredAt
    || forecast.fiveMinuteTurnover !== fiveMinuteTurnover
    || forecast.turnoverChallengerPredictedRise !== expectedSelected
    || forecast.turnoverChallengerDecision
      !== (expectedSelected ? "paper-long" : "paper-cash")) {
    return "forecast-turnover-decision-mismatch";
  }
  return null;
}

function newbornLowMomentumRowRejectionReason({ registration, forecast }) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_LOW_MOMENTUM_RULE;
  if (!registration || !matchesBirthLowMomentumRegistration(registration)) {
    return "missing-or-invalid-registration";
  }
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary))) {
    return "not-strictly-future";
  }
  if (rule.derivation.excludedTokenAddresses.includes(forecast.tokenAddress)) {
    return "derivation-token-excluded";
  }
  const priceChangeM5Pct = forecast.metrics?.priceChangeM5Pct;
  const expectedSelected = Number.isFinite(priceChangeM5Pct)
    && priceChangeM5Pct <= rule.maximumFiveMinutePriceChangePctInclusive;
  if (forecast.lowMomentumChallengerRuleVersion !== rule.version
    || forecast.lowMomentumChallengerRegistrationId !== registration.id
    || forecast.lowMomentumChallengerRegisteredAt !== registration.registeredAt
    || forecast.lowMomentumPriceChangeM5Pct !== priceChangeM5Pct
    || forecast.lowMomentumChallengerPredictedRise !== expectedSelected
    || forecast.lowMomentumChallengerDecision
      !== (expectedSelected ? "paper-long" : "paper-cash")) {
    return "forecast-low-momentum-decision-mismatch";
  }
  return null;
}

function newbornPairAgeRowRejectionReason({ registration, forecast }) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_PAIR_AGE_RULE;
  if (!registration || !matchesBirthPairAgeRegistration(registration)) {
    return "missing-or-invalid-registration";
  }
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary))) {
    return "not-strictly-future";
  }
  if (rule.derivation.excludedTokenAddresses.includes(forecast.tokenAddress)) {
    return "derivation-token-excluded";
  }
  const pairAgeMinutes = forecast.metrics?.pairAgeMinutes;
  const expectedSelected = Number.isFinite(pairAgeMinutes)
    && pairAgeMinutes >= rule.minimumPairAgeMinutesInclusive;
  if (forecast.pairAgeChallengerRuleVersion !== rule.version
    || forecast.pairAgeChallengerRegistrationId !== registration.id
    || forecast.pairAgeChallengerRegisteredAt !== registration.registeredAt
    || forecast.pairAgeMinutes !== pairAgeMinutes
    || forecast.pairAgeChallengerPredictedRise !== expectedSelected
    || forecast.pairAgeChallengerDecision
      !== (expectedSelected ? "paper-long" : "paper-cash")) {
    return "forecast-pair-age-decision-mismatch";
  }
  return null;
}

function newbornCreatorBalanceRowRejectionReason({
  registration,
  discovery,
  evidence,
  forecast,
}) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE;
  if (!registration || !matchesBirthCreatorBalanceRegistration(registration)) {
    return "missing-or-invalid-registration";
  }
  if (!discovery
    || !(Date.parse(discovery.observedAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary))) {
    return "not-strictly-future";
  }
  if (rule.derivation.excludedTokenAddresses.includes(forecast.tokenAddress)) {
    return "derivation-token-excluded";
  }
  if (!validNewbornCreatorBalanceEvidenceEnvelope({
    evidence,
    registration,
    discovery,
    tokenAddress: forecast.tokenAddress,
  })) return "missing-or-invalid-exact-mint-evidence";
  const availableAt = Date.parse(evidence.availableAt);
  const createdAt = Date.parse(forecast.createdAt);
  if (!(availableAt <= createdAt
    && createdAt - availableAt <= FIVE_MINUTES_MS)) return "invalid-evidence-to-forecast-timing";
  const creatorBalancePct = evidence.aggregate.creatorBalancePct;
  const expectedSelected = evidence.aggregate.coverage === "complete"
    && Number.isFinite(creatorBalancePct)
    && creatorBalancePct <= rule.maximumCreatorBalancePctInclusive;
  if (forecast.creatorBalanceChallengerRuleVersion !== rule.version
    || forecast.creatorBalanceChallengerRegistrationId !== registration.id
    || forecast.creatorBalanceChallengerRegisteredAt !== registration.registeredAt
    || forecast.creatorBalanceEvidenceId !== evidence.id
    || forecast.creatorBalanceEvidenceAvailableAt !== evidence.availableAt
    || forecast.creatorBalancePct !== creatorBalancePct
    || forecast.creatorBalanceChallengerPredictedRise !== expectedSelected
    || forecast.creatorBalanceChallengerDecision
      !== (expectedSelected ? "paper-long" : "paper-cash")) {
    return "forecast-creator-balance-decision-mismatch";
  }
  return null;
}

function newbornLpProviderRowRejectionReason({
  registration,
  discovery,
  evidence,
  forecast,
}) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE;
  if (!registration || !matchesBirthLpProviderRegistration(registration)) {
    return "missing-or-invalid-registration";
  }
  if (!discovery
    || !(Date.parse(discovery.observedAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary))) {
    return "not-strictly-future";
  }
  if (rule.derivation.excludedTokenAddresses.includes(forecast.tokenAddress)) {
    return "derivation-token-excluded";
  }
  if (!validNewbornLpProviderEvidenceEnvelope({
    evidence,
    registration,
    discovery,
    tokenAddress: forecast.tokenAddress,
  })) return "missing-or-invalid-exact-mint-evidence";
  const availableAt = Date.parse(evidence.availableAt);
  const createdAt = Date.parse(forecast.createdAt);
  if (!(availableAt <= createdAt
    && createdAt - availableAt <= FIVE_MINUTES_MS)) return "invalid-evidence-to-forecast-timing";
  const totalLpProviders = evidence.aggregate.totalLpProviders;
  const expectedSelected = evidence.aggregate.coverage === "complete"
    && Number.isInteger(totalLpProviders)
    && totalLpProviders >= rule.minimumTotalLpProvidersInclusive;
  if (forecast.lpProviderChallengerRuleVersion !== rule.version
    || forecast.lpProviderChallengerRegistrationId !== registration.id
    || forecast.lpProviderChallengerRegisteredAt !== registration.registeredAt
    || forecast.lpProviderEvidenceId !== evidence.id
    || forecast.lpProviderEvidenceAvailableAt !== evidence.availableAt
    || forecast.totalLpProviders !== totalLpProviders
    || forecast.lpProviderChallengerPredictedRise !== expectedSelected
    || forecast.lpProviderChallengerDecision
      !== (expectedSelected ? "paper-long" : "paper-cash")) {
    return "forecast-lp-provider-decision-mismatch";
  }
  return null;
}

function newbornRugCheckPanelRowRejectionReason({
  registration,
  discovery,
  evidence,
  forecast,
  newborn,
}) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE;
  if (!registration || !matchesBirthRugCheckPanelRegistration(registration)) {
    return "missing-or-invalid-registration";
  }
  if (!discovery
    || !(Date.parse(discovery.observedAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary))) {
    return "not-strictly-future";
  }
  if (rule.derivation.excludedTokenAddresses.includes(forecast.tokenAddress)) {
    return "derivation-token-excluded";
  }
  if (!newborn || !validNewbornRugCheckRiskEvidenceEnvelope({
    evidence,
    registration,
    discovery,
    tokenAddress: forecast.tokenAddress,
    pairAddress: forecast.pairAddress,
    poolCreatedAt: newborn.poolCreatedAt,
  })) return "missing-or-invalid-panel-evidence";
  const availableAt = Date.parse(evidence.availableAt);
  const createdAt = Date.parse(forecast.createdAt);
  if (!(availableAt <= createdAt
    && createdAt - availableAt <= FIVE_MINUTES_MS)) return "invalid-evidence-to-forecast-timing";
  return null;
}

function newbornJupiterRoundTripRowRejectionReason({
  registration,
  discovery,
  evidence,
  forecast,
  newborn,
}) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE;
  if (!registration || !matchesBirthJupiterRoundTripRegistration(registration)) {
    return "missing-or-invalid-registration";
  }
  if (!discovery
    || !newborn
    || !(Date.parse(newborn.poolCreatedAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(discovery.observedAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))
    || !(Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary))) {
    return "not-strictly-future";
  }
  if (rule.derivation.excludedTokenAddresses.includes(forecast.tokenAddress)) {
    return "derivation-token-excluded";
  }
  if (!validNewbornJupiterRoundTripEvidenceEnvelope({
    evidence,
    registration,
    discovery,
    tokenAddress: forecast.tokenAddress,
    pairAddress: forecast.pairAddress,
    poolCreatedAt: newborn.poolCreatedAt,
  })) return "missing-or-invalid-panel-evidence";
  const availableAt = Date.parse(evidence.availableAt);
  const createdAt = Date.parse(forecast.createdAt);
  if (!(availableAt <= createdAt
    && createdAt - availableAt <= FIVE_MINUTES_MS)) return "invalid-evidence-to-forecast-timing";
  return null;
}

function rugCheckPanelBucket(field, row) {
  const aggregate = row.rugCheckAggregate;
  const value = field === "reportAgeSeconds"
    ? (Date.parse(row.createdAt) - Date.parse(aggregate.reportDetectedAt ?? "")) / 1_000
    : aggregate[field];
  if (field === "rugged") return value === true ? "true" : (value === false ? "false" : "missing");
  if (!Number.isFinite(value)) return "missing";
  if (field === "normalizedRiskScore") {
    if (value <= 20) return "00-20";
    if (value <= 50) return "21-50";
    if (value <= 70) return "51-70";
    return "71-plus";
  }
  if (["dangerRiskCount", "warningRiskCount", "insiderNetworkCount", "maximumInsiderNetworkSize"].includes(field)) {
    if (value === 0) return "0";
    if (value <= 2) return "1-2";
    return "3-plus";
  }
  if (field === "graphInsidersDetected") return value === 0 ? "0" : "1-plus";
  if (field === "totalHolders") {
    if (value <= 50) return "0000-0050";
    if (value <= 250) return "0051-0250";
    if (value <= 1_000) return "0251-1000";
    return "1001-plus";
  }
  if (field === "creatorBalancePct") {
    if (value <= 1) return "00-01";
    if (value <= 10) return "01-10";
    if (value <= 50) return "10-50";
    return "50-plus";
  }
  if (field === "mainPairLockedPct") {
    if (value === 0) return "0";
    if (value < 50) return "00-50";
    if (value < 95) return "50-95";
    return "95-plus";
  }
  if (field === "mainPairLockedUsd") {
    if (value === 0) return "0";
    if (value <= 10_000) return "00001-10000";
    if (value <= 50_000) return "10001-50000";
    return "50001-plus";
  }
  if (field === "reportAgeSeconds") {
    if (value <= 60) return "000-060";
    if (value <= 300) return "061-300";
    return "301-plus";
  }
  return "missing";
}

function rugCheckPanelSlice(field, bucket, rows) {
  return {
    field,
    bucket,
    observations: rows.length,
    riseRate: roundRatio(rows.filter((row) => row.grossReturnPct > 0).length, rows.length),
    netWinRate: roundRatio(
      rows.filter((row) => row.baseCapacityReturnPct > 0).length,
      rows.length,
    ),
    averageGrossReturnPct: nullableRound(mean(rows.map((row) => row.grossReturnPct))),
    averageBaseCapacityReturnPct: nullableRound(mean(
      rows.map((row) => row.baseCapacityReturnPct),
    )),
    averageStressCapacityReturnPct: nullableRound(mean(
      rows.map((row) => row.stressCapacityReturnPct),
    )),
    explosion25Count: rows.filter((row) => row.grossReturnPct >= 25).length,
    explosion50Count: rows.filter((row) => row.grossReturnPct >= 50).length,
    explosion100Count: rows.filter((row) => row.grossReturnPct >= 100).length,
    liquidityCollapseCount: rows.filter((row) => (
      row.resolution.status === "liquidity-collapse"
    )).length,
  };
}

function validatedNewPoolRows(events, {
  rule,
  registrationMatcher,
  marketCapFloorRemoved,
}) {
  const registration = events.find(registrationMatcher) ?? null;
  const sourceRegistration = events.find(matchesRegistration) ?? null;
  const liquidityScoringRegistration = findGeckoLiquidityCollapseScoringRegistration(events);
  const discoveries = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-discovery")
    .map((event) => [event.id, event]));
  const activations = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-activation")
    .map((event) => [event.id, event]));
  const resolutions = new Map(events
    .filter((event) => event.type === "geckoterminal-new-pool-resolution")
    .map((event) => [event.forecastId, event]));
  const forecasts = events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && event.registrationId === registration?.id
  ));
  const rejectionCounts = {};
  const rows = [];
  for (const forecast of forecasts) {
    const liquidityEligibilityReason = geckoLiquidityScoringEligibilityReason(
      forecast,
      liquidityScoringRegistration,
    );
    if (liquidityEligibilityReason) {
      increment(rejectionCounts, liquidityEligibilityReason);
      continue;
    }
    const discovery = discoveries.get(forecast.discoveryEventId);
    const activation = activations.get(forecast.activationEventId);
    const resolution = resolutions.get(forecast.id);
    if (!resolution) continue;
    const reason = newPoolRowRejectionReason({
      registration,
      registrationMatcher,
      sourceRegistration,
      rule,
      marketCapFloorRemoved,
      discovery,
      activation,
      forecast,
      resolution,
    });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      forecast,
      resolution,
      forecastId: forecast.id,
      createdAt: forecast.createdAt,
      chain: forecast.chain,
      tokenAddress: forecast.tokenAddress,
      grossReturnPct: resolution.grossReturnPct,
      baseCapacityReturnPct: resolution.status === "liquidity-collapse"
        ? GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE.collapsedOutcomeGrossReturnPct
        : capacityAdjustedReturnPct({
        grossReturnPct: resolution.grossReturnPct,
        entryLiquidityUsd: forecast.entryLiquidityUsd,
        exitLiquidityUsd: resolution.exitLiquidityUsd,
        paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
        roundTripCostPct: rule.baseRoundTripCostPct,
      }),
      stressCapacityReturnPct: resolution.status === "liquidity-collapse"
        ? GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE.collapsedOutcomeGrossReturnPct
        : capacityAdjustedReturnPct({
        grossReturnPct: resolution.grossReturnPct,
        entryLiquidityUsd: forecast.entryLiquidityUsd,
        exitLiquidityUsd: resolution.exitLiquidityUsd,
        paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
        roundTripCostPct: rule.stressRoundTripCostPct,
      }),
      ...forecast.metrics,
    });
  }
  return {
    registration,
    liquidityScoringRegistration,
    forecasts,
    ...forecastMaturityAtLedgerAsOf(events, forecasts),
    rejectionCounts,
    rows,
  };
}

function newPoolRowRejectionReason({
  registration,
  registrationMatcher,
  sourceRegistration,
  rule,
  marketCapFloorRemoved,
  discovery,
  activation,
  forecast,
  resolution,
}) {
  if (!registration || !registrationMatcher(registration)) {
    return "missing-or-invalid-registration";
  }
  if (!sourceRegistration || !matchesRegistration(sourceRegistration)) {
    return "missing-or-invalid-source-registration";
  }
  if (!(Date.parse(discovery?.observedAt) > Date.parse(registration.registeredAt)
    && Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt)
    && Date.parse(activation?.observedAt) > Date.parse(registration.registeredAt))) {
    return "not-strictly-future";
  }
  if (!discovery
    || discovery.registrationId !== sourceRegistration.id
    || discovery.ruleVersion !== GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version
    || discovery.provider !== GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.sourceProvider
    || discovery.researchOnly !== true
    || discovery.mutationAllowed !== false) return "source-discovery-mismatch";
  const newborn = (discovery.candidates ?? []).find((candidate) => (
    candidate.tokenAddress === forecast.tokenAddress
      && candidate.pairAddress === forecast.pairAddress
  ));
  if (!validNewborn(newborn)
    || !(Date.parse(newborn.poolCreatedAt) > Date.parse(registration.registeredAt))
    || newborn.activationDueAt
      !== new Date(Date.parse(newborn.poolCreatedAt) + FIFTEEN_MINUTES_MS).toISOString()) {
    return "newborn-candidate-mismatch";
  }
  const candidate = activation?.candidate;
  if (!activation
    || activation.discoveryEventId !== discovery.id
    || activation.registrationId !== sourceRegistration.id
    || activation.status !== "observed"
    || (marketCapFloorRemoved
      ? !(activation.entryStatus === "cash"
        && activation.entryReason === "market-cap-outside-50000-5000000")
      : activation.entryStatus !== "ready")
    || activation.pairAddress !== forecast.pairAddress
    || activation.tokenAddress !== forecast.tokenAddress
    || activation.activationDueAt !== newborn.activationDueAt
    || activation.activationLagMs < 0
    || activation.activationLagMs > TEN_MINUTES_MS
    || !(marketCapFloorRemoved
      ? validMarketCapFloorRemovedActivationCandidate(candidate)
      : validActivationCandidate(candidate))
    || canonical(forecast.metrics) !== canonical(activationMetrics(candidate))) {
    return "activation-mismatch";
  }
  if (forecast.ruleVersion !== rule.version
    || forecast.registrationId !== registration.id
    || forecast.registeredAt !== registration.registeredAt
    || forecast.predictedRise !== true
    || forecast.decision !== rule.decision
    || forecast.discoveryEventId !== discovery.id
    || forecast.activationEventId !== activation.id
    || forecast.sourceDiscoveryObservedAt !== discovery.observedAt
    || forecast.activationObservedAt !== activation.observedAt
    || forecast.entryObservedAt !== forecast.createdAt
    || Date.parse(forecast.createdAt) - Date.parse(forecast.activationObservedAt)
      > FIVE_MINUTES_MS
    || forecast.dueAt !== new Date(Date.parse(forecast.createdAt) + HOUR_MS).toISOString()
    || forecast.researchOnly !== true
    || forecast.mutationAllowed !== false
    || !validGeckoDexDirectIntegrity(
      forecast.entryProviderPriceIntegrity,
      forecast.entryPriceUsd,
      forecast.entryLiquidityUsd,
      rule,
    )) return "forecast-or-entry-mismatch";
  if (!["observed", "liquidity-collapse"].includes(resolution.status)
    || resolution.ruleVersion !== forecast.ruleVersion
    || resolution.registrationId !== forecast.registrationId
    || resolution.discoveryEventId !== forecast.discoveryEventId
    || resolution.activationEventId !== forecast.activationEventId
    || resolution.forecastId !== forecast.id
    || resolution.chain !== forecast.chain
    || resolution.tokenAddress !== forecast.tokenAddress
    || resolution.pairAddress !== forecast.pairAddress
    || resolution.dueAt !== forecast.dueAt
    || resolution.entryPriceUsd !== forecast.entryPriceUsd
    || resolution.entryLiquidityUsd !== forecast.entryLiquidityUsd
    || resolution.observationLagMs < 0
    || resolution.observationLagMs > MAX_OUTCOME_LAG_MS
    || resolution.researchOnly !== true
    || resolution.mutationAllowed !== false) return "resolution-mismatch";
  if (resolution.status === "liquidity-collapse") {
    return resolution.reason === "both-providers-below-paper-notional-liquidity"
      && resolution.grossReturnPct
        === GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE.collapsedOutcomeGrossReturnPct
      && validGeckoLiquidityCollapseIntegrity(
        resolution.providerPriceIntegrity,
        resolution.exitPriceUsd,
        resolution.exitLiquidityUsd,
      ) ? null : "liquidity-collapse-integrity-mismatch";
  }
  if (!(resolution.exitPriceUsd > 0)
    || !(resolution.exitLiquidityUsd > 0)
    || resolution.grossReturnPct
      !== round6(((resolution.exitPriceUsd / forecast.entryPriceUsd) - 1) * 100)) {
    return "resolution-return-mismatch";
  }
  if (!validGeckoDexDirectIntegrity(
    resolution.providerPriceIntegrity,
    resolution.exitPriceUsd,
    resolution.exitLiquidityUsd,
    rule,
  )) return "exit-provider-price-integrity-mismatch";
  return null;
}

function activationEvent({
  item,
  observedAt,
  status,
  reason,
  candidate,
  entryStatus,
  entryReason,
}) {
  return {
    type: "geckoterminal-new-pool-activation",
    id: `geckoterminal_new_pool_activation_${digestValue({
      discoveryEventId: item.discovery.id,
      pairAddress: item.candidate.pairAddress,
      observedAt: observedAt.toISOString(),
      status,
    }).slice(0, 24)}`,
    ruleVersion: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version,
    registrationId: item.discovery.registrationId,
    discoveryEventId: item.discovery.id,
    chain: "solana",
    tokenAddress: item.candidate.tokenAddress,
    pairAddress: item.candidate.pairAddress,
    poolCreatedAt: item.candidate.poolCreatedAt,
    activationDueAt: item.candidate.activationDueAt,
    observedAt: observedAt.toISOString(),
    activationLagMs: observedAt.getTime() - item.dueAtMs,
    status,
    reason,
    candidate,
    entryStatus,
    entryReason,
    researchOnly: true,
    mutationAllowed: false,
  };
}

function activationMetrics(candidate) {
  return {
    sourceRank: finiteNumber(candidate.sourceRank),
    pairAgeMinutes: finiteNumber(candidate.pairAgeMinutes),
    marketCapUsd: finiteNumber(candidate.marketCapUsd),
    sourceLiquidityUsd: finiteNumber(candidate.liquidityUsd),
    volumeH1Usd: finiteNumber(candidate.volumeH1Usd),
    hourlyTurnover: finiteNumber(candidate.hourlyTurnover),
    volumeM5Usd: finiteNumber(candidate.volumeM5Usd),
    fiveMinuteTurnover: finiteNumber(candidate.fiveMinuteTurnover),
    buysH1: finiteNumber(candidate.buysH1),
    sellsH1: finiteNumber(candidate.sellsH1),
    buySellTxnRatio: finiteNumber(candidate.buySellTxnRatio),
    buysM5: finiteNumber(candidate.buysM5),
    sellsM5: finiteNumber(candidate.sellsM5),
    fiveMinuteBuySellTxnRatio: finiteNumber(candidate.fiveMinuteBuySellTxnRatio),
    priceChangeM5Pct: finiteNumber(candidate.priceChangeM5Pct),
    priceChangeH1Pct: finiteNumber(candidate.priceChangeH1Pct),
    priceChangeH24Pct: finiteNumber(candidate.priceChangeH24Pct),
  };
}

function validNewborn(candidate) {
  return candidate?.status === "watchable"
    && candidate.ruleVersion === GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version
    && candidate.chain === "solana"
    && typeof candidate.tokenAddress === "string"
    && typeof candidate.pairAddress === "string"
    && Number.isFinite(Date.parse(candidate.poolCreatedAt))
    && candidate.birthAgeMinutes >= 0
    && candidate.birthAgeMinutes
      <= GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.maximumBirthObservationAgeMinutesInclusive;
}

function validActivationCandidate(candidate) {
  return candidate?.status === "eligible"
    && candidate.ruleVersion === GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version
    && candidate.chain === "solana"
    && typeof candidate.tokenAddress === "string"
    && typeof candidate.pairAddress === "string"
    && candidate.priceUsd > 0
    && candidate.liquidityUsd > 0;
}

function validMarketCapFloorRemovedActivationCandidate(candidate) {
  return marketCapFloorRemovedEligible(candidate)
    && candidate.ruleVersion === GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version
    && candidate.chain === "solana"
    && typeof candidate.tokenAddress === "string"
    && typeof candidate.pairAddress === "string"
    && candidate.priceUsd > 0
    && candidate.liquidityUsd > 0;
}

function validBirthEntryCandidate(candidate, newborn, registration) {
  return candidate?.status === "eligible"
    && candidate.ruleVersion === GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.version
    && candidate.chain === "solana"
    && candidate.tokenAddress === newborn?.tokenAddress
    && candidate.pairAddress === newborn?.pairAddress
    && candidate.poolCreatedAt === newborn?.poolCreatedAt
    && candidate.pairAgeMinutes >= 0
    && candidate.pairAgeMinutes
      <= GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.maximumBirthObservationAgeMinutesInclusive
    && candidate.priceUsd > 0
    && candidate.liquidityUsd > 0
    && Number.isFinite(Date.parse(newborn.poolCreatedAt))
    && Date.parse(newborn.poolCreatedAt) > Date.parse(registration?.registeredAt ?? "")
    && newborn.status === "watchable"
    && newborn.ruleVersion === GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version;
}

function validBirthMarketCapFloorRemovedCandidate(candidate, newborn, registration) {
  return marketCapFloorRemovedEligible(candidate)
    && candidate.ruleVersion === GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.version
    && candidate.chain === "solana"
    && candidate.tokenAddress === newborn?.tokenAddress
    && candidate.pairAddress === newborn?.pairAddress
    && candidate.poolCreatedAt === newborn?.poolCreatedAt
    && candidate.pairAgeMinutes >= 0
    && candidate.pairAgeMinutes
      <= GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.maximumBirthObservationAgeMinutesInclusive
    && candidate.priceUsd > 0
    && candidate.liquidityUsd > 0
    && Number.isFinite(Date.parse(newborn.poolCreatedAt))
    && Date.parse(newborn.poolCreatedAt) > Date.parse(registration?.registeredAt ?? "")
    && newborn.status === "watchable"
    && newborn.ruleVersion === GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version;
}

function validBirthUpperMomentumCandidate(candidate, newborn, registration) {
  const blockers = Array.isArray(candidate?.blockers) ? candidate.blockers : [];
  const marketCapBlocker = "market-cap-outside-50000-5000000";
  const hourlyMomentumBlocker = "one-hour-price-change-outside-minus20-to-25";
  const allowedBlockers = new Set([marketCapBlocker, hourlyMomentumBlocker]);
  const marketCapBelowParentFloor = blockers.includes(marketCapBlocker);
  return candidate?.status === "blocked"
    && blockers.includes(hourlyMomentumBlocker)
    && blockers.every((blocker) => allowedBlockers.has(blocker))
    && candidate.ruleVersion === GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.version
    && candidate.chain === "solana"
    && candidate.tokenAddress === newborn?.tokenAddress
    && candidate.pairAddress === newborn?.pairAddress
    && candidate.poolCreatedAt === newborn?.poolCreatedAt
    && candidate.pairAgeMinutes >= 0
    && candidate.pairAgeMinutes
      <= GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.maximumBirthObservationAgeMinutesInclusive
    && candidate.priceUsd > 0
    && candidate.liquidityUsd
      >= GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE.candidateScreens
        .minimumLiquidityUsdInclusive
    && candidate.marketCapUsd > 0
    && candidate.marketCapUsd
      <= GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE.candidateScreens
        .maximumMarketCapUsdInclusive
    && (marketCapBelowParentFloor
      ? candidate.marketCapUsd
        < GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.candidateScreens
          .minimumMarketCapUsdInclusive
      : candidate.marketCapUsd
        >= GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.candidateScreens
          .minimumMarketCapUsdInclusive)
    && candidate.volumeH1Usd
      >= GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE.candidateScreens
        .minimumHourlyVolumeUsdInclusive
    && candidate.priceChangeH1Pct
      > GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE
        .incrementalMinimumHourlyPriceChangePctExclusive
    && candidate.priceChangeH1Pct
      <= GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE
        .incrementalMaximumHourlyPriceChangePctInclusive
    && candidate.priceChangeH24Pct
      >= GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE.candidateScreens
        .minimumDailyPriceChangePctInclusive
    && candidate.priceChangeH24Pct
      <= GECKOTERMINAL_NEW_POOL_BIRTH_UPPER_MOMENTUM_RULE.candidateScreens
        .maximumDailyPriceChangePctInclusive
    && Number.isFinite(Date.parse(newborn.poolCreatedAt))
    && Date.parse(newborn.poolCreatedAt) > Date.parse(registration?.registeredAt ?? "")
    && newborn.status === "watchable"
    && newborn.ruleVersion === GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version;
}

async function collectGeckoMultiPools(pairAddresses, fetcher) {
  const uniquePairs = [...new Set(pairAddresses)].slice(0, 30);
  if (!uniquePairs.length) return { rowsByPair: new Map(), failures: [], requestsAttempted: 0 };
  try {
    const response = await fetcher(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/multi/${uniquePairs.map(encodeURIComponent).join(",")}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) throw new Error(`GeckoTerminal multi-pool returned HTTP ${response.status}.`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return {
      rowsByPair: new Map(rows.map((row) => {
        const address = text(row?.attributes?.address)
          ?? (text(row?.id)?.startsWith("solana_")
            ? text(row.id).slice("solana_".length) : null);
        return [address, row];
      }).filter(([address]) => address)),
      failures: [],
      requestsAttempted: 1,
    };
  } catch (error) {
    return {
      rowsByPair: new Map(),
      failures: [error instanceof Error ? error.message : String(error)],
      requestsAttempted: 1,
    };
  }
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesMarketCapFloorRemovedRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolMarketCapFloorRemovedRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthEntryRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthEntryRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthMarketCapFloorRemovedRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthMarketCapFloorRemovedRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthUpperMomentumRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthUpperMomentumRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthLowMomentumRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthLowMomentumRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthPathRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthPathRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthCreatorBalanceRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthCreatorBalanceRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthLpProviderRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthLpProviderRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthRugCheckPanelRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthRugCheckPanelRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthPairAgeRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthPairAgeRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthTurnoverRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthTurnoverRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthSocialPresenceRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthSocialPresenceRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthDangerCountRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthDangerCountRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthJupiterRoundTripRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthJupiterRoundTripRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesBirthJupiterExecutableRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthJupiterExecutableRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function validJupiterExecutableDecisionEnvelope({
  decision,
  registration,
  sourceRegistration,
  discovery,
}) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE;
  if (!registration
    || !matchesBirthJupiterExecutableRegistration(registration)
    || !sourceRegistration
    || !matchesRegistration(sourceRegistration)
    || !discovery
    || discovery.type !== "geckoterminal-new-pool-discovery"
    || discovery.registrationId !== sourceRegistration.id
    || discovery.ruleVersion !== GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version
    || discovery.provider !== GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.sourceProvider
    || discovery.researchOnly !== true
    || discovery.mutationAllowed !== false) return false;
  const newborn = (discovery.candidates ?? []).find((candidate) => (
    candidate.tokenAddress === decision?.tokenAddress
      && candidate.pairAddress === decision?.pairAddress
  ));
  const candidate = newborn?.birthQuote;
  if (!validBirthMarketCapFloorRemovedCandidate(candidate, newborn, registration)) return false;
  const aggregate = canonicalNewbornJupiterRoundTripAggregate(decision?.quoteAggregate);
  const expectedDecision = aggregate.status === "round-trip-quoted"
    && aggregate.coverage === "complete" ? "paper-long"
    : (aggregate.status === "provider-unavailable" ? "unavailable" : "paper-cash");
  const expectedPredictedRise = expectedDecision === "paper-long";
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  const registeredAt = Date.parse(registration.registeredAt ?? "");
  const poolCreatedAt = Date.parse(newborn?.poolCreatedAt ?? "");
  const quoteObservedAt = Date.parse(decision?.quoteObservedAt ?? "");
  const quoteAvailableAt = Date.parse(decision?.quoteAvailableAt ?? "");
  const createdAt = Date.parse(decision?.createdAt ?? "");
  return Boolean(
    decision?.type === "geckoterminal-new-pool-jupiter-executable-decision"
      && decision.id === `geckoterminal_new_pool_jupiter_executable_decision_${digestValue({
        registrationId: registration.id,
        discoveryEventId: discovery.id,
        tokenAddress: candidate.tokenAddress,
      }).slice(0, 24)}`
      && decision.ruleVersion === rule.version
      && decision.registrationId === registration.id
      && decision.registeredAt === registration.registeredAt
      && decision.discoveryEventId === discovery.id
      && decision.chain === "solana"
      && decision.tokenAddress === candidate.tokenAddress
      && decision.symbol === candidate.symbol
      && decision.pairAddress === candidate.pairAddress
      && decision.poolCreatedAt === newborn.poolCreatedAt
      && decision.sourceDiscoveryObservedAt === discovery.observedAt
      && Number.isFinite(discoveryAt)
      && Number.isFinite(registeredAt)
      && Number.isFinite(poolCreatedAt)
      && Number.isFinite(quoteObservedAt)
      && Number.isFinite(quoteAvailableAt)
      && Number.isFinite(createdAt)
      && discoveryAt > registeredAt
      && poolCreatedAt > registeredAt
      && createdAt > registeredAt
      && createdAt > Date.parse(rule.evidenceBoundary)
      && quoteObservedAt >= discoveryAt
      && quoteAvailableAt >= quoteObservedAt
      && createdAt >= quoteAvailableAt
      && createdAt - discoveryAt <= FIVE_MINUTES_MS
      && decision.dueAt === new Date(createdAt + HOUR_MS).toISOString()
      && decision.inputMint === rule.inputMint
      && decision.inputUsdcAtomic === String(rule.inputUsdcAtomic)
      && aggregate.inputUsdcAtomic === String(rule.inputUsdcAtomic)
      && canonical(aggregate) === canonical(decision.quoteAggregate)
      && decision.quoteAggregateDigest === digestValue(aggregate)
      && decision.quoteAggregateOnly === true
      && decision.rawRoutesRetained === false
      && decision.entryTokenAmountAtomic === (expectedPredictedRise
        ? aggregate.buyOutputTokenAtomic : null)
      && decision.predictedRise === expectedPredictedRise
      && decision.decision === expectedDecision
      && decision.decisionReason === aggregate.status
      && canonical(decision.metrics) === canonical(activationMetrics(candidate))
      && !rule.derivation.excludedTokenAddresses.includes(decision.tokenAddress)
      && decision.researchOnly === true
      && decision.mutationAllowed === false,
  );
}

function validJupiterExecutableResolutionEnvelope({ decision, resolution }) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_EXECUTABLE_RULE;
  const observedAt = Date.parse(resolution?.observedAt ?? "");
  const dueAt = Date.parse(decision?.dueAt ?? "");
  if (!Number.isFinite(observedAt)
    || !Number.isFinite(dueAt)
    || observedAt < dueAt
    || resolution?.type !== "geckoterminal-new-pool-jupiter-executable-resolution"
    || resolution.id !== `geckoterminal_new_pool_jupiter_executable_resolution_${digestValue({
      decisionId: decision.id,
      observedAt: resolution.observedAt,
      status: resolution.status,
    }).slice(0, 24)}`
    || resolution.ruleVersion !== rule.version
    || resolution.registrationId !== decision.registrationId
    || resolution.decisionId !== decision.id
    || resolution.discoveryEventId !== decision.discoveryEventId
    || resolution.chain !== decision.chain
    || resolution.tokenAddress !== decision.tokenAddress
    || resolution.pairAddress !== decision.pairAddress
    || resolution.dueAt !== decision.dueAt
    || resolution.observationLagMs !== observedAt - dueAt
    || resolution.entryTokenAmountAtomic !== decision.entryTokenAmountAtomic
    || resolution.rawRoutesRetained !== false
    || resolution.researchOnly !== true
    || resolution.mutationAllowed !== false) return false;
  const emptyExit = resolution.exitQuote === null && resolution.exitQuoteDigest === null;
  if (resolution.status === "cash") {
    return decision.decision === "paper-cash"
      && resolution.reason === decision.decisionReason
      && emptyExit
      && resolution.grossReturnPct === 0
      && resolution.baseReturnPct === 0
      && resolution.stressReturnPct === 0;
  }
  if (resolution.status === "unavailable") {
    return decision.decision === "unavailable"
      && resolution.reason === "entry-provider-unavailable"
      && emptyExit
      && resolution.grossReturnPct === null
      && resolution.baseReturnPct === null
      && resolution.stressReturnPct === null;
  }
  if (resolution.status === "missed") {
    return decision.decision === "paper-long"
      && ["exact-one-hour-window-expired", "quote-arrived-after-exact-window"]
        .includes(resolution.reason)
      && resolution.observationLagMs > MAX_OUTCOME_LAG_MS
      && emptyExit
      && resolution.grossReturnPct === null
      && resolution.baseReturnPct === null
      && resolution.stressReturnPct === null;
  }
  if (decision.decision !== "paper-long"
    || resolution.observationLagMs < 0
    || resolution.observationLagMs > MAX_OUTCOME_LAG_MS
    || !resolution.exitQuote) return false;
  const exitQuote = canonicalJupiterExecutableExitQuote(resolution.exitQuote);
  if (canonical(exitQuote) !== canonical(resolution.exitQuote)
    || resolution.exitQuoteDigest !== digestValue(exitQuote)) return false;
  const grossReturnPct = resolution.status === "liquidity-collapse" ? -100
    : (resolution.status === "observed" && exitQuote.status === "quoted"
      ? ((Number(exitQuote.outputUsdcAtomic) / rule.inputUsdcAtomic) - 1) * 100
      : null);
  if (!Number.isFinite(grossReturnPct)) return false;
  const expectedBase = Math.max(-100, grossReturnPct - rule.baseRoundTripCostPct);
  const expectedStress = Math.max(-100, grossReturnPct - rule.stressRoundTripCostPct);
  return resolution.grossReturnPct === round6(grossReturnPct)
    && resolution.baseReturnPct === round6(expectedBase)
    && resolution.stressReturnPct === round6(expectedStress)
    && (resolution.status === "observed"
      ? (resolution.reason === null && exitQuote.status === "quoted")
      : (resolution.status === "liquidity-collapse"
        && resolution.reason === "held-token-no-exit-route"
        && exitQuote.status === "no-route"));
}

function validNewbornJupiterRoundTripEvidenceEnvelope({
  evidence,
  registration,
  discovery,
  tokenAddress,
  pairAddress,
  poolCreatedAt,
}) {
  const rule = GECKOTERMINAL_NEW_POOL_BIRTH_JUPITER_ROUND_TRIP_RULE;
  const aggregate = canonicalNewbornJupiterRoundTripAggregate(evidence?.aggregate);
  const observedAt = Date.parse(evidence?.observedAt ?? "");
  const availableAt = Date.parse(evidence?.availableAt ?? "");
  const discoveryAt = Date.parse(discovery?.observedAt ?? "");
  const registeredAt = Date.parse(registration?.registeredAt ?? "");
  const poolCreatedAtMs = Date.parse(poolCreatedAt ?? "");
  return Boolean(
    registration
      && discovery
      && matchesBirthJupiterRoundTripRegistration(registration)
      && evidence?.type === "geckoterminal-new-pool-jupiter-roundtrip-snapshot"
      && evidence.id === `geckoterminal_new_pool_jupiter_roundtrip_${digestValue({
        registrationId: registration.id,
        discoveryEventId: discovery.id,
        tokenAddress,
      }).slice(0, 24)}`
      && evidence.ruleVersion === rule.version
      && evidence.registrationId === registration.id
      && evidence.discoveryEventId === discovery.id
      && evidence.provider === rule.evidenceProvider
      && evidence.chain === "solana"
      && evidence.tokenAddress === tokenAddress
      && evidence.pairAddress === pairAddress
      && evidence.poolCreatedAt === poolCreatedAt
      && !rule.derivation.excludedTokenAddresses.includes(tokenAddress)
      && Number.isFinite(observedAt)
      && Number.isFinite(availableAt)
      && Number.isFinite(discoveryAt)
      && Number.isFinite(registeredAt)
      && Number.isFinite(poolCreatedAtMs)
      && discoveryAt > registeredAt
      && poolCreatedAtMs > registeredAt
      && observedAt >= discoveryAt
      && availableAt >= observedAt
      && availableAt - discoveryAt <= FIVE_MINUTES_MS
      && aggregate.inputUsdcAtomic === String(rule.inputUsdcAtomic)
      && canonical(aggregate) === canonical(evidence.aggregate)
      && evidence.aggregateDigest === digestValue(aggregate)
      && evidence.aggregateOnly === true
      && evidence.rawRoutesRetained === false
      && evidence.researchOnly === true
      && evidence.mutationAllowed === false,
  );
}

function validNewbornCreatorBalanceEvidenceEnvelope({
  evidence,
  registration,
  discovery,
  tokenAddress,
}) {
  const aggregate = canonicalNewbornCreatorBalanceAggregate(evidence?.aggregate);
  const observedAt = Date.parse(evidence?.observedAt ?? "");
  const availableAt = Date.parse(evidence?.availableAt ?? "");
  const discoveryAt = Date.parse(discovery?.observedAt ?? "");
  return Boolean(
    registration
      && discovery
      && matchesBirthCreatorBalanceRegistration(registration)
      && evidence?.type === "geckoterminal-new-pool-creator-balance-snapshot"
      && evidence.id === `geckoterminal_new_pool_creator_balance_${digestValue({
        registrationId: registration.id,
        discoveryEventId: discovery.id,
        tokenAddress,
      }).slice(0, 24)}`
      && evidence.ruleVersion === GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE.version
      && evidence.registrationId === registration.id
      && evidence.discoveryEventId === discovery.id
      && evidence.provider === GECKOTERMINAL_NEW_POOL_BIRTH_CREATOR_BALANCE_RULE.evidenceProvider
      && evidence.chain === "solana"
      && evidence.tokenAddress === tokenAddress
      && Number.isFinite(observedAt)
      && Number.isFinite(availableAt)
      && Number.isFinite(discoveryAt)
      && observedAt >= discoveryAt
      && availableAt >= observedAt
      && availableAt - discoveryAt <= FIVE_MINUTES_MS
      && canonical(aggregate) === canonical(evidence.aggregate)
      && evidence.aggregateDigest === digestValue(aggregate)
      && evidence.aggregateOnly === true
      && evidence.rawIdentitiesRetained === false
      && evidence.researchOnly === true
      && evidence.mutationAllowed === false,
  );
}

function validNewbornLpProviderEvidenceEnvelope({
  evidence,
  registration,
  discovery,
  tokenAddress,
}) {
  const aggregate = canonicalNewbornLpProviderAggregate(evidence?.aggregate);
  const observedAt = Date.parse(evidence?.observedAt ?? "");
  const availableAt = Date.parse(evidence?.availableAt ?? "");
  const discoveryAt = Date.parse(discovery?.observedAt ?? "");
  return Boolean(
    registration
      && discovery
      && matchesBirthLpProviderRegistration(registration)
      && evidence?.type === "geckoterminal-new-pool-lp-provider-snapshot"
      && evidence.id === `geckoterminal_new_pool_lp_provider_${digestValue({
        registrationId: registration.id,
        discoveryEventId: discovery.id,
        tokenAddress,
      }).slice(0, 24)}`
      && evidence.ruleVersion === GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE.version
      && evidence.registrationId === registration.id
      && evidence.discoveryEventId === discovery.id
      && evidence.provider === GECKOTERMINAL_NEW_POOL_BIRTH_LP_PROVIDER_RULE.evidenceProvider
      && evidence.chain === "solana"
      && evidence.tokenAddress === tokenAddress
      && Number.isFinite(observedAt)
      && Number.isFinite(availableAt)
      && Number.isFinite(discoveryAt)
      && observedAt >= discoveryAt
      && availableAt >= observedAt
      && availableAt - discoveryAt <= FIVE_MINUTES_MS
      && canonical(aggregate) === canonical(evidence.aggregate)
      && evidence.aggregateDigest === digestValue(aggregate)
      && evidence.aggregateOnly === true
      && evidence.rawIdentitiesRetained === false
      && evidence.researchOnly === true
      && evidence.mutationAllowed === false,
  );
}

function validNewbornRugCheckRiskEvidenceEnvelope({
  evidence,
  registration,
  discovery,
  tokenAddress,
  pairAddress,
  poolCreatedAt,
}) {
  const aggregate = canonicalRugCheckAggregate(evidence?.aggregate);
  const observedAt = Date.parse(evidence?.observedAt ?? "");
  const availableAt = Date.parse(evidence?.availableAt ?? "");
  const discoveryAt = Date.parse(discovery?.observedAt ?? "");
  const poolCreatedAtMs = Date.parse(poolCreatedAt ?? "");
  return Boolean(
    registration
      && discovery
      && matchesBirthRugCheckPanelRegistration(registration)
      && evidence?.type === "geckoterminal-new-pool-rugcheck-risk-snapshot"
      && evidence.id === `geckoterminal_new_pool_rugcheck_risk_${digestValue({
        registrationId: registration.id,
        discoveryEventId: discovery.id,
        tokenAddress,
      }).slice(0, 24)}`
      && evidence.ruleVersion === GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.version
      && evidence.registrationId === registration.id
      && evidence.discoveryEventId === discovery.id
      && evidence.provider === GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.evidenceProvider
      && evidence.chain === "solana"
      && evidence.tokenAddress === tokenAddress
      && evidence.pairAddress === pairAddress
      && evidence.poolCreatedAt === poolCreatedAt
      && Number.isFinite(observedAt)
      && Number.isFinite(availableAt)
      && Number.isFinite(discoveryAt)
      && Number.isFinite(poolCreatedAtMs)
      && poolCreatedAtMs > Date.parse(registration.registeredAt)
      && discoveryAt > Date.parse(registration.registeredAt)
      && observedAt >= discoveryAt
      && availableAt >= observedAt
      && availableAt - discoveryAt <= FIVE_MINUTES_MS
      && !GECKOTERMINAL_NEW_POOL_BIRTH_RUGCHECK_PANEL_RULE.derivation
        .excludedTokenAddresses.includes(tokenAddress)
      && canonical(aggregate) === canonical(evidence.aggregate)
      && evidence.aggregateDigest === digestValue(aggregate)
      && evidence.aggregateOnly === true
      && evidence.rawIdentitiesRetained === false
      && evidence.researchOnly === true
      && evidence.mutationAllowed === false,
  );
}

async function verifiedLedger(ledgerPath) {
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  return events;
}

function watchResult(ledgerPath, observedAt, status, discovery) {
  const dueTimes = (discovery.candidates ?? [])
    .map((candidate) => candidate.activationDueAt)
    .filter(Boolean)
    .sort();
  return {
    ledgerPath,
    observedAt: observedAt.toISOString(),
    status,
    discoveryEventId: discovery.id,
    returnedRows: discovery.returnedRows,
    evaluatedRows: discovery.evaluatedRows ?? null,
    watchedCandidates: discovery.candidates?.length ?? 0,
    duplicatePoolCount: discovery.duplicatePoolCount ?? 0,
    rejectionCounts: discovery.rejectionCounts ?? {},
    selectionCounts: discovery.selectionCounts ?? {},
    selectionReconciliationGate: discovery.selectionReconciliationGate ?? null,
    activationDueAtRange: [dueTimes[0] ?? null, dueTimes.at(-1) ?? null],
  };
}

function activationResult(
  ledgerPath,
  observedAt,
  dueCandidates,
  requestsAttempted,
  activations,
  forecasts,
  failures,
) {
  const activationSummary = summarizeGeckoTerminalNewPoolActivations(activations);
  return {
    ledgerPath,
    observedAt: observedAt.toISOString(),
    dueCandidates,
    requestsAttempted,
    ...activationSummary,
    recordedForecasts: forecasts.length,
    failures,
    forecasts: forecasts.map((forecast) => ({
      id: forecast.id,
      tokenAddress: forecast.tokenAddress,
      symbol: forecast.symbol,
      dueAt: forecast.dueAt,
    })),
  };
}

export function summarizeGeckoTerminalNewPoolActivations(activations) {
  const observed = activations.filter((event) => event.status === "observed");
  const missed = activations.filter((event) => event.status === "missed");
  return {
    recordedActivations: activations.length,
    observedActivations: observed.length,
    missedActivations: missed.length,
    missedActivationReasonCounts: countActivationValues(
      missed.map((event) => event.reason),
    ),
    observedCandidateStatusCounts: countActivationValues(
      observed.map((event) => event.candidate?.status),
    ),
    observedActivationBlockerCounts: countActivationValues(
      observed.flatMap((event) => event.candidate?.blockers ?? []),
    ),
    observedActivationBlockerCardinalityCounts: countActivationValues(
      observed.map((event) => String(event.candidate?.blockers?.length ?? 0)),
    ),
  };
}

function countActivationValues(values) {
  const counts = new Map();
  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => (
    left.localeCompare(right)
  )));
}

function birthCaptureResult(
  ledgerPath,
  observedAt,
  status,
  discoveryEventId,
  forecasts,
  requestsAttempted,
  failures,
  jupiterExecutableDecisions = [],
) {
  return {
    ledgerPath,
    observedAt: observedAt.toISOString(),
    status,
    discoveryEventId,
    requestsAttempted,
    recordedForecasts: forecasts.length,
    recordedJupiterExecutableDecisions: jupiterExecutableDecisions.length,
    jupiterExecutableDecisions: jupiterExecutableDecisions.map((decision) => ({
      id: decision.id,
      tokenAddress: decision.tokenAddress,
      symbol: decision.symbol,
      decision: decision.decision,
      dueAt: decision.dueAt,
    })),
    failures,
    forecasts: forecasts.map((forecast) => ({
      id: forecast.id,
      tokenAddress: forecast.tokenAddress,
      symbol: forecast.symbol,
      dueAt: forecast.dueAt,
    })),
  };
}

function newPoolPathResult(
  ledgerPath,
  observedAt,
  bucketStartedAt,
  pendingForecasts,
  requestsAttempted,
  observations,
  failures,
) {
  return {
    ledgerPath,
    observedAt: observedAt.toISOString(),
    bucketStartedAt,
    pendingForecasts,
    requestsAttempted,
    recordedObservations: observations.length,
    liquidityCollapses: observations.filter((event) => (
      event.status === "liquidity-collapse"
    )).length,
    failures,
    observations: observations.map((event) => ({
      id: event.id,
      forecastId: event.forecastId,
      tokenAddress: event.tokenAddress,
      symbol: event.symbol,
      status: event.status,
      sourceForecastPreRegistration: event.sourceForecastPreRegistration,
      grossReturnFromEntryPct: event.grossReturnFromEntryPct,
      observedLiquidityUsd: event.observedLiquidityUsd,
    })),
  };
}

function resolutionResult(ledgerPath, now, dueForecasts, requestsAttempted, events, failures) {
  return {
    ledgerPath,
    checkedAt: now.toISOString(),
    dueForecasts,
    requestsAttempted,
    recordedResolutions: events.length,
    observed: events.filter((event) => (
      event.status === "observed" || event.status === "liquidity-collapse"
    )).length,
    liquidityCollapses: events.filter((event) => (
      event.status === "liquidity-collapse"
    )).length,
    missed: events.filter((event) => event.status === "missed").length,
    failures,
  };
}

function jupiterExecutableResolutionResult(
  ledgerPath,
  now,
  dueDecisions,
  requestsAttempted,
  events,
  failures,
) {
  return {
    ledgerPath,
    checkedAt: now.toISOString(),
    dueDecisions,
    requestsAttempted,
    recordedResolutions: events.length,
    observed: events.filter((event) => event.status === "observed").length,
    paperCash: events.filter((event) => event.status === "cash").length,
    liquidityCollapses: events.filter((event) => (
      event.status === "liquidity-collapse"
    )).length,
    unavailable: events.filter((event) => event.status === "unavailable").length,
    missed: events.filter((event) => event.status === "missed").length,
    failures,
  };
}

function countValues(values) {
  const counts = {};
  for (const value of values) increment(counts, value);
  return counts;
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveAtomicString(value) {
  const normalized = typeof value === "bigint" ? value.toString()
    : (typeof value === "number" && Number.isSafeInteger(value) ? String(value)
      : (typeof value === "string" ? value.trim() : ""));
  if (!/^[0-9]+$/.test(normalized)) return null;
  try {
    return BigInt(normalized) > 0n ? normalized : null;
  } catch {
    return null;
  }
}

function nonnegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function nonnegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

export function chronologicalHalfValidation(baseReturns, stressReturns, policy) {
  const splitIndex = Math.ceil(baseReturns.length / 2);
  const firstHalfBaseReturns = baseReturns.slice(0, splitIndex);
  const secondHalfBaseReturns = baseReturns.slice(splitIndex);
  const firstHalfStressReturns = stressReturns.slice(0, splitIndex);
  const secondHalfStressReturns = stressReturns.slice(splitIndex);
  const firstHalfBaseCi = firstHalfBaseReturns.length >= 2
    ? circularBlockBootstrapMeanInterval(firstHalfBaseReturns, policy.bootstrapIterations)
    : [null, null];
  const secondHalfBaseCi = secondHalfBaseReturns.length >= 2
    ? circularBlockBootstrapMeanInterval(secondHalfBaseReturns, policy.bootstrapIterations)
    : [null, null];
  const minimumFramesPerHalf = Math.ceil(policy.minimumIndependentSignalFrames / 2);
  const gate = Boolean(
    firstHalfBaseReturns.length >= minimumFramesPerHalf
      && secondHalfBaseReturns.length >= minimumFramesPerHalf
      && mean(firstHalfStressReturns) > 0
      && mean(secondHalfStressReturns) > 0
      && firstHalfBaseCi[0] > policy.bootstrapLower95MustExceedPct
      && secondHalfBaseCi[0] > policy.bootstrapLower95MustExceedPct
  );
  return {
    validation: {
      minimumFramesPerHalf,
      firstHalf: {
        independentFrames: firstHalfBaseReturns.length,
        portfolioAverageBaseReturnPct: nullableRound(mean(firstHalfBaseReturns)),
        portfolioAverageStressReturnPct: nullableRound(mean(firstHalfStressReturns)),
        portfolioBootstrapMeanReturnCi95Pct: firstHalfBaseCi.map(nullableRound),
      },
      secondHalf: {
        independentFrames: secondHalfBaseReturns.length,
        portfolioAverageBaseReturnPct: nullableRound(mean(secondHalfBaseReturns)),
        portfolioAverageStressReturnPct: nullableRound(mean(secondHalfStressReturns)),
        portfolioBootstrapMeanReturnCi95Pct: secondHalfBaseCi.map(nullableRound),
      },
    },
    gate,
    evidenceShortfall: {
      chronologicalFirstHalfFrames: Math.max(
        0,
        minimumFramesPerHalf - firstHalfBaseReturns.length,
      ),
      chronologicalSecondHalfFrames: Math.max(
        0,
        minimumFramesPerHalf - secondHalfBaseReturns.length,
      ),
    },
  };
}

function withChronologicalHalfValidation(scorecard, cohort) {
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const result = chronologicalHalfValidation(
    frames.map((frame) => mean(frame.map((row) => row.baseCapacityReturnPct))),
    frames.map((frame) => mean(frame.map((row) => row.stressCapacityReturnPct))),
    TOKEN_EDGE_EXECUTION_POLICY,
  );
  const coverage = forecastOutcomeCoverageValidation(cohort);
  return {
    ...scorecard,
    ...coverage.summary,
    chronologicalHalfValidation: result.validation,
    chronologicalHalfValidationGate: result.gate,
    evidenceStatus: scorecard.evidenceStatus === "reviewable" && coverage.gate
      ? "reviewable" : "collecting",
    evidenceShortfall: {
      ...scorecard.evidenceShortfall,
      ...coverage.evidenceShortfall,
      ...result.evidenceShortfall,
    },
    provisionalGate: scorecard.provisionalGate
      && coverage.gate
      && coverage.missingAsLossGate
      && result.gate,
  };
}

function forecastOutcomeCoverageValidation(cohort, options = {}) {
  const maturedForecastCount = cohort.maturedForecastCount ?? Math.max(
    0, cohort.forecasts.length - cohort.openForecasts,
  );
  const resolvedForecastCoverageRate = roundRatio(
    cohort.rows.length,
    maturedForecastCount,
  );
  const gate = Number.isFinite(resolvedForecastCoverageRate)
    && resolvedForecastCoverageRate
      >= MINIMUM_PROMOTION_RESOLVED_FORECAST_COVERAGE_RATE;
  const missingAsLoss = missingAsLossForecastSensitivity(cohort, options);
  return {
    gate,
    missingAsLossGate: missingAsLoss.gate,
    summary: {
      scorecardAsOf: cohort.scorecardAsOf ?? null,
      maturedForecastCount,
      recordedMaturedResolutions: cohort.recordedMaturedResolutions ?? null,
      unrecordedMaturedForecasts: cohort.unrecordedMaturedForecasts ?? null,
      resolvedForecastCoverageRate,
      minimumResolvedForecastCoverageRate:
        MINIMUM_PROMOTION_RESOLVED_FORECAST_COVERAGE_RATE,
      resolvedCoverageGate: gate,
      ...missingAsLoss.summary,
    },
    evidenceShortfall: {
      resolvedForecastCoverageRate: round6(Math.max(
        0,
        MINIMUM_PROMOTION_RESOLVED_FORECAST_COVERAGE_RATE
          - (resolvedForecastCoverageRate ?? 0),
      )),
    },
  };
}

export function missingAsLossForecastSensitivity(cohort, {
  selectionField = null,
} = {}) {
  const maturedForecasts = cohort.maturedForecasts ?? [];
  const rowsByForecastId = new Map(cohort.rows.map((row) => [row.forecast.id, row]));
  const sensitivityRows = maturedForecasts.map((forecast) => {
    const row = rowsByForecastId.get(forecast.id) ?? null;
    const selected = selectionField ? forecast[selectionField] === true : true;
    return {
      forecastId: forecast.id,
      createdAt: forecast.createdAt,
      chain: forecast.chain,
      tokenAddress: forecast.tokenAddress,
      selected,
      validOutcome: Boolean(row),
      baseCapacityReturnPct: selected
        ? (row?.baseCapacityReturnPct ?? -100) : 0,
      stressCapacityReturnPct: selected
        ? (row?.stressCapacityReturnPct ?? -100) : 0,
    };
  });
  const frames = independentAssetFrames(sensitivityRows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const baseReturns = frames.map((frame) => mean(
    frame.map((row) => row.baseCapacityReturnPct),
  ));
  const stressReturns = frames.map((frame) => mean(
    frame.map((row) => row.stressCapacityReturnPct),
  ));
  const averageBase = mean(baseReturns);
  const averageStress = mean(stressReturns);
  const gate = Number.isFinite(averageBase)
    && Number.isFinite(averageStress)
    && averageBase > 0
    && averageStress > 0;
  return {
    gate,
    summary: {
      missingAsLossMaturedForecasts: maturedForecasts.length,
      missingAsLossUnscoredForecasts: sensitivityRows.filter((row) => (
        !row.validOutcome
      )).length,
      missingAsLossSelectedForecasts: sensitivityRows.filter((row) => row.selected).length,
      missingAsLossIndependentHourlyFrames: frames.length,
      missingAsLossAverageBaseReturnPct: nullableRound(averageBase),
      missingAsLossAverageStressReturnPct: nullableRound(averageStress),
      missingAsLossSensitivityGate: gate,
    },
  };
}

function roundRatio(numerator, denominator) {
  return denominator > 0 ? nullableRound(numerator / denominator) : null;
}

function circularBlockBootstrapMeanInterval(values, iterations) {
  const blockSize = Math.max(2, Math.min(values.length, Math.round(Math.sqrt(values.length))));
  let state = 0x7e6e1d6e;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const means = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = [];
    while (sample.length < values.length) {
      const start = Math.floor(random() * values.length);
      for (let offset = 0; offset < blockSize && sample.length < values.length; offset += 1) {
        sample.push(values[(start + offset) % values.length]);
      }
    }
    means.push(mean(sample));
  }
  means.sort((left, right) => left - right);
  return [quantile(means, 0.025), quantile(means, 0.975)];
}

function quantile(values, probability) {
  if (!values.length) return null;
  const index = (values.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper ? values[lower]
    : values[lower] + ((values[upper] - values[lower]) * (index - lower));
}

function profitFactor(values) {
  const wins = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter((value) => value < 0)
    .reduce((sum, value) => sum + value, 0));
  if (losses === 0) return wins > 0 ? 999 : null;
  return wins / losses;
}

function maxDrawdownPct(values) {
  if (!values.length) return null;
  let equity = 1;
  let peak = 1;
  let maximum = 0;
  for (const value of values) {
    equity *= Math.max(0, 1 + (value / 100));
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }
  return maximum;
}

function largestWinningShare(values) {
  const winners = values.filter((value) => value > 0);
  const total = winners.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...winners) / total : null;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableRound(value) {
  return Number.isFinite(value) ? round6(value) : null;
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeDisplaySymbol(value) {
  const symbol = text(value)?.split(" / ")[0]?.trim();
  if (!symbol) return null;
  const sanitized = symbol.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
    .slice(0, 64)
    .trim();
  return sanitized || null;
}

function validIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Expected a valid timestamp.");
  return date.toISOString();
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseArgs(argv) {
  const options = { command: argv[2] ?? "score" };
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--ledger") options.ledgerPath = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "register-market-cap-floor-removed", "register-birth-entry",
    "register-birth-market-cap-floor-removed", "register-birth-upper-momentum",
    "register-birth-low-momentum",
    "register-birth-path",
    "register-birth-creator-balance", "register-birth-lp-provider",
    "register-birth-rugcheck-panel", "register-birth-pair-age",
    "register-birth-turnover", "register-birth-social-presence",
    "register-birth-danger-count", "register-birth-jupiter-roundtrip",
    "register-birth-jupiter-executable", "watch",
    "capture-birth-entry", "mark-birth-path", "activate", "resolve",
    "resolve-birth-jupiter-executable", "score", "score-market-cap-floor-removed",
    "score-birth-entry", "score-birth-market-cap-floor-removed",
    "score-birth-upper-momentum",
    "score-birth-low-momentum",
    "score-birth-creator-balance", "score-birth-lp-provider",
    "score-birth-rugcheck-panel", "score-birth-pair-age", "score-birth-turnover",
    "score-birth-social-presence", "score-birth-danger-count",
    "score-birth-jupiter-roundtrip", "score-birth-jupiter-executable"]
    .includes(options.command)) {
    throw new Error("Usage: onchain-geckoterminal-new-pool-activation.mjs register|register-market-cap-floor-removed|register-birth-entry|register-birth-market-cap-floor-removed|register-birth-upper-momentum|register-birth-low-momentum|register-birth-path|register-birth-creator-balance|register-birth-lp-provider|register-birth-rugcheck-panel|register-birth-pair-age|register-birth-turnover|register-birth-social-presence|register-birth-danger-count|register-birth-jupiter-roundtrip|register-birth-jupiter-executable|watch|capture-birth-entry|mark-birth-path|activate|resolve|resolve-birth-jupiter-executable|score|score-market-cap-floor-removed|score-birth-entry|score-birth-market-cap-floor-removed|score-birth-upper-momentum|score-birth-low-momentum|score-birth-creator-balance|score-birth-lp-provider|score-birth-rugcheck-panel|score-birth-pair-age|score-birth-turnover|score-birth-social-presence|score-birth-danger-count|score-birth-jupiter-roundtrip|score-birth-jupiter-executable [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerGeckoTerminalNewPoolActivation(options), null, 2));
    } else if (options.command === "register-market-cap-floor-removed") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolMarketCapFloorRemoved(options), null, 2,
      ));
    } else if (options.command === "register-birth-entry") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthEntry(options), null, 2,
      ));
    } else if (options.command === "register-birth-market-cap-floor-removed") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthMarketCapFloorRemoved(options), null, 2,
      ));
    } else if (options.command === "register-birth-upper-momentum") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthUpperMomentum(options), null, 2,
      ));
    } else if (options.command === "register-birth-low-momentum") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthLowMomentum(options), null, 2,
      ));
    } else if (options.command === "register-birth-path") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthPath(options), null, 2,
      ));
    } else if (options.command === "register-birth-creator-balance") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthCreatorBalance(options), null, 2,
      ));
    } else if (options.command === "register-birth-lp-provider") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthLpProvider(options), null, 2,
      ));
    } else if (options.command === "register-birth-rugcheck-panel") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthRugCheckPanel(options), null, 2,
      ));
    } else if (options.command === "register-birth-pair-age") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthPairAge(options), null, 2,
      ));
    } else if (options.command === "register-birth-turnover") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthTurnover(options), null, 2,
      ));
    } else if (options.command === "register-birth-social-presence") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthSocialPresence(options), null, 2,
      ));
    } else if (options.command === "register-birth-danger-count") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthDangerCount(options), null, 2,
      ));
    } else if (options.command === "register-birth-jupiter-roundtrip") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthJupiterRoundTrip(options), null, 2,
      ));
    } else if (options.command === "register-birth-jupiter-executable") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolBirthJupiterExecutable(options), null, 2,
      ));
    } else if (options.command === "watch") {
      console.log(JSON.stringify(await watchGeckoTerminalNewPools(options), null, 2));
    } else if (options.command === "capture-birth-entry") {
      console.log(JSON.stringify(
        await captureGeckoTerminalNewPoolBirthEntries(options), null, 2,
      ));
    } else if (options.command === "mark-birth-path") {
      console.log(JSON.stringify(
        await markOpenGeckoTerminalNewPoolBirthPaths(options), null, 2,
      ));
    } else if (options.command === "activate") {
      console.log(JSON.stringify(await activateGeckoTerminalNewPools(options), null, 2));
    } else if (options.command === "resolve") {
      console.log(JSON.stringify(await resolveGeckoTerminalNewPoolForecasts(options), null, 2));
    } else if (options.command === "resolve-birth-jupiter-executable") {
      console.log(JSON.stringify(
        await resolveGeckoTerminalNewPoolBirthJupiterExecutable(options), null, 2,
      ));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: options.command === "score-birth-upper-momentum"
          ? buildGeckoTerminalNewPoolBirthUpperMomentumScorecard(events)
          : (options.command === "score-birth-low-momentum"
            ? buildGeckoTerminalNewPoolBirthLowMomentumScorecard(events)
          : (options.command === "score-market-cap-floor-removed"
          ? buildGeckoTerminalNewPoolMarketCapFloorRemovedScorecard(events)
          : (options.command === "score-birth-entry"
            ? buildGeckoTerminalNewPoolBirthEntryScorecard(events)
            : (options.command === "score-birth-market-cap-floor-removed"
              ? buildGeckoTerminalNewPoolBirthMarketCapFloorRemovedScorecard(events)
              : (options.command === "score-birth-creator-balance"
                ? buildGeckoTerminalNewPoolBirthCreatorBalanceScorecard(events)
                : (options.command === "score-birth-lp-provider"
                  ? buildGeckoTerminalNewPoolBirthLpProviderScorecard(events)
                  : (options.command === "score-birth-rugcheck-panel"
                    ? buildGeckoTerminalNewPoolBirthRugCheckPanelScorecard(events)
                    : (options.command === "score-birth-pair-age"
                      ? buildGeckoTerminalNewPoolBirthPairAgeScorecard(events)
                      : (options.command === "score-birth-turnover"
                        ? buildGeckoTerminalNewPoolBirthTurnoverScorecard(events)
                        : (options.command === "score-birth-social-presence"
                          ? buildGeckoTerminalNewPoolBirthSocialPresenceScorecard(events)
                          : (options.command === "score-birth-jupiter-roundtrip"
                          ? buildGeckoTerminalNewPoolBirthJupiterRoundTripScorecard(events)
                          : (options.command === "score-birth-jupiter-executable"
                            ? buildGeckoTerminalNewPoolBirthJupiterExecutableScorecard(events)
                          : (options.command === "score-birth-danger-count"
                            ? buildGeckoTerminalNewPoolBirthDangerCountScorecard(events)
                              : buildGeckoTerminalNewPoolScorecard(events)))))))))))))),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
