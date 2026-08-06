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
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
} from "./onchain-geckoterminal-new-pool-activation.mjs";
import {
  collectExactMintLunarCrushTopicEvidence,
} from "./onchain-lunarcrush-provider.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const MAX_CAPTURE_LAG_MS = 5 * 60_000;
const LUNARCRUSH_BASE_URL = "https://lunarcrush.com/api4/public";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const FEATURE_ARMS = Object.freeze(["market-only", "market-plus-lunar"]);

const FORECAST_RESPONSE_SCHEMA = Object.freeze({
  type: "OBJECT",
  properties: Object.freeze({
    predictedRise: Object.freeze({ type: "BOOLEAN" }),
    riseProbability: Object.freeze({ type: "NUMBER" }),
    predictedReturnPct: Object.freeze({ type: "NUMBER" }),
    confidence: Object.freeze({ type: "NUMBER" }),
  }),
  required: Object.freeze([
    "predictedRise",
    "riseProbability",
    "predictedReturnPct",
    "confidence",
  ]),
});

export const GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-gemini-lunar-ab-forecast-v1",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version,
  changedDimension: "exact-contract-lunar-social-aggregates-added-to-an-identical-market-prompt",
  arms: FEATURE_ARMS,
  maximumCandidatesPerDiscovery: 2,
  candidateSelection: "sha256-registration-discovery-token-pair-ascending",
  maximumCaptureLagMinutes: MAX_CAPTURE_LAG_MS / 60_000,
  horizon: "1h",
  horizonClock: "source-discovery-observed-at",
  model: "gemini-3.6-flash",
  promptVersion: "token-edge-anonymous-one-hour-return-ab-v1",
  temperature: 0,
  maximumLunarCrushRequestsPerDiscovery: 3,
  maximumGeminiRequestsPerDiscovery: 4,
  lunarMetrics: Object.freeze([
    "interactions24h",
    "posts",
    "creators",
    "altRank",
    "galaxyScore",
  ]),
  socialIdentity: "exact-contract-topic-and-optional-exact-contract-top-rank",
  tokenGraphDataAllowed: false,
  symbolOrTokenIdentityInModelPromptAllowed: false,
  outsideKnowledgeAllowed: false,
  webSearchAllowed: false,
  paperLongMinimumRiseProbabilityInclusive: 0.6,
  paperLongMinimumPredictedReturnPctInclusive: 12,
  paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentSignalFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumPredictedRiseForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  bootstrapLower95MustExceedPct: TOKEN_EDGE_EXECUTION_POLICY.bootstrapLower95MustExceedPct,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  minimumResolvedCoverage: 0.95,
  researchOnly: true,
  mutationAllowed: false,
  decisionAuthority: false,
  promotionAuthority: false,
  tradingAuthority: false,
});

export function createGeckoTerminalNewPoolForecastAbRegistrationEvent({
  registeredAt,
  evidenceBoundary,
}) {
  const registered = validDate(registeredAt);
  const boundary = validDate(evidenceBoundary);
  if (registered.getTime() <= boundary.getTime()) {
    throw new Error("Paired forecast registration must be strictly after its evidence boundary.");
  }
  const rule = {
    ...GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE,
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

export async function registerGeckoTerminalNewPoolForecastAb(
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
      && event.rule?.version === GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.version
  ));
  if (conflicting) throw new Error(`Existing paired forecast registration mismatch: ${conflicting.id}`);
  const event = createGeckoTerminalNewPoolForecastAbRegistrationEvent({
    registeredAt: now,
    evidenceBoundary,
  });
  return registrationResult(
    ledgerPath,
    "registered",
    await appendLedgerEvent(ledgerPath, event),
  );
}

export async function captureGeckoTerminalNewPoolForecastAb(
  options = {},
  dependencies = {},
) {
  const now = validDate(dependencies.now ?? new Date());
  const clock = dependencies.clock ?? (() => new Date());
  const fetcher = dependencies.fetcher ?? fetch;
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find((event) => matchesRegistration(event));
  if (!registration) throw new Error("Register the paired full-cohort forecast before capture.");
  const receipts = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast-ab-capture"
      && event.registrationId === registration.id
  )).map((event) => event.discoveryEventId));
  const discoveries = events.filter((event) => (
    event.type === "geckoterminal-new-pool-discovery"
      && Date.parse(event.observedAt) > Date.parse(registration.registeredAt)
      && Date.parse(event.observedAt) <= now.getTime()
  )).sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  if (!discoveries.length) {
    return captureResult(ledgerPath, now, "no-strictly-future-discovery", null, [], 0, null);
  }
  const discovery = discoveries.find((event) => !receipts.has(event.id));
  if (!discovery) {
    return captureResult(ledgerPath, now, "no-unsealed-future-discovery", null, [], 0, null);
  }
  const selected = deterministicCandidates(registration, discovery);
  if (!selected.length) {
    const receipt = await appendUnique(ledgerPath, events, captureReceipt({
      registration,
      discovery,
      capturedAt: now,
      status: "sealed-no-watchable-candidates",
      selected,
      requestsAttempted: 0,
      forecastIds: [],
    }));
    return captureResult(ledgerPath, now, receipt.status, discovery.id, [], 0, receipt);
  }
  if (now.getTime() - Date.parse(discovery.observedAt) > MAX_CAPTURE_LAG_MS) {
    const forecasts = [];
    for (const candidate of selected) {
      for (const featureArm of FEATURE_ARMS) {
        forecasts.push(await appendUnique(ledgerPath, events, blockedForecastEvent({
          registration,
          discovery,
          candidate,
          featureArm,
          capturedAt: now,
          blocker: "paired-forecast-capture-window-expired",
          socialEvidence: null,
          rankEvidence: null,
        })));
      }
    }
    const receipt = await appendUnique(ledgerPath, events, captureReceipt({
      registration,
      discovery,
      capturedAt: now,
      status: "sealed-capture-window-expired",
      selected,
      requestsAttempted: 0,
      forecastIds: forecasts.map((event) => event.id),
    }));
    return captureResult(ledgerPath, now, receipt.status, discovery.id, forecasts, 0, receipt);
  }

  const tokenAddresses = selected.map((candidate) => candidate.tokenAddress);
  const rank = await collectTopRankEvidence({
    apiKey: options.lunarcrushApiKey ?? process.env.LUNARCRUSH_API_KEY,
    tokenAddresses,
    observedAt: now,
  }, { fetcher, clock });
  const signedRank = await appendUnique(ledgerPath, events, {
    ...rank.event,
    registrationId: registration.id,
    discoveryEventId: discovery.id,
  });
  const topics = await collectExactMintLunarCrushTopicEvidence({
    apiKey: options.lunarcrushApiKey ?? process.env.LUNARCRUSH_API_KEY,
    chain: "solana",
    tokenAddresses,
    observedAt: now,
    maxRequests: selected.length,
  }, { fetcher, clock });
  const topicByToken = new Map();
  for (const topic of topics.events) {
    const signed = await appendUnique(ledgerPath, events, {
      ...topic,
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    });
    topicByToken.set(signed.tokenAddress, signed);
  }
  const rankByToken = new Map((signedRank.matches ?? []).map((match) => [
    match.tokenAddress,
    match,
  ]));

  const forecasts = [];
  let geminiRequestsAttempted = 0;
  for (const candidate of selected) {
    const marketFeatures = birthMarketFeatures(candidate.birthQuote);
    const topic = topicByToken.get(candidate.tokenAddress) ?? null;
    const rankMatch = rankByToken.get(candidate.tokenAddress) ?? null;
    const socialFeatures = validTopicEvidence(topic, candidate.tokenAddress)
      ? socialFeatureView(topic, rankMatch)
      : null;
    for (const featureArm of FEATURE_ARMS) {
      const requiresSocial = featureArm === "market-plus-lunar";
      if (requiresSocial && !socialFeatures) {
        forecasts.push(await appendUnique(ledgerPath, events, blockedForecastEvent({
          registration,
          discovery,
          candidate,
          featureArm,
          capturedAt: validDate(clock()),
          blocker: "exact-contract-lunar-social-evidence-unavailable",
          socialEvidence: topic,
          rankEvidence: signedRank,
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
          featureArm,
          anonymousTokenId: digestValue(candidate.tokenAddress).slice(0, 16),
          marketFeatures,
          socialFeatures: requiresSocial ? socialFeatures : null,
        }, { fetcher });
      } catch (error) {
        forecasts.push(await appendUnique(ledgerPath, events, blockedForecastEvent({
          registration,
          discovery,
          candidate,
          featureArm,
          capturedAt: validDate(clock()),
          blocker: safeError(error),
          socialEvidence: topic,
          rankEvidence: signedRank,
          marketFeatures,
          socialFeatures: requiresSocial ? socialFeatures : null,
        })));
        continue;
      }
      forecasts.push(await appendUnique(ledgerPath, events, readyForecastEvent({
        registration,
        discovery,
        candidate,
        featureArm,
        capturedAt: validDate(clock()),
        marketFeatures,
        socialFeatures: requiresSocial ? socialFeatures : null,
        socialEvidence: topic,
        rankEvidence: signedRank,
        response,
      })));
    }
  }
  const requestsAttempted = rank.requestsAttempted
    + topics.requestBudget.attempted
    + geminiRequestsAttempted;
  const receipt = await appendUnique(ledgerPath, events, captureReceipt({
    registration,
    discovery,
    capturedAt: validDate(clock()),
    status: "recorded",
    selected,
    requestsAttempted,
    forecastIds: forecasts.map((event) => event.id),
    rankEvidenceId: signedRank.id,
    topicEvidenceIds: [...topicByToken.values()].map((event) => event.id),
  }));
  return captureResult(
    ledgerPath,
    now,
    receipt.status,
    discovery.id,
    forecasts,
    requestsAttempted,
    receipt,
  );
}

export function buildGeckoTerminalNewPoolForecastAbScorecard(events) {
  const registration = events.find((event) => matchesRegistration(event)) ?? null;
  const discoveries = new Map(events.filter((event) => (
    event.type === "geckoterminal-new-pool-discovery"
  )).map((event) => [event.id, event]));
  const forecasts = events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast-ab"
      && event.registrationId === registration?.id
  ));
  const outcomes = new Map(events.filter((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
      && event.horizon === "1h"
  )).map((event) => [`${event.discoveryEventId}:${event.pairAddress}`, event]));
  const arms = Object.fromEntries(FEATURE_ARMS.map((featureArm) => {
    const armForecasts = forecasts.filter((forecast) => forecast.featureArm === featureArm);
    const rows = armForecasts.map((forecast) => forecastScoreRow({
      forecast,
      discovery: discoveries.get(forecast.discoveryEventId),
      outcome: outcomes.get(`${forecast.discoveryEventId}:${forecast.pairAddress}`),
    })).filter(Boolean);
    return [featureArm, armScore(armForecasts, rows, outcomes)];
  }));
  const pairedComparison = pairedScore({ forecasts, discoveries, outcomes });
  return {
    type: "geckoterminal-new-pool-forecast-ab-scorecard",
    ruleVersion: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.version,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    evidenceBoundary: registration?.rule?.evidenceBoundary ?? null,
    candidateForecasts: forecasts.length,
    arms,
    pairedComparison,
    evidenceStatus: forecasts.length ? "future-only-forecast-panel" : "awaiting-future-forecasts",
    statisticalCandidateGate: false,
    independentValidationStatus: "not-run",
    decisionAuthority: false,
    promotionAuthority: false,
    provisionalGate: false,
    tradingAuthority: false,
    mutationAllowed: false,
    researchOnly: true,
    note: "The paired treatment changes only exact-contract LunarCrush aggregate context. Both arms are immutable one-hour direction/magnitude forecasts; paper PnL remains research-only and cannot promote or trade.",
  };
}

async function collectTopRankEvidence(options, dependencies) {
  const fetcher = dependencies.fetcher;
  const clock = dependencies.clock;
  const observedAt = validDate(options.observedAt);
  const tokenAddresses = new Set(options.tokenAddresses);
  const endpoint = `${LUNARCRUSH_BASE_URL}/coins/list/v1?limit=1000&sort=alt_rank`;
  let response;
  let body;
  let blocker = null;
  try {
    response = await fetcher(endpoint, {
      headers: { Authorization: `Bearer ${requiredText(options.apiKey, "LUNARCRUSH_API_KEY")}` },
      signal: AbortSignal.timeout(10_000),
    });
    body = await response.json().catch(() => null);
    if (!response.ok) blocker = `LunarCrush top-rank list returned HTTP ${response.status}`;
  } catch (error) {
    blocker = safeError(error);
    body = null;
  }
  const availableAt = validDate(clock()).toISOString();
  const generated = finiteNumber(body?.config?.generated);
  if (generated != null && generated * 1_000 > observedAt.getTime() + MAX_CAPTURE_LAG_MS) {
    blocker = "LunarCrush top-rank generation time is in the future";
  }
  const matches = blocker ? [] : exactTopRankMatches(body?.data, tokenAddresses);
  const event = {
    type: "lunarcrush-exact-contract-top-rank-snapshot",
    id: `lunarcrush_exact_contract_top_rank_${digestValue({
      observedAt: observedAt.toISOString(), availableAt, matches, blocker,
    }).slice(0, 24)}`,
    provider: "lunarcrush",
    profile: "exact-contract-top-1000-alt-rank",
    observedAt: observedAt.toISOString(),
    availableAt,
    endpoint,
    status: blocker ? "blocked" : "ready",
    blockers: blocker ? [blocker] : [],
    matches,
    requestedTokenAddressesDigest: digestValue([...tokenAddresses].sort()),
    responseDigest: blocker ? null : digestValue({ generated, matches }),
    aggregateOnly: true,
    completeUniverseClaimed: false,
    absenceMeansUnranked: false,
    rawUniverseRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
  return { event, requestsAttempted: 1 };
}

function exactTopRankMatches(rows, tokenAddresses) {
  const matches = [];
  const counts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const addresses = (Array.isArray(row?.blockchains) ? row.blockchains : [])
      .filter((chain) => normalize(chain?.network) === "solana")
      .map((chain) => cleanText(chain?.address))
      .filter((address) => tokenAddresses.has(address));
    for (const address of addresses) {
      counts.set(address, (counts.get(address) ?? 0) + 1);
      matches.push({
        tokenAddress: address,
        altRank: finiteNumber(row?.alt_rank),
        galaxyScore: finiteNumber(row?.galaxy_score),
      });
    }
  }
  return matches.filter((match) => (
    counts.get(match.tokenAddress) === 1
      && Number.isFinite(match.altRank)
      && match.altRank > 0
      && Number.isFinite(match.galaxyScore)
      && match.galaxyScore >= 0
      && match.galaxyScore <= 100
  )).sort((left, right) => left.tokenAddress.localeCompare(right.tokenAddress));
}

export async function requestGeminiForecast(input, dependencies) {
  const rule = GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE;
  const apiKey = requiredText(input.apiKey, "A Google Gemini API key");
  const promptContext = {
    featureArm: input.featureArm,
    anonymousTokenId: input.anonymousTokenId,
    horizon: rule.horizon,
    marketFeatures: input.marketFeatures,
    socialFeatures: input.socialFeatures,
  };
  const prompt = [
    "Predict the token price return exactly one hour after the supplied observation.",
    "Use only the supplied anonymous numeric features. Do not use web search, outside knowledge, token identity, symbol, contract address, graph data, or later outcomes.",
    "predictedReturnPct is the signed percentage return, bounded from -100 through 10000.",
    "riseProbability and confidence must be from 0 through 1.",
    "predictedRise must equal whether riseProbability is at least 0.5.",
    `Input JSON: ${JSON.stringify(promptContext)}`,
  ].join(" ");
  const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(rule.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await dependencies.fetcher(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: rule.temperature,
        responseMimeType: "application/json",
        responseSchema: FORECAST_RESPONSE_SCHEMA,
      },
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Gemini returned HTTP ${response.status}: ${cleanText(body?.error?.status) || "request failed"}`);
  }
  const raw = (body?.candidates?.[0]?.content?.parts ?? [])
    .map((part) => cleanText(part?.text)).join("");
  let prediction;
  try {
    prediction = JSON.parse(raw);
  } catch {
    throw new Error("Gemini returned invalid forecast JSON");
  }
  if (!validPrediction(prediction)) throw new Error("Gemini returned invalid forecast values");
  return {
    modelVersion: cleanText(body?.modelVersion) || rule.model,
    promptDigest: digestValue(prompt),
    prediction: normalizePrediction(prediction),
  };
}

function readyForecastEvent({
  registration,
  discovery,
  candidate,
  featureArm,
  capturedAt,
  marketFeatures,
  socialFeatures,
  socialEvidence,
  rankEvidence,
  response,
}) {
  const common = forecastCommon({ registration, discovery, candidate, featureArm, capturedAt });
  const paperDecision = response.prediction.predictedRise
    && response.prediction.riseProbability
      >= GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.paperLongMinimumRiseProbabilityInclusive
    && response.prediction.predictedReturnPct
      >= GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.paperLongMinimumPredictedReturnPctInclusive
    ? "paper-long" : "paper-cash";
  return {
    ...common,
    status: "ready",
    blockers: [],
    marketFeatures,
    marketFeaturesDigest: digestValue(marketFeatures),
    socialFeatures,
    socialFeaturesDigest: socialFeatures ? digestValue(socialFeatures) : null,
    socialDataExcluded: featureArm === "market-only",
    socialEvidenceId: featureArm === "market-plus-lunar" ? socialEvidence?.id ?? null : null,
    rankEvidenceId: featureArm === "market-plus-lunar" ? rankEvidence?.id ?? null : null,
    modelVersion: response.modelVersion,
    promptDigest: response.promptDigest,
    prediction: response.prediction,
    predictionDigest: digestValue(response.prediction),
    paperDecision,
  };
}

function blockedForecastEvent({
  registration,
  discovery,
  candidate,
  featureArm,
  capturedAt,
  blocker,
  socialEvidence,
  rankEvidence,
  marketFeatures = null,
  socialFeatures = null,
}) {
  return {
    ...forecastCommon({ registration, discovery, candidate, featureArm, capturedAt }),
    status: "blocked",
    blockers: [cleanText(blocker).slice(0, 300) || "forecast unavailable"],
    marketFeatures,
    marketFeaturesDigest: marketFeatures ? digestValue(marketFeatures) : null,
    socialFeatures,
    socialFeaturesDigest: socialFeatures ? digestValue(socialFeatures) : null,
    socialDataExcluded: featureArm === "market-only",
    socialEvidenceId: featureArm === "market-plus-lunar" ? socialEvidence?.id ?? null : null,
    rankEvidenceId: featureArm === "market-plus-lunar" ? rankEvidence?.id ?? null : null,
    modelVersion: null,
    promptDigest: null,
    prediction: null,
    predictionDigest: null,
    paperDecision: "unavailable",
  };
}

function forecastCommon({ registration, discovery, candidate, featureArm, capturedAt }) {
  const dueAt = new Date(Date.parse(discovery.observedAt) + HOUR_MS).toISOString();
  return {
    type: "geckoterminal-new-pool-forecast-ab",
    id: `geckoterminal_new_pool_forecast_ab_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
      pairAddress: candidate.pairAddress,
      featureArm,
    }).slice(0, 24)}`,
    ruleVersion: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    sourceDiscoveryObservedAt: discovery.observedAt,
    createdAt: capturedAt.toISOString(),
    dueAt,
    featureArm,
    chain: candidate.chain,
    tokenAddress: candidate.tokenAddress,
    pairAddress: candidate.pairAddress,
    poolCreatedAt: candidate.poolCreatedAt,
    birthQuoteDigest: digestValue(candidate.birthQuote),
    model: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.model,
    promptVersion: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.promptVersion,
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
  discovery,
  capturedAt,
  status,
  selected,
  requestsAttempted,
  forecastIds,
  rankEvidenceId = null,
  topicEvidenceIds = [],
}) {
  return {
    type: "geckoterminal-new-pool-forecast-ab-capture",
    id: `geckoterminal_new_pool_forecast_ab_capture_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    }).slice(0, 24)}`,
    ruleVersion: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    sourceDiscoveryObservedAt: discovery.observedAt,
    capturedAt: capturedAt.toISOString(),
    status,
    selectedCandidates: selected.map((candidate) => ({
      tokenAddress: candidate.tokenAddress,
      pairAddress: candidate.pairAddress,
      birthQuoteDigest: digestValue(candidate.birthQuote),
    })),
    requestsAttempted,
    forecastIds,
    rankEvidenceId,
    topicEvidenceIds,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

export function armScore(armForecasts, rows, outcomes) {
  const ready = armForecasts.filter((forecast) => forecast.status === "ready");
  const observed = rows.filter((row) => row.outcomeStatus === "observed");
  const observedByForecastId = new Map(observed.map((row) => [row.forecastId, row]));
  const paperObserved = armForecasts.map((forecast) => (
    forecast.status === "ready"
      ? observedByForecastId.get(forecast.id) ?? null
      : blockedCashScoreRow({
        forecast,
        outcome: outcomes.get(`${forecast.discoveryEventId}:${forecast.pairAddress}`),
      })
  )).filter(Boolean);
  const frames = independentAssetFrames(paperObserved, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const evaluatedFrames = independentAssetFrames(observed, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weighted = frames.flat();
  const baseFrames = frames.map((frame) => mean(frame.map((row) => row.baseReturnPct)));
  const stressFrames = frames.map((frame) => mean(frame.map((row) => row.stressReturnPct)));
  const tradedFrames = frames.filter((frame) => frame.some((row) => row.paperLong));
  const baseCi = baseFrames.length >= 2
    ? circularBlockBootstrapMeanInterval(
      baseFrames,
      GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.bootstrapIterations,
    ) : [null, null];
  const matured = armForecasts.filter((forecast) => outcomes.has(
    `${forecast.discoveryEventId}:${forecast.pairAddress}`,
  ));
  const resolved = matured.filter((forecast) => outcomes.get(
    `${forecast.discoveryEventId}:${forecast.pairAddress}`,
  )?.status === "observed");
  const observedCoverage = matured.length
    ? resolved.length / matured.length : null;
  const forecastAvailabilityCoverage = armForecasts.length
    ? ready.length / armForecasts.length : null;
  const statisticalCandidateGate = observed.length
      >= GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.minimumMaturedForecasts
    && evaluatedFrames.length
      >= GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.minimumIndependentSignalFrames
    && new Set(observed.map(tokenEdgeAssetKey)).size
      >= GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.minimumUniqueTokens
    && ready.filter((forecast) => forecast.paperDecision === "paper-long").length
      >= GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.minimumPredictedRiseForecasts
    && tradedFrames.length
      >= GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.minimumIndependentTradedFrames
    && observedCoverage >= GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.minimumResolvedCoverage
    && forecastAvailabilityCoverage
      >= GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.minimumResolvedCoverage
    && baseCi[0] > GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.bootstrapLower95MustExceedPct
    && mean(stressFrames) > 0
    && profitFactor(baseFrames) >= GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.minimumProfitFactor
    && maxDrawdownPct(baseFrames) <= GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.maximumDrawdownPct
    && largestWinningShare(baseFrames)
      <= GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.maximumLargestWinningFrameShare;
  return {
    candidateForecasts: armForecasts.length,
    readyForecasts: ready.length,
    blockedForecasts: armForecasts.length - ready.length,
    paperLongForecasts: ready.filter((forecast) => forecast.paperDecision === "paper-long").length,
    openOutcomes: armForecasts.filter((forecast) => !outcomes.has(
      `${forecast.discoveryEventId}:${forecast.pairAddress}`,
    )).length,
    observedOutcomes: observed.length,
    paperObservedOutcomes: paperObserved.length,
    missedOutcomes: matured.length - resolved.length,
    resolvedCoverage: nullableRound(observedCoverage),
    forecastAvailabilityCoverage: nullableRound(forecastAvailabilityCoverage),
    independentHourlyFrames: frames.length,
    independentEvaluatedFrames: evaluatedFrames.length,
    independentTradedFrames: tradedFrames.length,
    uniqueTokens: new Set(weighted.map(tokenEdgeAssetKey)).size,
    directionAccuracy: roundRatio(
      observed.filter((row) => row.directionCorrect).length,
      observed.length,
    ),
    brierScore: nullableRound(mean(observed.map((row) => row.brierScore))),
    meanAbsoluteErrorPct: nullableRound(mean(observed.map((row) => row.absoluteErrorPct))),
    rootMeanSquaredErrorPct: nullableRound(rootMeanSquaredError(
      observed.map((row) => row.squaredErrorPct),
    )),
    meanPredictedReturnPct: nullableRound(mean(observed.map((row) => row.predictedReturnPct))),
    meanActualReturnPct: nullableRound(mean(observed.map((row) => row.grossReturnPct))),
    explosion25Precision: roundRatio(
      observed.filter((row) => row.predictedExplosion25 && row.actualExplosion25).length,
      observed.filter((row) => row.predictedExplosion25).length,
    ),
    explosion25Recall: roundRatio(
      observed.filter((row) => row.predictedExplosion25 && row.actualExplosion25).length,
      observed.filter((row) => row.actualExplosion25).length,
    ),
    averageBaseReturnPct: nullableRound(mean(baseFrames)),
    averageStressReturnPct: nullableRound(mean(stressFrames)),
    bootstrapMeanBaseReturn95Pct: baseCi.map(nullableRound),
    profitFactor: nullableRound(profitFactor(baseFrames)),
    maximumDrawdownPct: nullableRound(maxDrawdownPct(baseFrames)),
    largestWinningFrameShare: nullableRound(largestWinningShare(baseFrames)),
    statisticalCandidateGate,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

function pairedScore({ forecasts, discoveries, outcomes }) {
  const byCandidate = new Map();
  for (const forecast of forecasts) {
    const key = `${forecast.discoveryEventId}:${forecast.pairAddress}`;
    const item = byCandidate.get(key) ?? {};
    item[forecast.featureArm] = forecast;
    byCandidate.set(key, item);
  }
  const pairs = [];
  for (const [key, pair] of byCandidate) {
    const outcome = outcomes.get(key);
    if (pair["market-only"]?.status !== "ready"
      || pair["market-plus-lunar"]?.status !== "ready"
      || outcome?.status !== "observed") continue;
    const baseline = forecastScoreRow({
      forecast: pair["market-only"],
      discovery: discoveries.get(pair["market-only"].discoveryEventId),
      outcome,
    });
    const social = forecastScoreRow({
      forecast: pair["market-plus-lunar"],
      discovery: discoveries.get(pair["market-plus-lunar"].discoveryEventId),
      outcome,
    });
    if (baseline && social) pairs.push({ baseline, social });
  }
  return {
    observedPairs: pairs.length,
    socialDirectionAccuracyDelta: nullableRound(mean(pairs.map((pair) => (
      Number(pair.social.directionCorrect) - Number(pair.baseline.directionCorrect)
    )))),
    socialMeanAbsoluteErrorImprovementPct: nullableRound(mean(pairs.map((pair) => (
      pair.baseline.absoluteErrorPct - pair.social.absoluteErrorPct
    )))),
    socialBrierImprovement: nullableRound(mean(pairs.map((pair) => (
      pair.baseline.brierScore - pair.social.brierScore
    )))),
    socialBaseReturnDeltaPct: nullableRound(mean(pairs.map((pair) => (
      pair.social.baseReturnPct - pair.baseline.baseReturnPct
    )))),
  };
}

export function forecastScoreRow({ forecast, discovery, outcome }) {
  if (forecast?.status !== "ready" || outcome?.status !== "observed" || !discovery) return null;
  const candidate = (discovery.candidates ?? []).find((item) => (
    item.pairAddress === forecast.pairAddress
      && item.tokenAddress === forecast.tokenAddress
  ));
  if (!candidate?.birthQuote
    || digestValue(candidate.birthQuote) !== forecast.birthQuoteDigest
    || digestValue(forecast.marketFeatures) !== forecast.marketFeaturesDigest
    || (forecast.socialFeatures
      && digestValue(forecast.socialFeatures) !== forecast.socialFeaturesDigest)
    || digestValue(forecast.prediction) !== forecast.predictionDigest
    || !validPrediction(forecast.prediction)
    || Date.parse(forecast.createdAt) > Date.parse(outcome.dueAt)) return null;
  const grossReturnPct = finiteNumber(outcome.grossReturnPct);
  const exitLiquidityUsd = finiteNumber(outcome.outcomeQuote?.liquidityUsd);
  if (!Number.isFinite(grossReturnPct) || !(exitLiquidityUsd > 0)) return null;
  const actualRise = grossReturnPct > 0;
  const paperLong = forecast.paperDecision === "paper-long";
  const baseReturnPct = paperLong ? capacityAdjustedReturnPct({
    grossReturnPct,
    entryLiquidityUsd: candidate.birthQuote.liquidityUsd,
    exitLiquidityUsd,
    paperNotionalUsd: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.paperNotionalUsd,
    roundTripCostPct: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.baseRoundTripCostPct,
  }) : 0;
  const stressReturnPct = paperLong ? capacityAdjustedReturnPct({
    grossReturnPct,
    entryLiquidityUsd: candidate.birthQuote.liquidityUsd,
    exitLiquidityUsd,
    paperNotionalUsd: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.paperNotionalUsd,
    roundTripCostPct: GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.stressRoundTripCostPct,
  }) : 0;
  if (!Number.isFinite(baseReturnPct) || !Number.isFinite(stressReturnPct)) return null;
  const error = forecast.prediction.predictedReturnPct - grossReturnPct;
  return {
    forecastId: forecast.id,
    chain: forecast.chain,
    tokenAddress: forecast.tokenAddress,
    createdAt: forecast.sourceDiscoveryObservedAt,
    outcomeStatus: outcome.status,
    predictedReturnPct: forecast.prediction.predictedReturnPct,
    grossReturnPct,
    directionCorrect: forecast.prediction.predictedRise === actualRise,
    brierScore: (forecast.prediction.riseProbability - Number(actualRise)) ** 2,
    absoluteErrorPct: Math.abs(error),
    squaredErrorPct: error ** 2,
    predictedExplosion25: forecast.prediction.predictedReturnPct >= 25,
    actualExplosion25: grossReturnPct >= 25,
    paperLong,
    baseReturnPct,
    stressReturnPct,
  };
}

function blockedCashScoreRow({ forecast, outcome }) {
  if (forecast?.status !== "blocked"
    || forecast.paperDecision !== "unavailable"
    || forecast.prediction !== null
    || outcome?.status !== "observed"
    || forecast.discoveryEventId !== outcome.discoveryEventId
    || forecast.pairAddress !== outcome.pairAddress
    || Date.parse(forecast.createdAt) > Date.parse(outcome.dueAt)
    || !Number.isFinite(finiteNumber(outcome.grossReturnPct))) return null;
  return {
    forecastId: forecast.id,
    chain: forecast.chain,
    tokenAddress: forecast.tokenAddress,
    createdAt: forecast.sourceDiscoveryObservedAt,
    outcomeStatus: outcome.status,
    paperLong: false,
    baseReturnPct: 0,
    stressReturnPct: 0,
  };
}

function deterministicCandidates(registration, discovery) {
  return (discovery.candidates ?? []).filter((candidate) => (
    candidate.birthQuote
      && candidate.chain === "solana"
      && cleanText(candidate.tokenAddress)
      && cleanText(candidate.pairAddress)
  )).map((candidate) => ({
    candidate,
    order: digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
      tokenAddress: candidate.tokenAddress,
      pairAddress: candidate.pairAddress,
    }),
  })).sort((left, right) => left.order.localeCompare(right.order))
    .slice(0, GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.maximumCandidatesPerDiscovery)
    .map(({ candidate }) => candidate);
}

function birthMarketFeatures(birthQuote) {
  return {
    pairAgeMinutes: finiteNumber(birthQuote?.pairAgeMinutes),
    marketCapUsd: finiteNumber(birthQuote?.marketCapUsd),
    liquidityUsd: finiteNumber(birthQuote?.liquidityUsd),
    volumeM5Usd: finiteNumber(birthQuote?.volumeM5Usd),
    volumeH1Usd: finiteNumber(birthQuote?.volumeH1Usd),
    fiveMinuteTurnover: finiteNumber(birthQuote?.fiveMinuteTurnover),
    hourlyTurnover: finiteNumber(birthQuote?.hourlyTurnover),
    buysM5: finiteNumber(birthQuote?.buysM5),
    sellsM5: finiteNumber(birthQuote?.sellsM5),
    buysH1: finiteNumber(birthQuote?.buysH1),
    sellsH1: finiteNumber(birthQuote?.sellsH1),
    fiveMinuteBuySellTxnRatio: finiteNumber(birthQuote?.fiveMinuteBuySellTxnRatio),
    buySellTxnRatio: finiteNumber(birthQuote?.buySellTxnRatio),
    priceChangeM5Pct: finiteNumber(birthQuote?.priceChangeM5Pct),
    priceChangeH1Pct: finiteNumber(birthQuote?.priceChangeH1Pct),
    priceChangeH24Pct: finiteNumber(birthQuote?.priceChangeH24Pct),
  };
}

function validTopicEvidence(event, tokenAddress) {
  return event?.type === "lunarcrush-contract-topic-snapshot"
    && event.status === "ready"
    && event.tokenAddress === tokenAddress
    && event.identity?.matchStatus === "exact-contract-topic-and-title"
    && event.topicMetricsDigest === digestValue(event.topicMetrics)
    && event.aggregateOnly === true
    && event.rawPostsRetained === false
    && event.rawCreatorIdentitiesRetained === false
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function socialFeatureView(topic, rankMatch) {
  return {
    interactions24h: finiteNumber(topic.topicMetrics?.interactions24h),
    posts: finiteNumber(topic.topicMetrics?.postCount),
    creators: finiteNumber(topic.topicMetrics?.contributorCount),
    interactionsPerPost: finiteNumber(topic.topicMetrics?.interactionsPerPost),
    interactionsPerCreator: finiteNumber(topic.topicMetrics?.interactionsPerContributor),
    altRank: finiteNumber(rankMatch?.altRank),
    galaxyScore: finiteNumber(rankMatch?.galaxyScore),
    exactContractTopicReady: true,
    exactContractTopRankCovered: Boolean(rankMatch),
  };
}

function validPrediction(value) {
  return typeof value?.predictedRise === "boolean"
    && Number.isFinite(Number(value.riseProbability))
    && Number(value.riseProbability) >= 0
    && Number(value.riseProbability) <= 1
    && value.predictedRise === (Number(value.riseProbability) >= 0.5)
    && Number.isFinite(Number(value.predictedReturnPct))
    && Number(value.predictedReturnPct) >= -100
    && Number(value.predictedReturnPct) <= 10_000
    && Number.isFinite(Number(value.confidence))
    && Number(value.confidence) >= 0
    && Number(value.confidence) <= 1;
}

function normalizePrediction(value) {
  return {
    predictedRise: value.predictedRise,
    riseProbability: nullableRound(Number(value.riseProbability)),
    predictedReturnPct: nullableRound(Number(value.predictedReturnPct)),
    confidence: nullableRound(Number(value.confidence)),
  };
}

function matchesRegistration(event, evidenceBoundary = null) {
  if (event?.type !== "monitoring-policy-registration"
    || event.status !== "frozen"
    || event.rule?.version !== GECKOTERMINAL_NEW_POOL_FORECAST_AB_RULE.version) return false;
  if (evidenceBoundary
    && event.rule?.evidenceBoundary !== validDate(evidenceBoundary).toISOString()) return false;
  const expected = createGeckoTerminalNewPoolForecastAbRegistrationEvent({
    registeredAt: event.registeredAt,
    evidenceBoundary: event.rule?.evidenceBoundary,
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

function captureResult(ledgerPath, observedAt, status, discoveryEventId, forecasts, requestsAttempted, receipt) {
  return {
    ledgerPath,
    observedAt: observedAt.toISOString(),
    status,
    discoveryEventId,
    captureReceiptId: receipt?.id ?? null,
    selectedCandidates: receipt?.selectedCandidates?.length ?? 0,
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

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function roundRatio(numerator, denominator) {
  return denominator > 0 ? nullableRound(numerator / denominator) : null;
}

function rootMeanSquaredError(squaredErrors) {
  const meanSquaredError = mean(squaredErrors);
  return meanSquaredError == null ? null : Math.sqrt(meanSquaredError);
}

function nullableRound(value) {
  return Number.isFinite(value) ? Math.round(value * 1_000_000) / 1_000_000 : null;
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requiredText(value, label) {
  const text = cleanText(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value) {
  return cleanText(value).toLowerCase();
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
    throw new Error("Usage: onchain-geckoterminal-new-pool-forecast-ab.mjs register|capture|score [--evidence-boundary ISO --ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerGeckoTerminalNewPoolForecastAb(options), null, 2));
    } else if (options.command === "capture") {
      console.log(JSON.stringify(await captureGeckoTerminalNewPoolForecastAb(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: buildGeckoTerminalNewPoolForecastAbScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
