import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { pairedBootstrapInterval } from "@/lib/services/copy-trading/evolution";
import {
  fetchPredictionMarketBySlug,
  fetchPredictionOrderBooks,
  predictionTakerFeeUsd,
  type PredictionFeeSchedule,
  type PredictionMarket,
  type PredictionOrderBook,
} from "@/lib/services/trading/prediction-markets";

export const UPDOWN_PAPER_SCHEMA_VERSION = 1;
export const UPDOWN_PAPER_DEFAULT_ROOT = join(
  homedir(),
  ".hivemindos",
  "experiments",
  "polymarket-updown-self-evolving-paper",
);
export const UPDOWN_PAPER_STARTING_BALANCE_USD = 500;
export const UPDOWN_EVOLUTION_MIN_SETTLED_MARKETS = 64;
export const UPDOWN_CONSISTENT_PROFIT_MIN_SETTLED_MARKETS = 252;
export const UPDOWN_CONSISTENT_PROFIT_BATCH_SIZE = 63;

const SUPPORTED_ASSETS = ["btc", "eth", "sol", "xrp"] as const;
const SUPPORTED_INTERVALS = [5, 15] as const;
const MAX_OPEN_MARKETS_PER_STEP = 48;
const DEFAULT_PUBLIC_FETCH_TIMEOUT_MS = 15_000;
const MIN_EVOLUTION_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const MIN_NEW_RESULTS_PER_REVIEW = 32;
const STALE_LOCK_MS = 15 * 60 * 1_000;

export type UpDownAsset = typeof SUPPORTED_ASSETS[number];
export type UpDownIntervalMinutes = typeof SUPPORTED_INTERVALS[number];
export type UpDownPublicFetcher = typeof fetch;

export type UpDownPolicy = {
  version: number;
  firstLegMaxPrice: number;
  maxCompletePairCapitalPerShare: number;
  maxUnpairedShares: number;
  maxDepthFraction: number;
  minSecondsRemainingForFirstLeg: number;
  allowResolutionLag: boolean;
  resolutionLagMinPrice: number;
  resolutionLagMaxSeconds: number;
  entryMode?: "temporal" | "immediate-pair";
  allowedAssets?: UpDownAsset[];
  allowedIntervals?: UpDownIntervalMinutes[];
};

export type UpDownBookSide = {
  outcomeId: string;
  label: string;
  askPrice: number;
  askSize: number;
  minimumOrderSize: number;
};

export type UpDownMarketSnapshot = {
  observedAt: string;
  marketId: string;
  conditionId: string;
  slug: string;
  title: string;
  asset: UpDownAsset;
  intervalMinutes: UpDownIntervalMinutes;
  resolutionDate: string;
  feesEnabled: boolean;
  feeSchedule?: PredictionFeeSchedule;
  sides: [UpDownBookSide, UpDownBookSide];
};

export type UpDownPaperFill = {
  runId: string;
  observedAt: string;
  slug: string;
  outcomeId: string;
  outcomeLabel: string;
  reason: "temporal-first-leg" | "complete-pair" | "immediate-pair" | "resolution-lag";
  shares: number;
  price: number;
  notionalUsd: number;
  feeUsd: number;
  capitalUsd: number;
};

type UpDownPositionLeg = {
  outcomeId: string;
  outcomeLabel: string;
  shares: number;
  notionalUsd: number;
  feeUsd: number;
};

export type UpDownPaperPosition = {
  slug: string;
  asset: UpDownAsset;
  intervalMinutes: UpDownIntervalMinutes;
  resolutionDate: string;
  legs: Record<string, UpDownPositionLeg>;
  fills: UpDownPaperFill[];
};

export type UpDownMarketResult = {
  slug: string;
  settledAt: string;
  asset: UpDownAsset;
  intervalMinutes: UpDownIntervalMinutes;
  winnerOutcomeId: string;
  pnlUsd: number;
  feeUsd: number;
  sharesBought: number;
  fillCount: number;
};

export type UpDownPaperArm = {
  id: string;
  role: "cash-control" | "champion" | "challenger";
  changedDimension: string | null;
  policy: UpDownPolicy | null;
  startingBalanceUsd: number;
  cashUsd: number;
  positions: Record<string, UpDownPaperPosition>;
  results: UpDownMarketResult[];
};

export type UpDownGeneration = {
  id: string;
  createdAt: string;
  closedAt: string | null;
  status: "active" | "promoted" | "closed" | "retired";
  parentGenerationId: string | null;
  observedMarketSlugs: string[];
  lastEvolutionAt: string;
  lastEvolutionEvaluationSamples: number;
  arms: UpDownPaperArm[];
};

export type UpDownKnownMarket = {
  marketId: string;
  conditionId: string;
  slug: string;
  title: string;
  asset: UpDownAsset;
  intervalMinutes: UpDownIntervalMinutes;
  resolutionDate: string;
  outcomeIds: [string, string];
  outcomeLabels: [string, string];
  status: "active" | "closed";
  winnerOutcomeId: string | null;
  settledAt: string | null;
};

export type UpDownArmMetrics = {
  armId: string;
  settledMarkets: number;
  tradedMarkets: number;
  totalPnlUsd: number;
  endingBalanceUsd: number;
  bootstrapMeanPnlCi95Usd: [number, number];
  maxDrawdownPct: number;
  stressedPnlUsd: number;
  profitableAssets: number;
  profitableIntervals: number;
  profitableFullBatches: number;
  lastThreeFullBatchesProfitable: boolean;
  largestWinShare: number;
};

export type UpDownConsistentProfitReport = {
  passed: boolean;
  evaluatedAt: string;
  generationId: string;
  armId: string;
  metrics: UpDownArmMetrics;
  gates: Record<string, boolean>;
  claim: string;
};

export type UpDownPaperState = {
  schemaVersion: number;
  experimentId: string;
  createdAt: string;
  updatedAt: string;
  status: "running" | "winding-down" | "consistent-paper-profit";
  nextRunSequence: number;
  lastRunId: string | null;
  runCount: number;
  dataErrorCount: number;
  activeGenerationId: string;
  generations: UpDownGeneration[];
  knownMarkets: Record<string, UpDownKnownMarket>;
  consistentProfit: UpDownConsistentProfitReport | null;
};

export type UpDownReflection = {
  observedFailure: string;
  causalHypothesis: string;
  proposedChange: string;
  pretestPrediction: string;
  falsificationCriteria: string;
  decision: "retain" | "promote" | "stop-new-entries";
  referencedPriorRunIds: string[];
};

export type UpDownPaperRun = {
  schemaVersion: number;
  runId: string;
  priorRunId: string | null;
  generationId: string;
  startedAt: string;
  completedAt: string;
  status: "completed" | "completed-with-errors" | "goal-gate-passed";
  publicReadsOnly: true;
  discoveredSlugs: string[];
  snapshotCount: number;
  snapshots: UpDownMarketSnapshot[];
  settledMarketCount: number;
  settlements: Array<{
    slug: string;
    winnerOutcomeId: string;
    settledAt: string;
    generations: Array<{
      generationId: string;
      armResults: UpDownMarketResult[];
    }>;
  }>;
  fills: Array<UpDownPaperFill & { armId: string }>;
  errors: string[];
  evolution: {
    evaluated: boolean;
    promotedArmId: string | null;
    reason: string;
  };
  consistentProfit: UpDownConsistentProfitReport;
  reflection: UpDownReflection;
};

export const DEFAULT_UPDOWN_POLICY: UpDownPolicy = Object.freeze({
  version: 1,
  firstLegMaxPrice: 0.35,
  maxCompletePairCapitalPerShare: 0.995,
  maxUnpairedShares: 10,
  maxDepthFraction: 0.25,
  minSecondsRemainingForFirstLeg: 120,
  allowResolutionLag: false,
  resolutionLagMinPrice: 0.985,
  resolutionLagMaxSeconds: 75,
});

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

type UpDownEvidenceState = Pick<
  UpDownPaperState,
  "activeGenerationId" | "generations" | "runCount" | "dataErrorCount"
>;

function activeGeneration(state: Pick<UpDownPaperState, "activeGenerationId" | "generations">): UpDownGeneration {
  const generation = state.generations.find((item) => item.id === state.activeGenerationId);
  if (!generation) throw new Error(`Active generation ${state.activeGenerationId} is missing.`);
  return generation;
}

function championArm(generation: UpDownGeneration): UpDownPaperArm {
  const arm = generation.arms.find((item) => item.role === "champion");
  if (!arm?.policy) throw new Error(`Generation ${generation.id} has no champion policy.`);
  return arm;
}

export function createUpDownPolicyVariants(policy: UpDownPolicy): Array<{
  id: string;
  changedDimension: string;
  policy: UpDownPolicy;
}> {
  return [
    {
      id: "challenger-entry",
      changedDimension: "firstLegMaxPrice",
      policy: { ...policy, firstLegMaxPrice: round(Math.max(0.15, policy.firstLegMaxPrice - 0.03), 3) },
    },
    {
      id: "challenger-pair",
      changedDimension: "maxCompletePairCapitalPerShare",
      policy: {
        ...policy,
        maxCompletePairCapitalPerShare: round(Math.max(0.9, policy.maxCompletePairCapitalPerShare - 0.01), 3),
      },
    },
    {
      id: "challenger-inventory",
      changedDimension: "maxUnpairedShares",
      policy: { ...policy, maxUnpairedShares: round(Math.max(5, policy.maxUnpairedShares / 2), 3) },
    },
    {
      id: "challenger-resolution",
      changedDimension: "allowResolutionLag",
      policy: { ...policy, allowResolutionLag: !policy.allowResolutionLag },
    },
  ];
}

function createArm(
  id: string,
  role: UpDownPaperArm["role"],
  policy: UpDownPolicy | null,
  changedDimension: string | null,
): UpDownPaperArm {
  return {
    id,
    role,
    changedDimension,
    policy,
    startingBalanceUsd: UPDOWN_PAPER_STARTING_BALANCE_USD,
    cashUsd: UPDOWN_PAPER_STARTING_BALANCE_USD,
    positions: {},
    results: [],
  };
}

function createGeneration(
  id: string,
  now: string,
  champion: UpDownPolicy,
  parentGenerationId: string | null,
): UpDownGeneration {
  const variants = createUpDownPolicyVariants(champion);
  return {
    id,
    createdAt: now,
    closedAt: null,
    status: "active",
    parentGenerationId,
    observedMarketSlugs: [],
    lastEvolutionAt: now,
    lastEvolutionEvaluationSamples: 0,
    arms: [
      createArm("cash-control", "cash-control", null, null),
      createArm("champion", "champion", champion, null),
      ...variants.map((variant) => createArm(
        variant.id,
        "challenger",
        variant.policy,
        variant.changedDimension,
      )),
    ],
  };
}

export function createUpDownPaperState(now = new Date()): UpDownPaperState {
  const createdAt = now.toISOString();
  return {
    schemaVersion: UPDOWN_PAPER_SCHEMA_VERSION,
    experimentId: "polymarket-updown-self-evolving-paper-v1",
    createdAt,
    updatedAt: createdAt,
    status: "running",
    nextRunSequence: 1,
    lastRunId: null,
    runCount: 0,
    dataErrorCount: 0,
    activeGenerationId: "generation-1",
    generations: [createGeneration("generation-1", createdAt, { ...DEFAULT_UPDOWN_POLICY }, null)],
    knownMarkets: {},
    consistentProfit: null,
  };
}

function parseMarketIdentity(slug: string): {
  asset: UpDownAsset;
  intervalMinutes: UpDownIntervalMinutes;
} | null {
  const match = /^(btc|eth|sol|xrp)-updown-(5|15)m-\d+$/.exec(slug);
  if (!match) return null;
  return {
    asset: match[1] as UpDownAsset,
    intervalMinutes: Number(match[2]) as UpDownIntervalMinutes,
  };
}

function currentSlugs(now: Date): string[] {
  const epochSeconds = Math.floor(now.getTime() / 1_000);
  return SUPPORTED_ASSETS.flatMap((asset) => SUPPORTED_INTERVALS.map((intervalMinutes) => {
    const intervalSeconds = intervalMinutes * 60;
    return `${asset}-updown-${intervalMinutes}m-${Math.floor(epochSeconds / intervalSeconds) * intervalSeconds}`;
  }));
}

function bestAskSide(
  market: PredictionMarket,
  books: PredictionOrderBook[],
  index: number,
): UpDownBookSide | null {
  const outcome = market.outcomes[index];
  const book = books.find((item) => item.outcomeId === outcome?.id);
  const ask = book?.asks[0];
  if (!outcome || !book || !ask) return null;
  return {
    outcomeId: outcome.id,
    label: outcome.label,
    askPrice: ask.price,
    askSize: ask.size,
    minimumOrderSize: Math.max(market.minimumOrderSize, book.minimumOrderSize),
  };
}

export function createUpDownSnapshot(
  market: PredictionMarket,
  books: PredictionOrderBook[],
  observedAt = new Date().toISOString(),
): UpDownMarketSnapshot {
  const identity = parseMarketIdentity(market.slug);
  if (!identity || market.outcomes.length !== 2 || !market.resolutionDate) {
    throw new Error(`Market ${market.slug} is not a supported binary crypto Up/Down market.`);
  }
  if (market.feesEnabled && !market.feeSchedule) {
    throw new Error(`Market ${market.slug} enables fees but omitted its fee schedule.`);
  }
  const first = bestAskSide(market, books, 0);
  const second = bestAskSide(market, books, 1);
  if (!first || !second) throw new Error(`Market ${market.slug} does not have two executable asks.`);
  return {
    observedAt,
    marketId: market.id,
    conditionId: market.conditionId,
    slug: market.slug,
    title: market.title,
    ...identity,
    resolutionDate: market.resolutionDate,
    feesEnabled: market.feesEnabled,
    feeSchedule: market.feeSchedule,
    sides: [first, second],
  };
}

function ensurePosition(arm: UpDownPaperArm, snapshot: UpDownMarketSnapshot): UpDownPaperPosition {
  arm.positions[snapshot.slug] ??= {
    slug: snapshot.slug,
    asset: snapshot.asset,
    intervalMinutes: snapshot.intervalMinutes,
    resolutionDate: snapshot.resolutionDate,
    legs: {},
    fills: [],
  };
  return arm.positions[snapshot.slug];
}

function positionCapitalPerShare(position: UpDownPaperPosition, outcomeId: string): number | null {
  const leg = position.legs[outcomeId];
  return leg?.shares ? (leg.notionalUsd + leg.feeUsd) / leg.shares : null;
}

function appendBuy(
  arm: UpDownPaperArm,
  snapshot: UpDownMarketSnapshot,
  side: UpDownBookSide,
  sharesRequested: number,
  reason: UpDownPaperFill["reason"],
  runId: string,
  requireFullSize = false,
): UpDownPaperFill | null {
  const policy = arm.policy;
  if (!policy) return null;
  const depthShares = side.askSize * policy.maxDepthFraction;
  const feePerShare = predictionTakerFeeUsd({
    shares: 1,
    price: side.askPrice,
    feeSchedule: snapshot.feeSchedule,
  });
  const capitalPerShare = side.askPrice + feePerShare;
  const affordableShares = capitalPerShare > 0 ? arm.cashUsd / capitalPerShare : 0;
  const shares = round(Math.min(sharesRequested, depthShares, affordableShares), 6);
  if (requireFullSize && shares + 1e-9 < sharesRequested) return null;
  if (shares + 1e-9 < side.minimumOrderSize || shares <= 0) return null;
  const notionalUsd = round(shares * side.askPrice, 6);
  const feeUsd = predictionTakerFeeUsd({
    shares,
    price: side.askPrice,
    feeSchedule: snapshot.feeSchedule,
  });
  const capitalUsd = round(notionalUsd + feeUsd, 6);
  if (capitalUsd > arm.cashUsd + 1e-9) return null;
  const fill: UpDownPaperFill = {
    runId,
    observedAt: snapshot.observedAt,
    slug: snapshot.slug,
    outcomeId: side.outcomeId,
    outcomeLabel: side.label,
    reason,
    shares,
    price: side.askPrice,
    notionalUsd,
    feeUsd,
    capitalUsd,
  };
  const position = ensurePosition(arm, snapshot);
  const existing = position.legs[side.outcomeId];
  position.legs[side.outcomeId] = {
    outcomeId: side.outcomeId,
    outcomeLabel: side.label,
    shares: round((existing?.shares ?? 0) + shares, 6),
    notionalUsd: round((existing?.notionalUsd ?? 0) + notionalUsd, 6),
    feeUsd: round((existing?.feeUsd ?? 0) + feeUsd, 6),
  };
  position.fills.push(fill);
  arm.cashUsd = round(arm.cashUsd - capitalUsd, 6);
  return fill;
}

function appendImmediatePair(
  arm: UpDownPaperArm,
  snapshot: UpDownMarketSnapshot,
  runId: string,
): UpDownPaperFill[] {
  const policy = arm.policy;
  if (!policy) return [];
  const sides = snapshot.sides.map((side) => {
    const feePerShare = predictionTakerFeeUsd({
      shares: 1,
      price: side.askPrice,
      feeSchedule: snapshot.feeSchedule,
    });
    return { side, feePerShare, capitalPerShare: side.askPrice + feePerShare };
  });
  const pairCapitalPerShare = sum(sides.map((row) => row.capitalPerShare));
  if (pairCapitalPerShare > policy.maxCompletePairCapitalPerShare) return [];
  const shares = round(Math.min(
    policy.maxUnpairedShares,
    ...sides.map((row) => row.side.askSize * policy.maxDepthFraction),
    pairCapitalPerShare > 0 ? arm.cashUsd / pairCapitalPerShare : 0,
  ), 6);
  if (sides.some((row) => shares + 1e-9 < row.side.minimumOrderSize) || shares <= 0) return [];
  const planned = sides.map(({ side }) => {
    const notionalUsd = round(shares * side.askPrice, 6);
    const feeUsd = predictionTakerFeeUsd({
      shares,
      price: side.askPrice,
      feeSchedule: snapshot.feeSchedule,
    });
    const capitalUsd = round(notionalUsd + feeUsd, 6);
    return {
      runId,
      observedAt: snapshot.observedAt,
      slug: snapshot.slug,
      outcomeId: side.outcomeId,
      outcomeLabel: side.label,
      reason: "immediate-pair" as const,
      shares,
      price: side.askPrice,
      notionalUsd,
      feeUsd,
      capitalUsd,
    };
  });
  const totalCapital = round(sum(planned.map((fill) => fill.capitalUsd)), 6);
  if (totalCapital > arm.cashUsd + 1e-9) return [];
  const position = ensurePosition(arm, snapshot);
  for (const fill of planned) {
    position.legs[fill.outcomeId] = {
      outcomeId: fill.outcomeId,
      outcomeLabel: fill.outcomeLabel,
      shares: fill.shares,
      notionalUsd: fill.notionalUsd,
      feeUsd: fill.feeUsd,
    };
    position.fills.push(fill);
  }
  arm.cashUsd = round(arm.cashUsd - totalCapital, 6);
  return planned;
}

export function applyUpDownSnapshot(
  generation: UpDownGeneration,
  snapshot: UpDownMarketSnapshot,
  runId: string,
): Array<UpDownPaperFill & { armId: string }> {
  generation.observedMarketSlugs = unique([...generation.observedMarketSlugs, snapshot.slug]);
  const secondsRemaining = (Date.parse(snapshot.resolutionDate) - Date.parse(snapshot.observedAt)) / 1_000;
  const fills: Array<UpDownPaperFill & { armId: string }> = [];
  for (const arm of generation.arms) {
    const policy = arm.policy;
    if (!policy || arm.role === "cash-control") continue;
    if (policy.allowedAssets && !policy.allowedAssets.includes(snapshot.asset)) continue;
    if (policy.allowedIntervals && !policy.allowedIntervals.includes(snapshot.intervalMinutes)) continue;
    const position = arm.positions[snapshot.slug];
    const existingLegs = position ? Object.values(position.legs).filter((leg) => leg.shares > 0) : [];
    let fill: UpDownPaperFill | null = null;
    if (existingLegs.length === 0) {
      if (policy.entryMode === "immediate-pair") {
        const pairFills = appendImmediatePair(arm, snapshot, runId);
        fills.push(...pairFills.map((pairFill) => ({ ...pairFill, armId: arm.id })));
        continue;
      }
      const higherSide = [...snapshot.sides].sort((a, b) => b.askPrice - a.askPrice)[0];
      if (
        policy.allowResolutionLag
        && secondsRemaining >= 0
        && secondsRemaining <= policy.resolutionLagMaxSeconds
        && higherSide.askPrice >= policy.resolutionLagMinPrice
      ) {
        fill = appendBuy(
          arm,
          snapshot,
          higherSide,
          policy.maxUnpairedShares,
          "resolution-lag",
          runId,
        );
      } else if (secondsRemaining >= policy.minSecondsRemainingForFirstLeg) {
        const lowerSide = [...snapshot.sides].sort((a, b) => a.askPrice - b.askPrice)[0];
        if (lowerSide.askPrice <= policy.firstLegMaxPrice) {
          fill = appendBuy(
            arm,
            snapshot,
            lowerSide,
            policy.maxUnpairedShares,
            "temporal-first-leg",
            runId,
          );
        }
      }
    } else if (existingLegs.length === 1 && position) {
      const existing = existingLegs[0];
      const opposite = snapshot.sides.find((side) => side.outcomeId !== existing.outcomeId);
      const existingCapitalPerShare = positionCapitalPerShare(position, existing.outcomeId);
      if (opposite && existingCapitalPerShare != null) {
        const oppositeFeePerShare = predictionTakerFeeUsd({
          shares: 1,
          price: opposite.askPrice,
          feeSchedule: snapshot.feeSchedule,
        });
        const completePairCapital = existingCapitalPerShare + opposite.askPrice + oppositeFeePerShare;
        if (completePairCapital <= policy.maxCompletePairCapitalPerShare) {
          fill = appendBuy(
            arm,
            snapshot,
            opposite,
            existing.shares,
            "complete-pair",
            runId,
            true,
          );
        }
      }
    }
    if (fill) fills.push({ ...fill, armId: arm.id });
  }
  return fills;
}

export function upDownMarketFromPrediction(
  market: PredictionMarket,
  winnerOutcomeId: string | null,
): UpDownKnownMarket {
  const identity = parseMarketIdentity(market.slug);
  if (!identity || market.outcomes.length !== 2 || !market.resolutionDate) {
    throw new Error(`Market ${market.slug} cannot be normalized into the Up/Down experiment.`);
  }
  return {
    marketId: market.id,
    conditionId: market.conditionId,
    slug: market.slug,
    title: market.title,
    ...identity,
    resolutionDate: market.resolutionDate,
    outcomeIds: [market.outcomes[0].id, market.outcomes[1].id],
    outcomeLabels: [market.outcomes[0].label, market.outcomes[1].label],
    status: market.status,
    winnerOutcomeId,
    settledAt: winnerOutcomeId ? new Date().toISOString() : null,
  };
}

export function resolvedPredictionOutcomeId(market: PredictionMarket): string | null {
  if (market.status !== "closed" || market.outcomes.length !== 2) return null;
  const winner = market.outcomes.find((outcome) => outcome.price >= 0.99);
  const loser = market.outcomes.find((outcome) => outcome.id !== winner?.id);
  return winner && loser && loser.price <= 0.01 ? winner.id : null;
}

export function settleUpDownMarket(
  generation: UpDownGeneration,
  market: UpDownKnownMarket,
  settledAt = new Date().toISOString(),
): number {
  if (!market.winnerOutcomeId || !generation.observedMarketSlugs.includes(market.slug)) return 0;
  let newlySettled = 0;
  for (const arm of generation.arms) {
    if (arm.results.some((result) => result.slug === market.slug)) continue;
    const position = arm.positions[market.slug];
    const legs = position ? Object.values(position.legs) : [];
    const payout = legs
      .filter((leg) => leg.outcomeId === market.winnerOutcomeId)
      .reduce((sum, leg) => sum + leg.shares, 0);
    const capital = legs.reduce((sum, leg) => sum + leg.notionalUsd + leg.feeUsd, 0);
    const feeUsd = legs.reduce((sum, leg) => sum + leg.feeUsd, 0);
    const sharesBought = legs.reduce((sum, leg) => sum + leg.shares, 0);
    arm.cashUsd = round(arm.cashUsd + payout, 6);
    arm.results.push({
      slug: market.slug,
      settledAt,
      asset: market.asset,
      intervalMinutes: market.intervalMinutes,
      winnerOutcomeId: market.winnerOutcomeId,
      pnlUsd: round(payout - capital, 6),
      feeUsd: round(feeUsd, 6),
      sharesBought: round(sharesBought, 6),
      fillCount: position?.fills.length ?? 0,
    });
    delete arm.positions[market.slug];
    newlySettled += 1;
  }
  return newlySettled > 0 ? 1 : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function maxDrawdownPct(startingBalance: number, pnls: number[]): number {
  let equity = startingBalance;
  let peak = startingBalance;
  let worst = 0;
  for (const pnl of pnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    worst = Math.max(worst, peak > 0 ? (peak - equity) / peak * 100 : 100);
  }
  return round(worst, 4);
}

export function calculateUpDownArmMetrics(arm: UpDownPaperArm): UpDownArmMetrics {
  const results = [...arm.results].sort((a, b) => a.settledAt.localeCompare(b.settledAt));
  const pnls = results.map((result) => result.pnlUsd);
  const totalPnlUsd = round(sum(pnls), 6);
  const intervalPnls = new Map<number, number>();
  const assetPnls = new Map<string, number>();
  for (const result of results) {
    intervalPnls.set(result.intervalMinutes, (intervalPnls.get(result.intervalMinutes) ?? 0) + result.pnlUsd);
    assetPnls.set(result.asset, (assetPnls.get(result.asset) ?? 0) + result.pnlUsd);
  }
  const fullBatchPnls: number[] = [];
  for (let index = 0; index + UPDOWN_CONSISTENT_PROFIT_BATCH_SIZE <= results.length; index += UPDOWN_CONSISTENT_PROFIT_BATCH_SIZE) {
    fullBatchPnls.push(sum(results.slice(index, index + UPDOWN_CONSISTENT_PROFIT_BATCH_SIZE).map((result) => result.pnlUsd)));
  }
  const positivePnls = pnls.filter((value) => value > 0);
  const grossPositive = sum(positivePnls);
  const largestWinShare = grossPositive > 0 ? Math.max(...positivePnls) / grossPositive : 1;
  return {
    armId: arm.id,
    settledMarkets: results.length,
    tradedMarkets: results.filter((result) => result.fillCount > 0).length,
    totalPnlUsd,
    endingBalanceUsd: round(arm.startingBalanceUsd + totalPnlUsd, 6),
    bootstrapMeanPnlCi95Usd: pairedBootstrapInterval(pnls, 5_000).map((value) => round(value, 6)) as [number, number],
    maxDrawdownPct: maxDrawdownPct(arm.startingBalanceUsd, pnls),
    stressedPnlUsd: round(sum(results.map((result) => result.pnlUsd - (2 * result.feeUsd) - (0.01 * result.sharesBought))), 6),
    profitableAssets: [...assetPnls.values()].filter((value) => value > 0).length,
    profitableIntervals: [...intervalPnls.values()].filter((value) => value > 0).length,
    profitableFullBatches: fullBatchPnls.filter((value) => value > 0).length,
    lastThreeFullBatchesProfitable: fullBatchPnls.length >= 3 && fullBatchPnls.slice(-3).every((value) => value > 0),
    largestWinShare: round(largestWinShare, 6),
  };
}

export function evaluateUpDownConsistentProfit(
  state: UpDownEvidenceState,
  now = new Date(),
): UpDownConsistentProfitReport {
  const generation = activeGeneration(state);
  const arm = championArm(generation);
  const metrics = calculateUpDownArmMetrics(arm);
  const reliabilityErrorRate = state.runCount > 0 ? state.dataErrorCount / state.runCount : 1;
  const gates: Record<string, boolean> = {
    settledMarketFloor: metrics.settledMarkets >= UPDOWN_CONSISTENT_PROFIT_MIN_SETTLED_MARKETS,
    tradedMarketFloor: metrics.tradedMarkets >= 64,
    positiveNetPnl: metrics.totalPnlUsd > 0,
    positiveBootstrapLowerBound: metrics.bootstrapMeanPnlCi95Usd[0] > 0,
    fourForwardBatches: metrics.settledMarkets >= UPDOWN_CONSISTENT_PROFIT_BATCH_SIZE * 4,
    lastThreeBatchesProfitable: metrics.lastThreeFullBatchesProfitable,
    crossAssetBreadth: metrics.profitableAssets >= 2,
    crossIntervalBreadth: metrics.profitableIntervals >= 2,
    drawdownWithinLimit: metrics.maxDrawdownPct <= 10,
    pnlNotConcentrated: metrics.largestWinShare <= 0.35,
    survivesThreeTimesCostStress: metrics.stressedPnlUsd > 0,
    reliablePublicData: reliabilityErrorRate <= 0.02,
    noOpenChampionPositions: Object.keys(arm.positions).length === 0,
  };
  const passed = Object.values(gates).every(Boolean);
  return {
    passed,
    evaluatedAt: now.toISOString(),
    generationId: generation.id,
    armId: arm.id,
    metrics,
    gates,
    claim: passed
      ? "The frozen champion cleared the experiment's paper-profit evidence gate; this is not evidence that live execution will profit."
      : "Consistent paper profit is not established; the experiment remains a research loop and may retain cash indefinitely.",
  };
}

function generationResultCount(generation: UpDownGeneration): number {
  return championArm(generation).results.length;
}

function pairedPnlDeltas(champion: UpDownPaperArm, challenger: UpDownPaperArm): number[] {
  const bySlug = new Map(champion.results.map((result) => [result.slug, result.pnlUsd]));
  return challenger.results
    .filter((result) => bySlug.has(result.slug))
    .map((result) => result.pnlUsd - (bySlug.get(result.slug) ?? 0));
}

export function evolveUpDownGeneration(
  state: UpDownPaperState,
  now = new Date(),
): { evaluated: boolean; promotedArmId: string | null; reason: string } {
  const generation = activeGeneration(state);
  const champion = championArm(generation);
  const resultCount = generationResultCount(generation);
  const elapsed = now.getTime() - Date.parse(generation.lastEvolutionAt);
  if (resultCount < UPDOWN_EVOLUTION_MIN_SETTLED_MARKETS) {
    return {
      evaluated: false,
      promotedArmId: null,
      reason: `Waiting for ${UPDOWN_EVOLUTION_MIN_SETTLED_MARKETS - resultCount} more settled markets.`,
    };
  }
  if (resultCount - generation.lastEvolutionEvaluationSamples < MIN_NEW_RESULTS_PER_REVIEW) {
    return { evaluated: false, promotedArmId: null, reason: "Waiting for a fresh non-overlapping review batch." };
  }
  if (elapsed < MIN_EVOLUTION_INTERVAL_MS) {
    return { evaluated: false, promotedArmId: null, reason: "The daily policy-review cooldown has not elapsed." };
  }
  generation.lastEvolutionAt = now.toISOString();
  generation.lastEvolutionEvaluationSamples = resultCount;
  const championMetrics = calculateUpDownArmMetrics(champion);
  const passing = generation.arms
    .filter((arm) => arm.role === "challenger" && arm.policy)
    .map((arm) => {
      const metrics = calculateUpDownArmMetrics(arm);
      const deltas = pairedPnlDeltas(champion, arm);
      const deltaCi = pairedBootstrapInterval(deltas, 5_000);
      return { arm, metrics, deltaCi };
    })
    .filter(({ metrics, deltaCi }) => (
      metrics.tradedMarkets >= 20
      && metrics.totalPnlUsd > championMetrics.totalPnlUsd
      && metrics.totalPnlUsd > 0
      && deltaCi[0] > 0
      && metrics.maxDrawdownPct <= 15
    ))
    .sort((a, b) => b.metrics.totalPnlUsd - a.metrics.totalPnlUsd);
  const winner = passing[0];
  if (!winner?.arm.policy) {
    return {
      evaluated: true,
      promotedArmId: null,
      reason: "All one-change challengers failed the paired forward-evidence gate; the champion was retained.",
    };
  }
  generation.status = "promoted";
  generation.closedAt = now.toISOString();
  const nextPolicy = { ...winner.arm.policy, version: champion.policy!.version + 1 };
  const nextId = `generation-${state.generations.length + 1}`;
  state.generations.push(createGeneration(nextId, now.toISOString(), nextPolicy, generation.id));
  state.activeGenerationId = nextId;
  return {
    evaluated: true,
    promotedArmId: winner.arm.id,
    reason: `Promoted the strongest one-change challenger (${winner.arm.changedDimension}) into ${nextId}.`,
  };
}

function buildReflection(
  state: UpDownPaperState,
  runHistory: UpDownPaperRun[],
  errors: string[],
  fills: Array<UpDownPaperFill & { armId: string }>,
  evolution: UpDownPaperRun["evolution"],
  report: UpDownConsistentProfitReport,
): UpDownReflection {
  const generation = activeGeneration(state);
  const openPositions = championArm(generation).positions;
  const unpaired = Object.values(openPositions).filter((position) => Object.keys(position.legs).length === 1).length;
  const observedFailure = errors.length
    ? `${errors.length} public-data read or normalization error(s) were preserved; no failed read was converted into a fill.`
    : fills.length === 0
      ? "No strategy arm found a depth-, fee-, time-, and bankroll-valid paper entry in this run."
      : `${unpaired} unpaired champion position(s) remain exposed to settlement because the opposite ask has not completed a profitable pair.`;
  const causalHypothesis = errors.length
    ? "Transient venue data or an upstream schema change may explain the incomplete observations."
    : fills.length === 0
      ? "Executable asks plus taker fees likely removed the apparent midpoint edge, or the frozen entry thresholds were not reached."
      : "The signal may be path-dependent; only settled matched-market results can distinguish edge from directional luck.";
  return {
    observedFailure,
    causalHypothesis,
    proposedChange: evolution.evaluated
      ? evolution.reason
      : "Keep every arm frozen until the next fresh, non-overlapping policy-review batch.",
    pretestPrediction: "A real improvement must beat the frozen champion on the same future markets with a positive paired bootstrap lower bound.",
    falsificationCriteria: "Reject a change if its paired lower bound is non-positive, net PnL is non-positive, fewer than 20 markets trade, or drawdown exceeds 15%.",
    decision: report.passed ? "stop-new-entries" : evolution.promotedArmId ? "promote" : "retain",
    referencedPriorRunIds: runHistory.slice(-5).map((run) => run.runId),
  };
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function withUpDownPublicReadTimeout(
  fetcher: UpDownPublicFetcher,
  timeoutMs: number,
): UpDownPublicFetcher {
  const boundedTimeoutMs = Math.max(1, Math.floor(timeoutMs));
  return (input, init = {}) => fetcher(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(boundedTimeoutMs),
  });
}

function createRunId(state: UpDownPaperState, now: Date): string {
  return `${now.toISOString().replace(/[:.]/g, "-")}-r${String(state.nextRunSequence).padStart(6, "0")}`;
}

async function ensureExperimentDirectories(root: string): Promise<void> {
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(join(root, "runs"), { recursive: true }),
    mkdir(join(root, "generations"), { recursive: true }),
    mkdir(join(root, "locks"), { recursive: true }),
  ]);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function loadRunHistory(root: string, state: UpDownPaperState): Promise<UpDownPaperRun[]> {
  if (!state.lastRunId) return [];
  const runs: UpDownPaperRun[] = [];
  let currentId: string | null = state.lastRunId;
  while (currentId && runs.length < 5) {
    try {
      const run: UpDownPaperRun = await readJson<UpDownPaperRun>(join(root, "runs", `${currentId}.json`));
      runs.unshift(run);
      currentId = run.priorRunId;
    } catch {
      break;
    }
  }
  return runs;
}

async function loadOrCreateState(root: string, now: Date): Promise<UpDownPaperState> {
  const statePath = join(root, "state.json");
  try {
    const state = await readJson<UpDownPaperState>(statePath);
    if (state.schemaVersion !== UPDOWN_PAPER_SCHEMA_VERSION) {
      throw new Error(`Unsupported Up/Down paper schema ${state.schemaVersion}.`);
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const state = createUpDownPaperState(now);
    await writeFile(
      join(root, "experiment.json"),
      `${JSON.stringify({
        schemaVersion: UPDOWN_PAPER_SCHEMA_VERSION,
        experimentId: state.experimentId,
        createdAt: state.createdAt,
        authority: "paper-only-public-reads",
        liveTradingPath: false,
        startingBalancePerArmUsd: UPDOWN_PAPER_STARTING_BALANCE_USD,
      }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    await atomicWriteJson(statePath, state);
    return state;
  }
}

async function acquireStepLock(root: string, now: Date): Promise<() => Promise<void>> {
  const lockPath = join(root, "step.lock");
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: now.toISOString() })}\n`);
    return async () => {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const lockStat = await stat(lockPath);
    if (now.getTime() - lockStat.mtimeMs <= STALE_LOCK_MS) {
      throw new Error("Another Up/Down paper step holds the experiment lock.");
    }
    await rename(lockPath, join(root, "locks", `stale-${now.toISOString().replace(/[:.]/g, "-")}.lock`));
    return acquireStepLock(root, now);
  }
}

export async function fetchUpDownMarketsForStep(
  state: Pick<UpDownPaperState, "knownMarkets">,
  now: Date,
  fetcher: UpDownPublicFetcher,
): Promise<{ markets: PredictionMarket[]; discoveredSlugs: string[]; errors: string[] }> {
  const unresolved = Object.values(state.knownMarkets)
    .filter((market) => !market.winnerOutcomeId)
    .sort((a, b) => b.resolutionDate.localeCompare(a.resolutionDate))
    .slice(0, MAX_OPEN_MARKETS_PER_STEP)
    .map((market) => market.slug);
  const discoveredSlugs = unique([...currentSlugs(now), ...unresolved]);
  const settled = await Promise.allSettled(discoveredSlugs.map((slug) => fetchPredictionMarketBySlug(slug, fetcher)));
  const markets: PredictionMarket[] = [];
  const errors: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") markets.push(result.value);
    else errors.push(`${discoveredSlugs[index]}: ${safeError(result.reason)}`);
  });
  return { markets, discoveredSlugs, errors };
}

export async function fetchUpDownSnapshots(
  markets: PredictionMarket[],
  observedAt: string,
  fetcher: UpDownPublicFetcher,
): Promise<{ snapshots: UpDownMarketSnapshot[]; errors: string[] }> {
  const eligible = markets.filter((market) => (
    market.status === "active"
    && market.acceptingOrders
    && parseMarketIdentity(market.slug)
    && market.outcomes.length === 2
    && Boolean(market.resolutionDate)
    && Date.parse(market.resolutionDate!) > Date.parse(observedAt)
  ));
  const settled = await Promise.allSettled(eligible.map(async (market) => {
    const books = await fetchPredictionOrderBooks(market.outcomes.map((outcome) => outcome.id), fetcher);
    return createUpDownSnapshot(market, books, observedAt);
  }));
  const snapshots: UpDownMarketSnapshot[] = [];
  const errors: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") snapshots.push(result.value);
    else errors.push(`${eligible[index].slug}: ${safeError(result.reason)}`);
  });
  return { snapshots, errors };
}

function renderStatus(state: UpDownPaperState, report: UpDownConsistentProfitReport): string {
  const generation = activeGeneration(state);
  const metrics = report.metrics;
  const failedGates = Object.entries(report.gates).filter(([, passed]) => !passed).map(([name]) => name);
  return [
    "# Polymarket Up/Down self-evolving paper loop",
    "",
    `Updated: ${state.updatedAt}`,
    `Status: ${state.status}`,
    `Runs: ${state.runCount}`,
    `Active generation: ${generation.id}`,
    `Settled/traded markets: ${metrics.settledMarkets}/${metrics.tradedMarkets}`,
    `Champion paper PnL: $${metrics.totalPnlUsd.toFixed(2)}`,
    `Champion max drawdown: ${metrics.maxDrawdownPct.toFixed(2)}%`,
    `Bootstrap mean PnL CI95: [$${metrics.bootstrapMeanPnlCi95Usd[0].toFixed(4)}, $${metrics.bootstrapMeanPnlCi95Usd[1].toFixed(4)}]`,
    `Three-times-cost stress PnL: $${metrics.stressedPnlUsd.toFixed(2)}`,
    `Consistent-profit gate: ${report.passed ? "passed" : "not passed"}`,
    `Waiting gates: ${failedGates.length ? failedGates.join(", ") : "none"}`,
    "",
    report.claim,
    "",
  ].join("\n");
}

export async function runUpDownPaperStep(options: {
  root?: string;
  now?: Date;
  fetcher?: UpDownPublicFetcher;
  fetchTimeoutMs?: number;
} = {}): Promise<{ state: UpDownPaperState; run: UpDownPaperRun; root: string }> {
  const root = options.root ?? UPDOWN_PAPER_DEFAULT_ROOT;
  const now = options.now ?? new Date();
  const fetcher = withUpDownPublicReadTimeout(
    options.fetcher ?? fetch,
    options.fetchTimeoutMs ?? DEFAULT_PUBLIC_FETCH_TIMEOUT_MS,
  );
  await ensureExperimentDirectories(root);
  const releaseLock = await acquireStepLock(root, now);
  try {
    const state = await loadOrCreateState(root, now);
    const runHistory = await loadRunHistory(root, state);
    const runId = createRunId(state, now);
    const runGenerationId = state.activeGenerationId;
    const startedAt = now.toISOString();
    const marketRead = await fetchUpDownMarketsForStep(state, now, fetcher);
    const errors = [...marketRead.errors];
    const settlements: UpDownPaperRun["settlements"] = [];
    for (const market of marketRead.markets) {
      const winnerOutcomeId = resolvedPredictionOutcomeId(market);
      const known = upDownMarketFromPrediction(market, winnerOutcomeId);
      const prior = state.knownMarkets[market.slug];
      state.knownMarkets[market.slug] = {
        ...known,
        settledAt: winnerOutcomeId ? prior?.settledAt ?? now.toISOString() : null,
      };
      if (winnerOutcomeId) {
        const settledAt = state.knownMarkets[market.slug].settledAt ?? now.toISOString();
        const settledGenerations: UpDownPaperRun["settlements"][number]["generations"] = [];
        for (const generation of state.generations) {
          if (settleUpDownMarket(generation, state.knownMarkets[market.slug], settledAt)) {
            settledGenerations.push({
              generationId: generation.id,
              armResults: generation.arms.flatMap((arm) => {
                const result = arm.results.find((item) => item.slug === market.slug);
                return result ? [{ ...result }] : [];
              }),
            });
          }
        }
        if (settledGenerations.length) {
          settlements.push({
            slug: market.slug,
            winnerOutcomeId,
            settledAt,
            generations: settledGenerations,
          });
        }
      }
    }
    const preliminaryReport = evaluateUpDownConsistentProfit(state, now);
    const preliminaryEvidencePassed = Object.entries(preliminaryReport.gates)
      .filter(([name]) => name !== "noOpenChampionPositions")
      .every(([, passed]) => passed);
    if (state.status === "running" && preliminaryEvidencePassed) {
      state.status = "winding-down";
    } else if (
      state.status === "winding-down"
      && preliminaryReport.gates.noOpenChampionPositions
      && !preliminaryEvidencePassed
    ) {
      state.status = "running";
    }
    const snapshotRead = state.status === "running"
      ? await fetchUpDownSnapshots(marketRead.markets, startedAt, fetcher)
      : { snapshots: [], errors: [] };
    errors.push(...snapshotRead.errors);
    const fills = state.status === "running"
      ? snapshotRead.snapshots.flatMap((snapshot) => {
        const existing = state.knownMarkets[snapshot.slug];
        state.knownMarkets[snapshot.slug] = existing ?? {
          marketId: snapshot.marketId,
          conditionId: snapshot.conditionId,
          slug: snapshot.slug,
          title: snapshot.title,
          asset: snapshot.asset,
          intervalMinutes: snapshot.intervalMinutes,
          resolutionDate: snapshot.resolutionDate,
          outcomeIds: [snapshot.sides[0].outcomeId, snapshot.sides[1].outcomeId],
          outcomeLabels: [snapshot.sides[0].label, snapshot.sides[1].label],
          status: "active",
          winnerOutcomeId: null,
          settledAt: null,
        };
        return applyUpDownSnapshot(activeGeneration(state), snapshot, runId);
      })
      : [];
    const evolution = state.status === "running"
      ? evolveUpDownGeneration(state, now)
      : { evaluated: false, promotedArmId: null, reason: "New entries are stopped after the paper-profit gate passed." };
    state.runCount += 1;
    state.dataErrorCount += errors.length > 0 ? 1 : 0;
    const consistentProfit = evaluateUpDownConsistentProfit(state, now);
    if (consistentProfit.passed) {
      state.status = "consistent-paper-profit";
      state.consistentProfit = consistentProfit;
    } else if (state.status === "winding-down" && consistentProfit.gates.noOpenChampionPositions) {
      state.status = "running";
    }
    const reflection = buildReflection(state, runHistory, errors, fills, evolution, consistentProfit);
    const completedAt = new Date().toISOString();
    const run: UpDownPaperRun = {
      schemaVersion: UPDOWN_PAPER_SCHEMA_VERSION,
      runId,
      priorRunId: state.lastRunId,
      generationId: runGenerationId,
      startedAt,
      completedAt,
      status: consistentProfit.passed ? "goal-gate-passed" : errors.length ? "completed-with-errors" : "completed",
      publicReadsOnly: true,
      discoveredSlugs: marketRead.discoveredSlugs,
      snapshotCount: snapshotRead.snapshots.length,
      snapshots: snapshotRead.snapshots,
      settledMarketCount: settlements.length,
      settlements,
      fills,
      errors,
      evolution,
      consistentProfit,
      reflection,
    };
    state.lastRunId = runId;
    state.nextRunSequence += 1;
    state.updatedAt = completedAt;
    await writeFile(
      join(root, "runs", `${runId}.json`),
      `${JSON.stringify(run, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    if (evolution.promotedArmId) {
      const priorGeneration = state.generations.at(-2);
      if (priorGeneration) {
        await writeFile(
          join(root, "generations", `${priorGeneration.id}.json`),
          `${JSON.stringify(priorGeneration, null, 2)}\n`,
          { encoding: "utf8", mode: 0o600, flag: "wx" },
        );
      }
    }
    await atomicWriteJson(join(root, "state.json"), state);
    await writeFile(join(root, "STATUS.md"), renderStatus(state, consistentProfit), { encoding: "utf8", mode: 0o600 });
    return { state, run, root };
  } finally {
    await releaseLock();
  }
}

export async function readUpDownPaperStatus(root = UPDOWN_PAPER_DEFAULT_ROOT): Promise<{
  state: UpDownPaperState;
  report: UpDownConsistentProfitReport;
}> {
  const state = await readJson<UpDownPaperState>(join(root, "state.json"));
  return { state, report: evaluateUpDownConsistentProfit(state) };
}
