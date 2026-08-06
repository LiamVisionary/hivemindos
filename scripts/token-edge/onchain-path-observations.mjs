import {
  digestValue,
  TOKEN_EDGE_DATASET,
  TOKEN_EDGE_SCHEMA_VERSION,
} from "./onchain-forward-core.mjs";

export const TOKEN_EDGE_PATH_BUCKET_MS = 5 * 60_000;

export function buildPendingPathObservationTargets(events, now = new Date(), options = {}) {
  const nowMs = validDate(now).getTime();
  const horizon = options.horizon ?? "1h";
  const bucketMs = positiveInteger(options.bucketMs ?? TOKEN_EDGE_PATH_BUCKET_MS, "bucketMs");
  const maximumTargets = positiveInteger(options.maximumTargets ?? 20, "maximumTargets");
  const bucketStartedAt = new Date(Math.floor(nowMs / bucketMs) * bucketMs).toISOString();
  const resolvedForecastIds = new Set(events
    .filter((event) => event.type === "resolution" || event.type === "resolution-recovery")
    .map((event) => event.forecastId));
  const observedSnapshotBuckets = new Set(events
    .filter((event) => event.type === "forecast-path-observation")
    .map((event) => `${event.snapshotId}:${event.horizon}:${event.bucketStartedAt}`));
  const snapshots = new Map(events
    .filter((event) => event.type === "snapshot")
    .map((event) => [event.id, event]));
  const groups = new Map();

  for (const forecast of events) {
    if (forecast.type !== "forecast"
      || forecast.status !== "ready"
      || forecast.horizon !== horizon
      || forecast.predictedRise !== true
      || (options.modelVersion && forecast.modelVersion !== options.modelVersion)
      || (options.candidateId && forecast.candidateId !== options.candidateId)
      || (options.selectionProvider
        && forecast.selectionProvider !== options.selectionProvider)
      || (options.selectionTimeframe
        && forecast.selectionTimeframe !== options.selectionTimeframe)
      || (options.createdAfter
        && !(Date.parse(forecast.createdAt) > Date.parse(options.createdAfter)))
      || resolvedForecastIds.has(forecast.id)) continue;
    const createdAtMs = Date.parse(forecast.createdAt);
    const dueAtMs = Date.parse(forecast.dueAt);
    if (![createdAtMs, dueAtMs].every(Number.isFinite)
      || !(createdAtMs < nowMs && nowMs < dueAtMs)) continue;
    const snapshot = snapshots.get(forecast.snapshotId);
    if (!snapshot || snapshot.chain !== forecast.chain
      || snapshot.tokenAddress !== forecast.tokenAddress) continue;
    const groupKey = `${forecast.snapshotId}:${horizon}:${bucketStartedAt}`;
    if (observedSnapshotBuckets.has(groupKey)) continue;
    const group = groups.get(groupKey) ?? {
      snapshot,
      chain: forecast.chain,
      tokenAddress: forecast.tokenAddress,
      symbol: forecast.symbol ?? snapshot.market?.symbol ?? null,
      horizon,
      bucketStartedAt,
      forecastIds: [],
      createdAtMs,
      dueAtMs,
    };
    group.forecastIds.push(forecast.id);
    group.createdAtMs = Math.min(group.createdAtMs, createdAtMs);
    group.dueAtMs = Math.max(group.dueAtMs, dueAtMs);
    groups.set(groupKey, group);
  }

  return [...groups.values()]
    .sort((left, right) => left.dueAtMs - right.dueAtMs
      || left.tokenAddress.localeCompare(right.tokenAddress))
    .slice(0, maximumTargets)
    .map((group) => ({
      snapshotId: group.snapshot.id,
      chain: group.chain,
      tokenAddress: group.tokenAddress,
      symbol: group.symbol,
      horizon: group.horizon,
      signalCreatedAt: new Date(group.createdAtMs).toISOString(),
      dueAt: new Date(group.dueAtMs).toISOString(),
      bucketStartedAt: group.bucketStartedAt,
      forecastIds: [...group.forecastIds].sort(),
      entryMarket: group.snapshot.market,
    }));
}

export function createPathObservationEvent(target, market, observedAt = new Date()) {
  const observedAtIso = validDate(observedAt).toISOString();
  if (market?.observedAt !== observedAtIso) {
    throw new Error("Path market observation time must equal the event observation time.");
  }
  if (market?.tokenAddress !== target.tokenAddress || !(market?.priceUsd > 0)) {
    throw new Error("Path market evidence must match the target token and have a positive price.");
  }
  const entryPriceUsd = positiveNumber(target.entryMarket?.priceUsd, "entry price");
  const observedPriceUsd = positiveNumber(market.priceUsd, "observed price");
  const payload = {
    schemaVersion: TOKEN_EDGE_SCHEMA_VERSION,
    dataset: TOKEN_EDGE_DATASET,
    type: "forecast-path-observation",
    id: `forecast_path_${digestValue({
      snapshotId: target.snapshotId,
      bucketStartedAt: target.bucketStartedAt,
      horizon: target.horizon,
    }).slice(0, 24)}`,
    snapshotId: target.snapshotId,
    forecastIds: [...target.forecastIds],
    chain: target.chain,
    tokenAddress: target.tokenAddress,
    symbol: target.symbol,
    horizon: target.horizon,
    signalCreatedAt: target.signalCreatedAt,
    dueAt: target.dueAt,
    bucketStartedAt: target.bucketStartedAt,
    observedAt: observedAtIso,
    observationMode: "live-point-in-time-path",
    entryMarketObservedAt: target.entryMarket.observedAt,
    entryPairAddress: target.entryMarket.pairAddress,
    entryPriceUsd,
    entryLiquidityUsd: positiveNumber(target.entryMarket.liquidityUsd, "entry liquidity"),
    observedPairAddress: market.pairAddress,
    observedPriceUsd,
    observedLiquidityUsd: positiveNumber(market.liquidityUsd, "observed liquidity"),
    grossReturnFromEntryPct: round(((observedPriceUsd / entryPriceUsd) - 1) * 100, 6),
    providerPriceIntegrity: market.providerPriceIntegrity ?? null,
    researchOnly: true,
    mutationAllowed: false,
  };
  return payload;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer.`);
  return number;
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be positive.`);
  return number;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("A valid path-observation time is required.");
  return date;
}

function round(value, digits) {
  return Math.round(value * (10 ** digits)) / (10 ** digits);
}
