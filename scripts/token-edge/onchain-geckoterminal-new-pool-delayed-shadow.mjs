#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendLedgerEvent,
  digestValue,
  latestLedgerOccurrenceAt,
  readLedger,
  verifyLedger,
} from "./onchain-forward-core.mjs";
export { latestLedgerOccurrenceAt };
import {
  TOKEN_EDGE_EXECUTION_POLICY,
  capacityAdjustedReturnPct,
} from "./onchain-capacity-scorecard.mjs";
import {
  independentAssetFrames,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE,
} from "./onchain-geckoterminal-new-pool-activation.mjs";
import { geckoTrendingCandidate } from "./onchain-geckoterminal-trending-monitoring.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const MAX_OBSERVATION_LAG_MS = 10 * 60_000;
const MINIMUM_VALID_CAPACITY_OUTCOME_COVERAGE_RATE = 0.95;
const MAXIMUM_REPORTED_DISCOVERY_UTC_DAY_COVERAGE_ROWS = 14;
const HORIZONS = Object.freeze({
  "1h": HOUR_MS,
  "24h": 24 * HOUR_MS,
});

export const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-full-cohort-delayed-shadow-v1",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version,
  changedDimension: "measurement-coverage-from-eligible-forecasts-to-all-future-watched-pools",
  sourceProvider: "geckoterminal-multi-exact-pool",
  sourceMaximumRows: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.sourceMaximumRows,
  horizons: Object.freeze(Object.keys(HORIZONS)),
  horizonClock: "source-discovery-observed-at",
  maximumObservationLagMinutes: MAX_OBSERVATION_LAG_MS / 60_000,
  maximumProviderRequestsPerRun: 1,
  paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  decision: "none-observation-only",
  researchOnly: true,
  mutationAllowed: false,
  decisionAuthority: false,
  promotionAuthority: false,
  tradingAuthority: false,
});

export const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_LIQUIDITY_FLOOR_AUDIT_RULE =
  Object.freeze({
    version: "geckoterminal-new-pool-delayed-shadow-v4-birth-liquidity-floor-audit-v1",
    sourceRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    parentRuleVersion:
      GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
    changedDimension: "birth-liquidity-minimum-usd-only",
    horizon: "1h",
    field: "birthQuote.liquidityUsd",
    operator: ">=",
    thresholdsUsd: Object.freeze([
      10_000, 12_500, 15_000, 17_500, 20_000, 25_000, 30_000, 40_000,
    ]),
    missingSelectedOutcomePolicy: "minus-100-percent",
    unselectedPolicy: "paper-cash-zero-percent",
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
    stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
    minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
    minimumIndependentSignalFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
    minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
    minimumSelectedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
    minimumIndependentTradedFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
    bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
    bootstrapLower95MustExceedPct:
      TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
    minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
    maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
    maximumLargestWinningFrameShare:
      TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
    independentQuantValidationRequired: true,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  });

export const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_LIQUIDITY_AUDIT_RULE =
  Object.freeze({
    version:
      "geckoterminal-new-pool-delayed-shadow-full-cohort-liquidity-audit-v1",
    sourceRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    parentRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    changedDimension:
      "paper-long-full-delayed-cohort-by-minimum-birth-liquidity-only",
    horizon: "1h",
    field: "birthQuote.liquidityUsd",
    operator: ">=",
    thresholdsUsd: Object.freeze([
      10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
    ]),
    unavailableLiquidityPolicy: "paper-cash-zero-percent",
    missingSelectedOutcomePolicy: "minus-100-percent",
    unselectedPolicy: "paper-cash-zero-percent",
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
    stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
    minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
    minimumIndependentSignalFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
    minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
    minimumSelectedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
    minimumIndependentTradedFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
    bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
    bootstrapLower95MustExceedPct:
      TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
    minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
    maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
    maximumLargestWinningFrameShare:
      TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
    independentQuantValidationRequired: true,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  });

export const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_VOLUME_AUDIT_RULE =
  Object.freeze({
    version:
      "geckoterminal-new-pool-delayed-shadow-full-cohort-hourly-volume-audit-v1",
    sourceRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    parentRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    changedDimension:
      "paper-long-full-delayed-cohort-by-minimum-birth-hourly-volume-only",
    horizon: "1h",
    field: "birthQuote.volumeH1Usd",
    operator: ">=",
    thresholdsUsd: Object.freeze([
      1_000, 2_500, 5_000, 10_000, 25_000, 50_000,
    ]),
    unavailableVolumePolicy: "paper-cash-zero-percent",
    missingSelectedOutcomePolicy: "minus-100-percent",
    unselectedPolicy: "paper-cash-zero-percent",
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
    stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
    minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
    minimumIndependentSignalFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
    minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
    minimumSelectedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
    minimumIndependentTradedFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
    bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
    bootstrapLower95MustExceedPct:
      TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
    minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
    maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
    maximumLargestWinningFrameShare:
      TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
    independentQuantValidationRequired: true,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  });

export const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_AUDIT_RULE =
  Object.freeze({
    version:
      "geckoterminal-new-pool-delayed-shadow-full-cohort-five-minute-turnover-audit-v1",
    sourceRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    parentRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    changedDimension:
      "paper-long-full-delayed-cohort-by-maximum-birth-five-minute-turnover-only",
    horizon: "1h",
    field: "birthQuote.fiveMinuteTurnover",
    operator: "<=",
    maximumTurnovers: Object.freeze([
      0.025, 0.05, 0.1, 0.2, 0.5, 1,
    ]),
    unavailableTurnoverPolicy: "paper-cash-zero-percent",
    missingSelectedOutcomePolicy: "minus-100-percent",
    unselectedPolicy: "paper-cash-zero-percent",
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
    stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
    minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
    minimumIndependentSignalFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
    minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
    minimumSelectedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
    minimumIndependentTradedFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
    bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
    bootstrapLower95MustExceedPct:
      TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
    minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
    maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
    maximumLargestWinningFrameShare:
      TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
    independentQuantValidationRequired: true,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  });

export const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_FLOOR_AUDIT_RULE =
  Object.freeze({
    version:
      "geckoterminal-new-pool-delayed-shadow-full-cohort-five-minute-turnover-floor-audit-v1",
    sourceRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    parentRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    changedDimension:
      "paper-long-full-delayed-cohort-by-minimum-birth-five-minute-turnover-only",
    horizon: "1h",
    field: "birthQuote.fiveMinuteTurnover",
    operator: ">=",
    minimumTurnovers: Object.freeze([
      0.5, 1, 2, 5, 10, 20,
    ]),
    derivationStatus: "post-rejection-complementary-direction",
    relatedPriorAuditVersions: Object.freeze([
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_LIQUIDITY_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_VOLUME_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_AUDIT_RULE
        .version,
    ]),
    sequentialRelatedFamilyCountIncludingThis: 4,
    sequentialRelatedVariantCountIncludingThis: 24,
    sequentialFamilyCorrectionRequired: true,
    unavailableTurnoverPolicy: "paper-cash-zero-percent",
    missingSelectedOutcomePolicy: "minus-100-percent",
    unselectedPolicy: "paper-cash-zero-percent",
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
    stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
    minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
    minimumIndependentSignalFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
    minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
    minimumSelectedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
    minimumIndependentTradedFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
    bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
    bootstrapLower95MustExceedPct:
      TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
    minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
    maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
    maximumLargestWinningFrameShare:
      TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
    independentQuantValidationRequired: true,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  });

export const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_MARKET_CAP_AUDIT_RULE =
  Object.freeze({
    version:
      "geckoterminal-new-pool-delayed-shadow-full-cohort-market-cap-floor-audit-v1",
    sourceRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    parentRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    changedDimension:
      "paper-long-full-delayed-cohort-by-minimum-birth-market-cap-only",
    horizon: "1h",
    field: "birthQuote.marketCapUsd",
    fieldSource: "provider-market-cap-with-provider-fdv-fallback",
    operator: ">=",
    thresholdsUsd: Object.freeze([
      50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000,
    ]),
    derivationStatus: "distinct-maturity-hypothesis-after-four-related-failures",
    relatedPriorAuditVersions: Object.freeze([
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_LIQUIDITY_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_VOLUME_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_FLOOR_AUDIT_RULE
        .version,
    ]),
    sequentialRelatedFamilyCountIncludingThis: 5,
    sequentialRelatedVariantCountIncludingThis: 30,
    sequentialFamilyCorrectionRequired: true,
    unavailableMarketCapPolicy: "paper-cash-zero-percent",
    missingSelectedOutcomePolicy: "minus-100-percent",
    unselectedPolicy: "paper-cash-zero-percent",
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
    stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
    minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
    minimumIndependentSignalFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
    minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
    minimumSelectedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
    minimumIndependentTradedFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
    bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
    bootstrapLower95MustExceedPct:
      TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
    minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
    maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
    maximumLargestWinningFrameShare:
      TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
    independentQuantValidationRequired: true,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  });

export const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_WILSON_BUY_SHARE_AUDIT_RULE =
  Object.freeze({
    version:
      "geckoterminal-new-pool-delayed-shadow-full-cohort-five-minute-buy-share-wilson-lower-audit-v1",
    sourceRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    parentRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    changedDimension:
      "paper-long-full-delayed-cohort-by-minimum-birth-five-minute-buy-share-wilson-lower-bound-only",
    horizon: "1h",
    field:
      "wilson-lower-bound(birthQuote.buysM5,birthQuote.sellsM5,95-percent)",
    operator: ">=",
    confidenceLevel: 0.95,
    zScore: 1.959963984540054,
    minimumWilsonLowerBounds: Object.freeze([
      0.35, 0.4, 0.45, 0.5, 0.55, 0.6,
    ]),
    derivationStatus:
      "outcome-blind-sparse-count-penalized-order-flow-hypothesis-after-five-related-failures",
    relatedPriorAuditVersions: Object.freeze([
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_LIQUIDITY_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_VOLUME_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_FLOOR_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_MARKET_CAP_AUDIT_RULE
        .version,
    ]),
    sequentialRelatedFamilyCountIncludingThis: 6,
    sequentialRelatedVariantCountIncludingThis: 36,
    sequentialFamilyCorrectionRequired: true,
    zeroOrUnavailableTransactionPolicy: "paper-cash-zero-percent",
    missingSelectedOutcomePolicy: "minus-100-percent",
    unselectedPolicy: "paper-cash-zero-percent",
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
    stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
    minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
    minimumIndependentSignalFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
    minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
    minimumSelectedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
    minimumIndependentTradedFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
    bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
    bootstrapLower95MustExceedPct:
      TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
    minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
    maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
    maximumLargestWinningFrameShare:
      TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
    independentQuantValidationRequired: true,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  });

export const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TRANSACTION_COUNT_AUDIT_RULE =
  Object.freeze({
    version:
      "geckoterminal-new-pool-delayed-shadow-full-cohort-five-minute-total-transactions-floor-audit-v1",
    sourceRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    parentRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    changedDimension:
      "paper-long-full-delayed-cohort-by-minimum-birth-five-minute-total-transactions-only",
    horizon: "1h",
    field: "birthQuote.buysM5+birthQuote.sellsM5",
    operator: ">=",
    minimumTransactionCounts: Object.freeze([1, 5, 10, 20, 30, 50]),
    derivationStatus:
      "post-rejection-participation-breadth-hypothesis-after-six-related-failures",
    relatedPriorAuditVersions: Object.freeze([
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_LIQUIDITY_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_VOLUME_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_FLOOR_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_MARKET_CAP_AUDIT_RULE
        .version,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_WILSON_BUY_SHARE_AUDIT_RULE
        .version,
    ]),
    sequentialRelatedFamilyCountIncludingThis: 7,
    sequentialRelatedVariantCountIncludingThis: 42,
    sequentialFamilyCorrectionRequired: true,
    unavailableTransactionPolicy: "paper-cash-zero-percent",
    missingSelectedOutcomePolicy: "minus-100-percent",
    unselectedPolicy: "paper-cash-zero-percent",
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
    stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
    minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
    minimumIndependentSignalFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
    minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
    minimumSelectedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
    minimumIndependentTradedFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
    bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
    bootstrapLower95MustExceedPct:
      TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
    minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
    maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
    maximumLargestWinningFrameShare:
      TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
    independentQuantValidationRequired: true,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  });

const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_AUDIT_FAMILIES =
  Object.freeze([
    Object.freeze({
      ruleVersion:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_LIQUIDITY_AUDIT_RULE
          .version,
      variantCount:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_LIQUIDITY_AUDIT_RULE
          .thresholdsUsd.length,
    }),
    Object.freeze({
      ruleVersion:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_VOLUME_AUDIT_RULE
          .version,
      variantCount:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_VOLUME_AUDIT_RULE
          .thresholdsUsd.length,
    }),
    Object.freeze({
      ruleVersion:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_AUDIT_RULE
          .version,
      variantCount:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_AUDIT_RULE
          .maximumTurnovers.length,
    }),
    Object.freeze({
      ruleVersion:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_FLOOR_AUDIT_RULE
          .version,
      variantCount:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_FLOOR_AUDIT_RULE
          .minimumTurnovers.length,
    }),
    Object.freeze({
      ruleVersion:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_MARKET_CAP_AUDIT_RULE
          .version,
      variantCount:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_MARKET_CAP_AUDIT_RULE
          .thresholdsUsd.length,
    }),
    Object.freeze({
      ruleVersion:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_WILSON_BUY_SHARE_AUDIT_RULE
          .version,
      variantCount:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_WILSON_BUY_SHARE_AUDIT_RULE
          .minimumWilsonLowerBounds.length,
    }),
    Object.freeze({
      ruleVersion:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TRANSACTION_COUNT_AUDIT_RULE
          .version,
      variantCount:
        GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TRANSACTION_COUNT_AUDIT_RULE
          .minimumTransactionCounts.length,
    }),
  ]);

export const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_AUDIT_REGISTRY_RULE =
  Object.freeze({
    version:
      "geckoterminal-new-pool-delayed-shadow-full-cohort-audit-registry-v3",
    parentRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    families:
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_AUDIT_FAMILIES,
    totalFamilyCount:
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_AUDIT_FAMILIES.length,
    totalVariantCount:
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_AUDIT_FAMILIES.reduce(
        (total, family) => total + family.variantCount,
        0,
      ),
    correctionScope: "all-declared-full-cohort-families-and-variants",
    familyExpansionPolicy:
      "one-separately-declared-family-only-after-lineage-coverage-and-correction-prerequisites",
    maximumAdditionalFamiliesPerReviewedExpansion: 1,
    independentQuantValidationRequired: true,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  });

export const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_BUY_SHARE_AUDIT_RULE =
  Object.freeze({
    version: "geckoterminal-new-pool-delayed-shadow-v4-birth-buy-share-audit-v1",
    sourceRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    parentRuleVersion:
      GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
    changedDimension: "minimum-decision-time-five-minute-transaction-buy-share-only",
    horizon: "1h",
    field: "birthQuote.buysM5/(birthQuote.buysM5+birthQuote.sellsM5)",
    operator: ">=",
    minimumBuyShares: Object.freeze([0.5, 0.55, 0.6, 0.65, 0.7, 0.75]),
    zeroOrUnavailableTransactionPolicy: "paper-cash-zero-percent",
    missingSelectedOutcomePolicy: "minus-100-percent",
    unselectedPolicy: "paper-cash-zero-percent",
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
    stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
    minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
    minimumIndependentSignalFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
    minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
    minimumSelectedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
    minimumIndependentTradedFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
    bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
    bootstrapLower95MustExceedPct:
      TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
    minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
    maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
    maximumLargestWinningFrameShare:
      TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
    independentQuantValidationRequired: true,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  });

export const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_TRANSACTION_COUNT_AUDIT_RULE =
  Object.freeze({
    version:
      "geckoterminal-new-pool-delayed-shadow-v4-birth-total-transactions-audit-v1",
    sourceRuleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    parentRuleVersion:
      GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
    changedDimension: "minimum-decision-time-five-minute-total-transactions-only",
    horizon: "1h",
    field: "birthQuote.buysM5+birthQuote.sellsM5",
    operator: ">=",
    minimumTransactionCounts: Object.freeze([1, 5, 10, 20, 30, 50]),
    unavailableTransactionPolicy: "paper-cash-zero-percent",
    missingSelectedOutcomePolicy: "minus-100-percent",
    unselectedPolicy: "paper-cash-zero-percent",
    paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
    baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
    stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
    minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
    minimumIndependentSignalFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
    minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
    minimumSelectedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
    minimumIndependentTradedFrames:
      TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
    bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
    bootstrapLower95MustExceedPct:
      TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
    minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
    maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
    maximumLargestWinningFrameShare:
      TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
    independentQuantValidationRequired: true,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  });

export function createGeckoTerminalNewPoolDelayedShadowRegistrationEvent({
  registeredAt,
  evidenceBoundary,
}) {
  const registered = validDate(registeredAt);
  const boundary = validDate(evidenceBoundary);
  if (registered.getTime() <= boundary.getTime()) {
    throw new Error("Delayed shadow registration must be strictly after its evidence boundary.");
  }
  const rule = {
    ...GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE,
    evidenceBoundary: boundary.toISOString(),
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue({
      registeredAt: registered.toISOString(),
      rule,
    }).slice(0, 24)}`,
    registeredAt: registered.toISOString(),
    status: "frozen",
    rule,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

export async function registerGeckoTerminalNewPoolDelayedShadow(
  options = {},
  dependencies = {},
) {
  const now = validDate(dependencies.now ?? new Date());
  const evidenceBoundary = validDate(options.evidenceBoundary);
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const existing = events.find((event) => matchesRegistration(event, evidenceBoundary));
  if (existing) return registrationResult(ledgerPath, "existing", existing);
  const conflicting = events.find((event) => (
    event.type === "monitoring-policy-registration"
      && event.status === "frozen"
      && event.rule?.version === GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version
  ));
  if (conflicting) throw new Error(`Existing delayed shadow registration mismatch: ${conflicting.id}`);
  const event = createGeckoTerminalNewPoolDelayedShadowRegistrationEvent({
    registeredAt: now,
    evidenceBoundary,
  });
  return registrationResult(
    ledgerPath,
    "registered",
    await appendLedgerEvent(ledgerPath, event),
  );
}

export function inspectGeckoTerminalNewPoolDelayedShadowDue(events, options = {}) {
  const inspectedAt = options.asOf === undefined
    ? latestLedgerOccurrenceAt(events)
    : validDate(options.asOf);
  const registration = events.find((event) => (
    matchesRegistration(event)
      && timestampAtOrBefore(event.registeredAt, inspectedAt)
  )) ?? null;
  const empty = Object.fromEntries(Object.keys(HORIZONS).map((horizon) => [
    horizon,
    emptyDelayedDueHorizon(horizon),
  ]));
  if (!registration || !inspectedAt) {
    return {
      inspectedAt: inspectedAt?.toISOString() ?? null,
      registrationId: registration?.id ?? null,
      horizons: empty,
      researchOnly: true,
      mutationAllowed: false,
      authority: false,
    };
  }
  const discoveries = events.filter((event) => (
    event.type === "geckoterminal-new-pool-discovery"
      && Date.parse(event.observedAt) > Date.parse(registration.registeredAt)
      && timestampAtOrBefore(event.observedAt, inspectedAt)
  ));
  const outcomeKeysByHorizon = Object.fromEntries(Object.keys(HORIZONS).map(
    (horizon) => [horizon, new Set(events.filter((event) => (
      event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
        && event.registrationId === registration.id
        && event.horizon === horizon
        && timestampAtOrBefore(event.observedAt, inspectedAt)
    )).map((event) => `${event.discoveryEventId}:${event.pairAddress}`))],
  ));
  const inspectedAtMs = inspectedAt.getTime();
  const horizons = Object.fromEntries(Object.entries(HORIZONS).map(([
    horizon,
    horizonMs,
  ]) => {
    const groups = discoveries.map((discovery) => {
      const dueAtMs = Date.parse(discovery.observedAt) + horizonMs;
      const candidates = (discovery.candidates ?? []).filter((candidate) => (
        candidate.birthQuote
          && !outcomeKeysByHorizon[horizon]
            .has(`${discovery.id}:${candidate.pairAddress}`)
      ));
      return { discovery, dueAtMs, candidates };
    }).filter((group) => group.candidates.length > 0)
      .sort((left, right) => left.dueAtMs - right.dueAtMs);
    const due = groups.filter((group) => group.dueAtMs <= inspectedAtMs);
    const expired = due.filter((group) => (
      inspectedAtMs - group.dueAtMs > MAX_OBSERVATION_LAG_MS
    ));
    const live = due.filter((group) => !expired.includes(group));
    const future = groups.filter((group) => group.dueAtMs > inspectedAtMs);
    const unresolvedCandidates = countDelayedDueCandidates(groups);
    const dueCandidates = countDelayedDueCandidates(due);
    const liveDueCandidates = countDelayedDueCandidates(live);
    const expiredDueCandidates = countDelayedDueCandidates(expired);
    return [horizon, {
      horizon,
      unresolvedCohorts: groups.length,
      unresolvedCandidates,
      dueCohorts: due.length,
      dueCandidates,
      liveDueCohorts: live.length,
      liveDueCandidates,
      expiredDueCohorts: expired.length,
      expiredDueCandidates,
      futureCohorts: future.length,
      futureCandidates: countDelayedDueCandidates(future),
      earliestDueAt: isoTimestamp(due[0]?.dueAtMs),
      earliestLiveDueAt: isoTimestamp(live[0]?.dueAtMs),
      earliestLiveWindowClosesAt: isoTimestamp(
        live[0]?.dueAtMs + MAX_OBSERVATION_LAG_MS,
      ),
      nextFutureDueAt: isoTimestamp(future[0]?.dueAtMs),
      dueCandidateReconciliationGate:
        dueCandidates === liveDueCandidates + expiredDueCandidates,
      unresolvedCandidateReconciliationGate:
        unresolvedCandidates === dueCandidates
          + countDelayedDueCandidates(future),
    }];
  }));
  return {
    inspectedAt: inspectedAt.toISOString(),
    registrationId: registration.id,
    horizons,
    researchOnly: true,
    mutationAllowed: false,
    authority: false,
  };
}

export async function resolveGeckoTerminalNewPoolDelayedShadows(
  options = {},
  dependencies = {},
) {
  const horizon = validHorizon(options.horizon);
  const now = validDate(dependencies.now ?? new Date());
  const fetcher = dependencies.fetcher ?? fetch;
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find((event) => matchesRegistration(event));
  if (!registration) throw new Error("Register the delayed full-cohort shadow before resolving it.");
  const existing = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
      && event.registrationId === registration.id
      && event.horizon === horizon
  )).map((event) => `${event.discoveryEventId}:${event.pairAddress}`));
  const groups = events.filter((event) => (
    event.type === "geckoterminal-new-pool-discovery"
      && Date.parse(event.observedAt) > Date.parse(registration.registeredAt)
  )).map((discovery) => {
    const dueAt = new Date(Date.parse(discovery.observedAt) + HORIZONS[horizon]);
    const candidates = (discovery.candidates ?? []).filter((candidate) => (
      candidate.birthQuote
        && !existing.has(`${discovery.id}:${candidate.pairAddress}`)
    ));
    return { discovery, dueAt, candidates };
  }).filter((group) => (
    group.candidates.length && group.dueAt.getTime() <= now.getTime()
  )).sort((left, right) => left.dueAt - right.dueAt);
  if (!groups.length) {
    return resolutionResult(ledgerPath, horizon, now, 0, 0, 0, [], []);
  }

  const outcomes = [];
  const failures = [];
  const expired = groups.filter((group) => (
    now.getTime() - group.dueAt.getTime() > MAX_OBSERVATION_LAG_MS
  ));
  const live = groups.filter((group) => !expired.includes(group));
  const selected = live[0] ?? expired[0];
  const deferredDueCandidates = groups.filter((group) => group !== selected)
    .reduce((sum, group) => sum + group.candidates.length, 0);
  if (expired.includes(selected)) {
    for (const candidate of selected.candidates) {
      outcomes.push(await appendLedgerEvent(ledgerPath, delayedOutcomeEvent({
        registration,
        discovery: selected.discovery,
        candidate,
        horizon,
        dueAt: selected.dueAt,
        observedAt: now,
        status: "missed",
        reason: "delayed-shadow-window-expired",
        outcomeQuote: null,
      })));
    }
    return resolutionResult(
      ledgerPath,
      horizon,
      now,
      groups.reduce((sum, group) => sum + group.candidates.length, 0),
      deferredDueCandidates,
      0,
      outcomes,
      failures,
    );
  }

  const multi = await collectGeckoMultiPools(
    selected.candidates.map((candidate) => candidate.pairAddress),
    fetcher,
  );
  failures.push(...multi.failures);
  if (multi.failures.length && multi.rowsByPair.size === 0) {
    return resolutionResult(
      ledgerPath,
      horizon,
      now,
      groups.reduce((sum, group) => sum + group.candidates.length, 0),
      deferredDueCandidates,
      multi.requestsAttempted,
      outcomes,
      failures,
    );
  }
  const sourceObservedAt = validDate(dependencies.clock?.() ?? (
    dependencies.now ? now : new Date()
  ));
  for (const candidate of selected.candidates) {
    const row = multi.rowsByPair.get(candidate.pairAddress);
    if (!row) {
      const reason = "delayed-shadow-exact-pool-unavailable";
      failures.push(`${reason}: ${candidate.pairAddress}`);
      outcomes.push(await appendLedgerEvent(ledgerPath, delayedOutcomeEvent({
        registration,
        discovery: selected.discovery,
        candidate,
        horizon,
        dueAt: selected.dueAt,
        observedAt: sourceObservedAt,
        status: "missed",
        reason,
        outcomeQuote: null,
      })));
      continue;
    }
    const outcomeQuote = geckoTrendingCandidate(
      row,
      candidate.sourceRank,
      sourceObservedAt,
      GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
    );
    let reason = delayedOutcomeIneligibilityReason({
      candidate,
      outcomeQuote,
      dueAt: selected.dueAt,
      observedAt: sourceObservedAt,
    });
    if (reason) failures.push(`${reason}: ${candidate.pairAddress}`);
    outcomes.push(await appendLedgerEvent(ledgerPath, delayedOutcomeEvent({
      registration,
      discovery: selected.discovery,
      candidate,
      horizon,
      dueAt: selected.dueAt,
      observedAt: sourceObservedAt,
      status: reason ? "missed" : "observed",
      reason,
      outcomeQuote: reason ? null : outcomeQuote,
    })));
  }
  return resolutionResult(
    ledgerPath,
    horizon,
    sourceObservedAt,
    groups.reduce((sum, group) => sum + group.candidates.length, 0),
    deferredDueCandidates,
    multi.requestsAttempted,
    outcomes,
    failures,
  );
}

export function buildGeckoTerminalNewPoolDelayedShadowScorecard(events, options = {}) {
  const scorecardAsOf = options.asOf === undefined
    ? latestLedgerOccurrenceAt(events)
    : validDate(options.asOf);
  const registration = events.find((event) => (
    matchesRegistration(event)
      && timestampAtOrBefore(event.registeredAt, scorecardAsOf)
  )) ?? null;
  const discoveries = new Map(events.filter((event) => (
    event.type === "geckoterminal-new-pool-discovery"
      && registration
      && Date.parse(event.observedAt) > Date.parse(registration.registeredAt)
      && timestampAtOrBefore(event.observedAt, scorecardAsOf)
  )).map((event) => [event.id, event]));
  const prospectiveCandidates = registration
    ? [...discoveries.values()].filter((discovery) => (
      Date.parse(discovery.observedAt) > Date.parse(registration.registeredAt)
    )).flatMap((discovery) => (
      (discovery.candidates ?? []).filter((candidate) => candidate.birthQuote)
        .map((candidate) => ({ discovery, candidate }))
    ))
    : [];
  const prospectiveCandidateCount = prospectiveCandidates.length;
  const outcomes = events.filter((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
      && event.registrationId === registration?.id
      && discoveries.has(event.discoveryEventId)
      && timestampAtOrBefore(event.observedAt, scorecardAsOf)
  ));
  const expectedOutcomeKeys = new Set();
  const horizons = Object.fromEntries(Object.keys(HORIZONS).map((horizon) => {
    const horizonOutcomes = outcomes.filter((event) => event.horizon === horizon);
    const maturedCandidates = scorecardAsOf
      ? prospectiveCandidates.filter(({ discovery }) => (
        Date.parse(discovery.observedAt) + HORIZONS[horizon]
          <= scorecardAsOf.getTime()
      ))
      : [];
    const expectedHorizonOutcomeKeys = new Set(maturedCandidates.map(({
      discovery,
      candidate,
    }) => `${discovery.id}:${candidate.pairAddress}`));
    for (const key of expectedHorizonOutcomeKeys) {
      expectedOutcomeKeys.add(`${horizon}:${key}`);
    }
    const horizonOutcomeKeyDiagnostics = delayedOutcomeKeyDiagnostics(
      horizonOutcomes,
      { expectedKeys: expectedHorizonOutcomeKeys },
    );
    const reconciledHorizonOutcomes = horizonOutcomes.filter((outcome) => (
      expectedHorizonOutcomeKeys.has(delayedOutcomeKey(outcome))
    ));
    const maturedCandidateOutcomes = maturedCandidates.length;
    const outcomesByKey = new Map(reconciledHorizonOutcomes.map((outcome) => [
      `${outcome.discoveryEventId}:${outcome.pairAddress}`,
      outcome,
    ]));
    const validRowsByKey = new Map(reconciledHorizonOutcomes.map((outcome) => [
      `${outcome.discoveryEventId}:${outcome.pairAddress}`,
      delayedScoreRow(outcome, discoveries.get(outcome.discoveryEventId)),
    ]).filter(([, row]) => row));
    const rows = [...validRowsByKey.values()];
    const frames = independentAssetFrames(rows, {
      durationMs: HOUR_MS,
      timestamp: (row) => Date.parse(row.createdAt),
      assetKey: tokenEdgeAssetKey,
    });
    const weightedRows = frames.flat();
    const baseFrames = frames.map((frame) => mean(frame.map((row) => row.baseReturnPct)));
    const stressFrames = frames.map((frame) => mean(frame.map((row) => row.stressReturnPct)));
    const cashInclusiveRows = maturedCandidates.map(({ discovery, candidate }) => {
      const validRow = validRowsByKey.get(`${discovery.id}:${candidate.pairAddress}`);
      return {
        chain: candidate.chain,
        tokenAddress: candidate.tokenAddress,
        createdAt: discovery.observedAt,
        hasValidOutcome: Boolean(validRow),
        baseReturnPct: validRow?.baseReturnPct ?? 0,
        stressReturnPct: validRow?.stressReturnPct ?? 0,
      };
    });
    const missingAsLossRows = cashInclusiveRows.map((row) => ({
      ...row,
      baseReturnPct: row.hasValidOutcome ? row.baseReturnPct : -100,
      stressReturnPct: row.hasValidOutcome ? row.stressReturnPct : -100,
    }));
    const cashInclusiveFrames = independentAssetFrames(cashInclusiveRows, {
      durationMs: HOUR_MS,
      timestamp: (row) => Date.parse(row.createdAt),
      assetKey: tokenEdgeAssetKey,
    });
    const missingAsLossFrames = independentAssetFrames(missingAsLossRows, {
      durationMs: HOUR_MS,
      timestamp: (row) => Date.parse(row.createdAt),
      assetKey: tokenEdgeAssetKey,
    });
    const cashInclusiveBaseFrames = cashInclusiveFrames.map((frame) => mean(
      frame.map((row) => row.baseReturnPct),
    ));
    const cashInclusiveStressFrames = cashInclusiveFrames.map((frame) => mean(
      frame.map((row) => row.stressReturnPct),
    ));
    const missingAsLossBaseFrames = missingAsLossFrames.map((frame) => mean(
      frame.map((row) => row.baseReturnPct),
    ));
    const missingAsLossStressFrames = missingAsLossFrames.map((frame) => mean(
      frame.map((row) => row.stressReturnPct),
    ));
    const validCapacityOutcomeCoverageRate = roundRatio(
      rows.length,
      maturedCandidateOutcomes,
    );
    const recordedOutcomeCoverageRate = roundRatio(
      horizonOutcomeKeyDiagnostics.matchedOutcomeKeyCount,
      maturedCandidateOutcomes,
    );
    const coverageDiagnostics = delayedCoverageDiagnostics({
      outcomes: horizonOutcomes,
      recordedOutcomeCount: horizonOutcomeKeyDiagnostics.matchedOutcomeKeyCount,
      maturedCandidateOutcomes,
      validCapacityOutcomes: rows.length,
    });
    return [horizon, {
      prospectiveCandidates: prospectiveCandidateCount,
      maturedCandidateOutcomes,
      candidateOutcomes: prospectiveCandidateCount,
      recordedOutcomes: horizonOutcomeKeyDiagnostics.matchedOutcomeKeyCount,
      ...horizonOutcomeKeyDiagnostics,
      openOutcomes: Math.max(0, prospectiveCandidateCount - maturedCandidateOutcomes),
      unrecordedMaturedOutcomes: Math.max(
        0,
        maturedCandidateOutcomes
          - horizonOutcomeKeyDiagnostics.matchedOutcomeKeyCount,
      ),
      recordedOutcomeCoverageRate,
      observedOutcomes: horizonOutcomes.filter((event) => event.status === "observed").length,
      missedOutcomes: horizonOutcomes.filter((event) => event.status === "missed").length,
      validCapacityOutcomes: rows.length,
      validCapacityOutcomeCoverageRate,
      minimumValidCapacityOutcomeCoverageRate:
        MINIMUM_VALID_CAPACITY_OUTCOME_COVERAGE_RATE,
      validCapacityOutcomeCoverageGate: Number.isFinite(
        validCapacityOutcomeCoverageRate,
      ) && validCapacityOutcomeCoverageRate
        >= MINIMUM_VALID_CAPACITY_OUTCOME_COVERAGE_RATE,
      coverageDiagnostics,
      discoveryUtcDayCoverageDiagnostics:
        delayedDiscoveryUtcDayCoverageDiagnostics({
          maturedCandidates,
          outcomesByKey,
          validRowsByKey,
        }),
      validCapacityRows: weightedRows.length,
      independentHourlyFrames: frames.length,
      cashInclusiveIndependentHourlyFrames: cashInclusiveFrames.length,
      uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
      grossRiseRate: roundRatio(
        weightedRows.filter((row) => row.grossReturnPct > 0).length,
        weightedRows.length,
      ),
      explosion25Rate: roundRatio(
        weightedRows.filter((row) => row.grossReturnPct >= 25).length,
        weightedRows.length,
      ),
      averageBaseReturnPct: nullableRound(mean(baseFrames)),
      averageStressReturnPct: nullableRound(mean(stressFrames)),
      cashInclusiveAverageBaseReturnPct: nullableRound(mean(cashInclusiveBaseFrames)),
      cashInclusiveAverageStressReturnPct: nullableRound(mean(cashInclusiveStressFrames)),
      missingAsLossAverageBaseReturnPct: nullableRound(mean(missingAsLossBaseFrames)),
      missingAsLossAverageStressReturnPct: nullableRound(mean(missingAsLossStressFrames)),
      largestWinningFrameShare: nullableRound(largestWinningShare(baseFrames)),
    }];
  }));
  const outcomeKeyDiagnostics = delayedOutcomeKeyDiagnostics(outcomes, {
    includeHorizon: true,
    expectedKeys: expectedOutcomeKeys,
  });
  const validCapacityOutcomes = Object.values(horizons).reduce((sum, horizon) => (
    sum + horizon.validCapacityOutcomes
  ), 0);
  const maturedCandidateOutcomes = Object.values(horizons).reduce((sum, horizon) => (
    sum + horizon.maturedCandidateOutcomes
  ), 0);
  const validCapacityOutcomeCoverageRate = roundRatio(
    validCapacityOutcomes,
    maturedCandidateOutcomes,
  );
  const recordedOutcomeCoverageRate = roundRatio(
    outcomeKeyDiagnostics.matchedOutcomeKeyCount,
    maturedCandidateOutcomes,
  );
  const coverageDiagnostics = delayedCoverageDiagnostics({
    outcomes,
    recordedOutcomeCount: outcomeKeyDiagnostics.matchedOutcomeKeyCount,
    maturedCandidateOutcomes,
    validCapacityOutcomes,
  });
  const cashInclusiveIndependentHourlyFrames = Object.values(horizons).reduce(
    (sum, horizon) => sum + horizon.cashInclusiveIndependentHourlyFrames,
    0,
  );
  return {
    type: "geckoterminal-new-pool-delayed-shadow-scorecard",
    ruleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    evidenceBoundary: registration?.rule?.evidenceBoundary ?? null,
    scorecardAsOf: scorecardAsOf?.toISOString() ?? null,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
    candidateOutcomes: prospectiveCandidateCount * Object.keys(HORIZONS).length,
    prospectiveCandidates: prospectiveCandidateCount * Object.keys(HORIZONS).length,
    recordedOutcomes: outcomeKeyDiagnostics.matchedOutcomeKeyCount,
    ...outcomeKeyDiagnostics,
    maturedCandidateOutcomes,
    openOutcomes: Math.max(
      0,
      prospectiveCandidateCount * Object.keys(HORIZONS).length
        - maturedCandidateOutcomes,
    ),
    unrecordedMaturedOutcomes: Math.max(
      0,
      maturedCandidateOutcomes - outcomeKeyDiagnostics.matchedOutcomeKeyCount,
    ),
    recordedOutcomeCoverageRate,
    observedOutcomes: outcomes.filter((event) => event.status === "observed").length,
    missedOutcomes: outcomes.filter((event) => event.status === "missed").length,
    validCapacityOutcomes,
    validCapacityOutcomeCoverageRate,
    minimumValidCapacityOutcomeCoverageRate:
      MINIMUM_VALID_CAPACITY_OUTCOME_COVERAGE_RATE,
    validCapacityOutcomeCoverageGate: Number.isFinite(
      validCapacityOutcomeCoverageRate,
    ) && validCapacityOutcomeCoverageRate
      >= MINIMUM_VALID_CAPACITY_OUTCOME_COVERAGE_RATE,
    coverageDiagnostics,
    cashInclusiveIndependentHourlyFrames,
    cashInclusiveAverageBaseReturnPct: weightedHorizonMean(
      horizons,
      "cashInclusiveAverageBaseReturnPct",
      "cashInclusiveIndependentHourlyFrames",
    ),
    cashInclusiveAverageStressReturnPct: weightedHorizonMean(
      horizons,
      "cashInclusiveAverageStressReturnPct",
      "cashInclusiveIndependentHourlyFrames",
    ),
    missingAsLossAverageBaseReturnPct: weightedHorizonMean(
      horizons,
      "missingAsLossAverageBaseReturnPct",
      "cashInclusiveIndependentHourlyFrames",
    ),
    missingAsLossAverageStressReturnPct: weightedHorizonMean(
      horizons,
      "missingAsLossAverageStressReturnPct",
      "cashInclusiveIndependentHourlyFrames",
    ),
    horizons,
    evidenceStatus: "descriptive-only",
    provisionalGate: false,
    note: "This strictly future panel records delayed labels for every watched pool, including pools blocked from paper forecasts. Coverage is fail-closed against every deterministically matured candidate at the latest retained ledger occurrence, so an unrecorded matured label cannot disappear from the denominator. Cash-inclusive and missing-as-total-loss sensitivity returns preserve the full matured cohort and prevent observed-only selection from masquerading as an edge. It creates no entry decision and its return distribution is not a tradable strategy or promotion result.",
  };
}

export function buildGeckoTerminalNewPoolDelayedShadowLiquidityFloorAudit(
  events,
  options = {},
) {
  const rule = GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_LIQUIDITY_FLOOR_AUDIT_RULE;
  const {
    registration, scorecardAsOf, maturedCandidates, outcomesByKey,
  } = delayedV4AuditDataset(events, options, rule);
  const variants = rule.thresholdsUsd.map((thresholdUsd, index) => {
    const { threshold, ...variant } = delayedThresholdAuditVariant({
      maturedCandidates,
      outcomesByKey,
      threshold: thresholdUsd,
      selectCandidate: (candidate, selectedThreshold) => (
        candidate.birthQuote.liquidityUsd >= selectedThreshold
      ),
      rule,
      bootstrapSeedOffset: index,
    });
    return { thresholdUsd: threshold, ...variant };
  });
  return {
    type: "geckoterminal-new-pool-delayed-shadow-liquidity-floor-audit",
    auditVersion: rule.version,
    familyDigest: digestValue({
      field: rule.field,
      operator: rule.operator,
      thresholdsUsd: rule.thresholdsUsd,
      parentRuleVersion: rule.parentRuleVersion,
      horizon: rule.horizon,
      paperNotionalUsd: rule.paperNotionalUsd,
      baseRoundTripCostPct: rule.baseRoundTripCostPct,
      stressRoundTripCostPct: rule.stressRoundTripCostPct,
    }),
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    scorecardAsOf: scorecardAsOf?.toISOString() ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    horizon: rule.horizon,
    thresholdsUsd: [...rule.thresholdsUsd],
    baselineMaturedCandidates: maturedCandidates.length,
    baselineValidCapacityOutcomes: maturedCandidates.filter(({ discovery, candidate }) => (
      outcomesByKey.has(`${discovery.id}:${candidate.pairAddress}`)
        && outcomesByKey.get(`${discovery.id}:${candidate.pairAddress}`)
    )).length,
    variants,
    retrospectiveScreeningCandidates: variants.filter((variant) => (
      variant.retrospectiveScreeningGate
    )).map((variant) => variant.thresholdUsd),
    familyCorrectionStatus: variants.some((variant) => (
      variant.retrospectiveScreeningGate
    )) ? "required-not-run" : "not-run-no-variant-cleared-prerequisite-screening",
    independentQuantValidationStatus: "not-run",
    nominationGate: false,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
    note: "This provider-free derivation audit freezes one eight-threshold family that changes only the existing v4 birth-liquidity floor. Every matured otherwise-v4 candidate remains in cash-inclusive independent hourly frames; missing selected labels score -100%, and unselected candidates score zero. Full-sample and chronological-half bootstrap, stress, breadth, profit-factor, drawdown, winner-concentration, and leave-one-token-out gates must all pass before a threshold can become only a retrospective screening candidate. Multiple-testing and independent quant validation remain separate and not run, so this audit can never register, promote, mutate, or trade a policy by itself.",
  };
}

export function buildGeckoTerminalNewPoolDelayedShadowFullCohortLiquidityAudit(
  events,
  options = {},
) {
  const rule =
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_LIQUIDITY_AUDIT_RULE;
  const {
    registration, scorecardAsOf, maturedCandidates, outcomesByKey,
  } = delayedFullCohortAuditDataset(events, options, rule);
  const featureAvailableCandidates = maturedCandidates.filter(({ candidate }) => (
    Number.isFinite(candidate.birthQuote.liquidityUsd)
      && candidate.birthQuote.liquidityUsd > 0
  )).length;
  const variants = rule.thresholdsUsd.map((thresholdUsd, index) => {
    const { threshold, ...variant } = delayedThresholdAuditVariant({
      maturedCandidates,
      outcomesByKey,
      threshold: thresholdUsd,
      selectCandidate: (candidate, selectedThreshold) => (
        Number.isFinite(candidate.birthQuote.liquidityUsd)
          && candidate.birthQuote.liquidityUsd >= selectedThreshold
      ),
      rule,
      bootstrapSeedOffset: 0x300 + index,
    });
    return { thresholdUsd: threshold, ...variant };
  });
  return {
    type: "geckoterminal-new-pool-delayed-shadow-full-cohort-liquidity-audit",
    auditVersion: rule.version,
    familyDigest: digestValue({
      field: rule.field,
      operator: rule.operator,
      thresholdsUsd: rule.thresholdsUsd,
      unavailableLiquidityPolicy: rule.unavailableLiquidityPolicy,
      parentRuleVersion: rule.parentRuleVersion,
      horizon: rule.horizon,
      paperNotionalUsd: rule.paperNotionalUsd,
      baseRoundTripCostPct: rule.baseRoundTripCostPct,
      stressRoundTripCostPct: rule.stressRoundTripCostPct,
    }),
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    scorecardAsOf: scorecardAsOf?.toISOString() ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    horizon: rule.horizon,
    thresholdsUsd: [...rule.thresholdsUsd],
    baselineMaturedCandidates: maturedCandidates.length,
    featureAvailableCandidates,
    featureAvailabilityRate: roundRatio(
      featureAvailableCandidates,
      maturedCandidates.length,
    ),
    baselineValidCapacityOutcomes: maturedCandidates.filter(({ discovery, candidate }) => (
      outcomesByKey.has(`${discovery.id}:${candidate.pairAddress}`)
        && outcomesByKey.get(`${discovery.id}:${candidate.pairAddress}`)
    )).length,
    variants,
    retrospectiveScreeningCandidates: variants.filter((variant) => (
      variant.retrospectiveScreeningGate
    )).map((variant) => variant.thresholdUsd),
    familyCorrectionStatus: variants.some((variant) => (
      variant.retrospectiveScreeningGate
    )) ? "required-not-run" : "not-run-no-variant-cleared-prerequisite-screening",
    independentQuantValidationStatus: "not-run",
    nominationGate: false,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
    note: "This provider-free derivation audit freezes one six-threshold standalone family over the strictly future full delayed cohort. It changes the observation-only parent by adding only a minimum birth-liquidity paper-long selector; every other watched pool stays cash, unavailable liquidity stays cash, and selected invalid or missed labels score -100%. The unchanged $100 capacity model, 4%/12% costs, independent hourly frames, full-sample and chronological-half bootstrap, breadth, profit-factor, drawdown, winner-concentration, and leave-one-token-out gates must all pass before a threshold can become only a retrospective screening candidate. This family is separate from and does not merge or extend the rejected v4 low-cap liquidity family. Multiple-testing and independent quant validation remain separate and not run, so this audit can never register, promote, mutate, or trade a policy by itself.",
  };
}

export function buildGeckoTerminalNewPoolDelayedShadowFullCohortVolumeAudit(
  events,
  options = {},
) {
  const rule =
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_VOLUME_AUDIT_RULE;
  const {
    registration, scorecardAsOf, maturedCandidates, outcomesByKey,
  } = delayedFullCohortAuditDataset(events, options, rule);
  const featureAvailableCandidates = maturedCandidates.filter(({ candidate }) => (
    Number.isFinite(candidate.birthQuote.volumeH1Usd)
      && candidate.birthQuote.volumeH1Usd >= 0
  )).length;
  const variants = rule.thresholdsUsd.map((thresholdUsd, index) => {
    const { threshold, ...variant } = delayedThresholdAuditVariant({
      maturedCandidates,
      outcomesByKey,
      threshold: thresholdUsd,
      selectCandidate: (candidate, selectedThreshold) => (
        Number.isFinite(candidate.birthQuote.volumeH1Usd)
          && candidate.birthQuote.volumeH1Usd >= selectedThreshold
      ),
      rule,
      bootstrapSeedOffset: 0x400 + index,
    });
    return { thresholdUsd: threshold, ...variant };
  });
  return {
    type: "geckoterminal-new-pool-delayed-shadow-full-cohort-hourly-volume-audit",
    auditVersion: rule.version,
    familyDigest: digestValue({
      field: rule.field,
      operator: rule.operator,
      thresholdsUsd: rule.thresholdsUsd,
      unavailableVolumePolicy: rule.unavailableVolumePolicy,
      parentRuleVersion: rule.parentRuleVersion,
      horizon: rule.horizon,
      paperNotionalUsd: rule.paperNotionalUsd,
      baseRoundTripCostPct: rule.baseRoundTripCostPct,
      stressRoundTripCostPct: rule.stressRoundTripCostPct,
    }),
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    scorecardAsOf: scorecardAsOf?.toISOString() ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    horizon: rule.horizon,
    thresholdsUsd: [...rule.thresholdsUsd],
    baselineMaturedCandidates: maturedCandidates.length,
    featureAvailableCandidates,
    featureAvailabilityRate: roundRatio(
      featureAvailableCandidates,
      maturedCandidates.length,
    ),
    baselineValidCapacityOutcomes: maturedCandidates.filter(({ discovery, candidate }) => (
      outcomesByKey.has(`${discovery.id}:${candidate.pairAddress}`)
        && outcomesByKey.get(`${discovery.id}:${candidate.pairAddress}`)
    )).length,
    variants,
    retrospectiveScreeningCandidates: variants.filter((variant) => (
      variant.retrospectiveScreeningGate
    )).map((variant) => variant.thresholdUsd),
    familyCorrectionStatus: variants.some((variant) => (
      variant.retrospectiveScreeningGate
    )) ? "required-not-run" : "not-run-no-variant-cleared-prerequisite-screening",
    independentQuantValidationStatus: "not-run",
    nominationGate: false,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
    note: "This provider-free derivation audit freezes one six-threshold standalone family over the strictly future full delayed cohort. It changes the observation-only parent by adding only a minimum birth-time one-hour-volume paper-long selector; every other watched pool stays cash, unavailable volume stays cash, and selected invalid or missed labels score -100%. The unchanged $100 capacity model, 4%/12% costs, independent hourly frames, full-sample and chronological-half bootstrap, breadth, profit-factor, drawdown, winner-concentration, and leave-one-token-out gates must all pass before a threshold can become only a retrospective screening candidate. This family is separate from the rejected full-cohort liquidity and v4 low-cap families. Multiple-testing and independent quant validation remain separate and not run, so this audit can never register, promote, mutate, or trade a policy by itself.",
  };
}

export function buildGeckoTerminalNewPoolDelayedShadowFullCohortTurnoverAudit(
  events,
  options = {},
) {
  const rule =
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_AUDIT_RULE;
  const {
    registration, scorecardAsOf, maturedCandidates, outcomesByKey,
  } = delayedFullCohortAuditDataset(events, options, rule);
  const featureAvailableCandidates = maturedCandidates.filter(({ candidate }) => (
    Number.isFinite(candidate.birthQuote.fiveMinuteTurnover)
      && candidate.birthQuote.fiveMinuteTurnover >= 0
  )).length;
  const variants = rule.maximumTurnovers.map((maximumTurnover, index) => {
    const { threshold, ...variant } = delayedThresholdAuditVariant({
      maturedCandidates,
      outcomesByKey,
      threshold: maximumTurnover,
      selectCandidate: (candidate, selectedThreshold) => (
        Number.isFinite(candidate.birthQuote.fiveMinuteTurnover)
          && candidate.birthQuote.fiveMinuteTurnover <= selectedThreshold
      ),
      rule,
      bootstrapSeedOffset: 0x500 + index,
    });
    return { maximumTurnover: threshold, ...variant };
  });
  return {
    type: "geckoterminal-new-pool-delayed-shadow-full-cohort-five-minute-turnover-audit",
    auditVersion: rule.version,
    familyDigest: digestValue({
      field: rule.field,
      operator: rule.operator,
      maximumTurnovers: rule.maximumTurnovers,
      unavailableTurnoverPolicy: rule.unavailableTurnoverPolicy,
      parentRuleVersion: rule.parentRuleVersion,
      horizon: rule.horizon,
      paperNotionalUsd: rule.paperNotionalUsd,
      baseRoundTripCostPct: rule.baseRoundTripCostPct,
      stressRoundTripCostPct: rule.stressRoundTripCostPct,
    }),
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    scorecardAsOf: scorecardAsOf?.toISOString() ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    horizon: rule.horizon,
    maximumTurnovers: [...rule.maximumTurnovers],
    baselineMaturedCandidates: maturedCandidates.length,
    featureAvailableCandidates,
    featureAvailabilityRate: roundRatio(
      featureAvailableCandidates,
      maturedCandidates.length,
    ),
    baselineValidCapacityOutcomes: maturedCandidates.filter(({ discovery, candidate }) => (
      outcomesByKey.has(`${discovery.id}:${candidate.pairAddress}`)
        && outcomesByKey.get(`${discovery.id}:${candidate.pairAddress}`)
    )).length,
    variants,
    retrospectiveScreeningCandidates: variants.filter((variant) => (
      variant.retrospectiveScreeningGate
    )).map((variant) => variant.maximumTurnover),
    familyCorrectionStatus: variants.some((variant) => (
      variant.retrospectiveScreeningGate
    )) ? "required-not-run" : "not-run-no-variant-cleared-prerequisite-screening",
    independentQuantValidationStatus: "not-run",
    nominationGate: false,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
    note: "This provider-free derivation audit freezes one six-threshold standalone family over the strictly future full delayed cohort. It changes the observation-only parent by adding only a maximum birth-time five-minute-turnover paper-long selector; every other watched pool stays cash, unavailable turnover stays cash, and selected invalid or missed labels score -100%. The unchanged $100 capacity model, 4%/12% costs, independent hourly frames, full-sample and chronological-half bootstrap, breadth, profit-factor, drawdown, winner-concentration, and leave-one-token-out gates must all pass before a threshold can become only a retrospective screening candidate. This family is separate from the existing low-cap v9 forecast and the rejected full-cohort raw liquidity and volume audits. Multiple-testing and independent quant validation remain separate and not run, so this audit can never register, promote, mutate, or trade a policy by itself.",
  };
}

export function buildGeckoTerminalNewPoolDelayedShadowFullCohortTurnoverFloorAudit(
  events,
  options = {},
) {
  const rule =
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TURNOVER_FLOOR_AUDIT_RULE;
  const {
    registration, scorecardAsOf, maturedCandidates, outcomesByKey,
  } = delayedFullCohortAuditDataset(events, options, rule);
  const featureAvailableCandidates = maturedCandidates.filter(({ candidate }) => (
    Number.isFinite(candidate.birthQuote.fiveMinuteTurnover)
      && candidate.birthQuote.fiveMinuteTurnover >= 0
  )).length;
  const variants = rule.minimumTurnovers.map((minimumTurnover, index) => {
    const { threshold, ...variant } = delayedThresholdAuditVariant({
      maturedCandidates,
      outcomesByKey,
      threshold: minimumTurnover,
      selectCandidate: (candidate, selectedThreshold) => (
        Number.isFinite(candidate.birthQuote.fiveMinuteTurnover)
          && candidate.birthQuote.fiveMinuteTurnover >= selectedThreshold
      ),
      rule,
      bootstrapSeedOffset: 0x600 + index,
    });
    return { minimumTurnover: threshold, ...variant };
  });
  const retrospectiveScreeningCandidates = variants.filter((variant) => (
    variant.retrospectiveScreeningGate
  )).map((variant) => variant.minimumTurnover);
  return {
    type: "geckoterminal-new-pool-delayed-shadow-full-cohort-five-minute-turnover-floor-audit",
    auditVersion: rule.version,
    familyDigest: digestValue({
      field: rule.field,
      operator: rule.operator,
      minimumTurnovers: rule.minimumTurnovers,
      derivationStatus: rule.derivationStatus,
      relatedPriorAuditVersions: rule.relatedPriorAuditVersions,
      sequentialRelatedFamilyCountIncludingThis:
        rule.sequentialRelatedFamilyCountIncludingThis,
      sequentialRelatedVariantCountIncludingThis:
        rule.sequentialRelatedVariantCountIncludingThis,
      unavailableTurnoverPolicy: rule.unavailableTurnoverPolicy,
      parentRuleVersion: rule.parentRuleVersion,
      horizon: rule.horizon,
      paperNotionalUsd: rule.paperNotionalUsd,
      baseRoundTripCostPct: rule.baseRoundTripCostPct,
      stressRoundTripCostPct: rule.stressRoundTripCostPct,
    }),
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    scorecardAsOf: scorecardAsOf?.toISOString() ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    horizon: rule.horizon,
    minimumTurnovers: [...rule.minimumTurnovers],
    derivationStatus: rule.derivationStatus,
    relatedPriorAuditVersions: [...rule.relatedPriorAuditVersions],
    sequentialRelatedFamilyCountIncludingThis:
      rule.sequentialRelatedFamilyCountIncludingThis,
    sequentialRelatedVariantCountIncludingThis:
      rule.sequentialRelatedVariantCountIncludingThis,
    sequentialFamilyCorrectionRequired: rule.sequentialFamilyCorrectionRequired,
    baselineMaturedCandidates: maturedCandidates.length,
    featureAvailableCandidates,
    featureAvailabilityRate: roundRatio(
      featureAvailableCandidates,
      maturedCandidates.length,
    ),
    baselineValidCapacityOutcomes: maturedCandidates.filter(({ discovery, candidate }) => (
      outcomesByKey.has(`${discovery.id}:${candidate.pairAddress}`)
        && outcomesByKey.get(`${discovery.id}:${candidate.pairAddress}`)
    )).length,
    variants,
    retrospectiveScreeningCandidates,
    familyCorrectionStatus: retrospectiveScreeningCandidates.length
      ? "required-not-run-across-four-related-families-and-24-variants"
      : "not-run-no-variant-cleared-prerequisite-screening",
    independentQuantValidationStatus: "not-run",
    nominationGate: false,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
    note: "This provider-free derivation audit freezes one six-threshold complementary family over the strictly future full delayed cohort after the related liquidity, raw-volume, and turnover-cap families failed. It changes the observation-only parent by adding only a minimum birth-time five-minute-turnover paper-long selector; every other watched pool stays cash, unavailable turnover stays cash, and selected invalid or missed labels score -100%. The unchanged $100 capacity model, 4%/12% costs, independent hourly frames, full-sample and chronological-half bootstrap, breadth, profit-factor, drawdown, winner-concentration, and leave-one-token-out gates must all pass before a threshold can become only a retrospective screening candidate. Any survivor must then correct across all four related families and 24 declared variants before independent validation; this audit can never register, promote, mutate, or trade a policy by itself.",
  };
}

export function buildGeckoTerminalNewPoolDelayedShadowFullCohortMarketCapAudit(
  events,
  options = {},
) {
  const rule =
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_MARKET_CAP_AUDIT_RULE;
  const {
    registration, scorecardAsOf, maturedCandidates, outcomesByKey,
  } = delayedFullCohortAuditDataset(events, options, rule);
  const featureAvailableCandidates = maturedCandidates.filter(({ candidate }) => (
    Number.isFinite(candidate.birthQuote.marketCapUsd)
      && candidate.birthQuote.marketCapUsd > 0
  )).length;
  const variants = rule.thresholdsUsd.map((thresholdUsd, index) => {
    const { threshold, ...variant } = delayedThresholdAuditVariant({
      maturedCandidates,
      outcomesByKey,
      threshold: thresholdUsd,
      selectCandidate: (candidate, selectedThreshold) => (
        Number.isFinite(candidate.birthQuote.marketCapUsd)
          && candidate.birthQuote.marketCapUsd >= selectedThreshold
      ),
      rule,
      bootstrapSeedOffset: 0x700 + index,
    });
    return { thresholdUsd: threshold, ...variant };
  });
  const retrospectiveScreeningCandidates = variants.filter((variant) => (
    variant.retrospectiveScreeningGate
  )).map((variant) => variant.thresholdUsd);
  return {
    type: "geckoterminal-new-pool-delayed-shadow-full-cohort-market-cap-floor-audit",
    auditVersion: rule.version,
    familyDigest: digestValue({
      field: rule.field,
      fieldSource: rule.fieldSource,
      operator: rule.operator,
      thresholdsUsd: rule.thresholdsUsd,
      derivationStatus: rule.derivationStatus,
      relatedPriorAuditVersions: rule.relatedPriorAuditVersions,
      sequentialRelatedFamilyCountIncludingThis:
        rule.sequentialRelatedFamilyCountIncludingThis,
      sequentialRelatedVariantCountIncludingThis:
        rule.sequentialRelatedVariantCountIncludingThis,
      unavailableMarketCapPolicy: rule.unavailableMarketCapPolicy,
      parentRuleVersion: rule.parentRuleVersion,
      horizon: rule.horizon,
      paperNotionalUsd: rule.paperNotionalUsd,
      baseRoundTripCostPct: rule.baseRoundTripCostPct,
      stressRoundTripCostPct: rule.stressRoundTripCostPct,
    }),
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    scorecardAsOf: scorecardAsOf?.toISOString() ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    horizon: rule.horizon,
    fieldSource: rule.fieldSource,
    thresholdsUsd: [...rule.thresholdsUsd],
    derivationStatus: rule.derivationStatus,
    relatedPriorAuditVersions: [...rule.relatedPriorAuditVersions],
    sequentialRelatedFamilyCountIncludingThis:
      rule.sequentialRelatedFamilyCountIncludingThis,
    sequentialRelatedVariantCountIncludingThis:
      rule.sequentialRelatedVariantCountIncludingThis,
    sequentialFamilyCorrectionRequired: rule.sequentialFamilyCorrectionRequired,
    baselineMaturedCandidates: maturedCandidates.length,
    featureAvailableCandidates,
    featureAvailabilityRate: roundRatio(
      featureAvailableCandidates,
      maturedCandidates.length,
    ),
    baselineValidCapacityOutcomes: maturedCandidates.filter(({ discovery, candidate }) => (
      outcomesByKey.has(`${discovery.id}:${candidate.pairAddress}`)
        && outcomesByKey.get(`${discovery.id}:${candidate.pairAddress}`)
    )).length,
    variants,
    retrospectiveScreeningCandidates,
    familyCorrectionStatus: retrospectiveScreeningCandidates.length
      ? "required-not-run-across-five-related-families-and-30-variants"
      : "not-run-no-variant-cleared-prerequisite-screening",
    independentQuantValidationStatus: "not-run",
    nominationGate: false,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
    note: "This provider-free derivation audit freezes one six-threshold maturity family over the strictly future full delayed cohort after four related one-factor families failed. It changes the observation-only parent by adding only a minimum birth-time provider market-cap-or-FDV paper-long selector; every other watched pool stays cash, unavailable market cap stays cash, and selected invalid or missed labels score -100%. The unchanged $100 capacity model, 4%/12% costs, independent hourly frames, full-sample and chronological-half bootstrap, breadth, profit-factor, drawdown, winner-concentration, and leave-one-token-out gates must all pass before a threshold can become only a retrospective screening candidate. Any survivor must then correct across all five related families and 30 declared variants before independent validation; this audit can never register, promote, mutate, or trade a policy by itself.",
  };
}

export function buildGeckoTerminalNewPoolDelayedShadowFullCohortWilsonBuyShareAudit(
  events,
  options = {},
) {
  const rule =
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_WILSON_BUY_SHARE_AUDIT_RULE;
  const {
    registration, scorecardAsOf, maturedCandidates, outcomesByKey,
  } = delayedFullCohortAuditDataset(events, options, rule);
  const featureAvailableCandidates = maturedCandidates.filter(({ candidate }) => (
    Number.isFinite(
      geckoTerminalDelayedFiveMinuteBuyShareWilsonLowerBound(
        candidate,
        rule.zScore,
      ),
    )
  )).length;
  const variants = rule.minimumWilsonLowerBounds.map((minimumWilsonLowerBound, index) => {
    const { threshold, ...variant } = delayedThresholdAuditVariant({
      maturedCandidates,
      outcomesByKey,
      threshold: minimumWilsonLowerBound,
      selectCandidate: (candidate, selectedThreshold) => {
        const lowerBound = geckoTerminalDelayedFiveMinuteBuyShareWilsonLowerBound(
          candidate,
          rule.zScore,
        );
        return Number.isFinite(lowerBound) && lowerBound >= selectedThreshold;
      },
      rule,
      bootstrapSeedOffset: 0x800 + index,
    });
    return { minimumWilsonLowerBound: threshold, ...variant };
  });
  const retrospectiveScreeningCandidates = variants.filter((variant) => (
    variant.retrospectiveScreeningGate
  )).map((variant) => variant.minimumWilsonLowerBound);
  return {
    type:
      "geckoterminal-new-pool-delayed-shadow-full-cohort-five-minute-buy-share-wilson-lower-audit",
    auditVersion: rule.version,
    familyDigest: digestValue({
      field: rule.field,
      operator: rule.operator,
      confidenceLevel: rule.confidenceLevel,
      zScore: rule.zScore,
      minimumWilsonLowerBounds: rule.minimumWilsonLowerBounds,
      derivationStatus: rule.derivationStatus,
      relatedPriorAuditVersions: rule.relatedPriorAuditVersions,
      sequentialRelatedFamilyCountIncludingThis:
        rule.sequentialRelatedFamilyCountIncludingThis,
      sequentialRelatedVariantCountIncludingThis:
        rule.sequentialRelatedVariantCountIncludingThis,
      zeroOrUnavailableTransactionPolicy:
        rule.zeroOrUnavailableTransactionPolicy,
      parentRuleVersion: rule.parentRuleVersion,
      horizon: rule.horizon,
      paperNotionalUsd: rule.paperNotionalUsd,
      baseRoundTripCostPct: rule.baseRoundTripCostPct,
      stressRoundTripCostPct: rule.stressRoundTripCostPct,
    }),
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    scorecardAsOf: scorecardAsOf?.toISOString() ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    horizon: rule.horizon,
    confidenceLevel: rule.confidenceLevel,
    zScore: rule.zScore,
    minimumWilsonLowerBounds: [...rule.minimumWilsonLowerBounds],
    derivationStatus: rule.derivationStatus,
    relatedPriorAuditVersions: [...rule.relatedPriorAuditVersions],
    sequentialRelatedFamilyCountIncludingThis:
      rule.sequentialRelatedFamilyCountIncludingThis,
    sequentialRelatedVariantCountIncludingThis:
      rule.sequentialRelatedVariantCountIncludingThis,
    sequentialFamilyCorrectionRequired: rule.sequentialFamilyCorrectionRequired,
    baselineMaturedCandidates: maturedCandidates.length,
    featureAvailableCandidates,
    featureAvailabilityRate: roundRatio(
      featureAvailableCandidates,
      maturedCandidates.length,
    ),
    baselineValidCapacityOutcomes: maturedCandidates.filter(({ discovery, candidate }) => (
      outcomesByKey.has(`${discovery.id}:${candidate.pairAddress}`)
        && outcomesByKey.get(`${discovery.id}:${candidate.pairAddress}`)
    )).length,
    variants,
    retrospectiveScreeningCandidates,
    familyCorrectionStatus: retrospectiveScreeningCandidates.length
      ? "required-not-run-across-six-related-families-and-36-variants"
      : "not-run-no-variant-cleared-prerequisite-screening",
    independentQuantValidationStatus: "not-run",
    nominationGate: false,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
    note: "This provider-free derivation audit freezes one six-threshold directional order-flow family over the strictly future full delayed cohort after five related one-factor families failed. It changes the observation-only parent by adding only a minimum 95% Wilson lower confidence bound for the birth-time five-minute buy share. The bound penalizes sparse transaction counts within the single declared feature, so one buy and zero sells is not treated as strong buy dominance. Every other watched pool stays cash, zero or unavailable transactions stay cash, selected invalid or missed labels score -100%, and unselected labels score zero. The unchanged $100 capacity model, 4%/12% costs, cash-inclusive independent hourly frames, full-sample and chronological-half bootstrap, breadth, profit-factor, drawdown, winner-concentration, and leave-one-token-out gates must all pass before a threshold can become only a retrospective screening candidate. Any survivor must then correct across all six related families and 36 declared variants before independent validation; this audit can never register, promote, mutate, or trade a policy by itself.",
  };
}

export function buildGeckoTerminalNewPoolDelayedShadowFullCohortTransactionCountAudit(
  events,
  options = {},
) {
  const rule =
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_TRANSACTION_COUNT_AUDIT_RULE;
  const {
    registration, scorecardAsOf, maturedCandidates, outcomesByKey,
  } = delayedFullCohortAuditDataset(events, options, rule);
  const featureAvailableCandidates = maturedCandidates.filter(({ candidate }) => (
    Number.isFinite(delayedFiveMinuteTransactionCount(candidate))
  )).length;
  const variants = rule.minimumTransactionCounts.map((minimumTransactionCount, index) => {
    const { threshold, ...variant } = delayedThresholdAuditVariant({
      maturedCandidates,
      outcomesByKey,
      threshold: minimumTransactionCount,
      selectCandidate: (candidate, selectedThreshold) => (
        delayedFiveMinuteTransactionCount(candidate) >= selectedThreshold
      ),
      rule,
      bootstrapSeedOffset: 0x900 + index,
    });
    return { minimumTransactionCount: threshold, ...variant };
  });
  const retrospectiveScreeningCandidates = variants.filter((variant) => (
    variant.retrospectiveScreeningGate
  )).map((variant) => variant.minimumTransactionCount);
  return {
    type:
      "geckoterminal-new-pool-delayed-shadow-full-cohort-five-minute-total-transactions-floor-audit",
    auditVersion: rule.version,
    familyDigest: digestValue({
      field: rule.field,
      operator: rule.operator,
      minimumTransactionCounts: rule.minimumTransactionCounts,
      derivationStatus: rule.derivationStatus,
      relatedPriorAuditVersions: rule.relatedPriorAuditVersions,
      sequentialRelatedFamilyCountIncludingThis:
        rule.sequentialRelatedFamilyCountIncludingThis,
      sequentialRelatedVariantCountIncludingThis:
        rule.sequentialRelatedVariantCountIncludingThis,
      unavailableTransactionPolicy: rule.unavailableTransactionPolicy,
      parentRuleVersion: rule.parentRuleVersion,
      horizon: rule.horizon,
      paperNotionalUsd: rule.paperNotionalUsd,
      baseRoundTripCostPct: rule.baseRoundTripCostPct,
      stressRoundTripCostPct: rule.stressRoundTripCostPct,
    }),
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    scorecardAsOf: scorecardAsOf?.toISOString() ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    horizon: rule.horizon,
    minimumTransactionCounts: [...rule.minimumTransactionCounts],
    derivationStatus: rule.derivationStatus,
    relatedPriorAuditVersions: [...rule.relatedPriorAuditVersions],
    sequentialRelatedFamilyCountIncludingThis:
      rule.sequentialRelatedFamilyCountIncludingThis,
    sequentialRelatedVariantCountIncludingThis:
      rule.sequentialRelatedVariantCountIncludingThis,
    sequentialFamilyCorrectionRequired: rule.sequentialFamilyCorrectionRequired,
    baselineMaturedCandidates: maturedCandidates.length,
    featureAvailableCandidates,
    featureAvailabilityRate: roundRatio(
      featureAvailableCandidates,
      maturedCandidates.length,
    ),
    baselineValidCapacityOutcomes: maturedCandidates.filter(({ discovery, candidate }) => (
      outcomesByKey.has(`${discovery.id}:${candidate.pairAddress}`)
        && outcomesByKey.get(`${discovery.id}:${candidate.pairAddress}`)
    )).length,
    variants,
    retrospectiveScreeningCandidates,
    familyCorrectionStatus: retrospectiveScreeningCandidates.length
      ? "required-not-run-across-seven-related-families-and-42-variants"
      : "not-run-no-variant-cleared-prerequisite-screening",
    independentQuantValidationStatus: "not-run",
    nominationGate: false,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
    note: "This provider-free derivation audit freezes one six-threshold participation family over the strictly future full delayed cohort after six related one-factor families failed. It transfers the existing total-transaction feature from the rejected v4-only audit and changes the observation-only full-cohort parent by adding only a minimum birth-time five-minute total-transaction paper-long selector. Every other watched pool stays cash, unavailable counts stay cash, selected invalid or missed labels score -100%, and unselected labels score zero. The unchanged $100 capacity model, 4%/12% costs, cash-inclusive independent hourly frames, full-sample and chronological-half bootstrap, breadth, profit-factor, drawdown, winner-concentration, and leave-one-token-out gates must all pass before a threshold can become only a retrospective screening candidate. Any survivor must then correct across all seven related families and 42 declared variants before independent validation; this audit can never register, promote, mutate, or trade a policy by itself.",
  };
}

export function buildGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
  events,
  options = {},
) {
  const rule =
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_AUDIT_REGISTRY_RULE;
  const { outcomeKeyDiagnostics: registryOutcomeKeyDiagnostics } =
    delayedFullCohortAuditDataset(
      events,
      options,
      GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_LIQUIDITY_AUDIT_RULE,
    );
  const reports = [
    buildGeckoTerminalNewPoolDelayedShadowFullCohortLiquidityAudit(events, options),
    buildGeckoTerminalNewPoolDelayedShadowFullCohortVolumeAudit(events, options),
    buildGeckoTerminalNewPoolDelayedShadowFullCohortTurnoverAudit(events, options),
    buildGeckoTerminalNewPoolDelayedShadowFullCohortTurnoverFloorAudit(
      events,
      options,
    ),
    buildGeckoTerminalNewPoolDelayedShadowFullCohortMarketCapAudit(events, options),
    buildGeckoTerminalNewPoolDelayedShadowFullCohortWilsonBuyShareAudit(
      events,
      options,
    ),
    buildGeckoTerminalNewPoolDelayedShadowFullCohortTransactionCountAudit(
      events,
      options,
    ),
  ];
  const lineageVerification =
    validateGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(reports);
  const families = reports.map((report) => ({
    auditVersion: report.auditVersion,
    familyDigest: report.familyDigest,
    variantCount: report.variants.length,
    screeningCandidates: [...report.retrospectiveScreeningCandidates],
    bestStressReturnPct: nullableRound(Math.max(...report.variants.map((variant) => (
      variant.averageStressReturnPct
    )).filter(Number.isFinite))),
    worstStressReturnPct: nullableRound(Math.min(...report.variants.map((variant) => (
      variant.averageStressReturnPct
    )).filter(Number.isFinite))),
    familyCorrectionStatus: report.familyCorrectionStatus,
    nominationGate: report.nominationGate,
  }));
  const screeningCandidateCount = families.reduce((total, family) => (
    total + family.screeningCandidates.length
  ), 0);
  const baselineMaturedCandidates = reports[0]?.baselineMaturedCandidates ?? 0;
  const baselineValidCapacityOutcomes =
    reports[0]?.baselineValidCapacityOutcomes ?? 0;
  const validCapacityOutcomeCoverageRate = roundRatio(
    baselineValidCapacityOutcomes,
    baselineMaturedCandidates,
  );
  const validCapacityOutcomeCoverageGate = Number.isFinite(
    validCapacityOutcomeCoverageRate,
  ) && validCapacityOutcomeCoverageRate
    >= MINIMUM_VALID_CAPACITY_OUTCOME_COVERAGE_RATE;
  const familyExpansionPrerequisiteGate = lineageVerification.ok
    && validCapacityOutcomeCoverageGate
    && registryOutcomeKeyDiagnostics.outcomeKeyReconciliationGate
    && screeningCandidateCount === 0;
  return {
    type: "geckoterminal-new-pool-delayed-shadow-full-cohort-audit-registry",
    auditVersion: rule.version,
    registryDigest: digestValue({
      ruleVersion: rule.version,
      families: families.map((family) => ({
        auditVersion: family.auditVersion,
        familyDigest: family.familyDigest,
        variantCount: family.variantCount,
      })),
      registrationId: reports[0]?.registrationId ?? null,
      scorecardAsOf: reports[0]?.scorecardAsOf ?? null,
    }),
    parentRuleVersion: rule.parentRuleVersion,
    registrationId: reports[0]?.registrationId ?? null,
    registeredAt: reports[0]?.registeredAt ?? null,
    scorecardAsOf: reports[0]?.scorecardAsOf ?? null,
    totalFamilyCount: rule.totalFamilyCount,
    totalVariantCount: rule.totalVariantCount,
    correctionScope: rule.correctionScope,
    familyExpansionPolicy: rule.familyExpansionPolicy,
    maximumAdditionalFamiliesPerReviewedExpansion:
      rule.maximumAdditionalFamiliesPerReviewedExpansion,
    baselineMaturedCandidates,
    baselineValidCapacityOutcomes,
    validCapacityOutcomeCoverageRate,
    minimumValidCapacityOutcomeCoverageRate:
      MINIMUM_VALID_CAPACITY_OUTCOME_COVERAGE_RATE,
    validCapacityOutcomeCoverageGate,
    ...registryOutcomeKeyDiagnostics,
    invalidCapacityOutcomes: Math.max(
      0,
      baselineMaturedCandidates - baselineValidCapacityOutcomes,
    ),
    minimumAdditionalPerfectValidOutcomesToReachCoverageGate:
      minimumAdditionalPerfectValidOutcomesToReachCoverageGate(
        baselineValidCapacityOutcomes,
        baselineMaturedCandidates,
      ),
    families,
    lineageVerification,
    lineageIntegrityGate: lineageVerification.ok,
    evidenceReadinessGate:
      lineageVerification.ok
        && validCapacityOutcomeCoverageGate
        && registryOutcomeKeyDiagnostics.outcomeKeyReconciliationGate,
    screeningCandidateCount,
    allFamiliesPrerequisiteRejected: screeningCandidateCount === 0,
    familyExpansionPrerequisiteGate,
    familyExpansionStatus: !lineageVerification.ok
      ? "blocked-failed-trial-lineage-integrity"
      : (!registryOutcomeKeyDiagnostics.outcomeKeyReconciliationGate
        ? "blocked-unreconciled-delayed-outcome-keys"
        : (!validCapacityOutcomeCoverageGate
          ? "blocked-insufficient-valid-capacity-outcome-coverage"
          : (screeningCandidateCount > 0
            ? "blocked-existing-family-requires-correction-and-independent-validation"
            : "eligible-only-for-separately-declared-one-change-family"))),
    familyExpansionAuthority: false,
    familyCorrectionStatus: !lineageVerification.ok
      ? "blocked-failed-trial-lineage-integrity"
      : (!registryOutcomeKeyDiagnostics.outcomeKeyReconciliationGate
        ? "blocked-unreconciled-delayed-outcome-keys"
        : (!validCapacityOutcomeCoverageGate
          ? "blocked-insufficient-valid-capacity-outcome-coverage"
          : (screeningCandidateCount
            ? "required-not-run-across-all-registered-families-and-variants"
            : "not-run-no-variant-cleared-prerequisite-screening"))),
    independentQuantValidationStatus: "not-run",
    nominationGate: false,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
    note: "This deterministic provider-free registry recomputes every declared full-cohort one-factor audit on one verified ledger snapshot and fails closed if a family, variant, digest, cohort identity, as-of time, sequential ancestor, semantic delayed-outcome key, 95% valid-capacity-outcome coverage floor, or zero-authority invariant is missing, duplicated, or inconsistent. It makes the multiple-testing denominator cumulative instead of caller-selected. A new retrospective family is prerequisite-eligible only when lineage and outcome keys reconcile, valid-capacity coverage reaches 95%, and no existing family awaits correction; even then, only one separately declared one-change family may be reviewed and this registry grants no expansion authority. Any future prerequisite survivor still requires correction across the complete registry and independent quantitative validation before a strictly future registration could be considered.",
  };
}

export function validateGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
  reports,
) {
  const rule =
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_AUDIT_REGISTRY_RULE;
  const errors = [];
  const normalizedReports = Array.isArray(reports) ? reports : [];
  if (normalizedReports.length !== rule.totalFamilyCount) {
    errors.push(`expected-${rule.totalFamilyCount}-families`);
  }
  const first = normalizedReports[0] ?? null;
  for (const [index, descriptor] of rule.families.entries()) {
    const report = normalizedReports[index];
    if (!report) {
      errors.push(`missing-family-${index + 1}:${descriptor.ruleVersion}`);
      continue;
    }
    if (report.auditVersion !== descriptor.ruleVersion) {
      errors.push(`family-order-or-version-mismatch-${index + 1}`);
    }
    if (report.variants?.length !== descriptor.variantCount) {
      errors.push(`family-variant-count-mismatch:${descriptor.ruleVersion}`);
    }
    if (typeof report.familyDigest !== "string" || !report.familyDigest) {
      errors.push(`family-digest-missing:${descriptor.ruleVersion}`);
    }
    if (report.parentRuleVersion !== rule.parentRuleVersion
      || report.registrationId !== first?.registrationId
      || report.registeredAt !== first?.registeredAt
      || report.scorecardAsOf !== first?.scorecardAsOf
      || report.baselineMaturedCandidates !== first?.baselineMaturedCandidates
      || report.baselineValidCapacityOutcomes
        !== first?.baselineValidCapacityOutcomes) {
      errors.push(`family-cohort-identity-mismatch:${descriptor.ruleVersion}`);
    }
    if (report.nominationGate !== false
      || report.mutationAllowed !== false
      || report.decisionAuthority !== false
      || report.promotionAuthority !== false
      || report.tradingAuthority !== false) {
      errors.push(`family-authority-mismatch:${descriptor.ruleVersion}`);
    }
    if (index >= 3) {
      const expectedPriorVersions = rule.families.slice(0, index).map((family) => (
        family.ruleVersion
      ));
      const expectedPriorVariantCount = rule.families.slice(0, index + 1).reduce(
        (total, family) => total + family.variantCount,
        0,
      );
      if (JSON.stringify(report.relatedPriorAuditVersions)
        !== JSON.stringify(expectedPriorVersions)
        || report.sequentialRelatedFamilyCountIncludingThis !== index + 1
        || report.sequentialRelatedVariantCountIncludingThis
          !== expectedPriorVariantCount
        || report.sequentialFamilyCorrectionRequired !== true) {
        errors.push(`family-sequential-lineage-mismatch:${descriptor.ruleVersion}`);
      }
    }
  }
  const digests = normalizedReports.map((report) => report?.familyDigest)
    .filter((digest) => typeof digest === "string" && digest);
  if (new Set(digests).size !== rule.totalFamilyCount) {
    errors.push("family-digests-not-complete-and-unique");
  }
  return { ok: errors.length === 0, errors };
}

export function buildGeckoTerminalNewPoolDelayedShadowBuyShareAudit(
  events,
  options = {},
) {
  const rule = GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_BUY_SHARE_AUDIT_RULE;
  const {
    registration, scorecardAsOf, maturedCandidates, outcomesByKey,
  } = delayedV4AuditDataset(events, options, rule);
  const featureAvailableCandidates = maturedCandidates.filter(({ candidate }) => (
    Number.isFinite(delayedFiveMinuteBuyShare(candidate))
  )).length;
  const variants = rule.minimumBuyShares.map((minimumBuyShare, index) => {
    const { threshold, ...variant } = delayedThresholdAuditVariant({
      maturedCandidates,
      outcomesByKey,
      threshold: minimumBuyShare,
      selectCandidate: (candidate, selectedThreshold) => (
        delayedFiveMinuteBuyShare(candidate) >= selectedThreshold
      ),
      rule,
      bootstrapSeedOffset: 0x100 + index,
    });
    return { minimumBuyShare: threshold, ...variant };
  });
  return {
    type: "geckoterminal-new-pool-delayed-shadow-buy-share-audit",
    auditVersion: rule.version,
    familyDigest: digestValue({
      field: rule.field,
      operator: rule.operator,
      minimumBuyShares: rule.minimumBuyShares,
      zeroOrUnavailableTransactionPolicy: rule.zeroOrUnavailableTransactionPolicy,
      parentRuleVersion: rule.parentRuleVersion,
      horizon: rule.horizon,
      paperNotionalUsd: rule.paperNotionalUsd,
      baseRoundTripCostPct: rule.baseRoundTripCostPct,
      stressRoundTripCostPct: rule.stressRoundTripCostPct,
    }),
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    scorecardAsOf: scorecardAsOf?.toISOString() ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    horizon: rule.horizon,
    minimumBuyShares: [...rule.minimumBuyShares],
    baselineMaturedCandidates: maturedCandidates.length,
    featureAvailableCandidates,
    featureAvailabilityRate: roundRatio(
      featureAvailableCandidates,
      maturedCandidates.length,
    ),
    baselineValidCapacityOutcomes: maturedCandidates.filter(({ discovery, candidate }) => (
      outcomesByKey.has(`${discovery.id}:${candidate.pairAddress}`)
        && outcomesByKey.get(`${discovery.id}:${candidate.pairAddress}`)
    )).length,
    variants,
    retrospectiveScreeningCandidates: variants.filter((variant) => (
      variant.retrospectiveScreeningGate
    )).map((variant) => variant.minimumBuyShare),
    familyCorrectionStatus: variants.some((variant) => (
      variant.retrospectiveScreeningGate
    )) ? "required-not-run" : "not-run-no-variant-cleared-prerequisite-screening",
    independentQuantValidationStatus: "not-run",
    nominationGate: false,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
    note: "This provider-free derivation audit freezes one six-threshold family that changes only the existing v4 parent's decision-time five-minute transaction buy-share minimum. Zero-transaction or unavailable counts stay paper cash, every matured otherwise-v4 candidate remains in cash-inclusive independent hourly frames, missing selected labels score -100%, and unselected candidates score zero. Full-sample and chronological-half bootstrap, stress, breadth, profit-factor, drawdown, winner-concentration, and leave-one-token-out gates must all pass before a threshold can become only a retrospective screening candidate. Multiple-testing and independent quant validation remain separate and not run, so this audit can never register, promote, mutate, or trade a policy by itself.",
  };
}

export function buildGeckoTerminalNewPoolDelayedShadowTransactionCountAudit(
  events,
  options = {},
) {
  const rule = GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_TRANSACTION_COUNT_AUDIT_RULE;
  const {
    registration, scorecardAsOf, maturedCandidates, outcomesByKey,
  } = delayedV4AuditDataset(events, options, rule);
  const featureAvailableCandidates = maturedCandidates.filter(({ candidate }) => (
    Number.isFinite(delayedFiveMinuteTransactionCount(candidate))
  )).length;
  const variants = rule.minimumTransactionCounts.map((minimumTransactionCount, index) => {
    const { threshold, ...variant } = delayedThresholdAuditVariant({
      maturedCandidates,
      outcomesByKey,
      threshold: minimumTransactionCount,
      selectCandidate: (candidate, selectedThreshold) => (
        delayedFiveMinuteTransactionCount(candidate) >= selectedThreshold
      ),
      rule,
      bootstrapSeedOffset: 0x200 + index,
    });
    return { minimumTransactionCount: threshold, ...variant };
  });
  return {
    type: "geckoterminal-new-pool-delayed-shadow-transaction-count-audit",
    auditVersion: rule.version,
    familyDigest: digestValue({
      field: rule.field,
      operator: rule.operator,
      minimumTransactionCounts: rule.minimumTransactionCounts,
      unavailableTransactionPolicy: rule.unavailableTransactionPolicy,
      parentRuleVersion: rule.parentRuleVersion,
      horizon: rule.horizon,
      paperNotionalUsd: rule.paperNotionalUsd,
      baseRoundTripCostPct: rule.baseRoundTripCostPct,
      stressRoundTripCostPct: rule.stressRoundTripCostPct,
    }),
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    scorecardAsOf: scorecardAsOf?.toISOString() ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    horizon: rule.horizon,
    minimumTransactionCounts: [...rule.minimumTransactionCounts],
    baselineMaturedCandidates: maturedCandidates.length,
    featureAvailableCandidates,
    featureAvailabilityRate: roundRatio(
      featureAvailableCandidates,
      maturedCandidates.length,
    ),
    baselineValidCapacityOutcomes: maturedCandidates.filter(({ discovery, candidate }) => (
      outcomesByKey.has(`${discovery.id}:${candidate.pairAddress}`)
        && outcomesByKey.get(`${discovery.id}:${candidate.pairAddress}`)
    )).length,
    variants,
    retrospectiveScreeningCandidates: variants.filter((variant) => (
      variant.retrospectiveScreeningGate
    )).map((variant) => variant.minimumTransactionCount),
    familyCorrectionStatus: variants.some((variant) => (
      variant.retrospectiveScreeningGate
    )) ? "required-not-run" : "not-run-no-variant-cleared-prerequisite-screening",
    independentQuantValidationStatus: "not-run",
    nominationGate: false,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
    note: "This provider-free derivation audit freezes one six-threshold family that changes only the existing v4 parent's decision-time five-minute total-transaction minimum. Unavailable counts stay paper cash, every matured otherwise-v4 candidate remains in cash-inclusive independent hourly frames, missing selected labels score -100%, and unselected candidates score zero. Full-sample and chronological-half bootstrap, stress, breadth, profit-factor, drawdown, winner-concentration, and leave-one-token-out gates must all pass before a threshold can become only a retrospective screening candidate. Multiple-testing and independent quant validation remain separate and not run, so this audit can never register, promote, mutate, or trade a policy by itself.",
  };
}

function delayedV4AuditDataset(events, options, rule) {
  return delayedAuditDataset(
    events,
    options,
    rule,
    delayedV4LiquidityAuditCandidate,
  );
}

function delayedFullCohortAuditDataset(events, options, rule) {
  return delayedAuditDataset(
    events,
    options,
    rule,
    delayedFullCohortAuditCandidate,
  );
}

function delayedAuditDataset(events, options, rule, includeCandidate) {
  const scorecardAsOf = options.asOf === undefined
    ? latestLedgerOccurrenceAt(events)
    : validDate(options.asOf);
  const registration = events.find((event) => (
    matchesRegistration(event)
      && timestampAtOrBefore(event.registeredAt, scorecardAsOf)
  )) ?? null;
  const discoveries = new Map(events.filter((event) => (
    event.type === "geckoterminal-new-pool-discovery"
      && Date.parse(event.observedAt) > Date.parse(registration?.registeredAt ?? "")
      && timestampAtOrBefore(event.observedAt, scorecardAsOf)
  )).map((event) => [event.id, event]));
  const outcomeEvents = events.filter((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
      && event.registrationId === registration?.id
      && event.horizon === rule.horizon
      && discoveries.has(event.discoveryEventId)
      && timestampAtOrBefore(event.observedAt, scorecardAsOf)
  ));
  const maturedCandidates = scorecardAsOf && registration
    ? [...discoveries.values()].flatMap((discovery) => (
      Date.parse(discovery.observedAt) + HORIZONS[rule.horizon] <= scorecardAsOf.getTime()
        ? (discovery.candidates ?? []).filter(includeCandidate)
          .map((candidate) => ({ discovery, candidate }))
        : []
    ))
    : [];
  const expectedOutcomeKeys = new Set(maturedCandidates.map(({
    discovery,
    candidate,
  }) => `${discovery.id}:${candidate.pairAddress}`));
  const outcomeKeyDiagnostics = delayedOutcomeKeyDiagnostics(outcomeEvents, {
    expectedKeys: expectedOutcomeKeys,
  });
  const reconciledOutcomeEvents = outcomeEvents.filter((outcome) => (
    expectedOutcomeKeys.has(delayedOutcomeKey(outcome))
  ));
  const outcomesByKey = new Map(reconciledOutcomeEvents.map((outcome) => [
    `${outcome.discoveryEventId}:${outcome.pairAddress}`,
    delayedScoreRow(outcome, discoveries.get(outcome.discoveryEventId)),
  ]));
  return {
    registration,
    scorecardAsOf,
    maturedCandidates,
    outcomesByKey,
    outcomeKeyDiagnostics,
  };
}

function delayedThresholdAuditVariant({
  maturedCandidates,
  outcomesByKey,
  threshold,
  selectCandidate,
  rule,
  bootstrapSeedOffset,
}) {
  const rows = maturedCandidates.map(({ discovery, candidate }) => {
    const outcome = outcomesByKey.get(`${discovery.id}:${candidate.pairAddress}`) ?? null;
    const selected = selectCandidate(candidate, threshold);
    return {
      chain: candidate.chain,
      tokenAddress: candidate.tokenAddress,
      createdAt: discovery.observedAt,
      selected,
      validOutcome: Boolean(outcome),
      baseReturnPct: selected ? (outcome?.baseReturnPct ?? -100) : 0,
      stressReturnPct: selected ? (outcome?.stressReturnPct ?? -100) : 0,
    };
  });
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const baseFrames = frames.map((frame) => mean(frame.map((row) => row.baseReturnPct)));
  const stressFrames = frames.map((frame) => mean(
    frame.map((row) => row.stressReturnPct),
  ));
  const splitIndex = Math.ceil(frames.length / 2);
  const firstHalfBase = baseFrames.slice(0, splitIndex);
  const secondHalfBase = baseFrames.slice(splitIndex);
  const firstHalfStress = stressFrames.slice(0, splitIndex);
  const secondHalfStress = stressFrames.slice(splitIndex);
  const selected = weightedRows.filter((row) => row.selected);
  const uniqueSelectedTokens = new Set(selected.map(tokenEdgeAssetKey));
  const independentTradedFrames = frames.filter((frame) => (
    frame.some((row) => row.selected)
  )).length;
  const bootstrapMeanReturnCi95Pct = delayedAuditBootstrapMeanInterval(
    baseFrames,
    rule.bootstrapIterations,
    0x6c69_7100 + bootstrapSeedOffset,
  );
  const firstHalfBootstrapMeanReturnCi95Pct = delayedAuditBootstrapMeanInterval(
    firstHalfBase,
    rule.bootstrapIterations,
    0x6c69_7200 + bootstrapSeedOffset,
  );
  const secondHalfBootstrapMeanReturnCi95Pct = delayedAuditBootstrapMeanInterval(
    secondHalfBase,
    rule.bootstrapIterations,
    0x6c69_7300 + bootstrapSeedOffset,
  );
  const worstLeaveOneTokenOutStressReturnPct =
    delayedAuditWorstLeaveOneTokenOutStressReturnPct(
      rows,
      frames,
      uniqueSelectedTokens,
    );
  const factor = delayedAuditProfitFactor(baseFrames);
  const drawdown = delayedAuditMaxDrawdownPct(baseFrames);
  const largestWinnerShare = largestWinningShare(baseFrames);
  const minimumFramesPerHalf = Math.ceil(rule.minimumIndependentSignalFrames / 2);
  const gates = {
    maturedForecasts: weightedRows.length >= rule.minimumMaturedForecasts,
    independentSignalFrames: frames.length >= rule.minimumIndependentSignalFrames,
    uniqueSelectedTokens: uniqueSelectedTokens.size >= rule.minimumUniqueTokens,
    selectedForecasts: selected.length >= rule.minimumSelectedForecasts,
    independentTradedFrames:
      independentTradedFrames >= rule.minimumIndependentTradedFrames,
    baseBootstrap: bootstrapMeanReturnCi95Pct[0]
      > rule.bootstrapLower95MustExceedPct,
    firstChronologicalHalf: firstHalfBase.length >= minimumFramesPerHalf
      && firstHalfBootstrapMeanReturnCi95Pct[0]
        > rule.bootstrapLower95MustExceedPct
      && mean(firstHalfStress) > 0,
    secondChronologicalHalf: secondHalfBase.length >= minimumFramesPerHalf
      && secondHalfBootstrapMeanReturnCi95Pct[0]
        > rule.bootstrapLower95MustExceedPct
      && mean(secondHalfStress) > 0,
    positiveStress: mean(stressFrames) > 0,
    profitFactor: factor >= rule.minimumProfitFactor,
    drawdown: drawdown <= rule.maximumDrawdownPct,
    winnerConcentration: Number.isFinite(largestWinnerShare)
      && largestWinnerShare <= rule.maximumLargestWinningFrameShare,
    leaveOneTokenOut: Number.isFinite(worstLeaveOneTokenOutStressReturnPct)
      && worstLeaveOneTokenOutStressReturnPct > 0,
  };
  return {
    threshold,
    maturedObservations: weightedRows.length,
    independentHourlyFrames: frames.length,
    selectedObservations: selected.length,
    validSelectedOutcomes: selected.filter((row) => row.validOutcome).length,
    uniqueSelectedTokens: uniqueSelectedTokens.size,
    independentTradedFrames,
    averageBaseReturnPct: nullableRound(mean(baseFrames)),
    averageStressReturnPct: nullableRound(mean(stressFrames)),
    bootstrapMeanReturnCi95Pct: bootstrapMeanReturnCi95Pct.map(nullableRound),
    chronologicalHalfValidation: {
      minimumFramesPerHalf,
      firstHalf: {
        independentFrames: firstHalfBase.length,
        averageBaseReturnPct: nullableRound(mean(firstHalfBase)),
        averageStressReturnPct: nullableRound(mean(firstHalfStress)),
        bootstrapMeanReturnCi95Pct:
          firstHalfBootstrapMeanReturnCi95Pct.map(nullableRound),
      },
      secondHalf: {
        independentFrames: secondHalfBase.length,
        averageBaseReturnPct: nullableRound(mean(secondHalfBase)),
        averageStressReturnPct: nullableRound(mean(secondHalfStress)),
        bootstrapMeanReturnCi95Pct:
          secondHalfBootstrapMeanReturnCi95Pct.map(nullableRound),
      },
    },
    profitFactor: nullableRound(factor),
    maxDrawdownPct: nullableRound(drawdown),
    largestWinningFrameShare: nullableRound(largestWinnerShare),
    worstLeaveOneTokenOutStressReturnPct:
      nullableRound(worstLeaveOneTokenOutStressReturnPct),
    gates,
    retrospectiveScreeningGate: Object.values(gates).every(Boolean),
  };
}

export function delayedAuditWorstLeaveOneTokenOutStressReturnPct(
  rows,
  frames,
  uniqueSelectedTokens,
) {
  if (!(uniqueSelectedTokens instanceof Set) || uniqueSelectedTokens.size <= 1) {
    return null;
  }
  const assetsAtTimestamp = new Map();
  for (const row of rows) {
    const timestamp = Date.parse(row.createdAt);
    const assetKey = tokenEdgeAssetKey(row);
    if (!Number.isFinite(timestamp) || !assetKey) continue;
    if (!assetsAtTimestamp.has(timestamp)) assetsAtTimestamp.set(timestamp, new Set());
    assetsAtTimestamp.get(timestamp).add(assetKey);
  }
  const boundarySensitiveAssets = new Set();
  const frameSummaries = frames.map((frame, frameIndex) => {
    const sumStress = frame.reduce((total, row) => (
      total + row.stressReturnPct
    ), 0);
    const meanStress = sumStress / frame.length;
    const startTimestamp = Date.parse(frame[0]?.createdAt ?? "");
    const startAssets = assetsAtTimestamp.get(startTimestamp);
    if (startAssets?.size === 1) {
      boundarySensitiveAssets.add([...startAssets][0]);
    }
    return { frameIndex, count: frame.length, sumStress, meanStress };
  });
  const affectedFramesByAsset = new Map();
  for (const [frameIndex, frame] of frames.entries()) {
    for (const row of frame) {
      const assetKey = tokenEdgeAssetKey(row);
      if (!affectedFramesByAsset.has(assetKey)) {
        affectedFramesByAsset.set(assetKey, []);
      }
      affectedFramesByAsset.get(assetKey).push({
        frameIndex,
        stressReturnPct: row.stressReturnPct,
      });
    }
  }
  const totalFrameMean = frameSummaries.reduce((total, frame) => (
    total + frame.meanStress
  ), 0);
  const leaveOneOutMeans = [...uniqueSelectedTokens].map((excludedAssetKey) => {
    const affectedFrames = affectedFramesByAsset.get(excludedAssetKey) ?? [];
    const requiresReframing = boundarySensitiveAssets.has(excludedAssetKey)
      || affectedFrames.some(({ frameIndex }) => (
        frameSummaries[frameIndex].count <= 1
      ));
    if (requiresReframing) {
      const leaveOneOutFrames = independentAssetFrames(rows.filter((row) => (
        tokenEdgeAssetKey(row) !== excludedAssetKey
      )), {
        durationMs: HOUR_MS,
        timestamp: (row) => Date.parse(row.createdAt),
        assetKey: tokenEdgeAssetKey,
      });
      return mean(leaveOneOutFrames.map((frame) => mean(
        frame.map((row) => row.stressReturnPct),
      )));
    }
    let adjustedFrameMeanTotal = totalFrameMean;
    for (const { frameIndex, stressReturnPct } of affectedFrames) {
      const frame = frameSummaries[frameIndex];
      const leaveOneOutFrameMean = (frame.sumStress - stressReturnPct)
        / (frame.count - 1);
      adjustedFrameMeanTotal += leaveOneOutFrameMean - frame.meanStress;
    }
    return adjustedFrameMeanTotal / frameSummaries.length;
  });
  return Math.min(...leaveOneOutMeans);
}

function delayedFiveMinuteBuyShare(candidate) {
  const buys = candidate?.birthQuote?.buysM5;
  const sells = candidate?.birthQuote?.sellsM5;
  if (!Number.isFinite(buys) || buys < 0 || !Number.isFinite(sells) || sells < 0) {
    return null;
  }
  const transactions = buys + sells;
  return transactions > 0 ? buys / transactions : null;
}

export function geckoTerminalDelayedFiveMinuteBuyShareWilsonLowerBound(
  candidate,
  zScore =
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_FULL_COHORT_WILSON_BUY_SHARE_AUDIT_RULE
      .zScore,
) {
  const buys = candidate?.birthQuote?.buysM5;
  const sells = candidate?.birthQuote?.sellsM5;
  if (!Number.isInteger(buys) || buys < 0
    || !Number.isInteger(sells) || sells < 0
    || !Number.isFinite(zScore) || zScore <= 0) {
    return null;
  }
  const transactions = buys + sells;
  if (transactions === 0) return null;
  const observedBuyShare = buys / transactions;
  const squaredZ = zScore ** 2;
  const denominator = 1 + (squaredZ / transactions);
  const center = observedBuyShare + (squaredZ / (2 * transactions));
  const margin = zScore * Math.sqrt(
    (observedBuyShare * (1 - observedBuyShare) / transactions)
      + (squaredZ / (4 * transactions ** 2)),
  );
  return Math.max(0, (center - margin) / denominator);
}

function delayedFiveMinuteTransactionCount(candidate) {
  const buys = candidate?.birthQuote?.buysM5;
  const sells = candidate?.birthQuote?.sellsM5;
  if (!Number.isFinite(buys) || buys < 0 || !Number.isFinite(sells) || sells < 0) {
    return null;
  }
  return buys + sells;
}

function delayedFullCohortAuditCandidate(candidate) {
  const quote = candidate?.birthQuote;
  return candidate?.status === "watchable"
    && candidate.ruleVersion === GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version
    && quote
    && quote.ruleVersion === GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.version
    && quote.chain === "solana"
    && quote.tokenAddress === candidate.tokenAddress
    && quote.pairAddress === candidate.pairAddress
    && quote.poolCreatedAt === candidate.poolCreatedAt
    && quote.pairAgeMinutes >= 0
    && quote.pairAgeMinutes
      <= GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE
        .maximumBirthObservationAgeMinutesInclusive;
}

function delayedV4LiquidityAuditCandidate(candidate) {
  const quote = candidate?.birthQuote;
  const blockers = Array.isArray(quote?.blockers) ? quote.blockers : [];
  return candidate?.status === "watchable"
    && candidate.ruleVersion === GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version
    && quote?.status === "blocked"
    && blockers.length === 1
    && blockers[0] === "market-cap-outside-50000-5000000"
    && quote.ruleVersion === GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.version
    && quote.chain === "solana"
    && quote.tokenAddress === candidate.tokenAddress
    && quote.pairAddress === candidate.pairAddress
    && quote.poolCreatedAt === candidate.poolCreatedAt
    && quote.pairAgeMinutes >= 0
    && quote.pairAgeMinutes
      <= GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE
        .maximumBirthObservationAgeMinutesInclusive
    && quote.priceUsd > 0
    && quote.liquidityUsd > 0
    && quote.marketCapUsd > 0
    && quote.marketCapUsd
      < GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE
        .candidateScreens.minimumMarketCapUsdInclusive;
}

function delayedOutcomeEvent({
  registration,
  discovery,
  candidate,
  horizon,
  dueAt,
  observedAt,
  status,
  reason,
  outcomeQuote,
}) {
  const birthQuote = candidate.birthQuote;
  const grossReturnPct = status === "observed"
    ? nullableRound(((outcomeQuote.priceUsd / birthQuote.priceUsd) - 1) * 100)
    : null;
  return {
    type: "geckoterminal-new-pool-delayed-shadow-outcome",
    id: `geckoterminal_new_pool_delayed_shadow_outcome_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
      pairAddress: candidate.pairAddress,
      horizon,
    }).slice(0, 24)}`,
    ruleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    chain: candidate.chain,
    tokenAddress: candidate.tokenAddress,
    symbol: candidate.symbol,
    pairAddress: candidate.pairAddress,
    poolCreatedAt: candidate.poolCreatedAt,
    horizon,
    sourceDiscoveryObservedAt: discovery.observedAt,
    dueAt: dueAt.toISOString(),
    observedAt: observedAt.toISOString(),
    observationLagMs: observedAt.getTime() - dueAt.getTime(),
    status,
    reason,
    birthQuoteDigest: digestValue(birthQuote),
    outcomeQuote,
    grossReturnPct,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

function delayedOutcomeIneligibilityReason({
  candidate,
  outcomeQuote,
  dueAt,
  observedAt,
}) {
  if (observedAt.getTime() - dueAt.getTime() > MAX_OBSERVATION_LAG_MS) {
    return "delayed-shadow-response-after-window";
  }
  if (outcomeQuote.tokenAddress !== candidate.tokenAddress
    || outcomeQuote.pairAddress !== candidate.pairAddress
    || outcomeQuote.poolCreatedAt !== candidate.poolCreatedAt) {
    return "delayed-shadow-identity-mismatch";
  }
  if (!(outcomeQuote.priceUsd > 0) || !(outcomeQuote.liquidityUsd > 0)) {
    return "delayed-shadow-price-or-liquidity-unavailable";
  }
  return null;
}

function delayedScoreRow(outcome, discovery) {
  if (outcome?.status !== "observed" || !discovery) return null;
  const candidate = (discovery.candidates ?? []).find((item) => (
    item.tokenAddress === outcome.tokenAddress
      && item.pairAddress === outcome.pairAddress
  ));
  const birthQuote = candidate?.birthQuote;
  const outcomeQuote = outcome.outcomeQuote;
  if (!birthQuote || digestValue(birthQuote) !== outcome.birthQuoteDigest) return null;
  const baseReturnPct = capacityAdjustedReturnPct({
    grossReturnPct: outcome.grossReturnPct,
    entryLiquidityUsd: birthQuote.liquidityUsd,
    exitLiquidityUsd: outcomeQuote?.liquidityUsd,
    paperNotionalUsd: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.paperNotionalUsd,
    roundTripCostPct: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.baseRoundTripCostPct,
  });
  const stressReturnPct = capacityAdjustedReturnPct({
    grossReturnPct: outcome.grossReturnPct,
    entryLiquidityUsd: birthQuote.liquidityUsd,
    exitLiquidityUsd: outcomeQuote?.liquidityUsd,
    paperNotionalUsd: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.paperNotionalUsd,
    roundTripCostPct: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.stressRoundTripCostPct,
  });
  if (!Number.isFinite(baseReturnPct) || !Number.isFinite(stressReturnPct)) return null;
  return {
    chain: outcome.chain,
    tokenAddress: outcome.tokenAddress,
    createdAt: outcome.sourceDiscoveryObservedAt,
    grossReturnPct: outcome.grossReturnPct,
    baseReturnPct,
    stressReturnPct,
  };
}

async function collectGeckoMultiPools(pairAddresses, fetcher) {
  const uniquePairs = [...new Set(pairAddresses)].slice(
    0,
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.sourceMaximumRows,
  );
  if (!uniquePairs.length) {
    return { rowsByPair: new Map(), failures: [], requestsAttempted: 0 };
  }
  try {
    const response = await fetcher(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/multi/${uniquePairs.map(encodeURIComponent).join(",")}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) {
      throw new Error(`GeckoTerminal multi-pool returned HTTP ${response.status}.`);
    }
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

function matchesRegistration(event, evidenceBoundary = null) {
  if (event?.type !== "monitoring-policy-registration"
    || event.status !== "frozen"
    || event.rule?.version !== GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version) {
    return false;
  }
  if (evidenceBoundary && event.rule.evidenceBoundary !== evidenceBoundary.toISOString()) {
    return false;
  }
  try {
    const expected = createGeckoTerminalNewPoolDelayedShadowRegistrationEvent({
      registeredAt: event.registeredAt,
      evidenceBoundary: event.rule.evidenceBoundary,
    });
    return event.id === expected.id
      && canonical(event.rule) === canonical(expected.rule)
      && event.researchOnly === true
      && event.mutationAllowed === false
      && event.decisionAuthority === false
      && event.promotionAuthority === false
      && event.tradingAuthority === false;
  } catch {
    return false;
  }
}

async function verifiedLedger(ledgerPath) {
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) {
    throw new Error(`Ledger verification failed: ${verification.errors.join("; ")}`);
  }
  return events;
}

function registrationResult(ledgerPath, status, registration) {
  return {
    status,
    ledgerPath,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    evidenceBoundary: registration.rule.evidenceBoundary,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

function emptyDelayedDueHorizon(horizon) {
  return {
    horizon,
    unresolvedCohorts: 0,
    unresolvedCandidates: 0,
    dueCohorts: 0,
    dueCandidates: 0,
    liveDueCohorts: 0,
    liveDueCandidates: 0,
    expiredDueCohorts: 0,
    expiredDueCandidates: 0,
    futureCohorts: 0,
    futureCandidates: 0,
    earliestDueAt: null,
    earliestLiveDueAt: null,
    earliestLiveWindowClosesAt: null,
    nextFutureDueAt: null,
    dueCandidateReconciliationGate: true,
    unresolvedCandidateReconciliationGate: true,
  };
}

function countDelayedDueCandidates(groups) {
  return groups.reduce((sum, group) => sum + group.candidates.length, 0);
}

function isoTimestamp(timestampMs) {
  return Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null;
}

function resolutionResult(
  ledgerPath,
  horizon,
  observedAt,
  dueCandidates,
  deferredDueCandidates,
  requestsAttempted,
  outcomes,
  failures,
) {
  const observedOutcomes = outcomes.filter((event) => event.status === "observed");
  const missedOutcomes = outcomes.filter((event) => event.status === "missed");
  const unrecordedSelectedDueCandidates = Math.max(
    0,
    dueCandidates - outcomes.length - deferredDueCandidates,
  );
  return {
    ledgerPath,
    horizon,
    observedAt: observedAt.toISOString(),
    dueCandidates,
    deferredDueCandidates,
    unrecordedSelectedDueCandidates,
    dueCandidateReconciliationGate:
      dueCandidates === outcomes.length
        + deferredDueCandidates
        + unrecordedSelectedDueCandidates,
    requestsAttempted,
    recordedOutcomes: outcomes.length,
    observedOutcomes: observedOutcomes.length,
    missedOutcomes: missedOutcomes.length,
    missedOutcomeReasonCounts: countResolutionValues(
      missedOutcomes.map((event) => event.reason),
    ),
    outcomes,
    failures,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

function countResolutionValues(values) {
  const counts = new Map();
  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function validHorizon(value) {
  if (!Object.hasOwn(HORIZONS, value)) {
    throw new Error(`Expected delayed shadow horizon to be one of: ${Object.keys(HORIZONS).join(", ")}.`);
  }
  return value;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Expected a valid timestamp.");
  return date;
}

function timestampAtOrBefore(value, asOf) {
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= asOf.getTime();
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function weightedHorizonMean(horizons, valueField, weightField) {
  const weighted = Object.values(horizons).filter((horizon) => (
    Number.isFinite(horizon[valueField]) && horizon[weightField] > 0
  ));
  const totalWeight = weighted.reduce((sum, horizon) => sum + horizon[weightField], 0);
  if (totalWeight === 0) return null;
  return nullableRound(weighted.reduce((sum, horizon) => (
    sum + (horizon[valueField] * horizon[weightField])
  ), 0) / totalWeight);
}

function delayedCoverageDiagnostics({
  outcomes,
  recordedOutcomeCount,
  maturedCandidateOutcomes,
  validCapacityOutcomes,
}) {
  const recordedOutcomes = Array.isArray(outcomes) ? outcomes : [];
  const uniqueRecordedOutcomes = Number.isInteger(recordedOutcomeCount)
    ? recordedOutcomeCount
    : recordedOutcomes.length;
  const unrecordedMaturedOutcomes = Math.max(
    0,
    maturedCandidateOutcomes - uniqueRecordedOutcomes,
  );
  const observedOutcomes = recordedOutcomes.filter((outcome) => (
    outcome.status === "observed"
  )).length;
  const observedCapacityInvalidOutcomes = Math.max(
    0,
    observedOutcomes - validCapacityOutcomes,
  );
  const missedReasonCounts = {};
  for (const outcome of recordedOutcomes) {
    if (outcome.status !== "missed") continue;
    const reason = text(outcome.reason) ?? "missed-without-reason";
    missedReasonCounts[reason] = (missedReasonCounts[reason] ?? 0) + 1;
  }
  const invalidCapacityOutcomeCounts = {
    "unrecorded-matured": unrecordedMaturedOutcomes,
    ...missedReasonCounts,
    "observed-capacity-invalid": observedCapacityInvalidOutcomes,
  };
  const invalidCapacityOutcomes = Math.max(
    0,
    maturedCandidateOutcomes - validCapacityOutcomes,
  );
  const reconciledInvalidCapacityOutcomes = Object.values(
    invalidCapacityOutcomeCounts,
  ).reduce((sum, count) => sum + count, 0);
  const dominantFailure = Object.entries(invalidCapacityOutcomeCounts)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1]
      || left[0].localeCompare(right[0]))[0] ?? null;
  return {
    invalidCapacityOutcomes,
    invalidCapacityOutcomeCounts,
    invalidCapacityOutcomeReconciliationGate:
      reconciledInvalidCapacityOutcomes === invalidCapacityOutcomes,
    dominantInvalidCapacityOutcomeReason: dominantFailure?.[0] ?? null,
    dominantInvalidCapacityOutcomeCount: dominantFailure?.[1] ?? 0,
    minimumAdditionalPerfectValidOutcomesToReachCoverageGate:
      minimumAdditionalPerfectValidOutcomesToReachCoverageGate(
        validCapacityOutcomes,
        maturedCandidateOutcomes,
      ),
  };
}

function delayedOutcomeKeyDiagnostics(outcomes, options = {}) {
  const recordedOutcomeEvents = Array.isArray(outcomes) ? outcomes : [];
  const countsByKey = new Map();
  let invalidOutcomeKeyEventCount = 0;
  let unexpectedOutcomeEventCount = 0;
  const expectedKeys = options.expectedKeys instanceof Set
    ? options.expectedKeys
    : null;
  for (const outcome of recordedOutcomeEvents) {
    const key = delayedOutcomeKey(outcome, options);
    if (!key) {
      invalidOutcomeKeyEventCount += 1;
      continue;
    }
    if (expectedKeys && !expectedKeys.has(key)) {
      unexpectedOutcomeEventCount += 1;
    }
    countsByKey.set(key, (countsByKey.get(key) ?? 0) + 1);
  }
  const duplicateOutcomeKeyCount = [...countsByKey.values()].filter((count) => (
    count > 1
  )).length;
  const duplicateOutcomeEventCount = [...countsByKey.values()].reduce(
    (total, count) => total + Math.max(0, count - 1),
    0,
  );
  const matchedOutcomeKeyCount = expectedKeys
    ? [...countsByKey.keys()].filter((key) => expectedKeys.has(key)).length
    : countsByKey.size;
  const unexpectedOutcomeKeyCount = expectedKeys
    ? [...countsByKey.keys()].filter((key) => !expectedKeys.has(key)).length
    : 0;
  return {
    recordedOutcomeEvents: recordedOutcomeEvents.length,
    uniqueOutcomeKeys: countsByKey.size,
    matchedOutcomeKeyCount,
    invalidOutcomeKeyEventCount,
    unexpectedOutcomeKeyCount,
    unexpectedOutcomeEventCount,
    duplicateOutcomeKeyCount,
    duplicateOutcomeEventCount,
    outcomeKeyReconciliationGate:
      invalidOutcomeKeyEventCount === 0
        && unexpectedOutcomeEventCount === 0
        && duplicateOutcomeEventCount === 0,
  };
}

function delayedOutcomeKey(outcome, options = {}) {
  const keyParts = [outcome?.discoveryEventId, outcome?.pairAddress];
  if (options.includeHorizon) keyParts.unshift(outcome?.horizon);
  return keyParts.every((part) => typeof part === "string" && part.length > 0)
    ? keyParts.join(":")
    : null;
}

function delayedDiscoveryUtcDayCoverageDiagnostics({
  maturedCandidates,
  outcomesByKey,
  validRowsByKey,
}) {
  const rowsByDay = new Map();
  for (const { discovery, candidate } of maturedCandidates) {
    const discoveryTime = Date.parse(discovery.observedAt);
    if (!Number.isFinite(discoveryTime)) continue;
    const discoveryUtcDay = new Date(discoveryTime).toISOString().slice(0, 10);
    const row = rowsByDay.get(discoveryUtcDay) ?? {
      discoveryUtcDay,
      maturedCandidateOutcomes: 0,
      recordedOutcomes: 0,
      observedOutcomes: 0,
      missedOutcomes: 0,
      expiredOutcomes: 0,
      otherMissedOutcomes: 0,
      validCapacityOutcomes: 0,
    };
    row.maturedCandidateOutcomes += 1;
    const key = `${discovery.id}:${candidate.pairAddress}`;
    const outcome = outcomesByKey.get(key);
    if (outcome) {
      row.recordedOutcomes += 1;
      if (outcome.status === "observed") {
        row.observedOutcomes += 1;
      } else if (outcome.status === "missed") {
        row.missedOutcomes += 1;
        if (outcome.reason === "delayed-shadow-window-expired") {
          row.expiredOutcomes += 1;
        } else {
          row.otherMissedOutcomes += 1;
        }
      }
    }
    if (validRowsByKey.has(key)) row.validCapacityOutcomes += 1;
    rowsByDay.set(discoveryUtcDay, row);
  }
  const allRows = [...rowsByDay.values()].sort((left, right) => (
    left.discoveryUtcDay.localeCompare(right.discoveryUtcDay)
  )).map((row) => {
    const unrecordedMaturedOutcomes = Math.max(
      0,
      row.maturedCandidateOutcomes - row.recordedOutcomes,
    );
    const observedCapacityInvalidOutcomes = Math.max(
      0,
      row.observedOutcomes - row.validCapacityOutcomes,
    );
    const validCapacityOutcomeCoverageRate = roundRatio(
      row.validCapacityOutcomes,
      row.maturedCandidateOutcomes,
    );
    return {
      ...row,
      unrecordedMaturedOutcomes,
      observedCapacityInvalidOutcomes,
      recordedOutcomeCoverageRate: roundRatio(
        row.recordedOutcomes,
        row.maturedCandidateOutcomes,
      ),
      validCapacityOutcomeCoverageRate,
      validCapacityOutcomeCoverageGate: Number.isFinite(
        validCapacityOutcomeCoverageRate,
      ) && validCapacityOutcomeCoverageRate
        >= MINIMUM_VALID_CAPACITY_OUTCOME_COVERAGE_RATE,
      reconciliationGate:
        row.recordedOutcomes === row.observedOutcomes + row.missedOutcomes
          && row.missedOutcomes
            === row.expiredOutcomes + row.otherMissedOutcomes
          && row.observedOutcomes
            === row.validCapacityOutcomes + observedCapacityInvalidOutcomes
          && row.maturedCandidateOutcomes
            === row.recordedOutcomes + unrecordedMaturedOutcomes,
    };
  });
  return {
    maximumReportedDiscoveryUtcDays:
      MAXIMUM_REPORTED_DISCOVERY_UTC_DAY_COVERAGE_ROWS,
    totalDiscoveryUtcDays: allRows.length,
    omittedEarlierDiscoveryUtcDays: Math.max(
      0,
      allRows.length - MAXIMUM_REPORTED_DISCOVERY_UTC_DAY_COVERAGE_ROWS,
    ),
    rows: allRows.slice(-MAXIMUM_REPORTED_DISCOVERY_UTC_DAY_COVERAGE_ROWS),
    researchOnly: true,
    mutationAllowed: false,
    authority: false,
  };
}

function minimumAdditionalPerfectValidOutcomesToReachCoverageGate(
  validCapacityOutcomes,
  maturedCandidateOutcomes,
) {
  if (!Number.isInteger(validCapacityOutcomes) || validCapacityOutcomes < 0
    || !Number.isInteger(maturedCandidateOutcomes)
    || maturedCandidateOutcomes <= 0
    || validCapacityOutcomes > maturedCandidateOutcomes) {
    return null;
  }
  if (validCapacityOutcomes / maturedCandidateOutcomes
    >= MINIMUM_VALID_CAPACITY_OUTCOME_COVERAGE_RATE) {
    return 0;
  }
  return Math.ceil((
    (MINIMUM_VALID_CAPACITY_OUTCOME_COVERAGE_RATE * maturedCandidateOutcomes)
      - validCapacityOutcomes
  ) / (1 - MINIMUM_VALID_CAPACITY_OUTCOME_COVERAGE_RATE));
}

function roundRatio(numerator, denominator) {
  return denominator > 0 ? nullableRound(numerator / denominator) : null;
}

function largestWinningShare(values) {
  const winners = values.filter((value) => value > 0);
  const total = winners.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...winners) / total : null;
}

function delayedAuditBootstrapMeanInterval(values, iterations, seed) {
  if (values.length < 2) return [null, null];
  const blockSize = Math.max(
    2,
    Math.min(values.length, Math.round(Math.sqrt(values.length))),
  );
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const means = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = [];
    while (sample.length < values.length) {
      const start = Math.floor(random() * values.length);
      for (let offset = 0; offset < blockSize; offset += 1) {
        sample.push(values[(start + offset) % values.length]);
        if (sample.length === values.length) break;
      }
    }
    means.push(mean(sample));
  }
  means.sort((left, right) => left - right);
  return [
    means[Math.floor(0.025 * (means.length - 1))],
    means[Math.ceil(0.975 * (means.length - 1))],
  ];
}

function delayedAuditProfitFactor(values) {
  if (!values.length) return null;
  const gains = values.filter((value) => value > 0)
    .reduce((sum, value) => sum + value, 0);
  const losses = values.filter((value) => value < 0)
    .reduce((sum, value) => sum + Math.abs(value), 0);
  if (losses > 0) return gains / losses;
  return gains > 0 ? 999 : null;
}

function delayedAuditMaxDrawdownPct(values) {
  if (!values.length) return null;
  let wealth = 1;
  let peak = 1;
  let maxDrawdownPct = 0;
  for (const value of values) {
    wealth *= Math.max(0, 1 + (value / 100));
    peak = Math.max(peak, wealth);
    maxDrawdownPct = Math.max(
      maxDrawdownPct,
      peak > 0 ? ((peak - wealth) / peak) * 100 : 100,
    );
  }
  return maxDrawdownPct;
}

function nullableRound(value) {
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonical(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseArgs(argv) {
  const [action, ...rest] = argv.slice(2);
  const options = { action };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--ledger") options.ledgerPath = rest[++index];
    else if (rest[index] === "--horizon") options.horizon = rest[++index];
    else if (rest[index] === "--evidence-boundary") options.evidenceBoundary = rest[++index];
    else throw new Error(`Unknown argument: ${rest[index]}`);
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    let result;
    if (options.action === "register") {
      result = await registerGeckoTerminalNewPoolDelayedShadow(options);
    } else if (options.action === "resolve") {
      result = await resolveGeckoTerminalNewPoolDelayedShadows(options);
    } else if (options.action === "score") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      result = buildGeckoTerminalNewPoolDelayedShadowScorecard(
        await verifiedLedger(ledgerPath),
      );
    } else if (options.action === "audit-birth-liquidity-floor") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      result = buildGeckoTerminalNewPoolDelayedShadowLiquidityFloorAudit(
        await verifiedLedger(ledgerPath),
      );
    } else if (options.action === "audit-full-cohort-liquidity-floor") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      result = buildGeckoTerminalNewPoolDelayedShadowFullCohortLiquidityAudit(
        await verifiedLedger(ledgerPath),
      );
    } else if (options.action === "audit-full-cohort-hourly-volume-floor") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      result = buildGeckoTerminalNewPoolDelayedShadowFullCohortVolumeAudit(
        await verifiedLedger(ledgerPath),
      );
    } else if (options.action === "audit-full-cohort-five-minute-turnover-cap") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      result = buildGeckoTerminalNewPoolDelayedShadowFullCohortTurnoverAudit(
        await verifiedLedger(ledgerPath),
      );
    } else if (options.action === "audit-full-cohort-five-minute-turnover-floor") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      result = buildGeckoTerminalNewPoolDelayedShadowFullCohortTurnoverFloorAudit(
        await verifiedLedger(ledgerPath),
      );
    } else if (options.action === "audit-full-cohort-market-cap-floor") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      result = buildGeckoTerminalNewPoolDelayedShadowFullCohortMarketCapAudit(
        await verifiedLedger(ledgerPath),
      );
    } else if (options.action
      === "audit-full-cohort-five-minute-buy-share-wilson-lower") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      result = buildGeckoTerminalNewPoolDelayedShadowFullCohortWilsonBuyShareAudit(
        await verifiedLedger(ledgerPath),
      );
    } else if (options.action
      === "audit-full-cohort-five-minute-total-transactions-floor") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      result = buildGeckoTerminalNewPoolDelayedShadowFullCohortTransactionCountAudit(
        await verifiedLedger(ledgerPath),
      );
    } else if (options.action === "audit-full-cohort-family-registry") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      result = buildGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(
        await verifiedLedger(ledgerPath),
      );
    } else if (options.action === "audit-birth-buy-share") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      result = buildGeckoTerminalNewPoolDelayedShadowBuyShareAudit(
        await verifiedLedger(ledgerPath),
      );
    } else if (options.action === "audit-birth-transaction-count") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      result = buildGeckoTerminalNewPoolDelayedShadowTransactionCountAudit(
        await verifiedLedger(ledgerPath),
      );
    } else {
      throw new Error(
        "Expected action: register, resolve, score, audit-birth-liquidity-floor, audit-full-cohort-liquidity-floor, audit-full-cohort-hourly-volume-floor, audit-full-cohort-five-minute-turnover-cap, audit-full-cohort-five-minute-turnover-floor, audit-full-cohort-market-cap-floor, audit-full-cohort-five-minute-buy-share-wilson-lower, audit-full-cohort-five-minute-total-transactions-floor, audit-full-cohort-family-registry, audit-birth-buy-share, or audit-birth-transaction-count.",
      );
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
