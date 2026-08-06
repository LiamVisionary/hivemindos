import {
  LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE,
  buildContractPostsEvent,
  lunarCrushSemanticPostCorpus,
} from "./onchain-lunarcrush-provider.mjs";
import { digestValue } from "./onchain-forward-core.mjs";

const LUNARCRUSH_BASE_URL = "https://lunarcrush.com/api4/public";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export const LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE = Object.freeze({
  version: "lunarcrush-exact-contract-gemini-post-semantics-v1",
  sourcePostsRuleVersion: LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE.version,
  model: "gemini-3.6-flash",
  promptVersion: "token-edge-social-corpus-semantics-v1",
  temperature: 0,
  maximumPosts: 50,
  maximumTitleCharacters: 500,
  maximumDescriptionCharacters: 1_000,
  outputScaleMinimum: 0,
  outputScaleMaximum: 1,
  outsideKnowledgeAllowed: false,
  webSearchAllowed: false,
  creatorIdentityAllowed: false,
  priceOrOutcomeContextAllowed: false,
  aggregateOnly: true,
});

export const LUNARCRUSH_GEMINI_SEMANTIC_CACHE_POLICY = Object.freeze({
  version: "lunarcrush-gemini-exact-corpus-cache-v1",
  evidenceBoundary: "2026-08-03T23:49:15.000Z",
  sourceRuleVersion: LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.version,
  exactMatchFields: Object.freeze([
    "postCorpusDigest",
    "model",
    "modelVersion",
    "promptVersion",
    "promptDigest",
    "semanticMetricsDigest",
  ]),
  sourceMustPredateCollection: true,
  cachedSourceMustBeDirectGemini: true,
  researchOnly: true,
  mutationAllowed: false,
});

export const LUNARCRUSH_GEMINI_SEMANTIC_FIELDS = Object.freeze([
  "substantiveProjectEvidenceShare",
  "coordinatedPromotionShare",
  "genericHypeShare",
  "bullishIntentShare",
  "riskWarningShare",
  "narrativeCoherence",
  "informationNovelty",
  "semanticConfidence",
]);

const RESPONSE_SCHEMA = Object.freeze({
  type: "OBJECT",
  properties: Object.freeze({
    analyzedPostCount: Object.freeze({ type: "INTEGER" }),
    ...Object.fromEntries(LUNARCRUSH_GEMINI_SEMANTIC_FIELDS.map((field) => [field, Object.freeze({
      type: "NUMBER",
    })])),
  }),
  required: Object.freeze(["analyzedPostCount", ...LUNARCRUSH_GEMINI_SEMANTIC_FIELDS]),
});

export async function collectExactMintLunarCrushGeminiPostSemantics(
  options,
  dependencies = {},
) {
  const fetcher = dependencies.fetcher ?? fetch;
  const clock = dependencies.clock ?? (() => new Date());
  const collectionStartedAt = validDate(options.observedAt ?? clock()).toISOString();
  const chain = cleanText(options.chain).toLowerCase();
  const tokens = [...new Set((options.tokenAddresses ?? []).map(cleanText).filter(Boolean))];
  const maximum = Number(options.maxRequests);
  if (chain !== "solana") throw new Error("Gemini post semantics currently supports Solana only.");
  if (!tokens.length) throw new Error("At least one token is required for Gemini post semantics.");
  if (!cleanText(options.lunarcrushApiKey)) throw new Error("LUNARCRUSH_API_KEY is required.");
  if (!cleanText(options.geminiApiKey)) throw new Error("A Google Gemini API key is required.");
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 10) {
    throw new Error("Gemini post-semantics maxRequests must be an integer from 1 through 10.");
  }
  const lunarRequestBudget = { maximum, attempted: 0, succeeded: 0, failed: 0 };
  const geminiRequestBudget = {
    maximum, attempted: 0, succeeded: 0, failed: 0, exactCorpusCacheHits: 0,
  };
  const postEvents = [];
  const semanticEvents = [];
  for (const tokenAddress of tokens) {
    const endpoint = `${LUNARCRUSH_BASE_URL}/topic/${encodeURIComponent(tokenAddress)}/posts/v1`;
    if (lunarRequestBudget.attempted >= maximum) {
      semanticEvents.push(blockedSemanticEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt: validDate(clock()).toISOString(),
        endpoint,
        blocker: "LunarCrush post-semantics request budget exhausted",
      }));
      continue;
    }
    lunarRequestBudget.attempted += 1;
    let response;
    let body;
    try {
      response = await fetcher(endpoint, {
        headers: { Authorization: `Bearer ${options.lunarcrushApiKey}` },
      });
      body = await response.json().catch(() => null);
    } catch (error) {
      lunarRequestBudget.failed += 1;
      semanticEvents.push(blockedSemanticEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt: validDate(clock()).toISOString(),
        endpoint,
        blocker: safeError(error),
      }));
      continue;
    }
    const postsAvailableAt = validDate(clock()).toISOString();
    if (!response.ok) {
      lunarRequestBudget.failed += 1;
      semanticEvents.push(blockedSemanticEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt: postsAvailableAt,
        endpoint,
        blocker: `LunarCrush returned HTTP ${response.status}`,
      }));
      continue;
    }
    lunarRequestBudget.succeeded += 1;
    const postEvent = buildContractPostsEvent({
      chain,
      tokenAddress,
      collectionStartedAt,
      availableAt: postsAvailableAt,
      endpoint,
      body,
    });
    postEvents.push(postEvent);
    if (postEvent.status !== "ready") {
      semanticEvents.push(blockedSemanticEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt: postsAvailableAt,
        endpoint,
        postsEvent: postEvent,
        blocker: "Exact-contract LunarCrush posts are not ready",
      }));
      continue;
    }
    const corpus = lunarCrushSemanticPostCorpus(
      Array.isArray(body?.data) ? body.data : [],
      LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.maximumPosts,
    );
    if (digestValue(corpus) !== postEvent.postCorpusDigest
      || corpus.length !== postEvent.semanticPostCount) {
      semanticEvents.push(blockedSemanticEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt: postsAvailableAt,
        endpoint,
        postsEvent: postEvent,
        blocker: "Post corpus digest does not match the exact-contract post event",
      }));
      continue;
    }
    const cached = dependencies.semanticCache?.get(postEvent.postCorpusDigest) ?? null;
    if (validCachedSemanticSource(cached, postEvent, collectionStartedAt)) {
      geminiRequestBudget.exactCorpusCacheHits += 1;
      semanticEvents.push(buildSemanticEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt: validDate(clock()).toISOString(),
        endpoint,
        postsEvent: postEvent,
        semanticResponse: {
          modelVersion: cached.modelVersion,
          metrics: cached.semanticMetrics,
        },
        semanticInferenceSource: "exact-corpus-cache",
        cachedSemanticEvidenceId: cached.id,
      }));
      continue;
    }
    geminiRequestBudget.attempted += 1;
    let semanticResponse;
    try {
      semanticResponse = await analyzePostCorpus({
        apiKey: options.geminiApiKey,
        corpus,
        fetcher,
      });
      geminiRequestBudget.succeeded += 1;
    } catch (error) {
      geminiRequestBudget.failed += 1;
      semanticEvents.push(blockedSemanticEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt: validDate(clock()).toISOString(),
        endpoint,
        postsEvent: postEvent,
        blocker: safeError(error),
      }));
      continue;
    }
    semanticEvents.push(buildSemanticEvent({
      chain,
      tokenAddress,
      collectionStartedAt,
      availableAt: validDate(clock()).toISOString(),
      endpoint,
      postsEvent: postEvent,
      semanticResponse,
      semanticInferenceSource: "gemini-api",
    }));
  }
  return {
    provider: "lunarcrush+google-gemini",
    profile: "exact-contract-gemini-post-semantics",
    collectionStartedAt,
    completedAt: validDate(clock()).toISOString(),
    lunarRequestBudget,
    geminiRequestBudget,
    postEvents,
    semanticEvents,
    rawPostsRetained: false,
    rawPostTextRetained: false,
    rawModelResponsesRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
}

async function analyzePostCorpus({ apiKey, corpus, fetcher }) {
  const rule = LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE;
  const prompt = semanticPrompt(corpus);
  const endpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(rule.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: rule.temperature,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Gemini returned HTTP ${response.status}: ${cleanText(body?.error?.status) || "request failed"}`);
  }
  const text = (body?.candidates?.[0]?.content?.parts ?? [])
    .map((part) => cleanText(part?.text)).join("");
  let metrics;
  try {
    metrics = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned invalid semantic JSON");
  }
  if (!validSemanticMetrics(metrics, corpus.length)) {
    throw new Error("Gemini returned invalid semantic metrics");
  }
  return {
    modelVersion: cleanText(body?.modelVersion) || rule.model,
    metrics: normalizedSemanticMetrics(metrics),
  };
}

function semanticPrompt(corpus) {
  return [
    "Analyze only the supplied public social posts as a static text corpus.",
    "Do not use web search, outside knowledge, token prices, market outcomes, creator identity, follower status, or any prediction of future price.",
    "Return corpus-level numeric shares from 0 to 1.",
    "Substantive project evidence means concrete verifiable-in-principle claims about a product, event, code, partnership, listing, governance, community action, or other token-specific development.",
    "Coordinated promotion means repeated or copy-like promotion, engagement bait, calls to buy, price targets, giveaways, or raids.",
    "Generic hype lacks token-specific information.",
    "Narrative coherence measures whether multiple posts independently describe a consistent specific story.",
    "Information novelty measures concrete new information rather than recycled slogans.",
    "Semantic confidence must fall when the text is sparse or ambiguous.",
    `analyzedPostCount must equal ${corpus.length}.`,
    `Corpus JSON: ${JSON.stringify(corpus)}`,
  ].join(" ");
}

function buildSemanticEvent({
  chain,
  tokenAddress,
  collectionStartedAt,
  availableAt,
  endpoint,
  postsEvent,
  semanticResponse,
  semanticInferenceSource = "gemini-api",
  cachedSemanticEvidenceId = null,
}) {
  const metrics = semanticResponse.metrics;
  const payload = {
    chain,
    tokenAddress,
    collectionStartedAt,
    availableAt,
    postsEvidenceId: postsEvent.id,
    postCorpusDigest: postsEvent.postCorpusDigest,
    modelVersion: semanticResponse.modelVersion,
    metrics,
  };
  return {
    type: "lunarcrush-contract-post-semantics-snapshot",
    id: `lunarcrush_contract_post_semantics_${digestValue(payload).slice(0, 24)}`,
    provider: "lunarcrush+google-gemini",
    profile: "exact-contract-gemini-post-semantics",
    ruleVersion: LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.version,
    rule: LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE,
    chain,
    tokenAddress,
    collectionStartedAt,
    availableAt,
    status: "ready",
    blockers: [],
    identity: postsEvent.identity,
    endpoint,
    postsEvidenceId: postsEvent.id,
    postsMetricsDigest: postsEvent.postMetricsDigest,
    postCorpusDigest: postsEvent.postCorpusDigest,
    analyzedPostCount: postsEvent.semanticPostCount,
    model: LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.model,
    modelVersion: semanticResponse.modelVersion,
    promptVersion: LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.promptVersion,
    promptDigest: digestValue({
      promptVersion: LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.promptVersion,
      postCorpusDigest: postsEvent.postCorpusDigest,
    }),
    semanticMetrics: metrics,
    semanticMetricsDigest: digestValue(metrics),
    semanticInferenceSource,
    semanticCachePolicyVersion: semanticInferenceSource === "exact-corpus-cache"
      ? LUNARCRUSH_GEMINI_SEMANTIC_CACHE_POLICY.version : null,
    cachedSemanticEvidenceId,
    aggregateOnly: true,
    outsideKnowledgeAllowed: false,
    webSearchUsed: false,
    priceOrOutcomeContextUsed: false,
    rawPostsRetained: false,
    rawPostTextRetained: false,
    rawCreatorIdentitiesRetained: false,
    rawCreatorIdsRetained: false,
    rawModelResponseRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
}

function validCachedSemanticSource(source, postsEvent, collectionStartedAt) {
  if (!(Date.parse(collectionStartedAt)
    > Date.parse(LUNARCRUSH_GEMINI_SEMANTIC_CACHE_POLICY.evidenceBoundary))) return false;
  return source?.type === "lunarcrush-contract-post-semantics-snapshot"
    && source.status === "ready"
    && source.ruleVersion === LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.version
    && source.postCorpusDigest === postsEvent.postCorpusDigest
    && source.analyzedPostCount === postsEvent.semanticPostCount
    && source.model === LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.model
    && source.modelVersion === LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.model
    && source.promptVersion === LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.promptVersion
    && source.promptDigest === digestValue({
      promptVersion: source.promptVersion,
      postCorpusDigest: source.postCorpusDigest,
    })
    && source.semanticMetricsDigest === digestValue(source.semanticMetrics)
    && validSemanticMetrics(source.semanticMetrics, postsEvent.semanticPostCount)
    && (source.semanticInferenceSource === undefined
      || source.semanticInferenceSource === "gemini-api")
    && Number.isFinite(Date.parse(source.availableAt ?? ""))
    && Date.parse(source.availableAt) < Date.parse(collectionStartedAt)
    && source.aggregateOnly === true
    && source.outsideKnowledgeAllowed === false
    && source.webSearchUsed === false
    && source.priceOrOutcomeContextUsed === false
    && source.rawPostsRetained === false
    && source.rawPostTextRetained === false
    && source.rawCreatorIdentitiesRetained === false
    && source.rawCreatorIdsRetained === false
    && source.rawModelResponseRetained === false
    && source.researchOnly === true
    && source.mutationAllowed === false;
}

function blockedSemanticEvent({
  chain,
  tokenAddress,
  collectionStartedAt,
  availableAt,
  endpoint,
  blocker,
  postsEvent = null,
}) {
  return {
    type: "lunarcrush-contract-post-semantics-snapshot",
    id: `lunarcrush_contract_post_semantics_${digestValue({
      chain, tokenAddress, collectionStartedAt, availableAt, blocker,
    }).slice(0, 24)}`,
    provider: "lunarcrush+google-gemini",
    profile: "exact-contract-gemini-post-semantics",
    ruleVersion: LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.version,
    rule: LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE,
    chain,
    tokenAddress,
    collectionStartedAt,
    availableAt,
    status: "blocked",
    blockers: [cleanText(blocker).slice(0, 300) || "semantic evidence unavailable"],
    identity: postsEvent?.identity ?? {
      matchStatus: "contract-topic-identity-unproven",
      requestedContractAddress: tokenAddress,
      responseId: null,
      responseTopic: null,
    },
    endpoint,
    postsEvidenceId: postsEvent?.id ?? null,
    postsMetricsDigest: postsEvent?.postMetricsDigest ?? null,
    postCorpusDigest: postsEvent?.postCorpusDigest ?? null,
    analyzedPostCount: postsEvent?.semanticPostCount ?? 0,
    model: LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.model,
    modelVersion: null,
    promptVersion: LUNARCRUSH_GEMINI_POST_SEMANTICS_RULE.promptVersion,
    promptDigest: null,
    semanticMetrics: null,
    semanticMetricsDigest: null,
    aggregateOnly: true,
    outsideKnowledgeAllowed: false,
    webSearchUsed: false,
    priceOrOutcomeContextUsed: false,
    rawPostsRetained: false,
    rawPostTextRetained: false,
    rawCreatorIdentitiesRetained: false,
    rawCreatorIdsRetained: false,
    rawModelResponseRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
}

function normalizedSemanticMetrics(metrics) {
  return {
    analyzedPostCount: Number(metrics.analyzedPostCount),
    ...Object.fromEntries(LUNARCRUSH_GEMINI_SEMANTIC_FIELDS.map((field) => [
      field,
      Math.round(Number(metrics[field]) * 1_000_000) / 1_000_000,
    ])),
  };
}

export function validSemanticMetrics(metrics, expectedPostCount) {
  return Number.isInteger(Number(metrics?.analyzedPostCount))
    && Number(metrics.analyzedPostCount) === expectedPostCount
    && LUNARCRUSH_GEMINI_SEMANTIC_FIELDS.every((field) => {
      const value = Number(metrics?.[field]);
      return Number.isFinite(value) && value >= 0 && value <= 1;
    });
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("A valid timestamp is required.");
  return date;
}
