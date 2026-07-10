import assert from "node:assert/strict";

import {
  HIVE_COMPUTE_PRICING_STRATEGY_MULTIPLIERS,
  normalizeHiveComputePricingConfig,
  resolveHiveComputeModelPrice,
} from "../src/lib/services/hive-compute-pricing.ts";

const benchmark = {
  inputTokensPerSecond: 200,
  outputTokensPerSecond: 20,
  measuredAt: "2026-07-10T00:00:00.000Z",
  sampleSize: 2,
  source: "local-benchmark",
};

assert.deepEqual(HIVE_COMPUTE_PRICING_STRATEGY_MULTIPLIERS, {
  competitive: 0.8,
  balanced: 1,
  "max-earnings": 1.25,
  custom: 1,
});

const balanced = normalizeHiveComputePricingConfig({
  pricingStrategy: "balanced",
  targetHourlyUsd: 1,
  modelPrices: {},
  modelBenchmarks: { "large/model-100b": benchmark },
});
const balancedPrice = resolveHiveComputeModelPrice("large/model-100b", balanced);
assert.equal(balancedPrice.inputUsdMicroPerMTok, 1_390_000, "200 input tok/s at $1/hour should recommend $1.39/M");
assert.equal(balancedPrice.outputUsdMicroPerMTok, 13_890_000, "20 output tok/s at $1/hour should recommend $13.89/M");
assert.equal(balancedPrice.source, "benchmark", "measured auto-pricing must identify its benchmark source");

const fast = normalizeHiveComputePricingConfig({
  ...balanced,
  modelBenchmarks: {
    "large/model-100b": benchmark,
    "small/model-0.8b": { ...benchmark, inputTokensPerSecond: 2_000, outputTokensPerSecond: 200 },
  },
});
const fastPrice = resolveHiveComputeModelPrice("small/model-0.8b", fast);
assert.ok(fastPrice.outputUsdMicroPerMTok < balancedPrice.outputUsdMicroPerMTok, "faster small models must get a lower recommended token price");

const competitive = resolveHiveComputeModelPrice("large/model-100b", { ...balanced, pricingStrategy: "competitive" });
const maxEarnings = resolveHiveComputeModelPrice("large/model-100b", { ...balanced, pricingStrategy: "max-earnings" });
assert.equal(competitive.outputUsdMicroPerMTok, 11_110_000, "competitive pricing should be 20% below balanced after currency rounding");
assert.equal(maxEarnings.outputUsdMicroPerMTok, 17_360_000, "max-earnings pricing should be 25% above balanced after currency rounding");

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

console.log("Hive Compute pricing tests passed.");
