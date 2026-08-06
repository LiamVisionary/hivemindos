#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  appendLedgerEvent,
  digestValue,
  marketSnapshotFromDexPair,
  readLedger,
  selectDeepestTokenPair,
  verifyLedger,
} from "./onchain-forward-core.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";
import { DEX_EARLY_SURFACE_RULE } from "./onchain-dex-early-rule.mjs";

const DEX_SCREENER_BASE_URL = "https://api.dexscreener.com";
const SURFACE_ENDPOINTS = Object.freeze([
  ["profile-latest", "/token-profiles/latest/v1"],
  ["community-takeover-latest", "/community-takeovers/latest/v1"],
  ["ad-latest", "/ads/latest/v1"],
  ["boost-latest", "/token-boosts/latest/v1"],
  ["boost-top", "/token-boosts/top/v1"],
]);

export { DEX_EARLY_SURFACE_RULE } from "./onchain-dex-early-rule.mjs";

export async function collectDexEarlySurfaceDiscovery(options = {}, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const clock = dependencies.clock ?? (() => dependencies.now ?? new Date());
  const ledgerPath = options.ledgerPath ?? defaultTokenEdgeLedgerPath();
  const collectionStartedAt = clock().toISOString();
  const priorEvents = await readLedger(ledgerPath);
  const verification = verifyLedger(priorEvents);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  const cadenceBucket = Math.floor(Date.parse(collectionStartedAt) / (5 * 60_000));
  const existing = priorEvents.filter((event) => (
    event.type === "discovery"
    && event.provider === "dexscreener-early-surface"
    && Math.floor(Date.parse(event.observedAt ?? "") / (5 * 60_000)) === cadenceBucket
  )).sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];
  if (existing) {
    const actionableCandidates = existing.actionableCandidates
      ?? actionableDexEarlySurfaceCandidates(existing.candidates ?? [], priorEvents);
    return {
      ledgerPath,
      status: "skipped-existing-cadence",
      discoveryEventId: existing.id,
      observedAt: existing.observedAt,
      evaluatedTokens: existing.evaluatedTokens,
      eligibleBeforeCap: existing.eligibleBeforeCap,
      candidates: existing.candidates,
      actionableCandidates,
      suppressedCandidateCount: existing.suppressedCandidateCount
        ?? ((existing.candidates?.length ?? 0) - actionableCandidates.length),
      rejectionCounts: existing.rejectionCounts,
      requestsAttempted: 0,
    };
  }

  const responses = await Promise.all(SURFACE_ENDPOINTS.map(async ([source, endpoint]) => {
    const response = await fetcher(`${DEX_SCREENER_BASE_URL}${endpoint}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`DEX Screener ${source} returned HTTP ${response.status}.`);
    const payload = await response.json();
    return { source, endpoint, rows: Array.isArray(payload) ? payload : [payload] };
  }));

  const byToken = new Map();
  for (const response of responses) {
    for (const row of response.rows) {
      if (row?.chainId !== "solana" || typeof row?.tokenAddress !== "string" || !row.tokenAddress.trim()) continue;
      const tokenAddress = row.tokenAddress.trim();
      const state = byToken.get(tokenAddress) ?? {
        tokenAddress,
        sources: new Set(),
        latestSourceTimestamp: null,
        latestBoostAmount: 0,
        totalBoostAmount: 0,
        hasWebsite: false,
        hasTwitter: false,
      };
      state.sources.add(response.source);
      const sourceTimestamp = firstIso(row.updatedAt, row.claimDate, row.date);
      if (sourceTimestamp && (!state.latestSourceTimestamp || sourceTimestamp > state.latestSourceTimestamp)) {
        state.latestSourceTimestamp = sourceTimestamp;
      }
      state.latestBoostAmount = Math.max(state.latestBoostAmount, number(row.amount));
      state.totalBoostAmount = Math.max(state.totalBoostAmount, number(row.totalAmount));
      const links = Array.isArray(row.links) ? row.links : [];
      state.hasWebsite ||= links.some((link) => !link?.type && safeHttp(link?.url));
      state.hasTwitter ||= links.some((link) => link?.type === "twitter" && safeHttp(link?.url));
      byToken.set(tokenAddress, state);
    }
  }

  const tokenAddresses = [...byToken.keys()];
  const pairRows = [];
  for (const batch of chunks(tokenAddresses, 30)) {
    const response = await fetcher(
      `${DEX_SCREENER_BASE_URL}/tokens/v1/solana/${batch.map(encodeURIComponent).join(",")}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) throw new Error(`DEX Screener token batch returned HTTP ${response.status}.`);
    const payload = await response.json();
    if (Array.isArray(payload)) pairRows.push(...payload);
  }

  const observedAt = clock();
  const evaluated = tokenAddresses.map((tokenAddress) => {
    const surface = byToken.get(tokenAddress);
    const pair = selectDeepestTokenPair(pairRows, tokenAddress);
    const market = marketSnapshotFromDexPair(pair, tokenAddress, observedAt);
    const blockers = earlySurfaceBlockers(market, observedAt);
    const hourlyTurnover = ratio(market?.volumeUsd?.h1, market?.liquidityUsd);
    const buySellTxnRatio = ratio(market?.txns?.h1?.buys, market?.txns?.h1?.sells);
    const fiveMinuteTurnover = ratio(market?.volumeUsd?.m5, market?.liquidityUsd);
    const fiveMinuteBuySellTxnRatio = ratio(
      market?.txns?.m5?.buys,
      market?.txns?.m5?.sells,
    );
    return {
      chain: "solana",
      tokenAddress,
      symbol: market?.symbol ?? null,
      status: blockers.length ? "blocked" : "eligible",
      blockers,
      sourceTypes: [...surface.sources].sort(),
      sourceBreadth: surface.sources.size,
      latestSourceTimestamp: surface.latestSourceTimestamp,
      latestBoostAmount: surface.latestBoostAmount,
      totalBoostAmount: surface.totalBoostAmount,
      hasWebsite: surface.hasWebsite,
      hasTwitter: surface.hasTwitter,
      pairAddress: market?.pairAddress ?? null,
      pairAgeMinutes: market?.pairCreatedAt == null
        ? null
        : Math.round((observedAt.getTime() - market.pairCreatedAt) / 60_000),
      priceUsd: market?.priceUsd ?? null,
      liquidityUsd: market?.liquidityUsd ?? null,
      marketCapUsd: market?.marketCapUsd ?? market?.fdvUsd ?? null,
      volumeH1Usd: market?.volumeUsd?.h1 ?? null,
      hourlyTurnover,
      volumeM5Usd: market?.volumeUsd?.m5 ?? null,
      fiveMinuteTurnover,
      buysH1: market?.txns?.h1?.buys ?? null,
      sellsH1: market?.txns?.h1?.sells ?? null,
      buySellTxnRatio,
      buysM5: market?.txns?.m5?.buys ?? null,
      sellsM5: market?.txns?.m5?.sells ?? null,
      fiveMinuteBuySellTxnRatio,
      priceChangeM5Pct: market?.priceChangePct?.m5 ?? null,
      priceChangeH1Pct: market?.priceChangePct?.h1 ?? null,
      priceChangeH24Pct: market?.priceChangePct?.h24 ?? null,
      ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    };
  });
  const candidates = evaluated
    .filter((candidate) => candidate.status === "eligible")
    .sort(compareCandidates)
    .slice(0, DEX_EARLY_SURFACE_RULE.maximumCandidates);
  const actionableCandidates = actionableDexEarlySurfaceCandidates(candidates, priorEvents);

  const event = {
    type: "discovery",
    provider: "dexscreener-early-surface",
    sourceAttribution: "DEX Screener public API",
    chain: "solana",
    timeframe: "5m",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    rule: DEX_EARLY_SURFACE_RULE,
    collectionStartedAt,
    availableAt: observedAt.toISOString(),
    observedAt: observedAt.toISOString(),
    sourceSummary: responses.map(({ source, endpoint, rows }) => ({
      source,
      endpoint,
      returnedRows: rows.length,
      solanaRows: rows.filter((row) => row?.chainId === "solana").length,
    })),
    evaluatedTokens: evaluated.length,
    eligibleBeforeCap: evaluated.filter((candidate) => candidate.status === "eligible").length,
    rejectionCounts: countValues(evaluated.flatMap((candidate) => candidate.blockers)),
    candidates,
    actionableCandidates,
    suppressedCandidateCount: candidates.length - actionableCandidates.length,
    researchOnly: true,
    mutationAllowed: false,
  };
  event.id = `discovery_${digestValue({
    provider: event.provider,
    observedAt: event.observedAt,
    candidates: candidates.map((candidate) => candidate.tokenAddress),
  }).slice(0, 24)}`;
  const signed = await appendLedgerEvent(ledgerPath, event);
  return {
    ledgerPath,
    status: "recorded",
    discoveryEventId: signed.id,
    observedAt: signed.observedAt,
    evaluatedTokens: signed.evaluatedTokens,
    eligibleBeforeCap: signed.eligibleBeforeCap,
    candidates: signed.candidates,
    actionableCandidates: signed.actionableCandidates,
    suppressedCandidateCount: signed.suppressedCandidateCount,
    rejectionCounts: signed.rejectionCounts,
    requestsAttempted: responses.length + Math.ceil(tokenAddresses.length / 30),
  };
}

export function actionableDexEarlySurfaceCandidates(candidates, events) {
  const resolvedForecastIds = new Set(events
    .filter((event) => event.type === "resolution" || event.type === "resolution-recovery")
    .map((event) => event.forecastId));
  const openTokenKeys = new Set(events.filter((event) => (
    event.type === "forecast"
    && event.modelVersion === "frozen-onchain-rank-v11-dex-early-surface"
    && event.candidateId === "dex-early-surface-rise"
    && event.horizon === "1h"
    && event.status === "ready"
    && event.predictedRise === true
    && !resolvedForecastIds.has(event.id)
  )).map((event) => `${event.chain}:${event.tokenAddress}`));
  const priorSurfaceSignatures = new Set(events.filter((event) => (
    event.type === "discovery" && event.provider === "dexscreener-early-surface"
  )).flatMap((event) => (event.candidates ?? []).map((candidate) => (
    `${candidate.chain}:${candidate.tokenAddress}:${surfaceSignature(candidate)}`
  ))));
  return candidates.filter((candidate) => (
    !openTokenKeys.has(`${candidate.chain}:${candidate.tokenAddress}`)
    && !priorSurfaceSignatures.has(
      `${candidate.chain}:${candidate.tokenAddress}:${surfaceSignature(candidate)}`,
    )
  ));
}

function surfaceSignature(candidate) {
  return JSON.stringify({
    sourceTypes: [...(candidate.sourceTypes ?? [])].sort(),
    latestSourceTimestamp: candidate.latestSourceTimestamp ?? null,
    latestBoostAmount: candidate.latestBoostAmount ?? 0,
    totalBoostAmount: candidate.totalBoostAmount ?? 0,
    hasWebsite: candidate.hasWebsite === true,
    hasTwitter: candidate.hasTwitter === true,
  });
}

function earlySurfaceBlockers(market, observedAt) {
  const rule = DEX_EARLY_SURFACE_RULE;
  const blockers = [];
  if (!market) return ["no positive-price base-token pair"];
  const marketCap = market.marketCapUsd ?? market.fdvUsd;
  const ageMinutes = market.pairCreatedAt == null
    ? null
    : (observedAt.getTime() - market.pairCreatedAt) / 60_000;
  if (!(ageMinutes >= rule.minimumPairAgeMinutesInclusive)) blockers.push("pair younger than 15 minutes");
  if (!(ageMinutes <= rule.maximumPairAgeHoursInclusive * 60)) blockers.push("pair older than 72 hours");
  if (!(market.liquidityUsd >= rule.minimumLiquidityUsdInclusive)) blockers.push("liquidity below $10,000");
  if (!(marketCap >= rule.minimumMarketCapUsdInclusive && marketCap <= rule.maximumMarketCapUsdInclusive)) {
    blockers.push("market cap outside $50,000-$5,000,000");
  }
  if (!(market.volumeUsd?.h1 >= rule.minimumHourlyVolumeUsdInclusive)) blockers.push("one-hour volume below $1,000");
  if (!within(market.priceChangePct?.h1, rule.minimumHourlyPriceChangePctInclusive, rule.maximumHourlyPriceChangePctInclusive)) {
    blockers.push("one-hour price change outside -20%-25%");
  }
  if (!within(market.priceChangePct?.h24, rule.minimumDailyPriceChangePctInclusive, rule.maximumDailyPriceChangePctInclusive)) {
    blockers.push("24-hour price change outside -50%-150%");
  }
  return blockers;
}

function compareCandidates(left, right) {
  return right.sourceBreadth - left.sourceBreadth
    || right.totalBoostAmount - left.totalBoostAmount
    || number(right.hourlyTurnover) - number(left.hourlyTurnover)
    || number(left.pairAgeMinutes) - number(right.pairAgeMinutes)
    || left.tokenAddress.localeCompare(right.tokenAddress);
}

function firstIso(...values) {
  for (const value of values) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) continue;
    return new Date(value).toISOString();
  }
  return null;
}

function within(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function ratio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? Math.round((numerator / denominator) * 1_000_000) / 1_000_000
    : null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeHttp(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function countValues(values) {
  return Object.fromEntries([...values.reduce((map, value) => {
    map.set(value, (map.get(value) ?? 0) + 1);
    return map;
  }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function parseArgs(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    options.set(key, value);
    index += 1;
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await collectDexEarlySurfaceDiscovery({
    ledgerPath: options.get("--ledger") ?? defaultTokenEdgeLedgerPath(),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
