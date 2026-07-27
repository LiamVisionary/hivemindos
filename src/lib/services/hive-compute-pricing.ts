export const HIVE_COMPUTE_PROVIDER_PRICE_BOUNDS = {
  inputUsdMicroPerMTok: { min: 10_000, max: 20_000_000 },
  outputUsdMicroPerMTok: { min: 10_000, max: 30_000_000 },
  minimumJobUsdMicro: { min: 0, max: 1_000_000 },
} as const;

import type {
  HiveComputeModelBenchmark,
  HiveComputeModelPrice,
  HiveComputePricingConfig,
  HiveComputePricingStrategy,
} from "@/lib/types/hive-compute-marketplace";

export type {
  HiveComputeModelBenchmark,
  HiveComputeModelPrice,
  HiveComputePricingConfig,
  HiveComputePricingStrategy,
};

export type ResolvedHiveComputeModelPrice = HiveComputeModelPrice & {
  source: "benchmark" | "custom" | "starter";
};

const STARTER_PRICE: HiveComputeModelPrice = {
  inputUsdMicroPerMTok: 500_000,
  outputUsdMicroPerMTok: 750_000,
  minimumJobUsdMicro: 0,
};

const PRICE_INCREMENT_USD_MICRO = 10_000;
export const HIVE_COMPUTE_BENCHMARK_METHOD_VERSION = 2;
/** Benchmarks expire after 30 days: hardware load, model quantization, and
 * backend versions drift, and a stale tok/s sample misprices the ask. */
export const HIVE_COMPUTE_BENCHMARK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const HIVE_COMPUTE_AUTOMATIC_PRICE_REFERENCE_DATE = "2026-07-11";
export const HIVE_COMPUTE_AUTOMATIC_UNDERCUT_RATIO = 0.9;

type AutomaticMarketReference = HiveComputeModelPrice & {
  expectedOutputTokensPerSecond: number;
  label: string;
};

const EXACT_MARKET_REFERENCES: Array<{ pattern: RegExp; reference: AutomaticMarketReference }> = [
  {
    pattern: /gemma[^/]*\b(?:26|27|31)b\b/i,
    reference: marketReference(390_000, 970_000, 20, "Comparable hosted Gemma 26–31B"),
  },
  {
    pattern: /gemma[^/]*\be?4b\b/i,
    reference: marketReference(60_000, 120_000, 50, "Comparable hosted Gemma E4B"),
  },
  {
    pattern: /qwen[^/]*\b9b\b/i,
    reference: marketReference(170_000, 250_000, 45, "Comparable hosted Qwen 9B"),
  },
  {
    pattern: /gpt[-_. ]?oss[^/]*\b20b\b/i,
    reference: marketReference(50_000, 200_000, 45, "Comparable hosted GPT OSS 20B"),
  },
  {
    pattern: /gpt[-_. ]?oss[^/]*\b120b\b/i,
    reference: marketReference(150_000, 600_000, 20, "Comparable hosted GPT OSS 120B"),
  },
  {
    pattern: /llama[^/]*\b8b\b/i,
    reference: marketReference(140_000, 140_000, 45, "Comparable hosted Llama 8B"),
  },
  {
    pattern: /llama[^/]*\b70b\b/i,
    reference: marketReference(1_040_000, 1_040_000, 15, "Comparable hosted Llama 70B"),
  },
];

const GENERIC_MARKET_REFERENCES = {
  under4b: marketReference(100_000, 100_000, 55, "Hosted models under 4B"),
  from4bTo16b: marketReference(200_000, 200_000, 35, "Hosted models from 4B to 16B"),
  over16b: marketReference(900_000, 900_000, 18, "Hosted dense models over 16B"),
  moeThrough56b: marketReference(500_000, 500_000, 25, "Hosted MoE models through 56B"),
  moeThrough176b: marketReference(1_200_000, 1_200_000, 15, "Hosted MoE models from 56B to 176B"),
} as const;

function marketReference(
  inputUsdMicroPerMTok: number,
  outputUsdMicroPerMTok: number,
  expectedOutputTokensPerSecond: number,
  label: string,
): AutomaticMarketReference {
  return {
    inputUsdMicroPerMTok,
    outputUsdMicroPerMTok,
    minimumJobUsdMicro: 0,
    expectedOutputTokensPerSecond,
    label,
  };
}

function finiteNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  const parsed = finiteNumber(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: unknown, fallback = 0) {
  const parsed = finiteNumber(value, fallback);
  return parsed >= 0 ? Math.round(parsed) : fallback;
}

function pricingStrategy(value: unknown): HiveComputePricingStrategy {
  return value === "custom" ? "custom" : "balanced";
}

function normalizeModelPrice(value: unknown): HiveComputeModelPrice | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const inputUsdMicroPerMTok = nonNegativeInteger(record.inputUsdMicroPerMTok);
  const outputUsdMicroPerMTok = nonNegativeInteger(record.outputUsdMicroPerMTok);
  if (inputUsdMicroPerMTok <= 0 || outputUsdMicroPerMTok <= 0) return null;
  return {
    inputUsdMicroPerMTok,
    outputUsdMicroPerMTok,
    minimumJobUsdMicro: nonNegativeInteger(record.minimumJobUsdMicro),
  };
}

function normalizeBenchmark(value: unknown): HiveComputeModelBenchmark | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const inputTokensPerSecond = positiveNumber(record.inputTokensPerSecond, 0);
  const outputTokensPerSecond = positiveNumber(record.outputTokensPerSecond, 0);
  if (!inputTokensPerSecond || !outputTokensPerSecond) return null;
  const measuredAt = typeof record.measuredAt === "string" && record.measuredAt.trim()
    ? record.measuredAt.trim()
    : new Date(0).toISOString();
  return {
    inputTokensPerSecond,
    outputTokensPerSecond,
    measuredAt,
    sampleSize: Math.max(1, nonNegativeInteger(record.sampleSize, 1)),
    methodVersion: Math.max(1, nonNegativeInteger(record.methodVersion, 1)),
    warmupCompleted: record.warmupCompleted === true,
    source: "local-benchmark",
  };
}

function normalizeRecord<T>(value: unknown, normalize: (entry: unknown) => T | null): Record<string, T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries: Array<[string, T]> = [];
  for (const [modelId, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalize(entry);
    if (modelId.trim() && normalized) entries.push([modelId.trim(), normalized]);
  }
  return Object.fromEntries(entries);
}

export function normalizeHiveComputePricingConfig(value: unknown): HiveComputePricingConfig {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    pricingStrategy: pricingStrategy(record.pricingStrategy),
    targetHourlyUsd: 1,
    modelPrices: normalizeRecord(record.modelPrices, normalizeModelPrice),
    modelBenchmarks: normalizeRecord(record.modelBenchmarks, normalizeBenchmark),
  };
}

export function isHiveComputeBenchmarkCurrent(
  benchmark?: HiveComputeModelBenchmark | null,
  nowMs: number = Date.now(),
): benchmark is HiveComputeModelBenchmark {
  if (
    !benchmark ||
    benchmark.methodVersion < HIVE_COMPUTE_BENCHMARK_METHOD_VERSION ||
    !benchmark.warmupCompleted ||
    benchmark.sampleSize < 3
  ) {
    return false;
  }
  const measuredMs = Date.parse(benchmark.measuredAt);
  return Number.isFinite(measuredMs) && nowMs - measuredMs <= HIVE_COMPUTE_BENCHMARK_MAX_AGE_MS;
}

/** Fraction of the day a host is plausibly accepting jobs under its hostWhen
 * setting — used to scale daily/monthly projections, not the active-hour rate. */
export function hiveComputeAvailabilityFactor(
  hostWhen: "idle" | "always" | "sched",
  schedule?: { startHour: number; endHour: number } | null,
): number {
  if (hostWhen === "always") return 1;
  if (hostWhen === "sched") {
    if (!schedule) return 0.5;
    const span = schedule.endHour === schedule.startHour
      ? 24
      : ((schedule.endHour - schedule.startHour + 24) % 24);
    return Math.max(1, span) / 24;
  }
  // Idle-only: assume the machine sits idle roughly 14h of the day.
  return 0.6;
}

function inferredParameterBillions(modelId: string) {
  const matches = [...modelId.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)\s*b(?:[^a-z]|$)/gi)];
  return matches.reduce((largest, match) => Math.max(largest, Number(match[1]) || 0), 0);
}

function looksLikeMixtureOfExperts(modelId: string) {
  return /(?:\bmoe\b|mixtral|\d+b[-_. ]?a\d+b|gpt[-_. ]?oss)/i.test(modelId);
}

export function automaticMarketReferenceForModel(modelId: string): AutomaticMarketReference {
  const exact = EXACT_MARKET_REFERENCES.find((candidate) => candidate.pattern.test(modelId));
  if (exact) return exact.reference;

  const parameters = inferredParameterBillions(modelId);
  if (looksLikeMixtureOfExperts(modelId)) {
    return parameters > 56 ? GENERIC_MARKET_REFERENCES.moeThrough176b : GENERIC_MARKET_REFERENCES.moeThrough56b;
  }
  if (parameters > 0 && parameters < 4) return GENERIC_MARKET_REFERENCES.under4b;
  if (parameters > 0 && parameters <= 16) return GENERIC_MARKET_REFERENCES.from4bTo16b;
  return GENERIC_MARKET_REFERENCES.over16b;
}

function automaticPerformanceFactor(benchmark: HiveComputeModelBenchmark, reference: AutomaticMarketReference) {
  const relativeSpeed = benchmark.outputTokensPerSecond / reference.expectedOutputTokensPerSecond;
  return Math.min(1, Math.max(0.6, Math.sqrt(relativeSpeed)));
}

function automaticUndercutPrice(referenceUsdMicro: number, performanceFactor: number, max: number) {
  const rawUsdMicro = referenceUsdMicro * HIVE_COMPUTE_AUTOMATIC_UNDERCUT_RATIO * performanceFactor;
  const floored = Math.floor(rawUsdMicro / PRICE_INCREMENT_USD_MICRO) * PRICE_INCREMENT_USD_MICRO;
  return Math.min(max, Math.max(PRICE_INCREMENT_USD_MICRO, floored));
}

export function resolveHiveComputeModelPrice(
  modelId: string,
  config: HiveComputePricingConfig,
): ResolvedHiveComputeModelPrice {
  const custom = config.modelPrices[modelId];
  if (config.pricingStrategy === "custom" && custom) return { ...custom, source: "custom" };

  const benchmark = config.modelBenchmarks[modelId];
  if (!isHiveComputeBenchmarkCurrent(benchmark)) {
    return {
      ...(custom ?? STARTER_PRICE),
      source: custom ? "custom" : "starter",
    };
  }

  const reference = automaticMarketReferenceForModel(modelId);
  const performanceFactor = automaticPerformanceFactor(benchmark, reference);
  return {
    inputUsdMicroPerMTok: automaticUndercutPrice(
      reference.inputUsdMicroPerMTok,
      performanceFactor,
      HIVE_COMPUTE_PROVIDER_PRICE_BOUNDS.inputUsdMicroPerMTok.max,
    ),
    outputUsdMicroPerMTok: automaticUndercutPrice(
      reference.outputUsdMicroPerMTok,
      performanceFactor,
      HIVE_COMPUTE_PROVIDER_PRICE_BOUNDS.outputUsdMicroPerMTok.max,
    ),
    minimumJobUsdMicro: custom?.minimumJobUsdMicro ?? 0,
    source: "benchmark",
  };
}

type RouteModelCandidate = {
  id: string;
  price: Pick<HiveComputeModelPrice, "inputUsdMicroPerMTok" | "outputUsdMicroPerMTok" | "minimumJobUsdMicro">;
  benchmark?: HiveComputeModelBenchmark;
};

function priceWeight(candidate: RouteModelCandidate) {
  return candidate.price.inputUsdMicroPerMTok
    + candidate.price.outputUsdMicroPerMTok
    + candidate.price.minimumJobUsdMicro;
}

export function selectHiveComputeRouteModels(candidates: RouteModelCandidate[]) {
  const valid = candidates.filter((candidate) => candidate.id.trim());
  const cheapest = [...valid].sort((left, right) => priceWeight(left) - priceWeight(right))[0];
  const fastest = [...valid].sort((left, right) => {
    return (right.benchmark?.outputTokensPerSecond ?? 0) - (left.benchmark?.outputTokensPerSecond ?? 0)
      || priceWeight(left) - priceWeight(right);
  })[0];
  const deepest = [...valid].sort((left, right) => {
    return inferredParameterBillions(right.id) - inferredParameterBillions(left.id)
      || priceWeight(right) - priceWeight(left);
  })[0];
  return {
    auto: cheapest?.id ?? "",
    fast: fastest?.id ?? cheapest?.id ?? "",
    deep: deepest?.id ?? cheapest?.id ?? "",
  };
}

export function estimateHiveComputeEarnings(input: {
  models: Array<{ price: HiveComputeModelPrice; benchmark?: HiveComputeModelBenchmark }>;
  maxConcurrency: number;
  fallbackTargetHourlyUsd: number;
  platformFeeBps?: number;
  /** 0..1 share of the day the host accepts jobs (hiveComputeAvailabilityFactor). */
  availabilityFactor?: number;
}) {
  const concurrency = Math.max(1, Math.floor(input.maxConcurrency));
  const availability = Math.min(1, Math.max(0, input.availabilityFactor ?? 1));
  const measuredHourly = input.models
    .flatMap((model) => {
      const grossHourlyUsd = estimateHiveComputeModelGrossHourlyUsd(model);
      return grossHourlyUsd === null ? [] : [grossHourlyUsd];
    })
    .sort((left, right) => right - left)
    .slice(0, concurrency);
  const grossActiveHourlyUsd = measuredHourly.length
    ? measuredHourly.reduce((sum, value) => sum + value, 0)
    : Math.max(0, input.fallbackTargetHourlyUsd) * concurrency;
  const platformFeeBps = Math.min(10_000, Math.max(0, Math.round(input.platformFeeBps ?? 0)));
  const activeHourlyUsd = grossActiveHourlyUsd * (1 - platformFeeBps / 10_000);
  const rounded = (value: number) => Math.round(value * 100) / 100;
  const dayLowUsd = activeHourlyUsd * 24 * 0.1 * availability;
  const dayHighUsd = activeHourlyUsd * 24 * 0.3 * availability;
  return {
    activeHourlyUsd: rounded(activeHourlyUsd),
    dayLowUsd: rounded(dayLowUsd),
    dayHighUsd: rounded(dayHighUsd),
    monthLowUsd: rounded(dayLowUsd * 30),
    monthHighUsd: rounded(dayHighUsd * 30),
  };
}

export function estimateHiveComputeModelGrossHourlyUsd(model: {
  price: HiveComputeModelPrice;
  benchmark?: HiveComputeModelBenchmark;
}): number | null {
  if (!model.benchmark) return null;
  return (
    model.price.outputUsdMicroPerMTok
    * model.benchmark.outputTokensPerSecond
    * 3_600
  ) / 1_000_000_000_000;
}
