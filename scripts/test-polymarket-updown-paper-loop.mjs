import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyUpDownSnapshot,
  calculateUpDownArmMetrics,
  createUpDownPaperState,
  createUpDownPolicyVariants,
  evaluateUpDownConsistentProfit,
  evolveUpDownGeneration,
  runUpDownPaperStep,
  settleUpDownMarket,
  UPDOWN_CONSISTENT_PROFIT_MIN_SETTLED_MARKETS,
  UPDOWN_PAPER_STARTING_BALANCE_USD,
} from "../src/lib/services/trading/prediction-updown-paper-loop.ts";

const feeSchedule = { rate: 0.07, exponent: 1, takerOnly: true, rebateRate: 0.2 };

function syntheticSnapshot(overrides = {}) {
  return {
    observedAt: "2026-08-01T00:00:00.000Z",
    marketId: "market-1",
    conditionId: "condition-1",
    slug: "btc-updown-15m-1785542400",
    title: "Bitcoin Up or Down",
    asset: "btc",
    intervalMinutes: 15,
    resolutionDate: "2026-08-01T00:15:00.000Z",
    feesEnabled: true,
    feeSchedule,
    sides: [
      { outcomeId: "10000000001", label: "Up", askPrice: 0.3, askSize: 100, minimumOrderSize: 5 },
      { outcomeId: "10000000002", label: "Down", askPrice: 0.72, askSize: 100, minimumOrderSize: 5 },
    ],
    ...overrides,
  };
}

function result(index, pnlUsd, fillCount = 1) {
  return {
    slug: `btc-updown-${index % 2 ? 5 : 15}m-${1785542400 + index * 900}`,
    settledAt: new Date(Date.UTC(2026, 7, 1) + index * 900_000).toISOString(),
    asset: ["btc", "eth", "sol", "xrp"][index % 4],
    intervalMinutes: index % 2 ? 5 : 15,
    winnerOutcomeId: "10000000001",
    pnlUsd,
    feeUsd: 0.001,
    sharesBought: 0.1,
    fillCount,
  };
}

test("starts equal-bankroll cash, champion, and four one-change challengers", () => {
  const state = createUpDownPaperState(new Date("2026-08-01T00:00:00.000Z"));
  const generation = state.generations[0];
  assert.equal(generation.arms.length, 6);
  assert.deepEqual(new Set(generation.arms.map((arm) => arm.startingBalanceUsd)), new Set([UPDOWN_PAPER_STARTING_BALANCE_USD]));
  assert.equal(generation.arms.filter((arm) => arm.role === "challenger").length, 4);
  const champion = generation.arms.find((arm) => arm.role === "champion");
  const variants = createUpDownPolicyVariants(champion.policy);
  for (const variant of variants) {
    const changed = Object.keys(variant.policy).filter((key) => variant.policy[key] !== champion.policy[key]);
    assert.deepEqual(changed, [variant.changedDimension]);
  }
});

test("uses displayed ask depth and current taker fees for temporal pairs", () => {
  const state = createUpDownPaperState(new Date("2026-08-01T00:00:00.000Z"));
  const generation = state.generations[0];
  const firstFills = applyUpDownSnapshot(generation, syntheticSnapshot(), "run-1");
  assert.equal(firstFills.some((fill) => fill.armId === "champion" && fill.reason === "temporal-first-leg"), true);
  const second = syntheticSnapshot({
    observedAt: "2026-08-01T00:05:00.000Z",
    sides: [
      { outcomeId: "10000000001", label: "Up", askPrice: 0.4, askSize: 100, minimumOrderSize: 5 },
      { outcomeId: "10000000002", label: "Down", askPrice: 0.66, askSize: 100, minimumOrderSize: 5 },
    ],
  });
  const secondFills = applyUpDownSnapshot(generation, second, "run-2");
  assert.equal(secondFills.some((fill) => fill.armId === "champion" && fill.reason === "complete-pair"), true);
  assert.equal(secondFills.some((fill) => fill.armId === "challenger-pair" && fill.reason === "complete-pair"), false);
  const champion = generation.arms.find((arm) => arm.id === "champion");
  assert.ok(champion.cashUsd < UPDOWN_PAPER_STARTING_BALANCE_USD);
  assert.ok(champion.positions[second.slug].fills.every((fill) => fill.feeUsd > 0));
});

test("settles every arm on the same market, including zero-PnL cash observations", () => {
  const state = createUpDownPaperState(new Date("2026-08-01T00:00:00.000Z"));
  const generation = state.generations[0];
  const snapshot = syntheticSnapshot();
  applyUpDownSnapshot(generation, snapshot, "run-1");
  const settled = settleUpDownMarket(generation, {
    marketId: snapshot.marketId,
    conditionId: snapshot.conditionId,
    slug: snapshot.slug,
    title: snapshot.title,
    asset: snapshot.asset,
    intervalMinutes: snapshot.intervalMinutes,
    resolutionDate: snapshot.resolutionDate,
    outcomeIds: [snapshot.sides[0].outcomeId, snapshot.sides[1].outcomeId],
    outcomeLabels: [snapshot.sides[0].label, snapshot.sides[1].label],
    status: "closed",
    winnerOutcomeId: snapshot.sides[0].outcomeId,
    settledAt: "2026-08-01T00:16:00.000Z",
  }, "2026-08-01T00:16:00.000Z");
  assert.equal(settled, 1);
  assert.ok(generation.arms.every((arm) => arm.results.length === 1));
  assert.equal(generation.arms.find((arm) => arm.role === "cash-control").results[0].pnlUsd, 0);
});

test("promotes only a one-change challenger with positive paired forward evidence", () => {
  const state = createUpDownPaperState(new Date("2026-07-30T00:00:00.000Z"));
  const generation = state.generations[0];
  for (const arm of generation.arms) {
    arm.results = Array.from({ length: 64 }, (_, index) => result(
      index,
      arm.id === "challenger-entry" ? 0.05 : arm.role === "champion" ? -0.05 : arm.role === "cash-control" ? 0 : -0.1,
      arm.role === "cash-control" ? 0 : 1,
    ));
  }
  const evolution = evolveUpDownGeneration(state, new Date("2026-08-01T00:00:00.000Z"));
  assert.equal(evolution.evaluated, true);
  assert.equal(evolution.promotedArmId, "challenger-entry");
  assert.equal(state.generations.length, 2);
  assert.equal(state.generations[1].arms.find((arm) => arm.role === "champion").policy.version, 2);
});

test("consistent-profit gate requires the full robust evidence set", () => {
  const state = createUpDownPaperState(new Date("2026-08-01T00:00:00.000Z"));
  const champion = state.generations[0].arms.find((arm) => arm.role === "champion");
  champion.results = Array.from(
    { length: UPDOWN_CONSISTENT_PROFIT_MIN_SETTLED_MARKETS },
    (_, index) => result(index, 0.05),
  );
  state.runCount = UPDOWN_CONSISTENT_PROFIT_MIN_SETTLED_MARKETS;
  const metrics = calculateUpDownArmMetrics(champion);
  const report = evaluateUpDownConsistentProfit(state, new Date("2026-08-02T00:00:00.000Z"));
  assert.equal(metrics.settledMarkets, 252);
  assert.equal(report.passed, true);
  assert.ok(Object.values(report.gates).every(Boolean));

  champion.positions["still-open"] = {
    slug: "still-open",
    asset: "btc",
    intervalMinutes: 15,
    resolutionDate: "2026-08-03T00:00:00.000Z",
    legs: {},
    fills: [],
  };
  assert.equal(evaluateUpDownConsistentProfit(state).gates.noOpenChampionPositions, false);
  delete champion.positions["still-open"];
  champion.results.length = 251;
  assert.equal(evaluateUpDownConsistentProfit(state).passed, false);
});

function mockPolymarketFetcher() {
  return async (input, init = {}) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "gamma-api.polymarket.com") {
      const slug = url.pathname.split("/").at(-1);
      const match = /^(btc|eth|sol|xrp)-updown-(5|15)m-(\d+)$/.exec(slug);
      assert.ok(match, `unexpected slug ${slug}`);
      const intervalSeconds = Number(match[2]) * 60;
      const epoch = Number(match[3]);
      return Response.json({
        id: slug,
        conditionId: `condition-${slug}`,
        question: `${match[1]} Up or Down`,
        slug,
        outcomes: JSON.stringify(["Up", "Down"]),
        outcomePrices: JSON.stringify(["0.3", "0.7"]),
        clobTokenIds: JSON.stringify(["10000000001", "10000000002"]),
        endDate: new Date((epoch + intervalSeconds) * 1_000).toISOString(),
        closed: false,
        acceptingOrders: true,
        feesEnabled: true,
        feeSchedule,
        orderMinSize: 5,
        orderPriceMinTickSize: 0.01,
      });
    }
    if (url.hostname === "clob.polymarket.com" && url.pathname === "/books") {
      const requested = JSON.parse(init.body);
      return Response.json(requested.map(({ token_id }) => ({
        asset_id: token_id,
        min_order_size: "5",
        tick_size: "0.01",
        bids: [{ price: token_id.endsWith("1") ? "0.29" : "0.69", size: "100" }],
        asks: [{ price: token_id.endsWith("1") ? "0.30" : "0.70", size: "100" }],
        timestamp: "1785542400000",
      })));
    }
    return new Response("not found", { status: 404 });
  };
}

test("real step entry path writes immutable lineage and references prior runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "updown-paper-test-"));
  try {
    const fetcher = mockPolymarketFetcher();
    const first = await runUpDownPaperStep({ root, fetcher, now: new Date("2026-08-01T00:00:00.000Z") });
    const second = await runUpDownPaperStep({ root, fetcher, now: new Date("2026-08-01T00:00:05.000Z") });
    const third = await runUpDownPaperStep({ root, fetcher, now: new Date("2026-08-01T00:05:00.000Z") });
    assert.equal(first.run.snapshotCount, 8, JSON.stringify(first.run.errors));
    assert.equal(first.run.snapshots.length, 8);
    assert.equal(first.run.generationId, "generation-1");
    assert.equal(second.run.priorRunId, first.run.runId);
    assert.deepEqual(second.run.reflection.referencedPriorRunIds, [first.run.runId]);
    assert.equal(third.run.snapshotCount, 8);
    assert.deepEqual(third.run.errors, []);
    assert.equal(third.run.priorRunId, second.run.runId);
    const runFiles = await readdir(join(root, "runs"));
    assert.equal(runFiles.length, 3);
    assert.match(await readFile(join(root, "runs", `${first.run.runId}.json`), "utf8"), /"publicReadsOnly": true/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bounds a stalled public read and preserves it as missing evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "updown-paper-timeout-test-"));
  let aborted = false;
  const stalledFetcher = (_input, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      aborted = true;
      reject(init.signal.reason ?? new Error("aborted"));
    }, { once: true });
  });
  try {
    const result = await Promise.race([
      runUpDownPaperStep({
        root,
        fetcher: stalledFetcher,
        fetchTimeoutMs: 20,
        now: new Date("2026-08-01T00:00:00.000Z"),
      }),
      new Promise((resolve) => setTimeout(() => resolve("test-hung"), 250)),
    ]);
    assert.notEqual(result, "test-hung", "the paper step must not hang on a stalled public read");
    assert.equal(aborted, true);
    assert.equal(result.run.snapshotCount, 0);
    assert.equal(result.run.fills.length, 0);
    assert.equal(result.run.errors.length, 8);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loop source has no venue write or signing path", async () => {
  const service = await readFile(new URL("../src/lib/services/trading/prediction-updown-paper-loop.ts", import.meta.url), "utf8");
  const cli = await readFile(new URL("./polymarket-updown-paper-loop.mjs", import.meta.url), "utf8");
  const source = `${service}\n${cli}`;
  assert.doesNotMatch(source, /createAndPostOrder|postOrder|cancelOrder|privateKey|signatureType|POLYMARKET_PRIVATE/i);
  assert.match(source, /publicReadsOnly: true/);
});
