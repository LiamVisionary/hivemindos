import { findChallengerRegistration } from "./onchain-challenger-scorecard.mjs";
import {
  DEX_EARLY_SURFACE_RULE,
  satisfiesDexEarlySurfaceRule,
} from "./onchain-dex-early-rule.mjs";
import {
  LUNARCRUSH_MAX_EVIDENCE_AVAILABILITY_LAG_MS,
  LUNARCRUSH_MOVE_ALERT_RULE,
  LUNARCRUSH_SOLANA_DISCOVERY_RULE,
  satisfiesLunarCrushSolanaDiscoveryRule,
} from "./onchain-lunarcrush-provider.mjs";

export const TOKEN_EDGE_LIQUIDITY_CHALLENGER_MODEL_VERSION = "frozen-onchain-rank-v4-liquidity-cap";
export const TOKEN_EDGE_LUNARCRUSH_CHALLENGER_MODEL_VERSION = "frozen-onchain-rank-v5-lunarcrush-move-gate";
export const TOKEN_EDGE_LUNARCRUSH_NEXT_DAY_CHALLENGER_MODEL_VERSION = "frozen-onchain-rank-v6-lunarcrush-next-day-move-gate";
export const TOKEN_EDGE_PAIR_AGE_CHALLENGER_MODEL_VERSION = "frozen-onchain-rank-v7-pair-age-window";
export const TOKEN_EDGE_LUNARCRUSH_DISCOVERY_CHALLENGER_MODEL_VERSION = "frozen-onchain-rank-v8-lunarcrush-social-discovery";
export const TOKEN_EDGE_HOURLY_TURNOVER_CHALLENGER_MODEL_VERSION = "frozen-onchain-rank-v9-hourly-turnover-gate";
export const TOKEN_EDGE_SOCIAL_MAGNITUDE_DIRECTION_CHALLENGER_MODEL_VERSION = "frozen-onchain-rank-v10-social-magnitude-direction";
export const TOKEN_EDGE_DEX_EARLY_SURFACE_CHALLENGER_MODEL_VERSION = "frozen-onchain-rank-v11-dex-early-surface";
export const TOKEN_EDGE_DEX_EARLY_SURFACE_6H_CHALLENGER_MODEL_VERSION = "frozen-onchain-rank-v12-dex-early-surface-6h";
export const TOKEN_EDGE_DEX_EARLY_SURFACE_24H_CHALLENGER_MODEL_VERSION = "frozen-onchain-rank-v13-dex-early-surface-24h";
export const TOKEN_EDGE_POSITIVE_MOMENTUM_CHALLENGER_MODEL_VERSION = "frozen-onchain-rank-v14-dex-positive-momentum-gate";
export const TOKEN_EDGE_LUNARCRUSH_CREATOR_DISTRIBUTION_CHALLENGER_MODEL_VERSION = "frozen-onchain-rank-v15-lunarcrush-creator-distribution-gate";
export const TOKEN_EDGE_LUNARCRUSH_AGE_UNBOUNDED_CHALLENGER_MODEL_VERSION = "frozen-onchain-rank-v16-lunarcrush-age-unbounded";
export const TOKEN_EDGE_LUNARCRUSH_DISCOVERY_MAX_LAG_MS = 60 * 60_000;
export const TOKEN_EDGE_LUNARCRUSH_CREATOR_DISTRIBUTION_RULE = Object.freeze({
  version: "lunarcrush-creator-distribution-v1",
  minimumCreatorCountInclusive: 10,
  maximumTopCreatorInteractionShareInclusive: 0.5,
  maximumCreatorInteractionHhiInclusive: 0.35,
  maximumEvidenceLagMs: 10 * 60_000,
});

export const TOKEN_EDGE_CHALLENGERS = Object.freeze([
  {
    modelVersion: TOKEN_EDGE_LIQUIDITY_CHALLENGER_MODEL_VERSION,
    candidateId: "smart-money-liquidity-cap",
    parentModelVersion: "frozen-onchain-rank-v3",
    parentCandidateId: "smart-money-selection",
    horizon: "1h",
    provider: "nansen-token-screener",
    selectionTimeframe: "6h",
    changedDimension: "maximumLiquidityUsd",
    maximumLiquidityUsd: 50_000,
    evidenceBoundary: "2026-08-03T00:04:55.356Z",
    posthocDerived: true,
    hypothesis: "Within verified Nansen 6h selections, pools between the existing $10k floor and a frozen $50k ceiling may preserve enough smart-money pressure to produce positive 1h net expectancy after costs.",
  },
  {
    modelVersion: TOKEN_EDGE_LUNARCRUSH_CHALLENGER_MODEL_VERSION,
    candidateId: "smart-money-exact-mint-social-move-gate",
    parentModelVersion: "frozen-onchain-rank-v3",
    parentCandidateId: "smart-money-selection",
    horizon: "1h",
    provider: "nansen-token-screener",
    selectionTimeframe: "6h",
    changedDimension: "exactMintLunarCrushMoveAlert",
    requiredEvidenceEventType: "lunarcrush-social-snapshot",
    lunarcrushRuleVersion: LUNARCRUSH_MOVE_ALERT_RULE.version,
    lunarcrushRule: LUNARCRUSH_MOVE_ALERT_RULE,
    evidenceBoundary: "2026-08-03T02:03:12.525Z",
    posthocDerived: true,
    hypothesis: "A contract-address-verified LunarCrush attention breakout may identify when the frozen Nansen 6h direction call has enough imminent move risk to clear one-hour costs.",
  },
  {
    modelVersion: TOKEN_EDGE_LUNARCRUSH_NEXT_DAY_CHALLENGER_MODEL_VERSION,
    candidateId: "smart-money-exact-mint-social-move-gate",
    parentModelVersion: "frozen-onchain-rank-v3",
    parentCandidateId: "smart-money-selection",
    horizon: "24h",
    provider: "nansen-token-screener",
    selectionTimeframe: "6h",
    changedDimension: "exactMintLunarCrushMoveAlert24h",
    requiredEvidenceEventType: "lunarcrush-social-snapshot",
    lunarcrushRuleVersion: LUNARCRUSH_MOVE_ALERT_RULE.version,
    lunarcrushRule: LUNARCRUSH_MOVE_ALERT_RULE,
    evidenceBoundary: "2026-08-03T05:01:06.416Z",
    posthocDerived: true,
    hypothesis: "The exact-mint LunarCrush move-risk gate may align better with the independently confirmed next-day absolute-move horizon while frozen Nansen 6h evidence continues to supply direction.",
  },
  {
    modelVersion: TOKEN_EDGE_PAIR_AGE_CHALLENGER_MODEL_VERSION,
    candidateId: "smart-money-pair-age-window",
    parentModelVersion: "frozen-onchain-rank-v3",
    parentCandidateId: "smart-money-selection",
    horizon: "1h",
    provider: "nansen-token-screener",
    selectionTimeframe: "6h",
    changedDimension: "pairAgeHoursWindow",
    minimumPairAgeHoursInclusive: 2,
    maximumPairAgeHoursExclusive: 24,
    evidenceBoundary: "2026-08-03T05:30:12.742Z",
    posthocDerived: true,
    posthocDerivation: Object.freeze({
      eligibleObservedForecasts: 3,
      uniqueTokens: 3,
      netWins: 3,
      meanNetReturnPct: 59.81536,
      medianNetReturnPct: 26.334891,
      largestNetReturnPct: 145.818762,
      parallel24hSelectionObservations: 1,
      parallel24hSelectionNetReturnPct: -7.144928,
      warning: "Tiny, winner-dominated, post-hoc seed; this registration is a hypothesis, not profit evidence.",
    }),
    hypothesis: "Inside the frozen Nansen 6h parent cohort, pairs at least 2 hours but under 24 hours old may retain enough early attention for the parent direction call to clear one-hour costs more often than older or newly launched pairs.",
  },
  {
    modelVersion: TOKEN_EDGE_LUNARCRUSH_DISCOVERY_CHALLENGER_MODEL_VERSION,
    candidateId: "lunarcrush-social-discovery-rise",
    parentModelVersion: "frozen-onchain-rank-v3",
    parentCandidateId: "market-only-control",
    horizon: "1h",
    provider: "lunarcrush-coin-list",
    selectionTimeframe: "1h",
    changedDimension: "lunarcrushSocialDiscoveryRise",
    lunarcrushDiscoveryRuleVersion: LUNARCRUSH_SOLANA_DISCOVERY_RULE.version,
    lunarcrushDiscoveryRule: LUNARCRUSH_SOLANA_DISCOVERY_RULE,
    evidenceBoundary: "2026-08-03T06:37:48.300Z",
    posthocDerived: false,
    prospectiveDerivation: Object.freeze({
      universeRows: 5_463,
      exactSolanaContracts: 2_161,
      broadScreenedCandidates: 74,
      outcomesObservedBeforeFreeze: 0,
      warning: "The frozen thresholds used one current cross-section but no future return; only later discovery, confirmation, forecast, and outcome events may count.",
    }),
    hypothesis: "A small-cap exact-Solana cohort with sharply improving LunarCrush AltRank and Galaxy Score, minimum social breadth, and strict anti-chase bounds may produce positive one-hour net expectancy after realistic costs.",
  },
  {
    modelVersion: TOKEN_EDGE_HOURLY_TURNOVER_CHALLENGER_MODEL_VERSION,
    candidateId: "smart-money-hourly-turnover-gate",
    parentModelVersion: "frozen-onchain-rank-v3",
    parentCandidateId: "smart-money-selection",
    horizon: "1h",
    provider: "nansen-token-screener",
    selectionTimeframe: "6h",
    changedDimension: "minimumHourlyVolumeToLiquidity",
    minimumHourlyVolumeToLiquidityInclusive: 0.5,
    evidenceBoundary: "2026-08-03T09:09:51.511Z",
    posthocDerived: true,
    posthocDerivation: Object.freeze({
      testedOneDimensionalVariants: 160,
      eligibleObservedForecasts: 18,
      independentSignalFrames: 5,
      uniqueTokens: 7,
      selectedGateObservations: 7,
      selectedGateTradedFrames: 4,
      selectedGateUniqueTokens: 4,
      selectedGateBaseCostFrameMeanPct: 1.182082,
      selectedGateStressCostFrameMeanPct: -1.964584,
      warning: "Multiple-tested, tiny post-hoc seed that fails the 12% stress cost; this registration is a hypothesis, not profit evidence.",
    }),
    hypothesis: "Within verified Nansen 6h selections, requiring trailing one-hour DEX volume to equal at least half of current pool liquidity may reject low-turnover direction calls that cannot clear one-hour costs.",
  },
  {
    modelVersion: TOKEN_EDGE_SOCIAL_MAGNITUDE_DIRECTION_CHALLENGER_MODEL_VERSION,
    candidateId: "smart-money-social-magnitude-gate",
    parentModelVersion: "frozen-onchain-rank-v3",
    parentCandidateId: "smart-money-selection",
    horizon: "1h",
    provider: "nansen-token-screener",
    selectionTimeframe: "6h",
    changedDimension: "lunarcrushDiscoveryMagnitudeGate",
    requiredEvidenceEventType: "discovery",
    magnitudeProvider: "lunarcrush-coin-list",
    magnitudeRuleVersion: LUNARCRUSH_SOLANA_DISCOVERY_RULE.version,
    magnitudeRule: LUNARCRUSH_SOLANA_DISCOVERY_RULE,
    maximumMagnitudeEvidenceLagMs: TOKEN_EDGE_LUNARCRUSH_DISCOVERY_MAX_LAG_MS,
    evidenceBoundary: "2026-08-03T09:47:45.300Z",
    posthocDerived: true,
    posthocDerivation: Object.freeze({
      largeCapProspectiveFrames: 49,
      cleanSocialAbsoluteMoveDeltaPct: 0.080539,
      cleanSocialPairedBootstrapCi95Pct: [0.02018, 0.152478],
      providerSocialAbsoluteMoveDeltaPct: 0.07962,
      providerSocialPairedBootstrapCi95Pct: [0.018392, 0.149856],
      knownSmallCapIntersectionOutcomesBeforeFreeze: 0,
      warning: "Post-hoc target switch from direction to absolute move; the positive magnitude delta cannot count as direction or profit evidence, and the already observed OnlyMarms path is excluded.",
    }),
    hypothesis: "A fresh exact-token LunarCrush social-discovery candidate may identify enough imminent move magnitude to clear costs, while the independently frozen Nansen 6h parent supplies direction.",
  },
  {
    modelVersion: TOKEN_EDGE_DEX_EARLY_SURFACE_CHALLENGER_MODEL_VERSION,
    candidateId: "dex-early-surface-rise",
    parentModelVersion: "frozen-onchain-rank-v3",
    parentCandidateId: "market-only-control",
    horizon: "1h",
    provider: "dexscreener-early-surface",
    selectionTimeframe: "5m",
    changedDimension: "dexEarlySurfaceRise",
    dexEarlySurfaceRuleVersion: DEX_EARLY_SURFACE_RULE.version,
    dexEarlySurfaceRule: DEX_EARLY_SURFACE_RULE,
    evidenceBoundary: "2026-08-03T11:14:00.000Z",
    posthocDerived: false,
    prospectiveDerivation: Object.freeze({
      sourceEndpoints: 5,
      firstObservedTokens: 99,
      firstEligibleCandidates: 4,
      outcomesObservedBeforeFreeze: 0,
      excludedDiscoveryEventId: "discovery_ccb4afe0df625e5fb64f31b2",
      warning: "The first cross-section defined the acquisition rule but is excluded; only later discovery, confirmation, forecast, and exact live outcome events may count.",
    }),
    hypothesis: "Recent DEX Screener profile, takeover, ad, or boost surfaces may identify viable small-cap Solana pairs earlier than LunarCrush and Nansen, before their one-hour move has exceeded the frozen anti-chase bound.",
  },
  {
    modelVersion: TOKEN_EDGE_DEX_EARLY_SURFACE_6H_CHALLENGER_MODEL_VERSION,
    candidateId: "dex-early-surface-rise",
    parentModelVersion: "frozen-onchain-rank-v3",
    parentCandidateId: "market-only-control",
    horizon: "6h",
    provider: "dexscreener-early-surface",
    selectionTimeframe: "5m",
    changedDimension: "dexEarlySurfaceRise",
    dexEarlySurfaceRuleVersion: DEX_EARLY_SURFACE_RULE.version,
    dexEarlySurfaceRule: DEX_EARLY_SURFACE_RULE,
    evidenceBoundary: "2026-08-03T11:46:00.000Z",
    posthocDerived: false,
    prospectiveDerivation: Object.freeze({
      sourceModelVersion: TOKEN_EDGE_DEX_EARLY_SURFACE_CHALLENGER_MODEL_VERSION,
      changedDimension: "horizon-only",
      sourceOutcomesObservedBeforeFreeze: 0,
      openSourcePathEventsObservedBeforeFreeze: 13,
      warning: "Open path marks were already visible but no source outcome had matured and no threshold, rank, or direction rule changed. Every earlier discovery, snapshot, forecast, path, and later outcome is excluded.",
    }),
    hypothesis: "The unchanged DEX early-surface signal may lead viable small-cap moves by several hours rather than exactly one hour.",
  },
  {
    modelVersion: TOKEN_EDGE_DEX_EARLY_SURFACE_24H_CHALLENGER_MODEL_VERSION,
    candidateId: "dex-early-surface-rise",
    parentModelVersion: "frozen-onchain-rank-v3",
    parentCandidateId: "market-only-control",
    horizon: "24h",
    provider: "dexscreener-early-surface",
    selectionTimeframe: "5m",
    changedDimension: "dexEarlySurfaceRise",
    dexEarlySurfaceRuleVersion: DEX_EARLY_SURFACE_RULE.version,
    dexEarlySurfaceRule: DEX_EARLY_SURFACE_RULE,
    evidenceBoundary: "2026-08-03T11:46:00.000Z",
    posthocDerived: false,
    prospectiveDerivation: Object.freeze({
      sourceModelVersion: TOKEN_EDGE_DEX_EARLY_SURFACE_CHALLENGER_MODEL_VERSION,
      changedDimension: "horizon-only",
      sourceOutcomesObservedBeforeFreeze: 0,
      openSourcePathEventsObservedBeforeFreeze: 13,
      warning: "Open path marks were already visible but no source outcome had matured and no threshold, rank, or direction rule changed. Every earlier discovery, snapshot, forecast, path, and later outcome is excluded.",
    }),
    hypothesis: "The unchanged DEX early-surface signal may precede a next-day move even when its exact one-hour direction is noisy.",
  },
  {
    modelVersion: TOKEN_EDGE_POSITIVE_MOMENTUM_CHALLENGER_MODEL_VERSION,
    candidateId: "smart-money-positive-momentum-gate",
    parentModelVersion: "frozen-onchain-rank-v3",
    parentCandidateId: "smart-money-selection",
    horizon: "1h",
    provider: "nansen-token-screener",
    selectionTimeframe: "6h",
    changedDimension: "positiveDexHourlyMomentum",
    minimumDexHourlyPriceChangePctExclusive: 0,
    evidenceBoundary: "2026-08-03T13:18:00.000Z",
    posthocDerived: true,
    posthocDerivation: Object.freeze({
      uniqueMissedExplosionOpportunities: 34,
      missedExplosionsWithPositiveEntryMomentum: 24,
      existingBuyPressureMonitorEligibleFrames: 1,
      existingBuyPressureMonitorAvoidedLossPct: 16.751949,
      latestExcludedFalsePositiveGrossReturnPct: -36.149284,
      latestExcludedFalsePositiveEntryHourlyPriceChangePct: -5.9,
      thresholdVariantsTested: 1,
      warning: "The sign-only threshold was frozen after retrospective and one-frame monitoring evidence. It is a coarse falsifiable hypothesis, not a profitable result; all inspected and already-open rows are excluded.",
    }),
    hypothesis: "Within verified Nansen 6h smart-money rise calls, requiring independently observed DEX one-hour price momentum to be strictly positive may avoid falling-knife false positives while still entering before a large move matures.",
  },
  {
    modelVersion: TOKEN_EDGE_LUNARCRUSH_CREATOR_DISTRIBUTION_CHALLENGER_MODEL_VERSION,
    candidateId: "lunarcrush-social-discovery-creator-quality",
    parentModelVersion: TOKEN_EDGE_LUNARCRUSH_DISCOVERY_CHALLENGER_MODEL_VERSION,
    parentCandidateId: "lunarcrush-social-discovery-rise",
    horizon: "1h",
    provider: "lunarcrush-coin-list",
    selectionTimeframe: "1h",
    changedDimension: "lunarcrushCreatorDistributionGate",
    requiredEvidenceEventType: "lunarcrush-creator-aggregate",
    lunarcrushDiscoveryRuleVersion: LUNARCRUSH_SOLANA_DISCOVERY_RULE.version,
    lunarcrushDiscoveryRule: LUNARCRUSH_SOLANA_DISCOVERY_RULE,
    creatorDistributionRuleVersion: TOKEN_EDGE_LUNARCRUSH_CREATOR_DISTRIBUTION_RULE.version,
    minimumCreatorCountInclusive:
      TOKEN_EDGE_LUNARCRUSH_CREATOR_DISTRIBUTION_RULE.minimumCreatorCountInclusive,
    maximumTopCreatorInteractionShareInclusive:
      TOKEN_EDGE_LUNARCRUSH_CREATOR_DISTRIBUTION_RULE.maximumTopCreatorInteractionShareInclusive,
    maximumCreatorInteractionHhiInclusive:
      TOKEN_EDGE_LUNARCRUSH_CREATOR_DISTRIBUTION_RULE.maximumCreatorInteractionHhiInclusive,
    maximumCreatorEvidenceLagMs:
      TOKEN_EDGE_LUNARCRUSH_CREATOR_DISTRIBUTION_RULE.maximumEvidenceLagMs,
    evidenceBoundary: "2026-08-03T16:17:30.000Z",
    posthocDerived: true,
    posthocDerivation: Object.freeze({
      inspectedCreatorAggregates: 2,
      associatedOutcomesObservedBeforeFreeze: 0,
      thresholdVariantsTested: 1,
      excludedOpenToken: "FAUCI",
      warning: "Round creator-distribution bounds were frozen after two aggregate snapshots and an open FAUCI path were inspected. All such evidence and later outcomes are excluded.",
    }),
    hypothesis: "Within exact-contract LunarCrush social discoveries, broadly distributed creator attention may retain social acceleration while reducing single-account promotion risk enough to improve one-hour net expectancy.",
  },
  {
    modelVersion: TOKEN_EDGE_LUNARCRUSH_AGE_UNBOUNDED_CHALLENGER_MODEL_VERSION,
    candidateId: "lunarcrush-social-discovery-age-unbounded",
    parentModelVersion: TOKEN_EDGE_LUNARCRUSH_DISCOVERY_CHALLENGER_MODEL_VERSION,
    parentCandidateId: "lunarcrush-social-discovery-rise",
    horizon: "1h",
    provider: "lunarcrush-coin-list",
    selectionTimeframe: "1h",
    changedDimension: "removeMaximumDexPairAge",
    removedBlocker: "pair older than 30 days",
    executionIntegrityRuleVersion: "token-edge-dex-execution-cross-endpoint-v1",
    maximumExecutionPriceRatioInclusive: 1.1,
    maximumExecutionLiquidityRatioInclusive: 1.25,
    executionQuotePolicy: "lower-price-and-lower-liquidity",
    lunarcrushDiscoveryRuleVersion: LUNARCRUSH_SOLANA_DISCOVERY_RULE.version,
    lunarcrushDiscoveryRule: LUNARCRUSH_SOLANA_DISCOVERY_RULE,
    evidenceBoundary: "2026-08-03T19:07:22.300Z",
    posthocDerived: true,
    posthocDerivation: Object.freeze({
      inspectedCandidates: 2,
      inspectedEligibleWithoutMaximumAge: 1,
      inspectedLargeMoveAlerts: 1,
      excludedTokens: ["MINI", "ALTSZN"],
      outcomesObservedBeforeFreeze: 0,
      thresholdVariantsTested: 1,
      warning: "Coverage intervention derived after inspecting one old-pair exact-mint alert. Both inspected candidates and all associated evidence/outcomes are excluded.",
    }),
    hypothesis: "Removing only the 30-day DEX pair-age ceiling may let exact-contract LunarCrush social discoveries test mature but still liquid markets without weakening liquidity, hourly-volume, anti-chase, identity, or timing gates.",
  },
]);

export function createRegisteredChallengerForecasts(options) {
  const {
    snapshot,
    candidateStates,
    challengerRegistrations,
    additionalEvidenceEvents,
    digestValue,
    horizons,
    roundTripCostPct,
  } = options;
  return TOKEN_EDGE_CHALLENGERS.map((challenger) => {
    const registration = findChallengerRegistration(challenger, challengerRegistrations);
    const parentState = candidateStates[challenger.parentCandidateId]
      ?? candidateStates["market-only-control"];
    if (challenger.changedDimension === "maximumLiquidityUsd") {
      return createLiquidityCapForecast({
        snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct,
      });
    }
    if (challenger.changedDimension === "exactMintLunarCrushMoveAlert"
      || challenger.changedDimension === "exactMintLunarCrushMoveAlert24h") {
      return createLunarCrushMoveGateForecast({
        snapshot,
        parentState,
        challenger,
        registration,
        evidenceEvents: additionalEvidenceEvents,
        digestValue,
        horizons,
        roundTripCostPct,
      });
    }
    if (challenger.changedDimension === "pairAgeHoursWindow") {
      return createPairAgeWindowForecast({
        snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct,
      });
    }
    if (challenger.changedDimension === "lunarcrushSocialDiscoveryRise") {
      return createLunarCrushDiscoveryForecast({
        snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct,
      });
    }
    if (challenger.changedDimension === "lunarcrushCreatorDistributionGate") {
      return createLunarCrushCreatorDistributionForecast({
        snapshot,
        parentState,
        challenger,
        registration,
        evidenceEvents: additionalEvidenceEvents,
        digestValue,
        horizons,
        roundTripCostPct,
      });
    }
    if (challenger.changedDimension === "removeMaximumDexPairAge") {
      return createLunarCrushAgeUnboundedForecast({
        snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct,
      });
    }
    if (challenger.changedDimension === "minimumHourlyVolumeToLiquidity") {
      return createHourlyTurnoverForecast({
        snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct,
      });
    }
    if (challenger.changedDimension === "lunarcrushDiscoveryMagnitudeGate") {
      return createSocialMagnitudeDirectionForecast({
        snapshot,
        parentState,
        challenger,
        registration,
        evidenceEvents: additionalEvidenceEvents,
        digestValue,
        horizons,
        roundTripCostPct,
      });
    }
    if (challenger.changedDimension === "dexEarlySurfaceRise") {
      return createDexEarlySurfaceForecast({
        snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct,
      });
    }
    if (challenger.changedDimension === "positiveDexHourlyMomentum") {
      return createPositiveMomentumForecast({
        snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct,
      });
    }
    throw new Error(`Unsupported token-edge challenger dimension: ${challenger.changedDimension}`);
  });
}

function createLunarCrushAgeUnboundedForecast(options) {
  const {
    snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct,
  } = options;
  const selectionMetrics = snapshot.selection?.metrics ?? {};
  const discoveryMetrics = lunarcrushDiscoveryMetrics(selectionMetrics);
  const discoveryCandidate = {
    ruleVersion: snapshot.selection?.ruleVersion,
    ...discoveryMetrics,
  };
  const retainedParentBlockers = parentState.blockers.filter((blocker) => (
    blocker !== challenger.removedBlocker
  ));
  const blockers = [
    ...commonProspectiveBlockers(
      snapshot,
      { ...parentState, blockers: retainedParentBlockers },
      challenger,
      registration,
    ),
    ...(snapshot.selection?.ruleVersion === challenger.lunarcrushDiscoveryRuleVersion
      ? []
      : ["LunarCrush discovery used a different frozen rule"]),
    ...(satisfiesLunarCrushSolanaDiscoveryRule(discoveryCandidate)
      ? []
      : ["LunarCrush discovery metrics do not satisfy the frozen rule"]),
    ...(validAgeUnboundedEntryIntegrity(snapshot.market, challenger)
      ? []
      : ["cross-endpoint entry execution evidence is invalid"]),
  ];
  const status = blockers.length ? "blocked" : "ready";
  const pairAgeHours = snapshot.market?.pairCreatedAt == null
    ? null
    : (Date.parse(snapshot.observedAt) - snapshot.market.pairCreatedAt) / (60 * 60_000);
  return forecastEvent({
    snapshot,
    challenger,
    registration,
    blockers,
    predictedRise: status === "ready" ? true : null,
    score: status === "ready" ? 0.74 : null,
    predictedRiseProbability: status === "ready" ? 0.64 : null,
    predictedReturnPct: status === "ready" ? 8 : null,
    digestValue,
    horizons,
    roundTripCostPct,
    extraForecast: {
      lunarcrushDiscoveryRuleVersion: challenger.lunarcrushDiscoveryRuleVersion,
      removedMarketBlocker: challenger.removedBlocker,
      pairAgeHours,
      executionIntegrityRuleVersion: challenger.executionIntegrityRuleVersion,
    },
    inputEvidence: {
      ...parentState.inputEvidence,
      provider: snapshot.selection?.provider ?? null,
      timeframe: snapshot.selection?.timeframe ?? null,
      discoveryEventId: snapshot.selection?.discoveryEventId ?? null,
      confirmationEventId: snapshot.selection?.confirmationEventId ?? null,
      discoveryObservedAt: snapshot.selection?.discoveryObservedAt ?? null,
      discoveryAvailableAt: snapshot.selection?.discoveryAvailableAt ?? null,
      confirmationObservedAt: snapshot.selection?.confirmationObservedAt ?? null,
      lunarcrushDiscoveryRuleVersion: snapshot.selection?.ruleVersion ?? null,
      lunarcrushDiscoveryMetrics: discoveryMetrics,
      removedMarketBlocker: challenger.removedBlocker,
      pairAgeHours,
      entryProviderPriceIntegrity: snapshot.market?.providerPriceIntegrity ?? null,
      ...registrationEvidence(registration),
    },
  });
}

function validAgeUnboundedEntryIntegrity(market, challenger) {
  const integrity = market?.providerPriceIntegrity;
  const prices = [integrity?.tokenPairsPriceUsd, integrity?.tokenBatchPriceUsd];
  const liquidities = [
    integrity?.tokenPairsLiquidityUsd,
    integrity?.tokenBatchLiquidityUsd,
  ];
  return integrity?.ruleVersion === challenger.executionIntegrityRuleVersion
    && integrity?.selectedQuotePolicy === challenger.executionQuotePolicy
    && [...prices, ...liquidities].every((value) => Number.isFinite(value) && value > 0)
    && Math.max(...prices) / Math.min(...prices)
      <= challenger.maximumExecutionPriceRatioInclusive
    && Math.max(...liquidities) / Math.min(...liquidities)
      <= challenger.maximumExecutionLiquidityRatioInclusive
    && market.priceUsd === Math.min(...prices)
    && market.liquidityUsd === Math.min(...liquidities);
}

function createPositiveMomentumForecast(options) {
  const {
    snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct,
  } = options;
  const dexHourlyPriceChangePct = snapshot.market?.priceChangePct?.h1;
  const blockers = [
    ...commonProspectiveBlockers(snapshot, parentState, challenger, registration),
    ...(Number.isFinite(dexHourlyPriceChangePct)
      ? []
      : ["DEX one-hour price momentum is unavailable"]),
  ];
  const status = blockers.length ? "blocked" : "ready";
  const parentCallsRise = parentState.status === "ready" && parentState.score > 0.62;
  const clearsMomentumGate = Number.isFinite(dexHourlyPriceChangePct)
    && dexHourlyPriceChangePct > challenger.minimumDexHourlyPriceChangePctExclusive;
  const predictedRise = status === "ready" ? parentCallsRise && clearsMomentumGate : null;
  return forecastEvent({
    snapshot,
    challenger,
    registration,
    blockers,
    predictedRise,
    score: status === "ready" ? (predictedRise ? 0.7 : 0.5) : null,
    predictedRiseProbability: status === "ready" ? (predictedRise ? 0.6 : 0.4) : null,
    predictedReturnPct: status === "ready" ? (predictedRise ? 6.4 : 0) : null,
    digestValue,
    horizons,
    roundTripCostPct,
    extraForecast: {
      dexHourlyPriceChangePct,
      minimumDexHourlyPriceChangePctExclusive:
        challenger.minimumDexHourlyPriceChangePctExclusive,
    },
    inputEvidence: {
      ...parentState.inputEvidence,
      dexHourlyPriceChangePct,
      minimumDexHourlyPriceChangePctExclusive:
        challenger.minimumDexHourlyPriceChangePctExclusive,
      ...registrationEvidence(registration),
      ...selectionTimingEvidence(snapshot),
    },
  });
}

function createDexEarlySurfaceForecast(options) {
  const { snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct } = options;
  const metrics = snapshot.selection?.metrics ?? {};
  const candidate = {
    ruleVersion: snapshot.selection?.ruleVersion ?? null,
    sourceBreadth: metrics.sourceBreadth ?? null,
    pairAgeMinutes: metrics.pairAgeMinutes ?? null,
    liquidityUsd: metrics.discoveryLiquidityUsd ?? null,
    marketCapUsd: metrics.marketCapUsd ?? null,
    volumeH1Usd: metrics.volumeH1Usd ?? null,
    priceChangeH1Pct: metrics.priceChange1hPct ?? null,
    priceChangeH24Pct: metrics.priceChange24hPct ?? null,
  };
  const blockers = [
    ...commonProspectiveBlockers(snapshot, parentState, challenger, registration),
    ...(snapshot.selection?.ruleVersion === challenger.dexEarlySurfaceRuleVersion
      ? []
      : ["DEX early-surface discovery used a different frozen rule"]),
    ...(satisfiesDexEarlySurfaceRule(candidate, challenger.dexEarlySurfaceRule)
      ? []
      : ["DEX early-surface metrics do not satisfy the frozen rule"]),
  ];
  const status = blockers.length ? "blocked" : "ready";
  return forecastEvent({
    snapshot,
    challenger,
    registration,
    blockers,
    predictedRise: status === "ready" ? true : null,
    score: status === "ready" ? 0.7 : null,
    predictedRiseProbability: status === "ready" ? 0.6 : null,
    predictedReturnPct: status === "ready" ? 6.4 : null,
    digestValue,
    horizons,
    roundTripCostPct,
    extraForecast: {
      dexEarlySurfaceRuleVersion: challenger.dexEarlySurfaceRuleVersion,
    },
    inputEvidence: {
      ...parentState.inputEvidence,
      ...registrationEvidence(registration),
      ...selectionTimingEvidence(snapshot),
      provider: snapshot.selection?.provider ?? null,
      timeframe: snapshot.selection?.timeframe ?? null,
      discoveryEventId: snapshot.selection?.discoveryEventId ?? null,
      confirmationEventId: snapshot.selection?.confirmationEventId ?? null,
      discoveryAvailableAt: snapshot.selection?.discoveryAvailableAt ?? null,
      dexEarlySurfaceRuleVersion: challenger.dexEarlySurfaceRuleVersion,
      dexEarlySurfaceMetrics: {
        ...candidate,
        sourceTypes: metrics.sourceTypes ?? [],
        latestBoostAmount: metrics.latestBoostAmount ?? null,
        totalBoostAmount: metrics.totalBoostAmount ?? null,
        hourlyTurnover: metrics.hourlyTurnover ?? null,
        buySellTxnRatio: metrics.buySellTxnRatio ?? null,
        hasWebsite: metrics.hasWebsite ?? null,
        hasTwitter: metrics.hasTwitter ?? null,
      },
    },
  });
}

function createSocialMagnitudeDirectionForecast(options) {
  const {
    snapshot,
    parentState,
    challenger,
    registration,
    evidenceEvents,
    digestValue,
    horizons,
    roundTripCostPct,
  } = options;
  const discovery = latestCompleteLunarDiscovery(evidenceEvents, snapshot, challenger);
  const candidate = discovery?.candidates?.find((row) => (
    row?.status === "eligible"
    && normalize(row.chain) === normalize(snapshot.chain)
    && exactText(row.tokenAddress) === exactText(snapshot.tokenAddress)
  )) ?? null;
  const discoveryAtMs = Date.parse(discovery?.observedAt ?? "");
  const availableAtMs = Date.parse(discovery?.availableAt ?? "");
  const snapshotAtMs = Date.parse(snapshot.observedAt);
  const boundaryMs = Date.parse(challenger.evidenceBoundary);
  const registeredAtMs = Date.parse(registration?.registeredAt ?? "");
  const blockers = [
    ...commonProspectiveBlockers(snapshot, parentState, challenger, registration),
    ...(discovery ? [] : ["fresh complete LunarCrush discovery evidence is missing"]),
    ...(discovery && discovery.universe?.complete !== true
      ? ["LunarCrush discovery universe is incomplete"]
      : []),
    ...(discovery && discovery.ruleVersion !== challenger.magnitudeRuleVersion
      ? ["LunarCrush magnitude discovery used a different frozen rule"]
      : []),
    ...(discovery && ![discoveryAtMs, availableAtMs].every(Number.isFinite)
      ? ["LunarCrush magnitude discovery timing is invalid"]
      : []),
    ...(discovery && Number.isFinite(discoveryAtMs) && discoveryAtMs <= boundaryMs
      ? ["LunarCrush magnitude discovery is not after the evidence boundary"]
      : []),
    ...(discovery && Number.isFinite(discoveryAtMs) && discoveryAtMs <= registeredAtMs
      ? ["LunarCrush magnitude discovery is not after challenger registration"]
      : []),
    ...(discovery && Number.isFinite(availableAtMs) && availableAtMs > snapshotAtMs
      ? ["LunarCrush magnitude discovery was not available before the forecast"]
      : []),
    ...(discovery && Number.isFinite(availableAtMs)
      && snapshotAtMs - availableAtMs > challenger.maximumMagnitudeEvidenceLagMs
      ? ["LunarCrush magnitude discovery is too old"]
      : []),
    ...(candidate && !satisfiesLunarCrushSolanaDiscoveryRule(candidate)
      ? ["LunarCrush magnitude candidate does not satisfy the frozen rule"]
      : []),
  ];
  const uniqueBlockers = [...new Set(blockers)];
  const status = uniqueBlockers.length ? "blocked" : "ready";
  const parentCallsRise = parentState.status === "ready" && parentState.score > 0.62;
  const magnitudeAlert = candidate != null;
  const predictedRise = status === "ready" ? parentCallsRise && magnitudeAlert : null;
  return forecastEvent({
    snapshot,
    challenger,
    registration,
    blockers: uniqueBlockers,
    predictedRise,
    score: status === "ready" ? (predictedRise ? 0.72 : 0.5) : null,
    predictedRiseProbability: status === "ready" ? (predictedRise ? 0.62 : 0.38) : null,
    predictedReturnPct: status === "ready" ? (predictedRise ? 8 : 0) : null,
    digestValue,
    horizons,
    roundTripCostPct,
    extraForecast: {
      additionalEvidenceEventId: discovery?.id ?? null,
      additionalEvidenceDigest: discovery?.digest ?? null,
      additionalEvidenceObservedAt: discovery?.observedAt ?? null,
      additionalEvidenceAvailableAt: discovery?.availableAt ?? null,
      maximumAdditionalEvidenceLagMs: challenger.maximumMagnitudeEvidenceLagMs,
      magnitudeRuleVersion: challenger.magnitudeRuleVersion,
      magnitudeAlert,
    },
    inputEvidence: {
      ...parentState.inputEvidence,
      ...registrationEvidence(registration),
      ...selectionTimingEvidence(snapshot),
      additionalEvidenceEventId: discovery?.id ?? null,
      additionalEvidenceDigest: discovery?.digest ?? null,
      additionalEvidenceObservedAt: discovery?.observedAt ?? null,
      additionalEvidenceAvailableAt: discovery?.availableAt ?? null,
      maximumAdditionalEvidenceLagMs: challenger.maximumMagnitudeEvidenceLagMs,
      magnitudeRuleVersion: challenger.magnitudeRuleVersion,
      magnitudeAlert,
      magnitudeCandidate: candidate ? lunarcrushDiscoveryMetrics(candidate) : null,
    },
  });
}

function createHourlyTurnoverForecast(options) {
  const { snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct } = options;
  const hourlyVolumeUsd = snapshot.market?.volumeUsd?.h1;
  const liquidityUsd = snapshot.market?.liquidityUsd;
  const hourlyVolumeToLiquidity = Number.isFinite(hourlyVolumeUsd) && liquidityUsd > 0
    ? hourlyVolumeUsd / liquidityUsd
    : null;
  const blockers = [
    ...commonProspectiveBlockers(snapshot, parentState, challenger, registration),
    ...(Number.isFinite(hourlyVolumeToLiquidity) ? [] : ["hourly volume-to-liquidity is unavailable"]),
  ];
  const status = blockers.length ? "blocked" : "ready";
  const parentCallsRise = parentState.status === "ready" && parentState.score > 0.62;
  const clearsTurnoverGate = Number.isFinite(hourlyVolumeToLiquidity)
    && hourlyVolumeToLiquidity >= challenger.minimumHourlyVolumeToLiquidityInclusive;
  const predictedRise = status === "ready" ? parentCallsRise && clearsTurnoverGate : null;
  return forecastEvent({
    snapshot,
    challenger,
    registration,
    blockers,
    predictedRise,
    score: status === "ready" ? (predictedRise ? 0.7 : 0.5) : null,
    predictedRiseProbability: status === "ready" ? (predictedRise ? 0.6 : 0.4) : null,
    predictedReturnPct: status === "ready" ? (predictedRise ? 6.4 : 0) : null,
    digestValue,
    horizons,
    roundTripCostPct,
    extraForecast: {
      hourlyVolumeToLiquidity,
      minimumHourlyVolumeToLiquidityInclusive: challenger.minimumHourlyVolumeToLiquidityInclusive,
    },
    inputEvidence: {
      ...parentState.inputEvidence,
      hourlyVolumeUsd,
      currentLiquidityUsd: liquidityUsd,
      hourlyVolumeToLiquidity,
      minimumHourlyVolumeToLiquidityInclusive: challenger.minimumHourlyVolumeToLiquidityInclusive,
      ...registrationEvidence(registration),
      ...selectionTimingEvidence(snapshot),
    },
  });
}

function createLunarCrushDiscoveryForecast(options) {
  const { snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct } = options;
  const selectionMetrics = snapshot.selection?.metrics ?? {};
  const discoveryMetrics = lunarcrushDiscoveryMetrics(selectionMetrics);
  const discoveryCandidate = {
    ruleVersion: snapshot.selection?.ruleVersion,
    ...discoveryMetrics,
  };
  const blockers = [
    ...commonProspectiveBlockers(snapshot, parentState, challenger, registration),
    ...(snapshot.selection?.ruleVersion === challenger.lunarcrushDiscoveryRuleVersion
      ? []
      : ["LunarCrush discovery used a different frozen rule"]),
    ...(satisfiesLunarCrushSolanaDiscoveryRule(discoveryCandidate)
      ? []
      : ["LunarCrush discovery metrics do not satisfy the frozen rule"]),
  ];
  const status = blockers.length ? "blocked" : "ready";
  return forecastEvent({
    snapshot,
    challenger,
    registration,
    blockers,
    predictedRise: status === "ready" ? true : null,
    score: status === "ready" ? 0.74 : null,
    predictedRiseProbability: status === "ready" ? 0.64 : null,
    predictedReturnPct: status === "ready" ? 8 : null,
    digestValue,
    horizons,
    roundTripCostPct,
    extraForecast: {
      lunarcrushDiscoveryRuleVersion: challenger.lunarcrushDiscoveryRuleVersion,
    },
    inputEvidence: {
      ...parentState.inputEvidence,
      provider: snapshot.selection?.provider ?? null,
      timeframe: snapshot.selection?.timeframe ?? null,
      discoveryEventId: snapshot.selection?.discoveryEventId ?? null,
      confirmationEventId: snapshot.selection?.confirmationEventId ?? null,
      discoveryObservedAt: snapshot.selection?.discoveryObservedAt ?? null,
      discoveryAvailableAt: snapshot.selection?.discoveryAvailableAt ?? null,
      confirmationObservedAt: snapshot.selection?.confirmationObservedAt ?? null,
      lunarcrushDiscoveryRuleVersion: snapshot.selection?.ruleVersion ?? null,
      lunarcrushDiscoveryMetrics: discoveryMetrics,
      ...registrationEvidence(registration),
    },
  });
}

function createLunarCrushCreatorDistributionForecast(options) {
  const {
    snapshot,
    parentState,
    challenger,
    registration,
    evidenceEvents,
    digestValue,
    horizons,
    roundTripCostPct,
  } = options;
  const selectionMetrics = snapshot.selection?.metrics ?? {};
  const discoveryMetrics = lunarcrushDiscoveryMetrics(selectionMetrics);
  const discoveryCandidate = {
    ruleVersion: snapshot.selection?.ruleVersion,
    ...discoveryMetrics,
  };
  const evidence = latestMatchingCreatorEvidence(evidenceEvents, snapshot);
  const creatorMetrics = evidence?.creatorMetrics ?? null;
  const evidenceAtMs = Date.parse(evidence?.observedAt ?? "");
  const availableAtMs = Date.parse(evidence?.availableAt ?? "");
  const snapshotAtMs = Date.parse(snapshot.observedAt);
  const registeredAtMs = Date.parse(registration?.registeredAt ?? "");
  const boundaryMs = Date.parse(challenger.evidenceBoundary);
  const exactCreatorEvidence = evidence?.type === challenger.requiredEvidenceEventType
    && evidence.status === "ready"
    && evidence.provider === "lunarcrush"
    && evidence.profile === "social-discovery-creator-aggregate"
    && evidence.sourceDiscoveryEventId === snapshot.selection?.discoveryEventId
    && evidence.universe?.complete === true
    && evidence.identity?.matchStatus === "exact-single-contract-topic-match"
    && normalize(evidence.identity?.network) === normalize(snapshot.chain)
    && exactText(evidence.identity?.contractAddress) === exactText(snapshot.tokenAddress)
    && evidence.identity?.topicUniverseCoinRowCount === 1
    && evidence.topicJoinStatus === "provider-coin-row-exact-contract-unique-topic"
    && evidence.aggregateOnly === true
    && evidence.rawCreatorIdentitiesRetained === false
    && evidence.researchOnly === true
    && evidence.mutationAllowed === false
    && evidence.creatorAggregateDigest === digestValue(creatorMetrics)
    && [evidenceAtMs, availableAtMs, snapshotAtMs, registeredAtMs, boundaryMs].every(Number.isFinite)
    && evidenceAtMs > registeredAtMs
    && evidenceAtMs > boundaryMs
    && evidenceAtMs <= availableAtMs
    && availableAtMs <= snapshotAtMs
    && snapshotAtMs - availableAtMs <= challenger.maximumCreatorEvidenceLagMs;
  const blockers = [
    ...commonProspectiveBlockers(snapshot, parentState, challenger, registration),
    ...(snapshot.selection?.ruleVersion === challenger.lunarcrushDiscoveryRuleVersion
      ? []
      : ["LunarCrush discovery used a different frozen rule"]),
    ...(satisfiesLunarCrushSolanaDiscoveryRule(discoveryCandidate)
      ? []
      : ["LunarCrush discovery metrics do not satisfy the frozen rule"]),
    ...(exactCreatorEvidence ? [] : ["exact future LunarCrush creator evidence is unavailable"]),
  ];
  const status = blockers.length ? "blocked" : "ready";
  const clearsCreatorGate = creatorMetrics != null
    && creatorMetrics.creatorCount >= challenger.minimumCreatorCountInclusive
    && creatorMetrics.topCreatorInteractionShare
      <= challenger.maximumTopCreatorInteractionShareInclusive
    && creatorMetrics.creatorInteractionHhi
      <= challenger.maximumCreatorInteractionHhiInclusive;
  const predictedRise = status === "ready" ? clearsCreatorGate : null;
  return forecastEvent({
    snapshot,
    challenger,
    registration,
    blockers,
    predictedRise,
    score: status === "ready" ? (predictedRise ? 0.74 : 0.5) : null,
    predictedRiseProbability: status === "ready" ? (predictedRise ? 0.64 : 0.36) : null,
    predictedReturnPct: status === "ready" ? (predictedRise ? 8 : 0) : null,
    digestValue,
    horizons,
    roundTripCostPct,
    extraForecast: {
      lunarcrushDiscoveryRuleVersion: challenger.lunarcrushDiscoveryRuleVersion,
      creatorDistributionRuleVersion: challenger.creatorDistributionRuleVersion,
      additionalEvidenceEventId: evidence?.id ?? null,
      additionalEvidenceDigest: evidence?.digest ?? null,
      additionalEvidenceObservedAt: evidence?.observedAt ?? null,
      additionalEvidenceAvailableAt: evidence?.availableAt ?? null,
      creatorAggregateDigest: evidence?.creatorAggregateDigest ?? null,
      minimumCreatorCountInclusive: challenger.minimumCreatorCountInclusive,
      maximumTopCreatorInteractionShareInclusive:
        challenger.maximumTopCreatorInteractionShareInclusive,
      maximumCreatorInteractionHhiInclusive:
        challenger.maximumCreatorInteractionHhiInclusive,
      maximumCreatorEvidenceLagMs: challenger.maximumCreatorEvidenceLagMs,
    },
    inputEvidence: {
      ...parentState.inputEvidence,
      provider: snapshot.selection?.provider ?? null,
      timeframe: snapshot.selection?.timeframe ?? null,
      discoveryEventId: snapshot.selection?.discoveryEventId ?? null,
      confirmationEventId: snapshot.selection?.confirmationEventId ?? null,
      discoveryObservedAt: snapshot.selection?.discoveryObservedAt ?? null,
      discoveryAvailableAt: snapshot.selection?.discoveryAvailableAt ?? null,
      confirmationObservedAt: snapshot.selection?.confirmationObservedAt ?? null,
      lunarcrushDiscoveryRuleVersion: snapshot.selection?.ruleVersion ?? null,
      lunarcrushDiscoveryMetrics: discoveryMetrics,
      creatorDistributionRuleVersion: challenger.creatorDistributionRuleVersion,
      additionalEvidenceEventId: evidence?.id ?? null,
      additionalEvidenceDigest: evidence?.digest ?? null,
      additionalEvidenceObservedAt: evidence?.observedAt ?? null,
      additionalEvidenceAvailableAt: evidence?.availableAt ?? null,
      creatorAggregateDigest: evidence?.creatorAggregateDigest ?? null,
      creatorMetrics,
      minimumCreatorCountInclusive: challenger.minimumCreatorCountInclusive,
      maximumTopCreatorInteractionShareInclusive:
        challenger.maximumTopCreatorInteractionShareInclusive,
      maximumCreatorInteractionHhiInclusive:
        challenger.maximumCreatorInteractionHhiInclusive,
      maximumCreatorEvidenceLagMs: challenger.maximumCreatorEvidenceLagMs,
      ...registrationEvidence(registration),
    },
  });
}

function lunarcrushDiscoveryMetrics(metrics) {
  return {
    lunarcrushCoinId: metrics.lunarcrushCoinId ?? null,
    marketCapUsd: metrics.marketCapUsd ?? null,
    volume24hUsd: metrics.volume24hUsd ?? null,
    interactions24h: metrics.interactions24h ?? null,
    socialVolume24h: metrics.socialVolume24h ?? null,
    altRank: metrics.altRank ?? null,
    altRankPrevious: metrics.altRankPrevious ?? null,
    altRankImprovement: metrics.altRankImprovement ?? null,
    galaxyScore: metrics.galaxyScore ?? null,
    galaxyScorePrevious: metrics.galaxyScorePrevious ?? null,
    galaxyScoreImprovement: metrics.galaxyScoreImprovement ?? null,
    priceChange1hPct: metrics.priceChange1hPct ?? null,
    priceChange24hPct: metrics.priceChange24hPct ?? null,
  };
}

function createLiquidityCapForecast(options) {
  const { snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct } = options;
  const blockers = commonProspectiveBlockers(snapshot, parentState, challenger, registration);
  const status = blockers.length ? "blocked" : "ready";
  const currentLiquidityUsd = snapshot.market.liquidityUsd ?? null;
  const predictedRise = status === "ready" ? currentLiquidityUsd <= challenger.maximumLiquidityUsd : null;
  return forecastEvent({
    snapshot,
    challenger,
    registration,
    blockers,
    predictedRise,
    score: status === "ready" ? (predictedRise ? 0.7 : 0.54) : null,
    predictedRiseProbability: status === "ready" ? (predictedRise ? 0.6 : 0.4) : null,
    predictedReturnPct: status === "ready" ? (predictedRise ? 6.4 : 0) : null,
    digestValue,
    horizons,
    roundTripCostPct,
    extraForecast: { maximumLiquidityUsd: challenger.maximumLiquidityUsd },
    inputEvidence: {
      ...parentState.inputEvidence,
      currentLiquidityUsd,
      maximumLiquidityUsd: challenger.maximumLiquidityUsd,
      ...registrationEvidence(registration),
      ...selectionTimingEvidence(snapshot),
    },
  });
}

function createPairAgeWindowForecast(options) {
  const { snapshot, parentState, challenger, registration, digestValue, horizons, roundTripCostPct } = options;
  const pairCreatedAt = snapshot.market.pairCreatedAt;
  const pairAgeHours = Number.isFinite(pairCreatedAt)
    ? (Date.parse(snapshot.observedAt) - pairCreatedAt) / (60 * 60_000)
    : null;
  const blockers = [
    ...commonProspectiveBlockers(snapshot, parentState, challenger, registration),
    ...(Number.isFinite(pairAgeHours) ? [] : ["pair age is unavailable"]),
  ];
  const status = blockers.length ? "blocked" : "ready";
  const parentCallsRise = parentState.status === "ready" && parentState.score > 0.62;
  const insideWindow = Number.isFinite(pairAgeHours)
    && pairAgeHours >= challenger.minimumPairAgeHoursInclusive
    && pairAgeHours < challenger.maximumPairAgeHoursExclusive;
  const predictedRise = status === "ready" ? parentCallsRise && insideWindow : null;
  return forecastEvent({
    snapshot,
    challenger,
    registration,
    blockers,
    predictedRise,
    score: status === "ready" ? (predictedRise ? 0.7 : 0.5) : null,
    predictedRiseProbability: status === "ready" ? (predictedRise ? 0.6 : 0.4) : null,
    predictedReturnPct: status === "ready" ? (predictedRise ? 6.4 : 0) : null,
    digestValue,
    horizons,
    roundTripCostPct,
    extraForecast: {
      pairAgeHours,
      minimumPairAgeHoursInclusive: challenger.minimumPairAgeHoursInclusive,
      maximumPairAgeHoursExclusive: challenger.maximumPairAgeHoursExclusive,
    },
    inputEvidence: {
      ...parentState.inputEvidence,
      pairAgeHours,
      minimumPairAgeHoursInclusive: challenger.minimumPairAgeHoursInclusive,
      maximumPairAgeHoursExclusive: challenger.maximumPairAgeHoursExclusive,
      ...registrationEvidence(registration),
      ...selectionTimingEvidence(snapshot),
    },
  });
}

function createLunarCrushMoveGateForecast(options) {
  const {
    snapshot,
    parentState,
    challenger,
    registration,
    evidenceEvents,
    digestValue,
    horizons,
    roundTripCostPct,
  } = options;
  const socialEvidence = latestMatchingEvidence(evidenceEvents, snapshot, challenger.requiredEvidenceEventType);
  const evidenceAvailableAtMs = Date.parse(socialEvidence?.availableAt ?? "");
  const evidenceGeneratedAtMs = Date.parse(socialEvidence?.historyGeneratedAt ?? "");
  const snapshotAtMs = Date.parse(snapshot.observedAt);
  const blockers = [
    ...commonProspectiveBlockers(snapshot, parentState, challenger, registration),
    ...(socialEvidence ? [] : ["exact-mint LunarCrush evidence is missing"]),
    ...(socialEvidence?.status === "ready" ? [] : (socialEvidence ? socialEvidence.blockers : [])),
    ...(socialEvidence && !Number.isFinite(evidenceAvailableAtMs)
      ? ["LunarCrush evidence availability time is missing"]
      : []),
    ...(socialEvidence && !Number.isFinite(evidenceGeneratedAtMs)
      ? ["LunarCrush provider generation time is missing"]
      : []),
    ...(socialEvidence && Number.isFinite(evidenceAvailableAtMs) && evidenceAvailableAtMs > snapshotAtMs
      ? ["LunarCrush evidence was not available before the forecast"]
      : []),
    ...(socialEvidence && Number.isFinite(evidenceAvailableAtMs)
      && snapshotAtMs - evidenceAvailableAtMs > LUNARCRUSH_MAX_EVIDENCE_AVAILABILITY_LAG_MS
      ? ["LunarCrush evidence is too old for the forecast collection"]
      : []),
    ...(socialEvidence && Number.isFinite(evidenceGeneratedAtMs) && evidenceGeneratedAtMs > snapshotAtMs
      ? ["LunarCrush provider evidence was generated after the forecast"]
      : []),
    ...(socialEvidence && socialEvidence.ruleVersion !== challenger.lunarcrushRuleVersion
      ? ["LunarCrush evidence used a different frozen rule"]
      : []),
    ...(socialEvidence && socialEvidence.identity?.matchStatus !== "exact-single-contract-match"
      ? ["LunarCrush contract identity is not an exact single match"]
      : []),
    ...(socialEvidence && exactText(socialEvidence.identity?.contractAddress) !== exactText(snapshot.tokenAddress)
      ? ["LunarCrush contract identity does not match the forecast token"]
      : []),
  ];
  const uniqueBlockers = [...new Set(blockers)];
  const status = uniqueBlockers.length ? "blocked" : "ready";
  const parentCallsRise = parentState.status === "ready" && parentState.score > 0.62;
  const moveAlert = socialEvidence?.socialFeatures?.largeMoveAlert === true;
  const predictedRise = status === "ready" ? parentCallsRise && moveAlert : null;
  const decisionPolicy = challenger.changedDimension === "exactMintLunarCrushMoveAlert24h"
    ? {
      riseScore: 0.7,
      riseProbability: 0.6,
      riseReturnPct: 19.2,
      cashScore: 0.5,
      cashProbability: 0.4,
    }
    : {
      riseScore: 0.72,
      riseProbability: 0.62,
      riseReturnPct: 8,
      cashScore: 0.5,
      cashProbability: 0.38,
    };
  return forecastEvent({
    snapshot,
    challenger,
    registration,
    blockers: uniqueBlockers,
    predictedRise,
    score: status === "ready"
      ? (predictedRise ? decisionPolicy.riseScore : decisionPolicy.cashScore)
      : null,
    predictedRiseProbability: status === "ready"
      ? (predictedRise ? decisionPolicy.riseProbability : decisionPolicy.cashProbability)
      : null,
    predictedReturnPct: status === "ready" ? (predictedRise ? decisionPolicy.riseReturnPct : 0) : null,
    digestValue,
    horizons,
    roundTripCostPct,
    extraForecast: {
      additionalEvidenceEventId: socialEvidence?.id ?? null,
      additionalEvidenceDigest: socialEvidence?.digest ?? null,
      additionalEvidenceObservedAt: socialEvidence?.observedAt ?? null,
      additionalEvidenceAvailableAt: socialEvidence?.availableAt ?? null,
      maximumAdditionalEvidenceLagMs: LUNARCRUSH_MAX_EVIDENCE_AVAILABILITY_LAG_MS,
      lunarcrushRuleVersion: challenger.lunarcrushRuleVersion,
    },
    inputEvidence: {
      ...parentState.inputEvidence,
      ...registrationEvidence(registration),
      ...selectionTimingEvidence(snapshot),
      additionalEvidenceEventId: socialEvidence?.id ?? null,
      additionalEvidenceDigest: socialEvidence?.digest ?? null,
      additionalEvidenceObservedAt: socialEvidence?.observedAt ?? null,
      additionalEvidenceAvailableAt: socialEvidence?.availableAt ?? null,
      maximumAdditionalEvidenceLagMs: LUNARCRUSH_MAX_EVIDENCE_AVAILABILITY_LAG_MS,
      lunarcrushRuleVersion: challenger.lunarcrushRuleVersion,
      lunarcrushCoinId: socialEvidence?.identity?.coinId ?? null,
      lunarcrushTopic: socialEvidence?.identity?.topic ?? null,
      lunarcrushContractAddress: socialEvidence?.identity?.contractAddress ?? null,
      socialFeatures: socialEvidence?.socialFeatures ?? null,
    },
  });
}

function forecastEvent(options) {
  const {
    snapshot,
    challenger,
    registration,
    blockers,
    predictedRise,
    score,
    predictedRiseProbability,
    predictedReturnPct,
    digestValue,
    horizons,
    roundTripCostPct,
    extraForecast,
    inputEvidence,
  } = options;
  const createdAtMs = Date.parse(snapshot.observedAt);
  const horizonSpec = horizons[challenger.horizon];
  const status = blockers.length ? "blocked" : "ready";
  const id = `forecast_${digestValue({
    snapshotId: snapshot.id,
    candidateId: challenger.candidateId,
    horizon: challenger.horizon,
    modelVersion: challenger.modelVersion,
  }).slice(0, 24)}`;
  return {
    type: "forecast",
    id,
    snapshotId: snapshot.id,
    createdAt: snapshot.observedAt,
    chain: snapshot.chain,
    tokenAddress: snapshot.tokenAddress,
    symbol: snapshot.market.symbol,
    candidateId: challenger.candidateId,
    horizon: challenger.horizon,
    dueAt: new Date(createdAtMs + horizonSpec.durationMs).toISOString(),
    expiresAt: new Date(createdAtMs + horizonSpec.durationMs + horizonSpec.toleranceMs).toISOString(),
    status,
    blockers,
    modelVersion: challenger.modelVersion,
    parentModelVersion: challenger.parentModelVersion,
    parentCandidateId: challenger.parentCandidateId,
    changedDimension: challenger.changedDimension,
    evidenceBoundary: challenger.evidenceBoundary,
    challengerRegistrationId: registration?.id ?? null,
    challengerRegisteredAt: registration?.registeredAt ?? null,
    posthocDerived: challenger.posthocDerived,
    researchOnly: true,
    hypothesis: challenger.hypothesis,
    decision: status === "ready" ? (predictedRise ? "paper-long" : "paper-cash") : null,
    selectionProvider: snapshot.selection?.provider ?? "unattributed",
    selectionTimeframe: snapshot.selection?.timeframe ?? "unattributed",
    selectionDiscoveryEventId: snapshot.selection?.discoveryEventId ?? null,
    selectionConfirmationEventId: snapshot.selection?.confirmationEventId ?? null,
    score,
    predictedRise,
    predictedRiseProbability,
    predictedReturnPct,
    roundTripCostPct,
    ...extraForecast,
    inputEvidence,
  };
}

function commonProspectiveBlockers(snapshot, parentState, challenger, registration) {
  const createdAtMs = Date.parse(snapshot.observedAt);
  const boundaryMs = Date.parse(challenger.evidenceBoundary);
  const registeredAtMs = Date.parse(registration?.registeredAt ?? "");
  const discoveryAtMs = Date.parse(snapshot.selection?.discoveryObservedAt ?? "");
  const confirmationAtMs = Date.parse(snapshot.selection?.confirmationObservedAt ?? "");
  const selectionMatches = snapshot.selection?.provider === challenger.provider
    && snapshot.selection?.timeframe === challenger.selectionTimeframe;
  return [
    ...parentState.blockers,
    ...(snapshot.selection?.provider === challenger.provider ? [] : [`selection provider is not ${challenger.provider}`]),
    ...(snapshot.selection?.timeframe === challenger.selectionTimeframe ? [] : [`selection timeframe is not ${challenger.selectionTimeframe}`]),
    ...(createdAtMs > boundaryMs ? [] : ["snapshot is not strictly after the challenger evidence boundary"]),
    ...(selectionMatches && !(discoveryAtMs > boundaryMs && confirmationAtMs > boundaryMs)
      ? ["selection lineage is not strictly after the challenger evidence boundary"]
      : []),
    ...(Number.isFinite(registeredAtMs) ? [] : ["challenger registration is missing"]),
    ...(Number.isFinite(registeredAtMs) && createdAtMs <= registeredAtMs
      ? ["snapshot is not strictly after the challenger registration"]
      : []),
    ...(Number.isFinite(registeredAtMs) && selectionMatches
      && !(discoveryAtMs > registeredAtMs && confirmationAtMs > registeredAtMs)
      ? ["selection lineage is not strictly after the challenger registration"]
      : []),
  ];
}

function latestMatchingEvidence(events = [], snapshot, type) {
  return events.filter((event) => (
    event.type === type
    && normalize(event.chain) === normalize(snapshot.chain)
    && exactText(event.tokenAddress) === exactText(snapshot.tokenAddress)
    && Date.parse(event.observedAt) <= Date.parse(snapshot.observedAt)
  )).sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0] ?? null;
}

function latestMatchingCreatorEvidence(events = [], snapshot) {
  return events.filter((event) => (
    event.type === "lunarcrush-creator-aggregate"
    && normalize(event.chain) === normalize(snapshot.chain)
    && exactText(event.tokenAddress) === exactText(snapshot.tokenAddress)
    && event.sourceDiscoveryEventId === snapshot.selection?.discoveryEventId
    && Date.parse(event.availableAt ?? event.observedAt) <= Date.parse(snapshot.observedAt)
  )).sort((left, right) => (
    Date.parse(right.availableAt ?? right.observedAt)
      - Date.parse(left.availableAt ?? left.observedAt)
  ))[0] ?? null;
}

function latestCompleteLunarDiscovery(events = [], snapshot, challenger) {
  return events.filter((event) => (
    event.type === challenger.requiredEvidenceEventType
    && event.provider === challenger.magnitudeProvider
    && normalize(event.chain) === normalize(snapshot.chain)
    && event.universe?.complete === true
    && Date.parse(event.availableAt ?? event.observedAt) <= Date.parse(snapshot.observedAt)
  )).sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0] ?? null;
}

function registrationEvidence(registration) {
  return {
    challengerRegistrationId: registration?.id ?? null,
    challengerRegisteredAt: registration?.registeredAt ?? null,
  };
}

function selectionTimingEvidence(snapshot) {
  return {
    discoveryObservedAt: snapshot.selection?.discoveryObservedAt ?? null,
    confirmationObservedAt: snapshot.selection?.confirmationObservedAt ?? null,
  };
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function exactText(value) {
  return String(value ?? "").trim();
}
