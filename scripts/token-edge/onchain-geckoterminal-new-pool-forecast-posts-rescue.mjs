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
  GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE,
  armScore,
  forecastScoreRow,
  requestGeminiForecast,
} from "./onchain-geckoterminal-new-pool-forecast-ab.mjs";
import {
  collectExactMintLunarCrushPostsEvidence,
} from "./onchain-lunarcrush-provider.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const MAX_CAPTURE_LAG_MS = 5 * 60_000;
const FEATURE_ARM = "market-plus-lunar-posts-rescue";
const PARENT_BLOCKER = "exact-contract-lunar-social-evidence-unavailable";

export const GECKOTERMINAL_NEW_POOL_FORECAST_POSTS_RESCUE_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-gemini-lunar-posts-rescue-v2",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.version,
  changedDimension: "replace-unavailable-exact-contract-topic-aggregates-with-exact-contract-post-aggregates",
  eligibleParentFeatureArm: "market-plus-lunar",
  eligibleParentStatus: "blocked",
  eligibleParentBlocker: PARENT_BLOCKER,
  treatmentFeatureArm: FEATURE_ARM,
  maximumCandidatesPerDiscovery: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.maximumCandidatesPerDiscovery,
  maximumCaptureLagMinutes: MAX_CAPTURE_LAG_MS / 60_000,
  maximumLunarCrushRequestsPerDiscovery: 2,
  maximumGeminiRequestsPerDiscovery: 2,
  horizon: "1h",
  horizonClock: "source-discovery-observed-at",
  model: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.model,
  promptVersion: "token-edge-anonymous-one-hour-return-posts-rescue-v1",
  temperature: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.temperature,
  socialIdentity: "exact-contract-post-config",
  socialMetrics: Object.freeze([
    "interactions24h",
    "posts",
    "creators",
    "interactionsPerPost",
    "interactionsPerCreator",
    "altRank",
    "galaxyScore",
  ]),
  tokenGraphDataAllowed: false,
  symbolOrTokenIdentityInModelPromptAllowed: false,
  outsideKnowledgeAllowed: false,
  webSearchAllowed: false,
  paperLongMinimumRiseProbabilityInclusive:
    GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.paperLongMinimumRiseProbabilityInclusive,
  paperLongMinimumPredictedReturnPctInclusive:
    GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.paperLongMinimumPredictedReturnPctInclusive,
  paperNotionalUsd: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.paperNotionalUsd,
  baseRoundTripCostPct: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.baseRoundTripCostPct,
  stressRoundTripCostPct: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.stressRoundTripCostPct,
  minimumResolvedCoverage: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.minimumResolvedCoverage,
  researchOnly: true,
  mutationAllowed: false,
  decisionAuthority: false,
  promotionAuthority: false,
  tradingAuthority: false,
});

export function createGeckoTerminalNewPoolForecastPostsRescueRegistrationEvent({
  registeredAt,
  evidenceBoundary,
}) {
  const registered = validDate(registeredAt);
  const boundary = validDate(evidenceBoundary);
  if (registered.getTime() <= boundary.getTime()) {
    throw new Error("Posts-rescue registration must be strictly after its evidence boundary.");
  }
  const rule = {
    ...GECKOTERMINAL_NEW_POOL_FORECAST_POSTS_RESCUE_RULE,
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

export async function registerGeckoTerminalNewPoolForecastPostsRescue(
  options = {},
  dependencies = {},
) {
  const now = validDate(dependencies.now ?? new Date());
  const boundary = validDate(options.evidenceBoundary);
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const existing = events.find((event) => matchesRegistration(event, boundary));
  if (existing) return registrationResult(ledgerPath, "existing", existing);
  const conflicting = events.find((event) => (
    event.type === "monitoring-policy-registration"
      && event.status === "frozen"
      && event.rule?.version === GECKOTERMINAL_NEW_POOL_FORECAST_POSTS_RESCUE_RULE.version
  ));
  if (conflicting) throw new Error(`Existing posts-rescue registration mismatch: ${conflicting.id}`);
  const event = createGeckoTerminalNewPoolForecastPostsRescueRegistrationEvent({
    registeredAt: now,
    evidenceBoundary: boundary,
  });
  return registrationResult(
    ledgerPath,
    "registered",
    await appendLedgerEvent(ledgerPath, event),
  );
}

export async function captureGeckoTerminalNewPoolForecastPostsRescue(
  options = {},
  dependencies = {},
) {
  const now = validDate(dependencies.now ?? new Date());
  const clock = dependencies.clock ?? (() => new Date());
  const fetcher = dependencies.fetcher ?? fetch;
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find((event) => matchesRegistration(event));
  if (!registration) throw new Error("Register the posts-rescue forecast before capture.");
  const parentRegistration = events.find((event) => (
    event.type === "monitoring-policy-registration"
      && event.status === "frozen"
      && event.rule?.version === GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.version
  ));
  if (!parentRegistration) throw new Error("The paired topic forecast parent registration is missing.");
  const discoveries = new Map(events.filter((event) => (
    event.type === "geckoterminal-new-pool-discovery"
  )).map((event) => [event.id, event]));
  const sealed = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast-posts-rescue-capture"
      && event.registrationId === registration.id
  )).map((event) => event.discoveryEventId));
  const parentReceipts = events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast-ab-capture"
      && event.registrationId === parentRegistration.id
      && Date.parse(event.sourceDiscoveryObservedAt) > Date.parse(registration.registeredAt)
      && Date.parse(event.sourceDiscoveryObservedAt) <= now.getTime()
      && !sealed.has(event.discoveryEventId)
  )).sort((left, right) => (
    Date.parse(left.sourceDiscoveryObservedAt) - Date.parse(right.sourceDiscoveryObservedAt)
  ));
  if (!parentReceipts.length) {
    return captureResult(ledgerPath, now, "no-unsealed-future-parent-capture", null, [], 0, null);
  }
  const receipt = parentReceipts[0];
  const discovery = discoveries.get(receipt.discoveryEventId);
  if (!discovery) throw new Error(`Parent discovery is missing: ${receipt.discoveryEventId}`);
  const parentForecastIds = new Set(receipt.forecastIds ?? []);
  const topicBlockedParents = events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast-ab"
      && parentForecastIds.has(event.id)
      && event.featureArm === "market-plus-lunar"
      && event.status === "blocked"
      && event.blockers?.includes(PARENT_BLOCKER)
  ));
  if (!topicBlockedParents.length) {
    const capture = await appendUnique(ledgerPath, events, captureReceipt({
      registration,
      parentReceipt: receipt,
      discovery,
      capturedAt: now,
      status: "sealed-no-topic-blocked-parents",
      parentForecastIds: [],
      forecastIds: [],
      requestsAttempted: 0,
    }));
    return captureResult(ledgerPath, now, capture.status, discovery.id, [], 0, capture);
  }
  if (now.getTime() - Date.parse(discovery.observedAt) > MAX_CAPTURE_LAG_MS) {
    const forecasts = [];
    for (const parent of topicBlockedParents) {
      const control = parentControl(events, parentForecastIds, parent);
      forecasts.push(await appendUnique(ledgerPath, events, blockedForecast({
        registration,
        parentReceipt: receipt,
        discovery,
        parent,
        control,
        capturedAt: now,
        blocker: "posts-rescue-capture-window-expired",
      })));
    }
    const capture = await appendUnique(ledgerPath, events, captureReceipt({
      registration,
      parentReceipt: receipt,
      discovery,
      capturedAt: now,
      status: "sealed-capture-window-expired",
      parentForecastIds: topicBlockedParents.map((event) => event.id),
      forecastIds: forecasts.map((event) => event.id),
      requestsAttempted: 0,
    }));
    return captureResult(ledgerPath, now, capture.status, discovery.id, forecasts, 0, capture);
  }

  const posts = await collectExactMintLunarCrushPostsEvidence({
    apiKey: options.lunarcrushApiKey ?? process.env.LUNARCRUSH_API_KEY,
    chain: "solana",
    tokenAddresses: topicBlockedParents.map((event) => event.tokenAddress),
    observedAt: now,
    maxRequests: topicBlockedParents.length,
  }, { fetcher, clock });
  const postsByToken = new Map();
  for (const event of posts.events) {
    const signed = await appendUnique(ledgerPath, events, {
      ...event,
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    });
    postsByToken.set(signed.tokenAddress, signed);
  }
  const forecasts = [];
  let geminiRequestsAttempted = 0;
  for (const parent of topicBlockedParents) {
    const control = parentControl(events, parentForecastIds, parent);
    const postsEvidence = postsByToken.get(parent.tokenAddress) ?? null;
    const rankEvidence = events.find((event) => event.id === parent.rankEvidenceId) ?? null;
    const socialFeatures = validPostsEvidence(postsEvidence, parent.tokenAddress)
      ? postsFeatureView(postsEvidence, rankEvidence, parent.tokenAddress) : null;
    if (!validParentControl(control, discovery) || !socialFeatures) {
      forecasts.push(await appendUnique(ledgerPath, events, blockedForecast({
        registration,
        parentReceipt: receipt,
        discovery,
        parent,
        control,
        capturedAt: validDate(clock()),
        blocker: !validParentControl(control, discovery)
          ? "paired-market-control-unavailable"
          : "exact-contract-lunar-posts-evidence-unavailable",
        postsEvidence,
        socialFeatures,
      })));
      continue;
    }
    geminiRequestsAttempted += 1;
    let response;
    try {
      response = await requestGeminiForecast({
        apiKey: options.geminiApiKey
          ?? process.env.GEMINI_API_KEY
          ?? process.env.GOOGLE_AI_STUDIO_API_KEY
          ?? process.env.GOOGLE_API_KEY,
        featureArm: FEATURE_ARM,
        anonymousTokenId: digestValue(parent.tokenAddress).slice(0, 16),
        marketFeatures: control.marketFeatures,
        socialFeatures,
      }, { fetcher });
    } catch (error) {
      forecasts.push(await appendUnique(ledgerPath, events, blockedForecast({
        registration,
        parentReceipt: receipt,
        discovery,
        parent,
        control,
        capturedAt: validDate(clock()),
        blocker: safeError(error),
        postsEvidence,
        socialFeatures,
      })));
      continue;
    }
    forecasts.push(await appendUnique(ledgerPath, events, readyForecast({
      registration,
      parentReceipt: receipt,
      discovery,
      parent,
      control,
      capturedAt: validDate(clock()),
      postsEvidence,
      socialFeatures,
      response,
    })));
  }
  const requestsAttempted = posts.requestBudget.attempted + geminiRequestsAttempted;
  const capture = await appendUnique(ledgerPath, events, captureReceipt({
    registration,
    parentReceipt: receipt,
    discovery,
    capturedAt: validDate(clock()),
    status: "recorded",
    parentForecastIds: topicBlockedParents.map((event) => event.id),
    forecastIds: forecasts.map((event) => event.id),
    postsEvidenceIds: [...postsByToken.values()].map((event) => event.id),
    requestsAttempted,
  }));
  return captureResult(
    ledgerPath,
    now,
    capture.status,
    discovery.id,
    forecasts,
    requestsAttempted,
    capture,
  );
}

export function buildGeckoTerminalNewPoolForecastPostsRescueScorecard(events) {
  const registration = events.find((event) => matchesRegistration(event)) ?? null;
  const discoveries = new Map(events.filter((event) => (
    event.type === "geckoterminal-new-pool-discovery"
  )).map((event) => [event.id, event]));
  const outcomes = new Map(events.filter((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
      && event.horizon === "1h"
  )).map((event) => [`${event.discoveryEventId}:${event.pairAddress}`, event]));
  const treatments = events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast-posts-rescue"
      && event.registrationId === registration?.id
  ));
  const controls = treatments.map((treatment) => events.find((event) => (
    event.id === treatment.controlForecastId
      && event.type === "geckoterminal-new-pool-forecast-ab"
      && event.featureArm === "market-only"
  ))).filter(Boolean);
  const treatmentRows = treatments.map((forecast) => forecastScoreRow({
    forecast,
    discovery: discoveries.get(forecast.discoveryEventId),
    outcome: outcomes.get(`${forecast.discoveryEventId}:${forecast.pairAddress}`),
  })).filter(Boolean);
  const controlRows = controls.map((forecast) => forecastScoreRow({
    forecast,
    discovery: discoveries.get(forecast.discoveryEventId),
    outcome: outcomes.get(`${forecast.discoveryEventId}:${forecast.pairAddress}`),
  })).filter(Boolean);
  const pairs = pairedRows({ treatments, controls, discoveries, outcomes });
  return {
    type: "geckoterminal-new-pool-forecast-posts-rescue-scorecard",
    ruleVersion: GECKOTERMINAL_NEW_POOL_FORECAST_POSTS_RESCUE_RULE.version,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    evidenceBoundary: registration?.rule?.evidenceBoundary ?? null,
    eligibleTopicBlockedParents: treatments.length,
    postsAvailabilityRescueRate: ratio(
      treatments.filter((event) => event.status === "ready").length,
      treatments.length,
    ),
    arms: {
      "market-only": armScore(controls, controlRows, outcomes),
      [FEATURE_ARM]: armScore(treatments, treatmentRows, outcomes),
    },
    pairedComparison: {
      observedPairs: pairs.length,
      postsDirectionAccuracyDelta: nullableRound(mean(pairs.map((pair) => (
        Number(pair.treatment.directionCorrect) - Number(pair.control.directionCorrect)
      )))),
      postsMeanAbsoluteErrorImprovementPct: nullableRound(mean(pairs.map((pair) => (
        pair.control.absoluteErrorPct - pair.treatment.absoluteErrorPct
      )))),
      postsBrierImprovement: nullableRound(mean(pairs.map((pair) => (
        pair.control.brierScore - pair.treatment.brierScore
      )))),
      postsBaseReturnDeltaPct: nullableRound(mean(pairs.map((pair) => (
        pair.treatment.baseReturnPct - pair.control.baseReturnPct
      )))),
    },
    evidenceStatus: treatments.length
      ? "future-only-topic-unavailability-rescue-panel"
      : "awaiting-future-topic-blocked-parents",
    statisticalCandidateGate: false,
    independentValidationStatus: "not-run",
    decisionAuthority: false,
    promotionAuthority: false,
    provisionalGate: false,
    tradingAuthority: false,
    mutationAllowed: false,
    researchOnly: true,
    note: "This conditional challenger changes only the social evidence source for future exact-topic-blocked parents. Blocked posts remain cash and in the availability denominator; no result can promote or trade.",
  };
}

function readyForecast({
  registration,
  parentReceipt,
  discovery,
  parent,
  control,
  capturedAt,
  postsEvidence,
  socialFeatures,
  response,
}) {
  const common = forecastCommon({
    registration, parentReceipt, discovery, parent, control, capturedAt,
  });
  const prediction = response.prediction;
  const paperDecision = prediction.predictedRise
    && prediction.riseProbability
      >= GECKOTERMINAL_NEW_POOL_FORECAST_POSTS_RESCUE_RULE
        .paperLongMinimumRiseProbabilityInclusive
    && prediction.predictedReturnPct
      >= GECKOTERMINAL_NEW_POOL_FORECAST_POSTS_RESCUE_RULE
        .paperLongMinimumPredictedReturnPctInclusive
    ? "paper-long" : "paper-cash";
  return {
    ...common,
    status: "ready",
    blockers: [],
    marketFeatures: control.marketFeatures,
    marketFeaturesDigest: digestValue(control.marketFeatures),
    socialFeatures,
    socialFeaturesDigest: digestValue(socialFeatures),
    socialDataExcluded: false,
    socialEvidenceId: postsEvidence.id,
    modelVersion: response.modelVersion,
    promptDigest: response.promptDigest,
    prediction,
    predictionDigest: digestValue(prediction),
    paperDecision,
  };
}

function blockedForecast({
  registration,
  parentReceipt,
  discovery,
  parent,
  control,
  capturedAt,
  blocker,
  postsEvidence = null,
  socialFeatures = null,
}) {
  return {
    ...forecastCommon({
      registration, parentReceipt, discovery, parent, control, capturedAt,
    }),
    status: "blocked",
    blockers: [cleanText(blocker).slice(0, 300) || "posts-rescue forecast unavailable"],
    marketFeatures: control?.marketFeatures ?? null,
    marketFeaturesDigest: control?.marketFeatures
      ? digestValue(control.marketFeatures) : null,
    socialFeatures,
    socialFeaturesDigest: socialFeatures ? digestValue(socialFeatures) : null,
    socialDataExcluded: false,
    socialEvidenceId: postsEvidence?.id ?? null,
    modelVersion: null,
    promptDigest: null,
    prediction: null,
    predictionDigest: null,
    paperDecision: "unavailable",
  };
}

function forecastCommon({
  registration, parentReceipt, discovery, parent, control, capturedAt,
}) {
  return {
    type: "geckoterminal-new-pool-forecast-posts-rescue",
    id: `geckoterminal_new_pool_forecast_posts_rescue_${digestValue({
      registrationId: registration.id,
      parentForecastId: parent.id,
    }).slice(0, 24)}`,
    ruleVersion: GECKOTERMINAL_NEW_POOL_FORECAST_POSTS_RESCUE_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    parentRuleVersion: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.version,
    parentCaptureReceiptId: parentReceipt.id,
    parentTopicTreatmentForecastId: parent.id,
    controlForecastId: control?.id ?? null,
    discoveryEventId: discovery.id,
    sourceDiscoveryObservedAt: discovery.observedAt,
    createdAt: validDate(capturedAt).toISOString(),
    dueAt: new Date(Date.parse(discovery.observedAt) + HOUR_MS).toISOString(),
    featureArm: FEATURE_ARM,
    chain: parent.chain,
    tokenAddress: parent.tokenAddress,
    pairAddress: parent.pairAddress,
    poolCreatedAt: parent.poolCreatedAt,
    birthQuoteDigest: parent.birthQuoteDigest,
    model: GECKOTERMINAL_NEW_POOL_FORECAST_POSTS_RESCUE_RULE.model,
    promptVersion: GECKOTERMINAL_NEW_POOL_FORECAST_POSTS_RESCUE_RULE.promptVersion,
    rawModelResponseRetained: false,
    tokenGraphDataUsed: false,
    symbolOrTokenIdentityInModelPromptUsed: false,
    outsideKnowledgeAllowed: false,
    webSearchUsed: false,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

function captureReceipt({
  registration,
  parentReceipt,
  discovery,
  capturedAt,
  status,
  parentForecastIds,
  forecastIds,
  requestsAttempted,
  postsEvidenceIds = [],
}) {
  return {
    type: "geckoterminal-new-pool-forecast-posts-rescue-capture",
    id: `geckoterminal_new_pool_forecast_posts_rescue_capture_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    }).slice(0, 24)}`,
    ruleVersion: GECKOTERMINAL_NEW_POOL_FORECAST_POSTS_RESCUE_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    parentCaptureReceiptId: parentReceipt.id,
    discoveryEventId: discovery.id,
    sourceDiscoveryObservedAt: discovery.observedAt,
    capturedAt: validDate(capturedAt).toISOString(),
    status,
    parentTopicTreatmentForecastIds: parentForecastIds,
    forecastIds,
    postsEvidenceIds,
    requestsAttempted,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

function parentControl(events, parentForecastIds, parent) {
  return events.find((event) => (
    parentForecastIds.has(event.id)
      && event.type === "geckoterminal-new-pool-forecast-ab"
      && event.featureArm === "market-only"
      && event.discoveryEventId === parent.discoveryEventId
      && event.pairAddress === parent.pairAddress
      && event.tokenAddress === parent.tokenAddress
  )) ?? null;
}

function validParentControl(control, discovery) {
  const candidate = (discovery?.candidates ?? []).find((item) => (
    item.pairAddress === control?.pairAddress
      && item.tokenAddress === control?.tokenAddress
  ));
  return control?.status === "ready"
    && control.registrationId
    && control.ruleVersion === GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.version
    && control.socialDataExcluded === true
    && control.socialFeatures === null
    && candidate?.birthQuote
    && digestValue(candidate.birthQuote) === control.birthQuoteDigest
    && digestValue(control.marketFeatures) === control.marketFeaturesDigest;
}

function validPostsEvidence(event, tokenAddress) {
  return event?.type === "lunarcrush-contract-posts-snapshot"
    && event.status === "ready"
    && event.tokenAddress === tokenAddress
    && event.identity?.matchStatus === "exact-contract-post-config"
    && event.postMetricsDigest === digestValue(event.postMetrics)
    && event.aggregateOnly === true
    && event.rawPostsRetained === false
    && event.rawPostTextRetained === false
    && event.rawCreatorIdentitiesRetained === false
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function postsFeatureView(postsEvidence, rankEvidence, tokenAddress) {
  const metrics = postsEvidence.postMetrics;
  const rank = (rankEvidence?.matches ?? []).find((match) => (
    match.tokenAddress === tokenAddress
  ));
  return {
    interactions24h: finiteNumber(metrics?.interactions24h),
    posts: finiteNumber(metrics?.postCount),
    creators: finiteNumber(metrics?.uniqueCreatorCount),
    interactionsPerPost: ratio(metrics?.interactions24h, metrics?.postCount),
    interactionsPerCreator: ratio(metrics?.interactions24h, metrics?.uniqueCreatorCount),
    altRank: finiteNumber(rank?.altRank),
    galaxyScore: finiteNumber(rank?.galaxyScore),
    exactContractTopicReady: false,
    exactContractPostsReady: true,
    exactContractTopRankCovered: Boolean(rank),
  };
}

function pairedRows({ treatments, controls, discoveries, outcomes }) {
  const controlsById = new Map(controls.map((event) => [event.id, event]));
  const rows = [];
  for (const treatment of treatments) {
    const control = controlsById.get(treatment.controlForecastId);
    const outcome = outcomes.get(`${treatment.discoveryEventId}:${treatment.pairAddress}`);
    if (treatment.status !== "ready" || control?.status !== "ready"
      || outcome?.status !== "observed") continue;
    const discovery = discoveries.get(treatment.discoveryEventId);
    const treatmentRow = forecastScoreRow({ forecast: treatment, discovery, outcome });
    const controlRow = forecastScoreRow({ forecast: control, discovery, outcome });
    if (treatmentRow && controlRow) rows.push({ treatment: treatmentRow, control: controlRow });
  }
  return rows;
}

function matchesRegistration(event, evidenceBoundary = null) {
  if (event?.type !== "monitoring-policy-registration"
    || event.status !== "frozen"
    || event.rule?.version !== GECKOTERMINAL_NEW_POOL_FORECAST_POSTS_RESCUE_RULE.version) {
    return false;
  }
  if (evidenceBoundary
    && event.rule.evidenceBoundary !== validDate(evidenceBoundary).toISOString()) return false;
  const expected = createGeckoTerminalNewPoolForecastPostsRescueRegistrationEvent({
    registeredAt: event.registeredAt,
    evidenceBoundary: event.rule.evidenceBoundary,
  });
  return expected.id === event.id
    && canonical(expected.rule) === canonical(event.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false
    && event.decisionAuthority === false
    && event.promotionAuthority === false
    && event.tradingAuthority === false;
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

function registrationResult(ledgerPath, status, event) {
  return {
    ledgerPath,
    status,
    registrationId: event.id,
    registeredAt: event.registeredAt,
    evidenceBoundary: event.rule.evidenceBoundary,
    ruleVersion: event.rule.version,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

function captureResult(
  ledgerPath,
  observedAt,
  status,
  discoveryEventId,
  forecasts,
  requestsAttempted,
  receipt,
) {
  return {
    ledgerPath,
    observedAt: observedAt.toISOString(),
    status,
    discoveryEventId,
    captureReceiptId: receipt?.id ?? null,
    eligibleTopicBlockedParents: receipt?.parentTopicTreatmentForecastIds?.length ?? 0,
    recordedForecasts: forecasts.length,
    readyForecasts: forecasts.filter((event) => event.status === "ready").length,
    blockedForecasts: forecasts.filter((event) => event.status === "blocked").length,
    requestsAttempted,
    forecasts,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function ratio(numerator, denominator) {
  const top = finiteNumber(numerator);
  const bottom = finiteNumber(denominator);
  return Number.isFinite(top) && Number.isFinite(bottom) && bottom > 0
    ? nullableRound(top / bottom) : null;
}

function nullableRound(value) {
  return Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : null;
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Expected a valid timestamp.");
  return date;
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
  const options = { command: argv[2] ?? "score" };
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--ledger") options.ledgerPath = argv[++index];
    else if (argv[index] === "--evidence-boundary") options.evidenceBoundary = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "capture", "score"].includes(options.command)) {
    throw new Error("Usage: onchain-geckoterminal-new-pool-forecast-posts-rescue.mjs register|capture|score [--evidence-boundary ISO --ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerGeckoTerminalNewPoolForecastPostsRescue(options), null, 2));
    } else if (options.command === "capture") {
      console.log(JSON.stringify(await captureGeckoTerminalNewPoolForecastPostsRescue(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: buildGeckoTerminalNewPoolForecastPostsRescueScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
