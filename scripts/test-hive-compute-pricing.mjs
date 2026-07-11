import assert from "node:assert/strict";

import {
  HIVE_COMPUTE_AUTOMATIC_PRICE_REFERENCE_DATE,
  HIVE_COMPUTE_AUTOMATIC_UNDERCUT_RATIO,
  HIVE_COMPUTE_BENCHMARK_MAX_AGE_MS,
  HIVE_COMPUTE_BENCHMARK_METHOD_VERSION as pricingBenchmarkMethodVersion,
  automaticMarketReferenceForModel,
  estimateHiveComputeEarnings,
  hiveComputeAvailabilityFactor,
  isHiveComputeBenchmarkCurrent,
  normalizeHiveComputePricingConfig,
  resolveHiveComputeModelPrice,
  selectHiveComputeRouteModels,
} from "../src/lib/services/hive-compute-pricing.ts";
import { HIVE_COMPUTE_BENCHMARK_METHOD_VERSION as benchmarkServiceMethodVersion } from "../src/lib/services/hive-compute-benchmark.ts";
import { formatGigabytes, hiveComputeMemoryFit } from "../src/components/fleet/hive-compute-memory-fit.ts";

// measuredAt is relative to now: benchmarks expire after 30 days, and a fixed
// date here would turn into a time-bomb test failure.
const benchmark = {
  inputTokensPerSecond: 200,
  outputTokensPerSecond: 20,
  measuredAt: new Date(Date.now() - 60_000).toISOString(),
  sampleSize: 3,
  methodVersion: 2,
  warmupCompleted: true,
  source: "local-benchmark",
};

assert.equal(HIVE_COMPUTE_AUTOMATIC_PRICE_REFERENCE_DATE, "2026-07-11");
assert.equal(HIVE_COMPUTE_AUTOMATIC_UNDERCUT_RATIO, 0.9);
assert.equal(pricingBenchmarkMethodVersion, benchmarkServiceMethodVersion, "pricing and benchmark services must agree on the current measurement version");
assert.equal(isHiveComputeBenchmarkCurrent(benchmark), true);

// Benchmarks expire: hardware and backend drift make an old tok/s sample
// misprice the ask, so a measurement past the max age needs re-running.
const measuredMs = Date.parse(benchmark.measuredAt);
assert.equal(isHiveComputeBenchmarkCurrent(benchmark, measuredMs + HIVE_COMPUTE_BENCHMARK_MAX_AGE_MS - 1), true, "a benchmark inside the age window stays current");
assert.equal(isHiveComputeBenchmarkCurrent(benchmark, measuredMs + HIVE_COMPUTE_BENCHMARK_MAX_AGE_MS + 1), false, "a benchmark past the age window must expire");
assert.equal(isHiveComputeBenchmarkCurrent({ ...benchmark, measuredAt: "not-a-date" }), false, "an unparseable measurement date must not count as current");

// Availability scales daily/monthly projections by how often the host accepts
// jobs (never the active-hour rate).
assert.equal(hiveComputeAvailabilityFactor("always"), 1);
assert.equal(hiveComputeAvailabilityFactor("idle"), 0.6);
assert.equal(hiveComputeAvailabilityFactor("sched", null), 0.5, "scheduled hosting without a window assumes half-day availability");
assert.equal(hiveComputeAvailabilityFactor("sched", { startHour: 22, endHour: 8 }), 10 / 24, "overnight windows wrap past midnight");
assert.equal(hiveComputeAvailabilityFactor("sched", { startHour: 9, endHour: 17 }), 8 / 24);
assert.equal(hiveComputeAvailabilityFactor("sched", { startHour: 5, endHour: 5 }), 1, "equal hours mean all day");

// Memory-fit heuristic: the N largest advertised models must fit in 75% of
// physical memory at N concurrent slots; unknown sizes never block.
const GB = 1024 ** 3;
const memModels = [
  { id: "big-70b", sizeBytes: 40 * GB },
  { id: "mid-8b", sizeBytes: 5 * GB },
  { id: "no-size" },
];
assert.equal(hiveComputeMemoryFit(memModels, 1, 64 * GB)?.fits, true, "one 40GB model fits a 64GB machine");
const tight = hiveComputeMemoryFit(memModels, 2, 48 * GB);
assert.equal(tight?.fits, false, "40GB + 5GB at 2 slots must warn on a 48GB machine");
assert.equal(tight?.totalBytes, 45 * GB);
assert.equal(tight?.unsizedCount, 1, "models without a reported size are counted as unsized");
assert.equal(hiveComputeMemoryFit([{ id: "no-size" }], 2, 64 * GB), null, "no sized models means no verdict");
assert.equal(hiveComputeMemoryFit(memModels, 1, 0), null, "unknown machine memory means no verdict");
assert.equal(formatGigabytes(45 * GB), "45 GB");
assert.equal(formatGigabytes(5.25 * GB), "5.3 GB");
assert.equal(automaticMarketReferenceForModel("openai/gpt-oss-120b").outputUsdMicroPerMTok, 600_000, "120B exact references must not collide with 20B model names");

const balanced = normalizeHiveComputePricingConfig({
  pricingStrategy: "balanced",
  targetHourlyUsd: 1,
  modelPrices: {},
  modelBenchmarks: { "large/model-100b": benchmark },
});
const balancedPrice = resolveHiveComputeModelPrice("large/model-100b", balanced);
assert.equal(balancedPrice.inputUsdMicroPerMTok, 810_000, "automatic pricing should undercut the generic hosted-model reference");
assert.equal(balancedPrice.outputUsdMicroPerMTok, 810_000, "benchmark throughput must not inflate automatic pricing above the market reference");
assert.equal(balancedPrice.source, "benchmark", "automatic pricing still requires a current local benchmark");

const fast = normalizeHiveComputePricingConfig({
  ...balanced,
  modelBenchmarks: {
    "large/model-100b": benchmark,
    "small/model-0.8b": { ...benchmark, inputTokensPerSecond: 2_000, outputTokensPerSecond: 200 },
  },
});
const fastPrice = resolveHiveComputeModelPrice("small/model-0.8b", fast);
assert.ok(fastPrice.outputUsdMicroPerMTok < balancedPrice.outputUsdMicroPerMTok, "faster small models must get a lower recommended token price");
assert.deepEqual(selectHiveComputeRouteModels([
  { id: "large/model-100b", price: balancedPrice, benchmark },
  { id: "small/model-0.8b", price: fastPrice, benchmark: fast.modelBenchmarks["small/model-0.8b"] },
]), {
  auto: "small/model-0.8b",
  fast: "small/model-0.8b",
  deep: "large/model-100b",
}, "auto/fast/deep aliases must select models by price, measured speed, and inferred capacity");

const screenshotConfig = normalizeHiveComputePricingConfig({
  pricingStrategy: "balanced",
  modelBenchmarks: {
    "swarm-sovereign-12b": { ...benchmark, inputTokensPerSecond: 42.67, outputTokensPerSecond: 39.81 },
    "supergemma4-26b-uncensored-v2": { ...benchmark, inputTokensPerSecond: 44.29, outputTokensPerSecond: 61.06 },
  },
});
assert.deepEqual(resolveHiveComputeModelPrice("swarm-sovereign-12b", screenshotConfig), {
  inputUsdMicroPerMTok: 180_000,
  outputUsdMicroPerMTok: 180_000,
  minimumJobUsdMicro: 0,
  source: "benchmark",
}, "the measured 12B model should fall from $6+ to $0.18/M automatically");
assert.deepEqual(resolveHiveComputeModelPrice("supergemma4-26b-uncensored-v2", screenshotConfig), {
  inputUsdMicroPerMTok: 350_000,
  outputUsdMicroPerMTok: 870_000,
  minimumJobUsdMicro: 0,
  source: "benchmark",
}, "the measured Gemma-family 26B model should undercut its comparable hosted reference");
const gemmaReference = automaticMarketReferenceForModel("supergemma4-26b-uncensored-v2");
const gemmaAutomatic = resolveHiveComputeModelPrice("supergemma4-26b-uncensored-v2", screenshotConfig);
assert(gemmaAutomatic.inputUsdMicroPerMTok < gemmaReference.inputUsdMicroPerMTok);
assert(gemmaAutomatic.outputUsdMicroPerMTok < gemmaReference.outputUsdMicroPerMTok);

const earnings = estimateHiveComputeEarnings({
  models: [{ price: balancedPrice, benchmark }],
  maxConcurrency: 1,
  fallbackTargetHourlyUsd: 1,
  platformFeeBps: 2_000,
});
assert.equal(earnings.activeHourlyUsd, 0.05, "provider projection must use the competitive ask and deduct the gateway's published 20% fee");
assert.equal(earnings.dayLowUsd, 0.11, "low projection should model 10% utilization after the platform fee");
assert.equal(earnings.dayHighUsd, 0.34, "high projection should model 30% utilization after the platform fee");

const mixedModelEarnings = estimateHiveComputeEarnings({
  models: [
    {
      price: { inputUsdMicroPerMTok: 100_000, outputUsdMicroPerMTok: 1_000_000, minimumJobUsdMicro: 0 },
      benchmark: { ...benchmark, outputTokensPerSecond: 100 },
    },
    {
      price: { inputUsdMicroPerMTok: 100_000, outputUsdMicroPerMTok: 3_000_000, minimumJobUsdMicro: 0 },
      benchmark: { ...benchmark, outputTokensPerSecond: 100 },
    },
  ],
  maxConcurrency: 1,
  fallbackTargetHourlyUsd: 1,
  platformFeeBps: 2_000,
});
assert.equal(mixedModelEarnings.activeHourlyUsd, 0.86, "one slot must retain the highest model-specific earning potential");
const twoSlotMixedModelEarnings = estimateHiveComputeEarnings({
  models: [
    {
      price: { inputUsdMicroPerMTok: 100_000, outputUsdMicroPerMTok: 1_000_000, minimumJobUsdMicro: 0 },
      benchmark: { ...benchmark, outputTokensPerSecond: 100 },
    },
    {
      price: { inputUsdMicroPerMTok: 100_000, outputUsdMicroPerMTok: 3_000_000, minimumJobUsdMicro: 0 },
      benchmark: { ...benchmark, outputTokensPerSecond: 100 },
    },
  ],
  maxConcurrency: 2,
  fallbackTargetHourlyUsd: 1,
  platformFeeBps: 2_000,
});
assert.equal(twoSlotMixedModelEarnings.activeHourlyUsd, 1.15, "the selected-model average must scale with configured concurrent slots");

const idleOnlyEarnings = estimateHiveComputeEarnings({
  models: [{ price: balancedPrice, benchmark }],
  maxConcurrency: 1,
  fallbackTargetHourlyUsd: 1,
  platformFeeBps: 2_000,
  availabilityFactor: 0.5,
});
assert.equal(idleOnlyEarnings.activeHourlyUsd, earnings.activeHourlyUsd, "availability must not change the active-hour rate");
assert.equal(idleOnlyEarnings.dayHighUsd, Math.round(earnings.dayHighUsd / 2 * 100) / 100, "availability must scale the daily projection");

const bounded = resolveHiveComputeModelPrice("slow/model", normalizeHiveComputePricingConfig({
  pricingStrategy: "balanced",
  targetHourlyUsd: 50,
  modelBenchmarks: { "slow/model": { ...benchmark, inputTokensPerSecond: 1, outputTokensPerSecond: 1 } },
}));
assert.equal(bounded.inputUsdMicroPerMTok, 480_000, "a slow benchmark may only discount the automatic input ask");
assert.equal(bounded.outputUsdMicroPerMTok, 480_000, "retired hourly targets must never inflate an automatic ask");

const custom = normalizeHiveComputePricingConfig({
  pricingStrategy: "custom",
  targetHourlyUsd: 1,
  modelBenchmarks: { "large/model-100b": benchmark },
  modelPrices: {
    "large/model-100b": {
      inputUsdMicroPerMTok: 2_500_000,
      outputUsdMicroPerMTok: 9_750_000,
      minimumJobUsdMicro: 2_000,
    },
  },
});
assert.deepEqual(resolveHiveComputeModelPrice("large/model-100b", custom), {
  inputUsdMicroPerMTok: 2_500_000,
  outputUsdMicroPerMTok: 9_750_000,
  minimumJobUsdMicro: 2_000,
  source: "custom",
}, "custom per-model prices must survive exactly");

const migrated = normalizeHiveComputePricingConfig({ markdown: 20 });
assert.equal(migrated.pricingStrategy, "balanced", "legacy markdown configs should migrate to balanced auto-pricing");
assert.equal(migrated.targetHourlyUsd, 1, "legacy configs should receive the safe target-hourly default");
assert.deepEqual(migrated.modelPrices, {});
assert.deepEqual(migrated.modelBenchmarks, {});

const unbenchmarked = resolveHiveComputeModelPrice("unknown/model", migrated);
assert.equal(unbenchmarked.source, "starter", "unbenchmarked models must be labeled as starter estimates, never measured prices");
assert.equal(unbenchmarked.inputUsdMicroPerMTok, 500_000);
assert.equal(unbenchmarked.outputUsdMicroPerMTok, 750_000);

const legacyBenchmarkConfig = normalizeHiveComputePricingConfig({
  modelBenchmarks: {
    "legacy/model-12b": {
      inputTokensPerSecond: 42,
      outputTokensPerSecond: 40,
      measuredAt: "2026-07-10T00:00:00.000Z",
      sampleSize: 2,
      source: "local-benchmark",
    },
  },
});
assert.equal(isHiveComputeBenchmarkCurrent(legacyBenchmarkConfig.modelBenchmarks["legacy/model-12b"]), false);
assert.equal(resolveHiveComputeModelPrice("legacy/model-12b", legacyBenchmarkConfig).source, "starter", "old cold-start-prone measurements must require a fresh benchmark");

const migratedStrategy = normalizeHiveComputePricingConfig({
  pricingStrategy: "max-earnings",
  targetHourlyUsd: 10,
});
assert.equal(migratedStrategy.pricingStrategy, "balanced", "retired host strategies must migrate to Automatic pricing");
assert.equal(migratedStrategy.targetHourlyUsd, 1, "retired hourly targets must not continue affecting hidden automatic prices");

console.log("Hive Compute pricing tests passed.");
