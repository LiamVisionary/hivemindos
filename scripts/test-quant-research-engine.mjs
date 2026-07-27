#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const manifest = "native/quant-research-engine/Cargo.toml";

function bars(count = 160) {
  let close = 100;
  return Array.from({ length: count }, (_, index) => {
    const cycle = index % 24 < 16 ? 0.003 : -0.0015;
    close *= 1 + cycle + Math.sin(index / 7) * 0.0005;
    return {
      date: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
      symbol: "TEST",
      close: Number(close.toFixed(8)),
      volume: 1_000_000 + index * 1_000,
    };
  });
}

function request(overrides = {}) {
  return {
    schemaVersion: 1,
    researchOnly: true,
    dataset: {
      id: "point-in-time-fixture-v1",
      source: "test fixture",
      asOf: "2025-01-01T00:00:00Z",
      pointInTime: true,
      survivorshipBiasControlled: true,
      adjustedPrices: "split-and-dividend-adjusted",
      bars: bars(),
      ...overrides.dataset,
    },
    strategy: {
      id: "momentum-8",
      signal: { kind: "momentum", lookback: 8, threshold: 0 },
      executionLagBars: 1,
      allowShort: true,
      ...overrides.strategy,
    },
    costs: {
      commissionBps: 1,
      slippageBps: 2,
      annualBorrowBps: 50,
      ...overrides.costs,
    },
    split: { trainFraction: 0.6, purgeBars: 2, ...overrides.split },
  };
}

function run(input) {
  return spawnSync(
    "cargo",
    ["run", "--quiet", "--manifest-path", manifest],
    { input: JSON.stringify(input), encoding: "utf8", timeout: 120_000 },
  );
}

const paid = run(request());
assert.equal(paid.status, 0, paid.stderr);
const result = JSON.parse(paid.stdout);
assert.equal(result.schemaVersion, 1);
assert.equal(result.engine, "hivemindos-rust-quant-engine");
assert.equal(result.researchOnly, true);
assert.equal(result.execution.liveTradingEnabled, false);
assert.equal(result.execution.signalLagBars, 1);
assert.match(result.datasetHash, /^[a-f0-9]{64}$/);
assert.match(result.strategyHash, /^[a-f0-9]{64}$/);
assert.ok(result.observations.length > 100);
assert.ok(result.metrics.totalCost > 0);
assert.ok(Number.isFinite(result.metrics.sharpe));
assert.ok(Number.isFinite(result.metrics.maxDrawdown));
assert.ok(result.split.inSample.observations > result.split.outOfSample.observations);
assert.ok(result.split.purgeBars === 2);

const free = run(request({ costs: { commissionBps: 0, slippageBps: 0, annualBorrowBps: 0 } }));
assert.equal(free.status, 0, free.stderr);
const freeResult = JSON.parse(free.stdout);
assert.ok(
  freeResult.metrics.cumulativeReturn > result.metrics.cumulativeReturn,
  "cost-free return must exceed the same strategy with costs",
);

const changedBars = bars();
changedBars.at(-1).close *= 8;
const changed = run(request({ dataset: { bars: changedBars } }));
assert.equal(changed.status, 0, changed.stderr);
const changedResult = JSON.parse(changed.stdout);
assert.deepEqual(
  changedResult.observations.slice(0, -1).map((row) => row.position),
  result.observations.slice(0, -1).map((row) => row.position),
  "mutating the final close must not alter prior lagged positions",
);

const unsafeDataset = run(request({ dataset: { pointInTime: false } }));
assert.notEqual(unsafeDataset.status, 0, "non-point-in-time datasets must be rejected");
assert.match(unsafeDataset.stderr, /point.in.time/i);

const liveExecution = run({ ...request(), researchOnly: false });
assert.notEqual(liveExecution.status, 0, "the engine must reject live execution requests");
assert.match(liveExecution.stderr, /research.only/i);

console.log("Quant research Rust engine contract passed.");
