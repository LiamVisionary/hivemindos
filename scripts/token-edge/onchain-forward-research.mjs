#!/usr/bin/env node

import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  aggregateNansenSnapshot,
  appendLedgerEvent,
  buildEvolutionReadiness,
  buildScorecard,
  createChallengerRegistrationEvents,
  createForecastEvents,
  createSnapshotEvent,
  digestValue,
  eventWithIntegrity,
  latestPriorSnapshot,
  marketSnapshotFromDexPair,
  missedResolutionEvent,
  readLedger,
  resolutionEvent,
  selectDeepestTokenPair,
  unresolvedForecasts,
  verifyLedger,
} from "./onchain-forward-core.mjs";
import { createExecutionPolicyRegistrationEvents } from "./onchain-capacity-scorecard.mjs";
import { collectExactMintLunarCrushEvidence } from "./onchain-lunarcrush-provider.mjs";
import {
  buildPendingPathObservationTargets,
  createPathObservationEvent,
} from "./onchain-path-observations.mjs";
import {
  buildEvolutionReviewEvent,
  buildPendingRetrospectives,
  buildRetrospectiveReport,
} from "./onchain-retrospective.mjs";
import { TOKEN_EDGE_MAX_EXACT_LIVE_LAG_MS } from "./onchain-outcome-timing.mjs";

const DEX_SCREENER_BASE_URL = "https://api.dexscreener.com";
const GECKO_TERMINAL_BASE_URL = "https://api.geckoterminal.com/api/v2";
const NANSEN_BASE_URL = "https://api.nansen.ai";
const NANSEN_ATTRIBUTION = "Powered by Nansen API";
const GECKO_TERMINAL_ATTRIBUTION = "Powered by CoinGecko / GeckoTerminal API";

export const TOKEN_EDGE_DEX_EXECUTION_PRICE_INTEGRITY_RULE = Object.freeze({
  version: "token-edge-dex-execution-cross-endpoint-v1",
  appliesFrom: "2026-08-03T18:41:08.629Z",
  maximumPriceRatioInclusive: 1.1,
  maximumLiquidityRatioInclusive: 1.25,
  selectedQuotePolicy: "lower-price-and-lower-liquidity",
});

const NANSEN_PROFILES = Object.freeze({
  off: { creditsPerToken: 0, endpoints: [] },
  core: {
    creditsPerToken: 9,
    endpoints: [
      ["tokenInformation", "/api/v1/tgm/token-information", 1],
      ["flowIntelligence", "/api/v1/tgm/flow-intelligence", 1],
      ["holders", "/api/v1/tgm/holders", 5],
      ["whoBought", "/api/v1/tgm/who-bought-sold", 1],
      ["whoSold", "/api/v1/tgm/who-bought-sold", 1],
    ],
  },
  full: {
    creditsPerToken: 14,
    endpoints: [
      ["tokenInformation", "/api/v1/tgm/token-information", 1],
      ["flowIntelligence", "/api/v1/tgm/flow-intelligence", 1],
      ["holders", "/api/v1/tgm/holders", 5],
      ["whoBought", "/api/v1/tgm/who-bought-sold", 1],
      ["whoSold", "/api/v1/tgm/who-bought-sold", 1],
      ["pnlLeaderboard", "/api/v1/tgm/pnl-leaderboard", 5],
    ],
  },
});

export function defaultTokenEdgeLedgerPath(env = process.env) {
  const explicit = env.HIVEMINDOS_TOKEN_EDGE_LEDGER?.trim();
  if (explicit) return path.resolve(explicit);
  const stateRoot = env.XDG_STATE_HOME?.trim()
    ? path.resolve(env.XDG_STATE_HOME)
    : path.join(os.homedir(), ".hivemindos");
  return path.join(stateRoot, "research", "token-edge", "onchain-forward-ledger.jsonl");
}

export function nansenBudgetPlan(profile, tokenCount, maxCredits) {
  const spec = NANSEN_PROFILES[profile];
  if (!spec) throw new Error(`Unknown Nansen profile: ${profile}. Use off, core, or full.`);
  const requiredCredits = spec.creditsPerToken * tokenCount;
  if (requiredCredits > 0 && !Number.isFinite(maxCredits)) {
    throw new Error(`Nansen ${profile} requires --max-nansen-credits ${requiredCredits} for ${tokenCount} token(s).`);
  }
  if (requiredCredits > maxCredits) {
    throw new Error(`Nansen budget is ${maxCredits} credits, but ${profile} requires ${requiredCredits}.`);
  }
  return {
    profile,
    tokenCount,
    creditsPerToken: spec.creditsPerToken,
    requiredCredits,
    endpoints: spec.endpoints.map(([name, endpoint, credits]) => ({ name, endpoint, credits })),
  };
}

export async function fetchDexMarket(chain, tokenAddress, fetcher = fetch, observedAt = new Date()) {
  const response = await fetcher(
    `${DEX_SCREENER_BASE_URL}/token-pairs/v1/${encodeURIComponent(chain)}/${encodeURIComponent(tokenAddress)}`,
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`DEX Screener returned HTTP ${response.status}.`);
  const pairs = await response.json();
  const deepest = selectDeepestTokenPair(pairs, tokenAddress);
  const responseAvailableAt = typeof observedAt === "function" ? observedAt() : observedAt;
  const market = marketSnapshotFromDexPair(deepest, tokenAddress, responseAvailableAt);
  if (!market) throw new Error("DEX Screener returned no positive-price base-token pair.");
  return market;
}

export async function fetchDexExecutionMarket(
  chain,
  tokenAddress,
  fetcher = fetch,
  observedAt = new Date(),
) {
  const directMarket = await fetchDexMarket(chain, tokenAddress, fetcher, observedAt);
  const response = await fetcher(
    `${DEX_SCREENER_BASE_URL}/tokens/v1/${encodeURIComponent(chain)}/${encodeURIComponent(tokenAddress)}`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error(`DEX Screener token batch returned HTTP ${response.status}.`);
  const rows = await response.json();
  const batchPair = (Array.isArray(rows) ? rows : []).find((pair) => (
    pair?.baseToken?.address === tokenAddress && pair?.pairAddress === directMarket.pairAddress
  ));
  const responseAvailableAt = typeof observedAt === "function" ? observedAt() : observedAt;
  const batchMarket = marketSnapshotFromDexPair(batchPair, tokenAddress, responseAvailableAt);
  const reason = tokenEdgeDexExecutionPriceIntegrityReason(directMarket, batchMarket);
  if (reason) throw new Error(`DEX execution price integrity rejected ${tokenAddress}: ${reason}`);
  const priceUsd = Math.min(directMarket.priceUsd, batchMarket.priceUsd);
  const liquidityUsd = Math.min(directMarket.liquidityUsd, batchMarket.liquidityUsd);
  return {
    ...directMarket,
    priceUsd,
    liquidityUsd,
    providerPriceIntegrity: {
      ruleVersion: TOKEN_EDGE_DEX_EXECUTION_PRICE_INTEGRITY_RULE.version,
      tokenPairsPriceUsd: directMarket.priceUsd,
      tokenBatchPriceUsd: batchMarket.priceUsd,
      priceRatio: safeRatio(
        Math.max(directMarket.priceUsd, batchMarket.priceUsd),
        Math.min(directMarket.priceUsd, batchMarket.priceUsd),
      ),
      tokenPairsLiquidityUsd: directMarket.liquidityUsd,
      tokenBatchLiquidityUsd: batchMarket.liquidityUsd,
      liquidityRatio: safeRatio(
        Math.max(directMarket.liquidityUsd, batchMarket.liquidityUsd),
        Math.min(directMarket.liquidityUsd, batchMarket.liquidityUsd),
      ),
      selectedQuotePolicy: TOKEN_EDGE_DEX_EXECUTION_PRICE_INTEGRITY_RULE.selectedQuotePolicy,
    },
  };
}

export function tokenEdgeDexExecutionPriceIntegrityReason(tokenPairsMarket, tokenBatchMarket) {
  if (!tokenPairsMarket || !tokenBatchMarket
    || tokenPairsMarket.pairAddress !== tokenBatchMarket.pairAddress) {
    return "exact-pair-missing-from-one-endpoint";
  }
  const prices = [tokenPairsMarket.priceUsd, tokenBatchMarket.priceUsd];
  const liquidities = [tokenPairsMarket.liquidityUsd, tokenBatchMarket.liquidityUsd];
  if (![...prices, ...liquidities].every((value) => Number.isFinite(value) && value > 0)) {
    return "non-positive-price-or-liquidity";
  }
  if (Math.max(...prices) / Math.min(...prices)
    > TOKEN_EDGE_DEX_EXECUTION_PRICE_INTEGRITY_RULE.maximumPriceRatioInclusive) {
    return "cross-endpoint-price-disagreement";
  }
  if (Math.max(...liquidities) / Math.min(...liquidities)
    > TOKEN_EDGE_DEX_EXECUTION_PRICE_INTEGRITY_RULE.maximumLiquidityRatioInclusive) {
    return "cross-endpoint-liquidity-disagreement";
  }
  return null;
}

export function validTokenEdgeStoredExecutionPriceIntegrity(
  integrity,
  selectedPriceUsd,
  selectedLiquidityUsd,
) {
  const tokenPairsMarket = {
    pairAddress: "exact",
    priceUsd: integrity?.tokenPairsPriceUsd,
    liquidityUsd: integrity?.tokenPairsLiquidityUsd,
  };
  const tokenBatchMarket = {
    pairAddress: "exact",
    priceUsd: integrity?.tokenBatchPriceUsd,
    liquidityUsd: integrity?.tokenBatchLiquidityUsd,
  };
  if (integrity?.ruleVersion !== TOKEN_EDGE_DEX_EXECUTION_PRICE_INTEGRITY_RULE.version
    || integrity?.selectedQuotePolicy
      !== TOKEN_EDGE_DEX_EXECUTION_PRICE_INTEGRITY_RULE.selectedQuotePolicy
    || tokenEdgeDexExecutionPriceIntegrityReason(tokenPairsMarket, tokenBatchMarket) !== null) {
    return false;
  }
  const prices = [tokenPairsMarket.priceUsd, tokenBatchMarket.priceUsd];
  const liquidities = [tokenPairsMarket.liquidityUsd, tokenBatchMarket.liquidityUsd];
  return integrity.priceRatio === safeRatio(Math.max(...prices), Math.min(...prices))
    && integrity.liquidityRatio === safeRatio(
      Math.max(...liquidities),
      Math.min(...liquidities),
    )
    && selectedPriceUsd === Math.min(...prices)
    && selectedLiquidityUsd === Math.min(...liquidities);
}

export async function fetchNansenAggregates(input, fetcher = fetch) {
  const profile = input.profile ?? "off";
  const plan = nansenBudgetPlan(profile, 1, input.maxCredits);
  if (profile === "off") {
    return {
      status: "disabled",
      profile,
      attemptedCredits: 0,
      aggregates: null,
      sourceAttribution: null,
      errors: [],
    };
  }
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new Error("NANSEN_API_KEY is required for a non-off Nansen profile.");
  const date = dateRangeHours(input.observedAt ?? new Date(), 24);
  const payloads = {};
  const errors = [];
  await Promise.all(plan.endpoints.map(async ({ name, endpoint }) => {
    const body = nansenBody(name, input.chain, input.tokenAddress, date);
    try {
      const response = await fetcher(`${NANSEN_BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          apikey: apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(name === "pnlLeaderboard" ? 60_000 : 30_000),
      });
      if (!response.ok) {
        errors.push({ endpoint: name, status: response.status });
        return;
      }
      payloads[name] = await response.json();
    } catch (error) {
      errors.push({
        endpoint: name,
        status: null,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }));
  const successful = Object.keys(payloads).length;
  return {
    status: successful === plan.endpoints.length ? "ok" : successful > 0 ? "partial" : "failed",
    profile,
    attemptedCredits: plan.requiredCredits,
    aggregates: successful ? aggregateNansenSnapshot(payloads) : null,
    sourceAttribution: NANSEN_ATTRIBUTION,
    errors: errors.sort((left, right) => left.endpoint.localeCompare(right.endpoint)),
  };
}

export async function fetchNansenOhlcvBatch(input, fetcher = fetch) {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new Error("NANSEN_API_KEY is required for Nansen OHLCV recovery.");
  const tokenAddresses = [...new Set((input.tokenAddresses ?? []).map((value) => value.trim()).filter(Boolean))];
  if (!tokenAddresses.length || tokenAddresses.length > 5) {
    throw new Error("Nansen OHLCV recovery requires between one and five token addresses per call.");
  }
  const timeframe = input.timeframe ?? "1m";
  if (timeframe !== "1m" && timeframe !== "5m") {
    throw new Error("Nansen OHLCV recovery supports only 1m or 5m closed candles.");
  }
  const request = {
    chain: input.chain,
    ...(tokenAddresses.length === 1
      ? { token_address: tokenAddresses[0] }
      : { token_addresses: tokenAddresses }),
    timeframe,
    date: { from: input.from, to: input.to },
  };
  const response = await fetcher(`${NANSEN_BASE_URL}/api/v1/tgm/token-ohlcv`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Nansen token OHLCV returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload?.truncated) throw new Error("Nansen token OHLCV response was truncated.");
  const tokens = Array.isArray(payload?.tokens)
    ? payload.tokens
    : [{ token_address: payload?.token_address ?? tokenAddresses[0], data: payload?.data }];
  const candlesByToken = new Map(tokens.map((token) => [
    normalizeTokenKey(token?.token_address),
    Array.isArray(token?.data) ? token.data : [],
  ]));
  return { attemptedCredits: 1, candlesByToken };
}

export async function discoverNansenTokenCandidates(input, fetcher = fetch) {
  if (!(input.maxCredits >= 1)) {
    throw new Error("Nansen discovery requires --max-nansen-credits 1.");
  }
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new Error("NANSEN_API_KEY is required for Nansen discovery.");
  const chain = input.chain ?? "solana";
  const timeframe = input.timeframe ?? "1h";
  const request = {
    chains: [chain],
    timeframe,
    pagination: { page: 1, per_page: 50 },
    filters: {
      only_smart_money: true,
      token_age_days: { max: 30 },
    },
    order_by: [{ field: "netflow", direction: "DESC" }],
  };
  const response = await fetcher(`${NANSEN_BASE_URL}/api/v1/token-screener`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Nansen token screener returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const candidates = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const tokenAddress = textValue(row.token_address);
    if (!tokenAddress) return [];
    const candidate = {
      chain: textValue(row.chain) || chain,
      tokenAddress,
      symbol: textValue(row.token_symbol) || null,
      tokenAgeDays: numericValue(row.token_age_days),
      tokenAgeHours: numericValue(row.token_age_hours),
      marketCapUsd: numericValue(row.market_cap_usd),
      liquidityUsd: numericValue(row.liquidity),
      priceUsd: numericValue(row.price_usd),
      priceChangePct: numericValue(row.price_change),
      buyVolumeUsd: numericValue(row.buy_volume),
      sellVolumeUsd: numericValue(row.sell_volume),
      volumeUsd: numericValue(row.volume),
      netflowUsd: numericValue(row.netflow),
      fdvUsd: numericValue(row.fdv),
      inflowFdvRatio: numericValue(row.inflow_fdv_ratio),
      outflowFdvRatio: numericValue(row.outflow_fdv_ratio),
    };
    const blockers = discoveryBlockers(candidate);
    return [{
      ...candidate,
      buySellVolumeRatio: safeRatio(candidate.buyVolumeUsd, candidate.sellVolumeUsd),
      netflowToLiquidity: safeRatio(candidate.netflowUsd, candidate.liquidityUsd),
      status: blockers.length ? "blocked" : "eligible",
      blockers,
    }];
  });
  return {
    provider: "nansen-token-screener",
    sourceAttribution: NANSEN_ATTRIBUTION,
    attemptedCredits: 1,
    chain,
    timeframe,
    requestPolicy: {
      onlySmartMoney: true,
      maximumTokenAgeDays: 30,
      orderBy: "netflow-desc",
    },
    candidates,
  };
}

export async function recordNansenDiscovery(options, dependencies = {}) {
  const observedAt = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const chain = options.chain ?? "solana";
  const timeframe = options.timeframe ?? "1h";
  const previousEvents = await readLedger(ledgerPath);
  const verification = verifyLedger(previousEvents);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const cadenceMs = timeframe === "5m"
    ? 15 * 60_000
    : timeframe === "24h" ? 24 * 60 * 60_000 : 60 * 60_000;
  const bucketStart = Math.floor(observedAt.getTime() / cadenceMs) * cadenceMs;
  const existing = previousEvents.find((event) => event.type === "discovery"
    && event.provider === "nansen-token-screener"
    && event.chain === chain
    && event.timeframe === timeframe
    && Date.parse(event.observedAt) >= bucketStart
    && Date.parse(event.observedAt) < bucketStart + cadenceMs);
  if (existing) return {
    ledgerPath, status: "skipped-existing-cadence", discoveryId: existing.id,
    observedAt: existing.observedAt, attemptedCredits: 0,
    eligible: [],
    existingEligibleCount: existing.candidates.filter((candidate) => candidate.status === "eligible").length,
    blockedCount: existing.candidates.filter((candidate) => candidate.status === "blocked").length,
    totalCandidates: existing.candidates.length,
  };
  const discovery = await discoverNansenTokenCandidates({
    chain,
    timeframe,
    maxCredits: options.maxNansenCredits,
    apiKey: options.nansenApiKey,
  }, dependencies.fetcher ?? fetch);
  const event = {
    type: "discovery",
    id: `discovery_${digestValue({
      observedAt: observedAt.toISOString(),
      provider: discovery.provider,
      chain: discovery.chain,
      timeframe: discovery.timeframe,
    }).slice(0, 24)}`,
    observedAt: observedAt.toISOString(),
    ...discovery,
  };
  const signed = await appendLedgerEvent(ledgerPath, event);
  return {
    ledgerPath,
    status: "recorded",
    discoveryId: signed.id,
    observedAt: signed.observedAt,
    attemptedCredits: signed.attemptedCredits,
    eligible: signed.candidates.filter((candidate) => candidate.status === "eligible"),
    blockedCount: signed.candidates.filter((candidate) => candidate.status === "blocked").length,
    totalCandidates: signed.candidates.length,
  };
}

export async function recordDexCandidateConfirmation(options, dependencies = {}) {
  const observedAt = dependencies.now ?? new Date();
  const fetcher = dependencies.fetcher ?? fetch;
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const chain = options.chain ?? "solana";
  const tokens = [...new Set((options.tokenAddresses ?? []).map((token) => token.trim()).filter(Boolean))];
  if (!tokens.length) throw new Error("At least one explicit token address is required.");
  const previousEvents = await readLedger(ledgerPath);
  const verification = verifyLedger(previousEvents);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);

  const candidates = [];
  for (const tokenAddress of tokens) {
    try {
      const market = observedAt.getTime()
        >= Date.parse(TOKEN_EDGE_DEX_EXECUTION_PRICE_INTEGRITY_RULE.appliesFrom)
        ? await fetchDexExecutionMarket(chain, tokenAddress, fetcher, observedAt)
        : await fetchDexMarket(chain, tokenAddress, fetcher, observedAt);
      const snapshot = createSnapshotEvent({
        observedAt,
        chain,
        tokenAddress,
        cohort: "dex-candidate-confirmation",
        market,
      });
      const control = createForecastEvents(snapshot, null).find((forecast) => (
        forecast.candidateId === "market-only-control" && forecast.horizon === "1h"
      ));
      const ageUnboundedBlockers = (control?.blockers ?? ["market control unavailable"])
        .filter((blocker) => blocker !== "pair older than 30 days");
      candidates.push({
        chain,
        tokenAddress,
        symbol: market.symbol,
        status: control?.status === "ready" ? "eligible" : "blocked",
        blockers: control?.blockers ?? ["market control unavailable"],
        ageUnboundedStatus: ageUnboundedBlockers.length ? "blocked" : "eligible",
        ageUnboundedBlockers,
        market: {
          observedAt: market.observedAt,
          pairAddress: market.pairAddress,
          pairUrl: market.pairUrl,
          priceUsd: market.priceUsd,
          liquidityUsd: market.liquidityUsd,
          volumeH1Usd: market.volumeUsd?.h1 ?? null,
          priceChangeH1Pct: market.priceChangePct?.h1 ?? null,
          priceChangeH24Pct: market.priceChangePct?.h24 ?? null,
          pairAgeMinutes: market.pairCreatedAt == null
            ? null
            : Math.round((observedAt.getTime() - market.pairCreatedAt) / 60_000),
        },
      });
    } catch (error) {
      candidates.push({
        chain,
        tokenAddress,
        symbol: null,
        status: "error",
        blockers: [error instanceof Error ? error.message : String(error)],
        market: null,
      });
    }
  }

  const event = {
    type: "market-confirmation",
    id: `market_confirmation_${digestValue({
      observedAt: observedAt.toISOString(),
      chain,
      tokens: [...tokens].sort(),
      sourceEventId: options.sourceEventId ?? null,
    }).slice(0, 24)}`,
    observedAt: observedAt.toISOString(),
    chain,
    sourceEventId: options.sourceEventId ?? null,
    attemptedNansenCredits: 0,
    candidates,
  };
  const signed = await appendLedgerEvent(ledgerPath, event);
  return {
    ledgerPath,
    confirmationId: signed.id,
    observedAt: signed.observedAt,
    sourceEventId: signed.sourceEventId,
    eligible: signed.candidates.filter((candidate) => candidate.status === "eligible"),
    ageUnboundedEligible: signed.candidates.filter((candidate) => (
      candidate.ageUnboundedStatus === "eligible"
    )),
    blockedCount: signed.candidates.filter((candidate) => candidate.status === "blocked").length,
    errorCount: signed.candidates.filter((candidate) => candidate.status === "error").length,
    totalCandidates: signed.candidates.length,
  };
}

export async function collectTokenEdgeSnapshots(options, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const clock = dependencies.clock ?? (() => dependencies.now ?? new Date());
  const observedAt = clock();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const chain = options.chain ?? "solana";
  const tokens = [...new Set((options.tokenAddresses ?? []).map((token) => token.trim()).filter(Boolean))];
  if (!tokens.length) throw new Error("At least one explicit token address is required.");
  const nansenProfile = options.nansenProfile ?? "off";
  if (options.selectionConfirmationEventId && options.selectionControlTimeframe) {
    throw new Error("A cohort cannot be both Nansen-selected and an unscreened market control.");
  }
  const budget = nansenBudgetPlan(nansenProfile, tokens.length, options.maxNansenCredits);
  const lunarcrushProfile = options.lunarcrushProfile ?? "off";
  if (!["off", "exact-mint-hourly"].includes(lunarcrushProfile)) {
    throw new Error(`Unknown LunarCrush profile: ${lunarcrushProfile}. Use off or exact-mint-hourly.`);
  }
  const previousEvents = await readLedger(ledgerPath);
  const verification = verifyLedger(previousEvents);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);

  const requestedTokenKeys = new Set(tokens.map(normalizeTokenKey));
  const lunarcrushEvidence = previousEvents.filter((event) => (
    event.type === "lunarcrush-social-snapshot"
    && normalizeTokenKey(event.chain) === normalizeTokenKey(chain)
    && requestedTokenKeys.has(normalizeTokenKey(event.tokenAddress))
    && Date.parse(event.availableAt ?? "") <= observedAt.getTime()
    && Date.parse(event.historyGeneratedAt ?? "") <= observedAt.getTime()
  ));
  const lunarcrushCreatorEvidence = previousEvents.filter((event) => (
    event.type === "lunarcrush-creator-aggregate"
    && normalizeTokenKey(event.chain) === normalizeTokenKey(chain)
    && requestedTokenKeys.has(normalizeTokenKey(event.tokenAddress))
    && Date.parse(event.availableAt ?? event.observedAt ?? "") <= observedAt.getTime()
  ));
  const challengerEvidence = [
    ...lunarcrushEvidence,
    ...lunarcrushCreatorEvidence,
    ...previousEvents.filter((event) => (
      event.type === "discovery"
      && event.provider === "lunarcrush-coin-list"
      && normalizeTokenKey(event.chain) === normalizeTokenKey(chain)
      && event.universe?.complete === true
      && Date.parse(event.availableAt ?? event.observedAt ?? "") <= observedAt.getTime()
    )),
  ];
  const reusedEvidenceCount = lunarcrushEvidence.length;
  let lunarcrush = {
    profile: lunarcrushProfile,
    status: lunarcrushProfile === "off" ? "disabled" : "pending",
    requestBudget: { maximum: 0, attempted: 0, succeeded: 0, failed: 0 },
    universe: null,
    discoveryEventId: null,
    discoveryCandidates: 0,
    monitoringCandidates: 0,
    reusedEvidence: reusedEvidenceCount,
    readyEvidence: 0,
    blockedEvidence: 0,
    readyCreatorAggregates: 0,
    blockedCreatorAggregates: 0,
    error: null,
  };
  if (lunarcrushProfile === "exact-mint-hourly") {
    try {
      let discoveryEventId = null;
      let discoveryCandidates = 0;
      const collected = await collectExactMintLunarCrushEvidence({
        apiKey: options.lunarcrushApiKey,
        chain,
        tokenAddresses: tokens,
        observedAt,
        maxRequests: options.maxLunarcrushRequests ?? 10,
      }, { fetcher, clock });
      if (collected.discovery) {
        const proposedDiscovery = eventWithIntegrity(collected.discovery);
        const existingDiscovery = previousEvents.find((candidate) => (
          candidate.id === collected.discovery.id
        ));
        if (existingDiscovery && existingDiscovery.digest !== proposedDiscovery.digest) {
          throw new Error(`Existing LunarCrush discovery identity mismatch: ${collected.discovery.id}`);
        }
        const signedDiscovery = existingDiscovery
          ?? await appendLedgerEvent(ledgerPath, collected.discovery);
        if (!existingDiscovery) {
          previousEvents.push(signedDiscovery);
          challengerEvidence.push(signedDiscovery);
        }
        discoveryEventId = signedDiscovery.id;
        discoveryCandidates = signedDiscovery.candidates.length;
      }
      for (const event of [...collected.events, ...(collected.creatorEvents ?? [])]) {
        const proposed = eventWithIntegrity(event);
        const existing = previousEvents.find((candidate) => candidate.id === event.id);
        if (existing && existing.digest !== proposed.digest) {
          throw new Error(`Existing LunarCrush evidence identity mismatch: ${event.id}`);
        }
        const signed = existing ?? await appendLedgerEvent(ledgerPath, event);
        if (!existing) previousEvents.push(signed);
        if (signed.type === "lunarcrush-social-snapshot" && !existing) {
          lunarcrushEvidence.push(signed);
          challengerEvidence.push(signed);
        }
        if (signed.type === "lunarcrush-creator-aggregate" && !existing) {
          lunarcrushCreatorEvidence.push(signed);
          challengerEvidence.push(signed);
        }
      }
      lunarcrush = {
        profile: lunarcrushProfile,
        status: "recorded",
        requestBudget: collected.requestBudget,
        universe: collected.universe,
        discoveryEventId,
        discoveryCandidates,
        monitoringCandidates: collected.discovery?.monitoringPanel?.candidates?.length ?? 0,
        reusedEvidence: reusedEvidenceCount,
        readyEvidence: lunarcrushEvidence.filter((event) => event.status === "ready").length,
        blockedEvidence: lunarcrushEvidence.filter((event) => event.status === "blocked").length,
        readyCreatorAggregates: (collected.creatorEvents ?? []).filter((event) => event.status === "ready").length,
        blockedCreatorAggregates: (collected.creatorEvents ?? []).filter((event) => event.status === "blocked").length,
        error: null,
      };
    } catch (error) {
      lunarcrush = {
        ...lunarcrush,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const results = [];
  for (const tokenAddress of tokens) {
    try {
      const market = observedAt.getTime()
        >= Date.parse(TOKEN_EDGE_DEX_EXECUTION_PRICE_INTEGRITY_RULE.appliesFrom)
        ? await fetchDexExecutionMarket(chain, tokenAddress, fetcher, clock)
        : await fetchDexMarket(chain, tokenAddress, fetcher, clock);
      const nansen = await fetchNansenAggregates({
        profile: nansenProfile,
        maxCredits: budget.creditsPerToken,
        apiKey: options.nansenApiKey,
        chain,
        tokenAddress,
        observedAt,
      }, fetcher);
      const decisionAt = evidenceAwareDecisionAt(clock(), challengerEvidence);
      const selection = options.selectionConfirmationEventId
        ? selectionEvidenceFromLedger(
          previousEvents,
          options.selectionConfirmationEventId,
          chain,
          tokenAddress,
          decisionAt,
        )
        : unscreenedControlEvidence(options.selectionControlTimeframe, decisionAt);
      const snapshot = createSnapshotEvent({
        observedAt: decisionAt,
        chain,
        tokenAddress,
        cohort: options.cohort ?? "explicit-token-list",
        selection,
        market,
        nansen,
      });
      if (previousEvents.some((event) => event.id === snapshot.id)) {
        results.push({ tokenAddress, status: "duplicate", snapshotId: snapshot.id });
        continue;
      }
      const prior = latestPriorSnapshot(previousEvents, snapshot);
      const signedSnapshot = await appendLedgerEvent(ledgerPath, snapshot);
      const forecasts = createForecastEvents(
        snapshot,
        prior,
        previousEvents.filter((event) => event.type === "challenger-registration"),
        previousEvents.filter((event) => event.type === "execution-policy-registration"),
        challengerEvidence,
      );
      const signedForecasts = [];
      for (const forecast of forecasts) {
        signedForecasts.push(await appendLedgerEvent(ledgerPath, forecast));
      }
      previousEvents.push(signedSnapshot, ...signedForecasts);
      results.push({
        tokenAddress,
        symbol: market.symbol,
        status: "recorded",
        snapshotId: snapshot.id,
        priorSnapshotId: prior?.id ?? null,
        nansen: {
          status: nansen.status,
          profile: nansen.profile,
          attemptedCredits: nansen.attemptedCredits,
          errors: nansen.errors,
        },
        forecasts: forecasts.map((forecast) => ({
          modelVersion: forecast.modelVersion,
          candidateId: forecast.candidateId,
          horizon: forecast.horizon,
          status: forecast.status,
          blockers: forecast.blockers,
          predictedRise: forecast.predictedRise,
          predictedReturnPct: forecast.predictedReturnPct,
          decision: forecast.decision ?? null,
          evidenceBoundary: forecast.evidenceBoundary ?? null,
          challengerRegistrationId: forecast.challengerRegistrationId ?? null,
          challengerRegisteredAt: forecast.challengerRegisteredAt ?? null,
          executionPolicyRegistrationId: forecast.executionPolicyRegistrationId ?? null,
          executionPolicyRegisteredAt: forecast.executionPolicyRegisteredAt ?? null,
          executionPolicyVersion: forecast.executionPolicyVersion ?? null,
          additionalEvidenceEventId: forecast.additionalEvidenceEventId ?? null,
        })),
      });
    } catch (error) {
      results.push({
        tokenAddress,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { ledgerPath, observedAt: observedAt.toISOString(), budget, lunarcrush, results };
}

function evidenceAwareDecisionAt(now, evidenceEvents = []) {
  const timestamps = [now.getTime()];
  for (const event of evidenceEvents) {
    for (const value of [event.availableAt, event.historyGeneratedAt]) {
      const timestamp = Date.parse(value ?? "");
      if (Number.isFinite(timestamp)) timestamps.push(timestamp);
    }
  }
  return new Date(Math.max(...timestamps));
}

export async function recoverMissedTokenEdgeForecasts(options, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const recoveredAt = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const forecasts = new Map(events
    .filter((event) => event.type === "forecast")
    .map((event) => [event.id, event]));
  const snapshots = new Map(events
    .filter((event) => event.type === "snapshot")
    .map((event) => [event.id, event]));
  const alreadyRecovered = new Set(events
    .filter((event) => event.type === "resolution-recovery")
    .map((event) => event.forecastId));
  const targets = events
    .filter((event) => (
      event.type === "resolution"
      && event.status === "missed"
      && event.reason === "observation-window-expired"
      && !alreadyRecovered.has(event.forecastId)
    ))
    .map((missed) => ({ missed, forecast: forecasts.get(missed.forecastId) }))
    .filter(({ forecast }) => forecast?.status === "ready");
  const timeframe = options.timeframe ?? "1m";
  const timeframeMs = timeframe === "1m" ? 60_000 : timeframe === "5m" ? 5 * 60_000 : null;
  if (!timeframeMs) throw new Error("Nansen OHLCV recovery supports only --timeframe 1m or 5m.");
  const batches = buildOhlcvRecoveryBatches(targets, timeframeMs);
  const requiredCredits = batches.length;
  if (!Number.isFinite(options.maxNansenCredits) || options.maxNansenCredits < requiredCredits) {
    throw new Error(`Nansen OHLCV recovery requires --max-nansen-credits ${requiredCredits}.`);
  }

  const resolutions = [];
  const failures = [];
  let attemptedCredits = 0;
  for (const batch of batches) {
    let result;
    try {
      attemptedCredits += 1;
      result = await fetchNansenOhlcvBatch({
        apiKey: options.nansenApiKey,
        chain: batch.chain,
        tokenAddresses: batch.tokenAddresses,
        timeframe,
        from: batch.from,
        to: batch.to,
      }, fetcher);
    } catch (error) {
      failures.push({
        chain: batch.chain,
        tokenCount: batch.tokenAddresses.length,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const target of batch.targets) {
      const candles = result.candlesByToken.get(normalizeTokenKey(target.forecast.tokenAddress)) ?? [];
      const dueInterval = floorInterval(Date.parse(target.forecast.dueAt), timeframeMs);
      const candle = candles.find((row) => Date.parse(row?.interval_start ?? "") === dueInterval);
      const close = numericValue(candle?.close);
      if (!(close > 0)) {
        failures.push({
          forecastId: target.forecast.id,
          reason: "exact due-minute candle unavailable",
        });
        continue;
      }
      const snapshot = snapshots.get(target.forecast.snapshotId);
      if (!snapshot) throw new Error(`Forecast ${target.forecast.id} references a missing snapshot.`);
      const candleObservedAt = new Date(dueInterval + timeframeMs);
      const observed = resolutionEvent(target.forecast, snapshot, close, candleObservedAt);
      if (observed.status !== "observed") {
        failures.push({ forecastId: target.forecast.id, reason: "historical candle outside forecast tolerance" });
        continue;
      }
      const recovery = {
        ...observed,
        type: "resolution-recovery",
        id: `resolution_recovery_${digestValue({
          forecastId: target.forecast.id,
          missedResolutionId: target.missed.id,
          intervalStart: candle.interval_start,
          provider: `nansen-token-ohlcv-${timeframe}`,
        }).slice(0, 24)}`,
        observationMode: "historical-ohlcv-recovery",
        missedResolutionId: target.missed.id,
        recoveredAt: recoveredAt.toISOString(),
        provider: `nansen-token-ohlcv-${timeframe}`,
        sourceAttribution: NANSEN_ATTRIBUTION,
        candle: {
          timeframe,
          intervalStart: candle.interval_start,
          closedAt: candleObservedAt.toISOString(),
        },
      };
      resolutions.push(await appendLedgerEvent(ledgerPath, recovery));
    }
  }
  return {
    ledgerPath,
    recoveredAt: recoveredAt.toISOString(),
    missedCandidates: targets.length,
    requiredCredits,
    attemptedCredits,
    recovered: resolutions.length,
    failures,
  };
}

export async function recoverMissedFromPoolOhlcv(options, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const recoveredAt = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const forecasts = new Map(events
    .filter((event) => event.type === "forecast")
    .map((event) => [event.id, event]));
  const snapshots = new Map(events
    .filter((event) => event.type === "snapshot")
    .map((event) => [event.id, event]));
  const alreadyRecovered = new Set(events
    .filter((event) => event.type === "resolution-recovery")
    .map((event) => event.forecastId));
  const targets = events
    .filter((event) => (
      event.type === "resolution"
      && event.status === "missed"
      && event.reason === "observation-window-expired"
      && !alreadyRecovered.has(event.forecastId)
    ))
    .map((missed) => ({
      missed,
      forecast: forecasts.get(missed.forecastId),
      snapshot: snapshots.get(missed.snapshotId),
    }))
    .filter(({ forecast, snapshot }) => forecast?.status === "ready" && snapshot?.market?.pairAddress);
  const groups = new Map();
  for (const target of targets) {
    const dueMinute = floorMinute(Date.parse(target.forecast.dueAt));
    const key = canonicalPoolRecoveryKey(target.forecast.chain, target.snapshot.market.pairAddress, dueMinute);
    const entry = groups.get(key) ?? {
      chain: target.forecast.chain,
      pairAddress: target.snapshot.market.pairAddress,
      dueMinute,
      targets: [],
    };
    entry.targets.push(target);
    groups.set(key, entry);
  }
  const requiredRequests = groups.size;
  if (!Number.isFinite(options.maxRequests) || options.maxRequests < requiredRequests) {
    throw new Error(`GeckoTerminal pool OHLCV recovery requires --max-gecko-requests ${requiredRequests}.`);
  }

  const resolutions = [];
  const failures = [];
  let attemptedRequests = 0;
  for (const group of groups.values()) {
    attemptedRequests += 1;
    let candle;
    try {
      candle = await fetchGeckoTerminalDueCandle(group, fetcher);
    } catch (error) {
      failures.push({
        chain: group.chain,
        pairAddress: group.pairAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!candle) {
      failures.push({
        chain: group.chain,
        pairAddress: group.pairAddress,
        reason: "exact due-minute candle unavailable",
      });
      continue;
    }
    for (const target of group.targets) {
      const observedAt = new Date(group.dueMinute + 60_000);
      const observed = resolutionEvent(target.forecast, target.snapshot, candle.close, observedAt);
      if (observed.status !== "observed") {
        failures.push({ forecastId: target.forecast.id, reason: "historical candle outside forecast tolerance" });
        continue;
      }
      const recovery = {
        ...observed,
        type: "resolution-recovery",
        id: `resolution_recovery_${digestValue({
          forecastId: target.forecast.id,
          missedResolutionId: target.missed.id,
          intervalStart: candle.intervalStart,
          provider: "geckoterminal-pool-ohlcv",
          pairAddress: group.pairAddress,
        }).slice(0, 24)}`,
        observationMode: "historical-pool-ohlcv-recovery",
        missedResolutionId: target.missed.id,
        recoveredAt: recoveredAt.toISOString(),
        provider: "geckoterminal-pool-ohlcv",
        sourceAttribution: GECKO_TERMINAL_ATTRIBUTION,
        candle: {
          timeframe: "1m",
          intervalStart: candle.intervalStart,
          closedAt: observedAt.toISOString(),
          pairAddress: group.pairAddress,
          volumeUsd: candle.volumeUsd,
          emptyIntervalFilled: candle.volumeUsd === 0,
        },
      };
      resolutions.push(await appendLedgerEvent(ledgerPath, recovery));
    }
  }
  return {
    ledgerPath,
    recoveredAt: recoveredAt.toISOString(),
    missedCandidates: targets.length,
    requiredRequests,
    attemptedRequests,
    recovered: resolutions.length,
    failures,
  };
}

export async function resolveTokenEdgeForecasts(options, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const due = unresolvedForecasts(events, now);
  const snapshots = new Map(events
    .filter((event) => event.type === "snapshot")
    .map((event) => [event.id, event]));
  const marketByToken = new Map();
  const resolutions = [];

  for (const forecast of due) {
    const snapshot = snapshots.get(forecast.snapshotId);
    if (!snapshot) throw new Error(`Forecast ${forecast.id} references a missing snapshot.`);
    if (now.getTime() > Date.parse(forecast.dueAt) + TOKEN_EDGE_MAX_EXACT_LIVE_LAG_MS) {
      const missed = missedResolutionEvent(forecast, now, "observation-window-expired");
      resolutions.push(await appendLedgerEvent(ledgerPath, missed));
      continue;
    }
    const tokenKey = `${forecast.chain}:${forecast.tokenAddress}`;
    let market = marketByToken.get(tokenKey);
    if (!market) {
      try {
        market = await fetchDexExecutionMarket(
          forecast.chain,
          forecast.tokenAddress,
          fetcher,
          now,
        );
        marketByToken.set(tokenKey, market);
      } catch {
        continue;
      }
    }
    const resolution = {
      ...resolutionEvent(forecast, snapshot, market.priceUsd, now, market),
      providerPriceIntegrity: market.providerPriceIntegrity,
    };
    resolutions.push(await appendLedgerEvent(ledgerPath, resolution));
  }
  return {
    ledgerPath,
    checkedAt: now.toISOString(),
    dueForecasts: due.length,
    recordedResolutions: resolutions.length,
    observed: resolutions.filter((event) => event.status === "observed").length,
    missed: resolutions.filter((event) => event.status === "missed").length,
  };
}

export async function recordOpenForecastPathObservations(options = {}, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const targetOptions = {
    horizon: options.horizon ?? "1h",
    maximumTargets: options.maxTokens ?? 20,
    modelVersion: options.modelVersion ?? null,
    candidateId: options.candidateId ?? null,
    selectionProvider: options.selectionProvider ?? null,
    selectionTimeframe: options.selectionTimeframe ?? null,
    createdAfter: options.createdAfter ?? null,
  };
  const bucketStartedAt = new Date(
    Math.floor(now.getTime() / (5 * 60_000)) * (5 * 60_000),
  ).toISOString();
  const lockPath = path.join(
    path.dirname(ledgerPath),
    `.forecast-path-${digestValue({ bucketStartedAt, ...targetOptions }).slice(0, 24)}.lock`,
  );
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      return pathObservationResult(ledgerPath, now, targetOptions.horizon, [], new Set(), []);
    }
    throw error;
  }
  try {
    const events = await readLedger(ledgerPath);
    const verification = verifyLedger(events);
    if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
    const targets = buildPendingPathObservationTargets(events, now, targetOptions);
    const marketByToken = new Map();
    const attemptedTokenKeys = new Set();
    const observations = [];
    const failures = [];
    for (const target of targets) {
      const tokenKey = `${target.chain}:${target.tokenAddress}`;
      let market = marketByToken.get(tokenKey);
      if (!market) {
        if (attemptedTokenKeys.has(tokenKey)) continue;
        attemptedTokenKeys.add(tokenKey);
        try {
          market = await fetchDexExecutionMarket(target.chain, target.tokenAddress, fetcher, now);
          marketByToken.set(tokenKey, market);
        } catch (error) {
          failures.push({
            chain: target.chain,
            tokenAddress: target.tokenAddress,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }
      const event = createPathObservationEvent(target, market, now);
      observations.push(await appendLedgerEvent(ledgerPath, event));
    }
    return pathObservationResult(
      ledgerPath,
      now,
      targetOptions.horizon,
      targets,
      attemptedTokenKeys,
      failures,
      observations,
    );
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

function pathObservationResult(
  ledgerPath,
  now,
  horizon,
  targets,
  attemptedTokenKeys,
  failures,
  observations = [],
) {
  return {
    ledgerPath,
    observedAt: now.toISOString(),
    horizon,
    pendingTargets: targets.length,
    requiredRequests: attemptedTokenKeys.size * 2,
    recordedObservations: observations.length,
    failures,
    observations: observations.map((event) => ({
      id: event.id,
      snapshotId: event.snapshotId,
      tokenAddress: event.tokenAddress,
      symbol: event.symbol,
      bucketStartedAt: event.bucketStartedAt,
      grossReturnFromEntryPct: event.grossReturnFromEntryPct,
      observedLiquidityUsd: event.observedLiquidityUsd,
      forecastCount: event.forecastIds.length,
    })),
  };
}

export async function inspectTokenEdgeLedger(ledgerPath = defaultTokenEdgeLedgerPath()) {
  const absolutePath = path.resolve(ledgerPath);
  const events = await readLedger(absolutePath);
  const verification = verifyLedger(events);
  const scorecard = verification.ok ? buildScorecard(events) : null;
  const retrospective = verification.ok ? buildRetrospectiveReport(events) : null;
  return {
    ledgerPath: absolutePath,
    verification,
    eventCounts: countBy(events, (event) => event.type ?? "unknown"),
    scorecard,
    retrospective,
  };
}

export async function registerTokenEdgeChallengers(options = {}, dependencies = {}) {
  const registeredAt = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const existingById = new Map(events
    .filter((event) => event.type === "challenger-registration")
    .map((event) => [event.id, event]));
  const registrations = createChallengerRegistrationEvents(registeredAt);
  const appended = [];
  for (const registration of registrations) {
    if (existingById.has(registration.id)) continue;
    appended.push(await appendLedgerEvent(ledgerPath, registration));
  }
  const effectiveRegistrations = registrations.map((registration) => (
    existingById.get(registration.id)
      ?? appended.find((event) => event.id === registration.id)
      ?? registration
  ));
  const latestRegisteredAt = effectiveRegistrations.map((registration) => registration.registeredAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? registeredAt.toISOString();
  return {
    ledgerPath,
    registeredAt: latestRegisteredAt,
    totalFrozenChallengers: registrations.length,
    appendedRegistrations: appended.length,
    registrations: effectiveRegistrations.map((registration) => ({
      id: registration.id,
      registeredAt: registration.registeredAt,
      modelVersion: registration.modelVersion,
      candidateId: registration.candidateId,
      evidenceBoundary: registration.evidenceBoundary,
      changedDimension: registration.changedDimension,
      status: registration.status,
    })),
  };
}

export async function registerTokenEdgeExecutionPolicy(options = {}, dependencies = {}) {
  const registeredAt = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const existingById = new Map(events
    .filter((event) => event.type === "execution-policy-registration")
    .map((event) => [event.id, event]));
  const registrations = createExecutionPolicyRegistrationEvents(registeredAt);
  const appended = [];
  for (const registration of registrations) {
    if (existingById.has(registration.id)) continue;
    appended.push(await appendLedgerEvent(ledgerPath, registration));
  }
  const effectiveRegistrations = registrations.map((registration) => (
    existingById.get(registration.id)
      ?? appended.find((event) => event.id === registration.id)
      ?? registration
  ));
  return {
    ledgerPath,
    registeredAt: effectiveRegistrations[0]?.registeredAt ?? registeredAt.toISOString(),
    totalFrozenExecutionPolicies: registrations.length,
    appendedRegistrations: appended.length,
    registrations: effectiveRegistrations.map((registration) => ({
      id: registration.id,
      registeredAt: registration.registeredAt,
      policyVersion: registration.policyVersion,
      paperNotionalUsd: registration.paperNotionalUsd,
      baseRoundTripCostPct: registration.baseRoundTripCostPct,
      stressRoundTripCostPct: registration.stressRoundTripCostPct,
      ammImpactModel: registration.ammImpactModel,
      status: registration.status,
    })),
  };
}

export async function recordTokenEdgeRetrospectives(options = {}, dependencies = {}) {
  const reviewedAt = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const pending = buildPendingRetrospectives(events, reviewedAt);
  const appended = [];
  for (const event of pending) appended.push(await appendLedgerEvent(ledgerPath, event));
  const augmented = [...events, ...appended];
  const review = buildEvolutionReviewEvent(augmented, reviewedAt);
  const appendedReview = review ? await appendLedgerEvent(ledgerPath, review) : null;
  const finalEvents = appendedReview ? [...augmented, appendedReview] : augmented;
  return {
    ledgerPath,
    reviewedAt: reviewedAt.toISOString(),
    appendedRetrospectives: appended.length,
    appendedEvolutionReview: Boolean(appendedReview),
    report: buildRetrospectiveReport(finalEvents),
  };
}

function nansenBody(name, chain, tokenAddress, date) {
  const common = {
    chain,
    token_address: tokenAddress,
    date,
    pagination: { page: 1, per_page: 25 },
  };
  if (name === "tokenInformation" || name === "flowIntelligence") {
    return { chain, token_address: tokenAddress, timeframe: "1d" };
  }
  if (name === "holders") {
    return {
      chain,
      token_address: tokenAddress,
      aggregate_by_entity: false,
      label_type: "all_holders",
      filters: {},
      pagination: { page: 1, per_page: 25 },
      order_by: [{ field: "token_amount", direction: "DESC" }],
    };
  }
  if (name === "pnlLeaderboard") {
    return {
      ...common,
      filters: { holding_usd: { min: 100 } },
      order_by: [{ field: "pnl_usd_realised", direction: "DESC" }],
    };
  }
  if (name === "whoBought" || name === "whoSold") {
    return {
      ...common,
      buy_or_sell: name === "whoBought" ? "BUY" : "SELL",
    };
  }
  return common;
}

function selectionEvidenceFromLedger(events, confirmationEventId, chain, tokenAddress, snapshotObservedAt) {
  if (!confirmationEventId) return null;
  const confirmation = events.find((event) => (
    event.type === "market-confirmation" && event.id === confirmationEventId
  ));
  if (!confirmation) throw new Error(`Selection confirmation ${confirmationEventId} was not found.`);
  const confirmed = confirmation.candidates?.find((candidate) => (
    candidate.chain === chain
    && normalizeTokenKey(candidate.tokenAddress) === normalizeTokenKey(tokenAddress)
  ));
  if (confirmed?.status !== "eligible" && confirmed?.ageUnboundedStatus !== "eligible") {
    throw new Error(`Token ${tokenAddress} did not pass the linked DEX confirmation.`);
  }
  const discovery = events.find((event) => (
    event.type === "discovery" && event.id === confirmation.sourceEventId
  ));
  if (!discovery) throw new Error(`Selection discovery ${confirmation.sourceEventId ?? "<missing>"} was not found.`);
  const selected = discovery.candidates?.find((candidate) => (
    candidate.chain === chain
    && normalizeTokenKey(candidate.tokenAddress) === normalizeTokenKey(tokenAddress)
  ));
  if (selected?.status !== "eligible") {
    throw new Error(`Token ${tokenAddress} did not pass the linked Nansen discovery.`);
  }
  const maximumAgeMs = selectionMaximumAgeMs(discovery.timeframe);
  const discoveryAtMs = Date.parse(discovery.observedAt ?? "");
  const discoveryAvailableAt = discovery.availableAt ?? discovery.observedAt;
  const discoveryAvailableAtMs = Date.parse(discoveryAvailableAt ?? "");
  const confirmationAtMs = Date.parse(confirmation.observedAt ?? "");
  const snapshotAtMs = Date.parse(snapshotObservedAt ?? "");
  if (![discoveryAtMs, discoveryAvailableAtMs, confirmationAtMs, snapshotAtMs].every(Number.isFinite)) {
    throw new Error("Selection lineage has an invalid observation timestamp.");
  }
  if (discoveryAvailableAtMs < discoveryAtMs
    || confirmationAtMs < discoveryAvailableAtMs
    || snapshotAtMs < confirmationAtMs) {
    throw new Error("Selection lineage timestamps are out of order.");
  }
  if (snapshotAtMs - discoveryAtMs > maximumAgeMs) {
    throw new Error(`Selection discovery ${discovery.id} is stale for timeframe ${discovery.timeframe}.`);
  }
  return {
    status: "verified",
    provider: discovery.provider,
    timeframe: discovery.timeframe,
    ruleVersion: discovery.ruleVersion ?? null,
    discoveryEventId: discovery.id,
    confirmationEventId: confirmation.id,
    discoveryObservedAt: discovery.observedAt,
    discoveryAvailableAt,
    confirmationObservedAt: confirmation.observedAt,
    metrics: {
      netflowUsd: selected.netflowUsd ?? null,
      netflowToLiquidity: selected.netflowToLiquidity ?? null,
      buySellVolumeRatio: selected.buySellVolumeRatio ?? null,
      priceChangePct: selected.priceChangePct ?? null,
      discoveryLiquidityUsd: selected.liquidityUsd ?? null,
      confirmedLiquidityUsd: confirmed.market?.liquidityUsd ?? null,
      confirmedPriceChangeH1Pct: confirmed.market?.priceChangeH1Pct ?? null,
      confirmationAgeUnboundedStatus: confirmed.ageUnboundedStatus ?? null,
      confirmationAgeUnboundedBlockers: confirmed.ageUnboundedBlockers ?? null,
      lunarcrushCoinId: selected.lunarcrushCoinId ?? null,
      marketCapUsd: selected.marketCapUsd ?? null,
      volume24hUsd: selected.volume24hUsd ?? null,
      interactions24h: selected.interactions24h ?? null,
      socialVolume24h: selected.socialVolume24h ?? null,
      altRank: selected.altRank ?? null,
      altRankPrevious: selected.altRankPrevious ?? null,
      altRankImprovement: selected.altRankImprovement ?? null,
      galaxyScore: selected.galaxyScore ?? null,
      galaxyScorePrevious: selected.galaxyScorePrevious ?? null,
      galaxyScoreImprovement: selected.galaxyScoreImprovement ?? null,
      priceChange1hPct: selected.priceChange1hPct ?? selected.priceChangeH1Pct ?? null,
      priceChange24hPct: selected.priceChange24hPct ?? selected.priceChangeH24Pct ?? null,
      sourceTypes: selected.sourceTypes ?? null,
      sourceBreadth: selected.sourceBreadth ?? null,
      latestSourceTimestamp: selected.latestSourceTimestamp ?? null,
      latestBoostAmount: selected.latestBoostAmount ?? null,
      totalBoostAmount: selected.totalBoostAmount ?? null,
      hasWebsite: selected.hasWebsite ?? null,
      hasTwitter: selected.hasTwitter ?? null,
      pairAgeMinutes: selected.pairAgeMinutes ?? null,
      volumeH1Usd: selected.volumeH1Usd ?? null,
      hourlyTurnover: selected.hourlyTurnover ?? null,
      buysH1: selected.buysH1 ?? null,
      sellsH1: selected.sellsH1 ?? null,
      buySellTxnRatio: selected.buySellTxnRatio ?? null,
    },
  };
}

function selectionMaximumAgeMs(timeframe) {
  const values = {
    "5m": 15 * 60_000,
    "10m": 30 * 60_000,
    "1h": 60 * 60_000,
    "6h": 6 * 60 * 60_000,
    "24h": 24 * 60 * 60_000,
  };
  const value = values[timeframe];
  if (!value) throw new Error(`Unsupported selection timeframe: ${timeframe}.`);
  return value;
}

function unscreenedControlEvidence(timeframe, observedAt) {
  if (!timeframe) return null;
  selectionMaximumAgeMs(timeframe);
  return {
    status: "control",
    provider: "unscreened-market-control",
    timeframe,
    observedAt: observedAt.toISOString(),
    discoveryEventId: null,
    confirmationEventId: null,
    metrics: null,
  };
}

async function fetchGeckoTerminalDueCandle(group, fetcher) {
  const beforeTimestamp = Math.floor(group.dueMinute / 1_000) + 180;
  const url = new URL(
    `${GECKO_TERMINAL_BASE_URL}/networks/${encodeURIComponent(group.chain)}`
    + `/pools/${encodeURIComponent(group.pairAddress)}/ohlcv/minute`,
  );
  url.searchParams.set("aggregate", "1");
  url.searchParams.set("before_timestamp", String(beforeTimestamp));
  url.searchParams.set("limit", "10");
  url.searchParams.set("currency", "usd");
  url.searchParams.set("token", "base");
  url.searchParams.set("include_empty_intervals", "true");
  const response = await fetcher(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GeckoTerminal pool OHLCV returned HTTP ${response.status}.`);
  const payload = await response.json();
  const rows = payload?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(rows)) return null;
  const dueSeconds = Math.floor(group.dueMinute / 1_000);
  const row = rows.find((item) => Array.isArray(item) && Number(item[0]) === dueSeconds);
  const close = numericValue(row?.[4]);
  if (!(close > 0)) return null;
  return {
    intervalStart: new Date(dueSeconds * 1_000).toISOString(),
    close,
    volumeUsd: numericValue(row?.[5]),
  };
}

function canonicalPoolRecoveryKey(chain, pairAddress, dueMinute) {
  return `${chain}:${pairAddress}:${dueMinute}`;
}

function buildOhlcvRecoveryBatches(targets, timeframeMs) {
  const groups = new Map();
  for (const target of targets) {
    const dueAt = Date.parse(target.forecast.dueAt);
    const bucketStart = Math.floor(dueAt / (6 * 60 * 60_000)) * 6 * 60 * 60_000;
    const key = `${target.forecast.chain}:${bucketStart}`;
    const values = groups.get(key) ?? [];
    values.push(target);
    groups.set(key, values);
  }
  const batches = [];
  for (const group of groups.values()) {
    const chain = group[0].forecast.chain;
    const tokenAddresses = [...new Set(group.map(({ forecast }) => forecast.tokenAddress))];
    for (let index = 0; index < tokenAddresses.length; index += 5) {
      const chunk = tokenAddresses.slice(index, index + 5);
      const chunkKeys = new Set(chunk.map(normalizeTokenKey));
      const chunkTargets = group.filter(({ forecast }) => chunkKeys.has(normalizeTokenKey(forecast.tokenAddress)));
      const dueIntervals = chunkTargets.map(({ forecast }) => (
        floorInterval(Date.parse(forecast.dueAt), timeframeMs)
      ));
      batches.push({
        chain,
        tokenAddresses: chunk,
        targets: chunkTargets,
        from: new Date(Math.min(...dueIntervals)).toISOString(),
        to: new Date(Math.max(...dueIntervals) + 2 * timeframeMs).toISOString(),
      });
    }
  }
  return batches;
}

function floorMinute(value) {
  return floorInterval(value, 60_000);
}

function floorInterval(value, intervalMs) {
  return Math.floor(value / intervalMs) * intervalMs;
}

function normalizeTokenKey(value) {
  const token = String(value ?? "").trim();
  return /^0x[0-9a-f]{40}$/i.test(token) ? token.toLowerCase() : token;
}

function dateRangeHours(now, hours) {
  const date = now instanceof Date ? now : new Date(now);
  return {
    from: new Date(date.getTime() - hours * 60 * 60_000).toISOString(),
    to: date.toISOString(),
  };
}

function countBy(values, keyOf) {
  const result = {};
  for (const value of values) {
    const key = keyOf(value);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function discoveryBlockers(candidate) {
  const blockers = [];
  if (!(Number.isFinite(candidate.tokenAgeDays) && candidate.tokenAgeDays >= 0 && candidate.tokenAgeDays <= 30)) {
    blockers.push("token age outside 0-30 days");
  }
  if (!(candidate.liquidityUsd >= 10_000)) blockers.push("liquidity below $10,000");
  if (!(candidate.marketCapUsd >= 50_000 && candidate.marketCapUsd <= 20_000_000)) {
    blockers.push("market cap outside $50,000-$20,000,000");
  }
  if (!(candidate.buyVolumeUsd >= 1_000)) blockers.push("buy volume below $1,000");
  if (!(candidate.buyVolumeUsd > candidate.sellVolumeUsd)) blockers.push("buy volume does not exceed sell volume");
  if (!(candidate.netflowUsd > 0)) blockers.push("smart-money netflow is not positive");
  if (candidate.priceChangePct == null) blockers.push("missing point-in-time price change");
  else if (candidate.priceChangePct > 25) blockers.push("already rose more than 25% in the discovery window");
  return blockers;
}

function numericValue(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return Math.round((numerator / denominator) * 1_000_000) / 1_000_000;
}

function parseArguments(args) {
  const command = args[0] ?? "inspect";
  const options = new Map();
  for (let index = 1; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${key} requires a value.`);
    options.set(key, value);
    index += 1;
  }
  return { command, options };
}

function option(map, key) {
  return map.get(key);
}

async function main(args) {
  const parsed = parseArguments(args);
  const ledgerPath = option(parsed.options, "--ledger") ?? defaultTokenEdgeLedgerPath();
  if (parsed.command === "discover") {
    const maxNansenCreditsRaw = option(parsed.options, "--max-nansen-credits");
    print(await recordNansenDiscovery({
      ledgerPath,
      chain: option(parsed.options, "--chain") ?? "solana",
      timeframe: option(parsed.options, "--timeframe") ?? "1h",
      maxNansenCredits: maxNansenCreditsRaw == null ? Number.NaN : Number(maxNansenCreditsRaw),
      nansenApiKey: process.env.NANSEN_API_KEY,
    }));
    return;
  }
  if (parsed.command === "collect") {
    const tokenAddresses = (option(parsed.options, "--tokens") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const nansenProfile = option(parsed.options, "--nansen-profile") ?? "off";
    const maxNansenCreditsRaw = option(parsed.options, "--max-nansen-credits");
    const maxLunarcrushRequestsRaw = option(parsed.options, "--max-lunarcrush-requests");
    const result = await collectTokenEdgeSnapshots({
      ledgerPath,
      chain: option(parsed.options, "--chain") ?? "solana",
      tokenAddresses,
      cohort: option(parsed.options, "--cohort") ?? "explicit-token-list",
      selectionConfirmationEventId: option(parsed.options, "--selection-confirmation-id") ?? null,
      selectionControlTimeframe: option(parsed.options, "--selection-control-timeframe") ?? null,
      nansenProfile,
      maxNansenCredits: maxNansenCreditsRaw == null ? Number.NaN : Number(maxNansenCreditsRaw),
      nansenApiKey: process.env.NANSEN_API_KEY,
      lunarcrushProfile: option(parsed.options, "--lunarcrush-profile") ?? "off",
      maxLunarcrushRequests: maxLunarcrushRequestsRaw == null ? 10 : Number(maxLunarcrushRequestsRaw),
      lunarcrushApiKey: process.env.LUNARCRUSH_API_KEY,
    });
    print(result);
    return;
  }
  if (parsed.command === "confirm") {
    const tokenAddresses = (option(parsed.options, "--tokens") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    print(await recordDexCandidateConfirmation({
      ledgerPath,
      chain: option(parsed.options, "--chain") ?? "solana",
      tokenAddresses,
      sourceEventId: option(parsed.options, "--source-event-id") ?? null,
    }));
    return;
  }
  if (parsed.command === "resolve") {
    print(await resolveTokenEdgeForecasts({ ledgerPath }));
    return;
  }
  if (parsed.command === "mark-open") {
    const maxTokensRaw = option(parsed.options, "--max-tokens");
    print(await recordOpenForecastPathObservations({
      ledgerPath,
      horizon: option(parsed.options, "--horizon") ?? "1h",
      maxTokens: maxTokensRaw == null ? 20 : Number(maxTokensRaw),
      modelVersion: option(parsed.options, "--model-version") ?? null,
      candidateId: option(parsed.options, "--candidate-id") ?? null,
      selectionProvider: option(parsed.options, "--selection-provider") ?? null,
      selectionTimeframe: option(parsed.options, "--selection-timeframe") ?? null,
      createdAfter: option(parsed.options, "--created-after") ?? null,
    }));
    return;
  }
  if (parsed.command === "retrospect") {
    print(await recordTokenEdgeRetrospectives({ ledgerPath }));
    return;
  }
  if (parsed.command === "register-challengers") {
    print(await registerTokenEdgeChallengers({ ledgerPath }));
    return;
  }
  if (parsed.command === "register-execution-policy") {
    print(await registerTokenEdgeExecutionPolicy({ ledgerPath }));
    return;
  }
  if (parsed.command === "recover") {
    const maxNansenCreditsRaw = option(parsed.options, "--max-nansen-credits");
    print(await recoverMissedTokenEdgeForecasts({
      ledgerPath,
      maxNansenCredits: maxNansenCreditsRaw == null ? Number.NaN : Number(maxNansenCreditsRaw),
      timeframe: option(parsed.options, "--timeframe") ?? "1m",
      nansenApiKey: process.env.NANSEN_API_KEY,
    }));
    return;
  }
  if (parsed.command === "recover-pool") {
    const maxRequestsRaw = option(parsed.options, "--max-gecko-requests");
    print(await recoverMissedFromPoolOhlcv({
      ledgerPath,
      maxRequests: maxRequestsRaw == null ? Number.NaN : Number(maxRequestsRaw),
    }));
    return;
  }
  if (parsed.command === "inspect" || parsed.command === "scorecard") {
    print(await inspectTokenEdgeLedger(ledgerPath));
    return;
  }
  if (parsed.command === "evolve") {
    const inspected = await inspectTokenEdgeLedger(ledgerPath);
    if (!inspected.scorecard) throw new Error("Cannot evolve an invalid ledger.");
    print(buildEvolutionReadiness(
      inspected.scorecard,
      option(parsed.options, "--candidate") ?? "combined-onchain",
      option(parsed.options, "--horizon") ?? "1h",
    ));
    return;
  }
  throw new Error(
    "Usage: onchain-forward-research.mjs discover --max-nansen-credits 1 [--chain solana --timeframe 1h] [--ledger PATH] | confirm --tokens A,B [--chain solana --source-event-id ID --ledger PATH] | collect --tokens A,B [--chain solana --selection-confirmation-id ID | --selection-control-timeframe 1h] [--nansen-profile off|core|full --max-nansen-credits N] [--lunarcrush-profile off|exact-mint-hourly --max-lunarcrush-requests 10] [--ledger PATH] | resolve [--ledger PATH] | mark-open [--horizon 1h --max-tokens 20 --model-version VERSION --candidate-id ID --selection-provider PROVIDER --selection-timeframe TIMEFRAME --created-after ISO --ledger PATH] | retrospect [--ledger PATH] | register-challengers [--ledger PATH] | register-execution-policy [--ledger PATH] | recover --max-nansen-credits N [--timeframe 1m|5m --ledger PATH] | recover-pool --max-gecko-requests N [--ledger PATH] | inspect [--ledger PATH] | evolve [--candidate ID --horizon 1h|6h|24h] [--ledger PATH]",
  );
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
