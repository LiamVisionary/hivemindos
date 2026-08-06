import { pairedBootstrapInterval } from "@/lib/services/copy-trading/evolution";
import {
  discoverLoop,
  recordLoopExperiment,
} from "@/lib/services/loops/loop-engine";
import type {
  PennyPaperEvolutionResult,
  PennyPaperPolicy,
  PennyPaperSimulationAssumptions,
  PennyPaperSimulationResult,
  PennyPaperStrategy,
  PennyPaperWalkForwardWindow,
  PennyStockBar,
} from "./types";
import {
  commonTradingDates,
  generatePennyStrategyVariants,
  parameterNeighborhood,
  simulatePennyLimitPortfolio,
  sliceBarsByDates,
  strategyTrainingScore,
} from "./simulation";
import {
  benjaminiHochberg,
  deflatedSharpe,
  deterministicSample,
  mean,
  oneSidedMeanPValue,
  percentile,
  probabilityBacktestOverfit,
  shiftedSignalPlacebo,
} from "./statistics";

const FORWARD_WINDOWS = 4;
const MAXIMUM_TEST_BARS = 63;
const MINIMUM_TEST_BARS = 40;
const MINIMUM_TRAINING_BARS = 252;
const MAXIMUM_TOTAL_BARS = 756;

export function evaluatePennyPaperEvolution(input: {
  runId: string;
  symbols: string[];
  barsBySymbol: Record<string, PennyStockBar[]>;
  policy: PennyPaperPolicy;
  assumptions: PennyPaperSimulationAssumptions;
  asOf: string;
  priorEvidenceAsOf?: string | null;
  now?: Date;
}): PennyPaperEvolutionResult {
  if (input.symbols.length === 0) return cashEvolution(input);
  if (input.symbols.length > 3) throw new Error("Evolution accepts zero to three paper symbols.");
  const allDates = commonTradingDates(input.barsBySymbol);
  const purgeBars = Math.max(
    input.policy.strategy.orderExpiryDays,
    input.policy.strategy.maxHoldDays,
  );
  const required = MINIMUM_TRAINING_BARS
    + purgeBars
    + FORWARD_WINDOWS * MINIMUM_TEST_BARS;
  if (allDates.length < required) {
    throw new Error(
      `Walk-forward evolution needs at least ${required} aligned daily bars; received ${allDates.length}.`,
    );
  }
  const dates = allDates.slice(-MAXIMUM_TOTAL_BARS);
  const testBars = Math.min(
    MAXIMUM_TEST_BARS,
    Math.floor((dates.length - MINIMUM_TRAINING_BARS - purgeBars) / FORWARD_WINDOWS),
  );
  const trainingLength = dates.length - purgeBars - FORWARD_WINDOWS * testBars;
  const trainingDates = dates.slice(0, trainingLength);
  const trainingBars = sliceBarsByDates(input.barsBySymbol, trainingDates);
  const allVariants = generatePennyStrategyVariants(input.policy.strategy);
  const variants = allVariants.filter((strategy) =>
    changedStrategyFields(input.policy.strategy, strategy).length === 1
  );
  const scored = variants.map((strategy) => {
    const result = simulatePennyLimitPortfolio({
      barsBySymbol: trainingBars,
      strategy,
      assumptions: input.assumptions,
    });
    return { strategy, result, score: strategyTrainingScore(result) };
  }).sort((left, right) =>
    right.score - left.score
    || strategyKey(left.strategy).localeCompare(strategyKey(right.strategy))
  );
  const proposed = scored[0];
  if (!proposed || !Number.isFinite(proposed.score)) {
    throw new Error("No single-change strategy variant produced enough training fills.");
  }

  const forwardStart = trainingLength + purgeBars;
  const forwardDateWindows = Array.from({ length: FORWARD_WINDOWS }, (_, index) =>
    dates.slice(
      forwardStart + index * testBars,
      forwardStart + (index + 1) * testBars,
    )
  );
  const rawWindows = forwardDateWindows.map((windowDates, index) => {
    const bars = sliceBarsByDates(input.barsBySymbol, windowDates);
    return {
      index,
      windowDates,
      volatility: aggregateAssetVolatility(bars, windowDates),
      baseline: simulatePennyLimitPortfolio({
        barsBySymbol: bars,
        strategy: input.policy.strategy,
        assumptions: input.assumptions,
      }),
      treatment: simulatePennyLimitPortfolio({
        barsBySymbol: bars,
        strategy: proposed.strategy,
        assumptions: input.assumptions,
      }),
    };
  });
  const volatilityMedian = percentile(rawWindows.map((row) => row.volatility), 0.5);
  const windows: PennyPaperWalkForwardWindow[] = rawWindows.map((row) => ({
    id: `forward-${row.index + 1}`,
    regime: row.volatility >= volatilityMedian ? "higher-volatility" : "lower-volatility",
    startDate: row.windowDates[0],
    endDate: row.windowDates.at(-1) ?? row.windowDates[0],
    baseline: row.baseline,
    treatment: row.treatment,
    returnDeltaPct: round(row.treatment.returnPct - row.baseline.returnPct, 6),
  }));

  const baselineAggregatePnlUsd = sum(windows.map((window) => window.baseline.totalPnlUsd));
  const treatmentAggregatePnlUsd = sum(windows.map((window) => window.treatment.totalPnlUsd));
  const baselineAggregateReturnPct = sum(windows.map((window) => window.baseline.returnPct));
  const treatmentAggregateReturnPct = sum(windows.map((window) => window.treatment.returnPct));
  const baselineMaxDrawdownPct = Math.max(
    ...windows.map((window) => window.baseline.maxDrawdownPct),
  );
  const treatmentMaxDrawdownPct = Math.max(
    ...windows.map((window) => window.treatment.maxDrawdownPct),
  );
  const winningWindows = windows.filter(
    (window) => window.treatment.totalPnlUsd > window.baseline.totalPnlUsd,
  ).length;
  const dailyDeltas = alignedDailyDeltas(windows);
  const pairedDailyReturnCi95Pct = pairedBootstrapInterval(dailyDeltas, 5_000)
    .map((value) => round(value, 8)) as [number, number];
  const treatmentReturns = windows.flatMap((window) => window.treatment.dailyReturnsPct);
  const trainingCandidateReturns = scored
    .filter((row) => row.result.dailyReturnsPct.length === proposed.result.dailyReturnsPct.length)
    .map((row) => row.result.dailyReturnsPct);
  const pbo = probabilityBacktestOverfit(trainingCandidateReturns, 8);
  const dsr = deflatedSharpe(treatmentReturns, allVariants.length);
  const assetReturns = forwardDateWindows.flatMap((windowDates) =>
    aggregateAssetReturns(input.barsBySymbol, windowDates)
  );
  const positions = windows.flatMap((window) =>
    window.treatment.dailyPositions.slice(1).map((count) =>
      count / Math.max(1, input.assumptions.maxConcurrentPositions)
    )
  );
  const placebo = shiftedSignalPlacebo({
    actualReturnsPct: treatmentReturns,
    positions,
    assetReturnsPct: assetReturns,
    iterations: 2_000,
    seed: hashSeed(input.runId),
  });
  const trialPValues = scored.slice(0, 24).map((row) => {
    const returns = simulateAcrossWindows({
      strategy: row.strategy,
      windows: forwardDateWindows,
      barsBySymbol: input.barsBySymbol,
      assumptions: input.assumptions,
    }).flatMap((result) => result.dailyReturnsPct);
    const baselineReturns = windows.flatMap((window) => window.baseline.dailyReturnsPct);
    return oneSidedMeanPValue(alignedDifference(returns, baselineReturns));
  });
  const fdr = benjaminiHochberg(oneSidedMeanPValue(dailyDeltas), trialPValues);
  const simpleStrategy: PennyPaperStrategy = {
    entryDiscountPct: 30,
    takeProfitPct: 42.8571,
    stopLossPct: 20,
    maxHoldDays: 10,
    orderExpiryDays: 20,
  };
  const simplePnlUsd = sum(simulateAcrossWindows({
    strategy: simpleStrategy,
    windows: forwardDateWindows,
    barsBySymbol: input.barsBySymbol,
    assumptions: input.assumptions,
  }).map((result) => result.totalPnlUsd));
  const randomPnls = deterministicSample(allVariants, 25, hashSeed(input.runId) + 17)
    .map((strategy) => sum(simulateAcrossWindows({
      strategy,
      windows: forwardDateWindows,
      barsBySymbol: input.barsBySymbol,
      assumptions: input.assumptions,
    }).map((result) => result.totalPnlUsd)));
  const neighborhoodPnls = parameterNeighborhood(proposed.strategy, allVariants)
    .map((strategy) => sum(simulateAcrossWindows({
      strategy,
      windows: forwardDateWindows,
      barsBySymbol: input.barsBySymbol,
      assumptions: input.assumptions,
    }).map((result) => result.totalPnlUsd)));
  const costStress = ([1, 2, 3] as const).map((multiplier) => {
    const results = simulateAcrossWindows({
      strategy: proposed.strategy,
      windows: forwardDateWindows,
      barsBySymbol: input.barsBySymbol,
      assumptions: { ...input.assumptions, costStressMultiplier: multiplier },
    });
    return {
      multiplier,
      pnlUsd: round(sum(results.map((result) => result.totalPnlUsd)), 6),
      maxDrawdownPct: round(Math.max(...results.map((result) => result.maxDrawdownPct)), 6),
    };
  });
  const regimePnlUsd = {
    "lower-volatility": round(sum(windows
      .filter((window) => window.regime === "lower-volatility")
      .map((window) => window.treatment.totalPnlUsd)), 6),
    "higher-volatility": round(sum(windows
      .filter((window) => window.regime === "higher-volatility")
      .map((window) => window.treatment.totalPnlUsd)), 6),
  };
  const statisticalEvidence = {
    deflatedSharpe: dsr,
    pbo,
    placebo,
    fdr,
    benchmarks: {
      cashPnlUsd: 0,
      baselinePnlUsd: round(baselineAggregatePnlUsd, 6),
      simplePnlUsd: round(simplePnlUsd, 6),
      randomMedianPnlUsd: round(percentile(randomPnls, 0.5), 6),
      treatmentPnlUsd: round(treatmentAggregatePnlUsd, 6),
    },
    parameterNeighborhood: {
      variants: neighborhoodPnls.length,
      positiveVariants: neighborhoodPnls.filter((value) => value > 0).length,
      medianPnlUsd: round(percentile(neighborhoodPnls, 0.5), 6),
    },
    costStress,
    regimePnlUsd,
  };
  const treatmentFills = sum(windows.map((window) => window.treatment.fills));
  const newEvidenceAvailable = input.priorEvidenceAsOf !== input.asOf;
  const gates = {
    enoughForwardWindows: windows.length === FORWARD_WINDOWS,
    minimumFills: treatmentFills >= 8,
    positiveAggregatePnl: treatmentAggregatePnlUsd > 0,
    beatsBaselinePnl: treatmentAggregatePnlUsd > baselineAggregatePnlUsd,
    beatsCashAndSimpleBenchmarks:
      treatmentAggregatePnlUsd > 0
      && treatmentAggregatePnlUsd > simplePnlUsd
      && treatmentAggregatePnlUsd > statisticalEvidence.benchmarks.randomMedianPnlUsd,
    winsMostWindows: winningWindows >= 3,
    positiveBootstrapLowerBound: pairedDailyReturnCi95Pct[0] > 0,
    drawdownNotWorse: treatmentMaxDrawdownPct <= baselineMaxDrawdownPct,
    positiveAcrossRegimes: Object.values(regimePnlUsd).every((value) => value > 0),
    deflatedSharpe: dsr.probability >= 0.95,
    pbo: pbo.coverage === "complete" && pbo.probability <= 0.5,
    placebo: placebo.pValue <= 0.05,
    falseDiscoveryRate: fdr.candidateQValue <= 0.05,
    parameterNeighborhood:
      neighborhoodPnls.length >= 4
      && statisticalEvidence.parameterNeighborhood.medianPnlUsd > 0
      && statisticalEvidence.parameterNeighborhood.positiveVariants
        >= Math.ceil(neighborhoodPnls.length * 0.75),
    pessimisticCostStress: costStress.every((row) =>
      row.pnlUsd > 0 && row.maxDrawdownPct <= input.assumptions.maxPortfolioDrawdownPct
    ),
    newEvidenceAvailable,
    oneMajorChangeOnly:
      changedStrategyFields(input.policy.strategy, proposed.strategy).length === 1,
  };
  const accepted = Object.values(gates).every(Boolean);
  const now = input.now ?? new Date();
  const policyVersionAfter = accepted ? input.policy.version + 1 : input.policy.version;
  const majorChange = describeChange(input.policy.strategy, proposed.strategy);
  const loop = buildEvolutionLoop({
    runId: input.runId,
    baselineStrategy: input.policy.strategy,
    proposedStrategy: proposed.strategy,
    baselinePnl: baselineAggregatePnlUsd,
    treatmentPnl: treatmentAggregatePnlUsd,
    accepted,
    gates,
    now: now.getTime(),
  });

  return {
    schemaVersion: 2,
    runId: input.runId,
    evaluatedAt: now.toISOString(),
    symbols: [...input.symbols],
    historyBars: dates.length,
    training: {
      startDate: trainingDates[0],
      endDate: trainingDates.at(-1) ?? trainingDates[0],
      variantsEvaluated: variants.length,
      selectedScore: round(proposed.score, 6),
    },
    baselineStrategy: input.policy.strategy,
    proposedStrategy: proposed.strategy,
    majorChange,
    baselineAggregatePnlUsd: round(baselineAggregatePnlUsd, 6),
    treatmentAggregatePnlUsd: round(treatmentAggregatePnlUsd, 6),
    aggregatePnlDeltaUsd: round(treatmentAggregatePnlUsd - baselineAggregatePnlUsd, 6),
    baselineAggregateReturnPct: round(baselineAggregateReturnPct, 6),
    treatmentAggregateReturnPct: round(treatmentAggregateReturnPct, 6),
    treatmentMaxDrawdownPct: round(treatmentMaxDrawdownPct, 6),
    baselineMaxDrawdownPct: round(baselineMaxDrawdownPct, 6),
    winningWindows,
    pairedDailyReturnCi95Pct,
    statisticalEvidence,
    gates,
    decision: accepted ? "accepted" : "rejected",
    policyVersionBefore: input.policy.version,
    policyVersionAfter,
    windows,
    loop,
    researchOnly: true,
    liveTradingEnabled: false,
  };
}

function cashEvolution(input: {
  runId: string;
  symbols: string[];
  policy: PennyPaperPolicy;
  asOf: string;
  priorEvidenceAsOf?: string | null;
  now?: Date;
}): PennyPaperEvolutionResult {
  const now = input.now ?? new Date();
  const gates = {
    enoughForwardWindows: false,
    minimumFills: false,
    positiveAggregatePnl: false,
    beatsBaselinePnl: false,
    beatsCashAndSimpleBenchmarks: false,
    winsMostWindows: false,
    positiveBootstrapLowerBound: false,
    drawdownNotWorse: true,
    positiveAcrossRegimes: false,
    deflatedSharpe: false,
    pbo: false,
    placebo: false,
    falseDiscoveryRate: false,
    parameterNeighborhood: false,
    pessimisticCostStress: true,
    newEvidenceAvailable: input.priorEvidenceAsOf !== input.asOf,
    oneMajorChangeOnly: true,
  };
  return {
    schemaVersion: 2,
    runId: input.runId,
    evaluatedAt: now.toISOString(),
    symbols: [],
    historyBars: 0,
    training: {
      startDate: input.asOf.slice(0, 10),
      endDate: input.asOf.slice(0, 10),
      variantsEvaluated: 0,
      selectedScore: 0,
    },
    baselineStrategy: input.policy.strategy,
    proposedStrategy: input.policy.strategy,
    majorChange: "No strategy change; the reasoner retained cash.",
    baselineAggregatePnlUsd: 0,
    treatmentAggregatePnlUsd: 0,
    aggregatePnlDeltaUsd: 0,
    baselineAggregateReturnPct: 0,
    treatmentAggregateReturnPct: 0,
    treatmentMaxDrawdownPct: 0,
    baselineMaxDrawdownPct: 0,
    winningWindows: 0,
    pairedDailyReturnCi95Pct: [0, 0],
    statisticalEvidence: {
      deflatedSharpe: { observedSharpe: 0, nullMaxSharpe: 0, probability: 0.5 },
      pbo: {
        coverage: "missing",
        segments: 0,
        combinations: 0,
        probability: 1,
        reason: "Cash selection has no candidate return family.",
      },
      placebo: {
        iterations: 0,
        pValue: 1,
        candidateMeanPct: 0,
        placeboCi95Pct: [0, 0],
      },
      fdr: { familySize: 0, candidatePValue: 1, candidateQValue: 1 },
      benchmarks: {
        cashPnlUsd: 0,
        baselinePnlUsd: 0,
        simplePnlUsd: 0,
        randomMedianPnlUsd: 0,
        treatmentPnlUsd: 0,
      },
      parameterNeighborhood: { variants: 0, positiveVariants: 0, medianPnlUsd: 0 },
      costStress: ([1, 2, 3] as const).map((multiplier) => ({
        multiplier,
        pnlUsd: 0,
        maxDrawdownPct: 0,
      })),
      regimePnlUsd: { "lower-volatility": 0, "higher-volatility": 0 },
    },
    gates,
    decision: "cash",
    policyVersionBefore: input.policy.version,
    policyVersionAfter: input.policy.version,
    windows: [],
    loop: buildEvolutionLoop({
      runId: input.runId,
      baselineStrategy: input.policy.strategy,
      proposedStrategy: input.policy.strategy,
      baselinePnl: 0,
      treatmentPnl: 0,
      accepted: false,
      gates,
      now: now.getTime(),
    }),
    researchOnly: true,
    liveTradingEnabled: false,
  };
}

function simulateAcrossWindows(input: {
  strategy: PennyPaperStrategy;
  windows: string[][];
  barsBySymbol: Record<string, PennyStockBar[]>;
  assumptions: PennyPaperSimulationAssumptions;
}): PennyPaperSimulationResult[] {
  return input.windows.map((dates) => simulatePennyLimitPortfolio({
    barsBySymbol: sliceBarsByDates(input.barsBySymbol, dates),
    strategy: input.strategy,
    assumptions: input.assumptions,
  }));
}

function alignedDailyDeltas(windows: PennyPaperWalkForwardWindow[]) {
  return windows.flatMap((window) =>
    alignedDifference(
      window.treatment.dailyReturnsPct,
      window.baseline.dailyReturnsPct,
    )
  );
}

function alignedDifference(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  return Array.from({ length }, (_, index) => left[index] - right[index]);
}

function aggregateAssetReturns(
  barsBySymbol: Record<string, PennyStockBar[]>,
  dates: string[],
) {
  const sliced = sliceBarsByDates(barsBySymbol, dates);
  const returns = Object.values(sliced).map((bars) => {
    const values: number[] = [];
    for (let index = 1; index < bars.length; index += 1) {
      values.push(bars[index - 1].close > 0
        ? ((bars[index].close - bars[index - 1].close) / bars[index - 1].close) * 100
        : 0);
    }
    return values;
  });
  const length = Math.min(...returns.map((values) => values.length));
  return Array.from({ length }, (_, index) =>
    mean(returns.map((values) => values[index]))
  );
}

function aggregateAssetVolatility(
  barsBySymbol: Record<string, PennyStockBar[]>,
  dates: string[],
) {
  const returns = aggregateAssetReturns(barsBySymbol, dates);
  if (returns.length < 2) return 0;
  const average = mean(returns);
  return Math.sqrt(
    returns.reduce((total, value) => total + (value - average) ** 2, 0)
    / (returns.length - 1),
  );
}

function buildEvolutionLoop(input: {
  runId: string;
  baselineStrategy: PennyPaperStrategy;
  proposedStrategy: PennyPaperStrategy;
  baselinePnl: number;
  treatmentPnl: number;
  accepted: boolean;
  gates: Record<string, boolean>;
  now: number;
}) {
  let loop = discoverLoop(undefined, {
    goal: "Improve pessimistic simulated PnL without worsening walk-forward drawdown.",
    successCriteria: [
      "Change one strategy dimension per generation.",
      "Use purged training and at least four non-overlapping forward cohorts.",
      "Retain a strategy only when every statistical, robustness, and risk gate passes.",
    ],
    target: "penny-stock-paper-limit-strategy",
    metricName: "aggregate_forward_pnl_usd",
    metricDirection: "max",
    discoveredAt: input.now,
    frontierStrategy: { kind: "argmax" },
  });
  loop = recordLoopExperiment(loop, {
    id: `${input.runId}-baseline`,
    runId: input.runId,
    title: "Current paper policy",
    hypothesis: `The current paper policy is the frozen benchmark: ${strategyKey(input.baselineStrategy)}.`,
    status: "committed",
    score: round(input.baselinePnl, 6),
    taskScores: {},
    agent: "deterministic-research-only-simulator",
    result: "Frozen baseline evaluated on identical forward cohorts.",
    createdAt: input.now,
    updatedAt: input.now,
  });
  return recordLoopExperiment(loop, {
    id: `${input.runId}-treatment`,
    parentId: `${input.runId}-baseline`,
    runId: input.runId,
    title: "Single-change training treatment",
    hypothesis: `One parameter change improves robust forward PnL: ${strategyKey(input.proposedStrategy)}.`,
    status: input.accepted ? "committed" : "discarded",
    score: round(input.treatmentPnl, 6),
    taskScores: Object.fromEntries(
      Object.entries(input.gates).map(([key, passed]) => [key, passed ? 1 : 0]),
    ),
    agent: "deterministic-research-only-simulator",
    result: input.accepted
      ? "Accepted only after every forward, risk, and overfitting gate passed."
      : "Rejected; the current policy remains active.",
    discardedReason: input.accepted
      ? undefined
      : `Failed gates: ${Object.entries(input.gates)
        .filter(([, passed]) => !passed)
        .map(([key]) => key)
        .join(", ") || "none"}.`,
    createdAt: input.now + 1,
    updatedAt: input.now + 1,
  });
}

function changedStrategyFields(
  baseline: PennyPaperStrategy,
  proposed: PennyPaperStrategy,
) {
  return (Object.keys(baseline) as Array<keyof PennyPaperStrategy>)
    .filter((key) => baseline[key] !== proposed[key]);
}

function describeChange(baseline: PennyPaperStrategy, proposed: PennyPaperStrategy) {
  const fields = changedStrategyFields(baseline, proposed);
  if (fields.length !== 1) return `Invalid major-change count: ${fields.length}.`;
  const field = fields[0];
  return `${field}: ${baseline[field]} → ${proposed[field]}`;
}

function strategyKey(strategy: PennyPaperStrategy): string {
  return [
    `entry-${strategy.entryDiscountPct}`,
    `target-${strategy.takeProfitPct}`,
    `stop-${strategy.stopLossPct}`,
    `hold-${strategy.maxHoldDays}`,
    `expiry-${strategy.orderExpiryDays}`,
  ].join("_");
}

function hashSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
