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
import { LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE } from "./onchain-lunarcrush-provider.mjs";
import {
  LUNARCRUSH_GEMINI_SEMANTIC_FIELDS,
  LUNARCRUSH_GEMINI_SEMANTIC_CACHE_POLICY,
  LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE,
  collectExactMintLunarCrushGeminiPostSemantics,
  validSemanticMetrics,
} from "./onchain-gemini-social-semantics.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const MAX_LAG_MS = 5 * 60_000;

export const DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE = Object.freeze({
  version: "dex-surface-pulse-lunar-gemini-post-semantics-panel-v1",
  evidenceBoundary: "2026-08-03T22:40:01.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  sourcePostsRuleVersion: LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE.version,
  sourceSemanticsRuleVersion: LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.version,
  model: LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.model,
  screens: Object.freeze([
    Object.freeze({ id: "exact-contract-post-semantics-covered", requireReady: true }),
    Object.freeze({
      id: "low-promotion-low-hype-corpus",
      requireReady: true,
      minimumSemanticConfidence: 0.5,
      maximumCoordinatedPromotionShare: 0.5,
      maximumGenericHypeShare: 0.5,
    }),
    Object.freeze({
      id: "substantive-novel-corpus",
      requireReady: true,
      minimumSemanticConfidence: 0.5,
      minimumSubstantiveProjectEvidenceShare: 0.5,
      minimumInformationNovelty: 0.5,
    }),
    Object.freeze({
      id: "coherent-substantive-novel-corpus",
      requireReady: true,
      minimumSemanticConfidence: 0.5,
      minimumSubstantiveProjectEvidenceShare: 0.5,
      minimumInformationNovelty: 0.5,
      minimumNarrativeCoherence: 0.5,
    }),
    Object.freeze({
      id: "organic-bullish-specific-narrative",
      requireReady: true,
      minimumSemanticConfidence: 0.5,
      minimumSubstantiveProjectEvidenceShare: 0.5,
      minimumInformationNovelty: 0.5,
      minimumNarrativeCoherence: 0.5,
      minimumBullishIntentShare: 0.5,
      maximumCoordinatedPromotionShare: 0.5,
      maximumGenericHypeShare: 0.5,
    }),
  ]),
  derivationStatus: "pre-outcome-semantic-hypothesis-panel-only",
  derivationNote: "The exact-contract post route and Gemini JSON response contract were verified before registration without inspecting a later market outcome. Every numeric threshold is the unoptimized midpoint of the frozen zero-to-one semantic scale. The LetsPlay provider/model audit and every prior forecast are excluded. Gemini receives no tools, web search, price, outcome, or creator-identity context; only aggregate metrics and digests are retained.",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseLunarGeminiPostSemanticsRegistrationEvent(
  registeredAt = new Date(),
) {
  const spec = {
    rule: DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE,
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

export async function registerDexPulseLunarGeminiPostSemantics(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseLunarGeminiPostSemanticsRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE.evidenceBoundary))) {
    throw new Error("Lunar Gemini post-semantics registration must be after its boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error("Existing Lunar Gemini post-semantics registration mismatch.");
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

export async function enrichDexSurfacePulseWithLunarGeminiPostSemantics(
  options = {},
  dependencies = {},
) {
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matchesRegistration);
  if (!registration) throw new Error("Register the Lunar Gemini post-semantics policy first.");
  const discovery = [...events].reverse().find((event) => (
    event.type === "discovery"
    && event.provider === DEX_SURFACE_PULSE_RULE.sourceProvider
    && event.ruleVersion === DEX_SURFACE_PULSE_RULE.sourceRuleVersion
  ));
  if (!discovery) return enrichmentResult(ledgerPath, now, "no-source-discovery", null, null);
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  if (!(discoveryAt > Date.parse(registration.registeredAt)
    && discoveryAt > Date.parse(DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE.evidenceBoundary))) {
    return enrichmentResult(ledgerPath, now, "source-not-strictly-future", discovery.id, null);
  }
  if (now.getTime() < discoveryAt || now.getTime() - discoveryAt > MAX_LAG_MS) {
    return enrichmentResult(ledgerPath, now, "source-outside-enrichment-window", discovery.id, null);
  }
  const existing = events.find((event) => (
    event.type === "dex-surface-pulse-lunar-gemini-post-semantics-enrichment"
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
  const semanticCache = exactCorpusSemanticCache(events, now);
  const collected = await collectExactMintLunarCrushGeminiPostSemantics({
    lunarcrushApiKey: options.lunarcrushApiKey ?? process.env.LUNARCRUSH_API_KEY,
    geminiApiKey: options.geminiApiKey
      ?? process.env.GEMINI_API_KEY
      ?? process.env.GOOGLE_AI_STUDIO_API_KEY
      ?? process.env.GOOGLE_API_KEY,
    chain: "solana",
    tokenAddresses,
    observedAt: now,
    maxRequests: maximum,
  }, {
    fetcher: dependencies.fetcher,
    clock: dependencies.responseNow,
    semanticCache,
  });
  const postsById = new Map();
  for (const source of collected.postEvents) {
    const signed = await appendUnique(ledgerPath, events, {
      ...source,
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    });
    postsById.set(source.id, signed);
  }
  const evidence = [];
  for (const source of collected.semanticEvents) {
    const signed = await appendUnique(ledgerPath, events, {
      ...source,
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    });
    const posts = postsById.get(source.postsEvidenceId) ?? null;
    evidence.push({
      tokenAddress: signed.tokenAddress,
      postsEvidenceEventId: posts?.id ?? null,
      postsMetricsDigest: posts?.postMetricsDigest ?? null,
      postCorpusDigest: signed.postCorpusDigest,
      semanticEvidenceEventId: signed.id,
      semanticMetricsDigest: signed.semanticMetricsDigest,
      status: signed.status,
    });
  }
  const receipt = {
    type: "dex-surface-pulse-lunar-gemini-post-semantics-enrichment",
    id: `dex_surface_pulse_lunar_gemini_post_semantics_enrichment_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    }).slice(0, 24)}`,
    ruleVersion: DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    collectionStartedAt: collected.collectionStartedAt,
    availableAt: latestIso(collected.semanticEvents.map((event) => event.availableAt)),
    status: "recorded",
    tokenCount: tokenAddresses.length,
    evidence,
    lunarRequestBudget: collected.lunarRequestBudget,
    geminiRequestBudget: collected.geminiRequestBudget,
    rawPostsRetained: false,
    rawPostTextRetained: false,
    rawModelResponsesRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
  const signedReceipt = await appendLedgerEvent(ledgerPath, receipt);
  return enrichmentResult(ledgerPath, now, signedReceipt.status, discovery.id, signedReceipt);
}

export function buildDexPulseLunarGeminiPostSemanticsScorecard(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const discoveries = new Map(events.filter((event) => event.type === "discovery")
    .map((event) => [event.id, event]));
  const postsEvents = new Map(events.filter((event) => (
    event.type === "lunarcrush-contract-posts-snapshot"
  )).map((event) => [event.id, event]));
  const semanticEvents = new Map(events.filter((event) => (
    event.type === "lunarcrush-contract-post-semantics-snapshot"
  )).map((event) => [event.id, event]));
  const receipts = new Map(events.filter((event) => (
    event.type === "dex-surface-pulse-lunar-gemini-post-semantics-enrichment"
  )).map((event) => [event.id, event]));
  const rejectionCounts = {};
  const evidenceByForecast = new Map();
  for (const forecast of pulse.forecasts.filter((event) => (
    Date.parse(event.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ))) {
    const receipt = receipts.get(forecast.lunarcrushGeminiSemanticsEnrichmentReceiptId);
    const posts = postsEvents.get(forecast.lunarcrushGeminiPostsEvidenceId);
    const semantics = semanticEvents.get(forecast.lunarcrushGeminiSemanticsEvidenceId);
    const reason = semanticRejectionReason({
      forecast,
      receipt,
      posts,
      semantics,
      semanticEvents,
      registration,
      discovery: discoveries.get(forecast.discoveryEventId),
    });
    if (reason) increment(rejectionCounts, reason);
    evidenceByForecast.set(forecast.id, reason ? null : semantics);
  }
  const rows = pulse.rows.filter((row) => (
    Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? "")
  )).map((row) => semanticObservation(row, evidenceByForecast.get(row.forecastId)));
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
    type: "dex-surface-pulse-lunar-gemini-post-semantics-scorecard",
    ruleVersion: DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE.version,
    evidenceBoundary: DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE.evidenceBoundary,
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
    semanticStability: buildGeminiPostSemanticsStabilityAudit(
      [...semanticEvents.values()].filter((event) => (
        event.registrationId === registration?.id
        && Date.parse(event.availableAt ?? "") > Date.parse(registration?.registeredAt ?? "")
      )),
    ),
    parent: summarizeFrames(frames, () => true),
    screens: DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE.screens.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, (row) => passesSemanticScreen(row, screen)),
    })),
    note: "Every strictly future pulse remains in the parent. Missing, blocked, late, mismatched, tampered, privacy-unsafe, outside-knowledge, or non-deterministic-contract semantic evidence is challenger cash. The multiple-testing panel cannot promote, mutate, or trade.",
  };
}

export function buildGeminiPostSemanticsStabilityAudit(events) {
  const ready = (events ?? []).filter((event) => (
    event?.status === "ready"
    && event.ruleVersion === LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.version
    && event.model === LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.model
    && event.modelVersion === LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.model
    && event.promptVersion === LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.promptVersion
    && typeof event.postCorpusDigest === "string"
    && event.postCorpusDigest.length > 0
    && event.semanticMetricsDigest === digestValue(event.semanticMetrics)
    && validSemanticMetrics(event.semanticMetrics, event.analyzedPostCount)
    && event.semanticInferenceSource !== "exact-corpus-cache"
  ));
  const byCorpus = new Map();
  for (const event of ready) {
    const group = byCorpus.get(event.postCorpusDigest) ?? [];
    group.push(event);
    byCorpus.set(event.postCorpusDigest, group);
  }
  const repeated = [...byCorpus.values()].filter((group) => group.length > 1);
  const maximumMetricRanges = Object.fromEntries(
    LUNARCRUSH_GEMINI_SEMANTIC_FIELDS.map((field) => [field, nullableRound(Math.max(
      0,
      ...repeated.map((group) => {
        const values = group.map((event) => Number(event.semanticMetrics[field]));
        return Math.max(...values) - Math.min(...values);
      }),
    ))]),
  );
  const screenDecisionFlipCounts = Object.fromEntries(
    DEX_PULSE_LUNAR_GEMINI_POST_SEMANTICS_RULE.screens.map((screen) => [
      screen.id,
      repeated.filter((group) => new Set(group.map((event) => passesSemanticScreen(
        semanticObservation({}, event),
        screen,
      ))).size > 1).length,
    ]),
  );
  return {
    readySemanticEvents: ready.length,
    uniqueCorpusDigests: byCorpus.size,
    repeatedCorpusDigests: repeated.length,
    repeatedReadySemanticEvents: repeated.reduce((sum, group) => sum + group.length, 0),
    maximumMetricRanges,
    screenDecisionFlipCounts,
    note: "Repeated identical-corpus classifications are an inference-stability diagnostic only. They cannot change a sealed forecast, choose a screen, or count as independent market evidence.",
  };
}

export function passesSemanticScreen(row, screen) {
  return (!screen.requireReady || row.semanticsReady)
    && minimum(row.semanticConfidence, screen.minimumSemanticConfidence)
    && minimum(
      row.substantiveProjectEvidenceShare,
      screen.minimumSubstantiveProjectEvidenceShare,
    )
    && minimum(row.informationNovelty, screen.minimumInformationNovelty)
    && minimum(row.narrativeCoherence, screen.minimumNarrativeCoherence)
    && minimum(row.bullishIntentShare, screen.minimumBullishIntentShare)
    && maximum(
      row.coordinatedPromotionShare,
      screen.maximumCoordinatedPromotionShare,
    )
    && maximum(row.genericHypeShare, screen.maximumGenericHypeShare);
}

function semanticObservation(row, evidence) {
  const metrics = evidence?.semanticMetrics;
  return {
    ...row,
    semanticsReady: evidence?.status === "ready",
    substantiveProjectEvidenceShare: finiteNumber(metrics?.substantiveProjectEvidenceShare),
    coordinatedPromotionShare: finiteNumber(metrics?.coordinatedPromotionShare),
    genericHypeShare: finiteNumber(metrics?.genericHypeShare),
    bullishIntentShare: finiteNumber(metrics?.bullishIntentShare),
    riskWarningShare: finiteNumber(metrics?.riskWarningShare),
    narrativeCoherence: finiteNumber(metrics?.narrativeCoherence),
    informationNovelty: finiteNumber(metrics?.informationNovelty),
    semanticConfidence: finiteNumber(metrics?.semanticConfidence),
  };
}

function semanticRejectionReason({
  forecast,
  receipt,
  posts,
  semantics,
  semanticEvents,
  registration,
  discovery,
}) {
  if (!registration || !matchesRegistration(registration)) return "missing-or-invalid-registration";
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))) {
    return "not-strictly-future";
  }
  if (!receipt
    || receipt.type !== "dex-surface-pulse-lunar-gemini-post-semantics-enrichment"
    || receipt.registrationId !== registration.id
    || receipt.id !== forecast.lunarcrushGeminiSemanticsEnrichmentReceiptId
    || receipt.discoveryEventId !== forecast.discoveryEventId
    || receipt.status !== "recorded"
    || receipt.rawPostsRetained !== false
    || receipt.rawPostTextRetained !== false
    || receipt.rawModelResponsesRetained !== false
    || receipt.researchOnly !== true
    || receipt.mutationAllowed !== false) return "missing-or-invalid-semantic-enrichment";
  const link = (receipt.evidence ?? []).find((item) => (
    item.tokenAddress === forecast.tokenAddress
  ));
  if (!posts
    || !semantics
    || link?.postsEvidenceEventId !== posts.id
    || link?.semanticEvidenceEventId !== semantics.id
    || link?.postsMetricsDigest !== posts.postMetricsDigest
    || link?.postCorpusDigest !== posts.postCorpusDigest
    || link?.semanticMetricsDigest !== semantics.semanticMetricsDigest
    || posts.id !== forecast.lunarcrushGeminiPostsEvidenceId
    || semantics.id !== forecast.lunarcrushGeminiSemanticsEvidenceId
    || semantics.postsEvidenceId !== posts.id
    || semantics.postsMetricsDigest !== posts.postMetricsDigest
    || semantics.postCorpusDigest !== posts.postCorpusDigest) {
    return "missing-or-mismatched-semantic-evidence";
  }
  if (!discovery
    || discovery.provider !== DEX_SURFACE_PULSE_RULE.sourceProvider
    || discovery.ruleVersion !== DEX_SURFACE_PULSE_RULE.sourceRuleVersion
    || discovery.id !== forecast.discoveryEventId
    || !(discovery.candidates ?? []).some((candidate) => (
      candidate.status === "eligible"
      && candidate.chain === forecast.chain
      && candidate.tokenAddress === forecast.tokenAddress
    ))) return "invalid-semantic-source-discovery";
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  const collectionAt = Date.parse(semantics.collectionStartedAt ?? "");
  const availableAt = Date.parse(semantics.availableAt ?? "");
  const createdAt = Date.parse(forecast.createdAt ?? "");
  if (!(collectionAt >= discoveryAt && collectionAt - discoveryAt <= MAX_LAG_MS
    && availableAt >= collectionAt && availableAt <= createdAt
    && createdAt - availableAt <= MAX_LAG_MS)) return "invalid-semantic-evidence-timing";
  if (semantics.status === "blocked") return "blocked-exact-contract-semantics";
  if (posts.status !== "ready"
    || posts.type !== "lunarcrush-contract-posts-snapshot"
    || posts.ruleVersion !== LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE.version
    || posts.registrationId !== registration.id
    || posts.discoveryEventId !== forecast.discoveryEventId
    || posts.chain !== forecast.chain
    || posts.tokenAddress !== forecast.tokenAddress
    || posts.identity?.matchStatus !== "exact-contract-post-config"
    || posts.postMetricsDigest !== digestValue(posts.postMetrics)
    || !posts.postCorpusDigest
    || !Number.isInteger(posts.semanticPostCount)
    || posts.semanticPostCount <= 0
    || posts.rawPostsRetained !== false
    || posts.rawPostTextRetained !== false
    || posts.rawCreatorIdentitiesRetained !== false
    || posts.rawCreatorIdsRetained !== false
    || posts.researchOnly !== true
    || posts.mutationAllowed !== false) return "invalid-exact-contract-semantic-posts";
  if (semantics.status !== "ready"
    || semantics.type !== "lunarcrush-contract-post-semantics-snapshot"
    || semantics.provider !== "lunarcrush+google-gemini"
    || semantics.profile !== "exact-contract-gemini-post-semantics"
    || semantics.ruleVersion !== LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.version
    || semantics.registrationId !== registration.id
    || semantics.discoveryEventId !== forecast.discoveryEventId
    || semantics.chain !== forecast.chain
    || semantics.tokenAddress !== forecast.tokenAddress
    || semantics.identity?.matchStatus !== "exact-contract-post-config"
    || semantics.model !== LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.model
    || semantics.modelVersion !== LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.model
    || semantics.promptVersion !== LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.promptVersion
    || semantics.promptDigest !== digestValue({
      promptVersion: semantics.promptVersion,
      postCorpusDigest: semantics.postCorpusDigest,
    })
    || semantics.analyzedPostCount !== posts.semanticPostCount
    || semantics.semanticMetricsDigest !== digestValue(semantics.semanticMetrics)
    || !validSemanticMetrics(semantics.semanticMetrics, posts.semanticPostCount)
    || semantics.aggregateOnly !== true
    || semantics.outsideKnowledgeAllowed !== false
    || semantics.webSearchUsed !== false
    || semantics.priceOrOutcomeContextUsed !== false
    || semantics.rawPostsRetained !== false
    || semantics.rawPostTextRetained !== false
    || semantics.rawCreatorIdentitiesRetained !== false
    || semantics.rawCreatorIdsRetained !== false
    || semantics.rawModelResponseRetained !== false
    || semantics.researchOnly !== true
    || semantics.mutationAllowed !== false) return "invalid-exact-contract-semantics";
  if (semantics.semanticInferenceSource === "exact-corpus-cache") {
    const cached = semanticEvents.get(semantics.cachedSemanticEvidenceId);
    if (semantics.semanticCachePolicyVersion
        !== LUNARCRUSH_GEMINI_SEMANTIC_CACHE_POLICY.version
      || !validCachedSemanticLineage(cached, semantics)) {
      return "invalid-cached-semantic-lineage";
    }
  } else if (semantics.semanticInferenceSource !== undefined
    && semantics.semanticInferenceSource !== "gemini-api") {
    return "invalid-semantic-inference-source";
  }
  return null;
}

function exactCorpusSemanticCache(events, now) {
  if (!(now.getTime()
    > Date.parse(LUNARCRUSH_GEMINI_SEMANTIC_CACHE_POLICY.evidenceBoundary))) return new Map();
  const cache = new Map();
  for (const event of [...events].reverse()) {
    if (event.type !== "lunarcrush-contract-post-semantics-snapshot"
      || event.status !== "ready"
      || event.ruleVersion !== LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.version
      || event.model !== LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.model
      || event.modelVersion !== LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.model
      || event.promptVersion !== LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.promptVersion
      || !event.postCorpusDigest
      || event.semanticInferenceSource === "exact-corpus-cache"
      || event.semanticMetricsDigest !== digestValue(event.semanticMetrics)
      || !validSemanticMetrics(event.semanticMetrics, event.analyzedPostCount)
      || !(Date.parse(event.availableAt ?? "") < now.getTime())
      || event.rawPostsRetained !== false
      || event.rawPostTextRetained !== false
      || event.rawCreatorIdentitiesRetained !== false
      || event.rawCreatorIdsRetained !== false
      || event.rawModelResponseRetained !== false
      || event.researchOnly !== true
      || event.mutationAllowed !== false
      || cache.has(event.postCorpusDigest)) continue;
    cache.set(event.postCorpusDigest, event);
  }
  return cache;
}

function validCachedSemanticLineage(source, cached) {
  return source?.type === "lunarcrush-contract-post-semantics-snapshot"
    && source.status === "ready"
    && source.ruleVersion === cached.ruleVersion
    && source.postCorpusDigest === cached.postCorpusDigest
    && source.model === cached.model
    && source.modelVersion === cached.modelVersion
    && source.promptVersion === cached.promptVersion
    && source.promptDigest === cached.promptDigest
    && source.semanticMetricsDigest === cached.semanticMetricsDigest
    && canonical(source.semanticMetrics) === canonical(cached.semanticMetrics)
    && source.analyzedPostCount === cached.analyzedPostCount
    && (source.semanticInferenceSource === undefined
      || source.semanticInferenceSource === "gemini-api")
    && Date.parse(source.availableAt ?? "") < Date.parse(cached.collectionStartedAt ?? "")
    && source.rawPostsRetained === false
    && source.rawPostTextRetained === false
    && source.rawCreatorIdentitiesRetained === false
    && source.rawCreatorIdsRetained === false
    && source.rawModelResponseRetained === false
    && source.researchOnly === true
    && source.mutationAllowed === false;
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
  const expected = createDexPulseLunarGeminiPostSemanticsRegistrationEvent(event.registeredAt);
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
    lunarRequestBudget: receipt?.lunarRequestBudget ?? null,
    geminiRequestBudget: receipt?.geminiRequestBudget ?? null,
    evidence: receipt?.evidence ?? [],
  };
}

function latestIso(values) {
  const milliseconds = values.map((value) => Date.parse(value)).filter(Number.isFinite);
  return milliseconds.length ? new Date(Math.max(...milliseconds)).toISOString() : null;
}

function minimum(value, threshold) {
  return threshold === undefined || (Number.isFinite(value) && value >= threshold);
}

function maximum(value, threshold) {
  return threshold === undefined || (Number.isFinite(value) && value <= threshold);
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
    maximumValue = Math.max(maximumValue, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
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
    else if (argv[index] === "--max-requests") options.maxRequests = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "enrich", "score"].includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-lunar-post-semantics.mjs register|enrich|score [--max-requests N --ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseLunarGeminiPostSemantics(options), null, 2));
    } else if (options.command === "enrich") {
      console.log(JSON.stringify(
        await enrichDexSurfacePulseWithLunarGeminiPostSemantics(options), null, 2,
      ));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: buildDexPulseLunarGeminiPostSemanticsScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
