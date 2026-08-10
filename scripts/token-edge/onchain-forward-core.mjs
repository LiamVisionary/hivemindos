import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { buildChallengerComparisons, rejectedChallengerForecastIds } from "./onchain-challenger-scorecard.mjs";
import { createRegisteredChallengerForecasts, TOKEN_EDGE_CHALLENGERS, TOKEN_EDGE_LIQUIDITY_CHALLENGER_MODEL_VERSION } from "./onchain-challengers.mjs";
import { buildCapacityScorecard, capacityEvolutionDecision, executionPolicyLink, resolutionExecutionEvidence } from "./onchain-capacity-scorecard.mjs";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  TOKEN_EDGE_MAX_EXACT_LIVE_LAG_MS,
  TOKEN_EDGE_MAX_EXACT_1H_LIVE_LAG_MS,
  exactLiveOutcomeTimingReason,
} from "./onchain-outcome-timing.mjs";
export const TOKEN_EDGE_SCHEMA_VERSION = 1;
export const TOKEN_EDGE_DATASET = "token-edge-onchain-forward-v1";
export const TOKEN_EDGE_MODEL_VERSION = "frozen-onchain-rank-v3";
export const TOKEN_EDGE_CHALLENGER_MODEL_VERSION = TOKEN_EDGE_LIQUIDITY_CHALLENGER_MODEL_VERSION;
export const TOKEN_EDGE_MIN_EVOLUTION_OBSERVATIONS = 252;
export const TOKEN_EDGE_MIN_UNIQUE_TOKENS = 30;
export const TOKEN_EDGE_MIN_TRADED_FRAMES = 64;
export const TOKEN_EDGE_ROUND_TRIP_COST_PCT = 4;
export const TOKEN_EDGE_BOOTSTRAP_ITERATIONS = 10_000;
export const TOKEN_EDGE_HORIZONS = Object.freeze({
  "1h": { durationMs: 60 * 60_000, toleranceMs: 30 * 60_000 },
  "6h": { durationMs: 6 * 60 * 60_000, toleranceMs: 2 * 60 * 60_000 },
  "24h": { durationMs: 24 * 60 * 60_000, toleranceMs: 6 * 60 * 60_000 },
});
const RETURN_FORECAST_SPECS = Object.freeze({
  "1h": { scale: 80, minimum: -20, maximum: 40 },
  "6h": { scale: 160, minimum: -35, maximum: 80 },
  "24h": { scale: 240, minimum: -50, maximum: 120 },
});
const TOKEN_EDGE_BASELINE_CANDIDATES = Object.freeze([
  "market-only-control",
  "smart-money-selection",
  "authentic-buyer-growth",
  "supply-profit-overhang",
  "combined-onchain",
]);
export const TOKEN_EDGE_CANDIDATES = Object.freeze([
  ...TOKEN_EDGE_BASELINE_CANDIDATES,
  ...TOKEN_EDGE_CHALLENGERS.map((challenger) => challenger.candidateId),
]);
export { TOKEN_EDGE_CHALLENGERS };
export function createChallengerRegistrationEvents(registeredAt = new Date()) {
  const registeredAtIso = iso(registeredAt);
  return TOKEN_EDGE_CHALLENGERS.map((challenger) => {
    const pairedEvaluationPolicy = {
      minimumMatchedForecasts: TOKEN_EDGE_MIN_EVOLUTION_OBSERVATIONS,
      minimumIndependentPairedFrames: TOKEN_EDGE_MIN_EVOLUTION_OBSERVATIONS,
      minimumUniqueTokens: TOKEN_EDGE_MIN_UNIQUE_TOKENS,
      bootstrapIterations: TOKEN_EDGE_BOOTSTRAP_ITERATIONS,
      pairedBootstrapLower95MustExceedPct: 0,
      cashReturnPct: 0,
      roundTripCostPct: TOKEN_EDGE_ROUND_TRIP_COST_PCT,
      requiresAbsolutePromotionGate: true,
    };
    const registrationSpec = {
      ...challenger,
      pairedEvaluationPolicy,
      researchOnly: true,
      mutationAllowed: false,
    };
    return {
      type: "challenger-registration",
      id: `challenger_registration_${digestValue(registrationSpec).slice(0, 24)}`,
      registeredAt: registeredAtIso,
      status: "frozen",
      ...registrationSpec,
    };
  });
}
const NANSEN_RAW_IDENTITY_KEYS = new Set([
  "address",
  "addresses",
  "wallet",
  "wallet_address",
  "wallet_addresses",
  "label",
  "labels",
  "entity",
  "entity_name",
]);
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digestValue(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function eventWithIntegrity(event) {
  const unsigned = JSON.parse(JSON.stringify({
    schemaVersion: TOKEN_EDGE_SCHEMA_VERSION,
    dataset: TOKEN_EDGE_DATASET,
    ...event,
  }));
  return { ...unsigned, digest: digestValue(unsigned) };
}

export async function appendLedgerEvent(ledgerPath, event) {
  const signed = eventWithIntegrity(event);
  await mkdir(path.dirname(path.resolve(ledgerPath)), { recursive: true });
  await appendFile(ledgerPath, `${JSON.stringify(signed)}\n`, "utf8");
  return signed;
}

export async function readLedger(ledgerPath) {
  let text = "";
  try {
    text = await readFile(ledgerPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`Ledger line ${index + 1} is not valid JSON.`);
      }
    });
}

export function latestLedgerOccurrenceAt(events) {
  const scheduledTimestampFields = new Set(["dueAt", "activationDueAt", "expiresAt"]);
  let latest = null;
  for (const event of events) {
    for (const [field, value] of Object.entries(event)) {
      if (!field.endsWith("At") || scheduledTimestampFields.has(field)) continue;
      const timestamp = Date.parse(value);
      if (!Number.isFinite(timestamp)) continue;
      if (!latest || timestamp > latest.getTime()) latest = new Date(timestamp);
    }
  }
  return latest;
}

export function verifyLedger(events) {
  const errors = [];
  const ids = new Set();
  for (const [index, event] of events.entries()) {
    if (!event || typeof event !== "object") {
      errors.push(`line ${index + 1}: event is not an object`);
      continue;
    }
    const { digest, ...unsigned } = event;
    if (digest !== digestValue(unsigned)) errors.push(`line ${index + 1}: digest mismatch`);
    if (typeof event.id !== "string" || !event.id) errors.push(`line ${index + 1}: missing id`);
    else if (ids.has(event.id)) errors.push(`line ${index + 1}: duplicate id ${event.id}`);
    else ids.add(event.id);
    if (event.schemaVersion !== TOKEN_EDGE_SCHEMA_VERSION) {
      errors.push(`line ${index + 1}: unsupported schema version`);
    }
    if (event.dataset !== TOKEN_EDGE_DATASET) errors.push(`line ${index + 1}: wrong dataset`);
  }
  return { ok: errors.length === 0, errors, eventCount: events.length };
}

export function selectDeepestTokenPair(pairs, tokenAddress) {
  const wanted = normalizeAddress(tokenAddress);
  return (Array.isArray(pairs) ? pairs : [])
    .filter((pair) => normalizeAddress(pair?.baseToken?.address) === wanted)
    .sort((left, right) => number(right?.liquidity?.usd) - number(left?.liquidity?.usd))[0] ?? null;
}

export function marketSnapshotFromDexPair(pair, tokenAddress, observedAt) {
  if (!pair) return null;
  const priceUsd = positiveNumberOrNull(pair.priceUsd);
  if (priceUsd == null) return null;
  const txns = {
    m5: transactionWindow(pair, "m5"),
    h1: transactionWindow(pair, "h1"),
    h6: transactionWindow(pair, "h6"),
    h24: transactionWindow(pair, "h24"),
  };
  return {
    source: "dexscreener",
    observedAt: iso(observedAt),
    tokenAddress,
    pairAddress: cleanText(pair.pairAddress) || null,
    pairUrl: safeHttpUrl(pair.url),
    dexId: cleanText(pair.dexId) || null,
    symbol: cleanText(pair?.baseToken?.symbol) || null,
    priceUsd,
    liquidityUsd: positiveNumberOrNull(pair?.liquidity?.usd),
    marketCapUsd: positiveNumberOrNull(pair.marketCap),
    fdvUsd: positiveNumberOrNull(pair.fdv),
    volumeUsd: {
      m5: nonNegativeNumberOrNull(pair?.volume?.m5),
      h1: nonNegativeNumberOrNull(pair?.volume?.h1),
      h6: nonNegativeNumberOrNull(pair?.volume?.h6),
      h24: nonNegativeNumberOrNull(pair?.volume?.h24),
    },
    priceChangePct: {
      m5: finiteNumberOrNull(pair?.priceChange?.m5),
      h1: finiteNumberOrNull(pair?.priceChange?.h1),
      h6: finiteNumberOrNull(pair?.priceChange?.h6),
      h24: finiteNumberOrNull(pair?.priceChange?.h24),
    },
    txns,
    pairCreatedAt: positiveNumberOrNull(pair.pairCreatedAt),
  };
}

export function aggregateNansenSnapshot(payloads = {}) {
  const tokenInformation = firstRecord(payloads.tokenInformation);
  const flow = firstRecord(payloads.flowIntelligence);
  const holders = records(payloads.holders);
  const bought = records(payloads.whoBought ?? payloads.whoBoughtSold);
  const sold = records(payloads.whoSold ?? payloads.whoBoughtSold);
  const pnl = records(payloads.pnlLeaderboard);
  const windowBoughtUsd = pickNumber(tokenInformation, ["buy_volume_usd"]);
  const windowSoldUsd = pickNumber(tokenInformation, ["sell_volume_usd"]);

  const holderRows = holders.map((row) => ({
    ownershipPct: pickNumber(row, [
      "ownership_percentage",
      "ownership_pct",
      "ownership",
    ]),
    tokenAmountChange: pickNumber(row, [
      "token_amount_change",
      "token_amount_change_24h",
      "balance_change",
      "balance_change_24h",
      "change_24h",
    ]),
    inflowTokenAmount: pickNumber(row, ["total_inflow"]),
    outflowTokenAmount: pickNumber(row, ["total_outflow"]),
    inflowUsd: pickNumber(row, ["inflow_usd", "inflows_usd", "inflow_24h_usd"]),
    outflowUsd: pickNumber(row, ["outflow_usd", "outflows_usd", "outflow_24h_usd"]),
  }));
  const ownership = holderRows
    .map((row) => row.ownershipPct)
    .filter(isFiniteNumber)
    .sort((left, right) => right - left);
  const holderChanges = holderRows
    .map((row) => row.tokenAmountChange)
    .filter(isFiniteNumber);
  const holderAmountRows = holderRows.filter((row) => (
    isFiniteNumber(row.inflowTokenAmount) || isFiniteNumber(row.outflowTokenAmount)
  ));
  const holderUsdRows = holderRows.filter((row) => (
    isFiniteNumber(row.inflowUsd) || isFiniteNumber(row.outflowUsd)
  ));

  const boughtRows = bought.map((row) => ({
    volumeUsd: pickNumber(row, [
      "bought_volume_usd",
      "volume_bought_usd",
      "bought_usd",
      "buy_volume_usd",
    ]),
  }));
  const soldRows = sold.map((row) => ({
    volumeUsd: pickNumber(row, [
      "sold_volume_usd",
      "volume_sold_usd",
      "sold_usd",
      "sell_volume_usd",
    ]),
  }));

  const pnlRows = pnl.map((row) => ({
    realizedPnlUsd: pickNumber(row, [
      "pnl_usd_realised",
      "realized_pnl_usd",
      "realised_pnl_usd",
    ]),
    unrealizedPnlUsd: pickNumber(row, [
      "pnl_usd_unrealised",
      "unrealized_pnl_usd",
      "unrealised_pnl_usd",
    ]),
    holdingUsd: pickNumber(row, ["holding_usd", "current_holding_usd"]),
    stillHoldingRatio: normalizeRatio(pickNumber(row, [
      "still_holding_balance_ratio",
      "still_holding_ratio",
    ])),
    netflowUsd: pickNumber(row, ["netflow_amount_usd", "netflow_usd", "net_flow_usd"]),
    tradeCount: pickNumber(row, ["nof_trades", "trade_count", "trades"]),
  }));
  const pnlWithNetflow = pnlRows.filter((row) => isFiniteNumber(row.netflowUsd));
  const unrealized = pnlRows.map((row) => row.unrealizedPnlUsd).filter(isFiniteNumber);
  const realized = pnlRows.map((row) => row.realizedPnlUsd).filter(isFiniteNumber);
  const stillHolding = pnlRows.map((row) => row.stillHoldingRatio).filter(isFiniteNumber);
  const topPnlTradeCounts = pnlRows.map((row) => row.tradeCount).filter(isFiniteNumber);
  const profitOverhangUsd = pnlRows.reduce((sum, row) => {
    const profit = Math.max(0, row.unrealizedPnlUsd ?? 0);
    const ratio = row.stillHoldingRatio ?? (row.holdingUsd != null && row.holdingUsd > 0 ? 1 : 0);
    return sum + profit * ratio;
  }, 0);

  const boughtUsd = sumFinite(boughtRows.map((row) => row.volumeUsd));
  const soldUsd = sumFinite(soldRows.map((row) => row.volumeUsd));
  const boughtConcentration = volumeDistributionMetrics(boughtRows.map((row) => row.volumeUsd));
  const soldConcentration = volumeDistributionMetrics(soldRows.map((row) => row.volumeUsd));
  const flowSegments = {
    topPnl: segmentAggregate(
      flow,
      ["top_pnl", "top_pnl_trader", "top_pnl_traders"],
      ["top_pnl_net_flow_usd", "top_pnl_flow", "topPnlFlow"],
      ["top_pnl_wallet_count", "top_pnl_wallets", "topPnlWallets"],
    ),
    whale: segmentAggregate(
      flow,
      ["whale", "whales"],
      ["whale_net_flow_usd", "whale_flow", "whaleFlow"],
      ["whale_wallet_count", "whale_wallets", "whaleWallets"],
    ),
    smartTrader: segmentAggregate(
      flow,
      ["smart_trader", "smart_traders", "smart_money"],
      ["smart_trader_net_flow_usd", "smart_trader_flow", "smartTraderFlow"],
      ["smart_trader_wallet_count", "smart_trader_wallets", "smartTraderWallets"],
    ),
    freshWallet: segmentAggregate(
      flow,
      ["fresh_wallet", "fresh_wallets"],
      [
        "fresh_wallets_net_flow_usd",
        "fresh_wallets_flow",
        "freshWalletsFlow",
        "fresh_wallet_flow",
      ],
      [
        "fresh_wallets_wallet_count",
        "fresh_wallets_wallets",
        "freshWalletsWallets",
        "fresh_wallet_wallets",
      ],
    ),
    exchange: segmentAggregate(
      flow,
      ["exchange", "exchanges"],
      ["exchange_net_flow_usd", "exchange_flow", "exchangeFlow"],
      ["exchange_wallet_count", "exchange_wallets", "exchangeWallets"],
    ),
    publicFigure: segmentAggregate(
      flow,
      ["public_figure", "public_figures"],
      ["public_figure_net_flow_usd", "public_figure_flow", "publicFigureFlow"],
      ["public_figure_wallet_count", "public_figure_wallets", "publicFigureWallets"],
    ),
  };

  const aggregates = {
    holderCount: pickNumber(tokenInformation, [
      "holders_count",
      "holder_count",
      "token_holders",
      "holders",
      "total_holders",
    ]),
    uniqueBuyerCount: pickNumber(tokenInformation, ["unique_buyers", "unique_buyer_count"]),
    uniqueSellerCount: pickNumber(tokenInformation, ["unique_sellers", "unique_seller_count"]),
    buyVolumeUsd: windowBoughtUsd,
    sellVolumeUsd: windowSoldUsd,
    buySellUsdRatio: isFiniteNumber(windowBoughtUsd) && isFiniteNumber(windowSoldUsd)
      ? round(windowBoughtUsd / Math.max(1, windowSoldUsd), 6)
      : null,
    buyTransactionCount: pickNumber(tokenInformation, ["total_buys", "buy_count"]),
    sellTransactionCount: pickNumber(tokenInformation, ["total_sells", "sell_count"]),
    uniqueTraderCount: pickNumber(tokenInformation, [
      "traders_count",
      "trader_count",
      "unique_traders",
      "unique_trader_count",
    ]),
    sampledHolderCount: holders.length || null,
    top1OwnershipPct: ownership[0] ?? null,
    top10OwnershipPct: ownership.length ? round(sumFinite(ownership.slice(0, 10)), 6) : null,
    accumulatingHolderShare: holderChanges.length
      ? round(holderChanges.filter((value) => value > 0).length / holderChanges.length, 6)
      : null,
    sampledHolderNetTokenAmount: holderAmountRows.length
      ? round(holderAmountRows.reduce(
        (sum, row) => sum + (row.inflowTokenAmount ?? 0) - (row.outflowTokenAmount ?? 0),
        0,
      ), 6)
      : null,
    sampledHolderNetflowUsd: holderUsdRows.length
      ? round(holderUsdRows.reduce(
        (sum, row) => sum + (row.inflowUsd ?? 0) - (row.outflowUsd ?? 0),
        0,
      ), 6)
      : null,
    sampledBuyerCount: boughtRows.filter((row) => (row.volumeUsd ?? 0) > 0).length || null,
    sampledSellerCount: soldRows.filter((row) => (row.volumeUsd ?? 0) > 0).length || null,
    sampledBoughtUsd: boughtRows.length ? round(boughtUsd, 6) : null,
    sampledSoldUsd: soldRows.length ? round(soldUsd, 6) : null,
    sampledBuySellUsdRatio: boughtRows.length && soldRows.length
      ? round(boughtUsd / Math.max(1, soldUsd), 6)
      : null,
    topSampledBuyerVolumeShare: boughtConcentration.topShare,
    sampledBuyerVolumeHhi: boughtConcentration.hhi,
    topSampledSellerVolumeShare: soldConcentration.topShare,
    sampledSellerVolumeHhi: soldConcentration.hhi,
    flowSegments,
    pnlSampleSize: pnlRows.length || null,
    topPnlRealizedPositiveShare: realized.length
      ? round(realized.filter((value) => value > 0).length / realized.length, 6)
      : null,
    positiveSelectiveNetflowShare: pnlWithNetflow.length
      ? round(pnlWithNetflow.filter((row) => row.netflowUsd > 0).length / pnlWithNetflow.length, 6)
      : null,
    medianSelectiveNetflowUsd: median(pnlWithNetflow.map((row) => row.netflowUsd)),
    medianUnrealizedPnlUsd: median(unrealized),
    medianStillHoldingRatio: median(stillHolding),
    medianTopPnlTradeCount: median(topPnlTradeCounts),
    meanTopPnlTradeCount: topPnlTradeCounts.length
      ? round(meanPresent(topPnlTradeCounts), 6)
      : null,
    sampledProfitOverhangUsd: pnlRows.length ? round(profitOverhangUsd, 6) : null,
  };

  assertNoNansenRawIdentities(aggregates);
  return aggregates;
}

export function assertNoNansenRawIdentities(value, pathParts = []) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoNansenRawIdentities(item, [...pathParts, String(index)]));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (NANSEN_RAW_IDENTITY_KEYS.has(key.toLowerCase())) {
      throw new Error(`Nansen aggregate contains prohibited identity field at ${[...pathParts, key].join(".")}.`);
    }
    assertNoNansenRawIdentities(child, [...pathParts, key]);
  }
}

export function createSnapshotEvent(input) {
  if (!input.market?.priceUsd) throw new Error("A positive market price is required for a snapshot.");
  const observedAt = iso(input.observedAt);
  const id = `snapshot_${digestValue({
    chain: input.chain,
    tokenAddress: normalizeAddress(input.tokenAddress),
    observedAt,
    priceUsd: input.market.priceUsd,
  }).slice(0, 24)}`;
  const nansen = input.nansen ?? {
    status: "disabled",
    profile: "off",
    attemptedCredits: 0,
    aggregates: null,
    sourceAttribution: null,
    errors: [],
  };
  if (nansen.aggregates) assertNoNansenRawIdentities(nansen.aggregates);
  return {
    type: "snapshot",
    id,
    observedAt,
    chain: cleanText(input.chain).toLowerCase(),
    tokenAddress: cleanText(input.tokenAddress),
    cohort: cleanText(input.cohort) || "explicit-token-list",
    selection: input.selection ?? null,
    market: input.market,
    nansen,
  };
}

export function latestPriorSnapshot(events, snapshot) {
  const priors = events
    .filter((event) => (
      event.type === "snapshot"
      && event.chain === snapshot.chain
      && normalizeAddress(event.tokenAddress) === normalizeAddress(snapshot.tokenAddress)
      && Date.parse(event.observedAt) < Date.parse(snapshot.observedAt)
    ))
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt));
  if (snapshot.nansen?.aggregates) {
    return priors.find((event) => event.nansen?.aggregates) ?? priors[0] ?? null;
  }
  return priors[0] ?? null;
}

export function createForecastEvents(
  snapshot,
  priorSnapshot,
  challengerRegistrations = [],
  executionPolicyRegistrations = [],
  additionalEvidenceEvents = [],
) {
  const candidateStates = scoreCandidateStates(snapshot, priorSnapshot);
  const baselineForecasts = TOKEN_EDGE_BASELINE_CANDIDATES.flatMap((candidateId) => {
    const state = candidateStates[candidateId];
    return Object.entries(TOKEN_EDGE_HORIZONS).map(([horizon, spec]) => {
      const createdAtMs = Date.parse(snapshot.observedAt);
      const dueAt = new Date(createdAtMs + spec.durationMs).toISOString();
      const expiresAt = new Date(createdAtMs + spec.durationMs + spec.toleranceMs).toISOString();
      const returnSpec = RETURN_FORECAST_SPECS[horizon];
      const predictedRise = state.status === "ready" ? state.score > 0.62 : null;
      const predictedReturnPct = state.status === "ready"
        ? round(clamp(
          (state.score - 0.62) * returnSpec.scale,
          returnSpec.minimum,
          returnSpec.maximum,
        ), 4)
        : null;
      const predictedRiseProbability = state.status === "ready"
        ? round(clamp(0.5 + (state.score - 0.62) * 1.25, 0.1, 0.9), 6)
        : null;
      const id = `forecast_${digestValue({
        snapshotId: snapshot.id,
        candidateId,
        horizon,
        modelVersion: TOKEN_EDGE_MODEL_VERSION,
      }).slice(0, 24)}`;
      return {
        type: "forecast",
        id,
        snapshotId: snapshot.id,
        createdAt: snapshot.observedAt,
        chain: snapshot.chain,
        tokenAddress: snapshot.tokenAddress,
        symbol: snapshot.market.symbol,
        candidateId,
        horizon,
        dueAt,
        expiresAt,
        status: state.status,
        blockers: state.blockers,
        modelVersion: TOKEN_EDGE_MODEL_VERSION,
        selectionProvider: snapshot.selection?.provider ?? "unattributed",
        selectionTimeframe: snapshot.selection?.timeframe ?? "unattributed",
        selectionDiscoveryEventId: snapshot.selection?.discoveryEventId ?? null,
        selectionConfirmationEventId: snapshot.selection?.confirmationEventId ?? null,
        score: state.score,
        predictedRise,
        predictedRiseProbability,
        predictedReturnPct,
        roundTripCostPct: TOKEN_EDGE_ROUND_TRIP_COST_PCT,
        inputEvidence: state.inputEvidence,
      };
    });
  });
  const challengerForecasts = createRegisteredChallengerForecasts({
    snapshot,
    candidateStates,
    challengerRegistrations,
    additionalEvidenceEvents,
    digestValue,
    horizons: TOKEN_EDGE_HORIZONS,
    roundTripCostPct: TOKEN_EDGE_ROUND_TRIP_COST_PCT,
  });
  const policyLink = executionPolicyLink(snapshot.observedAt, executionPolicyRegistrations);
  return [...baselineForecasts, ...challengerForecasts].map((forecast) => ({ ...forecast, ...policyLink }));
}

export function scoreCandidateStates(snapshot, priorSnapshot) {
  const market = snapshot.market;
  const current = snapshot.nansen?.aggregates;
  const prior = priorSnapshot?.nansen?.aggregates;
  const marketEligibility = marketEligibilityState(market, snapshot.observedAt);

  const buyImbalance = transactionImbalance(market.txns?.h1);
  const volumeLiquidity = ratio(market.volumeUsd?.h1, market.liquidityUsd);
  const pairAgeHours = market.pairCreatedAt == null
    ? null
    : (Date.parse(snapshot.observedAt) - market.pairCreatedAt) / (60 * 60_000);
  const marketScore = meanPresent([
    unitScale(buyImbalance, -0.2, 0.5),
    unitScale(log10Safe(volumeLiquidity), -1.3, 0.7),
    inverseUnitScale(Math.abs(market.priceChangePct?.h1 ?? 0), 0, 25),
    unitScale(log10Safe(market.liquidityUsd), 4, 6),
  ]);
  const marketState = candidateState(
    marketEligibility.blockers,
    marketScore,
    {
      buyImbalanceH1: buyImbalance,
      volumeLiquidityH1: volumeLiquidity,
      priceChangeH1Pct: market.priceChangePct?.h1 ?? null,
      liquidityUsd: market.liquidityUsd ?? null,
      pairAgeHours,
    },
  );

  const selection = snapshot.selection;
  const selectionBlockers = [
    ...marketEligibility.blockers,
    ...(selection?.status === "verified" ? [] : ["missing verified Nansen-to-DEX selection lineage"]),
    ...(selection?.status === "verified" && selection?.provider !== "nansen-token-screener"
      ? ["selection provider is not nansen-token-screener"]
      : []),
  ];
  const smartMoneySelectionState = candidateState(
    selectionBlockers,
    0.7,
    {
      provider: selection?.provider ?? null,
      timeframe: selection?.timeframe ?? null,
      discoveryEventId: selection?.discoveryEventId ?? null,
      confirmationEventId: selection?.confirmationEventId ?? null,
      discoveryNetflowUsd: selection?.metrics?.netflowUsd ?? null,
      discoveryNetflowToLiquidity: selection?.metrics?.netflowToLiquidity ?? null,
      discoveryBuySellVolumeRatio: selection?.metrics?.buySellVolumeRatio ?? null,
      discoveryPriceChangePct: selection?.metrics?.priceChangePct ?? null,
      confirmedLiquidityUsd: selection?.metrics?.confirmedLiquidityUsd ?? null,
    },
  );

  const holderGrowthPct = growthPct(current?.holderCount, prior?.holderCount);
  const buyerActivityChangePct = growthPct(current?.uniqueBuyerCount, prior?.uniqueBuyerCount);
  const authenticBlockers = [
    ...marketEligibility.blockers,
    ...missingBlockers({
      "prior holder count": prior?.holderCount,
      "current holder count": current?.holderCount,
      "prior unique buyer count": prior?.uniqueBuyerCount,
      "current unique buyer count": current?.uniqueBuyerCount,
      "window buy/sell ratio": current?.buySellUsdRatio,
      "sampled top-buyer/top-seller ratio": current?.sampledBuySellUsdRatio,
      "fresh-wallet netflow": current?.flowSegments?.freshWallet?.netflowUsd,
      "smart-trader netflow": current?.flowSegments?.smartTrader?.netflowUsd,
    }),
  ];
  const liquidity = Math.max(1, market.liquidityUsd ?? 0);
  const authenticScore = meanPresent([
    unitScale(holderGrowthPct, 0, 10),
    unitScale(buyerActivityChangePct, 0, 15),
    unitScale(log10Safe(current?.buySellUsdRatio), -0.3, 0.7),
    unitScale(log10Safe(current?.sampledBuySellUsdRatio), -0.3, 0.7),
    unitScale((current?.flowSegments?.freshWallet?.netflowUsd ?? 0) / liquidity, -0.05, 0.2),
    unitScale((current?.flowSegments?.smartTrader?.netflowUsd ?? 0) / liquidity, -0.05, 0.2),
  ]);
  const authenticState = candidateState(
    authenticBlockers,
    authenticScore,
    {
      holderGrowthPct,
      uniqueBuyerWindowActivityChangePct: buyerActivityChangePct,
      windowBuySellUsdRatio: current?.buySellUsdRatio ?? null,
      sampledTopBuyerSellerUsdRatio: current?.sampledBuySellUsdRatio ?? null,
      topSampledBuyerVolumeShare: current?.topSampledBuyerVolumeShare ?? null,
      sampledBuyerVolumeHhi: current?.sampledBuyerVolumeHhi ?? null,
      topSampledSellerVolumeShare: current?.topSampledSellerVolumeShare ?? null,
      sampledSellerVolumeHhi: current?.sampledSellerVolumeHhi ?? null,
      freshWalletNetflowToLiquidity: ratio(
        current?.flowSegments?.freshWallet?.netflowUsd,
        market.liquidityUsd,
      ),
      smartTraderNetflowToLiquidity: ratio(
        current?.flowSegments?.smartTrader?.netflowUsd,
        market.liquidityUsd,
      ),
    },
  );

  const top10ChangePct = change(current?.top10OwnershipPct, prior?.top10OwnershipPct);
  const supplyBlockers = [
    ...marketEligibility.blockers,
    ...missingBlockers({
      "prior top-10 ownership": prior?.top10OwnershipPct,
      "current top-10 ownership": current?.top10OwnershipPct,
      "accumulating-holder share": current?.accumulatingHolderShare,
      "selective-wallet positive netflow share": current?.positiveSelectiveNetflowShare,
      "profit overhang": current?.sampledProfitOverhangUsd,
      "still-holding ratio": current?.medianStillHoldingRatio,
    }),
  ];
  const overhangToLiquidity = ratio(current?.sampledProfitOverhangUsd, market.liquidityUsd);
  const supplyScore = meanPresent([
    inverseUnitScale(current?.top10OwnershipPct, 20, 80),
    inverseUnitScale(top10ChangePct, -2, 4),
    unitScale(current?.accumulatingHolderShare, 0.35, 0.75),
    unitScale(current?.positiveSelectiveNetflowShare, 0.35, 0.75),
    inverseUnitScale(overhangToLiquidity, 0, 0.5),
    inverseUnitScale(current?.medianStillHoldingRatio, 0.25, 0.9),
  ]);
  const supplyState = candidateState(
    supplyBlockers,
    supplyScore,
    {
      top10OwnershipPct: current?.top10OwnershipPct ?? null,
      top10OwnershipChangePct: top10ChangePct,
      accumulatingHolderShare: current?.accumulatingHolderShare ?? null,
      positiveSelectiveNetflowShare: current?.positiveSelectiveNetflowShare ?? null,
      profitOverhangToLiquidity: overhangToLiquidity,
      medianStillHoldingRatio: current?.medianStillHoldingRatio ?? null,
      medianTopPnlTradeCount: current?.medianTopPnlTradeCount ?? null,
      meanTopPnlTradeCount: current?.meanTopPnlTradeCount ?? null,
    },
  );

  const combinedBlockers = [
    ...marketState.blockers.map((blocker) => `market: ${blocker}`),
    ...authenticState.blockers.map((blocker) => `authentic flow: ${blocker}`),
    ...supplyState.blockers.map((blocker) => `supply: ${blocker}`),
  ];
  const combinedState = candidateState(
    combinedBlockers,
    meanPresent([marketState.score, authenticState.score, supplyState.score]),
    {
      marketScore: marketState.score,
      authenticBuyerGrowthScore: authenticState.score,
      supplyProfitOverhangScore: supplyState.score,
    },
  );

  return {
    "market-only-control": marketState,
    "smart-money-selection": smartMoneySelectionState,
    "authentic-buyer-growth": authenticState,
    "supply-profit-overhang": supplyState,
    "combined-onchain": combinedState,
  };
}

export function unresolvedForecasts(events, now = new Date()) {
  const resolved = new Set(events
    .filter((event) => event.type === "resolution")
    .map((event) => event.forecastId));
  const nowMs = now.getTime();
  return events.filter((event) => (
    event.type === "forecast"
    && event.status === "ready"
    && !resolved.has(event.id)
    && Date.parse(event.dueAt) <= nowMs
  ));
}

export function resolutionEvent(forecast, snapshot, priceUsd, observedAt, exitMarket = null) {
  const observedAtIso = iso(observedAt);
  const observedAtMs = Date.parse(observedAtIso);
  if (observedAtMs > Date.parse(forecast.expiresAt)) {
    return missedResolutionEvent(forecast, observedAtIso, "observation-window-expired");
  }
  if (!(priceUsd > 0) || !Number.isFinite(priceUsd)) {
    throw new Error("A positive resolution price is required.");
  }
  const grossReturnPct = ((priceUsd / snapshot.market.priceUsd) - 1) * 100;
  const netReturnPct = grossReturnPct - forecast.roundTripCostPct;
  return {
    type: "resolution",
    id: `resolution_${digestValue({ forecastId: forecast.id, observedAt: observedAtIso }).slice(0, 24)}`,
    forecastId: forecast.id,
    snapshotId: forecast.snapshotId,
    modelVersion: forecast.modelVersion,
    selectionProvider: forecast.selectionProvider ?? "unattributed",
    selectionTimeframe: forecast.selectionTimeframe ?? "unattributed",
    candidateId: forecast.candidateId,
    horizon: forecast.horizon,
    chain: forecast.chain,
    tokenAddress: forecast.tokenAddress,
    dueAt: forecast.dueAt,
    observedAt: observedAtIso,
    status: "observed",
    observationMode: "live-point-in-time",
    entryPriceUsd: snapshot.market.priceUsd,
    observedPriceUsd: priceUsd,
    ...resolutionExecutionEvidence(snapshot, exitMarket),
    grossReturnPct: round(grossReturnPct, 6),
    netReturnPct: round(netReturnPct, 6),
    actuallyRose: grossReturnPct > 0,
    clearedRoundTripCost: netReturnPct > 0,
    exploded25Pct: grossReturnPct >= 25,
    exploded50Pct: grossReturnPct >= 50,
    exploded100Pct: grossReturnPct >= 100,
    predictedRise: forecast.predictedRise,
    predictedRiseProbability: forecast.predictedRiseProbability,
    predictedReturnPct: forecast.predictedReturnPct,
    directionCorrect: forecast.predictedRise === (grossReturnPct > 0),
    magnitudeAbsoluteErrorPct: round(Math.abs(forecast.predictedReturnPct - grossReturnPct), 6),
    brierScore: round((forecast.predictedRiseProbability - (grossReturnPct > 0 ? 1 : 0)) ** 2, 8),
  };
}

export function missedResolutionEvent(forecast, observedAt, reason) {
  return {
    type: "resolution",
    id: `resolution_${digestValue({
      forecastId: forecast.id,
      observedAt: iso(observedAt),
      reason,
    }).slice(0, 24)}`,
    forecastId: forecast.id,
    snapshotId: forecast.snapshotId,
    modelVersion: forecast.modelVersion,
    selectionProvider: forecast.selectionProvider ?? "unattributed",
    selectionTimeframe: forecast.selectionTimeframe ?? "unattributed",
    candidateId: forecast.candidateId,
    horizon: forecast.horizon,
    chain: forecast.chain,
    tokenAddress: forecast.tokenAddress,
    dueAt: forecast.dueAt,
    observedAt: iso(observedAt),
    status: "missed",
    reason,
  };
}

export function buildScorecard(events) {
  const observedByForecast = new Map();
  for (const event of events) {
    if (event.status !== "observed") continue;
    if (event.type !== "resolution" && event.type !== "resolution-recovery") continue;
    const current = observedByForecast.get(event.forecastId);
    if (!current || (current.type === "resolution-recovery" && event.type === "resolution")) {
      observedByForecast.set(event.forecastId, event);
    }
  }
  const observed = [...observedByForecast.values()];
  const forecasts = new Map(events
    .filter((event) => event.type === "forecast")
    .map((event) => [event.id, event]));
  const challengerRejectedForecastIds = rejectedChallengerForecastIds(events, TOKEN_EDGE_CHALLENGERS);
  const horizonDriftedLiveOutcomes = observed.filter((row) => (
    exactLiveOutcomeTimingReason(row) === "live-resolution-horizon-drift"
  )).length;
  const scoreableObserved = observed.filter((row) => (
    !challengerRejectedForecastIds.has(row.forecastId)
    && exactLiveOutcomeTimingReason(row) == null
  ));
  const modelVersions = [...new Set([
    TOKEN_EDGE_MODEL_VERSION,
    ...events.filter((event) => event.type === "forecast").map((event) => event.modelVersion),
    ...observed.map((event) => event.modelVersion ?? forecasts.get(event.forecastId)?.modelVersion),
  ].filter(Boolean))].sort();
  const groups = new Map();
  for (const row of scoreableObserved) {
    const modelVersion = row.modelVersion ?? forecasts.get(row.forecastId)?.modelVersion ?? "unknown";
    const key = `${modelVersion}:${row.candidateId}:${row.horizon}`;
    const values = groups.get(key) ?? [];
    values.push(row);
    groups.set(key, values);
  }
  const rows = [];
  for (const modelVersion of modelVersions) {
    for (const candidateId of TOKEN_EDGE_CANDIDATES) {
      for (const horizon of Object.keys(TOKEN_EDGE_HORIZONS)) {
        const key = `${modelVersion}:${candidateId}:${horizon}`;
        const group = groups.get(key) ?? [];
        rows.push(buildScorecardRow({
          modelVersion,
          candidateId,
          horizon,
          group,
          forecasts,
        }));
      }
    }
  }
  const selectionGroups = new Map();
  for (const row of scoreableObserved) {
    const forecast = forecasts.get(row.forecastId);
    const selectionProvider = row.selectionProvider ?? forecast?.selectionProvider ?? "unattributed";
    const selectionTimeframe = row.selectionTimeframe ?? forecast?.selectionTimeframe ?? "unattributed";
    const modelVersion = row.modelVersion ?? forecast?.modelVersion ?? "unknown";
    const descriptor = {
      modelVersion,
      candidateId: row.candidateId,
      horizon: row.horizon,
      selectionProvider,
      selectionTimeframe,
    };
    const key = canonicalJson(descriptor);
    const entry = selectionGroups.get(key) ?? { ...descriptor, group: [] };
    entry.group.push(row);
    selectionGroups.set(key, entry);
  }
  const selectionRows = [...selectionGroups.values()]
    .map(({ group, ...descriptor }) => buildScorecardRow({ ...descriptor, group, forecasts }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  const challengerComparisons = buildChallengerComparisons({
    events,
    challengers: TOKEN_EDGE_CHALLENGERS,
    forecasts,
    observedByForecast,
    scorecardRows: rows,
    durations: TOKEN_EDGE_HORIZONS,
    roundTripCostPct: TOKEN_EDGE_ROUND_TRIP_COST_PCT,
    minimumObservations: TOKEN_EDGE_MIN_EVOLUTION_OBSERVATIONS,
    minimumUniqueTokens: TOKEN_EDGE_MIN_UNIQUE_TOKENS,
    bootstrapIterations: TOKEN_EDGE_BOOTSTRAP_ITERATIONS,
    bootstrapMeanInterval: circularBlockBootstrapMeanInterval,
  });
  const capacityAudit = buildCapacityScorecard(events, {
    durations: TOKEN_EDGE_HORIZONS,
    bootstrapMeanInterval: circularBlockBootstrapMeanInterval,
    rejectedForecastIds: challengerRejectedForecastIds,
  });
  return {
    type: "token-edge-scorecard",
    dataset: TOKEN_EDGE_DATASET,
    modelVersion: TOKEN_EDGE_MODEL_VERSION,
    modelVersions,
    maximumExactLiveLagMs: TOKEN_EDGE_MAX_EXACT_LIVE_LAG_MS,
    maximumExactOneHourLiveLagMs: TOKEN_EDGE_MAX_EXACT_1H_LIVE_LAG_MS,
    horizonDriftedLiveOutcomes,
    promotionPolicy: {
      minimumMaturedForecasts: TOKEN_EDGE_MIN_EVOLUTION_OBSERVATIONS,
      minimumIndependentSignalFrames: TOKEN_EDGE_MIN_EVOLUTION_OBSERVATIONS,
      minimumUniqueTokens: TOKEN_EDGE_MIN_UNIQUE_TOKENS,
      minimumPredictedRiseForecasts: 50,
      minimumIndependentTradedFrames: TOKEN_EDGE_MIN_TRADED_FRAMES,
      portfolioBootstrapLower95MustExceedPct: 0,
      minimumPortfolioProfitFactor: 1.2,
      maximumPortfolioDrawdownPct: 25,
      maximumLargestWinningFrameShare: 0.35,
      stressRoundTripCostPct: TOKEN_EDGE_ROUND_TRIP_COST_PCT * 3,
      executionCapacityGate: { required: true, policyStatus: capacityAudit.policyStatus, policyRegistrationId: capacityAudit.policyRegistrationId, ...capacityAudit.policy },
      note: "Direction accuracy is diagnostic. Both flat-cost and prospective execution-capacity gates are required; a pass only permits a frozen audit proposal and never live trading or mutation.",
    },
    rows,
    selectionRows,
    challengerComparisons,
    capacityAudit,
  };
}
function buildScorecardRow({ group, forecasts, modelVersion, candidateId, horizon, ...dimensions }) {
  const durationMs = TOKEN_EDGE_HORIZONS[horizon].durationMs;
  const signalFrames = independentAssetSignalFrames(group, forecasts, durationMs);
  const weightedGroup = signalFrames.flat();
  const predictedRises = weightedGroup.filter((row) => row.predictedRise);
  const rawPredictedRises = group.filter((row) => row.predictedRise);
  const uniqueTokens = new Set(group.map(tokenEdgeAssetKey).filter(Boolean)).size;
  const independentSignalFrames = signalFrames.length;
  const directionAccuracy = group.length
    ? group.filter((row) => row.directionCorrect).length / group.length
    : null;
  const risePrecision = predictedRises.length
    ? predictedRises.filter((row) => row.actuallyRose).length / predictedRises.length
    : null;
  const netWinRate = predictedRises.length
    ? predictedRises.filter((row) => row.clearedRoundTripCost).length / predictedRises.length
    : null;
  const averageNetReturnPct = meanPresent(predictedRises.map((row) => row.netReturnPct));
  const portfolioNetReturns = independentFramePortfolioReturns(
    predictedRises,
    forecasts,
    TOKEN_EDGE_HORIZONS[horizon].durationMs,
    TOKEN_EDGE_ROUND_TRIP_COST_PCT,
  );
  const stressedPortfolioNetReturns = independentFramePortfolioReturns(
    predictedRises,
    forecasts,
    TOKEN_EDGE_HORIZONS[horizon].durationMs,
    TOKEN_EDGE_ROUND_TRIP_COST_PCT * 3,
  );
  const portfolioBootstrapCi95 = portfolioNetReturns.length >= 2
    ? circularBlockBootstrapMeanInterval(portfolioNetReturns, TOKEN_EDGE_BOOTSTRAP_ITERATIONS)
    : [null, null];
  const portfolioProfitFactor = profitFactor(portfolioNetReturns);
  const portfolioMaxDrawdownPct = maxDrawdownPct(portfolioNetReturns);
  const largestWinningFrameShare = winningFrameConcentration(portfolioNetReturns);
  const portfolioAverageNetReturnPct = meanPresent(portfolioNetReturns);
  const stressedPortfolioAverageNetReturnPct = meanPresent(stressedPortfolioNetReturns);
  const lower95DirectionAccuracy = group.length
    ? wilsonLowerBound(group.filter((row) => row.directionCorrect).length, group.length)
    : null;
  const evidenceReady = group.length >= TOKEN_EDGE_MIN_EVOLUTION_OBSERVATIONS
    && independentSignalFrames >= TOKEN_EDGE_MIN_EVOLUTION_OBSERVATIONS
    && uniqueTokens >= TOKEN_EDGE_MIN_UNIQUE_TOKENS;
  return {
    modelVersion,
    candidateId,
    horizon,
    ...dimensions,
    maturedForecasts: group.length,
    liveMaturedForecasts: group.filter((row) => row.type === "resolution").length,
    recoveredMaturedForecasts: group.filter((row) => row.type === "resolution-recovery").length,
    portfolioWeightedForecasts: weightedGroup.length,
    sameAssetOverlappingForecasts: overlappingAssetSignalCount(group, signalFrames),
    observationModeCounts: countValues(group.map((row) => (
      row.observationMode ?? (row.type === "resolution" ? "live-point-in-time" : "unknown")
    ))),
    recoveryProviderCounts: countValues(group
      .filter((row) => row.type === "resolution-recovery")
      .map((row) => row.provider ?? "unknown")),
    independentSignalFrames,
    predictedRiseForecasts: predictedRises.length,
    rawPredictedRiseForecasts: rawPredictedRises.length,
    independentTradedFrames: portfolioNetReturns.length,
    uniqueTokens,
    directionAccuracy: nullableRound(directionAccuracy, 6),
    directionAccuracyLower95: nullableRound(lower95DirectionAccuracy, 6),
    risePrecision: nullableRound(risePrecision, 6),
    netWinRate: nullableRound(netWinRate, 6),
    explosion25Count: group.filter((row) => row.exploded25Pct).length,
    explosion50Count: group.filter((row) => row.exploded50Pct).length,
    explosion100Count: group.filter((row) => row.exploded100Pct).length,
    averageGrossReturnWhenRisePredictedPct: nullableRound(
      meanPresent(predictedRises.map((row) => row.grossReturnPct)),
      6,
    ),
    averageNetReturnWhenRisePredictedPct: nullableRound(averageNetReturnPct, 6),
    portfolioAverageNetReturnPct: nullableRound(portfolioAverageNetReturnPct, 6),
    portfolioBootstrapMeanNetReturnCi95Pct: portfolioBootstrapCi95.map((value) => nullableRound(value, 6)),
    portfolioProfitFactor: nullableRound(portfolioProfitFactor, 6),
    portfolioMaxDrawdownPct: nullableRound(portfolioMaxDrawdownPct, 6),
    largestWinningFrameShare: nullableRound(largestWinningFrameShare, 6),
    stressedPortfolioAverageNetReturnPct: nullableRound(stressedPortfolioAverageNetReturnPct, 6),
    meanMagnitudeAbsoluteErrorPct: nullableRound(
      meanPresent(group.map((row) => row.magnitudeAbsoluteErrorPct)),
      6,
    ),
    meanBrierScore: nullableRound(meanPresent(group.map((row) => row.brierScore)), 8),
    evidenceStatus: evidenceReady ? "eligible-for-frozen-audit" : "collecting",
    evidenceShortfall: {
      maturedForecasts: Math.max(0, TOKEN_EDGE_MIN_EVOLUTION_OBSERVATIONS - group.length),
      independentSignalFrames: Math.max(
        0,
        TOKEN_EDGE_MIN_EVOLUTION_OBSERVATIONS - independentSignalFrames,
      ),
      uniqueTokens: Math.max(0, TOKEN_EDGE_MIN_UNIQUE_TOKENS - uniqueTokens),
      independentTradedFrames: Math.max(0, TOKEN_EDGE_MIN_TRADED_FRAMES - portfolioNetReturns.length),
    },
    provisionalPromotionGate: evidenceReady
      && predictedRises.length >= 50
      && portfolioNetReturns.length >= TOKEN_EDGE_MIN_TRADED_FRAMES
      && portfolioBootstrapCi95[0] > 0
      && portfolioProfitFactor >= 1.2
      && portfolioMaxDrawdownPct <= 25
      && largestWinningFrameShare <= 0.35
      && stressedPortfolioAverageNetReturnPct > 0,
  };
}

function countValues(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function independentFramePortfolioReturns(group, forecasts, durationMs, roundTripCostPct) {
  return independentAssetSignalFrames(group, forecasts, durationMs)
    .map((frame) => meanPresent(frame
      .map((row) => row.grossReturnPct - roundTripCostPct)
      .filter(isFiniteNumber)))
    .filter(isFiniteNumber);
}

function independentAssetSignalFrames(group, forecasts, durationMs) {
  return independentAssetFrames(group, {
    durationMs,
    timestamp: (row) => outcomeSignalTimestamp(row, forecasts, durationMs),
    assetKey: tokenEdgeAssetKey,
  });
}

function outcomeSignalTimestamp(row, forecasts, durationMs) {
  const forecast = forecasts.get(row.forecastId);
  const createdAtMs = Date.parse(forecast?.createdAt ?? "");
  if (Number.isFinite(createdAtMs)) return createdAtMs;
  const dueAtMs = Date.parse(row.dueAt ?? "");
  return Number.isFinite(dueAtMs) ? dueAtMs - durationMs : null;
}

function profitFactor(returns) {
  if (!returns.length) return null;
  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (losses === 0) return gains > 0 ? 999 : null;
  return gains / losses;
}

function maxDrawdownPct(returns) {
  if (!returns.length) return null;
  let equity = 1;
  let peak = 1;
  let maximum = 0;
  for (const value of returns) {
    equity *= Math.max(0, 1 + value / 100);
    peak = Math.max(peak, equity);
    if (peak > 0) maximum = Math.max(maximum, ((peak - equity) / peak) * 100);
  }
  return maximum;
}

function winningFrameConcentration(returns) {
  const wins = returns.filter((value) => value > 0);
  const total = wins.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...wins) / total : null;
}

function circularBlockBootstrapMeanInterval(values, iterations) {
  const blockSize = Math.max(2, Math.min(values.length, Math.round(Math.sqrt(values.length))));
  const random = seededRandom(0x7e6e1d6e);
  const means = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = [];
    while (sample.length < values.length) {
      const start = Math.floor(random() * values.length);
      for (let offset = 0; offset < blockSize && sample.length < values.length; offset += 1) {
        sample.push(values[(start + offset) % values.length]);
      }
    }
    means.push(meanPresent(sample));
  }
  means.sort((left, right) => left - right);
  return [percentile(means, 0.025), percentile(means, 0.975)];
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function percentile(sorted, probability) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function buildEvolutionReadiness(
  scorecard,
  candidateId,
  horizon,
  modelVersion = TOKEN_EDGE_MODEL_VERSION,
) {
  const row = scorecard.rows.find((item) => (
    item.modelVersion === modelVersion
    && item.candidateId === candidateId
    && item.horizon === horizon
  ));
  if (!row) throw new Error(`Unknown candidate/horizon: ${candidateId}/${horizon}.`);
  if (row.evidenceStatus !== "eligible-for-frozen-audit") {
    return {
      status: "blocked",
      candidateId,
      horizon,
      modelVersion,
      reason: "Insufficient independent forward observations.",
      evidenceShortfall: row.evidenceShortfall,
      mutationAllowed: false,
    };
  }
  if (!row.provisionalPromotionGate) {
    return {
      status: "retain",
      candidateId,
      horizon,
      modelVersion,
      reason: "The frozen candidate did not clear the preregistered evidence gates.",
      mutationAllowed: false,
    };
  }
  const challengerComparison = scorecard.challengerComparisons?.find((item) => (
    item.challengerModelVersion === modelVersion
    && item.challengerCandidateId === candidateId
    && item.horizon === horizon
  ));
  if (challengerComparison && !challengerComparison.provisionalPairedGate) {
    return {
      status: "retain",
      candidateId,
      horizon,
      modelVersion,
      reason: "The challenger did not beat its frozen parent on the paired forward-evidence gate.",
      mutationAllowed: false,
    };
  }
  const capacityDecision = capacityEvolutionDecision(scorecard, candidateId, horizon, modelVersion); if (capacityDecision) return capacityDecision;
  return {
    status: "audit-eligible",
    candidateId,
    horizon,
    modelVersion,
    reason: "Freeze an isolated audit cohort before comparing any proposed intervention.",
    mutationAllowed: false,
  };
}

function marketEligibilityState(market, observedAt) {
  const blockers = [];
  if (!(market.priceUsd > 0)) blockers.push("missing positive price");
  if (!(market.liquidityUsd >= 10_000)) blockers.push("liquidity below $10,000");
  if (!(market.volumeUsd?.h1 >= 1_000)) blockers.push("one-hour volume below $1,000");
  if (market.pairCreatedAt == null) blockers.push("missing pair creation time");
  else {
    const ageMs = Date.parse(observedAt) - market.pairCreatedAt;
    if (ageMs < 15 * 60_000) blockers.push("pair younger than 15 minutes");
    if (ageMs > 30 * 24 * 60 * 60_000) blockers.push("pair older than 30 days");
  }
  if (market.priceChangePct?.h1 != null && market.priceChangePct.h1 > 25) {
    blockers.push("already rose more than 25% in one hour");
  }
  if (market.priceChangePct?.h24 != null && market.priceChangePct.h24 > 150) {
    blockers.push("already rose more than 150% in 24 hours");
  }
  return { blockers };
}

function candidateState(blockers, score, inputEvidence) {
  const uniqueBlockers = [...new Set(blockers)];
  return {
    status: uniqueBlockers.length ? "blocked" : "ready",
    blockers: uniqueBlockers,
    score: uniqueBlockers.length ? null : nullableRound(score, 6),
    inputEvidence,
  };
}

function missingBlockers(fields) {
  return Object.entries(fields)
    .filter(([, value]) => !isFiniteNumber(value))
    .map(([label]) => `missing ${label}`);
}

function firstRecord(payload) {
  return records(payload)[0] ?? {};
}

function records(payload) {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data.filter(isRecord);
  if (isRecord(payload.data)) {
    if (Array.isArray(payload.data.data)) return payload.data.data.filter(isRecord);
    if (Array.isArray(payload.data.items)) return payload.data.items.filter(isRecord);
    if (Array.isArray(payload.data.rows)) return payload.data.rows.filter(isRecord);
    return [payload.data];
  }
  if (Array.isArray(payload.items)) return payload.items.filter(isRecord);
  if (Array.isArray(payload.rows)) return payload.rows.filter(isRecord);
  return [payload];
}

function segmentAggregate(flow, keys, flatFlowKeys = [], flatWalletKeys = []) {
  const segment = findNestedRecord(flow, keys);
  return {
    netflowUsd: pickNumber(segment ?? flow, segment ? [
      "netflow_usd",
      "net_flow_usd",
      "netflow_amount_usd",
      "net_flow",
    ] : flatFlowKeys),
    walletCount: pickNumber(segment ?? flow, segment ? [
      "wallet_count",
      "wallets_count",
      "count",
      "nof_wallets",
    ] : flatWalletKeys),
  };
}

function findNestedRecord(value, keys) {
  if (!isRecord(value)) return null;
  const normalizedKeys = new Set(keys.map(normalizeKey));
  for (const [key, child] of Object.entries(value)) {
    if (normalizedKeys.has(normalizeKey(key)) && isRecord(child)) return child;
  }
  for (const child of Object.values(value)) {
    if (!isRecord(child)) continue;
    const found = findNestedRecord(child, keys);
    if (found) return found;
  }
  return null;
}

function pickNumber(record, keys) {
  if (!isRecord(record)) return null;
  const wanted = new Set(keys.map(normalizeKey));
  for (const [key, value] of Object.entries(record)) {
    if (!wanted.has(normalizeKey(key))) continue;
    const parsed = finiteNumberOrNull(value);
    if (parsed != null) return parsed;
  }
  for (const value of Object.values(record)) {
    if (!isRecord(value)) continue;
    const found = pickNumber(value, keys);
    if (found != null) return found;
  }
  return null;
}

function transactionWindow(pair, window) {
  const value = pair?.txns?.[window];
  return {
    buys: nonNegativeNumberOrNull(value?.buys),
    sells: nonNegativeNumberOrNull(value?.sells),
  };
}

function transactionImbalance(window) {
  const buys = window?.buys;
  const sells = window?.sells;
  if (!isFiniteNumber(buys) || !isFiniteNumber(sells) || buys + sells <= 0) return null;
  return (buys - sells) / (buys + sells);
}

function growthPct(current, prior) {
  if (!isFiniteNumber(current) || !isFiniteNumber(prior) || prior <= 0) return null;
  return ((current / prior) - 1) * 100;
}

function change(current, prior) {
  if (!isFiniteNumber(current) || !isFiniteNumber(prior)) return null;
  return current - prior;
}

function ratio(numerator, denominator) {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function log10Safe(value) {
  return isFiniteNumber(value) && value > 0 ? Math.log10(value) : null;
}

function unitScale(value, lower, upper) {
  if (!isFiniteNumber(value)) return null;
  return clamp((value - lower) / (upper - lower), 0, 1);
}

function inverseUnitScale(value, lower, upper) {
  const scaled = unitScale(value, lower, upper);
  return scaled == null ? null : 1 - scaled;
}

function normalizeRatio(value) {
  if (!isFiniteNumber(value)) return null;
  if (value > 1 && value <= 100) return value / 100;
  return value;
}

function median(values) {
  const valid = values.filter(isFiniteNumber).sort((left, right) => left - right);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : round((valid[middle - 1] + valid[middle]) / 2, 6);
}

function sumFinite(values) {
  return values.filter(isFiniteNumber).reduce((sum, value) => sum + value, 0);
}

function volumeDistributionMetrics(values) {
  const valid = values.filter((value) => isFiniteNumber(value) && value > 0);
  const total = sumFinite(valid);
  if (!valid.length || !(total > 0)) return { topShare: null, hhi: null };
  const shares = valid.map((value) => value / total);
  return {
    topShare: round(Math.max(...shares), 6),
    hhi: round(shares.reduce((sum, share) => sum + share ** 2, 0), 6),
  };
}

function meanPresent(values) {
  const present = values.filter(isFiniteNumber);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function wilsonLowerBound(successes, total, z = 1.959963984540054) {
  if (!total) return null;
  const probability = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = probability + (z * z) / (2 * total);
  const margin = z * Math.sqrt(
    (probability * (1 - probability) + (z * z) / (4 * total)) / total,
  );
  return (center - margin) / denominator;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function finiteNumberOrNull(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumberOrNull(value) {
  const parsed = finiteNumberOrNull(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function nonNegativeNumberOrNull(value) {
  const parsed = finiteNumberOrNull(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function normalizeAddress(value) {
  return cleanText(value).toLowerCase();
}

function normalizeKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeHttpUrl(value) {
  const text = cleanText(value);
  return /^https?:\/\//i.test(text) ? text : null;
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Expected a valid date.");
  return date.toISOString();
}

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function nullableRound(value, digits = 6) {
  return isFiniteNumber(value) ? round(value, digits) : null;
}
