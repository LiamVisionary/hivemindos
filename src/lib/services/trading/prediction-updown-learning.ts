import { createHash } from "node:crypto";

import { pairedBootstrapInterval } from "@/lib/services/copy-trading/evolution";
import {
  benjaminiHochberg,
  oneSidedMeanPValue,
} from "@/lib/services/penny-stock-paper/statistics";
import type { BrainReviewProposalInput } from "@/lib/types/brain-review";
import {
  calculateUpDownArmMetrics,
  DEFAULT_UPDOWN_POLICY,
  UPDOWN_PAPER_STARTING_BALANCE_USD,
  type UpDownAsset,
  type UpDownGeneration,
  type UpDownIntervalMinutes,
  type UpDownPaperArm,
  type UpDownPaperFill,
  type UpDownPolicy,
} from "@/lib/services/trading/prediction-updown-paper-loop";

export const UPDOWN_V2_EVOLUTION_MIN_SETTLED_MARKETS = 64;
export const UPDOWN_V2_MIN_NEW_RESULTS_PER_REVIEW = 32;
export const UPDOWN_V2_MIN_REVIEW_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const UPDOWN_V2_MAX_DRAWDOWN_PCT = 10;
export const UPDOWN_V2_RETIREMENT_DRAWDOWN_PCT = 25;
export const UPDOWN_V2_MAX_CANDIDATES = 4;

const ALL_ASSETS: UpDownAsset[] = ["btc", "eth", "sol", "xrp"];
const ALL_INTERVALS: UpDownIntervalMinutes[] = [5, 15];

export const DEFAULT_UPDOWN_V2_POLICY: UpDownPolicy = Object.freeze({
  ...DEFAULT_UPDOWN_POLICY,
  version: 1,
  firstLegMaxPrice: 0.25,
  maxCompletePairCapitalPerShare: 0.98,
  maxUnpairedShares: 5,
  maxDepthFraction: 0.1,
  minSecondsRemainingForFirstLeg: 180,
  allowResolutionLag: false,
  entryMode: "immediate-pair",
  allowedAssets: [...ALL_ASSETS],
  allowedIntervals: [...ALL_INTERVALS],
});

export type UpDownAttributionDimension =
  | "asset"
  | "interval"
  | "execution"
  | "entry-price"
  | "entry-time";

export type UpDownAttributionBucket = {
  dimension: UpDownAttributionDimension;
  value: string;
  settledMarkets: number;
  tradedMarkets: number;
  pnlUsd: number;
  meanPnlCi95Usd: [number, number];
  feeUsd: number;
  sharesBought: number;
  association: "confirmed-negative" | "inferred-negative" | "non-negative";
  causalClaim: "descriptive-only";
};

export type UpDownLossAttribution = {
  armId: string;
  settledMarkets: number;
  tradedMarkets: number;
  totalPnlUsd: number;
  totalFeeUsd: number;
  feeShareOfGrossLoss: number;
  pairedMarkets: number;
  unpairedMarkets: number;
  buckets: UpDownAttributionBucket[];
  strongestNegativeAssociations: UpDownAttributionBucket[];
  limitation: string;
};

export type UpDownAppliedLearning = {
  proposalId: string;
  appliedMemoryId: string;
  dimension: keyof UpDownPolicy;
  value: unknown;
  evidenceGenerationId?: string;
};

export type UpDownCandidateRegistration = {
  policyContractVersion: 2;
  registeredAt: string;
  scoringStartsAt: string;
  priorEvidenceExcludedFromScoring: true;
  v2OutcomesObservedBeforeFreeze: 0;
  derivationGenerationId: string | null;
  derivationStateDigest: string | null;
  candidateFamilySize: number;
  appliedLearningProposalIds: string[];
};

export type UpDownV2Generation = UpDownGeneration & {
  registration: UpDownCandidateRegistration;
};

export type UpDownCandidateComparison = {
  armId: string;
  changedDimension: string;
  pairedMarkets: number;
  tradedMarkets: number;
  totalPnlUsd: number;
  championPnlUsd: number;
  pairedDeltaPnlUsd: number;
  pairedDeltaCi95Usd: [number, number];
  pValue: number;
  qValue: number;
  maxDrawdownPct: number;
  stressedPnlUsd: number;
  gates: Record<string, boolean>;
  passed: boolean;
};

export type UpDownV2Review = {
  evaluated: boolean;
  evaluatedAt: string;
  generationId: string;
  resultCount: number;
  decision: "wait" | "retain" | "promote" | "refresh-challengers" | "retire-negative-evidence";
  promotedArmId: string | null;
  reason: string;
  comparisons: UpDownCandidateComparison[];
  attribution: UpDownLossAttribution;
  nextCandidates: UpDownPolicyCandidate[];
  knowledgeProposal: BrainReviewProposalInput | null;
};

export type UpDownNegativeEvidenceReport = {
  triggered: boolean;
  evaluatedAt: string;
  settledMarkets: number;
  tradedMarkets: number;
  totalPnlUsd: number;
  meanPnlCi95Usd: [number, number];
  maxDrawdownPct: number;
  gates: {
    statisticallyNegative: boolean;
    drawdownLimitBreached: boolean;
    lossBudgetBreached: boolean;
    candidateFamilyFutile: boolean;
  };
  reason: string;
};

export type UpDownPolicyCandidate = {
  id: string;
  changedDimension: keyof UpDownPolicy;
  policy: UpDownPolicy;
  source: "structured-attribution" | "approved-shared-brain" | "bounded-default";
  hypothesis: string;
  pretestPrediction: string;
  falsificationCriteria: string;
};

type AttributedResult = {
  asset: UpDownAsset;
  intervalMinutes: UpDownIntervalMinutes;
  pnlUsd: number;
  feeUsd: number;
  sharesBought: number;
  fillCount: number;
  fills: UpDownPaperFill[];
  entryPrice: number | null;
  secondsRemaining: number | null;
  execution: "cash" | "paired" | "unpaired" | "resolution-lag";
};

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function changedFields(left: UpDownPolicy, right: UpDownPolicy): Array<keyof UpDownPolicy> {
  return (Object.keys(left) as Array<keyof UpDownPolicy>).filter((key) => (
    JSON.stringify(left[key]) !== JSON.stringify(right[key])
  ));
}

function candidateId(dimension: keyof UpDownPolicy, value: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ dimension, value }))
    .digest("hex")
    .slice(0, 10);
  return `challenger-${String(dimension).replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)}-${digest}`;
}

function createCandidate(input: {
  base: UpDownPolicy;
  dimension: keyof UpDownPolicy;
  value: UpDownPolicy[keyof UpDownPolicy];
  source: UpDownPolicyCandidate["source"];
  hypothesis: string;
}): UpDownPolicyCandidate | null {
  const policy = { ...input.base, [input.dimension]: input.value } as UpDownPolicy;
  if (changedFields(input.base, policy).length !== 1) return null;
  return {
    id: candidateId(input.dimension, input.value),
    changedDimension: input.dimension,
    policy,
    source: input.source,
    hypothesis: input.hypothesis,
    pretestPrediction: "On markets first observed after registration, this one change must produce positive net and stressed PnL and beat the frozen champion on paired outcomes.",
    falsificationCriteria: "Reject if net PnL is non-positive, the paired bootstrap lower bound is non-positive, FDR q exceeds 0.05, drawdown exceeds 10%, or three-times-cost stress is non-positive.",
  };
}

function entryPriceBucket(price: number | null): string {
  if (price == null) return "no-fill";
  if (price < 0.2) return "<0.20";
  if (price < 0.25) return "0.20-0.25";
  if (price < 0.3) return "0.25-0.30";
  if (price < 0.35) return "0.30-0.35";
  return ">=0.35";
}

function entryTimeBucket(seconds: number | null): string {
  if (seconds == null) return "unknown";
  if (seconds < 60) return "<60s";
  if (seconds < 120) return "60-119s";
  if (seconds < 300) return "120-299s";
  return ">=300s";
}

function attributedResults(
  arm: UpDownPaperArm,
  fills: UpDownPaperFill[],
  resolutionDates: Record<string, string>,
): AttributedResult[] {
  const fillsBySlug = new Map<string, UpDownPaperFill[]>();
  for (const fill of fills) {
    const rows = fillsBySlug.get(fill.slug) ?? [];
    rows.push(fill);
    fillsBySlug.set(fill.slug, rows);
  }
  return arm.results.map((result) => {
    const rows = fillsBySlug.get(result.slug) ?? [];
    const shares = sum(rows.map((fill) => fill.shares));
    const entryPrice = shares > 0 ? sum(rows.map((fill) => fill.notionalUsd)) / shares : null;
    const outcomeCount = new Set(rows.map((fill) => fill.outcomeId)).size;
    const resolutionMs = Date.parse(resolutionDates[result.slug] ?? "");
    const firstObservedMs = Date.parse(rows[0]?.observedAt ?? "");
    const secondsRemaining = Number.isFinite(resolutionMs) && Number.isFinite(firstObservedMs)
      ? (resolutionMs - firstObservedMs) / 1_000
      : null;
    const execution: AttributedResult["execution"] = rows.length === 0
      ? "cash"
      : rows.some((fill) => fill.reason === "resolution-lag")
        ? "resolution-lag"
        : outcomeCount >= 2
          ? "paired"
          : "unpaired";
    return {
      asset: result.asset,
      intervalMinutes: result.intervalMinutes,
      pnlUsd: result.pnlUsd,
      feeUsd: result.feeUsd,
      sharesBought: result.sharesBought,
      fillCount: result.fillCount,
      fills: rows,
      entryPrice,
      secondsRemaining,
      execution,
    };
  });
}

function bucketRows(
  rows: AttributedResult[],
  dimension: UpDownAttributionDimension,
  valueOf: (row: AttributedResult) => string,
): UpDownAttributionBucket[] {
  const grouped = new Map<string, AttributedResult[]>();
  for (const row of rows) {
    const value = valueOf(row);
    grouped.set(value, [...(grouped.get(value) ?? []), row]);
  }
  return [...grouped.entries()].map(([value, bucket]) => {
    const pnls = bucket.map((row) => row.pnlUsd);
    const ci = pairedBootstrapInterval(pnls, 5_000).map((item) => round(item, 6)) as [number, number];
    const pnlUsd = round(sum(pnls), 6);
    return {
      dimension,
      value,
      settledMarkets: bucket.length,
      tradedMarkets: bucket.filter((row) => row.fillCount > 0).length,
      pnlUsd,
      meanPnlCi95Usd: ci,
      feeUsd: round(sum(bucket.map((row) => row.feeUsd)), 6),
      sharesBought: round(sum(bucket.map((row) => row.sharesBought)), 6),
      association: bucket.length >= 20 && ci[1] < 0
        ? "confirmed-negative"
        : pnlUsd < 0
          ? "inferred-negative"
          : "non-negative",
      causalClaim: "descriptive-only",
    };
  });
}

export function buildUpDownLossAttribution(input: {
  arm: UpDownPaperArm;
  fills?: UpDownPaperFill[];
  resolutionDates?: Record<string, string>;
}): UpDownLossAttribution {
  const rows = attributedResults(input.arm, input.fills ?? [], input.resolutionDates ?? {});
  const buckets = [
    ...bucketRows(rows, "asset", (row) => row.asset),
    ...bucketRows(rows, "interval", (row) => `${row.intervalMinutes}m`),
    ...bucketRows(rows, "execution", (row) => row.execution),
    ...bucketRows(rows, "entry-price", (row) => entryPriceBucket(row.entryPrice)),
    ...bucketRows(rows, "entry-time", (row) => entryTimeBucket(row.secondsRemaining)),
  ];
  const grossLoss = Math.abs(sum(rows.filter((row) => row.pnlUsd < 0).map((row) => row.pnlUsd)));
  const totalFeeUsd = sum(rows.map((row) => row.feeUsd));
  return {
    armId: input.arm.id,
    settledMarkets: rows.length,
    tradedMarkets: rows.filter((row) => row.fillCount > 0).length,
    totalPnlUsd: round(sum(rows.map((row) => row.pnlUsd)), 6),
    totalFeeUsd: round(totalFeeUsd, 6),
    feeShareOfGrossLoss: round(grossLoss > 0 ? totalFeeUsd / grossLoss : 0, 6),
    pairedMarkets: rows.filter((row) => row.execution === "paired").length,
    unpairedMarkets: rows.filter((row) => row.execution === "unpaired" || row.execution === "resolution-lag").length,
    buckets,
    strongestNegativeAssociations: buckets
      .filter((bucket) => bucket.tradedMarkets > 0 && bucket.pnlUsd < 0)
      .sort((left, right) => left.pnlUsd - right.pnlUsd || right.settledMarkets - left.settledMarkets)
      .slice(0, 8),
    limitation: "These are preregistration inputs and descriptive associations, not causal findings or profit evidence. Only later frozen v2 cohorts can score a proposed change.",
  };
}

function normalizeApprovedLearning(
  learning: UpDownAppliedLearning,
  base: UpDownPolicy,
): UpDownPolicyCandidate | null {
  const dimension = learning.dimension;
  const value = learning.value;
  const numericRanges: Partial<Record<keyof UpDownPolicy, [number, number]>> = {
    firstLegMaxPrice: [0.1, 0.45],
    maxCompletePairCapitalPerShare: [0.9, 0.995],
    maxUnpairedShares: [5, 20],
    maxDepthFraction: [0.02, 0.25],
    minSecondsRemainingForFirstLeg: [60, 600],
    resolutionLagMinPrice: [0.95, 0.995],
    resolutionLagMaxSeconds: [15, 120],
  };
  const range = numericRanges[dimension];
  if (range && (typeof value !== "number" || value < range[0] || value > range[1])) return null;
  if (dimension === "allowResolutionLag" && typeof value !== "boolean") return null;
  if (dimension === "entryMode" && value !== "temporal" && value !== "immediate-pair") return null;
  if (dimension === "allowedAssets" && (
    !Array.isArray(value)
    || value.length < 2
    || value.some((item) => !ALL_ASSETS.includes(item as UpDownAsset))
  )) return null;
  if (dimension === "allowedIntervals" && (
    !Array.isArray(value)
    || value.length < 1
    || value.some((item) => !ALL_INTERVALS.includes(item as UpDownIntervalMinutes))
  )) return null;
  if (dimension === "version") return null;
  return createCandidate({
    base,
    dimension,
    value: value as UpDownPolicy[keyof UpDownPolicy],
    source: "approved-shared-brain",
    hypothesis: `Applied Shared Brain lesson ${learning.proposalId} proposed a bounded change to ${String(dimension)}.`,
  });
}

export function generateUpDownPolicyCandidates(input: {
  base: UpDownPolicy;
  attribution?: UpDownLossAttribution | null;
  appliedLearning?: UpDownAppliedLearning[];
}): UpDownPolicyCandidate[] {
  const candidates: UpDownPolicyCandidate[] = [];
  const add = (candidate: UpDownPolicyCandidate | null) => {
    if (!candidate) return;
    if (candidates.some((item) => item.changedDimension === candidate.changedDimension)) return;
    candidates.push(candidate);
  };
  for (const learning of input.appliedLearning ?? []) add(normalizeApprovedLearning(learning, input.base));

  const negative = input.attribution?.strongestNegativeAssociations ?? [];
  const worstAsset = negative.find((bucket) => bucket.dimension === "asset" && bucket.association === "confirmed-negative");
  const allowedAssets = input.base.allowedAssets ?? ALL_ASSETS;
  if (worstAsset && allowedAssets.length > 2) {
    add(createCandidate({
      base: input.base,
      dimension: "allowedAssets",
      value: allowedAssets.filter((asset) => asset !== worstAsset.value),
      source: "structured-attribution",
      hypothesis: `${worstAsset.value.toUpperCase()} had a negative descriptive interval; excluding it may reduce a concentrated loss source.`,
    }));
  }
  const worstInterval = negative.find((bucket) => bucket.dimension === "interval" && bucket.association === "confirmed-negative");
  const allowedIntervals = input.base.allowedIntervals ?? ALL_INTERVALS;
  if (worstInterval && allowedIntervals.length > 1) {
    const minutes = Number.parseInt(worstInterval.value, 10) as UpDownIntervalMinutes;
    add(createCandidate({
      base: input.base,
      dimension: "allowedIntervals",
      value: allowedIntervals.filter((interval) => interval !== minutes),
      source: "structured-attribution",
      hypothesis: `${worstInterval.value} markets had a negative descriptive interval; excluding them may reduce interval-specific losses.`,
    }));
  }

  if (input.base.entryMode !== "immediate-pair") {
    add(createCandidate({
      base: input.base,
      dimension: "firstLegMaxPrice",
      value: round(Math.max(0.1, input.base.firstLegMaxPrice - 0.03), 3),
      source: "bounded-default",
      hypothesis: "A cheaper first leg may leave more room for fees, adverse selection, and a profitable opposite-leg completion.",
    }));
    add(createCandidate({
      base: input.base,
      dimension: "minSecondsRemainingForFirstLeg",
      value: Math.min(600, input.base.minSecondsRemainingForFirstLeg + 120),
      source: "bounded-default",
      hypothesis: "Entering earlier may give an unpaired first leg more time to complete before resolution.",
    }));
  }
  add(createCandidate({
    base: input.base,
    dimension: "maxCompletePairCapitalPerShare",
    value: round(Math.max(0.9, input.base.maxCompletePairCapitalPerShare - 0.01), 3),
    source: "bounded-default",
    hypothesis: "A stricter all-in pair cap may preserve more edge after taker fees and book movement.",
  }));
  add(createCandidate({
    base: input.base,
    dimension: "maxDepthFraction",
    value: round(Math.max(0.02, input.base.maxDepthFraction / 2), 3),
    source: "bounded-default",
    hypothesis: "Using less displayed ask depth may reduce sensitivity to thin-book observations and adverse selection.",
  }));
  if (allowedIntervals.length > 1) {
    add(createCandidate({
      base: input.base,
      dimension: "allowedIntervals",
      value: [5],
      source: "bounded-default",
      hypothesis: "A 5-minute-only cohort may reveal whether shorter resolution exposure improves immediate-pair opportunity quality.",
    }));
  }
  if (allowedAssets.length > 2) {
    add(createCandidate({
      base: input.base,
      dimension: "allowedAssets",
      value: allowedAssets.filter((asset) => asset !== "btc"),
      source: "bounded-default",
      hypothesis: "A non-BTC cohort may reveal whether the most liquid asset has a distinct fee-and-book regime.",
    }));
  }
  if (input.base.maxUnpairedShares > 5) {
    add(createCandidate({
      base: input.base,
      dimension: "maxUnpairedShares",
      value: Math.max(5, input.base.maxUnpairedShares / 2),
      source: "bounded-default",
      hypothesis: "Smaller directional inventory may reduce loss severity while preserving signal coverage.",
    }));
  }
  if (input.base.allowResolutionLag) {
    add(createCandidate({
      base: input.base,
      dimension: "allowResolutionLag",
      value: false,
      source: "bounded-default",
      hypothesis: "Disabling resolution-lag entries may avoid paying near-certain prices for stale or late public evidence.",
    }));
  }
  return candidates.slice(0, UPDOWN_V2_MAX_CANDIDATES);
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

export function createUpDownV2Generation(input: {
  id: string;
  now: Date;
  championPolicy: UpDownPolicy;
  parentGenerationId?: string | null;
  derivationGenerationId?: string | null;
  derivationStateDigest?: string | null;
  attribution?: UpDownLossAttribution | null;
  appliedLearning?: UpDownAppliedLearning[];
}): UpDownV2Generation {
  const candidates = generateUpDownPolicyCandidates({
    base: input.championPolicy,
    attribution: input.attribution,
    appliedLearning: input.appliedLearning,
  });
  const registeredAt = input.now.toISOString();
  return {
    id: input.id,
    createdAt: registeredAt,
    closedAt: null,
    status: "active",
    parentGenerationId: input.parentGenerationId ?? null,
    observedMarketSlugs: [],
    lastEvolutionAt: registeredAt,
    lastEvolutionEvaluationSamples: 0,
    arms: [
      createArm("cash-control", "cash-control", null, null),
      createArm("champion", "champion", { ...input.championPolicy }, null),
      ...candidates.map((candidate) => createArm(
        candidate.id,
        "challenger",
        candidate.policy,
        String(candidate.changedDimension),
      )),
    ],
    registration: {
      policyContractVersion: 2,
      registeredAt,
      scoringStartsAt: registeredAt,
      priorEvidenceExcludedFromScoring: true,
      v2OutcomesObservedBeforeFreeze: 0,
      derivationGenerationId: input.derivationGenerationId ?? null,
      derivationStateDigest: input.derivationStateDigest ?? null,
      candidateFamilySize: candidates.length,
      appliedLearningProposalIds: (input.appliedLearning ?? []).map((item) => item.proposalId),
    },
  };
}

function championOf(generation: UpDownV2Generation): UpDownPaperArm {
  const arm = generation.arms.find((candidate) => candidate.role === "champion");
  if (!arm?.policy) throw new Error(`Generation ${generation.id} has no champion policy.`);
  return arm;
}

function pairedDeltas(champion: UpDownPaperArm, challenger: UpDownPaperArm): number[] {
  const championBySlug = new Map(champion.results.map((result) => [result.slug, result.pnlUsd]));
  return challenger.results
    .filter((result) => championBySlug.has(result.slug))
    .map((result) => result.pnlUsd - (championBySlug.get(result.slug) ?? 0));
}

function comparisonRows(generation: UpDownV2Generation): UpDownCandidateComparison[] {
  const champion = championOf(generation);
  const championMetrics = calculateUpDownArmMetrics(champion);
  const raw = generation.arms
    .filter((arm) => arm.role === "challenger" && arm.policy)
    .map((arm) => {
      const metrics = calculateUpDownArmMetrics(arm);
      const deltas = pairedDeltas(champion, arm);
      return {
        arm,
        metrics,
        deltas,
        pValue: oneSidedMeanPValue(deltas),
      };
    });
  return raw.map(({ arm, metrics, deltas, pValue }, index) => {
    const ci = pairedBootstrapInterval(deltas, 5_000).map((value) => round(value, 6)) as [number, number];
    const qValue = benjaminiHochberg(
      pValue,
      raw.filter((_, otherIndex) => otherIndex !== index).map((item) => item.pValue),
    ).candidateQValue;
    const gates = {
      prospectiveRegistration: generation.registration.v2OutcomesObservedBeforeFreeze === 0,
      pairedMarketFloor: deltas.length >= UPDOWN_V2_EVOLUTION_MIN_SETTLED_MARKETS,
      tradedMarketFloor: metrics.tradedMarkets >= 32,
      positiveNetPnl: metrics.totalPnlUsd > 0,
      beatsChampion: metrics.totalPnlUsd > championMetrics.totalPnlUsd,
      positivePairedBootstrapLowerBound: ci[0] > 0,
      falseDiscoveryRate: qValue <= 0.05,
      drawdownWithinLimit: metrics.maxDrawdownPct <= UPDOWN_V2_MAX_DRAWDOWN_PCT,
      survivesThreeTimesCostStress: metrics.stressedPnlUsd > 0,
      crossAssetBreadth: metrics.profitableAssets >= 2,
      intervalBreadth: metrics.profitableIntervals >= 1,
      pnlNotConcentrated: metrics.largestWinShare <= 0.35,
    };
    return {
      armId: arm.id,
      changedDimension: arm.changedDimension ?? "unknown",
      pairedMarkets: deltas.length,
      tradedMarkets: metrics.tradedMarkets,
      totalPnlUsd: metrics.totalPnlUsd,
      championPnlUsd: championMetrics.totalPnlUsd,
      pairedDeltaPnlUsd: round(sum(deltas), 6),
      pairedDeltaCi95Usd: ci,
      pValue,
      qValue,
      maxDrawdownPct: metrics.maxDrawdownPct,
      stressedPnlUsd: metrics.stressedPnlUsd,
      gates,
      passed: Object.values(gates).every(Boolean),
    };
  });
}

function learningProposal(input: {
  generation: UpDownV2Generation;
  decision: UpDownV2Review["decision"];
  reason: string;
  attribution: UpDownLossAttribution;
  promotedArmId: string | null;
  priorAppliedMemoryId?: string | null;
  nextCandidates?: UpDownPolicyCandidate[];
}): BrainReviewProposalInput | null {
  if (!["promote", "refresh-challengers", "retire-negative-evidence"].includes(input.decision)) return null;
  const strongest = input.attribution.strongestNegativeAssociations[0];
  const suggestedCandidate = input.nextCandidates?.[0] ?? null;
  const lesson = {
    schemaVersion: 1,
    experiment: "polymarket-updown-paper-v2",
    generationId: input.generation.id,
    decision: input.decision,
    promotedArmId: input.promotedArmId,
    reason: input.reason,
    strongestNegativeAssociation: strongest ?? null,
    suggestedChange: suggestedCandidate
      ? {
        dimension: suggestedCandidate.changedDimension,
        value: suggestedCandidate.policy[suggestedCandidate.changedDimension],
        hypothesis: suggestedCandidate.hypothesis,
      }
      : null,
    causalClaim: "descriptive-only",
    futureUse: "May influence only a later frozen generation after explicit approval and apply.",
  };
  const isEvolution = Boolean(input.priorAppliedMemoryId);
  return {
    kind: isEvolution ? "memory-evolution" : "memory",
    title: `Polymarket Up/Down v2 ${input.generation.id} review`,
    summary: `${input.decision}: ${input.reason}`,
    proposedContent: JSON.stringify(lesson, null, 2),
    supersedesMemoryId: input.priorAppliedMemoryId ?? undefined,
    risk: "low",
    evidence: [{
      sourceType: "agent-run",
      sourceId: input.generation.id,
      excerpt: `Settled/traded ${input.attribution.settledMarkets}/${input.attribution.tradedMarkets}; paper PnL $${input.attribution.totalPnlUsd.toFixed(6)}. ${input.attribution.limitation}`,
    }],
    metadata: {
      project: "HivemindOS",
      memoryKey: `artifact:polymarket-updown-v2:${input.generation.id}`,
      polymarketUpDownV2Learning: lesson,
    },
  };
}

export function evaluateUpDownNegativeEvidence(input: {
  generations: UpDownV2Generation[];
  now?: Date;
}): UpDownNegativeEvidenceReport {
  const champions = input.generations.map(championOf);
  const lifetime: UpDownPaperArm = {
    id: "lifetime-champion",
    role: "champion",
    changedDimension: null,
    policy: champions.at(-1)?.policy ?? DEFAULT_UPDOWN_V2_POLICY,
    startingBalanceUsd: UPDOWN_PAPER_STARTING_BALANCE_USD,
    cashUsd: UPDOWN_PAPER_STARTING_BALANCE_USD,
    positions: Object.assign({}, ...champions.map((arm) => arm.positions)),
    results: champions.flatMap((arm) => arm.results),
  };
  const metrics = calculateUpDownArmMetrics(lifetime);
  const active = input.generations.at(-1);
  const activeChampionMetrics = active ? calculateUpDownArmMetrics(championOf(active)) : null;
  const family = active?.arms
    .filter((arm) => arm.role !== "cash-control")
    .map(calculateUpDownArmMetrics) ?? [];
  const candidateFamilyFutile = (activeChampionMetrics?.settledMarkets ?? 0) >= 252
    && family.every((candidate) => (
      candidate.tradedMarkets < 32
      || candidate.totalPnlUsd <= 0
      || candidate.bootstrapMeanPnlCi95Usd[0] <= 0
    ));
  const gates = {
    statisticallyNegative:
      metrics.tradedMarkets >= 64
      && metrics.totalPnlUsd < 0
      && metrics.bootstrapMeanPnlCi95Usd[1] < 0,
    drawdownLimitBreached:
      metrics.tradedMarkets >= 32
      && metrics.totalPnlUsd < 0
      && metrics.maxDrawdownPct >= UPDOWN_V2_RETIREMENT_DRAWDOWN_PCT,
    lossBudgetBreached:
      metrics.tradedMarkets >= 32
      && metrics.totalPnlUsd <= -(UPDOWN_PAPER_STARTING_BALANCE_USD * 0.25),
    candidateFamilyFutile,
  };
  const triggered = Object.values(gates).some(Boolean);
  const reasons = Object.entries(gates).filter(([, passed]) => passed).map(([name]) => name);
  return {
    triggered,
    evaluatedAt: (input.now ?? new Date()).toISOString(),
    settledMarkets: metrics.settledMarkets,
    tradedMarkets: metrics.tradedMarkets,
    totalPnlUsd: metrics.totalPnlUsd,
    meanPnlCi95Usd: metrics.bootstrapMeanPnlCi95Usd,
    maxDrawdownPct: metrics.maxDrawdownPct,
    gates,
    reason: triggered
      ? `Stop new entries: ${reasons.join(", ")}. Preserve and settle all existing paper positions.`
      : "The preregistered negative-evidence and risk-retirement gates have not fired.",
  };
}

export function evaluateUpDownV2Review(input: {
  generation: UpDownV2Generation;
  now?: Date;
  fills?: UpDownPaperFill[];
  resolutionDates?: Record<string, string>;
  priorAppliedMemoryId?: string | null;
  negativeEvidence?: UpDownNegativeEvidenceReport | null;
  appliedLearning?: UpDownAppliedLearning[];
}): UpDownV2Review {
  const now = input.now ?? new Date();
  const champion = championOf(input.generation);
  const resultCount = champion.results.length;
  const attribution = buildUpDownLossAttribution({
    arm: champion,
    fills: input.fills,
    resolutionDates: input.resolutionDates,
  });
  const wait = (reason: string): UpDownV2Review => ({
    evaluated: false,
    evaluatedAt: now.toISOString(),
    generationId: input.generation.id,
    resultCount,
    decision: "wait",
    promotedArmId: null,
    reason,
    comparisons: [],
    attribution,
    nextCandidates: [],
    knowledgeProposal: null,
  });
  if (input.negativeEvidence?.triggered) {
    const reason = input.negativeEvidence.reason;
    return {
      ...wait(reason),
      evaluated: true,
      decision: "retire-negative-evidence",
      knowledgeProposal: learningProposal({
        generation: input.generation,
        decision: "retire-negative-evidence",
        reason,
        attribution,
        promotedArmId: null,
        priorAppliedMemoryId: input.priorAppliedMemoryId,
        nextCandidates: generateUpDownPolicyCandidates({
          base: champion.policy!,
          attribution,
        }),
      }),
    };
  }
  if (resultCount < UPDOWN_V2_EVOLUTION_MIN_SETTLED_MARKETS) {
    return wait(`Waiting for ${UPDOWN_V2_EVOLUTION_MIN_SETTLED_MARKETS - resultCount} more settled v2 markets.`);
  }
  if (resultCount - input.generation.lastEvolutionEvaluationSamples < UPDOWN_V2_MIN_NEW_RESULTS_PER_REVIEW) {
    return wait("Waiting for a fresh, non-overlapping 32-market review batch.");
  }
  if (now.getTime() - Date.parse(input.generation.lastEvolutionAt) < UPDOWN_V2_MIN_REVIEW_INTERVAL_MS) {
    return wait("The 24-hour policy-review cooldown has not elapsed.");
  }
  const comparisons = comparisonRows(input.generation);
  const winner = comparisons
    .filter((comparison) => comparison.passed)
    .sort((left, right) => left.qValue - right.qValue || right.totalPnlUsd - left.totalPnlUsd)[0];
  const winnerArm = winner
    ? input.generation.arms.find((arm) => arm.id === winner.armId)
    : null;
  const nextCandidates = generateUpDownPolicyCandidates({
    base: winnerArm?.policy ?? champion.policy!,
    attribution,
    appliedLearning: input.appliedLearning,
  });
  const currentCandidateSignatures = input.generation.arms
    .filter((arm) => arm.role === "challenger")
    .map((arm) => `${arm.changedDimension}:${JSON.stringify(arm.policy?.[arm.changedDimension as keyof UpDownPolicy])}`)
    .sort();
  const nextCandidateSignatures = nextCandidates
    .map((candidate) => `${String(candidate.changedDimension)}:${JSON.stringify(candidate.policy[candidate.changedDimension])}`)
    .sort();
  const changedFamily = JSON.stringify(currentCandidateSignatures) !== JSON.stringify(nextCandidateSignatures);
  const decision: UpDownV2Review["decision"] = winner
    ? "promote"
    : changedFamily
      ? "refresh-challengers"
      : "retain";
  const reason = winner
    ? `Promote ${winner.armId}; every paired, FDR, risk, breadth, concentration, and cost gate passed on the frozen v2 cohort.`
    : changedFamily
      ? "No challenger passed; close this cohort and freeze a newly attributed one-change family for future-only scoring."
      : "No challenger passed and the next bounded candidate family is unchanged; retain the frozen generation.";
  return {
    evaluated: true,
    evaluatedAt: now.toISOString(),
    generationId: input.generation.id,
    resultCount,
    decision,
    promotedArmId: winner?.armId ?? null,
    reason,
    comparisons,
    attribution,
    nextCandidates,
    knowledgeProposal: learningProposal({
      generation: input.generation,
      decision,
      reason,
      attribution,
      promotedArmId: winner?.armId ?? null,
      priorAppliedMemoryId: input.priorAppliedMemoryId,
      nextCandidates,
    }),
  };
}
