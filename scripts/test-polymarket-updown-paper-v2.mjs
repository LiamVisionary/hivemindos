import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildUpDownLossAttribution,
  createUpDownV2Generation,
  DEFAULT_UPDOWN_V2_POLICY,
  evaluateUpDownNegativeEvidence,
  evaluateUpDownV2Review,
  generateUpDownPolicyCandidates,
} from "../src/lib/services/trading/prediction-updown-learning.ts";
import {
  runUpDownV2PaperStep,
  migrateUnscoredUpDownV2PolicyContract,
  summarizeUpDownV2State,
} from "../src/lib/services/trading/prediction-updown-paper-v2.ts";
import { applyUpDownSnapshot } from "../src/lib/services/trading/prediction-updown-paper-loop.ts";

const feeSchedule = { rate: 0.07, exponent: 1, takerOnly: true, rebateRate: 0.2 };

function result(index, pnlUsd, fillCount = 1) {
  return {
    slug: `btc-updown-${index % 2 ? 5 : 15}m-${1785542400 + index * 900}`,
    settledAt: new Date(Date.UTC(2026, 7, 1) + index * 900_000).toISOString(),
    asset: ["btc", "eth", "sol", "xrp"][index % 4],
    intervalMinutes: index % 2 ? 5 : 15,
    winnerOutcomeId: "10000000001",
    pnlUsd,
    feeUsd: fillCount ? 0.001 : 0,
    sharesBought: fillCount ? 0.1 : 0,
    fillCount,
  };
}

function fill(index, overrides = {}) {
  const marketResult = result(index, -0.05);
  return {
    runId: `run-${index}`,
    observedAt: new Date(Date.parse(marketResult.settledAt) - 180_000).toISOString(),
    slug: marketResult.slug,
    outcomeId: "10000000002",
    outcomeLabel: "Down",
    reason: "temporal-first-leg",
    shares: 0.1,
    price: 0.25,
    notionalUsd: 0.025,
    feeUsd: 0.001,
    capitalUsd: 0.026,
    ...overrides,
  };
}

function champion(generation) {
  return generation.arms.find((arm) => arm.role === "champion");
}

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
      { outcomeId: "10000000002", label: "Down", askPrice: 0.6, askSize: 100, minimumOrderSize: 5 },
    ],
    ...overrides,
  };
}

test("freezes four one-change candidates before any v2 outcome", () => {
  const generation = createUpDownV2Generation({
    id: "generation-1",
    now: new Date("2026-08-01T00:00:00.000Z"),
    championPolicy: { ...DEFAULT_UPDOWN_V2_POLICY },
  });
  const base = champion(generation).policy;
  const challengers = generation.arms.filter((arm) => arm.role === "challenger");
  assert.equal(challengers.length, 4);
  assert.equal(generation.registration.v2OutcomesObservedBeforeFreeze, 0);
  assert.equal(generation.registration.priorEvidenceExcludedFromScoring, true);
  for (const arm of challengers) {
    const changed = Object.keys(base).filter((key) => JSON.stringify(base[key]) !== JSON.stringify(arm.policy[key]));
    assert.deepEqual(changed, [arm.changedDimension]);
  }
});

test("immediate-pair mode is atomic and never leaves one paper leg", () => {
  const generation = createUpDownV2Generation({
    id: "generation-1",
    now: new Date("2026-08-01T00:00:00.000Z"),
    championPolicy: { ...DEFAULT_UPDOWN_V2_POLICY },
  });
  const fills = applyUpDownSnapshot(generation, syntheticSnapshot(), "run-1")
    .filter((row) => row.armId === "champion");
  assert.equal(fills.length, 2);
  assert.ok(fills.every((row) => row.reason === "immediate-pair"));
  assert.equal(Object.keys(champion(generation).positions[syntheticSnapshot().slug].legs).length, 2);

  const blocked = createUpDownV2Generation({
    id: "generation-blocked",
    now: new Date("2026-08-01T00:00:00.000Z"),
    championPolicy: { ...DEFAULT_UPDOWN_V2_POLICY },
  });
  const noFills = applyUpDownSnapshot(blocked, syntheticSnapshot({
    sides: [
      { outcomeId: "10000000001", label: "Up", askPrice: 0.3, askSize: 10, minimumOrderSize: 5 },
      { outcomeId: "10000000002", label: "Down", askPrice: 0.6, askSize: 1, minimumOrderSize: 5 },
    ],
  }), "run-2").filter((row) => row.armId === "champion");
  assert.equal(noFills.length, 0);
  assert.equal(champion(blocked).positions[syntheticSnapshot().slug], undefined);
});

test("upgrades an unscored temporal prototype into a new future-only contract", () => {
  const oldGeneration = createUpDownV2Generation({
    id: "generation-1",
    now: new Date("2026-08-01T00:00:00.000Z"),
    championPolicy: { ...DEFAULT_UPDOWN_V2_POLICY, entryMode: "temporal" },
  });
  delete oldGeneration.registration.policyContractVersion;
  const state = {
    generations: [oldGeneration],
    activeGenerationId: oldGeneration.id,
    consumedAppliedLearningProposalIds: [],
    historicalDerivation: { attribution: null },
  };
  const migration = migrateUnscoredUpDownV2PolicyContract({
    state,
    now: new Date("2026-08-01T00:01:00.000Z"),
  });
  assert.ok(migration);
  assert.equal(migration.closedGeneration.status, "closed");
  assert.equal(migration.replacementGeneration.registration.policyContractVersion, 2);
  assert.equal(champion(migration.replacementGeneration).policy.entryMode, "immediate-pair");
  assert.equal(state.activeGenerationId, "generation-2");
});

test("turns applied Shared Brain learning into one bounded future candidate only", () => {
  const candidates = generateUpDownPolicyCandidates({
    base: { ...DEFAULT_UPDOWN_V2_POLICY },
    appliedLearning: [{
      proposalId: "review-1",
      appliedMemoryId: "memory-1",
      dimension: "allowedIntervals",
      value: [15],
    }],
  });
  assert.equal(candidates[0].source, "approved-shared-brain");
  assert.equal(candidates[0].changedDimension, "allowedIntervals");
  assert.deepEqual(candidates[0].policy.allowedIntervals, [15]);
  assert.equal(candidates.filter((candidate) => candidate.changedDimension === "allowedIntervals").length, 1);

  const rejected = generateUpDownPolicyCandidates({
    base: { ...DEFAULT_UPDOWN_V2_POLICY },
    appliedLearning: [{
      proposalId: "review-bad",
      appliedMemoryId: "memory-bad",
      dimension: "firstLegMaxPrice",
      value: 0.99,
    }],
  });
  assert.equal(rejected.some((candidate) => candidate.source === "approved-shared-brain"), false);
});

test("an applied lesson can refresh only a later reviewed generation", () => {
  const generation = createUpDownV2Generation({
    id: "generation-1",
    now: new Date("2026-07-30T00:00:00.000Z"),
    championPolicy: { ...DEFAULT_UPDOWN_V2_POLICY },
  });
  for (const arm of generation.arms) {
    arm.results = Array.from({ length: 64 }, (_, index) => result(index, 0, 0));
  }
  const review = evaluateUpDownV2Review({
    generation,
    now: new Date("2026-08-01T00:00:00.000Z"),
    appliedLearning: [{
      proposalId: "review-later",
      appliedMemoryId: "memory-later",
      dimension: "allowedIntervals",
      value: [15],
    }],
  });
  assert.equal(champion(generation).policy.allowedIntervals.length, 2, "the active policy stays frozen");
  assert.equal(review.decision, "refresh-challengers");
  assert.deepEqual(
    review.nextCandidates.find((candidate) => candidate.source === "approved-shared-brain").policy.allowedIntervals,
    [15],
  );
});

test("attributes losses by asset, interval, execution, price, and entry time without claiming causality", () => {
  const generation = createUpDownV2Generation({
    id: "generation-1",
    now: new Date("2026-08-01T00:00:00.000Z"),
    championPolicy: { ...DEFAULT_UPDOWN_V2_POLICY },
  });
  const arm = champion(generation);
  arm.results = Array.from({ length: 24 }, (_, index) => ({
    ...result(index, index % 4 === 0 ? -0.2 : 0.01),
    asset: index % 4 === 0 ? "btc" : "eth",
  }));
  const fills = arm.results.map((_, index) => fill(index));
  const resolutionDates = Object.fromEntries(arm.results.map((row) => [row.slug, row.settledAt]));
  const attribution = buildUpDownLossAttribution({ arm, fills, resolutionDates });
  assert.equal(attribution.buckets.some((bucket) => bucket.dimension === "asset"), true);
  assert.equal(attribution.buckets.some((bucket) => bucket.dimension === "interval"), true);
  assert.equal(attribution.buckets.some((bucket) => bucket.dimension === "execution"), true);
  assert.equal(attribution.buckets.some((bucket) => bucket.dimension === "entry-price"), true);
  assert.equal(attribution.buckets.some((bucket) => bucket.dimension === "entry-time"), true);
  assert.ok(attribution.strongestNegativeAssociations.length > 0);
  assert.ok(attribution.buckets.every((bucket) => bucket.causalClaim === "descriptive-only"));
  assert.match(attribution.limitation, /not causal/i);
});

test("promotes only after paired, FDR, risk, cost, breadth, and concentration gates pass", () => {
  const generation = createUpDownV2Generation({
    id: "generation-1",
    now: new Date("2026-07-30T00:00:00.000Z"),
    championPolicy: { ...DEFAULT_UPDOWN_V2_POLICY },
  });
  for (const arm of generation.arms) {
    arm.results = Array.from({ length: 64 }, (_, index) => result(
      index,
      arm.role === "cash-control" ? 0 : arm.role === "champion" ? -0.05 : arm === generation.arms[2] ? 0.05 : -0.1,
      arm.role === "cash-control" ? 0 : 1,
    ));
  }
  const review = evaluateUpDownV2Review({
    generation,
    now: new Date("2026-08-01T00:00:00.000Z"),
  });
  assert.equal(review.evaluated, true);
  assert.equal(review.decision, "promote");
  const winner = review.comparisons.find((comparison) => comparison.armId === review.promotedArmId);
  assert.ok(winner);
  assert.ok(Object.values(winner.gates).every(Boolean));
  assert.ok(winner.qValue <= 0.05);
});

test("retires a statistically losing family and creates a review-gated lesson", () => {
  const generation = createUpDownV2Generation({
    id: "generation-1",
    now: new Date("2026-07-30T00:00:00.000Z"),
    championPolicy: { ...DEFAULT_UPDOWN_V2_POLICY },
  });
  champion(generation).results = Array.from({ length: 64 }, (_, index) => result(index, -0.05));
  const negative = evaluateUpDownNegativeEvidence({
    generations: [generation],
    now: new Date("2026-08-01T00:00:00.000Z"),
  });
  assert.equal(negative.triggered, true);
  assert.equal(negative.gates.statisticallyNegative, true);
  const review = evaluateUpDownV2Review({
    generation,
    now: new Date("2026-08-01T00:00:00.000Z"),
    negativeEvidence: negative,
  });
  assert.equal(review.decision, "retire-negative-evidence");
  assert.equal(review.knowledgeProposal.kind, "memory");
  assert.equal(review.knowledgeProposal.status, undefined);
  assert.match(review.knowledgeProposal.proposedContent, /futureUse/);
  assert.ok(review.knowledgeProposal.metadata.polymarketUpDownV2Learning.suggestedChange);
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
        bids: [{ price: token_id.endsWith("1") ? "0.24" : "0.74", size: "100" }],
        asks: [{ price: token_id.endsWith("1") ? "0.25" : "0.75", size: "100" }],
        timestamp: "1785542400000",
      })));
    }
    return new Response("not found", { status: 404 });
  };
}

test("real v2 step writes a separate immutable prospective lineage", async () => {
  const root = await mkdtemp(join(tmpdir(), "updown-v2-paper-test-"));
  const missingHistoricalRoot = join(root, "missing-v1");
  try {
    const first = await runUpDownV2PaperStep({
      root,
      historicalRoot: missingHistoricalRoot,
      fetcher: mockPolymarketFetcher(),
      now: new Date("2026-08-01T00:00:00.000Z"),
    });
    const second = await runUpDownV2PaperStep({
      root,
      historicalRoot: missingHistoricalRoot,
      fetcher: mockPolymarketFetcher(),
      now: new Date("2026-08-01T00:00:05.000Z"),
    });
    assert.equal(first.run.snapshotCount, 8, JSON.stringify(first.run.errors));
    assert.equal(first.run.historicalEvidenceUsedForScoring, false);
    assert.equal(first.state.historicalDerivation.excludedFromV2Scoring, true);
    assert.equal(second.run.priorRunId, first.run.runId);
    assert.equal(second.state.generations[0].registration.v2OutcomesObservedBeforeFreeze, 0);
    assert.equal((await readdir(join(root, "runs"))).length, 2);
    const immutable = await readFile(join(root, "runs", `${first.run.runId}.json`), "utf8");
    assert.match(immutable, /"publicReadsOnly": true/);
    assert.match(immutable, /"historicalEvidenceUsedForScoring": false/);
    const experiment = await readFile(join(root, "experiment.json"), "utf8");
    assert.match(experiment, /"negativeEvidenceRetirement": true/);
    assert.equal(summarizeUpDownV2State(second.state).historicalEvidenceUsedForScoring, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v2 source has no venue write, wallet, signing, or automatic memory approval path", async () => {
  const service = await readFile(new URL("../src/lib/services/trading/prediction-updown-paper-v2.ts", import.meta.url), "utf8");
  const learning = await readFile(new URL("../src/lib/services/trading/prediction-updown-learning.ts", import.meta.url), "utf8");
  const cli = await readFile(new URL("./polymarket-updown-paper-v2.mjs", import.meta.url), "utf8");
  const source = `${service}\n${learning}\n${cli}`;
  assert.doesNotMatch(source, /createAndPostOrder|postOrder|cancelOrder|privateKey|signatureType|POLYMARKET_PRIVATE/i);
  assert.doesNotMatch(source, /approveBrainReviewProposal|applyBrainReviewProposal/);
  assert.match(source, /publicReadsOnly: true/);
});
