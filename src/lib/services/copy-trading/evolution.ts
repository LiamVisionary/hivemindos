import type {
  CopyTradeAgentAnalysisState,
  CopyTradeCounterfactual,
  CopyTradePaperLedger,
  CopyTradeRuntimeState,
} from "@/lib/types/copy-trading";
import {
  COPY_TRADE_EVALUATION_BATCH_SIZE,
  COPY_TRADE_EVOLUTION_POLICY_VERSION,
  COPY_TRADE_PROMOTION_MIN_MATURED,
} from "@/lib/types/copy-trading";
import { summarizeCounterfactualLearning, type CopyTradeLearningSummary } from "./retrospective";

export type CopyTradeEvolutionPromotion = {
  status: "collecting" | "rejected" | "eligible";
  maturedSamples: number;
  requiredSamples: number;
  holdoutSamples: number;
  requiredHoldoutSamples: number;
  holdoutBatch: number | null;
  meanEdgePct: number | null;
  edgeCi95Pct: [number | null, number | null];
  evolvedMeanReturnPct: number | null;
  evolvedReturnCi95Pct: [number | null, number | null];
  evolvedWinRatePct: number | null;
  evolvedProfitFactor: number | null;
  sourceMaxDrawdownPct: number | null;
  evolvedMaxDrawdownPct: number | null;
  errorRatePct: number | null;
  score: number;
  gates: {
    sampleSize: boolean;
    frozenPolicy: boolean;
    walkForwardHoldout: boolean;
    positiveCi: boolean;
    positiveAbsoluteCi: boolean;
    profitFactor: boolean;
    drawdown: boolean;
    absoluteDrawdown: boolean;
    reliability: boolean;
  };
};

export type CopyTradeEvolutionComparison = {
  status: "ready" | "waiting";
  startedAt: number | null;
  sourcePortfolioUsd: number | null;
  evolvedPortfolioUsd: number | null;
  sourceReturnPct: number | null;
  evolvedReturnPct: number | null;
  returnDeltaPct: number | null;
  reviews: number;
  kept: number;
  closed: number;
  uncertain: number;
  errors: number;
  promotion: CopyTradeEvolutionPromotion;
  learning: CopyTradeLearningSummary;
};

export function paperPortfolioValue(ledger: CopyTradePaperLedger | undefined): number | null {
  if (!ledger?.initialized) return null;
  const positions = Object.values(ledger.positions).reduce((sum, position) => {
    const marked = typeof position.markUsd === "number" && Number.isFinite(position.markUsd)
      ? position.markUsd
      : position.spentUsd;
    return sum + marked;
  }, 0);
  return ledger.cashUsd + positions;
}

export function startAgentAnalysisState(input: {
  sourceConfigId: string;
  sourceState: CopyTradeRuntimeState | undefined;
  evolvedState: CopyTradeRuntimeState;
  startedAt?: number;
}): CopyTradeAgentAnalysisState {
  const sourceStartPortfolioUsd = paperPortfolioValue(input.sourceState?.paper);
  const evolvedStartPortfolioUsd = paperPortfolioValue(input.evolvedState.paper);
  return {
    sourceConfigId: input.sourceConfigId,
    startedAt: input.startedAt ?? Date.now(),
    sourceStartPortfolioUsd,
    evolvedStartPortfolioUsd,
    reviews: [],
    counterfactuals: [],
    nextSequence: 0,
    brainSync: {},
  };
}

export function compareCopyTradeEvolution(
  evolvedState: CopyTradeRuntimeState | undefined,
  sourceState: CopyTradeRuntimeState | undefined,
): CopyTradeEvolutionComparison {
  const analysis = evolvedState?.agentAnalysis;
  const reviews = analysis?.reviews ?? [];
  const counts = {
    reviews: reviews.length,
    kept: reviews.filter((review) => !review.error && !review.closeExecuted).length,
    closed: reviews.filter((review) => review.closeExecuted).length,
    uncertain: reviews.filter((review) => review.decision === "uncertain").length,
    errors: reviews.filter((review) => Boolean(review.error)).length,
  };
  const promotion = evaluateEvolutionPromotion(analysis?.counterfactuals ?? []);
  const learning = summarizeCounterfactualLearning(analysis?.counterfactuals ?? []);
  const sourcePortfolioUsd = paperPortfolioValue(sourceState?.paper);
  const evolvedPortfolioUsd = paperPortfolioValue(evolvedState?.paper);
  if (
    !analysis
    || analysis.sourceStartPortfolioUsd == null
    || analysis.evolvedStartPortfolioUsd == null
    || sourcePortfolioUsd == null
    || evolvedPortfolioUsd == null
    || reviews.length === 0
  ) {
    return {
      status: "waiting",
      startedAt: analysis?.startedAt ?? null,
      sourcePortfolioUsd,
      evolvedPortfolioUsd,
      sourceReturnPct: null,
      evolvedReturnPct: null,
      returnDeltaPct: null,
      promotion,
      learning,
      ...counts,
    };
  }
  const sourceReturnPct = percentChange(sourcePortfolioUsd, analysis.sourceStartPortfolioUsd);
  const evolvedReturnPct = percentChange(evolvedPortfolioUsd, analysis.evolvedStartPortfolioUsd);
  return {
    status: "ready",
    startedAt: analysis.startedAt,
    sourcePortfolioUsd,
    evolvedPortfolioUsd,
    sourceReturnPct,
    evolvedReturnPct,
    returnDeltaPct: evolvedReturnPct - sourceReturnPct,
    promotion,
    learning,
    ...counts,
  };
}

/** Conservative promotion gate over cost-aware paired 24-hour outcomes. */
export function evaluateEvolutionPromotion(
  records: CopyTradeCounterfactual[],
  options: { bootstrapIterations?: number } = {},
): CopyTradeEvolutionPromotion {
  const allMatured = records.filter(hasMatureOutcome).sort((a, b) => a.sequence - b.sequence);
  const matured = allMatured.filter((record) => record.policyVersion === COPY_TRADE_EVOLUTION_POLICY_VERSION);
  const batches = new Map<number, CopyTradeCounterfactual[]>();
  for (const record of matured) {
    const batch = batches.get(record.evaluationBatch) ?? [];
    batch.push(record);
    batches.set(record.evaluationBatch, batch);
  }
  const completedBatches = [...batches.entries()]
    .filter(([, batch]) => batch.length >= COPY_TRADE_EVALUATION_BATCH_SIZE)
    .sort(([left], [right]) => left - right);
  const holdoutEntry = completedBatches.at(-1);
  const holdout = holdoutEntry?.[1].slice(0, COPY_TRADE_EVALUATION_BATCH_SIZE) ?? [];
  const deltas = holdout.map((record) => record.horizons["24h"].pairedDeltaPct!);
  const sourceReturns = holdout.map((record) => record.horizons["24h"].holdReturnPct!);
  const evolvedReturns = holdout.map((record) => record.horizons["24h"].evolvedReturnPct!);
  const meanEdgePct = deltas.length ? mean(deltas) : null;
  const edgeCi95Pct = deltas.length
    ? pairedBootstrapInterval(deltas, options.bootstrapIterations ?? 2_000)
    : [null, null] as [null, null];
  const sourceMaxDrawdownPct = sourceReturns.length ? maxDrawdownPct(sourceReturns) : null;
  const evolvedMaxDrawdownPct = evolvedReturns.length ? maxDrawdownPct(evolvedReturns) : null;
  const evolvedMeanReturnPct = evolvedReturns.length ? mean(evolvedReturns) : null;
  const evolvedReturnCi95Pct = evolvedReturns.length
    ? pairedBootstrapInterval(evolvedReturns, options.bootstrapIterations ?? 2_000)
    : [null, null] as [null, null];
  const evolvedWinRatePct = evolvedReturns.length
    ? (evolvedReturns.filter((value) => value > 0).length / evolvedReturns.length) * 100
    : null;
  const evolvedProfitFactor = profitFactor(evolvedReturns);
  const errorRatePct = holdout.length
    ? (holdout.filter((record) => record.reviewPath === "sol-failed-open").length / holdout.length) * 100
    : null;
  const gates = {
    sampleSize: matured.length >= COPY_TRADE_PROMOTION_MIN_MATURED,
    frozenPolicy: holdout.length > 0
      && holdout.every((record) => record.policyVersion === COPY_TRADE_EVOLUTION_POLICY_VERSION),
    walkForwardHoldout: holdout.length >= COPY_TRADE_EVALUATION_BATCH_SIZE && (holdoutEntry?.[0] ?? 0) >= 3,
    positiveCi: edgeCi95Pct[0] != null && edgeCi95Pct[0] > 0,
    positiveAbsoluteCi: evolvedReturnCi95Pct[0] != null && evolvedReturnCi95Pct[0] > 0,
    profitFactor: evolvedProfitFactor != null && evolvedProfitFactor >= 1.2,
    drawdown: sourceMaxDrawdownPct != null
      && evolvedMaxDrawdownPct != null
      && evolvedMaxDrawdownPct <= sourceMaxDrawdownPct,
    absoluteDrawdown: evolvedMaxDrawdownPct != null && evolvedMaxDrawdownPct <= 25,
    reliability: errorRatePct != null && errorRatePct <= 5,
  };
  const hasEnoughEvidence = gates.sampleSize && gates.frozenPolicy && gates.walkForwardHoldout;
  const eligible = hasEnoughEvidence
    && gates.positiveCi
    && gates.positiveAbsoluteCi
    && gates.profitFactor
    && gates.drawdown
    && gates.absoluteDrawdown
    && gates.reliability;
  const drawdownPenalty = sourceMaxDrawdownPct != null && evolvedMaxDrawdownPct != null
    ? Math.max(0, evolvedMaxDrawdownPct - sourceMaxDrawdownPct)
    : 0;
  return {
    status: !hasEnoughEvidence ? "collecting" : eligible ? "eligible" : "rejected",
    maturedSamples: matured.length,
    requiredSamples: COPY_TRADE_PROMOTION_MIN_MATURED,
    holdoutSamples: holdout.length,
    requiredHoldoutSamples: COPY_TRADE_EVALUATION_BATCH_SIZE,
    holdoutBatch: holdoutEntry?.[0] ?? null,
    meanEdgePct: meanEdgePct == null ? null : round(meanEdgePct, 4),
    edgeCi95Pct: [nullableRound(edgeCi95Pct[0], 4), nullableRound(edgeCi95Pct[1], 4)],
    evolvedMeanReturnPct: nullableRound(evolvedMeanReturnPct, 4),
    evolvedReturnCi95Pct: [nullableRound(evolvedReturnCi95Pct[0], 4), nullableRound(evolvedReturnCi95Pct[1], 4)],
    evolvedWinRatePct: nullableRound(evolvedWinRatePct, 2),
    evolvedProfitFactor: nullableRound(evolvedProfitFactor, 2),
    sourceMaxDrawdownPct: nullableRound(sourceMaxDrawdownPct, 4),
    evolvedMaxDrawdownPct: nullableRound(evolvedMaxDrawdownPct, 4),
    errorRatePct: nullableRound(errorRatePct, 2),
    score: round((meanEdgePct ?? 0) - drawdownPenalty + Math.min(0, edgeCi95Pct[0] ?? 0), 4),
    gates,
  };
}

function profitFactor(returns: number[]): number | null {
  if (!returns.length) return null;
  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (losses === 0) return gains > 0 ? 999 : null;
  return gains / losses;
}

/** Circular block bootstrap adapted from the repository's quant validator. */
export function pairedBootstrapInterval(values: number[], iterations = 2_000): [number, number] {
  if (!values.length) return [0, 0];
  const sampleCount = values.length;
  const blockSize = Math.max(2, Math.min(sampleCount, Math.round(Math.sqrt(sampleCount))));
  const means: number[] = [];
  const random = seededRandom(0x5eeda11);
  for (let iteration = 0; iteration < Math.max(200, iterations); iteration += 1) {
    const sample: number[] = [];
    while (sample.length < sampleCount) {
      const start = Math.floor(random() * sampleCount);
      for (let offset = 0; offset < blockSize && sample.length < sampleCount; offset += 1) {
        sample.push(values[(start + offset) % sampleCount]);
      }
    }
    means.push(mean(sample));
  }
  means.sort((a, b) => a - b);
  return [percentile(means, 0.025), percentile(means, 0.975)];
}

function hasMatureOutcome(record: CopyTradeCounterfactual): boolean {
  const final = record.horizons["24h"];
  return final.observedAt != null
    && final.holdReturnPct != null
    && final.evolvedReturnPct != null
    && final.pairedDeltaPct != null;
}

function maxDrawdownPct(returns: number[]): number {
  let equity = 1;
  let peak = 1;
  let drawdown = 0;
  for (const value of returns) {
    equity *= Math.max(0, 1 + value / 100);
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }
  return drawdown;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function percentile(sorted: number[], percentileValue: number): number {
  const position = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nullableRound(value: number | null, digits: number): number | null {
  return value == null ? null : round(value, digits);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentChange(current: number, start: number): number {
  return start > 0 ? ((current - start) / start) * 100 : 0;
}
