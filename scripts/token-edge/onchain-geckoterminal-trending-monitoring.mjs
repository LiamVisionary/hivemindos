#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendLedgerEvent,
  digestValue,
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
import { DEX_EARLY_SURFACE_RULE } from "./onchain-dex-early-rule.mjs";
import {
  DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE,
  collectDexPulseProviderConsensus,
  consensusPairForForecast,
  validDexPulseStoredProviderPriceIntegrity,
} from "./onchain-dex-pulse-monitoring.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";
import {
  canonicalRugCheckMarketStructure,
  normalizeRugCheckMarketStructure,
} from "./onchain-dex-pulse-rugcheck-market-structure.mjs";
import { readRugCheckReport } from "./onchain-dex-pulse-rugcheck-monitoring.mjs";

const GECKOTERMINAL_TRENDING_URL =
  "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1&duration=1h";
const GECKOTERMINAL_FAST_TRENDING_URL =
  "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1&duration=5m";
const HOUR_MS = 60 * 60_000;
const CAPTURE_CADENCE_MS = 15 * 60_000;
const PATH_CADENCE_MS = 5 * 60_000;
const MAX_CAPTURE_LAG_MS = 5 * 60_000;
const MAX_OUTCOME_LAG_MS = 5 * 60_000;

export const GECKOTERMINAL_TRENDING_RULE = Object.freeze({
  version: "geckoterminal-solana-trending-pools-shadow-v1",
  evidenceBoundary: "2026-08-04T02:28:10.000Z",
  parentRuleVersion: "dex-surface-pulse-monitoring-panel-v1",
  changedDimension: "candidate-discovery-provider-and-provider-native-rank",
  sourceProvider: "geckoterminal-trending-pools",
  sourceEndpoint: GECKOTERMINAL_TRENDING_URL,
  network: "solana",
  trendingDuration: "1h",
  sourcePage: 1,
  sourceMaximumRows: 20,
  cadenceMinutes: 15,
  maximumCaptureLagMinutes: 5,
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
  selectionOrder: "geckoterminal-one-hour-trending-rank-ascending-first-pool-per-base-token",
  decision: "paper-long-every-eligible-trending-candidate",
  repeatedAssetPolicy: "one-open-forecast-per-token-and-first-exact-asset-observation-per-independent-one-hour-frame",
  entryAndExitQuoteProvider: "dexscreener-dual-endpoint-lower-price-and-liquidity",
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  derivationStatus: "future-only-source-coverage-challenger",
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_FAST_TRENDING_RULE = Object.freeze({
  ...GECKOTERMINAL_TRENDING_RULE,
  version: "geckoterminal-solana-five-minute-trending-pools-shadow-v2",
  evidenceBoundary: "2026-08-04T02:51:34.000Z",
  parentRuleVersion: GECKOTERMINAL_TRENDING_RULE.version,
  changedDimension: "geckoterminal-trending-rank-window-from-one-hour-to-five-minutes",
  sourceEndpoint: GECKOTERMINAL_FAST_TRENDING_URL,
  trendingDuration: "5m",
  derivationStatus: "future-only-one-change-ranking-window-challenger",
});

export const GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE = Object.freeze({
  ...GECKOTERMINAL_FAST_TRENDING_RULE,
  version: "geckoterminal-solana-five-minute-trending-native-quote-shadow-v3",
  evidenceBoundary: "2026-08-04T02:54:07.000Z",
  parentRuleVersion: GECKOTERMINAL_FAST_TRENDING_RULE.version,
  changedDimension: "exact-entry-and-exit-quote-consensus-provider",
  entryAndExitQuoteProvider:
    "geckoterminal-exact-pool-and-dexscreener-direct-exact-pair-lower-price-and-liquidity",
  maximumCrossProviderPriceRatioInclusive: 1.1,
  maximumCrossProviderLiquidityRatioInclusive: 1.25,
  derivationStatus: "future-only-one-change-new-pool-indexing-lag-challenger",
});

export const GECKOTERMINAL_FAST_NATIVE_SCORING_RULE = Object.freeze({
  version: "geckoterminal-five-minute-native-quote-scoring-v1",
  evidenceBoundary: "2026-08-04T02:56:21.000Z",
  sourceRuleVersion: GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE.version,
  excludedDerivationTokenAddresses: Object.freeze([
    "GL73ukaboEue6PURVRxB3CxhsBjqJgLmrX41vF371pGZ",
  ]),
  excludedDiagnosticForecastIds: Object.freeze([
    "geckoterminal_trending_forecast_bc7339c6a4a28a7b1e1f5803",
  ]),
  eligibleForecastTiming: "created-strictly-after-scoring-registration",
  purpose: "Prevent the provider-lag derivation token and its immediate diagnostic forecast from entering the future-only payoff cohort.",
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_FAST_NATIVE_PATH_RULE = Object.freeze({
  version: "geckoterminal-five-minute-native-quote-path-observation-v1",
  evidenceBoundary: "2026-08-04T05:32:00.000Z",
  sourceRuleVersion: GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE.version,
  changedDimension: "observation-only-five-minute-executable-quote-path",
  cadenceMinutes: 5,
  eligibleForecastTiming: "forecast-created-strictly-after-path-registration",
  quoteIntegrity: GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE.entryAndExitQuoteProvider,
  purpose: "Measure whether earlier GeckoTerminal acquisition retains enough executable path upside for a separately frozen future exit policy without changing selection or reconstructing missed points.",
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_FAST_NATIVE_RUGCHECK_HOLDER_RULE = Object.freeze({
  version: "geckoterminal-five-minute-native-quote-rugcheck-holder-concentration-v1",
  evidenceBoundary: "2026-08-04T05:57:30.000Z",
  parentRuleVersion: GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE.version,
  changedDimension: "known-account-adjusted-unknown-top20-holder-concentration-screen",
  provider: "rugcheck",
  maximumEvidenceToForecastLagMinutes: 5,
  maximumUnknownTop20PctInclusive: 30,
  decision: "paper-long-only-when-complete-rugcheck-unknown-top20-is-at-most-30-percent-otherwise-cash",
  derivationStatus: "future-only-transfer-of-pre-existing-rugcheck-screen",
  derivationNote: "The threshold was frozen in the earlier DEX pulse RugCheck market-structure panel. A post-outcome report audit found 80.877471% unknown top-20 concentration for the clean V3 liquidity collapse and 16.96053% for the surviving winner; both tokens, reports, and outcomes are excluded.",
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTradedTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  minimumTradedObservations: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE = Object.freeze({
  version: "geckoterminal-liquidity-collapse-outcome-accounting-v1",
  evidenceBoundary: "2026-08-04T03:57:57.000Z",
  sourceRuleVersions: Object.freeze([
    GECKOTERMINAL_TRENDING_RULE.version,
    GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE.version,
    "geckoterminal-solana-new-pool-fifteen-minute-activation-shadow-v1",
  ]),
  eligibleForecastTiming: "created-strictly-after-liquidity-accounting-registration",
  collapseCondition: "both-exact-pool-providers-at-or-below-paper-notional-liquidity",
  liquidityCollapseThresholdUsdInclusive: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
  collapsedOutcomeGrossReturnPct: -100,
  purpose: "Prevent drained pools from disappearing as unscoreable missing outcomes when both exact-pool providers show insufficient liquidity to recover the frozen paper notional.",
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_PRICE_AGNOSTIC_COLLAPSE_SCORING_RULE = Object.freeze({
  ...GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE,
  version: "geckoterminal-zero-liquidity-price-agnostic-accounting-v2",
  evidenceBoundary: "2026-08-04T09:42:30.000Z",
  changedDimension: "ignore-price-ratio-only-after-both-exact-providers-confirm-non-executable-liquidity",
  collapseCondition:
    "both exact matching-pair providers independently report nonnegative liquidity at or below the paper notional; positive prices are retained for audit but their ratio cannot rescue an impossible exit",
  purpose:
    "Prevent a drained pool from becoming an unscored survivor merely because stale zero-liquidity prices disagree after both exact providers independently show the paper position cannot exit.",
  derivationStatus: "future-only-accounting-correction-after-one-preserved-provider-disagreement",
  derivationNote:
    "TOMOTHY showed effectively zero liquidity on both exact providers while their unusable prices differed by more than 3x. TOMOTHY, its exact window, and every earlier forecast are excluded; v1 remains immutable history.",
});

export function createGeckoTerminalTrendingRegistrationEvent(registeredAt = new Date()) {
  return createGeckoTerminalRegistrationEvent(GECKOTERMINAL_TRENDING_RULE, registeredAt);
}

export function createGeckoTerminalFastTrendingRegistrationEvent(registeredAt = new Date()) {
  return createGeckoTerminalRegistrationEvent(
    GECKOTERMINAL_FAST_TRENDING_RULE,
    registeredAt,
  );
}

export function createGeckoTerminalFastNativeQuoteRegistrationEvent(
  registeredAt = new Date(),
) {
  return createGeckoTerminalRegistrationEvent(
    GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE,
    registeredAt,
  );
}

function createGeckoTerminalRegistrationEvent(rule, registeredAt) {
  const registrationSpec = {
    rule,
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

export function createGeckoTerminalFastNativeScoringRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    scoringRule: GECKOTERMINAL_FAST_NATIVE_SCORING_RULE,
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

export function createGeckoTerminalFastNativePathRegistrationEvent(
  registeredAt = new Date(),
) {
  return createGeckoTerminalRegistrationEvent(
    GECKOTERMINAL_FAST_NATIVE_PATH_RULE,
    registeredAt,
  );
}

export function createGeckoTerminalFastNativeRugCheckHolderRegistrationEvent(
  registeredAt = new Date(),
) {
  return createGeckoTerminalRegistrationEvent(
    GECKOTERMINAL_FAST_NATIVE_RUGCHECK_HOLDER_RULE,
    registeredAt,
  );
}

export function createGeckoTerminalLiquidityCollapseScoringRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    scoringRule: GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE,
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

export function createGeckoTerminalPriceAgnosticCollapseScoringRegistrationEvent(
  registeredAt = new Date(),
) {
  const registrationSpec = {
    scoringRule: GECKOTERMINAL_PRICE_AGNOSTIC_COLLAPSE_SCORING_RULE,
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

export async function registerGeckoTerminalTrending(options = {}, dependencies = {}) {
  return registerGeckoTerminalRule({
    options,
    dependencies,
    rule: GECKOTERMINAL_TRENDING_RULE,
    createRegistrationEvent: createGeckoTerminalTrendingRegistrationEvent,
    matches: matchesRegistration,
    label: "GeckoTerminal trending",
  });
}

export async function registerGeckoTerminalFastTrending(options = {}, dependencies = {}) {
  return registerGeckoTerminalRule({
    options,
    dependencies,
    rule: GECKOTERMINAL_FAST_TRENDING_RULE,
    createRegistrationEvent: createGeckoTerminalFastTrendingRegistrationEvent,
    matches: matchesFastRegistration,
    label: "GeckoTerminal five-minute trending",
  });
}

export async function registerGeckoTerminalFastNativeQuote(options = {}, dependencies = {}) {
  return registerGeckoTerminalRule({
    options,
    dependencies,
    rule: GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE,
    createRegistrationEvent: createGeckoTerminalFastNativeQuoteRegistrationEvent,
    matches: matchesFastNativeQuoteRegistration,
    label: "GeckoTerminal five-minute native-quote trending",
  });
}

async function registerGeckoTerminalRule({
  options,
  dependencies,
  rule,
  createRegistrationEvent,
  matches,
  label,
}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(rule.evidenceBoundary))) {
    throw new Error(`${label} registration must be strictly after its evidence boundary.`);
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matches(existing)) {
    throw new Error(`Existing ${label} registration mismatch: ${proposed.id}`);
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

export async function registerGeckoTerminalFastNativeScoring(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createGeckoTerminalFastNativeScoringRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_FAST_NATIVE_SCORING_RULE.evidenceBoundary))) {
    throw new Error("GeckoTerminal native-quote scoring registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFastNativeScoringRegistration(existing)) {
    throw new Error(`Existing GeckoTerminal native-quote scoring registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.scoringRule.version,
  };
}

export async function registerGeckoTerminalFastNativePath(
  options = {},
  dependencies = {},
) {
  return registerGeckoTerminalRule({
    options,
    dependencies,
    rule: GECKOTERMINAL_FAST_NATIVE_PATH_RULE,
    createRegistrationEvent: createGeckoTerminalFastNativePathRegistrationEvent,
    matches: matchesFastNativePathRegistration,
    label: "GeckoTerminal native-quote path observation",
  });
}

export async function registerGeckoTerminalFastNativeRugCheckHolder(
  options = {},
  dependencies = {},
) {
  return registerGeckoTerminalRule({
    options,
    dependencies,
    rule: GECKOTERMINAL_FAST_NATIVE_RUGCHECK_HOLDER_RULE,
    createRegistrationEvent: createGeckoTerminalFastNativeRugCheckHolderRegistrationEvent,
    matches: matchesFastNativeRugCheckHolderRegistration,
    label: "GeckoTerminal native-quote RugCheck holder concentration",
  });
}

export async function registerGeckoTerminalLiquidityCollapseScoring(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createGeckoTerminalLiquidityCollapseScoringRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE.evidenceBoundary))) {
    throw new Error("GeckoTerminal liquidity-collapse scoring registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesLiquidityCollapseScoringRegistration(existing)) {
    throw new Error(`Existing GeckoTerminal liquidity-collapse scoring registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.scoringRule.version,
  };
}

export async function registerGeckoTerminalPriceAgnosticCollapseScoring(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesLiquidityCollapseScoringRegistration)) {
    throw new Error("Register GeckoTerminal liquidity-collapse accounting v1 first.");
  }
  const proposed = createGeckoTerminalPriceAgnosticCollapseScoringRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_PRICE_AGNOSTIC_COLLAPSE_SCORING_RULE.evidenceBoundary))) {
    throw new Error("Price-agnostic collapse scoring registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesPriceAgnosticCollapseScoringRegistration(existing)) {
    throw new Error(`Existing price-agnostic collapse scoring registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.scoringRule.version,
  };
}

export function geckoTrendingCandidate(
  row,
  sourceRank,
  observedAt = new Date(),
  rule = GECKOTERMINAL_TRENDING_RULE,
) {
  const attributes = row?.attributes ?? {};
  const relationshipId = text(row?.relationships?.base_token?.data?.id);
  const tokenAddress = relationshipId?.startsWith("solana_")
    ? relationshipId.slice("solana_".length) : null;
  const pairAddress = text(attributes.address)
    ?? (text(row?.id)?.startsWith("solana_") ? text(row.id).slice("solana_".length) : null);
  const createdAtMs = Date.parse(attributes.pool_created_at ?? "");
  const observedAtMs = observedAt instanceof Date ? observedAt.getTime() : Date.parse(observedAt);
  const pairAgeMinutes = Number.isFinite(createdAtMs) && Number.isFinite(observedAtMs)
    ? Math.round((observedAtMs - createdAtMs) / 60_000) : null;
  const liquidityUsd = positiveNumber(attributes.reserve_in_usd);
  const marketCapUsd = positiveNumber(attributes.market_cap_usd)
    ?? positiveNumber(attributes.fdv_usd);
  const priceUsd = positiveNumber(attributes.base_token_price_usd);
  const volumeH1Usd = nonnegativeNumber(attributes.volume_usd?.h1);
  const volumeM5Usd = nonnegativeNumber(attributes.volume_usd?.m5);
  const buysH1 = nonnegativeNumber(attributes.transactions?.h1?.buys);
  const sellsH1 = nonnegativeNumber(attributes.transactions?.h1?.sells);
  const buysM5 = nonnegativeNumber(attributes.transactions?.m5?.buys);
  const sellsM5 = nonnegativeNumber(attributes.transactions?.m5?.sells);
  const priceChangeM5Pct = finiteNumber(attributes.price_change_percentage?.m5);
  const priceChangeH1Pct = finiteNumber(attributes.price_change_percentage?.h1);
  const priceChangeH24Pct = finiteNumber(attributes.price_change_percentage?.h24);
  const blockers = trendingCandidateBlockers({
    tokenAddress,
    pairAddress,
    priceUsd,
    pairAgeMinutes,
    liquidityUsd,
    marketCapUsd,
    volumeH1Usd,
    priceChangeH1Pct,
    priceChangeH24Pct,
  }, rule);
  return {
    chain: "solana",
    tokenAddress,
    symbol: safeDisplaySymbol(attributes.name),
    pairAddress,
    sourceRank,
    poolCreatedAt: Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : null,
    pairAgeMinutes,
    priceUsd,
    liquidityUsd,
    marketCapUsd,
    volumeH1Usd,
    hourlyTurnover: ratio(volumeH1Usd, liquidityUsd),
    volumeM5Usd,
    fiveMinuteTurnover: ratio(volumeM5Usd, liquidityUsd),
    buysH1,
    sellsH1,
    buySellTxnRatio: ratio(buysH1, sellsH1),
    buysM5,
    sellsM5,
    fiveMinuteBuySellTxnRatio: ratio(buysM5, sellsM5),
    priceChangeM5Pct,
    priceChangeH1Pct,
    priceChangeH24Pct,
    status: blockers.length ? "blocked" : "eligible",
    blockers,
    ruleVersion: rule.version,
  };
}

export async function captureGeckoTerminalTrending(options = {}, dependencies = {}) {
  return captureGeckoTerminalRule({
    options,
    dependencies,
    rule: GECKOTERMINAL_TRENDING_RULE,
    matches: matchesRegistration,
  });
}

export async function captureGeckoTerminalFastTrending(options = {}, dependencies = {}) {
  return captureGeckoTerminalRule({
    options,
    dependencies,
    rule: GECKOTERMINAL_FAST_TRENDING_RULE,
    matches: matchesFastRegistration,
  });
}

export async function captureGeckoTerminalFastNativeQuote(options = {}, dependencies = {}) {
  return captureGeckoTerminalRule({
    options,
    dependencies,
    rule: GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE,
    matches: matchesFastNativeQuoteRegistration,
  });
}

export async function captureGeckoTerminalFastNativeRugCheckHolder(
  options = {},
  dependencies = {},
) {
  return captureGeckoTerminalRule({
    options,
    dependencies,
    rule: GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE,
    matches: matchesFastNativeQuoteRegistration,
    riskRule: GECKOTERMINAL_FAST_NATIVE_RUGCHECK_HOLDER_RULE,
  });
}

async function captureGeckoTerminalRule({
  options,
  dependencies,
  rule,
  matches,
  riskRule = null,
}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const startedAt = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matches);
  if (!registration) throw new Error("Register the GeckoTerminal trending policy before capture.");
  const riskRegistration = riskRule
    ? events.find(matchesFastNativeRugCheckHolderRegistration) ?? null : null;
  if (riskRule && !riskRegistration) {
    throw new Error("Register the GeckoTerminal RugCheck holder policy before risk capture.");
  }
  const cadenceBucket = Math.floor(startedAt.getTime() / CAPTURE_CADENCE_MS);
  const existingDiscovery = events.find((event) => (
    event.type === "geckoterminal-trending-discovery"
    && event.registrationId === registration.id
    && event.cadenceBucket === cadenceBucket
  ));
  if (existingDiscovery) {
    const existingForecasts = events.filter((event) => (
      event.type === "geckoterminal-trending-forecast"
      && event.discoveryEventId === existingDiscovery.id
    ));
    return captureResult(
      ledgerPath,
      startedAt,
      "skipped-existing-cadence",
      existingDiscovery.id,
      existingForecasts,
      { existingForecasts: existingForecasts.length },
    );
  }

  const response = await fetcher(rule.sourceEndpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`GeckoTerminal trending pools returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data.slice(0, 20) : [];
  const sourceObservedAt = dependencies.clock?.() ?? (dependencies.now ? startedAt : new Date());
  if (!(sourceObservedAt.getTime() > Date.parse(registration.registeredAt)
    && sourceObservedAt.getTime() > Date.parse(rule.evidenceBoundary))) {
    throw new Error("GeckoTerminal trending source observation must be strictly future-only.");
  }
  const evaluated = rows.map((row, index) => geckoTrendingCandidate(
    row,
    index + 1,
    sourceObservedAt,
    rule,
  ));
  const firstPoolByToken = new Map();
  for (const candidate of evaluated) {
    if (candidate.tokenAddress && !firstPoolByToken.has(candidate.tokenAddress)) {
      firstPoolByToken.set(candidate.tokenAddress, candidate);
    }
  }
  const candidates = [...firstPoolByToken.values()]
    .filter((candidate) => candidate.status === "eligible")
    .slice(0, rule.maximumCandidates);
  const discovery = {
    type: "geckoterminal-trending-discovery",
    id: `geckoterminal_trending_discovery_${digestValue({
      registrationId: registration.id,
      cadenceBucket,
      observedAt: sourceObservedAt.toISOString(),
      pools: rows.map((row) => row?.attributes?.address ?? row?.id ?? null),
    }).slice(0, 24)}`,
    ruleVersion: rule.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    provider: rule.sourceProvider,
    sourceAttribution: "GeckoTerminal public API",
    endpoint: rule.sourceEndpoint,
    chain: "solana",
    cadenceBucket,
    collectionStartedAt: startedAt.toISOString(),
    availableAt: sourceObservedAt.toISOString(),
    observedAt: sourceObservedAt.toISOString(),
    returnedRows: rows.length,
    evaluatedTokens: firstPoolByToken.size,
    eligibleBeforeCap: [...firstPoolByToken.values()]
      .filter((candidate) => candidate.status === "eligible").length,
    rejectionCounts: countValues(evaluated.flatMap((candidate) => candidate.blockers)),
    candidates,
    researchOnly: true,
    mutationAllowed: false,
  };
  await appendLedgerEvent(ledgerPath, discovery);

  const resolvedIds = new Set(events
    .filter((event) => event.type === "geckoterminal-trending-resolution")
    .map((event) => event.forecastId));
  const openTokenKeys = new Set(events.filter((event) => (
    event.type === "geckoterminal-trending-forecast"
      && event.registrationId === registration.id
      && !resolvedIds.has(event.id)
  )).map(tokenEdgeAssetKey));
  const pending = candidates.filter((candidate) => !openTokenKeys.has(tokenEdgeAssetKey(candidate)));
  const nativeQuoteMode = rule.version === GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE.version;
  const riskCollection = riskRule
    ? await collectGeckoTrendingRugCheckHolderEvidence({
      ledgerPath,
      discovery,
      candidates: pending,
      registration: riskRegistration,
      now: sourceObservedAt,
      reportReader: dependencies.rugCheckReader ?? readRugCheckReport,
      responseNow: dependencies.rugCheckClock
        ?? (() => (dependencies.now ? startedAt : new Date())),
    })
    : { evidenceByToken: new Map(), requestsAttempted: 0, failures: [] };
  const provider = pending.length
    ? await (nativeQuoteMode ? collectDexDirectPairs : collectDexPulseProviderConsensus)(
      pending.map((candidate) => candidate.tokenAddress), fetcher,
    )
    : { requestsAttempted: 0, failures: [], batchPairsByToken: new Map(), directPairsByToken: new Map() };
  const capturedAt = dependencies.captureClock?.()
    ?? (dependencies.now ? startedAt : new Date());
  const sourceLagMs = capturedAt.getTime() - sourceObservedAt.getTime();
  if (sourceLagMs < 0 || sourceLagMs > MAX_CAPTURE_LAG_MS) {
    return captureResult(
      ledgerPath,
      capturedAt,
      "source-outside-capture-window",
      discovery.id,
      [],
      {
        requestsAttempted: 1 + riskCollection.requestsAttempted + provider.requestsAttempted,
        failures: [...riskCollection.failures, ...provider.failures],
      },
    );
  }
  const failures = [...riskCollection.failures, ...provider.failures];
  const forecasts = [];
  for (const candidate of pending) {
    const consensus = nativeQuoteMode
      ? geckoDexDirectConsensus(candidate, provider, rule)
      : consensusPairForForecast(provider, candidate);
    if (consensus.reason) {
      failures.push(`Trending entry integrity rejected ${candidate.tokenAddress} ${candidate.pairAddress}: ${consensus.reason}`);
      continue;
    }
    const entryPriceUsd = positiveNumber(consensus.pair?.priceUsd);
    const entryLiquidityUsd = positiveNumber(consensus.pair?.liquidity?.usd);
    if (!(entryPriceUsd > 0) || !(entryLiquidityUsd > 0)) continue;
    const createdAt = capturedAt.toISOString();
    const forecast = {
      type: "geckoterminal-trending-forecast",
      id: `geckoterminal_trending_forecast_${digestValue({
        registrationId: registration.id,
        discoveryEventId: discovery.id,
        tokenAddress: candidate.tokenAddress,
        cadenceBucket,
      }).slice(0, 24)}`,
      ruleVersion: rule.version,
      registrationId: registration.id,
      registeredAt: registration.registeredAt,
      discoveryEventId: discovery.id,
      cadenceBucket,
      chain: candidate.chain,
      tokenAddress: candidate.tokenAddress,
      symbol: candidate.symbol,
      createdAt,
      sourceDiscoveryObservedAt: discovery.observedAt,
      entryObservedAt: createdAt,
      dueAt: new Date(capturedAt.getTime() + HOUR_MS).toISOString(),
      pairAddress: candidate.pairAddress,
      entryPriceUsd,
      entryLiquidityUsd,
      entryProviderPriceIntegrity: consensus.integrity,
      metrics: candidateMetrics(candidate),
      rugCheckHolderRuleVersion: riskRule?.version ?? null,
      rugCheckHolderRegistrationId: riskRule ? riskRegistration.id : null,
      rugCheckHolderRegisteredAt: riskRule ? riskRegistration.registeredAt : null,
      rugCheckHolderEvidenceId: riskCollection.evidenceByToken
        .get(candidate.tokenAddress)?.id ?? null,
      rugCheckHolderEvidenceAvailableAt: riskCollection.evidenceByToken
        .get(candidate.tokenAddress)?.availableAt ?? null,
      predictedRise: true,
      decision: rule.decision,
      researchOnly: true,
      mutationAllowed: false,
    };
    forecasts.push(await appendLedgerEvent(ledgerPath, forecast));
  }
  return captureResult(
    ledgerPath,
    capturedAt,
    forecasts.length ? "recorded" : "no-eligible-candidates",
    discovery.id,
    forecasts,
    {
      existingForecasts: 0,
      suppressedOpenTokens: candidates.length - pending.length,
      requestsAttempted: 1 + riskCollection.requestsAttempted + provider.requestsAttempted,
      rugCheckRequestsAttempted: riskCollection.requestsAttempted,
      failures,
      returnedRows: rows.length,
      eligibleCandidates: candidates.length,
    },
  );
}

async function collectGeckoTrendingRugCheckHolderEvidence({
  ledgerPath,
  discovery,
  candidates,
  registration,
  now,
  reportReader,
  responseNow,
}) {
  if (!(Date.parse(discovery.observedAt) > Date.parse(registration.registeredAt)
    && Date.parse(discovery.observedAt)
      > Date.parse(GECKOTERMINAL_FAST_NATIVE_RUGCHECK_HOLDER_RULE.evidenceBoundary))) {
    throw new Error("GeckoTerminal RugCheck discovery must be strictly future-only.");
  }
  const evidenceByToken = new Map();
  const failures = [];
  for (const candidate of candidates) {
    let aggregate;
    try {
      aggregate = normalizeRugCheckMarketStructure(
        await reportReader(candidate.tokenAddress),
        candidate.tokenAddress,
      );
    } catch {
      aggregate = canonicalRugCheckMarketStructure({ coverage: "unavailable" });
      failures.push(`RugCheck holder evidence unavailable for ${candidate.tokenAddress}.`);
    }
    const availableAt = validIso(responseNow());
    const event = {
      type: "geckoterminal-trending-rugcheck-holder-snapshot",
      id: `geckoterminal_trending_rugcheck_holder_${digestValue({
        registrationId: registration.id,
        discoveryEventId: discovery.id,
        tokenAddress: candidate.tokenAddress,
      }).slice(0, 24)}`,
      ruleVersion: GECKOTERMINAL_FAST_NATIVE_RUGCHECK_HOLDER_RULE.version,
      registrationId: registration.id,
      discoveryEventId: discovery.id,
      provider: "rugcheck",
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
    const signed = await appendLedgerEvent(ledgerPath, event);
    evidenceByToken.set(candidate.tokenAddress, signed);
  }
  return {
    evidenceByToken,
    requestsAttempted: candidates.length,
    failures,
  };
}

export async function resolveGeckoTerminalTrending(options = {}, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const priceAgnosticCollapseRegistration =
    findGeckoPriceAgnosticCollapseScoringRegistration(events);
  const resolvedIds = new Set(events
    .filter((event) => event.type === "geckoterminal-trending-resolution")
    .map((event) => event.forecastId));
  const due = events.filter((event) => (
    event.type === "geckoterminal-trending-forecast"
    && !resolvedIds.has(event.id)
    && Date.parse(event.dueAt) <= now.getTime()
  ));
  if (!due.length) return resolutionResult(ledgerPath, now, 0, 0, [], []);
  const nativeDue = due.filter((forecast) => (
    forecast.ruleVersion === GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE.version
  ));
  const legacyDue = due.filter((forecast) => (
    forecast.ruleVersion !== GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE.version
  ));
  const legacyProvider = legacyDue.length
    ? await collectDexPulseProviderConsensus(
      [...new Set(legacyDue.map((forecast) => forecast.tokenAddress))], fetcher,
    ) : emptyLegacyProvider();
  const nativeProvider = nativeDue.length
    ? await collectGeckoPoolDexDirectProvider(nativeDue, fetcher)
    : emptyNativeProvider();
  const failures = [...legacyProvider.failures, ...nativeProvider.failures];
  const resolutions = [];
  for (const forecast of due) {
    const lagMs = now.getTime() - Date.parse(forecast.dueAt);
    const nativeMode = forecast.ruleVersion === GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE.version;
    const assessment = nativeMode
      ? geckoDexDirectExitAssessment(
        forecast,
        nativeProvider,
        GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE,
        {
          allowPriceDisagreementOnCollapse: priceAgnosticCollapseEligibility(
            forecast,
            priceAgnosticCollapseRegistration,
          ),
        },
      )
      : dexDualEndpointExitAssessment(forecast, legacyProvider);
    const exactWindowOpen = lagMs >= 0 && lagMs <= MAX_OUTCOME_LAG_MS;
    const collapsed = exactWindowOpen && assessment.status === "liquidity-collapse";
    const exitPriceUsd = assessment.reason
      ? null : positiveNumber(assessment.pair?.priceUsd);
    const exitLiquidityUsd = assessment.reason
      ? null : nonnegativeNumber(assessment.pair?.liquidity?.usd);
    if (exactWindowOpen && !collapsed
      && (assessment.reason || !(exitPriceUsd > 0) || !(exitLiquidityUsd > 0))) {
      failures.push(`Trending outcome unavailable ${forecast.tokenAddress} ${forecast.pairAddress}: ${assessment.reason ?? "non-positive-price-or-liquidity"}`);
      continue;
    }
    const observed = exactWindowOpen && exitPriceUsd > 0 && exitLiquidityUsd > 0;
    const resolvedStatus = collapsed ? "liquidity-collapse"
      : (observed ? "observed" : "missed");
    const resolution = {
      type: "geckoterminal-trending-resolution",
      id: `geckoterminal_trending_resolution_${digestValue({
        forecastId: forecast.id,
        observedAt: now.toISOString(),
        status: resolvedStatus,
      }).slice(0, 24)}`,
      ruleVersion: forecast.ruleVersion,
      registrationId: forecast.registrationId,
      forecastId: forecast.id,
      discoveryEventId: forecast.discoveryEventId,
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
    legacyProvider.requestsAttempted + nativeProvider.requestsAttempted,
    resolutions,
    failures,
  );
}

export async function markOpenGeckoTerminalFastNativePaths(
  options = {},
  dependencies = {},
) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const priceAgnosticCollapseRegistration =
    findGeckoPriceAgnosticCollapseScoringRegistration(events);
  const pathRegistration = events.find(matchesFastNativePathRegistration);
  if (!pathRegistration) {
    throw new Error("Register the GeckoTerminal native-quote path policy before marking.");
  }
  const bucketStartedAt = new Date(
    Math.floor(now.getTime() / PATH_CADENCE_MS) * PATH_CADENCE_MS,
  ).toISOString();
  const resolvedIds = new Set(events
    .filter((event) => event.type === "geckoterminal-trending-resolution")
    .map((event) => event.forecastId));
  const markedIds = new Set(events.filter((event) => (
    event.type === "geckoterminal-trending-path"
      && event.pathRegistrationId === pathRegistration.id
      && event.bucketStartedAt === bucketStartedAt
  )).map((event) => event.forecastId));
  const terminalPathIds = new Set(events.filter((event) => (
    event.type === "geckoterminal-trending-path"
      && event.pathRegistrationId === pathRegistration.id
      && event.status === "liquidity-collapse"
  )).map((event) => event.forecastId));
  const open = events.filter((event) => (
    event.type === "geckoterminal-trending-forecast"
      && event.ruleVersion === GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE.version
      && Date.parse(event.createdAt) > Date.parse(pathRegistration.registeredAt)
      && Date.parse(event.createdAt) > Date.parse(GECKOTERMINAL_FAST_NATIVE_PATH_RULE.evidenceBoundary)
      && Date.parse(event.createdAt) <= now.getTime()
      && Date.parse(event.dueAt) > now.getTime()
      && !resolvedIds.has(event.id)
      && !markedIds.has(event.id)
      && !terminalPathIds.has(event.id)
  ));
  if (!open.length) {
    return geckoPathResult(ledgerPath, now, bucketStartedAt, 0, 0, [], []);
  }
  const provider = await collectGeckoPoolDexDirectProvider(open, fetcher);
  const failures = [...provider.failures];
  const observations = [];
  for (const forecast of open) {
    const assessment = geckoDexDirectExitAssessment(
      forecast,
      provider,
      GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE,
      {
        allowPriceDisagreementOnCollapse: priceAgnosticCollapseEligibility(
          forecast,
          priceAgnosticCollapseRegistration,
        ),
      },
    );
    if (assessment.reason || !["quoted", "liquidity-collapse"].includes(assessment.status)) {
      failures.push(`Trending path unavailable ${forecast.tokenAddress} ${forecast.pairAddress}: ${assessment.reason ?? assessment.status}`);
      continue;
    }
    const observedPriceUsd = positiveNumber(assessment.pair?.priceUsd);
    const observedLiquidityUsd = nonnegativeNumber(assessment.pair?.liquidity?.usd);
    if (!(observedPriceUsd > 0) || !Number.isFinite(observedLiquidityUsd)) continue;
    const collapsed = assessment.status === "liquidity-collapse";
    const event = {
      type: "geckoterminal-trending-path",
      id: `geckoterminal_trending_path_${digestValue({
        forecastId: forecast.id,
        pathRegistrationId: pathRegistration.id,
        bucketStartedAt,
      }).slice(0, 24)}`,
      pathRuleVersion: GECKOTERMINAL_FAST_NATIVE_PATH_RULE.version,
      pathRegistrationId: pathRegistration.id,
      sourceRuleVersion: forecast.ruleVersion,
      sourceRegistrationId: forecast.registrationId,
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
  return geckoPathResult(
    ledgerPath,
    now,
    bucketStartedAt,
    open.length,
    provider.requestsAttempted,
    observations,
    failures,
  );
}

export function buildGeckoTerminalTrendingScorecard(events) {
  const cohort = validatedGeckoTerminalTrendingRows(events);
  return buildGeckoTerminalScorecard(cohort, GECKOTERMINAL_TRENDING_RULE, {
    type: "geckoterminal-trending-monitoring-scorecard",
    note: "This future-only paper cohort changes the candidate-discovery source while retaining the existing tradability screens, 15-minute cadence, one-hour exact outcome, DEX dual-endpoint execution quote, $100 notional, and 4%/12% cost assumptions. Inspected pre-registration trending rows are excluded and cannot be backfilled.",
  });
}

export function buildGeckoTerminalFastNativeQuoteScorecard(events) {
  const cohort = validatedGeckoTerminalFastNativeQuoteRows(events);
  return buildGeckoTerminalScorecard(cohort, GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE, {
    type: "geckoterminal-five-minute-native-quote-monitoring-scorecard",
    note: "This future-only paper child keeps the five-minute GeckoTerminal rank and changes only entry/exit integrity to exact-pool GeckoTerminal plus DEX Screener direct-pair consensus. The NVDA provider-lag derivation token, its diagnostic forecast, and every forecast not strictly after the scoring registration are excluded. No row can backfill, retune, promote, mutate, or trade.",
  });
}

export function buildGeckoTerminalFastNativeRugCheckHolderScorecard(events) {
  const rule = GECKOTERMINAL_FAST_NATIVE_RUGCHECK_HOLDER_RULE;
  const registration = events.find(matchesFastNativeRugCheckHolderRegistration) ?? null;
  const cohort = validatedGeckoTerminalFastNativeQuoteRows(events);
  const resolutions = new Set(events
    .filter((event) => event.type === "geckoterminal-trending-resolution")
    .map((event) => event.forecastId));
  const evidenceById = new Map(events
    .filter((event) => event.type === "geckoterminal-trending-rugcheck-holder-snapshot")
    .map((event) => [event.id, event]));
  const candidateForecasts = cohort.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
      && Date.parse(forecast.createdAt) > Date.parse(rule.evidenceBoundary)
  ));
  const candidateIds = new Set(candidateForecasts.map((forecast) => forecast.id));
  const evidenceCashCounts = {};
  const observations = [];
  for (const row of cohort.rows) {
    if (!candidateIds.has(row.forecast.id)) continue;
    const evidence = evidenceById.get(row.forecast.rugCheckHolderEvidenceId);
    const evidenceReason = geckoRugCheckHolderEvidenceReason({
      forecast: row.forecast,
      evidence,
      registration,
    });
    if (evidenceReason) increment(evidenceCashCounts, evidenceReason);
    const unknownTop20Pct = evidenceReason ? null : evidence.aggregate.unknownTop20Pct;
    const entryTraded = !evidenceReason
      && Number.isFinite(unknownTop20Pct)
      && unknownTop20Pct <= rule.maximumUnknownTop20PctInclusive;
    observations.push({
      forecastId: row.forecast.id,
      createdAt: row.createdAt,
      chain: row.chain,
      tokenAddress: row.tokenAddress,
      symbol: row.forecast.symbol ?? null,
      grossReturnPct: row.grossReturnPct,
      entryTraded,
      evidenceCashReason: evidenceReason,
      unknownTop20Pct,
      parentBaseReturnPct: row.baseCapacityReturnPct,
      parentStressReturnPct: row.stressCapacityReturnPct,
      childBaseReturnPct: entryTraded ? row.baseCapacityReturnPct : 0,
      childStressReturnPct: entryTraded ? row.stressCapacityReturnPct : 0,
    });
  }
  const frames = independentAssetFrames(observations, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weighted = frames.flat();
  const frameRows = frames.map((frame) => {
    const parentBaseReturnPct = mean(frame.map((row) => row.parentBaseReturnPct));
    const parentStressReturnPct = mean(frame.map((row) => row.parentStressReturnPct));
    const childBaseReturnPct = mean(frame.map((row) => row.childBaseReturnPct));
    const childStressReturnPct = mean(frame.map((row) => row.childStressReturnPct));
    return {
      parentBaseReturnPct,
      parentStressReturnPct,
      childBaseReturnPct,
      childStressReturnPct,
      pairedBaseDeltaPct: childBaseReturnPct - parentBaseReturnPct,
      pairedStressDeltaPct: childStressReturnPct - parentStressReturnPct,
    };
  });
  const traded = weighted.filter((row) => row.entryTraded);
  const tradedFrames = frames.filter((frame) => frame.some((row) => row.entryTraded));
  const uniqueTradedTokens = new Set(traded.map(tokenEdgeAssetKey)).size;
  const childReturns = frameRows.map((row) => row.childBaseReturnPct);
  const childStressReturns = frameRows.map((row) => row.childStressReturnPct);
  const pairedDeltas = frameRows.map((row) => row.pairedBaseDeltaPct);
  const childCi95 = childReturns.length >= 2
    ? bootstrapMeanInterval(childReturns, rule.bootstrapIterations) : [null, null];
  const pairedCi95 = pairedDeltas.length >= 2
    ? bootstrapMeanInterval(pairedDeltas, rule.bootstrapIterations) : [null, null];
  const factor = profitFactor(childReturns);
  const drawdown = maxDrawdownPct(childReturns);
  const largestWinnerShare = largestWinningShare(childReturns);
  const evidenceReady = weighted.length >= rule.minimumMaturedForecasts
    && frames.length >= rule.minimumIndependentFrames
    && uniqueTradedTokens >= rule.minimumUniqueTradedTokens
    && tradedFrames.length >= rule.minimumIndependentTradedFrames
    && traded.length >= rule.minimumTradedObservations;
  return {
    type: "geckoterminal-five-minute-native-quote-rugcheck-holder-concentration-scorecard",
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    researchOnly: true,
    mutationAllowed: false,
    candidateForecasts: candidateForecasts.length,
    openForecasts: candidateForecasts.filter((forecast) => !resolutions.has(forecast.id)).length,
    eligibleResolvedObservations: observations.length,
    portfolioWeightedObservations: weighted.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(observations, frames),
    independentHourlyFrames: frames.length,
    independentTradedFrames: tradedFrames.length,
    uniqueTokens: new Set(weighted.map(tokenEdgeAssetKey)).size,
    uniqueTradedTokens,
    tradedObservations: traded.length,
    cashObservations: weighted.filter((row) => !row.entryTraded).length,
    evidenceCashCounts,
    parentFrameMeanCapacityReturnPct: nullableRound(mean(
      frameRows.map((row) => row.parentBaseReturnPct),
    )),
    parentStressFrameMeanCapacityReturnPct: nullableRound(mean(
      frameRows.map((row) => row.parentStressReturnPct),
    )),
    childFrameMeanCapacityReturnPct: nullableRound(mean(childReturns)),
    childStressFrameMeanCapacityReturnPct: nullableRound(mean(childStressReturns)),
    pairedFrameMeanDeltaPct: nullableRound(mean(pairedDeltas)),
    childBootstrapMeanReturnCi95Pct: childCi95.map(nullableRound),
    pairedBootstrapMeanDeltaCi95Pct: pairedCi95.map(nullableRound),
    profitFactor: nullableRound(factor),
    maxDrawdownPct: nullableRound(drawdown),
    largestWinningFrameShare: nullableRound(largestWinnerShare),
    evidenceStatus: evidenceReady ? "audit-ready" : "collecting",
    evidenceShortfall: {
      observations: Math.max(0, rule.minimumMaturedForecasts - weighted.length),
      independentFrames: Math.max(0, rule.minimumIndependentFrames - frames.length),
      uniqueTradedTokens: Math.max(0, rule.minimumUniqueTradedTokens - uniqueTradedTokens),
      independentTradedFrames: Math.max(0,
        rule.minimumIndependentTradedFrames - tradedFrames.length),
      tradedObservations: Math.max(0, rule.minimumTradedObservations - traded.length),
    },
    provisionalGate: Boolean(
      evidenceReady
        && childCi95[0] > TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct
        && pairedCi95[0] > 0
        && mean(childStressReturns) > 0
        && factor >= TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor
        && drawdown <= TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct
        && Number.isFinite(largestWinnerShare)
        && largestWinnerShare <= TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare
    ),
    observationsDetail: observations,
    note: "This future-only paper child keeps the V3 GeckoTerminal rank, exact entry/exit, horizon, capacity, and cost contracts, and changes only whether complete pre-entry RugCheck evidence has at most 30% known-account-adjusted unknown top-20 ownership. The threshold predates the excluded collapse/winner audit. Missing, late, mismatched, or tampered evidence is cash, never a repaired forecast.",
  };
}

export function buildGeckoTerminalScorecard(cohort, rule, metadata) {
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const baseFrameReturns = frames.map((frame) => mean(
    frame.map((row) => row.baseCapacityReturnPct),
  ));
  const stressFrameReturns = frames.map((frame) => mean(
    frame.map((row) => row.stressCapacityReturnPct),
  ));
  const uniqueTokens = new Set(weightedRows.map(tokenEdgeAssetKey)).size;
  const baseCi = baseFrameReturns.length >= 2
    ? bootstrapMeanInterval(baseFrameReturns, TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations)
    : [null, null];
  const evidenceStatus = weightedRows.length >= TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts
    && frames.length >= TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames
    && uniqueTokens >= TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens
    && frames.length >= TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames
    ? "reviewable" : "collecting";
  const largestWinningFrameShare = largestWinningShare(baseFrameReturns);
  const averageBase = mean(baseFrameReturns);
  const averageStress = mean(stressFrameReturns);
  const factor = profitFactor(baseFrameReturns);
  const drawdown = maxDrawdownPct(baseFrameReturns);
  const provisionalGate = evidenceStatus === "reviewable"
    && baseCi[0] > TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct
    && averageStress > 0
    && factor >= TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor
    && drawdown <= TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct
    && largestWinningFrameShare <= TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare;
  return {
    type: metadata.type,
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: cohort.registration?.id ?? null,
    registeredAt: cohort.registration?.registeredAt ?? null,
    scoringRegistrationId: cohort.scoringRegistration?.id ?? null,
    scoringRegisteredAt: cohort.scoringRegistration?.registeredAt ?? null,
    liquidityScoringRegistrationId: cohort.liquidityScoringRegistration?.id ?? null,
    liquidityScoringRegisteredAt: cohort.liquidityScoringRegistration?.registeredAt ?? null,
    parentRuleVersion: rule.parentRuleVersion,
    changedDimension: rule.changedDimension,
    researchOnly: true,
    mutationAllowed: false,
    candidateForecasts: cohort.forecasts.length,
    openForecasts: cohort.openForecasts,
    eligibleLiveObservations: cohort.rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(cohort.rows, frames),
    independentHourlyFrames: frames.length,
    independentTradedFrames: frames.length,
    uniqueTokens,
    riseRate: roundRatio(
      weightedRows.filter((row) => row.grossReturnPct > 0).length,
      weightedRows.length,
    ),
    netWinRate: roundRatio(
      weightedRows.filter((row) => row.baseCapacityReturnPct > 0).length,
      weightedRows.length,
    ),
    explosion25Count: weightedRows.filter((row) => row.grossReturnPct >= 25).length,
    explosion50Count: weightedRows.filter((row) => row.grossReturnPct >= 50).length,
    explosion100Count: weightedRows.filter((row) => row.grossReturnPct >= 100).length,
    liquidityCollapseCount: weightedRows.filter((row) => (
      row.resolution.status === "liquidity-collapse"
    )).length,
    portfolioAverageCapacityReturnPct: nullableRound(averageBase),
    stressPortfolioAverageCapacityReturnPct: nullableRound(averageStress),
    portfolioBootstrapMeanReturnCi95Pct: baseCi.map(nullableRound),
    profitFactor: nullableRound(factor),
    maxDrawdownPct: nullableRound(drawdown),
    largestWinningFrameShare: nullableRound(largestWinningFrameShare),
    rejectionCounts: cohort.rejectionCounts,
    evidenceStatus,
    evidenceShortfall: {
      observations: Math.max(0,
        TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts - weightedRows.length),
      independentFrames: Math.max(0,
        TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames - frames.length),
      uniqueTokens: Math.max(0, TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens - uniqueTokens),
      independentTradedFrames: Math.max(0,
        TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames - frames.length),
    },
    provisionalGate,
    note: metadata.note,
  };
}

export function validatedGeckoTerminalTrendingRows(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const liquidityScoringRegistration = findGeckoLiquidityCollapseScoringRegistration(events);
  const discoveries = new Map(events
    .filter((event) => event.type === "geckoterminal-trending-discovery")
    .map((event) => [event.id, event]));
  const resolutions = new Map(events
    .filter((event) => event.type === "geckoterminal-trending-resolution")
    .map((event) => [event.forecastId, event]));
  const forecasts = events.filter((event) => (
    event.type === "geckoterminal-trending-forecast"
    && event.registrationId === registration?.id
  ));
  const rejectionCounts = {};
  const rows = [];
  let openForecasts = 0;
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
    if (!resolution) {
      openForecasts += 1;
      continue;
    }
    const reason = trendingRowRejectionReason({
      forecast,
      discovery,
      resolution,
      registration,
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
        roundTripCostPct: GECKOTERMINAL_TRENDING_RULE.baseRoundTripCostPct,
      }),
      stressCapacityReturnPct: resolution.status === "liquidity-collapse"
        ? GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE.collapsedOutcomeGrossReturnPct
        : capacityAdjustedReturnPct({
        grossReturnPct: resolution.grossReturnPct,
        entryLiquidityUsd: forecast.entryLiquidityUsd,
        exitLiquidityUsd: resolution.exitLiquidityUsd,
        paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
        roundTripCostPct: GECKOTERMINAL_TRENDING_RULE.stressRoundTripCostPct,
      }),
      ...forecast.metrics,
    });
  }
  return {
    registration,
    liquidityScoringRegistration,
    forecasts,
    openForecasts,
    rejectionCounts,
    rows,
  };
}

export function validatedGeckoTerminalFastNativeQuoteRows(events) {
  const registration = events.find(matchesFastNativeQuoteRegistration) ?? null;
  const scoringRegistration = events.find(matchesFastNativeScoringRegistration) ?? null;
  const liquidityScoringRegistration = findGeckoLiquidityCollapseScoringRegistration(events);
  const discoveries = new Map(events
    .filter((event) => event.type === "geckoterminal-trending-discovery")
    .map((event) => [event.id, event]));
  const resolutions = new Map(events
    .filter((event) => event.type === "geckoterminal-trending-resolution")
    .map((event) => [event.forecastId, event]));
  const forecasts = events.filter((event) => (
    event.type === "geckoterminal-trending-forecast"
    && event.registrationId === registration?.id
  ));
  const rejectionCounts = {};
  const rows = [];
  let openForecasts = 0;
  for (const forecast of forecasts) {
    const eligibilityReason = nativeScoringEligibilityReason(forecast, scoringRegistration);
    if (eligibilityReason) {
      increment(rejectionCounts, eligibilityReason);
      continue;
    }
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
    if (!resolution) {
      openForecasts += 1;
      continue;
    }
    const reason = nativeTrendingRowRejectionReason({
      forecast,
      discovery,
      resolution,
      registration,
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
        roundTripCostPct: GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE.baseRoundTripCostPct,
      }),
      stressCapacityReturnPct: resolution.status === "liquidity-collapse"
        ? GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE.collapsedOutcomeGrossReturnPct
        : capacityAdjustedReturnPct({
        grossReturnPct: resolution.grossReturnPct,
        entryLiquidityUsd: forecast.entryLiquidityUsd,
        exitLiquidityUsd: resolution.exitLiquidityUsd,
        paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
        roundTripCostPct: GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE.stressRoundTripCostPct,
      }),
      ...forecast.metrics,
    });
  }
  return {
    registration,
    scoringRegistration,
    liquidityScoringRegistration,
    forecasts,
    openForecasts,
    rejectionCounts,
    rows,
  };
}

export function findGeckoLiquidityCollapseScoringRegistration(events) {
  return events.find(matchesLiquidityCollapseScoringRegistration) ?? null;
}

export function findGeckoPriceAgnosticCollapseScoringRegistration(events) {
  return events.find(matchesPriceAgnosticCollapseScoringRegistration) ?? null;
}

export function priceAgnosticCollapseEligibility(forecast, registration) {
  return Boolean(
    registration
      && matchesPriceAgnosticCollapseScoringRegistration(registration)
      && Date.parse(forecast?.createdAt) > Date.parse(registration.registeredAt)
      && Date.parse(forecast?.createdAt)
        > Date.parse(GECKOTERMINAL_PRICE_AGNOSTIC_COLLAPSE_SCORING_RULE.evidenceBoundary),
  );
}

export function geckoLiquidityScoringEligibilityReason(
  forecast,
  liquidityScoringRegistration,
) {
  if (!liquidityScoringRegistration
    || !matchesLiquidityCollapseScoringRegistration(liquidityScoringRegistration)) {
    return "missing-or-invalid-liquidity-scoring-registration";
  }
  if (!(Date.parse(forecast.createdAt)
    > Date.parse(liquidityScoringRegistration.registeredAt))) {
    return "forecast-not-strictly-after-liquidity-scoring-registration";
  }
  return null;
}

function nativeScoringEligibilityReason(forecast, scoringRegistration) {
  if (!scoringRegistration || !matchesFastNativeScoringRegistration(scoringRegistration)) {
    return "missing-or-invalid-scoring-registration";
  }
  if (!(Date.parse(forecast.createdAt) > Date.parse(scoringRegistration.registeredAt))) {
    return "forecast-not-strictly-after-scoring-registration";
  }
  if (GECKOTERMINAL_FAST_NATIVE_SCORING_RULE.excludedDerivationTokenAddresses
    .includes(forecast.tokenAddress)) return "derivation-token-excluded";
  if (GECKOTERMINAL_FAST_NATIVE_SCORING_RULE.excludedDiagnosticForecastIds
    .includes(forecast.id)) return "diagnostic-forecast-excluded";
  return null;
}

function nativeTrendingRowRejectionReason({ forecast, discovery, resolution, registration }) {
  const rule = GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE;
  if (!registration || !matchesFastNativeQuoteRegistration(registration)) {
    return "missing-or-invalid-registration";
  }
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt)
    && Date.parse(forecast.sourceDiscoveryObservedAt) > Date.parse(registration.registeredAt)
    && Date.parse(forecast.sourceDiscoveryObservedAt) > Date.parse(rule.evidenceBoundary))) {
    return "not-strictly-future";
  }
  if (forecast.ruleVersion !== rule.version
    || forecast.predictedRise !== true
    || forecast.decision !== rule.decision
    || forecast.researchOnly !== true || forecast.mutationAllowed !== false) {
    return "forecast-policy-mismatch";
  }
  if (!discovery
    || discovery.registrationId !== registration.id
    || discovery.provider !== rule.sourceProvider
    || discovery.ruleVersion !== rule.version
    || discovery.observedAt !== forecast.sourceDiscoveryObservedAt
    || discovery.researchOnly !== true || discovery.mutationAllowed !== false) {
    return "source-discovery-mismatch";
  }
  const candidate = (discovery.candidates ?? []).find((row) => (
    row.chain === forecast.chain && row.tokenAddress === forecast.tokenAddress
  ));
  if (!validCandidate(candidate, rule)
    || forecast.pairAddress !== candidate.pairAddress
    || canonical(forecast.metrics) !== canonical(candidateMetrics(candidate))) {
    return "source-candidate-mismatch";
  }
  if (forecast.entryObservedAt !== forecast.createdAt
    || Date.parse(forecast.createdAt) - Date.parse(forecast.sourceDiscoveryObservedAt)
      > MAX_CAPTURE_LAG_MS
    || forecast.dueAt !== new Date(Date.parse(forecast.createdAt) + HOUR_MS).toISOString()
    || !validGeckoDexDirectIntegrity(
      forecast.entryProviderPriceIntegrity,
      forecast.entryPriceUsd,
      forecast.entryLiquidityUsd,
      rule,
    )) return "entry-provider-price-integrity-mismatch";
  if (!["observed", "liquidity-collapse"].includes(resolution.status)
    || resolution.ruleVersion !== forecast.ruleVersion
    || resolution.registrationId !== forecast.registrationId
    || resolution.discoveryEventId !== forecast.discoveryEventId
    || resolution.chain !== forecast.chain
    || resolution.tokenAddress !== forecast.tokenAddress
    || resolution.dueAt !== forecast.dueAt
    || resolution.pairAddress !== forecast.pairAddress
    || resolution.entryPriceUsd !== forecast.entryPriceUsd
    || resolution.entryLiquidityUsd !== forecast.entryLiquidityUsd
    || resolution.observationLagMs < 0
    || resolution.observationLagMs > MAX_OUTCOME_LAG_MS
      || resolution.researchOnly !== true || resolution.mutationAllowed !== false) {
    return "resolution-mismatch";
  }
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
  if (!(resolution.exitPriceUsd > 0) || !(resolution.exitLiquidityUsd > 0)
    || resolution.grossReturnPct !== round6(
      ((resolution.exitPriceUsd / forecast.entryPriceUsd) - 1) * 100,
    )) return "resolution-return-mismatch";
  if (!validGeckoDexDirectIntegrity(
    resolution.providerPriceIntegrity,
    resolution.exitPriceUsd,
    resolution.exitLiquidityUsd,
    rule,
  )) return "exit-provider-price-integrity-mismatch";
  return null;
}

function trendingRowRejectionReason({ forecast, discovery, resolution, registration }) {
  if (!registration || !matchesRegistration(registration)) return "missing-or-invalid-registration";
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt)
    && Date.parse(forecast.sourceDiscoveryObservedAt) > Date.parse(registration.registeredAt)
    && Date.parse(forecast.sourceDiscoveryObservedAt)
      > Date.parse(GECKOTERMINAL_TRENDING_RULE.evidenceBoundary))) return "not-strictly-future";
  if (forecast.ruleVersion !== GECKOTERMINAL_TRENDING_RULE.version
    || forecast.predictedRise !== true
    || forecast.decision !== GECKOTERMINAL_TRENDING_RULE.decision
    || forecast.researchOnly !== true || forecast.mutationAllowed !== false) {
    return "forecast-policy-mismatch";
  }
  if (!discovery
    || discovery.registrationId !== registration.id
    || discovery.provider !== GECKOTERMINAL_TRENDING_RULE.sourceProvider
    || discovery.ruleVersion !== GECKOTERMINAL_TRENDING_RULE.version
    || discovery.observedAt !== forecast.sourceDiscoveryObservedAt
    || discovery.researchOnly !== true || discovery.mutationAllowed !== false) {
    return "source-discovery-mismatch";
  }
  const candidate = (discovery.candidates ?? []).find((row) => (
    row.chain === forecast.chain && row.tokenAddress === forecast.tokenAddress
  ));
  if (!validCandidate(candidate)
    || forecast.pairAddress !== candidate.pairAddress
    || canonical(forecast.metrics) !== canonical(candidateMetrics(candidate))) {
    return "source-candidate-mismatch";
  }
  if (forecast.entryObservedAt !== forecast.createdAt
    || Date.parse(forecast.createdAt) - Date.parse(forecast.sourceDiscoveryObservedAt)
      > MAX_CAPTURE_LAG_MS
    || forecast.dueAt !== new Date(Date.parse(forecast.createdAt) + HOUR_MS).toISOString()
    || !validDexPulseStoredProviderPriceIntegrity(
      forecast.entryProviderPriceIntegrity,
      forecast.entryPriceUsd,
      forecast.entryLiquidityUsd,
    )) return "entry-provider-price-integrity-mismatch";
  if (!["observed", "liquidity-collapse"].includes(resolution.status)
    || resolution.ruleVersion !== forecast.ruleVersion
    || resolution.registrationId !== forecast.registrationId
    || resolution.discoveryEventId !== forecast.discoveryEventId
    || resolution.chain !== forecast.chain
    || resolution.tokenAddress !== forecast.tokenAddress
    || resolution.dueAt !== forecast.dueAt
    || resolution.pairAddress !== forecast.pairAddress
    || resolution.entryPriceUsd !== forecast.entryPriceUsd
    || resolution.entryLiquidityUsd !== forecast.entryLiquidityUsd
    || resolution.observationLagMs < 0
    || resolution.observationLagMs > MAX_OUTCOME_LAG_MS
      || resolution.researchOnly !== true || resolution.mutationAllowed !== false) {
    return "resolution-mismatch";
  }
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
  if (!(resolution.exitPriceUsd > 0) || !(resolution.exitLiquidityUsd > 0)
    || resolution.grossReturnPct !== round6(
      ((resolution.exitPriceUsd / forecast.entryPriceUsd) - 1) * 100,
    )) return "resolution-return-mismatch";
  if (!validDexPulseStoredProviderPriceIntegrity(
    resolution.providerPriceIntegrity,
    resolution.exitPriceUsd,
    resolution.exitLiquidityUsd,
  )) return "exit-provider-price-integrity-mismatch";
  return null;
}

function trendingCandidateBlockers(candidate, rule = GECKOTERMINAL_TRENDING_RULE) {
  const screens = rule.candidateScreens;
  const blockers = [];
  if (!candidate.tokenAddress) blockers.push("missing-solana-base-token");
  if (!candidate.pairAddress) blockers.push("missing-pool-address");
  if (!(candidate.priceUsd > 0)) blockers.push("non-positive-price");
  if (!(candidate.pairAgeMinutes >= screens.minimumPairAgeMinutesInclusive)) {
    blockers.push("pair-younger-than-15-minutes");
  }
  if (!(candidate.pairAgeMinutes <= screens.maximumPairAgeHoursInclusive * 60)) {
    blockers.push("pair-older-than-72-hours");
  }
  if (!(candidate.liquidityUsd >= screens.minimumLiquidityUsdInclusive)) {
    blockers.push("liquidity-below-10000");
  }
  if (!(candidate.marketCapUsd >= screens.minimumMarketCapUsdInclusive
    && candidate.marketCapUsd <= screens.maximumMarketCapUsdInclusive)) {
    blockers.push("market-cap-outside-50000-5000000");
  }
  if (!(candidate.volumeH1Usd >= screens.minimumHourlyVolumeUsdInclusive)) {
    blockers.push("one-hour-volume-below-1000");
  }
  if (!within(
    candidate.priceChangeH1Pct,
    screens.minimumHourlyPriceChangePctInclusive,
    screens.maximumHourlyPriceChangePctInclusive,
  )) blockers.push("one-hour-price-change-outside-minus20-to-25");
  if (!within(
    candidate.priceChangeH24Pct,
    screens.minimumDailyPriceChangePctInclusive,
    screens.maximumDailyPriceChangePctInclusive,
  )) blockers.push("daily-price-change-outside-minus50-to-150");
  return blockers;
}

function candidateMetrics(candidate) {
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

function validCandidate(candidate, rule = GECKOTERMINAL_TRENDING_RULE) {
  return candidate?.status === "eligible"
    && candidate.chain === "solana"
    && typeof candidate.tokenAddress === "string" && candidate.tokenAddress.length > 0
    && typeof candidate.pairAddress === "string" && candidate.pairAddress.length > 0
    && candidate.priceUsd > 0 && candidate.liquidityUsd > 0
    && candidate.ruleVersion === rule.version;
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalTrendingRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesFastRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalFastTrendingRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesFastNativeQuoteRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalFastNativeQuoteRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesFastNativeScoringRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalFastNativeScoringRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.scoringRule) === canonical(expected.scoringRule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesFastNativePathRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalFastNativePathRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesFastNativeRugCheckHolderRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalFastNativeRugCheckHolderRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function geckoRugCheckHolderEvidenceReason({ forecast, evidence, registration }) {
  const rule = GECKOTERMINAL_FAST_NATIVE_RUGCHECK_HOLDER_RULE;
  if (!registration || !matchesFastNativeRugCheckHolderRegistration(registration)) {
    return "missing-or-invalid-registration";
  }
  if (forecast.rugCheckHolderRuleVersion !== rule.version
    || forecast.rugCheckHolderRegistrationId !== registration.id
    || forecast.rugCheckHolderRegisteredAt !== registration.registeredAt) {
    return "missing-or-invalid-forecast-link";
  }
  if (!evidence
    || evidence.type !== "geckoterminal-trending-rugcheck-holder-snapshot"
    || evidence.ruleVersion !== rule.version
    || evidence.registrationId !== registration.id
    || evidence.discoveryEventId !== forecast.discoveryEventId
    || evidence.provider !== rule.provider
    || evidence.chain !== forecast.chain
    || evidence.tokenAddress !== forecast.tokenAddress
    || evidence.aggregateOnly !== true
    || evidence.rawIdentitiesRetained !== false
    || evidence.researchOnly !== true
    || evidence.mutationAllowed !== false) {
    return "missing-or-mismatched-exact-mint-evidence";
  }
  const availableAt = Date.parse(evidence.availableAt ?? "");
  const observedAt = Date.parse(evidence.observedAt ?? "");
  const sourceObservedAt = Date.parse(forecast.sourceDiscoveryObservedAt ?? "");
  const createdAt = Date.parse(forecast.createdAt);
  if (!(availableAt > Date.parse(registration.registeredAt)
    && observedAt === sourceObservedAt
    && evidence.observedAt === forecast.sourceDiscoveryObservedAt
    && availableAt >= observedAt
    && availableAt <= createdAt
    && createdAt - availableAt <= rule.maximumEvidenceToForecastLagMinutes * 60_000
    && evidence.availableAt === forecast.rugCheckHolderEvidenceAvailableAt)) {
    return "invalid-evidence-timing";
  }
  const aggregate = canonicalRugCheckMarketStructure(evidence.aggregate);
  if (aggregate.coverage !== "complete"
    || canonical(aggregate) !== canonical(evidence.aggregate)
    || evidence.aggregateDigest !== digestValue(aggregate)) {
    return "invalid-rugcheck-holder-aggregate";
  }
  return null;
}

function matchesLiquidityCollapseScoringRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalLiquidityCollapseScoringRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.scoringRule) === canonical(expected.scoringRule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesPriceAgnosticCollapseScoringRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalPriceAgnosticCollapseScoringRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.scoringRule) === canonical(expected.scoringRule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

async function verifiedLedger(ledgerPath) {
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  return events;
}

function captureResult(ledgerPath, now, status, discoveryEventId, forecasts, metadata = {}) {
  return {
    ledgerPath,
    capturedAt: now.toISOString(),
    status,
    discoveryEventId,
    recordedForecasts: status === "recorded" ? forecasts.length : 0,
    existingForecasts: metadata.existingForecasts ?? 0,
    suppressedOpenTokens: metadata.suppressedOpenTokens ?? 0,
    returnedRows: metadata.returnedRows ?? null,
    eligibleCandidates: metadata.eligibleCandidates ?? null,
    requestsAttempted: metadata.requestsAttempted ?? 0,
    failures: metadata.failures ?? [],
    forecasts: forecasts.map((event) => ({
      id: event.id,
      tokenAddress: event.tokenAddress,
      symbol: event.symbol,
      sourceRank: event.metrics?.sourceRank ?? null,
      dueAt: event.dueAt,
    })),
  };
}

export async function collectDexDirectPairs(tokenAddresses, fetcher) {
  const directPairsByToken = new Map();
  const failures = [];
  let requestsAttempted = 0;
  for (const tokenAddress of tokenAddresses) {
    requestsAttempted += 1;
    try {
      const response = await fetcher(
        `https://api.dexscreener.com/token-pairs/v1/solana/${encodeURIComponent(tokenAddress)}`,
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error(`DEX Screener token-pairs returned HTTP ${response.status}.`);
      const rows = await response.json();
      directPairsByToken.set(tokenAddress, (Array.isArray(rows) ? rows : []).filter((pair) => (
        pair?.baseToken?.address === tokenAddress
      )));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { directPairsByToken, failures, requestsAttempted };
}

function emptyLegacyProvider() {
  return {
    batchPairsByToken: new Map(),
    directPairsByToken: new Map(),
    failures: [],
    requestsAttempted: 0,
  };
}

function emptyNativeProvider() {
  return {
    directPairsByToken: new Map(),
    geckoCandidatesByPair: new Map(),
    failures: [],
    requestsAttempted: 0,
  };
}

export async function collectGeckoPoolDexDirectProvider(forecasts, fetcher) {
  const direct = await collectDexDirectPairs(
    [...new Set(forecasts.map((forecast) => forecast.tokenAddress))],
    fetcher,
  );
  const geckoCandidatesByPair = new Map();
  const failures = [...direct.failures];
  let geckoRequestsAttempted = 0;
  const uniquePairs = new Map(forecasts.map((forecast) => [forecast.pairAddress, forecast]));
  for (const [pairAddress, forecast] of uniquePairs) {
    geckoRequestsAttempted += 1;
    try {
      const response = await fetcher(
        `https://api.geckoterminal.com/api/v2/networks/solana/pools/${encodeURIComponent(pairAddress)}`,
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error(`GeckoTerminal pool returned HTTP ${response.status}.`);
      const payload = await response.json();
      const attributes = payload?.data?.attributes ?? {};
      const returnedPairAddress = text(attributes.address)
        ?? (text(payload?.data?.id)?.startsWith("solana_")
          ? text(payload.data.id).slice("solana_".length) : null);
      if (returnedPairAddress !== pairAddress) {
        failures.push(`GeckoTerminal exact-pool mismatch for ${pairAddress}.`);
        continue;
      }
      geckoCandidatesByPair.set(pairAddress, {
        tokenAddress: forecast.tokenAddress,
        pairAddress,
        priceUsd: positiveNumber(attributes.base_token_price_usd),
        liquidityUsd: nonnegativeNumber(attributes.reserve_in_usd),
      });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    directPairsByToken: direct.directPairsByToken,
    geckoCandidatesByPair,
    failures,
    requestsAttempted: direct.requestsAttempted + geckoRequestsAttempted,
  };
}

export function geckoDexDirectConsensus(candidate, provider, rule) {
  const directPair = (provider.directPairsByToken.get(candidate.tokenAddress) ?? []).find((row) => (
    row?.pairAddress === candidate.pairAddress
  ));
  if (!directPair) return { reason: "exact-pair-missing-from-dex-direct", pair: null, integrity: null };
  const geckoPriceUsd = positiveNumber(candidate.priceUsd);
  const directPriceUsd = positiveNumber(directPair.priceUsd);
  const geckoLiquidityUsd = positiveNumber(candidate.liquidityUsd);
  const directLiquidityUsd = positiveNumber(directPair.liquidity?.usd);
  if (![geckoPriceUsd, directPriceUsd, geckoLiquidityUsd, directLiquidityUsd]
    .every(Number.isFinite)) {
    return { reason: "non-positive-price-or-liquidity", pair: null, integrity: null };
  }
  const priceRatio = Math.max(geckoPriceUsd, directPriceUsd)
    / Math.min(geckoPriceUsd, directPriceUsd);
  if (priceRatio > rule.maximumCrossProviderPriceRatioInclusive) {
    return { reason: "cross-provider-price-disagreement", pair: null, integrity: null };
  }
  const liquidityRatio = Math.max(geckoLiquidityUsd, directLiquidityUsd)
    / Math.min(geckoLiquidityUsd, directLiquidityUsd);
  if (liquidityRatio > rule.maximumCrossProviderLiquidityRatioInclusive) {
    return { reason: "cross-provider-liquidity-disagreement", pair: null, integrity: null };
  }
  const selectedPriceUsd = Math.min(geckoPriceUsd, directPriceUsd);
  const selectedLiquidityUsd = Math.min(geckoLiquidityUsd, directLiquidityUsd);
  return {
    reason: null,
    pair: {
      ...directPair,
      priceUsd: String(selectedPriceUsd),
      liquidity: { ...directPair.liquidity, usd: selectedLiquidityUsd },
    },
    integrity: {
      ruleVersion: "geckoterminal-dex-direct-price-integrity-v1",
      geckoPriceUsd,
      directPriceUsd,
      priceRatio: round6(priceRatio),
      geckoLiquidityUsd,
      directLiquidityUsd,
      liquidityRatio: round6(liquidityRatio),
      selectedQuotePolicy: "lower-price-and-lower-liquidity",
    },
  };
}

export function geckoDexDirectExitAssessment(forecast, provider, rule, options = {}) {
  const gecko = provider.geckoCandidatesByPair?.get(forecast.pairAddress) ?? forecast;
  const directPair = (provider.directPairsByToken.get(forecast.tokenAddress) ?? []).find((row) => (
    row?.pairAddress === forecast.pairAddress
  ));
  if (!directPair) {
    return {
      status: "unavailable",
      reason: "exact-pair-missing-from-dex-direct",
      pair: null,
      integrity: null,
    };
  }
  const geckoPriceUsd = positiveNumber(gecko.priceUsd);
  const directPriceUsd = positiveNumber(directPair.priceUsd);
  const geckoLiquidityUsd = nonnegativeNumber(gecko.liquidityUsd);
  const directLiquidityUsd = nonnegativeNumber(directPair.liquidity?.usd);
  if (![geckoPriceUsd, directPriceUsd, geckoLiquidityUsd, directLiquidityUsd]
    .every(Number.isFinite)) {
    return {
      status: "unavailable",
      reason: "missing-price-or-liquidity",
      pair: null,
      integrity: null,
    };
  }
  const priceRatio = Math.max(geckoPriceUsd, directPriceUsd)
    / Math.min(geckoPriceUsd, directPriceUsd);
  const collapseThreshold = GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE
    .liquidityCollapseThresholdUsdInclusive;
  const bothProvidersNonExecutable = geckoLiquidityUsd <= collapseThreshold
    && directLiquidityUsd <= collapseThreshold;
  const priceAgnosticCollapse = bothProvidersNonExecutable
    && options.allowPriceDisagreementOnCollapse === true;
  if (priceAgnosticCollapse) {
    const selectedPriceUsd = Math.min(geckoPriceUsd, directPriceUsd);
    const selectedLiquidityUsd = Math.min(geckoLiquidityUsd, directLiquidityUsd);
    return {
      status: "liquidity-collapse",
      reason: null,
      pair: {
        ...directPair,
        priceUsd: String(selectedPriceUsd),
        liquidity: { ...directPair.liquidity, usd: selectedLiquidityUsd },
      },
      integrity: {
        ruleVersion: "geckoterminal-dex-direct-zero-liquidity-collapse-v2",
        geckoPriceUsd,
        directPriceUsd,
        priceRatio: round6(priceRatio),
        priceRatioEnforced: false,
        geckoLiquidityUsd,
        directLiquidityUsd,
        maximumProviderLiquidityUsd: Math.max(geckoLiquidityUsd, directLiquidityUsd),
        collapseThresholdUsdInclusive: collapseThreshold,
        selectedQuotePolicy:
          "total-loss-when-both-providers-below-paper-notional-liquidity-price-ratio-diagnostic-only",
      },
    };
  }
  if (priceRatio > rule.maximumCrossProviderPriceRatioInclusive) {
    return {
      status: "unavailable",
      reason: "cross-provider-price-disagreement",
      pair: null,
      integrity: null,
    };
  }
  if (bothProvidersNonExecutable) {
    const selectedPriceUsd = Math.min(geckoPriceUsd, directPriceUsd);
    const selectedLiquidityUsd = Math.min(geckoLiquidityUsd, directLiquidityUsd);
    return {
      status: "liquidity-collapse",
      reason: null,
      pair: {
        ...directPair,
        priceUsd: String(selectedPriceUsd),
        liquidity: { ...directPair.liquidity, usd: selectedLiquidityUsd },
      },
      integrity: {
        ruleVersion: "geckoterminal-dex-direct-liquidity-collapse-v1",
        geckoPriceUsd,
        directPriceUsd,
        priceRatio: round6(priceRatio),
        geckoLiquidityUsd,
        directLiquidityUsd,
        maximumProviderLiquidityUsd: Math.max(geckoLiquidityUsd, directLiquidityUsd),
        collapseThresholdUsdInclusive: collapseThreshold,
        selectedQuotePolicy: "total-loss-when-both-providers-below-paper-notional-liquidity",
      },
    };
  }
  return {
    status: "quoted",
    ...geckoDexDirectConsensus(gecko, provider, rule),
  };
}

export function dexDualEndpointExitAssessment(forecast, provider) {
  const batchPair = (provider.batchPairsByToken.get(forecast.tokenAddress) ?? []).find((row) => (
    row?.pairAddress === forecast.pairAddress
  ));
  const directPair = (provider.directPairsByToken.get(forecast.tokenAddress) ?? []).find((row) => (
    row?.pairAddress === forecast.pairAddress
  ));
  if (!batchPair || !directPair) {
    return {
      status: "unavailable",
      reason: "exact-pair-missing-from-one-endpoint",
      pair: null,
      integrity: null,
    };
  }
  const batchPriceUsd = positiveNumber(batchPair.priceUsd);
  const directPriceUsd = positiveNumber(directPair.priceUsd);
  const batchLiquidityUsd = nonnegativeNumber(batchPair.liquidity?.usd);
  const directLiquidityUsd = nonnegativeNumber(directPair.liquidity?.usd);
  if (![batchPriceUsd, directPriceUsd, batchLiquidityUsd, directLiquidityUsd]
    .every(Number.isFinite)) {
    return {
      status: "unavailable",
      reason: "missing-price-or-liquidity",
      pair: null,
      integrity: null,
    };
  }
  const priceRatio = Math.max(batchPriceUsd, directPriceUsd)
    / Math.min(batchPriceUsd, directPriceUsd);
  if (priceRatio > DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.maximumPriceRatioInclusive) {
    return {
      status: "unavailable",
      reason: "cross-endpoint-price-disagreement",
      pair: null,
      integrity: null,
    };
  }
  const collapseThreshold = GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE
    .liquidityCollapseThresholdUsdInclusive;
  if (batchLiquidityUsd <= collapseThreshold && directLiquidityUsd <= collapseThreshold) {
    const selectedPriceUsd = Math.min(batchPriceUsd, directPriceUsd);
    const selectedLiquidityUsd = Math.min(batchLiquidityUsd, directLiquidityUsd);
    return {
      status: "liquidity-collapse",
      reason: null,
      pair: {
        ...directPair,
        priceUsd: String(selectedPriceUsd),
        liquidity: { ...directPair.liquidity, usd: selectedLiquidityUsd },
      },
      integrity: {
        ruleVersion: "dexscreener-dual-endpoint-liquidity-collapse-v1",
        batchPriceUsd,
        directPriceUsd,
        priceRatio: round6(priceRatio),
        batchLiquidityUsd,
        directLiquidityUsd,
        maximumProviderLiquidityUsd: Math.max(batchLiquidityUsd, directLiquidityUsd),
        collapseThresholdUsdInclusive: collapseThreshold,
        selectedQuotePolicy: "total-loss-when-both-providers-below-paper-notional-liquidity",
      },
    };
  }
  return {
    status: "quoted",
    ...consensusPairForForecast(provider, forecast),
  };
}

export function validGeckoDexDirectIntegrity(
  integrity,
  selectedPriceUsd,
  selectedLiquidityUsd,
  rule,
) {
  if (integrity?.ruleVersion !== "geckoterminal-dex-direct-price-integrity-v1"
    || integrity?.selectedQuotePolicy !== "lower-price-and-lower-liquidity") return false;
  const geckoPriceUsd = positiveNumber(integrity.geckoPriceUsd);
  const directPriceUsd = positiveNumber(integrity.directPriceUsd);
  const geckoLiquidityUsd = positiveNumber(integrity.geckoLiquidityUsd);
  const directLiquidityUsd = positiveNumber(integrity.directLiquidityUsd);
  if (![geckoPriceUsd, directPriceUsd, geckoLiquidityUsd, directLiquidityUsd]
    .every(Number.isFinite)) return false;
  const priceRatio = Math.max(geckoPriceUsd, directPriceUsd)
    / Math.min(geckoPriceUsd, directPriceUsd);
  const liquidityRatio = Math.max(geckoLiquidityUsd, directLiquidityUsd)
    / Math.min(geckoLiquidityUsd, directLiquidityUsd);
  return priceRatio <= rule.maximumCrossProviderPriceRatioInclusive
    && liquidityRatio <= rule.maximumCrossProviderLiquidityRatioInclusive
    && integrity.priceRatio === round6(priceRatio)
    && integrity.liquidityRatio === round6(liquidityRatio)
    && selectedPriceUsd === Math.min(geckoPriceUsd, directPriceUsd)
    && selectedLiquidityUsd === Math.min(geckoLiquidityUsd, directLiquidityUsd);
}

export function validGeckoLiquidityCollapseIntegrity(
  integrity,
  selectedPriceUsd,
  selectedLiquidityUsd,
) {
  const geckoRule = integrity?.ruleVersion
    === "geckoterminal-dex-direct-liquidity-collapse-v1";
  const geckoPriceAgnosticRule = integrity?.ruleVersion
    === "geckoterminal-dex-direct-zero-liquidity-collapse-v2";
  const dexRule = integrity?.ruleVersion
    === "dexscreener-dual-endpoint-liquidity-collapse-v1";
  const expectedPolicy = geckoPriceAgnosticRule
    ? "total-loss-when-both-providers-below-paper-notional-liquidity-price-ratio-diagnostic-only"
    : "total-loss-when-both-providers-below-paper-notional-liquidity";
  if ((!geckoRule && !geckoPriceAgnosticRule && !dexRule)
    || integrity?.selectedQuotePolicy !== expectedPolicy) return false;
  const firstPriceUsd = positiveNumber(
    geckoRule || geckoPriceAgnosticRule
      ? integrity.geckoPriceUsd : integrity.batchPriceUsd,
  );
  const secondPriceUsd = positiveNumber(integrity.directPriceUsd);
  const firstLiquidityUsd = nonnegativeNumber(
    geckoRule || geckoPriceAgnosticRule
      ? integrity.geckoLiquidityUsd : integrity.batchLiquidityUsd,
  );
  const secondLiquidityUsd = nonnegativeNumber(integrity.directLiquidityUsd);
  if (![firstPriceUsd, secondPriceUsd, firstLiquidityUsd, secondLiquidityUsd]
    .every(Number.isFinite)) return false;
  const maximumPriceRatio = geckoRule || geckoPriceAgnosticRule
    ? GECKOTERMINAL_FAST_NATIVE_QUOTE_RULE.maximumCrossProviderPriceRatioInclusive
    : DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.maximumPriceRatioInclusive;
  const priceRatio = Math.max(firstPriceUsd, secondPriceUsd)
    / Math.min(firstPriceUsd, secondPriceUsd);
  const threshold = GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE
    .liquidityCollapseThresholdUsdInclusive;
  return (geckoPriceAgnosticRule
    ? integrity.priceRatioEnforced === false
    : priceRatio <= maximumPriceRatio)
    && integrity.priceRatio === round6(priceRatio)
    && firstLiquidityUsd <= threshold
    && secondLiquidityUsd <= threshold
    && integrity.maximumProviderLiquidityUsd
      === Math.max(firstLiquidityUsd, secondLiquidityUsd)
    && integrity.collapseThresholdUsdInclusive === threshold
    && selectedPriceUsd === Math.min(firstPriceUsd, secondPriceUsd)
    && selectedLiquidityUsd === Math.min(firstLiquidityUsd, secondLiquidityUsd);
}

function resolutionResult(ledgerPath, now, dueForecasts, requestsAttempted, resolutions, failures) {
  return {
    ledgerPath,
    checkedAt: now.toISOString(),
    dueForecasts,
    requestsAttempted,
    recordedResolutions: resolutions.length,
    observed: resolutions.filter((event) => (
      event.status === "observed" || event.status === "liquidity-collapse"
    )).length,
    liquidityCollapses: resolutions.filter((event) => (
      event.status === "liquidity-collapse"
    )).length,
    missed: resolutions.filter((event) => event.status === "missed").length,
    failures,
  };
}

function geckoPathResult(
  ledgerPath,
  now,
  bucketStartedAt,
  pendingForecasts,
  requestsAttempted,
  observations,
  failures,
) {
  return {
    ledgerPath,
    observedAt: now.toISOString(),
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
      grossReturnFromEntryPct: event.grossReturnFromEntryPct,
      observedLiquidityUsd: event.observedLiquidityUsd,
    })),
  };
}

function countValues(values) {
  const counts = {};
  for (const value of values) increment(counts, value);
  return counts;
}

function bootstrapMeanInterval(values, iterations) {
  let state = 0x9e3779b9;
  const random = () => {
    state = ((state * 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const means = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(random() * values.length)];
    }
    means.push(total / values.length);
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

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator : null;
}

function within(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function roundRatio(numerator, denominator) {
  return denominator > 0 ? round6(numerator / denominator) : null;
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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
  if (!["register", "register-fast", "register-fast-native", "register-fast-native-score",
    "register-fast-native-path", "register-fast-native-rugcheck-holder",
    "register-liquidity-collapse-score", "register-price-agnostic-collapse-score",
    "capture", "capture-fast", "capture-fast-native", "capture-fast-native-rugcheck-holder",
    "resolve", "mark-fast-native", "score", "score-fast-native",
    "score-fast-native-rugcheck-holder"]
    .includes(options.command)) {
    throw new Error("Usage: onchain-geckoterminal-trending-monitoring.mjs register|register-fast|register-fast-native|register-fast-native-score|register-fast-native-path|register-fast-native-rugcheck-holder|register-liquidity-collapse-score|register-price-agnostic-collapse-score|capture|capture-fast|capture-fast-native|capture-fast-native-rugcheck-holder|resolve|mark-fast-native|score|score-fast-native|score-fast-native-rugcheck-holder [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerGeckoTerminalTrending(options), null, 2));
    } else if (options.command === "register-fast") {
      console.log(JSON.stringify(await registerGeckoTerminalFastTrending(options), null, 2));
    } else if (options.command === "register-fast-native") {
      console.log(JSON.stringify(await registerGeckoTerminalFastNativeQuote(options), null, 2));
    } else if (options.command === "register-fast-native-score") {
      console.log(JSON.stringify(await registerGeckoTerminalFastNativeScoring(options), null, 2));
    } else if (options.command === "register-fast-native-path") {
      console.log(JSON.stringify(await registerGeckoTerminalFastNativePath(options), null, 2));
    } else if (options.command === "register-fast-native-rugcheck-holder") {
      console.log(JSON.stringify(
        await registerGeckoTerminalFastNativeRugCheckHolder(options),
        null,
        2,
      ));
    } else if (options.command === "register-liquidity-collapse-score") {
      console.log(JSON.stringify(
        await registerGeckoTerminalLiquidityCollapseScoring(options),
        null,
        2,
      ));
    } else if (options.command === "register-price-agnostic-collapse-score") {
      console.log(JSON.stringify(
        await registerGeckoTerminalPriceAgnosticCollapseScoring(options),
        null,
        2,
      ));
    } else if (options.command === "capture") {
      console.log(JSON.stringify(await captureGeckoTerminalTrending(options), null, 2));
    } else if (options.command === "capture-fast") {
      console.log(JSON.stringify(await captureGeckoTerminalFastTrending(options), null, 2));
    } else if (options.command === "capture-fast-native") {
      console.log(JSON.stringify(await captureGeckoTerminalFastNativeQuote(options), null, 2));
    } else if (options.command === "capture-fast-native-rugcheck-holder") {
      console.log(JSON.stringify(
        await captureGeckoTerminalFastNativeRugCheckHolder(options),
        null,
        2,
      ));
    } else if (options.command === "resolve") {
      console.log(JSON.stringify(await resolveGeckoTerminalTrending(options), null, 2));
    } else if (options.command === "mark-fast-native") {
      console.log(JSON.stringify(await markOpenGeckoTerminalFastNativePaths(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: options.command === "score-fast-native"
          ? buildGeckoTerminalFastNativeQuoteScorecard(events)
          : options.command === "score-fast-native-rugcheck-holder"
            ? buildGeckoTerminalFastNativeRugCheckHolderScorecard(events)
            : buildGeckoTerminalTrendingScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
