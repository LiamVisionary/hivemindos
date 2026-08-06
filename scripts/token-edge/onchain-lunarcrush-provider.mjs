import { createHash } from "node:crypto";

const LUNARCRUSH_BASE_URL = "https://lunarcrush.com/api4/public";
const HOUR_SECONDS = 3_600;
const LIST_PAGE_SIZE = 1_000;

export const LUNARCRUSH_MOVE_ALERT_RULE = Object.freeze({
  version: "lunarcrush-exact-mint-move-alert-v1",
  minimumHistoryHours: 24,
  minimumAccelerationSignals: 2,
  minimumInteractionsZ: 1,
  minimumPostsActiveZ: 1,
  minimumContributorsActiveZ: 0.5,
  maximumAltRank: 100,
  minimumGalaxyScore: 70,
  minimumProviderThresholds: 1,
  maximumCompletedBarStalenessHours: 2,
});
export const LUNARCRUSH_MAX_EVIDENCE_AVAILABILITY_LAG_MS = 5 * 60_000;
export const LUNARCRUSH_EXACT_CONTRACT_TOPIC_RULE = Object.freeze({
  version: "lunarcrush-exact-contract-topic-point-v1",
  maximumAvailabilityLagMs: 5 * 60_000,
  exactCaseTitleRequired: true,
  aggregateOnly: true,
});
export const LUNARCRUSH_EXACT_CONTRACT_TOPIC_STRUCTURE_RULE = Object.freeze({
  version: "lunarcrush-exact-contract-topic-structure-v1",
  maximumAvailabilityLagMs: 5 * 60_000,
  exactPostConfigIdentityRequired: true,
  maximumEndpointInteractionRatio: 1.05,
  aggregateOnly: true,
});
export const LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE = Object.freeze({
  version: "lunarcrush-exact-contract-posts-v1",
  maximumAvailabilityLagMs: 5 * 60_000,
  exactPostConfigIdentityRequired: true,
  aggregateOnly: true,
});
export const LUNARCRUSH_SOLANA_DISCOVERY_RULE = Object.freeze({
  version: "lunarcrush-solana-social-discovery-v1",
  minimumMarketCapUsdInclusive: 50_000,
  maximumMarketCapUsdExclusive: 5_000_000,
  minimumVolume24hUsdInclusive: 20_000,
  minimumInteractions24hInclusive: 500,
  minimumSocialVolume24hInclusive: 10,
  maximumAltRankInclusive: 200,
  minimumAltRankImprovementInclusive: 1_000,
  minimumGalaxyScoreInclusive: 50,
  minimumGalaxyScoreImprovementInclusive: 10,
  minimumPriceChange1hPctInclusive: -10,
  maximumPriceChange1hPctExclusive: 10,
  minimumPriceChange24hPctInclusive: -20,
  maximumPriceChange24hPctExclusive: 30,
  maximumCandidates: 6,
  orderBy: "alt-rank-asc-galaxy-improvement-desc-interactions-desc",
});
export const LUNARCRUSH_SOLANA_MONITORING_RULE = Object.freeze({
  version: "lunarcrush-solana-monitoring-panel-v1",
  evidenceBoundary: "2026-08-03T07:45:35.842Z",
  minimumMarketCapUsdInclusive: 50_000,
  maximumMarketCapUsdExclusive: 20_000_000,
  minimumVolume24hUsdInclusive: 10_000,
  minimumInteractions24hInclusive: 100,
  minimumSocialVolume24hInclusive: 3,
  minimumPriceChange1hPctInclusive: -25,
  maximumPriceChange1hPctExclusive: 25,
  minimumPriceChange24hPctInclusive: -50,
  maximumPriceChange24hPctExclusive: 100,
  maximumCandidates: 100,
  orderBy: "alt-rank-asc-interactions-desc",
  purpose: "Observation-only forward panel for future hypothesis generation; never a trading rule.",
});

export async function collectExactMintLunarCrushEvidence(options, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const clock = dependencies.clock ?? (() => new Date());
  const observedAt = validDate(options.observedAt);
  const observedAtIso = observedAt.toISOString();
  const observedUnix = Math.floor(observedAt.getTime() / 1_000);
  const chain = normalize(options.chain);
  const tokens = [...new Set((options.tokenAddresses ?? []).map(cleanText).filter(Boolean))];
  const discoveryOnly = options.discoveryOnly === true;
  const maxRequests = Number(options.maxRequests);
  if (chain !== "solana") throw new Error("Exact-mint LunarCrush evidence currently supports Solana only.");
  if (!tokens.length && !discoveryOnly) {
    throw new Error("At least one token address is required for exact-mint LunarCrush evidence.");
  }
  if (!cleanText(options.apiKey)) throw new Error("LUNARCRUSH_API_KEY is required for exact-mint evidence.");
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 10) {
    throw new Error("LunarCrush maxRequests must be an integer from 1 through 10.");
  }

  const requestBudget = { maximum: maxRequests, attempted: 0, succeeded: 0, failed: 0 };
  const request = async (url) => {
    if (requestBudget.attempted >= maxRequests) throw new Error("LunarCrush request budget exhausted.");
    requestBudget.attempted += 1;
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${options.apiKey}` },
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      requestBudget.failed += 1;
      throw new Error(`LunarCrush returned HTTP ${response.status}.`);
    }
    requestBudget.succeeded += 1;
    return body;
  };

  const universeRows = [];
  let page = 0;
  let totalRows = null;
  let listGeneratedUnix = null;
  let universeComplete = false;
  let universeError = null;
  try {
    while (requestBudget.attempted < maxRequests) {
      const url = new URL(`${LUNARCRUSH_BASE_URL}/coins/list/v1`);
      url.searchParams.set("limit", String(LIST_PAGE_SIZE));
      url.searchParams.set("page", String(page));
      const body = await request(url);
      const rows = Array.isArray(body?.data) ? body.data : [];
      const generated = finiteNumber(body?.config?.generated);
      const reportedTotal = finiteNumber(body?.config?.total_rows);
      if (generated != null) listGeneratedUnix = Math.max(listGeneratedUnix ?? generated, generated);
      if (reportedTotal != null) totalRows = reportedTotal;
      universeRows.push(...rows);
      const finalByLength = rows.length < LIST_PAGE_SIZE;
      const finalByTotal = totalRows != null && universeRows.length >= totalRows;
      if (finalByLength || finalByTotal) {
        universeComplete = true;
        break;
      }
      page += 1;
    }
  } catch (error) {
    universeError = error instanceof Error ? error.message : String(error);
  }
  if (listGeneratedUnix != null && listGeneratedUnix > observedUnix + 300) {
    universeComplete = false;
    universeError = "LunarCrush universe generation time is in the future.";
  }

  const matches = contractMatches(universeRows, tokens, chain);
  const universe = {
    endpoint: `${LUNARCRUSH_BASE_URL}/coins/list/v1`,
    complete: universeComplete,
    pagesFetched: page + (requestBudget.succeeded > 0 ? 1 : 0),
    rowsFetched: universeRows.length,
    reportedRows: totalRows,
    generatedAt: isoFromUnix(listGeneratedUnix),
    error: universeError,
  };
  if (!universeComplete) {
    return finalizeCollection({
      provider: "lunarcrush",
      profile: discoveryOnly ? "solana-social-discovery" : "exact-mint-hourly",
      observedAt: observedAtIso,
      requestBudget,
      universe,
      events: tokens.map((tokenAddress) => blockedEvent({
        observedAtIso,
        chain,
        tokenAddress,
        universe,
        blocker: universeError ?? "LunarCrush coin universe could not be proven complete within budget",
        matchStatus: "universe-incomplete",
      })),
    }, clock);
  }

  const discovery = buildSolanaSocialDiscovery(universeRows, universe);
  const collectHistoryEvent = async (tokenAddress, match, discoveryFollowup = false) => {
    const profile = discoveryFollowup ? "social-discovery-hourly-followup" : "exact-mint-hourly";
    if (requestBudget.attempted >= maxRequests) {
      return {
        ...blockedEvent({
          observedAtIso,
          chain,
          tokenAddress,
          universe,
          match,
          blocker: "LunarCrush request budget exhausted before hourly history fetch",
          matchStatus: "exact-single-contract-match",
        }),
        profile,
        discoveryFollowup,
      };
    }
    try {
      const start = observedUnix - ((LUNARCRUSH_MOVE_ALERT_RULE.minimumHistoryHours + 24) * HOUR_SECONDS);
      const url = new URL(`${LUNARCRUSH_BASE_URL}/coins/${encodeURIComponent(match.coinId)}/time-series/v2`);
      url.searchParams.set("bucket", "hour");
      url.searchParams.set("start", String(start));
      url.searchParams.set("end", String(observedUnix));
      const body = await request(url);
      return {
        ...buildReadyOrBlockedEvent({
          observedAt,
          chain,
          tokenAddress,
          universe,
          match,
          body,
          endpoint: url.toString(),
        }),
        profile,
        discoveryFollowup,
      };
    } catch (error) {
      return {
        ...blockedEvent({
          observedAtIso,
          chain,
          tokenAddress,
          universe,
          match,
          blocker: error instanceof Error ? error.message : String(error),
          matchStatus: "exact-single-contract-match",
        }),
        profile,
        discoveryFollowup,
      };
    }
  };
  const events = [];
  for (const tokenAddress of tokens) {
    const tokenMatches = matches.get(tokenAddress) ?? [];
    if (!tokenMatches.length) {
      events.push(blockedEvent({
        observedAtIso,
        chain,
        tokenAddress,
        universe,
        blocker: "contract address is not tracked in the complete LunarCrush coin universe",
        matchStatus: "untracked-contract",
      }));
      continue;
    }
    if (tokenMatches.length !== 1) {
      events.push(blockedEvent({
        observedAtIso,
        chain,
        tokenAddress,
        universe,
        blocker: "contract address maps to multiple LunarCrush coins",
        matchStatus: "ambiguous-contract",
      }));
      continue;
    }
    const match = tokenMatches[0];
    events.push(await collectHistoryEvent(tokenAddress, match));
  }
  const requestedTokens = new Set(tokens);
  const explicitCreatorTokens = Array.isArray(options.creatorTokenAddresses)
    ? [...new Set(options.creatorTokenAddresses.map(cleanText).filter(Boolean))]
    : null;
  const creatorCandidates = explicitCreatorTokens == null
    ? discovery.candidates
    : explicitCreatorTokens.map((tokenAddress) => ({ tokenAddress }));
  const creatorMatches = contractMatches(
    universeRows,
    creatorCandidates.map((candidate) => candidate.tokenAddress),
    chain,
  );
  const creatorEvents = [];
  let creatorSlots = Math.min(2, maxRequests - requestBudget.attempted);
  for (const candidate of creatorCandidates) {
    if (creatorSlots <= 0) break;
    const match = creatorMatches.get(candidate.tokenAddress)?.[0];
    if (!Number.isFinite(match?.coinId) || !match?.topic || match.topicUniverseCoinRowCount !== 1) {
      const matchStatus = !Number.isFinite(match?.coinId)
        ? "missing-coin-id"
        : !match?.topic ? "missing-topic" : "ambiguous-topic";
      creatorEvents.push(blockedCreatorAggregateEvent({
        observedAtIso,
        chain,
        tokenAddress: candidate.tokenAddress,
        universe,
        match,
        endpoint: null,
        topicJoinStatus: `provider-coin-row-${matchStatus}`,
        blocker: matchStatus === "ambiguous-topic"
          ? "provider topic maps to multiple LunarCrush coin rows"
          : `provider coin row has ${matchStatus.replaceAll("-", " ")}`,
      }));
      continue;
    }
    creatorSlots -= 1;
    const url = new URL(`${LUNARCRUSH_BASE_URL}/topic/${encodeURIComponent(normalize(match.topic))}/creators/v1`);
    try {
      creatorEvents.push(buildCreatorAggregateEvent({
        observedAt,
        chain,
        tokenAddress: candidate.tokenAddress,
        universe,
        match,
        body: await request(url),
        endpoint: url.toString(),
      }));
    } catch (error) {
      creatorEvents.push(blockedCreatorAggregateEvent({
        observedAtIso,
        chain,
        tokenAddress: candidate.tokenAddress,
        universe,
        match,
        endpoint: url.toString(),
        blocker: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  const discoveryMatches = contractMatches(
    universeRows,
    discovery.candidates.map((candidate) => candidate.tokenAddress),
    chain,
  );
  for (const candidate of discovery.candidates) {
    if (requestedTokens.has(candidate.tokenAddress)) continue;
    const match = discoveryMatches.get(candidate.tokenAddress)?.[0];
    if (!match) continue;
    events.push(await collectHistoryEvent(candidate.tokenAddress, match, true));
  }
  return finalizeCollection({
    provider: "lunarcrush",
    profile: discoveryOnly ? "solana-social-discovery" : "exact-mint-hourly",
    observedAt: observedAtIso,
    requestBudget,
    universe,
    discovery,
    events,
    creatorEvents,
  }, clock);
}

export function collectSolanaLunarCrushDiscovery(options, dependencies = {}) {
  return collectExactMintLunarCrushEvidence({
    ...options,
    tokenAddresses: [],
    discoveryOnly: true,
  }, dependencies);
}

export async function collectExactMintLunarCrushTopicEvidence(options, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const clock = dependencies.clock ?? (() => new Date());
  const collectionStartedAt = validDate(options.observedAt ?? clock()).toISOString();
  const chain = normalize(options.chain);
  const tokens = [...new Set((options.tokenAddresses ?? []).map(cleanText).filter(Boolean))];
  const maxRequests = Number(options.maxRequests);
  if (chain !== "solana") throw new Error("Exact-contract LunarCrush topics currently support Solana only.");
  if (!tokens.length) throw new Error("At least one token address is required for exact-contract topics.");
  if (!cleanText(options.apiKey)) throw new Error("LUNARCRUSH_API_KEY is required for exact-contract topics.");
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 10) {
    throw new Error("LunarCrush topic maxRequests must be an integer from 1 through 10.");
  }
  const requestBudget = { maximum: maxRequests, attempted: 0, succeeded: 0, failed: 0 };
  const events = [];
  for (const tokenAddress of tokens) {
    if (requestBudget.attempted >= maxRequests) {
      events.push(blockedContractTopicEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt: validDate(clock()).toISOString(),
        endpoint: null,
        blocker: "LunarCrush exact-contract topic request budget exhausted",
      }));
      continue;
    }
    const endpoint = `${LUNARCRUSH_BASE_URL}/topic/${encodeURIComponent(tokenAddress)}/v1`;
    requestBudget.attempted += 1;
    let response;
    let body;
    try {
      response = await fetcher(endpoint, {
        headers: { Authorization: `Bearer ${options.apiKey}` },
      });
      body = await response.json().catch(() => null);
    } catch (error) {
      requestBudget.failed += 1;
      events.push(blockedContractTopicEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt: validDate(clock()).toISOString(),
        endpoint,
        blocker: error instanceof Error ? error.message : String(error),
      }));
      continue;
    }
    const availableAt = validDate(clock()).toISOString();
    if (!response.ok) {
      requestBudget.failed += 1;
      events.push(blockedContractTopicEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt,
        endpoint,
        blocker: `LunarCrush returned HTTP ${response.status}`,
      }));
      continue;
    }
    requestBudget.succeeded += 1;
    events.push(buildContractTopicEvent({
      chain,
      tokenAddress,
      collectionStartedAt,
      availableAt,
      endpoint,
      body,
    }));
  }
  return {
    provider: "lunarcrush",
    profile: "exact-contract-topic-point",
    collectionStartedAt,
    completedAt: validDate(clock()).toISOString(),
    requestBudget,
    events,
    researchOnly: true,
    mutationAllowed: false,
  };
}

export async function collectExactMintLunarCrushTopicStructureEvidence(options, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const clock = dependencies.clock ?? (() => new Date());
  const collectionStartedAt = validDate(options.observedAt ?? clock()).toISOString();
  const chain = normalize(options.chain);
  const tokens = [...new Set((options.tokenAddresses ?? []).map(cleanText).filter(Boolean))];
  const maxRequests = Number(options.maxRequests);
  if (chain !== "solana") {
    throw new Error("Exact-contract LunarCrush topic structure currently supports Solana only.");
  }
  if (!tokens.length) {
    throw new Error("At least one token address is required for exact-contract topic structure.");
  }
  if (!cleanText(options.apiKey)) {
    throw new Error("LUNARCRUSH_API_KEY is required for exact-contract topic structure.");
  }
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 10) {
    throw new Error("LunarCrush topic-structure maxRequests must be an integer from 1 through 10.");
  }
  const requestBudget = { maximum: maxRequests, attempted: 0, succeeded: 0, failed: 0 };
  const request = async (endpoint) => {
    requestBudget.attempted += 1;
    let response;
    let body;
    try {
      response = await fetcher(endpoint, {
        headers: { Authorization: `Bearer ${options.apiKey}` },
      });
      body = await response.json().catch(() => null);
    } catch (error) {
      requestBudget.failed += 1;
      return { error: error instanceof Error ? error.message : String(error), body: null };
    }
    if (!response.ok) {
      requestBudget.failed += 1;
      return { error: `LunarCrush returned HTTP ${response.status}`, body };
    }
    requestBudget.succeeded += 1;
    return { error: null, body };
  };
  const events = [];
  for (const tokenAddress of tokens) {
    const creatorsEndpoint = `${LUNARCRUSH_BASE_URL}/topic/${encodeURIComponent(tokenAddress)}/creators/v1`;
    const postsEndpoint = `${LUNARCRUSH_BASE_URL}/topic/${encodeURIComponent(tokenAddress)}/posts/v1`;
    if (maxRequests - requestBudget.attempted < 2) {
      events.push(blockedContractTopicStructureEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt: validDate(clock()).toISOString(),
        creatorsEndpoint,
        postsEndpoint,
        blocker: "LunarCrush exact-contract topic structure requires two remaining requests",
      }));
      continue;
    }
    const creators = await request(creatorsEndpoint);
    const posts = await request(postsEndpoint);
    const availableAt = validDate(clock()).toISOString();
    if (creators.error || posts.error) {
      events.push(blockedContractTopicStructureEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt,
        creatorsEndpoint,
        postsEndpoint,
        blocker: [creators.error, posts.error].filter(Boolean).join("; "),
      }));
      continue;
    }
    events.push(buildContractTopicStructureEvent({
      chain,
      tokenAddress,
      collectionStartedAt,
      availableAt,
      creatorsEndpoint,
      postsEndpoint,
      creatorsBody: creators.body,
      postsBody: posts.body,
    }));
  }
  return {
    provider: "lunarcrush",
    profile: "exact-contract-topic-structure",
    collectionStartedAt,
    completedAt: validDate(clock()).toISOString(),
    requestBudget,
    events,
    researchOnly: true,
    mutationAllowed: false,
  };
}

export async function collectExactMintLunarCrushPostsEvidence(options, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const clock = dependencies.clock ?? (() => new Date());
  const collectionStartedAt = validDate(options.observedAt ?? clock()).toISOString();
  const chain = normalize(options.chain);
  const tokens = [...new Set((options.tokenAddresses ?? []).map(cleanText).filter(Boolean))];
  const maxRequests = Number(options.maxRequests);
  if (chain !== "solana") throw new Error("Exact-contract LunarCrush posts support Solana only.");
  if (!tokens.length) throw new Error("At least one token address is required for exact-contract posts.");
  if (!cleanText(options.apiKey)) throw new Error("LUNARCRUSH_API_KEY is required for exact-contract posts.");
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 10) {
    throw new Error("LunarCrush posts maxRequests must be an integer from 1 through 10.");
  }
  const requestBudget = { maximum: maxRequests, attempted: 0, succeeded: 0, failed: 0 };
  const events = [];
  for (const tokenAddress of tokens) {
    const endpoint = `${LUNARCRUSH_BASE_URL}/topic/${encodeURIComponent(tokenAddress)}/posts/v1`;
    if (requestBudget.attempted >= maxRequests) {
      events.push(blockedContractPostsEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt: validDate(clock()).toISOString(),
        endpoint,
        blocker: "LunarCrush exact-contract posts request budget exhausted",
      }));
      continue;
    }
    requestBudget.attempted += 1;
    let response;
    let body;
    try {
      response = await fetcher(endpoint, {
        headers: { Authorization: `Bearer ${options.apiKey}` },
      });
      body = await response.json().catch(() => null);
    } catch (error) {
      requestBudget.failed += 1;
      events.push(blockedContractPostsEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt: validDate(clock()).toISOString(),
        endpoint,
        blocker: error instanceof Error ? error.message : String(error),
      }));
      continue;
    }
    const availableAt = validDate(clock()).toISOString();
    if (!response.ok) {
      requestBudget.failed += 1;
      events.push(blockedContractPostsEvent({
        chain,
        tokenAddress,
        collectionStartedAt,
        availableAt,
        endpoint,
        blocker: `LunarCrush returned HTTP ${response.status}`,
      }));
      continue;
    }
    requestBudget.succeeded += 1;
    events.push(buildContractPostsEvent({
      chain,
      tokenAddress,
      collectionStartedAt,
      availableAt,
      endpoint,
      body,
    }));
  }
  return {
    provider: "lunarcrush",
    profile: "exact-contract-posts",
    collectionStartedAt,
    completedAt: validDate(clock()).toISOString(),
    requestBudget,
    events,
    researchOnly: true,
    mutationAllowed: false,
  };
}

export function deriveLunarCrushSolanaDiscoveryCandidates(rows) {
  return normalizeSolanaUniverseCandidates(rows).map((candidate) => ({
    ...candidate,
    status: "eligible",
    ruleVersion: LUNARCRUSH_SOLANA_DISCOVERY_RULE.version,
  })).filter(satisfiesLunarCrushSolanaDiscoveryRule).sort((left, right) => (
    left.altRank - right.altRank
    || right.galaxyScoreImprovement - left.galaxyScoreImprovement
    || right.interactions24h - left.interactions24h
    || left.tokenAddress.localeCompare(right.tokenAddress)
  )).slice(0, LUNARCRUSH_SOLANA_DISCOVERY_RULE.maximumCandidates);
}

export function deriveLunarCrushSolanaMonitoringCandidates(rows) {
  const rule = LUNARCRUSH_SOLANA_MONITORING_RULE;
  return normalizeSolanaUniverseCandidates(rows).filter((candidate) => (
    candidate.marketCapUsd >= rule.minimumMarketCapUsdInclusive
    && candidate.marketCapUsd < rule.maximumMarketCapUsdExclusive
    && candidate.volume24hUsd >= rule.minimumVolume24hUsdInclusive
    && candidate.interactions24h >= rule.minimumInteractions24hInclusive
    && candidate.socialVolume24h >= rule.minimumSocialVolume24hInclusive
    && candidate.priceUsd > 0
    && [candidate.altRank, candidate.altRankPrevious, candidate.altRankImprovement,
      candidate.galaxyScore, candidate.galaxyScorePrevious, candidate.galaxyScoreImprovement]
      .every(Number.isFinite)
    && candidate.priceChange1hPct >= rule.minimumPriceChange1hPctInclusive
    && candidate.priceChange1hPct < rule.maximumPriceChange1hPctExclusive
    && candidate.priceChange24hPct >= rule.minimumPriceChange24hPctInclusive
    && candidate.priceChange24hPct < rule.maximumPriceChange24hPctExclusive
  )).map((candidate) => ({
    ...candidate,
    status: "monitoring-only",
    ruleVersion: rule.version,
  })).sort((left, right) => (
    left.altRank - right.altRank
    || right.interactions24h - left.interactions24h
    || left.tokenAddress.localeCompare(right.tokenAddress)
  )).slice(0, rule.maximumCandidates);
}

export function satisfiesLunarCrushSolanaDiscoveryRule(candidate) {
  const rule = LUNARCRUSH_SOLANA_DISCOVERY_RULE;
  return candidate?.ruleVersion === rule.version
    && candidate?.marketCapUsd >= rule.minimumMarketCapUsdInclusive
    && candidate.marketCapUsd < rule.maximumMarketCapUsdExclusive
    && candidate?.volume24hUsd >= rule.minimumVolume24hUsdInclusive
    && candidate?.interactions24h >= rule.minimumInteractions24hInclusive
    && candidate?.socialVolume24h >= rule.minimumSocialVolume24hInclusive
    && candidate?.altRank <= rule.maximumAltRankInclusive
    && candidate?.altRankImprovement >= rule.minimumAltRankImprovementInclusive
    && candidate?.galaxyScore >= rule.minimumGalaxyScoreInclusive
    && candidate?.galaxyScoreImprovement >= rule.minimumGalaxyScoreImprovementInclusive
    && candidate?.priceChange1hPct >= rule.minimumPriceChange1hPctInclusive
    && candidate.priceChange1hPct < rule.maximumPriceChange1hPctExclusive
    && candidate?.priceChange24hPct >= rule.minimumPriceChange24hPctInclusive
    && candidate.priceChange24hPct < rule.maximumPriceChange24hPctExclusive;
}

function buildContractTopicEvent({
  chain, tokenAddress, collectionStartedAt, availableAt, endpoint, body,
}) {
  const data = body?.data;
  const metrics = contractTopicMetrics(data);
  const exactTopic = normalize(data?.topic) === normalize(tokenAddress);
  const exactTitle = cleanText(data?.title) === tokenAddress;
  const blockers = [];
  if (!exactTopic) blockers.push("topic slug does not match the exact contract");
  if (!exactTitle) blockers.push("topic title does not preserve the exact contract");
  if (!metrics) blockers.push("exact-contract topic aggregate metrics are missing or invalid");
  const common = {
    type: "lunarcrush-contract-topic-snapshot",
    id: `lunarcrush_contract_topic_${digestValue({
      tokenAddress,
      collectionStartedAt,
      availableAt,
      response: data ?? null,
    }).slice(0, 24)}`,
    provider: "lunarcrush",
    profile: "exact-contract-topic-point",
    ruleVersion: LUNARCRUSH_EXACT_CONTRACT_TOPIC_RULE.version,
    rule: LUNARCRUSH_EXACT_CONTRACT_TOPIC_RULE,
    chain,
    tokenAddress,
    collectionStartedAt,
    availableAt,
    status: blockers.length ? "blocked" : "ready",
    blockers,
    identity: {
      matchStatus: exactTopic && exactTitle
        ? "exact-contract-topic-and-title"
        : "contract-topic-identity-unproven",
      requestedContractAddress: tokenAddress,
      responseTopic: cleanText(data?.topic) || null,
      responseTitle: cleanText(data?.title) || null,
    },
    endpoint,
    responseDigest: digestValue(data ?? null),
    topicMetrics: blockers.length ? null : metrics,
    topicMetricsDigest: blockers.length ? null : digestValue(metrics),
    aggregateOnly: true,
    rawPostsRetained: false,
    rawCreatorIdentitiesRetained: false,
    providerGenerationReported: false,
    researchOnly: true,
    mutationAllowed: false,
  };
  return common;
}

function blockedContractTopicEvent({
  chain, tokenAddress, collectionStartedAt, availableAt, endpoint, blocker,
}) {
  return {
    type: "lunarcrush-contract-topic-snapshot",
    id: `lunarcrush_contract_topic_${digestValue({
      tokenAddress, collectionStartedAt, availableAt, blocker,
    }).slice(0, 24)}`,
    provider: "lunarcrush",
    profile: "exact-contract-topic-point",
    ruleVersion: LUNARCRUSH_EXACT_CONTRACT_TOPIC_RULE.version,
    rule: LUNARCRUSH_EXACT_CONTRACT_TOPIC_RULE,
    chain,
    tokenAddress,
    collectionStartedAt,
    availableAt,
    status: "blocked",
    blockers: [blocker],
    identity: {
      matchStatus: "contract-topic-identity-unproven",
      requestedContractAddress: tokenAddress,
      responseTopic: null,
      responseTitle: null,
    },
    endpoint,
    responseDigest: null,
    topicMetrics: null,
    topicMetricsDigest: null,
    aggregateOnly: true,
    rawPostsRetained: false,
    rawCreatorIdentitiesRetained: false,
    providerGenerationReported: false,
    researchOnly: true,
    mutationAllowed: false,
  };
}

function buildContractTopicStructureEvent({
  chain,
  tokenAddress,
  collectionStartedAt,
  availableAt,
  creatorsEndpoint,
  postsEndpoint,
  creatorsBody,
  postsBody,
}) {
  const creatorRows = Array.isArray(creatorsBody?.data) ? creatorsBody.data : [];
  const postRows = Array.isArray(postsBody?.data) ? postsBody.data : [];
  const exactPostId = cleanText(postsBody?.config?.id) === tokenAddress;
  const exactPostTopic = normalize(postsBody?.config?.topic) === normalize(tokenAddress);
  const creatorsValid = creatorRows.length > 0 && creatorRows.every((row) => {
    const interactions = finiteNumber(row?.interactions_24h ?? row?.interactions);
    return Number.isFinite(interactions) && interactions >= 0;
  });
  const postsValid = postRows.length > 0 && postRows.every((row) => {
    const interactions = finiteNumber(row?.interactions_24h ?? row?.interactions);
    return Number.isFinite(interactions) && interactions >= 0;
  });
  const creatorMetrics = creatorsValid ? aggregateCreatorRows(creatorRows) : null;
  const postMetrics = postsValid ? aggregatePostRows(postRows) : null;
  const interactionRatio = endpointInteractionRatio(
    creatorMetrics?.interactions24h,
    postMetrics?.interactions24h,
  );
  const blockers = [];
  if (!exactPostId) blockers.push("post config id does not preserve the exact contract");
  if (!exactPostTopic) blockers.push("post config topic does not match the exact contract");
  if (!creatorMetrics) blockers.push("creator aggregate rows are missing or invalid");
  if (!postMetrics) blockers.push("post aggregate rows are missing or invalid");
  if (!(interactionRatio <= LUNARCRUSH_EXACT_CONTRACT_TOPIC_STRUCTURE_RULE
    .maximumEndpointInteractionRatio)) {
    blockers.push("creator and post interaction totals are inconsistent");
  }
  const topicStructureMetrics = blockers.length ? null : {
    creator: creatorMetrics,
    post: postMetrics,
    endpointInteractionRatio: interactionRatio,
  };
  return {
    type: "lunarcrush-contract-topic-structure-snapshot",
    id: `lunarcrush_contract_topic_structure_${digestValue({
      tokenAddress,
      collectionStartedAt,
      availableAt,
      topicStructureMetrics,
      blockers,
    }).slice(0, 24)}`,
    provider: "lunarcrush",
    profile: "exact-contract-topic-structure",
    ruleVersion: LUNARCRUSH_EXACT_CONTRACT_TOPIC_STRUCTURE_RULE.version,
    rule: LUNARCRUSH_EXACT_CONTRACT_TOPIC_STRUCTURE_RULE,
    chain,
    tokenAddress,
    collectionStartedAt,
    availableAt,
    status: blockers.length ? "blocked" : "ready",
    blockers,
    identity: {
      matchStatus: exactPostId && exactPostTopic
        ? "exact-contract-post-config"
        : "contract-topic-identity-unproven",
      requestedContractAddress: tokenAddress,
      responseId: cleanText(postsBody?.config?.id) || null,
      responseTopic: cleanText(postsBody?.config?.topic) || null,
    },
    endpoints: { creators: creatorsEndpoint, posts: postsEndpoint },
    responseDigest: digestValue({
      identity: {
        id: cleanText(postsBody?.config?.id) || null,
        topic: cleanText(postsBody?.config?.topic) || null,
      },
      creatorMetrics,
      postMetrics,
    }),
    topicStructureMetrics,
    topicStructureMetricsDigest: topicStructureMetrics
      ? digestValue(topicStructureMetrics) : null,
    aggregateOnly: true,
    rawPostsRetained: false,
    rawPostTextRetained: false,
    rawCreatorIdentitiesRetained: false,
    rawCreatorIdsRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
}

function blockedContractTopicStructureEvent({
  chain,
  tokenAddress,
  collectionStartedAt,
  availableAt,
  creatorsEndpoint,
  postsEndpoint,
  blocker,
}) {
  return {
    type: "lunarcrush-contract-topic-structure-snapshot",
    id: `lunarcrush_contract_topic_structure_${digestValue({
      tokenAddress, collectionStartedAt, availableAt, blocker,
    }).slice(0, 24)}`,
    provider: "lunarcrush",
    profile: "exact-contract-topic-structure",
    ruleVersion: LUNARCRUSH_EXACT_CONTRACT_TOPIC_STRUCTURE_RULE.version,
    rule: LUNARCRUSH_EXACT_CONTRACT_TOPIC_STRUCTURE_RULE,
    chain,
    tokenAddress,
    collectionStartedAt,
    availableAt,
    status: "blocked",
    blockers: [blocker],
    identity: {
      matchStatus: "contract-topic-identity-unproven",
      requestedContractAddress: tokenAddress,
      responseId: null,
      responseTopic: null,
    },
    endpoints: { creators: creatorsEndpoint, posts: postsEndpoint },
    responseDigest: null,
    topicStructureMetrics: null,
    topicStructureMetricsDigest: null,
    aggregateOnly: true,
    rawPostsRetained: false,
    rawPostTextRetained: false,
    rawCreatorIdentitiesRetained: false,
    rawCreatorIdsRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
}

export function aggregatePostRows(rows, referenceAt = null) {
  const interactions = rows.map((row) => (
    finiteNumber(row?.interactions_24h ?? row?.interactions) ?? 0
  ));
  const totalInteractions = interactions.reduce((sum, value) => sum + value, 0);
  const sentiments = rows.map((row) => finiteNumber(row?.post_sentiment))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 5);
  const creatorIds = new Set(rows.map((row) => cleanText(row?.creator_id)).filter(Boolean));
  const postTypeCounts = {};
  for (const row of rows) {
    const type = normalize(row?.post_type) || "unspecified";
    postTypeCounts[type] = (postTypeCounts[type] ?? 0) + 1;
  }
  const topShare = totalInteractions > 0 ? Math.max(...interactions) / totalInteractions : 0;
  const hhi = totalInteractions > 0
    ? interactions.reduce((sum, value) => sum + ((value / totalInteractions) ** 2), 0)
    : 0;
  const referenceMs = Date.parse(referenceAt ?? "");
  const postAgesMinutes = Number.isFinite(referenceMs) ? rows.map((row) => {
    const createdAt = parsePostCreated(row?.post_created);
    return Number.isFinite(createdAt) && createdAt <= referenceMs
      ? (referenceMs - createdAt) / 60_000 : null;
  }).filter(Number.isFinite).sort((left, right) => left - right) : [];
  return {
    postCount: rows.length,
    uniqueCreatorCount: creatorIds.size,
    interactions24h: totalInteractions,
    topPostInteractionShare: round(topShare, 6),
    postInteractionHhi: round(hhi, 6),
    meanPostSentiment: sentiments.length
      ? round(sentiments.reduce((sum, value) => sum + value, 0) / sentiments.length, 6)
      : null,
    positivePostShare: sentiments.length
      ? round(sentiments.filter((value) => value >= 3.5).length / sentiments.length, 6)
      : null,
    sentimentCoverage: round(sentiments.length / rows.length, 6),
    postCreatedCoverage: round(postAgesMinutes.length / rows.length, 6),
    newestPostAgeMinutes: postAgesMinutes.length ? round(postAgesMinutes[0], 6) : null,
    medianPostAgeMinutes: postAgesMinutes.length
      ? round(postAgesMinutes[Math.floor(postAgesMinutes.length / 2)], 6) : null,
    oldestPostAgeMinutes: postAgesMinutes.length
      ? round(postAgesMinutes.at(-1), 6) : null,
    postShareCreatedWithin1h: postAgesMinutes.length
      ? round(postAgesMinutes.filter((value) => value <= 60).length / postAgesMinutes.length, 6)
      : null,
    postShareCreatedWithin6h: postAgesMinutes.length
      ? round(postAgesMinutes.filter((value) => value <= 360).length / postAgesMinutes.length, 6)
      : null,
    postTypeCounts: Object.fromEntries(Object.entries(postTypeCounts)
      .sort(([left], [right]) => left.localeCompare(right))),
  };
}

export function buildContractPostsEvent({
  chain, tokenAddress, collectionStartedAt, availableAt, endpoint, body,
}) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  const exactPostId = cleanText(body?.config?.id) === tokenAddress;
  const exactPostTopic = normalize(body?.config?.topic) === normalize(tokenAddress);
  const rowsValid = rows.length > 0 && rows.every((row) => {
    const interactions = finiteNumber(row?.interactions_24h ?? row?.interactions);
    return Number.isFinite(interactions) && interactions >= 0;
  });
  const postMetrics = rowsValid ? aggregatePostRows(rows, collectionStartedAt) : null;
  const semanticCorpus = rowsValid ? lunarCrushSemanticPostCorpus(rows) : [];
  const postCorpusDigest = semanticCorpus.length ? digestValue(semanticCorpus) : null;
  const blockers = [];
  if (!exactPostId) blockers.push("post config id does not preserve the exact contract");
  if (!exactPostTopic) blockers.push("post config topic does not match the exact contract");
  if (!postMetrics) blockers.push("post aggregate rows are missing or invalid");
  return {
    type: "lunarcrush-contract-posts-snapshot",
    id: `lunarcrush_contract_posts_${digestValue({
      tokenAddress, collectionStartedAt, availableAt, postMetrics, postCorpusDigest, blockers,
    }).slice(0, 24)}`,
    provider: "lunarcrush",
    profile: "exact-contract-posts",
    ruleVersion: LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE.version,
    rule: LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE,
    chain,
    tokenAddress,
    collectionStartedAt,
    availableAt,
    status: blockers.length ? "blocked" : "ready",
    blockers,
    identity: {
      matchStatus: exactPostId && exactPostTopic
        ? "exact-contract-post-config"
        : "contract-topic-identity-unproven",
      requestedContractAddress: tokenAddress,
      responseId: cleanText(body?.config?.id) || null,
      responseTopic: cleanText(body?.config?.topic) || null,
    },
    endpoint,
    responseDigest: digestValue({
      id: cleanText(body?.config?.id) || null,
      topic: cleanText(body?.config?.topic) || null,
      postMetrics,
      postCorpusDigest,
    }),
    postMetrics: blockers.length ? null : postMetrics,
    postMetricsDigest: blockers.length ? null : digestValue(postMetrics),
    postCorpusDigest: blockers.length ? null : postCorpusDigest,
    semanticPostCount: blockers.length ? 0 : semanticCorpus.length,
    aggregateOnly: true,
    rawPostsRetained: false,
    rawPostTextRetained: false,
    rawCreatorIdentitiesRetained: false,
    rawCreatorIdsRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
}

function blockedContractPostsEvent({
  chain, tokenAddress, collectionStartedAt, availableAt, endpoint, blocker,
}) {
  return {
    type: "lunarcrush-contract-posts-snapshot",
    id: `lunarcrush_contract_posts_${digestValue({
      tokenAddress, collectionStartedAt, availableAt, blocker,
    }).slice(0, 24)}`,
    provider: "lunarcrush",
    profile: "exact-contract-posts",
    ruleVersion: LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE.version,
    rule: LUNARCRUSH_EXACT_CONTRACT_POSTS_RULE,
    chain,
    tokenAddress,
    collectionStartedAt,
    availableAt,
    status: "blocked",
    blockers: [blocker],
    identity: {
      matchStatus: "contract-topic-identity-unproven",
      requestedContractAddress: tokenAddress,
      responseId: null,
      responseTopic: null,
    },
    endpoint,
    responseDigest: null,
    postMetrics: null,
    postMetricsDigest: null,
    postCorpusDigest: null,
    semanticPostCount: 0,
    aggregateOnly: true,
    rawPostsRetained: false,
    rawPostTextRetained: false,
    rawCreatorIdentitiesRetained: false,
    rawCreatorIdsRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
}

export function lunarCrushSemanticPostCorpus(rows, maximumPosts = 50) {
  const maximum = Number.isInteger(maximumPosts) && maximumPosts > 0
    ? Math.min(maximumPosts, 100) : 50;
  return (Array.isArray(rows) ? rows : []).slice(0, maximum).map((row, index) => ({
    index: index + 1,
    type: cleanText(row?.post_type).slice(0, 100),
    title: cleanText(row?.post_title).slice(0, 500),
    description: cleanText(row?.post_description).slice(0, 1_000),
  }));
}

function parsePostCreated(value) {
  if (typeof value === "number" || (typeof value === "string" && value.trim())) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
    }
  }
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function endpointInteractionRatio(left, right) {
  if (!(Number.isFinite(left) && left >= 0 && Number.isFinite(right) && right >= 0)) return null;
  if (left === 0 && right === 0) return 1;
  if (left === 0 || right === 0) return Number.POSITIVE_INFINITY;
  return round(Math.max(left, right) / Math.min(left, right), 6);
}

function contractTopicMetrics(data) {
  const interactions24h = finiteNumber(data?.interactions_24h);
  const contributorCount = finiteNumber(data?.num_contributors);
  const postCount = finiteNumber(data?.num_posts);
  if (![interactions24h, contributorCount, postCount].every((value) => (
    Number.isFinite(value) && value >= 0
  ))) return null;
  return {
    interactions24h,
    contributorCount,
    postCount,
    interactionsPerPost: postCount > 0 ? round(interactions24h / postCount, 6) : null,
    interactionsPerContributor: contributorCount > 0
      ? round(interactions24h / contributorCount, 6) : null,
    trend: cleanText(data?.trend).toLowerCase() || null,
    typeCounts: numericAggregateMap(data?.types_count),
    typeInteractions: numericAggregateMap(data?.types_interactions),
    typeSentiment: boundedAggregateMap(data?.types_sentiment, 0, 100),
  };
}

function numericAggregateMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, raw]) => {
    const number = finiteNumber(raw);
    return Number.isFinite(number) && number >= 0 ? [[normalize(key), number]] : [];
  }).sort(([left], [right]) => left.localeCompare(right)));
}

function boundedAggregateMap(value, minimum, maximum) {
  return Object.fromEntries(Object.entries(numericAggregateMap(value)).filter(([, number]) => (
    number >= minimum && number <= maximum
  )));
}

function buildSolanaSocialDiscovery(rows, universe) {
  const candidates = deriveLunarCrushSolanaDiscoveryCandidates(rows);
  const monitoringCandidates = deriveLunarCrushSolanaMonitoringCandidates(rows);
  return {
    type: "discovery",
    provider: "lunarcrush-coin-list",
    sourceProvider: "lunarcrush",
    chain: "solana",
    timeframe: "1h",
    ruleVersion: LUNARCRUSH_SOLANA_DISCOVERY_RULE.version,
    rule: LUNARCRUSH_SOLANA_DISCOVERY_RULE,
    universe,
    candidates,
    monitoringPanel: {
      ruleVersion: LUNARCRUSH_SOLANA_MONITORING_RULE.version,
      rule: LUNARCRUSH_SOLANA_MONITORING_RULE,
      candidates: monitoringCandidates,
      researchOnly: true,
      mutationAllowed: false,
    },
    researchOnly: true,
    mutationAllowed: false,
  };
}

function normalizeSolanaUniverseCandidates(rows) {
  const contractCounts = new Map();
  const records = [];
  for (const coin of Array.isArray(rows) ? rows : []) {
    const contracts = (Array.isArray(coin?.blockchains) ? coin.blockchains : [])
      .filter((blockchain) => normalize(blockchain?.network) === "solana")
      .map((blockchain) => cleanText(blockchain?.address))
      .filter((address) => address && address !== "0");
    if (contracts.length !== 1) continue;
    contractCounts.set(contracts[0], (contractCounts.get(contracts[0]) ?? 0) + 1);
    const metrics = {
      lunarcrushCoinId: finiteNumber(coin?.id),
      priceUsd: finiteNumber(coin?.price),
      marketCapUsd: finiteNumber(coin?.market_cap),
      volume24hUsd: finiteNumber(coin?.volume_24h),
      interactions24h: finiteNumber(coin?.interactions_24h),
      socialVolume24h: finiteNumber(coin?.social_volume_24h),
      altRank: finiteNumber(coin?.alt_rank),
      altRankPrevious: finiteNumber(coin?.alt_rank_previous),
      galaxyScore: finiteNumber(coin?.galaxy_score),
      galaxyScorePrevious: finiteNumber(coin?.galaxy_score_previous),
      priceChange1hPct: finiteNumber(coin?.percent_change_1h),
      priceChange24hPct: finiteNumber(coin?.percent_change_24h),
    };
    records.push({
      chain: "solana",
      tokenAddress: contracts[0],
      symbol: cleanText(coin?.symbol) || null,
      name: cleanText(coin?.name) || null,
      topic: cleanText(coin?.topic) || null,
      ...metrics,
      altRankImprovement: metrics.altRankPrevious == null || metrics.altRank == null
        ? null
        : metrics.altRankPrevious - metrics.altRank,
      galaxyScoreImprovement: metrics.galaxyScorePrevious == null || metrics.galaxyScore == null
        ? null
        : metrics.galaxyScore - metrics.galaxyScorePrevious,
    });
  }
  return records.filter((candidate) => contractCounts.get(candidate.tokenAddress) === 1);
}

function buildReadyOrBlockedEvent({ observedAt, chain, tokenAddress, universe, match, body, endpoint }) {
  const observedUnix = Math.floor(observedAt.getTime() / 1_000);
  const rows = normalizeHistoryRows(body?.data)
    .filter((row) => row.time + HOUR_SECONDS <= observedUnix)
    .sort((left, right) => left.time - right.time);
  const duplicateTimes = rows.some((row, index) => index > 0 && row.time === rows[index - 1].time);
  const needed = LUNARCRUSH_MOVE_ALERT_RULE.minimumHistoryHours + 1;
  const historyRows = rows.slice(-needed);
  const blockers = [];
  if (duplicateTimes) blockers.push("hourly history contains duplicate timestamps");
  if (historyRows.length < needed) blockers.push(`fewer than ${needed} completed hourly rows are available`);
  if (historyRows.some((row, index) => index > 0 && row.time - historyRows[index - 1].time !== HOUR_SECONDS)) {
    blockers.push("hourly history is not contiguous");
  }
  const last = historyRows.at(-1);
  if (last && observedUnix - (last.time + HOUR_SECONDS) > (
    LUNARCRUSH_MOVE_ALERT_RULE.maximumCompletedBarStalenessHours * HOUR_SECONDS
  )) blockers.push("latest completed LunarCrush hour is stale");
  const generatedUnix = finiteNumber(body?.config?.generated);
  if (generatedUnix == null) blockers.push("hourly history generation time is missing");
  if (generatedUnix != null && generatedUnix > observedUnix + 300) {
    blockers.push("hourly history generation time is in the future");
  }
  const features = blockers.length ? null : deriveLunarCrushMoveAlertFeatures(historyRows);
  if (!features) blockers.push("required hourly social fields are missing or have zero trailing variance");
  const identity = identityEvidence(match, "exact-single-contract-match");
  const payload = {
    type: "lunarcrush-social-snapshot",
    id: `lunarcrush_social_${digestValue({
      observedAt: observedAt.toISOString(),
      tokenAddress,
      coinId: match.coinId,
      historyThrough: last?.time ?? null,
    }).slice(0, 24)}`,
    observedAt: observedAt.toISOString(),
    provider: "lunarcrush",
    profile: "exact-mint-hourly",
    chain,
    tokenAddress,
    status: blockers.length ? "blocked" : "ready",
    blockers: [...new Set(blockers)],
    ruleVersion: LUNARCRUSH_MOVE_ALERT_RULE.version,
    rule: LUNARCRUSH_MOVE_ALERT_RULE,
    universe,
    identity,
    historyEndpoint: endpoint,
    historyGeneratedAt: isoFromUnix(generatedUnix),
    historyThrough: last ? new Date((last.time + HOUR_SECONDS) * 1_000).toISOString() : null,
    historyResponseDigest: digestValue(body?.data ?? []),
    historyRows,
    socialFeatures: features,
    researchOnly: true,
    mutationAllowed: false,
  };
  return payload;
}

function buildCreatorAggregateEvent({ observedAt, chain, tokenAddress, universe, match, body, endpoint }) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  const generatedUnix = finiteNumber(body?.config?.generated);
  const observedUnix = Math.floor(observedAt.getTime() / 1_000);
  const blockers = [];
  if (!rows.length) blockers.push("LunarCrush topic creator response contains no creators");
  if (generatedUnix != null && generatedUnix > observedUnix + 300) {
    blockers.push("topic creator response generation time is in the future");
  }
  const creatorMetrics = rows.length ? aggregateCreatorRows(rows) : null;
  const common = {
    type: "lunarcrush-creator-aggregate",
    id: `lunarcrush_creator_${digestValue({
      observedAt: observedAt.toISOString(),
      tokenAddress,
      coinId: match.coinId,
      topic: match.topic,
    }).slice(0, 24)}`,
    observedAt: observedAt.toISOString(),
    provider: "lunarcrush",
    profile: "social-discovery-creator-aggregate",
    chain,
    tokenAddress,
    status: blockers.length ? "blocked" : "ready",
    blockers,
    universe,
    identity: identityEvidence(match, "exact-single-contract-topic-match"),
    topicJoinStatus: "provider-coin-row-exact-contract-unique-topic",
    creatorEndpoint: endpoint,
    creatorGeneratedAt: isoFromUnix(generatedUnix),
    providerGenerationReported: generatedUnix != null,
    creatorAggregateDigest: creatorMetrics ? digestValue(creatorMetrics) : null,
    creatorMetrics: blockers.length ? null : creatorMetrics,
    aggregateOnly: true,
    rawCreatorIdentitiesRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
  return common;
}

function blockedCreatorAggregateEvent({
  observedAtIso, chain, tokenAddress, universe, match, endpoint, blocker,
  topicJoinStatus = "provider-coin-row-exact-contract-topic",
}) {
  return {
    type: "lunarcrush-creator-aggregate",
    id: `lunarcrush_creator_${digestValue({
      observedAt: observedAtIso, tokenAddress, coinId: match?.coinId, topic: match?.topic,
    }).slice(0, 24)}`,
    observedAt: observedAtIso,
    provider: "lunarcrush",
    profile: "social-discovery-creator-aggregate",
    chain,
    tokenAddress,
    status: "blocked",
    blockers: [blocker],
    universe,
    identity: identityEvidence(match, "exact-single-contract-topic-match"),
    topicJoinStatus,
    creatorEndpoint: endpoint,
    creatorGeneratedAt: null,
    providerGenerationReported: false,
    creatorAggregateDigest: null,
    creatorMetrics: null,
    aggregateOnly: true,
    rawCreatorIdentitiesRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
}

function aggregateCreatorRows(rows) {
  const interactions = rows.map((row) => finiteNumber(row?.interactions_24h ?? row?.interactions) ?? 0);
  const totalInteractions = interactions.reduce((sum, value) => sum + value, 0);
  const followers = rows.map((row) => finiteNumber(
    row?.creator_followers ?? row?.followers ?? row?.followers_count,
  ))
    .filter(Number.isFinite).sort((left, right) => left - right);
  const ranks = rows.map((row) => finiteNumber(row?.creator_rank)).filter(Number.isFinite)
    .sort((left, right) => left - right);
  const networkCounts = {};
  for (const row of rows) {
    const rawNetwork = normalize(row?.network ?? row?.social_network ?? row?.type);
    const network = ["twitter", "youtube", "reddit", "tiktok", "instagram", "news"].includes(rawNetwork)
      ? rawNetwork : "unspecified";
    networkCounts[network] = (networkCounts[network] ?? 0) + 1;
  }
  const topShare = totalInteractions > 0 ? Math.max(...interactions) / totalInteractions : 0;
  const hhi = totalInteractions > 0
    ? interactions.reduce((sum, value) => sum + ((value / totalInteractions) ** 2), 0)
    : 0;
  const midpoint = Math.floor(followers.length / 2);
  const medianFollowers = followers.length % 2
    ? followers[midpoint]
    : followers.length ? (followers[midpoint - 1] + followers[midpoint]) / 2 : null;
  const rankMidpoint = Math.floor(ranks.length / 2);
  const medianRank = ranks.length % 2
    ? ranks[rankMidpoint]
    : ranks.length ? (ranks[rankMidpoint - 1] + ranks[rankMidpoint]) / 2 : null;
  return {
    creatorCount: rows.length,
    interactions24h: totalInteractions,
    topCreatorInteractionShare: round(topShare, 6),
    creatorInteractionHhi: round(hhi, 6),
    medianCreatorFollowers: medianFollowers,
    medianCreatorRank: medianRank,
    networkCounts: Object.fromEntries(Object.entries(networkCounts).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function finalizeCollection(result, clock) {
  const availableAt = validDate(clock()).toISOString();
  if (Date.parse(availableAt) < Date.parse(result.observedAt)) {
    throw new Error("LunarCrush evidence availability precedes collection start.");
  }
  const discovery = result.discovery ? {
    ...result.discovery,
    id: `discovery_${digestValue({
      provider: result.discovery.provider,
      ruleVersion: result.discovery.ruleVersion,
      availableAt,
      candidates: result.discovery.candidates.map((candidate) => candidate.tokenAddress),
      monitoringRuleVersion: result.discovery.monitoringPanel?.ruleVersion ?? null,
      monitoringCandidates: result.discovery.monitoringPanel?.candidates
        ?.map((candidate) => candidate.tokenAddress) ?? [],
    }).slice(0, 24)}`,
    observedAt: availableAt,
    collectionStartedAt: result.observedAt,
    availableAt,
  } : null;
  const discoveryTokens = new Set(
    discovery?.candidates?.map((candidate) => cleanText(candidate.tokenAddress)) ?? [],
  );
  return {
    ...result,
    collectionStartedAt: result.observedAt,
    availableAt,
    discovery,
    events: result.events.map((event) => ({
      ...event,
      collectionStartedAt: result.observedAt,
      availableAt,
      ...(discoveryTokens.has(cleanText(event.tokenAddress))
        ? { sourceDiscoveryEventId: discovery.id }
        : {}),
    })),
    creatorEvents: (result.creatorEvents ?? []).map((event) => ({
      ...event,
      collectionStartedAt: result.observedAt,
      availableAt,
      ...(discoveryTokens.has(cleanText(event.tokenAddress))
        ? { sourceDiscoveryEventId: discovery.id }
        : {}),
    })),
  };
}

export function deriveLunarCrushMoveAlertFeatures(historyRows) {
  const current = historyRows.at(-1);
  const prior = historyRows.slice(0, -1);
  const interactionsZ = standardScore(current?.interactions, prior.map((row) => row.interactions));
  const postsActiveZ = standardScore(current?.postsActive, prior.map((row) => row.postsActive));
  const contributorsActiveZ = standardScore(
    current?.contributorsActive,
    prior.map((row) => row.contributorsActive),
  );
  if (![interactionsZ, postsActiveZ, contributorsActiveZ, current?.altRank, current?.galaxyScore]
    .every(Number.isFinite)) return null;
  const accelerationSignalCount = [
    interactionsZ >= LUNARCRUSH_MOVE_ALERT_RULE.minimumInteractionsZ,
    postsActiveZ >= LUNARCRUSH_MOVE_ALERT_RULE.minimumPostsActiveZ,
    contributorsActiveZ >= LUNARCRUSH_MOVE_ALERT_RULE.minimumContributorsActiveZ,
  ].filter(Boolean).length;
  const providerThresholdCount = [
    current.altRank <= LUNARCRUSH_MOVE_ALERT_RULE.maximumAltRank,
    current.galaxyScore >= LUNARCRUSH_MOVE_ALERT_RULE.minimumGalaxyScore,
  ].filter(Boolean).length;
  return {
    completedHourStart: new Date(current.time * 1_000).toISOString(),
    interactions: current.interactions,
    postsActive: current.postsActive,
    contributorsActive: current.contributorsActive,
    altRank: current.altRank,
    galaxyScore: current.galaxyScore,
    sentiment: current.sentiment,
    spam: current.spam,
    socialDominance: current.socialDominance,
    interactionsZ: round(interactionsZ, 6),
    postsActiveZ: round(postsActiveZ, 6),
    contributorsActiveZ: round(contributorsActiveZ, 6),
    accelerationSignalCount,
    providerThresholdCount,
    largeMoveAlert: accelerationSignalCount >= LUNARCRUSH_MOVE_ALERT_RULE.minimumAccelerationSignals
      && providerThresholdCount >= LUNARCRUSH_MOVE_ALERT_RULE.minimumProviderThresholds,
  };
}

function normalizeHistoryRows(input) {
  if (!Array.isArray(input)) return [];
  return input.map((row) => ({
    time: finiteNumber(row?.time),
    interactions: finiteNumber(row?.interactions),
    postsActive: finiteNumber(row?.posts_active),
    contributorsActive: finiteNumber(row?.contributors_active),
    altRank: finiteNumber(row?.alt_rank),
    galaxyScore: finiteNumber(row?.galaxy_score),
    sentiment: finiteNumber(row?.sentiment),
    spam: finiteNumber(row?.spam),
    socialDominance: finiteNumber(row?.social_dominance),
    close: finiteNumber(row?.close),
  })).filter((row) => Number.isFinite(row.time));
}

function blockedEvent({ observedAtIso, chain, tokenAddress, universe, blocker, match, matchStatus }) {
  return {
    type: "lunarcrush-social-snapshot",
    id: `lunarcrush_social_${digestValue({
      observedAt: observedAtIso,
      tokenAddress,
      matchStatus,
    }).slice(0, 24)}`,
    observedAt: observedAtIso,
    provider: "lunarcrush",
    profile: "exact-mint-hourly",
    chain,
    tokenAddress,
    status: "blocked",
    blockers: [blocker],
    ruleVersion: LUNARCRUSH_MOVE_ALERT_RULE.version,
    rule: LUNARCRUSH_MOVE_ALERT_RULE,
    universe,
    identity: identityEvidence(match, matchStatus),
    historyEndpoint: null,
    historyGeneratedAt: null,
    historyThrough: null,
    historyResponseDigest: null,
    historyRows: [],
    socialFeatures: null,
    researchOnly: true,
    mutationAllowed: false,
  };
}

function contractMatches(rows, tokens, chain) {
  const wanted = new Set(tokens);
  const result = new Map();
  const topicCoinIds = new Map();
  rows.forEach((coin, index) => {
    const topic = normalize(coin?.topic);
    if (!topic) return;
    const ids = topicCoinIds.get(topic) ?? new Set();
    ids.add(finiteNumber(coin?.id) ?? `row-${index}`);
    topicCoinIds.set(topic, ids);
  });
  for (const coin of rows) {
    for (const blockchain of Array.isArray(coin?.blockchains) ? coin.blockchains : []) {
      if (normalize(blockchain?.network) !== chain) continue;
      const address = cleanText(blockchain?.address);
      if (!wanted.has(address)) continue;
      const values = result.get(address) ?? [];
      values.push({
        coinId: finiteNumber(coin?.id),
        symbol: cleanText(coin?.symbol) || null,
        name: cleanText(coin?.name) || null,
        topic: cleanText(coin?.topic) || null,
        topicUniverseCoinRowCount: topicCoinIds.get(normalize(coin?.topic))?.size ?? 0,
        network: cleanText(blockchain?.network),
        contractAddress: address,
        decimals: finiteNumber(blockchain?.decimals),
      });
      result.set(address, values);
    }
  }
  return result;
}

function identityEvidence(match, matchStatus) {
  return {
    matchStatus,
    coinId: match?.coinId ?? null,
    symbol: match?.symbol ?? null,
    name: match?.name ?? null,
    topic: match?.topic ?? null,
    topicUniverseCoinRowCount: match?.topicUniverseCoinRowCount ?? null,
    network: match?.network ?? null,
    contractAddress: match?.contractAddress ?? null,
    decimals: match?.decimals ?? null,
  };
}

function standardScore(current, priorValues) {
  if (!Number.isFinite(current) || !priorValues.length || priorValues.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const mean = priorValues.reduce((sum, value) => sum + value, 0) / priorValues.length;
  const variance = priorValues.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / priorValues.length;
  const deviation = Math.sqrt(variance);
  return deviation > 0 ? (current - mean) / deviation : null;
}

function digestValue(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validDate(value) {
  const result = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error("A valid observedAt is required.");
  return result;
}

function isoFromUnix(value) {
  return Number.isFinite(value) ? new Date(value * 1_000).toISOString() : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value) {
  return cleanText(String(value ?? "")).toLowerCase();
}

function round(value, digits) {
  return Math.round(value * (10 ** digits)) / (10 ** digits);
}
