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
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  DEX_SURFACE_PULSE_RULE,
  validatedDexSurfacePulseObservationRows,
} from "./onchain-dex-pulse-monitoring.mjs";
import {
  LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE,
  LUNARCRUSH_EXACT_CONTRACT_TOPIC_STRUCTURE_RULE,
  collectExactMintLunarCrushPostsEvidence,
  collectExactMintLunarCrushTopicStructureEvidence,
} from "./onchain-lunarcrush-provider.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const MAX_LAG_MS = 5 * 60_000;

export const DEX_PULSE_LUNAR_TOPIC_STRUCTURE_RULE = Object.freeze({
  version: "dex-surface-pulse-lunar-exact-contract-topic-structure-panel-v1",
  evidenceBoundary: "2026-08-03T21:51:30.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  sourceStructureRuleVersion: LUNARCRUSH_EXACT_CONTRACT_TOPIC_STRUCTURE_RULE.version,
  provider: "lunarcrush",
  screens: Object.freeze([
    Object.freeze({ id: "exact-contract-topic-structure-covered", requireReady: true }),
    Object.freeze({
      id: "distributed-exact-contract-creators",
      requireReady: true,
      minimumCreatorCount: 10,
      minimumInteractions: 500,
      maximumTopCreatorShare: 0.35,
      maximumCreatorHhi: 0.2,
    }),
    Object.freeze({
      id: "distributed-exact-contract-posts",
      requireReady: true,
      minimumPostCount: 10,
      minimumInteractions: 500,
      maximumTopPostShare: 0.35,
      maximumPostHhi: 0.2,
    }),
    Object.freeze({
      id: "distributed-creator-post-consensus",
      requireReady: true,
      minimumCreatorCount: 10,
      minimumPostCount: 10,
      minimumUniquePostCreators: 10,
      minimumInteractions: 500,
      maximumTopCreatorShare: 0.35,
      maximumCreatorHhi: 0.2,
      maximumTopPostShare: 0.35,
      maximumPostHhi: 0.2,
    }),
    Object.freeze({
      id: "positive-distributed-creator-post-consensus",
      requireReady: true,
      minimumCreatorCount: 10,
      minimumPostCount: 10,
      minimumUniquePostCreators: 10,
      minimumInteractions: 500,
      maximumTopCreatorShare: 0.35,
      maximumCreatorHhi: 0.2,
      maximumTopPostShare: 0.35,
      maximumPostHhi: 0.2,
      minimumSentimentCoverage: 0.8,
      minimumMeanPostSentiment: 3.5,
    }),
  ]),
  derivationStatus: "pre-outcome-exact-contract-structure-hypotheses-only",
  derivationNote: "The Individual-tier exact-mint creator and post routes were confirmed before registration. Creator concentration thresholds are copied unchanged from the earlier frozen creator panel; the same round thresholds are applied to posts. The 3.5 sentiment boundary is the provider's positive-class boundary. DOGE endpoint-audit data, every inspected path, and all forecasts through the evidence boundary are excluded; no outcome or threshold was fitted.",
  researchOnly: true,
  mutationAllowed: false,
});

export const DEX_PULSE_LUNAR_POSTS_RULE = Object.freeze({
  version: "dex-surface-pulse-lunar-exact-contract-posts-panel-v1",
  evidenceBoundary: "2026-08-03T22:02:20.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  sourcePostsRuleVersion: LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE.version,
  provider: "lunarcrush",
  screens: Object.freeze([
    Object.freeze({ id: "exact-contract-posts-covered", requireReady: true }),
    Object.freeze({ id: "at-least-ten-exact-contract-posts", requireReady: true, minimumPostCount: 10 }),
    Object.freeze({ id: "at-least-ten-active-post-creators", requireReady: true, minimumUniquePostCreators: 10 }),
    Object.freeze({ id: "at-least-five-hundred-post-interactions", requireReady: true, minimumInteractions: 500 }),
    Object.freeze({
      id: "distributed-exact-contract-post-swarm",
      requireReady: true,
      minimumPostCount: 10,
      minimumUniquePostCreators: 10,
      minimumInteractions: 500,
      maximumTopPostShare: 0.35,
      maximumPostHhi: 0.2,
    }),
    Object.freeze({
      id: "positive-distributed-exact-contract-post-swarm",
      requireReady: true,
      minimumPostCount: 10,
      minimumUniquePostCreators: 10,
      minimumInteractions: 500,
      maximumTopPostShare: 0.35,
      maximumPostHhi: 0.2,
      minimumSentimentCoverage: 0.8,
      minimumMeanPostSentiment: 3.5,
    }),
  ]),
  derivationStatus: "pre-outcome-exact-contract-post-swarm-hypotheses-only",
  derivationNote: "A pre-outcome provider audit showed creator and post interaction totals can differ because the routes have different row semantics or coverage. This separate one-call panel uses only exact post-config identity and anonymous post/active-creator aggregates. It excludes the audit rows, all open paths, and every earlier forecast. Thresholds are unchanged round breadth/dispersion thresholds and were not fitted to returns.",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseLunarTopicStructureRegistrationEvent(registeredAt = new Date()) {
  const spec = {
    rule: DEX_PULSE_LUNAR_TOPIC_STRUCTURE_RULE,
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

export function createDexPulseLunarPostsRegistrationEvent(registeredAt = new Date()) {
  const spec = {
    rule: DEX_PULSE_LUNAR_POSTS_RULE,
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

export async function registerDexPulseLunarTopicStructure(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseLunarTopicStructureRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(DEX_PULSE_LUNAR_TOPIC_STRUCTURE_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse Lunar topic-structure registration must be after its boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error("Existing Lunar topic-structure registration mismatch.");
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

export async function registerDexPulseLunarPosts(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseLunarPostsRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(DEX_PULSE_LUNAR_POSTS_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse Lunar posts registration must be after its boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesPostsRegistration(existing)) {
    throw new Error("Existing Lunar posts registration mismatch.");
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

export async function enrichDexSurfacePulseWithLunarTopicStructure(
  options = {},
  dependencies = {},
) {
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matchesRegistration);
  if (!registration) throw new Error("Register the Lunar topic-structure policy first.");
  const discovery = [...events].reverse().find((event) => (
    event.type === "discovery"
    && event.provider === DEX_SURFACE_PULSE_RULE.sourceProvider
    && event.ruleVersion === DEX_SURFACE_PULSE_RULE.sourceRuleVersion
  ));
  if (!discovery) return enrichmentResult(ledgerPath, now, "no-source-discovery", null, null);
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  if (!(discoveryAt > Date.parse(registration.registeredAt)
    && discoveryAt > Date.parse(DEX_PULSE_LUNAR_TOPIC_STRUCTURE_RULE.evidenceBoundary))) {
    return enrichmentResult(ledgerPath, now, "source-not-strictly-future", discovery.id, null);
  }
  if (now.getTime() < discoveryAt || now.getTime() - discoveryAt > MAX_LAG_MS) {
    return enrichmentResult(ledgerPath, now, "source-outside-enrichment-window", discovery.id, null);
  }
  const existing = events.find((event) => (
    event.type === "dex-surface-pulse-lunar-topic-structure-enrichment"
    && event.registrationId === registration.id
    && event.discoveryEventId === discovery.id
  ));
  if (existing) {
    return enrichmentResult(ledgerPath, now, "skipped-existing-discovery", discovery.id, existing);
  }
  const tokenAddresses = [...new Set((discovery.candidates ?? []).filter((candidate) => (
    candidate.status === "eligible" && candidate.chain === "solana"
  )).map((candidate) => candidate.tokenAddress))];
  if (!tokenAddresses.length) {
    return enrichmentResult(ledgerPath, now, "no-eligible-candidates", discovery.id, null);
  }
  const maximum = finiteInteger(options.maxRequests) ?? 10;
  const collected = await collectExactMintLunarCrushTopicStructureEvidence({
    apiKey: options.apiKey ?? process.env.LUNARCRUSH_API_KEY,
    chain: "solana",
    tokenAddresses,
    observedAt: now,
    maxRequests: maximum,
  }, {
    fetcher: dependencies.fetcher,
    clock: dependencies.responseNow,
  });
  const evidence = [];
  for (const source of collected.events) {
    const signed = await appendUnique(ledgerPath, events, {
      ...source,
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    });
    evidence.push({
      tokenAddress: signed.tokenAddress,
      evidenceEventId: signed.id,
      status: signed.status,
      topicStructureMetricsDigest: signed.topicStructureMetricsDigest,
    });
  }
  const receipt = {
    type: "dex-surface-pulse-lunar-topic-structure-enrichment",
    id: `dex_surface_pulse_lunar_topic_structure_enrichment_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    }).slice(0, 24)}`,
    ruleVersion: DEX_PULSE_LUNAR_TOPIC_STRUCTURE_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    collectionStartedAt: collected.collectionStartedAt,
    availableAt: latestIso(collected.events.map((event) => event.availableAt)),
    status: "recorded",
    tokenCount: tokenAddresses.length,
    evidence,
    requestBudget: collected.requestBudget,
    researchOnly: true,
    mutationAllowed: false,
  };
  const signedReceipt = await appendLedgerEvent(ledgerPath, receipt);
  return enrichmentResult(ledgerPath, now, signedReceipt.status, discovery.id, signedReceipt);
}

export async function enrichDexSurfacePulseWithLunarPosts(options = {}, dependencies = {}) {
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matchesPostsRegistration);
  if (!registration) throw new Error("Register the Lunar posts policy first.");
  const discovery = [...events].reverse().find((event) => (
    event.type === "discovery"
    && event.provider === DEX_SURFACE_PULSE_RULE.sourceProvider
    && event.ruleVersion === DEX_SURFACE_PULSE_RULE.sourceRuleVersion
  ));
  if (!discovery) return enrichmentResult(ledgerPath, now, "no-source-discovery", null, null);
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  if (!(discoveryAt > Date.parse(registration.registeredAt)
    && discoveryAt > Date.parse(DEX_PULSE_LUNAR_POSTS_RULE.evidenceBoundary))) {
    return enrichmentResult(ledgerPath, now, "source-not-strictly-future", discovery.id, null);
  }
  if (now.getTime() < discoveryAt || now.getTime() - discoveryAt > MAX_LAG_MS) {
    return enrichmentResult(ledgerPath, now, "source-outside-enrichment-window", discovery.id, null);
  }
  const existing = events.find((event) => (
    event.type === "dex-surface-pulse-lunar-posts-enrichment"
    && event.registrationId === registration.id
    && event.discoveryEventId === discovery.id
  ));
  if (existing) {
    return enrichmentResult(ledgerPath, now, "skipped-existing-discovery", discovery.id, existing);
  }
  const tokenAddresses = [...new Set((discovery.candidates ?? []).filter((candidate) => (
    candidate.status === "eligible" && candidate.chain === "solana"
  )).map((candidate) => candidate.tokenAddress))];
  if (!tokenAddresses.length) {
    return enrichmentResult(ledgerPath, now, "no-eligible-candidates", discovery.id, null);
  }
  const maximum = finiteInteger(options.maxRequests) ?? 10;
  const collected = await collectExactMintLunarCrushPostsEvidence({
    apiKey: options.apiKey ?? process.env.LUNARCRUSH_API_KEY,
    chain: "solana",
    tokenAddresses,
    observedAt: now,
    maxRequests: maximum,
  }, {
    fetcher: dependencies.fetcher,
    clock: dependencies.responseNow,
  });
  const evidence = [];
  for (const source of collected.events) {
    const signed = await appendUnique(ledgerPath, events, {
      ...source,
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    });
    evidence.push({
      tokenAddress: signed.tokenAddress,
      evidenceEventId: signed.id,
      status: signed.status,
      postMetricsDigest: signed.postMetricsDigest,
    });
  }
  const receipt = {
    type: "dex-surface-pulse-lunar-posts-enrichment",
    id: `dex_surface_pulse_lunar_posts_enrichment_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    }).slice(0, 24)}`,
    ruleVersion: DEX_PULSE_LUNAR_POSTS_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    collectionStartedAt: collected.collectionStartedAt,
    availableAt: latestIso(collected.events.map((event) => event.availableAt)),
    status: "recorded",
    tokenCount: tokenAddresses.length,
    evidence,
    requestBudget: collected.requestBudget,
    researchOnly: true,
    mutationAllowed: false,
  };
  const signedReceipt = await appendLedgerEvent(ledgerPath, receipt);
  return enrichmentResult(ledgerPath, now, signedReceipt.status, discovery.id, signedReceipt);
}

export function buildDexPulseLunarTopicStructureScorecard(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const discoveries = new Map(events.filter((event) => event.type === "discovery")
    .map((event) => [event.id, event]));
  const evidenceEvents = new Map(events.filter((event) => (
    event.type === "lunarcrush-contract-topic-structure-snapshot"
  )).map((event) => [event.id, event]));
  const receipts = new Map(events.filter((event) => (
    event.type === "dex-surface-pulse-lunar-topic-structure-enrichment"
  )).map((event) => [event.id, event]));
  const rejectionCounts = {};
  const evidenceByForecast = new Map();
  for (const forecast of pulse.forecasts.filter((event) => (
    Date.parse(event.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ))) {
    const receipt = receipts.get(forecast.lunarcrushTopicStructureEnrichmentReceiptId);
    const evidence = evidenceEvents.get(forecast.lunarcrushTopicStructureEvidenceId);
    const reason = structureRejectionReason({
      forecast,
      receipt,
      evidence,
      registration,
      discovery: discoveries.get(forecast.discoveryEventId),
    });
    if (reason) increment(rejectionCounts, reason);
    evidenceByForecast.set(forecast.id, reason ? null : evidence);
  }
  const rows = pulse.rows.filter((row) => (
    Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? "")
  )).map((row) => structureObservation(row, evidenceByForecast.get(row.forecastId)));
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const candidateForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  return {
    type: "dex-surface-pulse-lunar-exact-contract-topic-structure-scorecard",
    ruleVersion: DEX_PULSE_LUNAR_TOPIC_STRUCTURE_RULE.version,
    evidenceBoundary: DEX_PULSE_LUNAR_TOPIC_STRUCTURE_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    researchOnly: true,
    mutationAllowed: false,
    candidateForecasts: candidateForecasts.length,
    openForecasts: candidateForecasts.filter((forecast) => (
      pulse.openForecastIds.includes(forecast.id)
    )).length,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    rejectionCounts,
    parent: summarizeFrames(frames, () => true),
    screens: DEX_PULSE_LUNAR_TOPIC_STRUCTURE_RULE.screens.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, (row) => passesTopicStructureScreen(row, screen)),
    })),
    note: "Every strictly future pulse remains in the parent. Missing, blocked, late, mismatched, privacy-unsafe, or tampered exact-contract structure evidence is challenger cash. Creator and post identities and raw posts are never retained. This panel cannot promote, mutate, or trade.",
  };
}

export function passesTopicStructureScreen(row, screen) {
  return (!screen.requireReady || row.structureReady)
    && minimum(row.creatorCount, screen.minimumCreatorCount)
    && minimum(row.postCount, screen.minimumPostCount)
    && minimum(row.uniquePostCreators, screen.minimumUniquePostCreators)
    && minimum(row.interactions24h, screen.minimumInteractions)
    && maximum(row.topCreatorShare, screen.maximumTopCreatorShare)
    && maximum(row.creatorHhi, screen.maximumCreatorHhi)
    && maximum(row.topPostShare, screen.maximumTopPostShare)
    && maximum(row.postHhi, screen.maximumPostHhi)
    && minimum(row.sentimentCoverage, screen.minimumSentimentCoverage)
    && minimum(row.meanPostSentiment, screen.minimumMeanPostSentiment);
}

export function buildDexPulseLunarPostsScorecard(events) {
  const registration = events.find(matchesPostsRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const discoveries = new Map(events.filter((event) => event.type === "discovery")
    .map((event) => [event.id, event]));
  const evidenceEvents = new Map(events.filter((event) => (
    event.type === "lunarcrush-contract-posts-snapshot"
  )).map((event) => [event.id, event]));
  const receipts = new Map(events.filter((event) => (
    event.type === "dex-surface-pulse-lunar-posts-enrichment"
  )).map((event) => [event.id, event]));
  const rejectionCounts = {};
  const evidenceByForecast = new Map();
  for (const forecast of pulse.forecasts.filter((event) => (
    Date.parse(event.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ))) {
    const receipt = receipts.get(forecast.lunarcrushPostsEnrichmentReceiptId);
    const evidence = evidenceEvents.get(forecast.lunarcrushPostsEvidenceId);
    const reason = postsRejectionReason({
      forecast,
      receipt,
      evidence,
      registration,
      discovery: discoveries.get(forecast.discoveryEventId),
    });
    if (reason) increment(rejectionCounts, reason);
    evidenceByForecast.set(forecast.id, reason ? null : evidence);
  }
  const rows = pulse.rows.filter((row) => (
    Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? "")
  )).map((row) => postsObservation(row, evidenceByForecast.get(row.forecastId)));
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const candidateForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  return {
    type: "dex-surface-pulse-lunar-exact-contract-posts-scorecard",
    ruleVersion: DEX_PULSE_LUNAR_POSTS_RULE.version,
    evidenceBoundary: DEX_PULSE_LUNAR_POSTS_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    researchOnly: true,
    mutationAllowed: false,
    candidateForecasts: candidateForecasts.length,
    openForecasts: candidateForecasts.filter((forecast) => (
      pulse.openForecastIds.includes(forecast.id)
    )).length,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    rejectionCounts,
    parent: summarizeFrames(frames, () => true),
    screens: DEX_PULSE_LUNAR_POSTS_RULE.screens.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, (row) => passesPostsScreen(row, screen)),
    })),
    note: "Every strictly future pulse remains in the parent. Exact post-config identity is required; missing, blocked, late, mismatched, privacy-unsafe, or tampered evidence is challenger cash. Only anonymous post and active-creator aggregates are retained. This panel cannot promote, mutate, or trade.",
  };
}

export function passesPostsScreen(row, screen) {
  return (!screen.requireReady || row.postsReady)
    && minimum(row.postCount, screen.minimumPostCount)
    && minimum(row.uniquePostCreators, screen.minimumUniquePostCreators)
    && minimum(row.interactions24h, screen.minimumInteractions)
    && maximum(row.topPostShare, screen.maximumTopPostShare)
    && maximum(row.postHhi, screen.maximumPostHhi)
    && minimum(row.sentimentCoverage, screen.minimumSentimentCoverage)
    && minimum(row.meanPostSentiment, screen.minimumMeanPostSentiment);
}

function postsObservation(row, evidence) {
  const metrics = evidence?.postMetrics;
  return {
    ...row,
    postsReady: evidence?.status === "ready",
    postCount: finiteNumber(metrics?.postCount),
    uniquePostCreators: finiteNumber(metrics?.uniqueCreatorCount),
    interactions24h: finiteNumber(metrics?.interactions24h),
    topPostShare: finiteNumber(metrics?.topPostInteractionShare),
    postHhi: finiteNumber(metrics?.postInteractionHhi),
    sentimentCoverage: finiteNumber(metrics?.sentimentCoverage),
    meanPostSentiment: finiteNumber(metrics?.meanPostSentiment),
  };
}

function postsRejectionReason({ forecast, receipt, evidence, registration, discovery }) {
  if (!registration || !matchesPostsRegistration(registration)) {
    return "missing-or-invalid-registration";
  }
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))) {
    return "not-strictly-future";
  }
  if (!receipt || receipt.type !== "dex-surface-pulse-lunar-posts-enrichment"
    || receipt.registrationId !== registration.id
    || receipt.id !== forecast.lunarcrushPostsEnrichmentReceiptId
    || receipt.discoveryEventId !== forecast.discoveryEventId
    || receipt.status !== "recorded"
    || receipt.researchOnly !== true
    || receipt.mutationAllowed !== false) return "missing-or-invalid-posts-enrichment";
  const link = (receipt.evidence ?? []).find((item) => item.tokenAddress === forecast.tokenAddress);
  if (!evidence || link?.evidenceEventId !== evidence.id
    || link?.postMetricsDigest !== evidence.postMetricsDigest
    || evidence.id !== forecast.lunarcrushPostsEvidenceId
    || evidence.type !== "lunarcrush-contract-posts-snapshot"
    || evidence.provider !== "lunarcrush"
    || evidence.profile !== "exact-contract-posts"
    || evidence.ruleVersion !== LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE.version
    || evidence.registrationId !== registration.id
    || evidence.discoveryEventId !== forecast.discoveryEventId
    || evidence.chain !== forecast.chain
    || evidence.tokenAddress !== forecast.tokenAddress
    || evidence.aggregateOnly !== true
    || evidence.rawPostsRetained !== false
    || evidence.rawPostTextRetained !== false
    || evidence.rawCreatorIdentitiesRetained !== false
    || evidence.rawCreatorIdsRetained !== false
    || evidence.researchOnly !== true
    || evidence.mutationAllowed !== false) return "missing-or-mismatched-posts-evidence";
  if (!discovery
    || discovery.provider !== DEX_SURFACE_PULSE_RULE.sourceProvider
    || discovery.ruleVersion !== DEX_SURFACE_PULSE_RULE.sourceRuleVersion
    || discovery.id !== forecast.discoveryEventId
    || !(discovery.candidates ?? []).some((candidate) => (
      candidate.status === "eligible"
      && candidate.chain === forecast.chain
      && candidate.tokenAddress === forecast.tokenAddress
    ))) return "invalid-posts-source-discovery";
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  const collectionAt = Date.parse(evidence.collectionStartedAt ?? "");
  const availableAt = Date.parse(evidence.availableAt ?? "");
  const createdAt = Date.parse(forecast.createdAt ?? "");
  if (!(collectionAt >= discoveryAt && collectionAt - discoveryAt <= MAX_LAG_MS
    && availableAt >= collectionAt && availableAt <= createdAt
    && createdAt - availableAt <= MAX_LAG_MS)) return "invalid-posts-evidence-timing";
  if (evidence.status === "blocked") return "blocked-exact-contract-posts";
  if (evidence.status !== "ready"
    || evidence.identity?.matchStatus !== "exact-contract-post-config"
    || evidence.identity?.requestedContractAddress !== forecast.tokenAddress
    || evidence.identity?.responseId !== forecast.tokenAddress
    || String(evidence.identity?.responseTopic ?? "").toLowerCase()
      !== forecast.tokenAddress.toLowerCase()
    || evidence.postMetricsDigest !== digestValue(evidence.postMetrics)
    || !validPostMetrics(evidence.postMetrics)) return "invalid-exact-contract-posts";
  return null;
}

function validPostMetrics(metrics) {
  return positiveInteger(metrics?.postCount)
    && nonnegativeInteger(metrics?.uniqueCreatorCount)
    && nonnegative(metrics?.interactions24h)
    && bounded(metrics?.topPostInteractionShare, 0, 1)
    && bounded(metrics?.postInteractionHhi, 0, 1)
    && nullableBounded(metrics?.meanPostSentiment, 1, 5)
    && nullableBounded(metrics?.positivePostShare, 0, 1)
    && bounded(metrics?.sentimentCoverage, 0, 1);
}

function structureObservation(row, evidence) {
  const metrics = evidence?.topicStructureMetrics;
  return {
    ...row,
    structureReady: evidence?.status === "ready",
    creatorCount: finiteNumber(metrics?.creator?.creatorCount),
    postCount: finiteNumber(metrics?.post?.postCount),
    uniquePostCreators: finiteNumber(metrics?.post?.uniqueCreatorCount),
    interactions24h: finiteNumber(metrics?.creator?.interactions24h),
    topCreatorShare: finiteNumber(metrics?.creator?.topCreatorInteractionShare),
    creatorHhi: finiteNumber(metrics?.creator?.creatorInteractionHhi),
    topPostShare: finiteNumber(metrics?.post?.topPostInteractionShare),
    postHhi: finiteNumber(metrics?.post?.postInteractionHhi),
    sentimentCoverage: finiteNumber(metrics?.post?.sentimentCoverage),
    meanPostSentiment: finiteNumber(metrics?.post?.meanPostSentiment),
  };
}

function structureRejectionReason({ forecast, receipt, evidence, registration, discovery }) {
  if (!registration || !matchesRegistration(registration)) return "missing-or-invalid-registration";
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))) {
    return "not-strictly-future";
  }
  if (!receipt || receipt.type !== "dex-surface-pulse-lunar-topic-structure-enrichment"
    || receipt.registrationId !== registration.id
    || receipt.id !== forecast.lunarcrushTopicStructureEnrichmentReceiptId
    || receipt.discoveryEventId !== forecast.discoveryEventId
    || receipt.status !== "recorded"
    || receipt.researchOnly !== true
    || receipt.mutationAllowed !== false) return "missing-or-invalid-structure-enrichment";
  const link = (receipt.evidence ?? []).find((item) => item.tokenAddress === forecast.tokenAddress);
  if (!evidence || link?.evidenceEventId !== evidence.id
    || link?.topicStructureMetricsDigest !== evidence.topicStructureMetricsDigest
    || evidence.id !== forecast.lunarcrushTopicStructureEvidenceId
    || evidence.type !== "lunarcrush-contract-topic-structure-snapshot"
    || evidence.provider !== "lunarcrush"
    || evidence.profile !== "exact-contract-topic-structure"
    || evidence.ruleVersion !== LUNARCRUSH_EXACT_CONTRACT_TOPIC_STRUCTURE_RULE.version
    || evidence.registrationId !== registration.id
    || evidence.discoveryEventId !== forecast.discoveryEventId
    || evidence.chain !== forecast.chain
    || evidence.tokenAddress !== forecast.tokenAddress
    || evidence.aggregateOnly !== true
    || evidence.rawPostsRetained !== false
    || evidence.rawPostTextRetained !== false
    || evidence.rawCreatorIdentitiesRetained !== false
    || evidence.rawCreatorIdsRetained !== false
    || evidence.researchOnly !== true
    || evidence.mutationAllowed !== false) return "missing-or-mismatched-structure-evidence";
  if (!discovery
    || discovery.provider !== DEX_SURFACE_PULSE_RULE.sourceProvider
    || discovery.ruleVersion !== DEX_SURFACE_PULSE_RULE.sourceRuleVersion
    || discovery.id !== forecast.discoveryEventId
    || !(discovery.candidates ?? []).some((candidate) => (
      candidate.status === "eligible"
      && candidate.chain === forecast.chain
      && candidate.tokenAddress === forecast.tokenAddress
    ))) return "invalid-structure-source-discovery";
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  const collectionAt = Date.parse(evidence.collectionStartedAt ?? "");
  const availableAt = Date.parse(evidence.availableAt ?? "");
  const createdAt = Date.parse(forecast.createdAt ?? "");
  if (!(collectionAt >= discoveryAt && collectionAt - discoveryAt <= MAX_LAG_MS
    && availableAt >= collectionAt && availableAt <= createdAt
    && createdAt - availableAt <= MAX_LAG_MS)) return "invalid-structure-evidence-timing";
  if (evidence.status === "blocked") return "blocked-exact-contract-structure";
  const metrics = evidence.topicStructureMetrics;
  if (evidence.status !== "ready"
    || evidence.identity?.matchStatus !== "exact-contract-post-config"
    || evidence.identity?.requestedContractAddress !== forecast.tokenAddress
    || evidence.identity?.responseId !== forecast.tokenAddress
    || String(evidence.identity?.responseTopic ?? "").toLowerCase()
      !== forecast.tokenAddress.toLowerCase()
    || evidence.topicStructureMetricsDigest !== digestValue(metrics)
    || !validStructureMetrics(metrics)) return "invalid-exact-contract-structure";
  return null;
}

function validStructureMetrics(metrics) {
  return positiveInteger(metrics?.creator?.creatorCount)
    && nonnegative(metrics?.creator?.interactions24h)
    && bounded(metrics?.creator?.topCreatorInteractionShare, 0, 1)
    && bounded(metrics?.creator?.creatorInteractionHhi, 0, 1)
    && positiveInteger(metrics?.post?.postCount)
    && nonnegativeInteger(metrics?.post?.uniqueCreatorCount)
    && nonnegative(metrics?.post?.interactions24h)
    && bounded(metrics?.post?.topPostInteractionShare, 0, 1)
    && bounded(metrics?.post?.postInteractionHhi, 0, 1)
    && nullableBounded(metrics?.post?.meanPostSentiment, 1, 5)
    && nullableBounded(metrics?.post?.positivePostShare, 0, 1)
    && bounded(metrics?.post?.sentimentCoverage, 0, 1)
    && bounded(
      metrics?.endpointInteractionRatio,
      1,
      LUNARCRUSH_EXACT_CONTRACT_TOPIC_STRUCTURE_RULE.maximumEndpointInteractionRatio,
    );
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

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseLunarTopicStructureRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesPostsRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseLunarPostsRegistrationEvent(event.registeredAt);
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

async function appendUnique(ledgerPath, events, event) {
  const existing = events.find((candidate) => candidate.id === event.id);
  if (existing) return existing;
  const signed = await appendLedgerEvent(ledgerPath, event);
  events.push(signed);
  return signed;
}

function enrichmentResult(ledgerPath, now, status, discoveryEventId, receipt) {
  return {
    ledgerPath,
    observedAt: validIso(now),
    status,
    discoveryEventId,
    enrichmentReceiptId: receipt?.id ?? null,
    tokenCount: receipt?.tokenCount ?? 0,
    requestBudget: receipt?.requestBudget ?? null,
    evidence: receipt?.evidence ?? [],
  };
}

function latestIso(values) {
  const milliseconds = values.map((value) => Date.parse(value)).filter(Number.isFinite);
  if (!milliseconds.length) return null;
  return new Date(Math.max(...milliseconds)).toISOString();
}

function minimum(value, threshold) {
  return threshold === undefined || (Number.isFinite(value) && value >= threshold);
}

function maximum(value, threshold) {
  return threshold === undefined || (Number.isFinite(value) && value <= threshold);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function nonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function bounded(value, minimumValue, maximumValue) {
  return Number.isFinite(value) && value >= minimumValue && value <= maximumValue;
}

function nullableBounded(value, minimumValue, maximumValue) {
  return value == null || bounded(value, minimumValue, maximumValue);
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function pairedMean(left, right) {
  return left.length === right.length
    ? mean(left.map((value, index) => value - right[index])) : null;
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
  let maximumValue = 0;
  for (const value of values) {
    equity *= Math.max(0, 1 + (value / 100));
    peak = Math.max(peak, equity);
    maximumValue = Math.max(
      maximumValue,
      peak > 0 ? ((peak - equity) / peak) * 100 : 0,
    );
  }
  return maximumValue;
}

function largestWinningShare(values) {
  const winners = values.filter((value) => value > 0);
  const total = winners.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...winners) / total : null;
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function nullableRound(value) {
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
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
    else if (argv[index] === "--max-lunarcrush-requests") {
      options.maxRequests = Number(argv[++index]);
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "enrich", "score", "register-posts", "enrich-posts", "score-posts"]
    .includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-lunar-topic-structure.mjs register|enrich|score|register-posts|enrich-posts|score-posts [--max-lunarcrush-requests 10] [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseLunarTopicStructure(options), null, 2));
    } else if (options.command === "register-posts") {
      console.log(JSON.stringify(await registerDexPulseLunarPosts(options), null, 2));
    } else if (options.command === "enrich") {
      console.log(JSON.stringify(await enrichDexSurfacePulseWithLunarTopicStructure(options), null, 2));
    } else if (options.command === "enrich-posts") {
      console.log(JSON.stringify(await enrichDexSurfacePulseWithLunarPosts(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: options.command === "score-posts"
          ? buildDexPulseLunarPostsScorecard(events)
          : buildDexPulseLunarTopicStructureScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
