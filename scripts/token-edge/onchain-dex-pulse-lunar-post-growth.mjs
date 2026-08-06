#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendLedgerEvent, digestValue, readLedger, verifyLedger } from "./onchain-forward-core.mjs";
import { TOKEN_EDGE_EXECUTION_POLICY } from "./onchain-capacity-scorecard.mjs";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  DEX_SURFACE_PULSE_RULE,
  validatedDexSurfacePulseObservationRows,
} from "./onchain-dex-pulse-monitoring.mjs";
import {
  DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE,
  createDexPulseLunarGeminiPostSemanticsRegistrationEvent,
} from "./onchain-dex-pulse-lunar-post-semantics.mjs";
import { LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE } from "./onchain-lunarcrush-provider.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const MAX_LAG_MS = 5 * 60_000;

export const DEX_PULSE_LUNAR_POST_GROWTH_RULE = Object.freeze({
  version: "dex-surface-pulse-lunar-exact-contract-post-growth-panel-v1",
  evidenceBoundary: "2026-08-03T22:56:15.000Z",
  sourceSemanticsRuleVersion: DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE.version,
  sourcePostsRuleVersion: LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE.version,
  changedDimension: "sign-of-exact-contract-post-aggregate-change",
  minimumEvidenceSeparationMs: 10 * 60_000,
  maximumEvidenceLookbackMs: 30 * 60_000,
  screens: Object.freeze([
    Object.freeze({ id: "post-interactions-growing", positiveFields: ["interactionsDelta"] }),
    Object.freeze({ id: "active-post-creators-growing", positiveFields: ["creatorsDelta"] }),
    Object.freeze({ id: "exact-post-count-growing", positiveFields: ["postsDelta"] }),
    Object.freeze({
      id: "post-dispersion-improving",
      negativeFields: ["topPostShareDelta", "postHhiDelta"],
    }),
    Object.freeze({
      id: "post-activity-breadth-growing-consensus",
      positiveFields: ["interactionsDelta", "creatorsDelta", "postsDelta"],
    }),
  ]),
  minimumObservations: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTradedTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  minimumGrowthObservations: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  derivationStatus: "pre-outcome-exact-post-growth-sign-hypotheses-only",
  derivationNote: "This panel was frozen before any Gemini-semantic cohort outcome. It tests only strict signs of change in exact-contract post interactions, anonymous active-creator breadth, returned post count, and interaction dispersion across two later post-registration points. The provider/model audit, both identical-corpus repeats, every prior forecast, and every inspected path are excluded; no magnitude was fitted and Gemini output is not used.",
  researchOnly: true,
  mutationAllowed: false,
});

export const DEX_PULSE_LUNAR_POST_RECENCY_RULE = Object.freeze({
  version: "dex-surface-pulse-lunar-exact-contract-post-recency-panel-v1",
  evidenceBoundary: "2026-08-03T23:03:37.000Z",
  sourceSemanticsRuleVersion: DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE.version,
  sourcePostsRuleVersion: LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE.version,
  screens: Object.freeze([
    Object.freeze({ id: "exact-post-recency-covered", minimumPostCreatedCoverage: 1 }),
    Object.freeze({ id: "any-post-created-within-one-hour", maximumNewestPostAgeMinutes: 60 }),
    Object.freeze({
      id: "quarter-posts-created-within-one-hour",
      minimumPostShareCreatedWithin1h: 0.25,
    }),
    Object.freeze({
      id: "half-posts-created-within-six-hours",
      minimumPostShareCreatedWithin6h: 0.5,
    }),
    Object.freeze({ id: "median-post-age-within-six-hours", maximumMedianPostAgeMinutes: 360 }),
    Object.freeze({
      id: "fresh-distributed-exact-post-swarm",
      minimumPostShareCreatedWithin6h: 0.5,
      minimumPostCount: 10,
      minimumUniqueCreatorCount: 10,
      minimumInteractions24h: 500,
      maximumTopPostInteractionShare: 0.35,
      maximumPostInteractionHhi: 0.2,
    }),
  ]),
  minimumObservations: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTradedTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  minimumQualifyingObservations: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  derivationStatus: "pre-outcome-exact-post-recency-hypotheses-only",
  derivationNote: "The subscribed exact-post endpoint exposes post_created. A no-outcome contract audit confirmed numeric timestamps and found the current LetsPlay corpus was 8.9-16.1 hours old despite high interactions. This panel freezes round one-hour and six-hour freshness windows before any semantic-panel outcome. The audit response, every current point, every prior forecast, and every inspected path are excluded; no return was used.",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseLunarPostGrowthRegistrationEvent(registeredAt = new Date()) {
  const spec = {
    rule: DEX_PULSE_LUNAR_POST_GROWTH_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export async function registerDexPulseLunarPostGrowth(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesSourceRegistration)) {
    throw new Error("Register the Lunar Gemini post-semantics panel before post growth.");
  }
  const proposed = createDexPulseLunarPostGrowthRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(DEX_PULSE_LUNAR_POST_GROWTH_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse Lunar post-growth registration must be after its boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error("Existing DEX pulse Lunar post-growth registration mismatch.");
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

export function createDexPulseLunarPostRecencyRegistrationEvent(registeredAt = new Date()) {
  const spec = {
    rule: DEX_PULSE_LUNAR_POST_RECENCY_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export async function registerDexPulseLunarPostRecency(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesSourceRegistration)) {
    throw new Error("Register the Lunar Gemini post-semantics panel before post recency.");
  }
  const proposed = createDexPulseLunarPostRecencyRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(DEX_PULSE_LUNAR_POST_RECENCY_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse Lunar post-recency registration must be after its boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRecencyRegistration(existing)) {
    throw new Error("Existing DEX pulse Lunar post-recency registration mismatch.");
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

export function buildDexPulseLunarPostGrowthScorecard(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const registrationAt = Date.parse(registration?.registeredAt ?? "");
  const sourceRegistration = events.find(matchesSourceRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const points = validatedPostPoints(events, sourceRegistration);
  const pointsByToken = new Map();
  for (const point of points.rows.filter((point) => (
    Date.parse(point.availableAt) > registrationAt
  ))) {
    const rows = pointsByToken.get(point.tokenAddress) ?? [];
    rows.push(point);
    pointsByToken.set(point.tokenAddress, rows);
  }
  for (const rows of pointsByToken.values()) {
    rows.sort((left, right) => Date.parse(left.availableAt) - Date.parse(right.availableAt));
  }
  const currentByForecastId = new Map();
  const comparisonExclusionCounts = {};
  for (const forecast of pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > registrationAt
  ))) {
    const point = points.rows.find((candidate) => (
      candidate.receipt.id === forecast.lunarcrushGeminiSemanticsEnrichmentReceiptId
      && candidate.posts.id === forecast.lunarcrushGeminiPostsEvidenceId
      && candidate.tokenAddress === forecast.tokenAddress
      && candidate.chain === forecast.chain
      && candidate.discovery.id === forecast.discoveryEventId
      && Date.parse(candidate.availableAt) <= Date.parse(forecast.createdAt)
      && Date.parse(forecast.createdAt) - Date.parse(candidate.availableAt) <= MAX_LAG_MS
    ));
    if (point) currentByForecastId.set(forecast.id, point);
  }
  const observations = pulse.rows.filter((row) => (
    Date.parse(row.createdAt) > registrationAt
  )).map((row) => {
    const current = currentByForecastId.get(row.forecastId);
    if (!current) {
      increment(comparisonExclusionCounts, "missing-valid-current-post-point");
      return growthObservation(row, null, null);
    }
    const currentAt = Date.parse(current.availableAt);
    const prior = [...(pointsByToken.get(row.tokenAddress) ?? [])].reverse().find((candidate) => {
      const separation = currentAt - Date.parse(candidate.availableAt);
      return candidate.posts.id !== current.posts.id
        && candidate.discovery.id !== current.discovery.id
        && separation >= DEX_PULSE_LUNAR_POST_GROWTH_RULE.minimumEvidenceSeparationMs
        && separation <= DEX_PULSE_LUNAR_POST_GROWTH_RULE.maximumEvidenceLookbackMs;
    });
    if (!prior) increment(comparisonExclusionCounts, "missing-valid-prior-post-point");
    return growthObservation(row, current, prior ?? null);
  });
  const frames = independentAssetFrames(observations, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const futureForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > registrationAt
  ));
  return {
    type: "dex-surface-pulse-lunar-exact-contract-post-growth-scorecard",
    ruleVersion: DEX_PULSE_LUNAR_POST_GROWTH_RULE.version,
    evidenceBoundary: DEX_PULSE_LUNAR_POST_GROWTH_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    sourceSemanticsRegistrationId: sourceRegistration?.id ?? null,
    researchOnly: true,
    mutationAllowed: false,
    posthocDerived: false,
    candidateForecasts: futureForecasts.length,
    openForecasts: futureForecasts.filter((forecast) => (
      pulse.openForecastIds.includes(forecast.id)
    )).length,
    eligibleLiveObservations: observations.length,
    eligiblePostComparisons: observations.filter((row) => row.comparisonReady).length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(observations, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    sourcePostPointRejectionCounts: points.rejectionCounts,
    comparisonExclusionCounts,
    parent: summarizeFrames(frames, () => true),
    screens: DEX_PULSE_LUNAR_POST_GROWTH_RULE.screens.map((screen) => (
      screenReport(frames, screen)
    )),
    observationsDetail: observations.filter((row) => row.comparisonReady).map((row) => ({
      forecastId: row.forecastId,
      chain: row.chain,
      tokenAddress: row.tokenAddress,
      symbol: row.forecast.symbol ?? null,
      createdAt: row.createdAt,
      priorEvidenceId: row.priorEvidenceId,
      currentEvidenceId: row.currentEvidenceId,
      evidenceSeparationMs: row.evidenceSeparationMs,
      interactionsDelta: row.interactionsDelta,
      creatorsDelta: row.creatorsDelta,
      postsDelta: row.postsDelta,
      topPostShareDelta: row.topPostShareDelta,
      postHhiDelta: row.postHhiDelta,
      grossReturnPct: row.grossReturnPct,
      baseCapacityReturnPct: row.baseCapacityReturnPct,
      stressCapacityReturnPct: row.stressCapacityReturnPct,
    })),
    note: "Every strictly future pulse stays in the parent. Both exact-post points must be post-registration, privacy-safe, digest-valid, from different discoveries 10-30 minutes apart, and the current point must be linked and available before the forecast. Missing comparisons are challenger cash; Gemini metrics are not used. This multiple-testing panel cannot backfill, promote, mutate, or trade.",
  };
}

export function buildDexPulseLunarPostRecencyScorecard(events) {
  const registration = events.find(matchesRecencyRegistration) ?? null;
  const registrationAt = Date.parse(registration?.registeredAt ?? "");
  const sourceRegistration = events.find(matchesSourceRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const points = validatedPostPoints(events, sourceRegistration);
  const pointByLink = new Map(points.rows.map((point) => [
    `${point.receipt.id}:${point.posts.id}`,
    point,
  ]));
  const pointByForecastId = new Map();
  for (const forecast of pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > registrationAt
  ))) {
    const point = pointByLink.get(
      `${forecast.lunarcrushGeminiSemanticsEnrichmentReceiptId}:${forecast.lunarcrushGeminiPostsEvidenceId}`,
    );
    if (point
      && point.tokenAddress === forecast.tokenAddress
      && point.chain === forecast.chain
      && point.discovery.id === forecast.discoveryEventId
      && Date.parse(point.availableAt) > registrationAt
      && Date.parse(point.availableAt) <= Date.parse(forecast.createdAt)
      && Date.parse(forecast.createdAt) - Date.parse(point.availableAt) <= MAX_LAG_MS) {
      pointByForecastId.set(forecast.id, point);
    }
  }
  const observations = pulse.rows.filter((row) => (
    Date.parse(row.createdAt) > registrationAt
  )).map((row) => postRecencyObservation(row, pointByForecastId.get(row.forecastId)));
  const frames = independentAssetFrames(observations, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const futureForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > registrationAt
  ));
  return {
    type: "dex-surface-pulse-lunar-exact-contract-post-recency-scorecard",
    ruleVersion: DEX_PULSE_LUNAR_POST_RECENCY_RULE.version,
    evidenceBoundary: DEX_PULSE_LUNAR_POST_RECENCY_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    sourceSemanticsRegistrationId: sourceRegistration?.id ?? null,
    researchOnly: true,
    mutationAllowed: false,
    posthocDerived: false,
    candidateForecasts: futureForecasts.length,
    openForecasts: futureForecasts.filter((forecast) => (
      pulse.openForecastIds.includes(forecast.id)
    )).length,
    eligibleLiveObservations: observations.length,
    recencyCoveredObservations: observations.filter((row) => row.postRecencyReady).length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(observations, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    sourcePostPointRejectionCounts: points.rejectionCounts,
    parent: summarizeFrames(frames, () => true),
    screens: DEX_PULSE_LUNAR_POST_RECENCY_RULE.screens.map((screen) => (
      recencyScreenReport(frames, screen)
    )),
    observationsDetail: observations.filter((row) => row.postRecencyReady).map((row) => ({
      forecastId: row.forecastId,
      chain: row.chain,
      tokenAddress: row.tokenAddress,
      symbol: row.forecast.symbol ?? null,
      createdAt: row.createdAt,
      postsEvidenceId: row.postsEvidenceId,
      postCreatedCoverage: row.postCreatedCoverage,
      newestPostAgeMinutes: row.newestPostAgeMinutes,
      medianPostAgeMinutes: row.medianPostAgeMinutes,
      oldestPostAgeMinutes: row.oldestPostAgeMinutes,
      postShareCreatedWithin1h: row.postShareCreatedWithin1h,
      postShareCreatedWithin6h: row.postShareCreatedWithin6h,
      grossReturnPct: row.grossReturnPct,
      baseCapacityReturnPct: row.baseCapacityReturnPct,
      stressCapacityReturnPct: row.stressCapacityReturnPct,
    })),
    note: "Every strictly future pulse stays in the parent. Recency uses only exact post_created timestamps reduced before append relative to collection time. Missing, partial, future-dated, late, mismatched, private, or tampered evidence is challenger cash. The six round predeclared screens cannot backfill, combine post hoc, promote, mutate, or trade.",
  };
}

function postRecencyObservation(row, point) {
  const metrics = point?.posts.postMetrics;
  return {
    ...row,
    postRecencyReady: metrics?.postCreatedCoverage === 1,
    postsEvidenceId: point?.posts.id ?? null,
    postCreatedCoverage: finiteNumber(metrics?.postCreatedCoverage),
    newestPostAgeMinutes: finiteNumber(metrics?.newestPostAgeMinutes),
    medianPostAgeMinutes: finiteNumber(metrics?.medianPostAgeMinutes),
    oldestPostAgeMinutes: finiteNumber(metrics?.oldestPostAgeMinutes),
    postShareCreatedWithin1h: finiteNumber(metrics?.postShareCreatedWithin1h),
    postShareCreatedWithin6h: finiteNumber(metrics?.postShareCreatedWithin6h),
    postCount: finiteNumber(metrics?.postCount),
    uniqueCreatorCount: finiteNumber(metrics?.uniqueCreatorCount),
    interactions24h: finiteNumber(metrics?.interactions24h),
    topPostInteractionShare: finiteNumber(metrics?.topPostInteractionShare),
    postInteractionHhi: finiteNumber(metrics?.postInteractionHhi),
  };
}

function recencyScreenReport(frames, screen) {
  const test = (row) => row.postRecencyReady
    && minimum(row.postCreatedCoverage, screen.minimumPostCreatedCoverage)
    && maximum(row.newestPostAgeMinutes, screen.maximumNewestPostAgeMinutes)
    && minimum(row.postShareCreatedWithin1h, screen.minimumPostShareCreatedWithin1h)
    && minimum(row.postShareCreatedWithin6h, screen.minimumPostShareCreatedWithin6h)
    && maximum(row.medianPostAgeMinutes, screen.maximumMedianPostAgeMinutes)
    && minimum(row.postCount, screen.minimumPostCount)
    && minimum(row.uniqueCreatorCount, screen.minimumUniqueCreatorCount)
    && minimum(row.interactions24h, screen.minimumInteractions24h)
    && maximum(row.topPostInteractionShare, screen.maximumTopPostInteractionShare)
    && maximum(row.postInteractionHhi, screen.maximumPostInteractionHhi);
  const summary = summarizeFrames(frames, test);
  const parentBase = policyFrameReturns(frames, () => true, "baseCapacityReturnPct");
  const screenBase = policyFrameReturns(frames, test, "baseCapacityReturnPct");
  const deltas = screenBase.map((value, index) => value - parentBase[index]);
  const interval = frames.length >= 2
    ? bootstrapMeanInterval(deltas, DEX_PULSE_LUNAR_POST_RECENCY_RULE.bootstrapIterations)
    : [null, null];
  const evidenceShortfall = {
    observations: Math.max(0, DEX_PULSE_LUNAR_POST_RECENCY_RULE.minimumObservations
      - frames.flat().length),
    independentFrames: Math.max(0, DEX_PULSE_LUNAR_POST_RECENCY_RULE.minimumIndependentFrames
      - frames.length),
    uniqueTradedTokens: Math.max(0,
      DEX_PULSE_LUNAR_POST_RECENCY_RULE.minimumUniqueTradedTokens - summary.uniqueTokens),
    independentTradedFrames: Math.max(0,
      DEX_PULSE_LUNAR_POST_RECENCY_RULE.minimumIndependentTradedFrames
        - summary.independentTradedFrames),
    qualifyingObservations: Math.max(0,
      DEX_PULSE_LUNAR_POST_RECENCY_RULE.minimumQualifyingObservations - summary.observations),
  };
  const sufficient = Object.values(evidenceShortfall).every((value) => value === 0);
  return {
    id: screen.id,
    ...summary,
    pairedBootstrapMeanDeltaCi95Pct: interval.map(nullableRound),
    evidenceShortfall,
    provisionalGate: Boolean(
      sufficient
      && summary.screenAverageCapacityReturnPct > 0
      && summary.screenStressCapacityReturnPct > 0
      && interval[0] > 0
      && summary.screenProfitFactor >= DEX_PULSE_LUNAR_POST_RECENCY_RULE.minimumProfitFactor
      && summary.screenMaxDrawdownPct <= DEX_PULSE_LUNAR_POST_RECENCY_RULE.maximumDrawdownPct
      && summary.largestWinningFrameShare
        <= DEX_PULSE_LUNAR_POST_RECENCY_RULE.maximumLargestWinningFrameShare
    ),
  };
}

function validatedPostPoints(events, sourceRegistration) {
  const discoveries = new Map(events.filter((event) => event.type === "discovery")
    .map((event) => [event.id, event]));
  const postsEvents = new Map(events.filter((event) => (
    event.type === "lunarcrush-contract-posts-snapshot"
  )).map((event) => [event.id, event]));
  const rows = [];
  const rejectionCounts = {};
  for (const receipt of events.filter((event) => (
    event.type === "dex-surface-pulse-lunar-gemini-post-semantics-enrichment"
    && event.registrationId === sourceRegistration?.id
  ))) {
    const discovery = discoveries.get(receipt.discoveryEventId);
    for (const link of receipt.evidence ?? []) {
      const posts = postsEvents.get(link.postsEvidenceEventId);
      const reason = postPointRejectionReason({
        receipt,
        link,
        posts,
        discovery,
        sourceRegistration,
      });
      if (reason) increment(rejectionCounts, reason);
      else rows.push({
        chain: posts.chain,
        tokenAddress: posts.tokenAddress,
        availableAt: posts.availableAt,
        receipt,
        discovery,
        posts,
      });
    }
  }
  return { rows, rejectionCounts };
}

function postPointRejectionReason({ receipt, link, posts, discovery, sourceRegistration }) {
  if (!sourceRegistration || !matchesSourceRegistration(sourceRegistration)) {
    return "missing-or-invalid-source-registration";
  }
  if (receipt.status !== "recorded"
    || receipt.ruleVersion !== DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE.version
    || receipt.registrationId !== sourceRegistration.id
    || receipt.rawPostsRetained !== false
    || receipt.rawPostTextRetained !== false
    || receipt.rawModelResponsesRetained !== false
    || receipt.researchOnly !== true
    || receipt.mutationAllowed !== false) return "invalid-semantic-source-receipt";
  if (!posts
    || link.postsEvidenceEventId !== posts.id
    || link.postsMetricsDigest !== posts.postMetricsDigest
    || link.postCorpusDigest !== posts.postCorpusDigest
    || posts.status !== "ready"
    || posts.type !== "lunarcrush-contract-posts-snapshot"
    || posts.ruleVersion !== LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE.version
    || posts.registrationId !== sourceRegistration.id
    || posts.discoveryEventId !== receipt.discoveryEventId
    || posts.identity?.matchStatus !== "exact-contract-post-config"
    || posts.postMetricsDigest !== digestValue(posts.postMetrics)
    || typeof posts.postCorpusDigest !== "string"
    || !Number.isInteger(posts.semanticPostCount)
    || posts.semanticPostCount <= 0
    || posts.aggregateOnly !== true
    || posts.rawPostsRetained !== false
    || posts.rawPostTextRetained !== false
    || posts.rawCreatorIdentitiesRetained !== false
    || posts.rawCreatorIdsRetained !== false
    || posts.researchOnly !== true
    || posts.mutationAllowed !== false) return "invalid-exact-contract-post-point";
  if (!discovery
    || discovery.provider !== DEX_SURFACE_PULSE_RULE.sourceProvider
    || discovery.ruleVersion !== DEX_SURFACE_PULSE_RULE.sourceRuleVersion
    || !(discovery.candidates ?? []).some((candidate) => (
      candidate.status === "eligible"
      && candidate.chain === posts.chain
      && candidate.tokenAddress === posts.tokenAddress
    ))) return "invalid-post-point-source-discovery";
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  const collectionAt = Date.parse(posts.collectionStartedAt ?? "");
  const availableAt = Date.parse(posts.availableAt ?? "");
  const receiptAt = Date.parse(receipt.availableAt ?? "");
  if (!(collectionAt >= discoveryAt && collectionAt - discoveryAt <= MAX_LAG_MS
    && availableAt >= collectionAt && availableAt <= receiptAt
    && receiptAt - availableAt <= MAX_LAG_MS)) return "invalid-post-point-timing";
  return null;
}

function growthObservation(row, current, prior) {
  const comparisonReady = Boolean(current && prior);
  const currentMetrics = current?.posts.postMetrics;
  const priorMetrics = prior?.posts.postMetrics;
  return {
    ...row,
    comparisonReady,
    priorEvidenceId: prior?.posts.id ?? null,
    currentEvidenceId: current?.posts.id ?? null,
    evidenceSeparationMs: comparisonReady
      ? Date.parse(current.availableAt) - Date.parse(prior.availableAt) : null,
    interactionsDelta: comparisonReady
      ? currentMetrics.interactions24h - priorMetrics.interactions24h : null,
    creatorsDelta: comparisonReady
      ? currentMetrics.uniqueCreatorCount - priorMetrics.uniqueCreatorCount : null,
    postsDelta: comparisonReady ? currentMetrics.postCount - priorMetrics.postCount : null,
    topPostShareDelta: comparisonReady
      ? currentMetrics.topPostInteractionShare - priorMetrics.topPostInteractionShare : null,
    postHhiDelta: comparisonReady
      ? currentMetrics.postInteractionHhi - priorMetrics.postInteractionHhi : null,
  };
}

function screenReport(frames, screen) {
  const test = (row) => row.comparisonReady
    && (screen.positiveFields ?? []).every((field) => row[field] > 0)
    && (screen.negativeFields ?? []).every((field) => row[field] < 0);
  const summary = summarizeFrames(frames, test);
  const parentBase = policyFrameReturns(frames, () => true, "baseCapacityReturnPct");
  const screenBase = policyFrameReturns(frames, test, "baseCapacityReturnPct");
  const deltas = screenBase.map((value, index) => value - parentBase[index]);
  const interval = frames.length >= 2
    ? bootstrapMeanInterval(deltas, DEX_PULSE_LUNAR_POST_GROWTH_RULE.bootstrapIterations)
    : [null, null];
  const evidenceShortfall = {
    observations: Math.max(0, DEX_PULSE_LUNAR_POST_GROWTH_RULE.minimumObservations
      - frames.flat().length),
    independentFrames: Math.max(0, DEX_PULSE_LUNAR_POST_GROWTH_RULE.minimumIndependentFrames
      - frames.length),
    uniqueTradedTokens: Math.max(0,
      DEX_PULSE_LUNAR_POST_GROWTH_RULE.minimumUniqueTradedTokens - summary.uniqueTokens),
    independentTradedFrames: Math.max(0,
      DEX_PULSE_LUNAR_POST_GROWTH_RULE.minimumIndependentTradedFrames
        - summary.independentTradedFrames),
    growthObservations: Math.max(0,
      DEX_PULSE_LUNAR_POST_GROWTH_RULE.minimumGrowthObservations - summary.observations),
  };
  const sufficient = Object.values(evidenceShortfall).every((value) => value === 0);
  return {
    id: screen.id,
    positiveFields: screen.positiveFields ?? [],
    negativeFields: screen.negativeFields ?? [],
    ...summary,
    pairedBootstrapMeanDeltaCi95Pct: interval.map(nullableRound),
    evidenceShortfall,
    provisionalGate: Boolean(
      sufficient
      && summary.screenAverageCapacityReturnPct > 0
      && summary.screenStressCapacityReturnPct > 0
      && interval[0] > 0
      && summary.screenProfitFactor >= DEX_PULSE_LUNAR_POST_GROWTH_RULE.minimumProfitFactor
      && summary.screenMaxDrawdownPct <= DEX_PULSE_LUNAR_POST_GROWTH_RULE.maximumDrawdownPct
      && summary.largestWinningFrameShare
        <= DEX_PULSE_LUNAR_POST_GROWTH_RULE.maximumLargestWinningFrameShare
    ),
  };
}

function summarizeFrames(frames, test) {
  const selected = frames.flatMap((frame) => frame.filter(test));
  const parentBase = policyFrameReturns(frames, () => true, "baseCapacityReturnPct");
  const parentStress = policyFrameReturns(frames, () => true, "stressCapacityReturnPct");
  const screenBase = policyFrameReturns(frames, test, "baseCapacityReturnPct");
  const screenStress = policyFrameReturns(frames, test, "stressCapacityReturnPct");
  return {
    observations: selected.length,
    independentFrames: frames.length,
    independentTradedFrames: frames.filter((frame) => frame.some(test)).length,
    uniqueTokens: new Set(selected.map(tokenEdgeAssetKey)).size,
    riseRate: nullableRound(selected.length
      ? selected.filter((row) => row.grossReturnPct > 0).length / selected.length : null),
    netWinRate: nullableRound(selected.length
      ? selected.filter((row) => row.baseCapacityReturnPct > 0).length / selected.length : null),
    parentAverageCapacityReturnPct: nullableRound(mean(parentBase)),
    screenAverageCapacityReturnPct: nullableRound(mean(screenBase)),
    pairedCapacityDeltaPct: nullableRound(pairedMean(screenBase, parentBase)),
    parentStressCapacityReturnPct: nullableRound(mean(parentStress)),
    screenStressCapacityReturnPct: nullableRound(mean(screenStress)),
    pairedStressCapacityDeltaPct: nullableRound(pairedMean(screenStress, parentStress)),
    parentProfitFactor: nullableRound(profitFactor(parentBase)),
    screenProfitFactor: nullableRound(profitFactor(screenBase)),
    parentMaxDrawdownPct: nullableRound(maxDrawdownPct(parentBase)),
    screenMaxDrawdownPct: nullableRound(maxDrawdownPct(screenBase)),
    largestWinningFrameShare: nullableRound(largestWinningShare(screenBase)),
  };
}

function policyFrameReturns(frames, test, field) {
  return frames.map((frame) => mean(frame.map((row) => test(row) ? row[field] : 0)));
}

function matchesSourceRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseLunarGeminiPostSemanticsRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseLunarPostGrowthRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesRecencyRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseLunarPostRecencyRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

async function verifiedLedger(ledgerPath) {
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  return events;
}

function bootstrapMeanInterval(values, iterations) {
  let state = 0x3c6ef372;
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

function pairedMean(left, right) {
  return left.length === right.length
    ? mean(left.map((value, index) => value - right[index])) : null;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function minimum(value, threshold) {
  return threshold === undefined || (Number.isFinite(value) && value >= threshold);
}

function maximum(value, threshold) {
  return threshold === undefined || (Number.isFinite(value) && value <= threshold);
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableRound(value) {
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
}

function validIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Expected a valid timestamp.");
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
  if (!["register", "score", "register-recency", "score-recency"].includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-lunar-post-growth.mjs register|score|register-recency|score-recency [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseLunarPostGrowth(options), null, 2));
    } else if (options.command === "register-recency") {
      console.log(JSON.stringify(await registerDexPulseLunarPostRecency(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: options.command === "score-recency"
          ? buildDexPulseLunarPostRecencyScorecard(events)
          : buildDexPulseLunarPostGrowthScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
