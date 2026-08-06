import type {
  PennyPaperCandidateOutcome,
  PennyPaperCatalystHypothesis,
  PennyPaperDecisionReview,
  PennyPaperOutcomeLearning,
  PennyPaperPolicy,
  PennyPaperSelectorWeights,
  PennyStockBar,
  PennyStockResearchRow,
  PennyStockResearchArtifact,
  PennyStockRiskUpdateSignal,
} from "./types";
import {
  DEFAULT_PENNY_PAPER_ASSUMPTIONS,
  simulatePennyLimitPortfolio,
} from "./simulation";

export type PennyOutcomeSourceRun = {
  research: PennyStockResearchArtifact;
  selectedSymbols: string[];
};

export function evaluatePennyCandidateOutcomes(input: {
  runs: PennyOutcomeSourceRun[];
  barsBySymbol: Record<string, PennyStockBar[]>;
  riskUpdatesBySymbol?: Record<string, PennyStockRiskUpdateSignal>;
  policy: PennyPaperPolicy;
  evaluatedAt: Date;
}): PennyPaperOutcomeLearning {
  const sourceCandidates = input.runs.reduce(
    (total, run) => total + run.research.candidates.length,
    0,
  );
  const outcomes = input.runs.flatMap((run) =>
    run.research.candidates.flatMap((candidate) => {
      const outcome = matureCandidate({
        sourceRunId: run.research.runId,
        sourceAsOf: run.research.asOf,
        sourceRank: candidate.rank,
        selected: run.selectedSymbols.includes(candidate.symbol),
        candidate,
        strategy: run.research.method.baselineStrategy,
        prospectiveEntryDiscountsPct:
          run.research.method.prospectiveEntryDiscountsPct ?? [],
        bars: input.barsBySymbol[candidate.symbol] ?? [],
        riskUpdate: input.riskUpdatesBySymbol?.[candidate.symbol],
      });
      return outcome ? [outcome] : [];
    })
  );
  const complete = outcomes.filter((outcome) => outcome.horizons["20"].matured);
  const maturityCutoffMs = input.evaluatedAt.getTime() - 35 * 86_400_000;
  const maturityEligibleCandidates20 = input.runs.reduce((total, run) =>
    total + (Date.parse(run.research.asOf) <= maturityCutoffMs
      ? run.research.candidates.length
      : 0),
  0);
  const sourceCoveragePct = sourceCandidates
    ? outcomes.length / sourceCandidates * 100
    : 100;
  const maturityCoveragePct20 = maturityEligibleCandidates20
    ? complete.length / maturityEligibleCandidates20 * 100
    : 100;
  const promotionCoverageGate = maturityEligibleCandidates20 > 0
    && sourceCoveragePct >= 95
    && maturityCoveragePct20 >= 95;
  const featureRows = complete.flatMap((outcome) => {
    const run = input.runs.find((row) => row.research.runId === outcome.sourceRunId);
    const candidate = run?.research.candidates.find((row) => row.symbol === outcome.symbol);
    const returnPct = outcome.decisionReviews?.["20"]
      ?.methodCounterfactual.returnPct;
    if (!candidate || returnPct == null) return [];
    return [{
      outcome,
      returnPct,
      features: normalizedFeatures(candidate),
    }];
  });
  const proposedWeights = { ...input.policy.selectorWeights };
  let promoted = false;
  let promotionReason = promotionCoverageGate
    ? `Need 100 matured 20-session outcomes with a 25-observation frozen holdout; found ${featureRows.length}.`
    : maturityEligibleCandidates20 === 0
      ? "Outcome completeness gate failed: no candidate is mature-eligible at 20 sessions yet."
      : `Outcome completeness gate failed: source coverage ${sourceCoveragePct.toFixed(1)}% and mature-eligible 20-session coverage ${maturityCoveragePct20.toFixed(1)}%; both must reach 95% before selector learning.`;
  if (featureRows.length >= 100 && promotionCoverageGate) {
    const ordered = [...featureRows].sort((left, right) =>
      left.outcome.sourceAsOf.localeCompare(right.outcome.sourceAsOf)
      || left.outcome.symbol.localeCompare(right.outcome.symbol)
    );
    const holdout = ordered.slice(-25);
    const training = ordered.slice(0, -25);
    const correlations = (Object.keys(proposedWeights) as Array<keyof PennyPaperSelectorWeights>)
      .filter((key) => key !== "secRiskPenalty")
      .map((key) => ({
        key,
        correlation: correlation(
          training.map((row) => row.features[key]),
          training.map((row) => row.returnPct),
        ),
      }))
      .sort((left, right) =>
        Math.abs(right.correlation) - Math.abs(left.correlation)
        || left.key.localeCompare(right.key)
      );
    const best = correlations[0];
    if (best) {
      const direction = best.correlation >= 0 ? 1 : -1;
      proposedWeights[best.key] = Math.max(
        0.01,
        proposedWeights[best.key] + direction * 0.02,
      );
      normalizeWeights(proposedWeights);
      const currentHoldout = topBasketReturn(
        holdout,
        input.policy.selectorWeights,
      );
      const proposedHoldout = topBasketReturn(holdout, proposedWeights);
      const currentTraining = topBasketReturn(
        training,
        input.policy.selectorWeights,
      );
      const proposedTraining = topBasketReturn(training, proposedWeights);
      promoted =
        proposedTraining > currentTraining
        && proposedHoldout > currentHoldout
        && changedWeightCount(input.policy.selectorWeights, proposedWeights) > 0;
      promotionReason = promoted
        ? `${best.key} weight changed by one 0.02 step; training basket delta ${(proposedTraining - currentTraining).toFixed(3)} pp and frozen-holdout delta ${(proposedHoldout - currentHoldout).toFixed(3)} pp.`
        : `Proposed ${best.key} weight step failed positive training and frozen-holdout deltas.`;
    }
  }
  const catalystReviewSymbols = selectPennyOutcomeCatalystReviewSymbols(outcomes);
  const entryDistanceLearning = buildEntryDistanceLearning(
    complete,
    input.policy.strategy.entryDiscountPct,
    promotionCoverageGate,
  );
  return {
    schemaVersion: 2,
    evaluatedAt: input.evaluatedAt.toISOString(),
    outcomes,
    completeTwentySessionOutcomes: complete.length,
    selectorPolicyVersionBefore: input.policy.selectorPolicyVersion,
    selectorPolicyVersionAfter: promoted
      ? input.policy.selectorPolicyVersion + 1
      : input.policy.selectorPolicyVersion,
    proposedWeights,
    promoted,
    promotionReason,
    learningTarget: "standing-limit-counterfactual-return",
    catalystReviewSymbols,
    decisionCalibration: summarizeDecisionCalibration(outcomes),
    labelCoverage: {
      sourceCandidates,
      candidateOutcomes: outcomes.length,
      sourceCoveragePct: round(sourceCoveragePct, 4),
      maturityEligibleCandidates20,
      maturedCandidates20: complete.length,
      maturityCoveragePct20: round(maturityCoveragePct20, 4),
      promotionCoverageGate,
    },
    entryDistanceLearning,
    researchOnly: true,
  };
}

function matureCandidate(input: {
  sourceRunId: string;
  sourceAsOf: string;
  sourceRank: number;
  selected: boolean;
  candidate: PennyStockResearchRow;
  strategy: PennyStockResearchArtifact["method"]["baselineStrategy"];
  prospectiveEntryDiscountsPct: number[];
  bars: PennyStockBar[];
  riskUpdate?: PennyStockRiskUpdateSignal;
}): PennyPaperCandidateOutcome | null {
  const bars = [...input.bars]
    .filter((bar) => /^\d{4}-\d{2}-\d{2}$/.test(bar.date) && bar.close > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  let baseIndex = -1;
  const sourceDate = input.sourceAsOf.slice(0, 10);
  for (let index = 0; index < bars.length; index += 1) {
    if (bars[index].date <= sourceDate) baseIndex = index;
    else break;
  }
  if (baseIndex < 0) return null;
  const base = bars[baseIndex];
  const horizonEntries = ([1, 5, 10, 20] as const).map((horizon) => {
    const end = bars[baseIndex + horizon];
    const path = bars.slice(baseIndex + 1, baseIndex + horizon + 1);
    const matured = Boolean(end) && path.length === horizon;
    return [String(horizon), {
      matured,
      observedDate: matured ? end.date : null,
      observedCloseUsd: matured ? end.close : null,
      closeReturnPct: matured ? round(((end.close - base.close) / base.close) * 100, 6) : null,
      maximumFavorableExcursionPct: matured
        ? round((Math.max(...path.map((bar) => bar.high)) / base.close - 1) * 100, 6)
        : null,
      maximumAdverseExcursionPct: matured
        ? round((Math.min(...path.map((bar) => bar.low)) / base.close - 1) * 100, 6)
        : null,
    }] as const;
  });
  const horizons = Object.fromEntries(horizonEntries) as PennyPaperCandidateOutcome["horizons"];
  const decisionReviews = Object.fromEntries(horizonEntries.flatMap(([key, value]) => {
    if (!value.matured) return [];
    const horizon = Number(key) as 1 | 5 | 10 | 20;
    const path = bars.slice(baseIndex + 1, baseIndex + horizon + 1);
    return [[key, buildDecisionReview({
      horizon,
      base,
      path,
      candidate: input.candidate,
      selected: input.selected,
      strategy: input.strategy,
      prospectiveEntryDiscountsPct: input.prospectiveEntryDiscountsPct,
      riskUpdate: input.riskUpdate,
      closeReturnPct: value.closeReturnPct ?? 0,
      maximumFavorableExcursionPct: value.maximumFavorableExcursionPct ?? 0,
      maximumAdverseExcursionPct: value.maximumAdverseExcursionPct ?? 0,
    })]];
  })) as PennyPaperCandidateOutcome["decisionReviews"];
  return {
    symbol: input.candidate.symbol,
    sourceRunId: input.sourceRunId,
    sourceAsOf: input.sourceAsOf,
    sourceRank: input.sourceRank,
    selected: input.selected,
    sourceScreenPriceUsd: input.candidate.priceUsd,
    referenceDate: base.date,
    referenceCloseUsd: base.close,
    observedThrough: bars.at(-1)?.date ?? sourceDate,
    horizons,
    decisionReviews,
  };
}

export function selectPennyOutcomeCatalystReviewSymbols(
  outcomes: PennyPaperCandidateOutcome[],
  limit = 20,
  previous?: PennyPaperOutcomeLearning | null,
) {
  const previouslyReviewedSymbols = new Set(previous?.catalystReviewSymbols ?? []);
  const previousReviewKeys = new Set((previous?.outcomes ?? []).flatMap((outcome) =>
    previouslyReviewedSymbols.has(outcome.symbol)
      ? Object.entries(outcome.decisionReviews ?? {}).flatMap(([horizon, review]) =>
        review
          ? [`${outcome.sourceRunId}|${outcome.symbol}|${horizon}|${
            outcome.horizons[horizon as "1" | "5" | "10" | "20"].observedDate ?? ""
          }`]
          : []
      )
      : []
  ));
  return outcomes
    .flatMap((outcome) => {
      const review = latestDecisionReview(outcome);
      const horizon = review?.horizonSessions;
      const horizonKey = horizon
        ? String(horizon) as "1" | "5" | "10" | "20"
        : null;
      const closeReturnPct = horizonKey
        ? outcome.horizons[horizonKey].closeReturnPct
        : null;
      const reviewKey = review && horizonKey
        ? `${outcome.sourceRunId}|${outcome.symbol}|${horizonKey}|${
          outcome.horizons[horizonKey].observedDate ?? ""
        }`
        : "";
      return review?.marketContext.materialMove
        && !previousReviewKeys.has(reviewKey)
        ? [{
          symbol: outcome.symbol,
          magnitude: Math.max(
            Math.abs(closeReturnPct ?? 0),
            review.marketContext.maximumAbsoluteOvernightGapPct,
          ),
        }]
        : [];
    })
    .sort((left, right) =>
      right.magnitude - left.magnitude
      || left.symbol.localeCompare(right.symbol)
    )
    .filter((row, index, rows) =>
      rows.findIndex((candidate) => candidate.symbol === row.symbol) === index
    )
    .slice(0, limit)
    .map((row) => row.symbol);
}

export function carryForwardPennyOutcomeCatalystEvidence(
  current: PennyPaperOutcomeLearning,
  previous?: PennyPaperOutcomeLearning | null,
) {
  if (!previous) return current;
  const previousReviews = new Map<string, PennyPaperDecisionReview>();
  for (const outcome of previous.outcomes) {
    for (const [horizon, review] of Object.entries(outcome.decisionReviews ?? {})) {
      if (!review) continue;
      const horizonKey = horizon as "1" | "5" | "10" | "20";
      previousReviews.set(
        `${outcome.sourceRunId}|${outcome.symbol}|${horizon}|${
          outcome.horizons[horizonKey].observedDate ?? ""
        }`,
        review,
      );
    }
  }
  for (const outcome of current.outcomes) {
    for (const [horizon, review] of Object.entries(outcome.decisionReviews ?? {})) {
      if (!review) continue;
      const horizonKey = horizon as "1" | "5" | "10" | "20";
      const previousReview = previousReviews.get(
        `${outcome.sourceRunId}|${outcome.symbol}|${horizon}|${
          outcome.horizons[horizonKey].observedDate ?? ""
        }`,
      );
      if (!previousReview?.catalystHypotheses.length) continue;
      review.catalystHypotheses = deduplicateCatalysts([
        ...review.catalystHypotheses,
        ...previousReview.catalystHypotheses,
      ]);
    }
  }
  current.decisionCalibration = summarizeDecisionCalibration(current.outcomes);
  return current;
}

function buildEntryDistanceLearning(
  completeOutcomes: PennyPaperCandidateOutcome[],
  activeEntryDiscountPct: number,
  promotionCoverageGate: boolean,
): NonNullable<PennyPaperOutcomeLearning["entryDistanceLearning"]> {
  const panels = completeOutcomes.flatMap((outcome) => {
    const panel = outcome.decisionReviews?.["20"]?.entryDistancePanel ?? [];
    return panel.length ? [{ outcome, panel }] : [];
  }).sort((left, right) =>
    left.outcome.sourceAsOf.localeCompare(right.outcome.sourceAsOf)
    || left.outcome.symbol.localeCompare(right.outcome.symbol)
  );
  const discounts = [...new Set(panels.flatMap((row) =>
    row.panel.map((variant) => variant.entryDiscountPct)
  ))].sort((left, right) => left - right);
  const variants = discounts.map((entryDiscountPct) => {
    const rows = panels.flatMap((panel) => {
      const row = panel.panel.find((variant) =>
        variant.entryDiscountPct === entryDiscountPct
      );
      return row ? [row] : [];
    });
    const filled = rows.filter((row) => row.fills > 0);
    const holdoutRows = rows.length >= 100 ? rows.slice(-25) : [];
    const trainingRows = holdoutRows.length ? rows.slice(0, -25) : rows;
    const stressMean = (multiplier: "1" | "2" | "3") =>
      mean(rows.map((row) => row.costStressReturnPct[multiplier]));
    return {
      entryDiscountPct,
      observations: rows.length,
      fills: filled.length,
      trainingObservations: trainingRows.length,
      holdoutObservations: holdoutRows.length,
      posteriorFillProbabilityPct: round(
        rows.length ? (filled.length + 2) / (rows.length + 4) * 100 : 50,
        4,
      ),
      meanReturnPctPerOrder: round(mean(rows.map((row) => row.returnPct)), 6),
      meanReturnPctPerFill: filled.length
        ? round(mean(filled.map((row) => row.returnPct)), 6)
        : null,
      trainingMeanReturnPctPerOrder: trainingRows.length
        ? round(mean(trainingRows.map((row) => row.returnPct)), 6)
        : null,
      holdoutMeanReturnPctPerOrder: holdoutRows.length
        ? round(mean(holdoutRows.map((row) => row.returnPct)), 6)
        : null,
      worstDrawdownPct: round(Math.max(0, ...rows.map((row) => row.maxDrawdownPct)), 6),
      meanCostStressReturnPct: {
        "1": round(stressMean("1"), 6),
        "2": round(stressMean("2"), 6),
        "3": round(stressMean("3"), 6),
      },
    };
  });
  const minimumProspectiveObservations = 100 as const;
  const frozenHoldoutObservations = 25 as const;
  const promotionEligible = promotionCoverageGate
    && panels.length >= minimumProspectiveObservations
    && variants.some((row) =>
      row.observations >= minimumProspectiveObservations
      && row.trainingObservations >= minimumProspectiveObservations - frozenHoldoutObservations
      && row.holdoutObservations === frozenHoldoutObservations
      && (row.trainingMeanReturnPctPerOrder ?? 0) > 0
      && (row.holdoutMeanReturnPctPerOrder ?? 0) > 0
      && Object.values(row.meanCostStressReturnPct).every((value) => value > 0)
    );
  return {
    registeredProspectively: true,
    activeEntryDiscountPct,
    maturedPanelObservations20: panels.length,
    variants,
    minimumProspectiveObservations,
    frozenHoldoutObservations,
    promotionEligible,
    conclusion: promotionEligible
      ? "At least one prospective entry-distance variant has enough complete positive cost-stress observations to enter the full frozen-holdout, DSR, PBO, placebo, FDR, neighborhood, regime, benchmark, and drawdown gate stack; this panel cannot mutate policy itself."
      : `Collecting future-only entry-distance evidence: ${panels.length}/${minimumProspectiveObservations} matured 20-session panels with a 25-observation frozen holdout reserved.`,
    policyMutationAllowed: false,
  };
}

function buildDecisionReview(input: {
  horizon: 1 | 5 | 10 | 20;
  base: PennyStockBar;
  path: PennyStockBar[];
  candidate: PennyStockResearchRow;
  selected: boolean;
  strategy: PennyStockResearchArtifact["method"]["baselineStrategy"];
  prospectiveEntryDiscountsPct: number[];
  riskUpdate?: PennyStockRiskUpdateSignal;
  closeReturnPct: number;
  maximumFavorableExcursionPct: number;
  maximumAdverseExcursionPct: number;
}): PennyPaperDecisionReview {
  const simulation = simulatePennyLimitPortfolio({
    barsBySymbol: {
      [input.candidate.symbol]: [input.base, ...input.path],
    },
    strategy: input.strategy,
    assumptions: {
      ...DEFAULT_PENNY_PAPER_ASSUMPTIONS,
      startingCashUsd: DEFAULT_PENNY_PAPER_ASSUMPTIONS.notionalUsdPerSymbol,
      maxConcurrentPositions: 1,
    },
  });
  const entry = simulation.trades.find((trade) => trade.side === "buy") ?? null;
  const exit = [...simulation.trades].reverse()
    .find((trade) => trade.side === "sell") ?? null;
  const rejectionBasis = input.selected
    ? "selected" as const
    : input.candidate.vetoed
      ? "issuer-veto" as const
      : input.candidate.conservativeEv
        && !input.candidate.conservativeEv.positive
        ? "non-positive-conservative-ev" as const
        : "basket-capacity-or-diversification" as const;
  const { status, assessment, logicErrorCandidate } = assessDecision({
    selected: input.selected,
    rejectionBasis,
    fills: simulation.fills,
    methodReturnPct: simulation.returnPct,
    closeReturnPct: input.closeReturnPct,
  });
  const marketContext = marketContextForPath({
    base: input.base,
    path: input.path,
    sourceMedianVolume: input.candidate.medianDailyVolume90,
    closeReturnPct: input.closeReturnPct,
    maximumFavorableExcursionPct: input.maximumFavorableExcursionPct,
    maximumAdverseExcursionPct: input.maximumAdverseExcursionPct,
  });
  const entryDistancePanel = [...new Set(input.prospectiveEntryDiscountsPct)]
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 80)
    .sort((left, right) => left - right)
    .map((entryDiscountPct) => {
      const results = ([1, 2, 3] as const).map((costStressMultiplier) =>
        simulatePennyLimitPortfolio({
          barsBySymbol: {
            [input.candidate.symbol]: [input.base, ...input.path],
          },
          strategy: { ...input.strategy, entryDiscountPct },
          assumptions: {
            ...DEFAULT_PENNY_PAPER_ASSUMPTIONS,
            startingCashUsd: DEFAULT_PENNY_PAPER_ASSUMPTIONS.notionalUsdPerSymbol,
            maxConcurrentPositions: 1,
            costStressMultiplier,
          },
        })
      );
      return {
        entryDiscountPct,
        activePolicy: entryDiscountPct === input.strategy.entryDiscountPct,
        fills: results[0].fills,
        returnPct: results[0].returnPct,
        maxDrawdownPct: results[0].maxDrawdownPct,
        costStressReturnPct: {
          "1": results[0].returnPct,
          "2": results[1].returnPct,
          "3": results[2].returnPct,
        },
      };
    });
  return {
    horizonSessions: input.horizon,
    status,
    assessment,
    logicErrorCandidate,
    sourceDecision: input.selected ? "selected" : "rejected",
    rejectionBasis,
    methodCounterfactual: {
      model: "standing-limit-daily-bar-pessimistic",
      fills: simulation.fills,
      closedTrades: simulation.closedTrades,
      returnPct: simulation.returnPct,
      maxDrawdownPct: simulation.maxDrawdownPct,
      entryDate: entry?.date ?? null,
      entryPriceUsd: entry?.priceUsd ?? null,
      exitDate: exit?.date ?? null,
      exitPriceUsd: exit?.priceUsd ?? null,
      exitReason: exit?.reason ?? null,
    },
    entryDistancePanel,
    marketContext,
    catalystHypotheses: catalystHypotheses({
      base: input.base,
      path: input.path,
      riskUpdate: input.riskUpdate,
      marketContext,
      sourceMedianVolume: input.candidate.medianDailyVolume90,
    }),
    causalClaimEstablished: false,
  };
}

function assessDecision(input: {
  selected: boolean;
  rejectionBasis: PennyPaperDecisionReview["rejectionBasis"];
  fills: number;
  methodReturnPct: number;
  closeReturnPct: number;
}): Pick<
  PennyPaperDecisionReview,
  "status" | "assessment" | "logicErrorCandidate"
> {
  const rawMove = `${input.closeReturnPct >= 0 ? "+" : ""}${input.closeReturnPct.toFixed(2)}%`;
  if (input.selected) {
    if (!input.fills) {
      return {
        status: "inconclusive",
        assessment:
          `Selected, but the standing limit did not fill; the ${rawMove} close move is not an executed-method result.`,
        logicErrorCandidate: false,
      };
    }
    if (input.methodReturnPct > 0) {
      return {
        status: "supported",
        assessment:
          `Selected and the pessimistic standing-limit counterfactual returned +${input.methodReturnPct.toFixed(2)}%.`,
        logicErrorCandidate: false,
      };
    }
    return {
      status: "challenged",
      assessment:
        `Selected, but the pessimistic standing-limit counterfactual returned ${input.methodReturnPct.toFixed(2)}%; review the selection logic after enough comparable outcomes mature.`,
      logicErrorCandidate: true,
    };
  }
  if (!input.fills) {
    return {
      status: "supported",
      assessment:
        `Rejected and the standing limit never filled; the ${rawMove} close move was not actionable under the tested method.`,
      logicErrorCandidate: false,
    };
  }
  if (input.methodReturnPct <= 0) {
    return {
      status: "supported",
      assessment:
        `Rejected and the pessimistic standing-limit counterfactual returned ${input.methodReturnPct.toFixed(2)}%, avoiding a non-positive method outcome.`,
      logicErrorCandidate: false,
    };
  }
  if (input.rejectionBasis === "issuer-veto") {
    return {
      status: "mixed",
      assessment:
        `Rejected on a hard issuer-risk veto even though the standing-limit counterfactual returned +${input.methodReturnPct.toFixed(2)}%; this is a missed outcome, not evidence that the risk veto was logically wrong.`,
      logicErrorCandidate: false,
    };
  }
  return {
    status: "challenged",
    assessment:
      `Rejected without a hard veto, but the standing-limit counterfactual returned +${input.methodReturnPct.toFixed(2)}%; this is a candidate false negative for cohort-level review.`,
    logicErrorCandidate: true,
  };
}

function marketContextForPath(input: {
  base: PennyStockBar;
  path: PennyStockBar[];
  sourceMedianVolume: number;
  closeReturnPct: number;
  maximumFavorableExcursionPct: number;
  maximumAdverseExcursionPct: number;
}) {
  const volumeBase = Math.max(1, input.sourceMedianVolume);
  let maximumVolumeMultiple = 0;
  let maximumAbsoluteOvernightGapPct = 0;
  let priorClose = input.base.close;
  for (const bar of input.path) {
    maximumVolumeMultiple = Math.max(maximumVolumeMultiple, bar.volume / volumeBase);
    maximumAbsoluteOvernightGapPct = Math.max(
      maximumAbsoluteOvernightGapPct,
      Math.abs(((bar.open - priorClose) / priorClose) * 100),
    );
    priorClose = bar.close;
  }
  return {
    maximumVolumeMultiple: round(maximumVolumeMultiple, 4),
    maximumAbsoluteOvernightGapPct: round(maximumAbsoluteOvernightGapPct, 4),
    materialMove:
      Math.abs(input.closeReturnPct) >= 10
      || input.maximumFavorableExcursionPct >= 15
      || input.maximumAdverseExcursionPct <= -15,
  };
}

function catalystHypotheses(input: {
  base: PennyStockBar;
  path: PennyStockBar[];
  riskUpdate?: PennyStockRiskUpdateSignal;
  marketContext: PennyPaperDecisionReview["marketContext"];
  sourceMedianVolume: number;
}): PennyPaperCatalystHypothesis[] {
  if (!input.marketContext.materialMove) return [];
  const observedThrough = input.path.at(-1)?.date ?? input.base.date;
  const hypotheses: PennyPaperCatalystHypothesis[] = [];
  for (const marker of (input.riskUpdate?.filingMarkers ?? [])
    .filter((row) => row.filedAt > input.base.date && row.filedAt <= observedThrough)
    .slice(0, 5)) {
    hypotheses.push({
      kind: "sec-filing",
      date: marker.filedAt,
      description:
        `${marker.form} filed during the outcome window; temporal overlap makes it a catalyst candidate, not a proven cause.`,
      evidenceClass: "confirmed-event",
      sourceUrl: marker.sourceUrl,
    });
  }
  for (const action of (input.riskUpdate?.corporateActions ?? [])
    .filter((row) => row.processDate > input.base.date && row.processDate <= observedThrough)
    .slice(0, 5)) {
    hypotheses.push({
      kind: "corporate-action",
      date: action.processDate,
      description:
        `${action.type} processed during the outcome window; the event is confirmed but causality is not.`,
      evidenceClass: "confirmed-event",
      sourceUrl: action.source,
    });
  }
  if (input.marketContext.maximumVolumeMultiple >= 3) {
    const volumeBase = Math.max(1, input.sourceMedianVolume);
    const bar = [...input.path].sort((left, right) =>
      right.volume / volumeBase - left.volume / volumeBase
    )[0];
    hypotheses.push({
      kind: "volume-shock",
      date: bar?.date ?? null,
      description:
        `Volume reached ${input.marketContext.maximumVolumeMultiple.toFixed(2)}x the source-run median, consistent with event-driven repricing but not identifying the event.`,
      evidenceClass: "market-pattern",
      sourceUrl: null,
    });
  }
  if (input.marketContext.maximumAbsoluteOvernightGapPct >= 10) {
    hypotheses.push({
      kind: "overnight-gap",
      date: null,
      description:
        `The largest absolute overnight gap was ${input.marketContext.maximumAbsoluteOvernightGapPct.toFixed(2)}%, consistent with new information arriving outside regular trading.`,
      evidenceClass: "market-pattern",
      sourceUrl: null,
    });
  }
  if (!hypotheses.length) {
    hypotheses.push({
      kind: "unexplained-material-move",
      date: null,
      description:
        "The price path was material, but the bounded SEC, corporate-action, volume, and gap evidence did not identify a defensible catalyst candidate.",
      evidenceClass: "missing",
      sourceUrl: null,
    });
  }
  return hypotheses;
}

function summarizeDecisionCalibration(
  outcomes: PennyPaperCandidateOutcome[],
): NonNullable<PennyPaperOutcomeLearning["decisionCalibration"]> {
  const latest = outcomes.flatMap((outcome) => {
    const review = latestDecisionReview(outcome);
    return review ? [review] : [];
  });
  const maturedHorizonReviews = Object.fromEntries(
    (["1", "5", "10", "20"] as const).map((horizon) => [
      horizon,
      outcomes.filter((outcome) => Boolean(outcome.decisionReviews?.[horizon])).length,
    ]),
  ) as Record<"1" | "5" | "10" | "20", number>;
  return {
    latestMaturedCandidateReviews: latest.length,
    maturedHorizonReviews,
    supported: latest.filter((row) => row.status === "supported").length,
    challenged: latest.filter((row) => row.status === "challenged").length,
    mixed: latest.filter((row) => row.status === "mixed").length,
    inconclusive: latest.filter((row) => row.status === "inconclusive").length,
    logicErrorCandidates: latest.filter((row) => row.logicErrorCandidate).length,
    materialMoverReviews: latest.filter((row) => row.marketContext.materialMove).length,
    catalystEvidenceReviews: latest.filter((row) =>
      row.catalystHypotheses.some((hypothesis) =>
        hypothesis.evidenceClass !== "missing"
      )
    ).length,
    policyMutationAllowed: false,
  };
}

function latestDecisionReview(outcome: PennyPaperCandidateOutcome) {
  for (const horizon of ["20", "10", "5", "1"] as const) {
    const review = outcome.decisionReviews?.[horizon];
    if (review) return review;
  }
  return null;
}

function deduplicateCatalysts(values: PennyPaperCatalystHypothesis[]) {
  return values.filter((value, index, rows) =>
    rows.findIndex((candidate) =>
      candidate.kind === value.kind
      && candidate.date === value.date
      && candidate.sourceUrl === value.sourceUrl
      && candidate.description === value.description
    ) === index
  );
}

function normalizedFeatures(
  candidate: PennyStockResearchArtifact["candidates"][number],
): PennyPaperSelectorWeights {
  return {
    liquidity: clamp(Math.log10(Math.max(1, candidate.averageDailyDollarVolume90)) / 8, 0, 1),
    marketCap: clamp(Math.log10(Math.max(1, candidate.marketCapUsd)) / 9, 0, 1),
    consistency: 1 - candidate.zeroVolumeDays90 / Math.max(1, candidate.bars90),
    conservativeEv: clamp(
      ((candidate.conservativeEv?.expectedValueLowPctPerOrder ?? candidate.score / 10) + 20) / 40,
      0,
      1,
    ),
    volumeTrend: clamp((candidate.volumeTrend20VsPriorPct + 50) / 150, 0, 1),
    drawdownSafety: 1 - clamp(candidate.maxDrawdown90Pct / 100, 0, 1),
    volatilityFitness: 1 - clamp(Math.abs(candidate.volatility90Pct - 8) / 20, 0, 1),
    executionQuality: clamp(
      (candidate.executionEvidence?.estimatedFillRatioPct ?? 25) / 100,
      0,
      1,
    ),
    secRiskPenalty: candidate.vetoed
      ? -1
      : -(candidate.filings.riskEvidence?.length ?? 0) / 10,
  };
}

function topBasketReturn(
  rows: Array<{
    returnPct: number;
    features: PennyPaperSelectorWeights;
  }>,
  weights: PennyPaperSelectorWeights,
) {
  const ranked = [...rows].sort((left, right) =>
    weightedScore(right.features, weights) - weightedScore(left.features, weights)
  );
  const basketSize = Math.max(3, Math.floor(ranked.length * 0.2));
  return mean(ranked.slice(0, basketSize).map((row) => row.returnPct));
}

function weightedScore(
  features: PennyPaperSelectorWeights,
  weights: PennyPaperSelectorWeights,
) {
  return (Object.keys(weights) as Array<keyof PennyPaperSelectorWeights>)
    .reduce((total, key) => total + features[key] * weights[key], 0);
}

function normalizeWeights(weights: PennyPaperSelectorWeights) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  for (const key of Object.keys(weights) as Array<keyof PennyPaperSelectorWeights>) {
    weights[key] = round(weights[key] / total, 8);
  }
}

function changedWeightCount(
  left: PennyPaperSelectorWeights,
  right: PennyPaperSelectorWeights,
) {
  return (Object.keys(left) as Array<keyof PennyPaperSelectorWeights>)
    .filter((key) => Math.abs(left[key] - right[key]) > 1e-9)
    .length;
}

function correlation(left: number[], right: number[]) {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (let index = 0; index < left.length; index += 1) {
    const x = left[index] - leftMean;
    const y = right[index] - rightMean;
    numerator += x * y;
    leftSquared += x * x;
    rightSquared += y * y;
  }
  const denominator = Math.sqrt(leftSquared * rightSquared);
  return denominator > 0 ? numerator / denominator : 0;
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
