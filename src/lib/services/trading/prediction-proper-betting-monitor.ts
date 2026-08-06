/**
 * Closed-only monitoring and descriptive performance for prospective
 * proper-betting paper cohorts. This module has no venue mutation path.
 */

import type { PredictionMarket } from "./prediction-markets";
import type {
  PredictionProperBettingPosition,
  PredictionProperBettingRun,
} from "./prediction-proper-betting-paper";

export type PredictionProperBettingObservedOutcome = {
  type?: "prediction-proper-betting-outcome";
  marketId: string;
  outcome: "yes" | "no";
  observedAt: string;
  sourceStatus?: "closed";
  sourcePrices?: { yes: number; no: number };
};

export type PredictionProperBettingForecastEvaluation = {
  runId: string;
  marketId: string;
  eventKey: string;
  forecastYesProbability: number;
  marketYesMidpoint: number;
};

type GroupRate = {
  closed: number;
  wins: number;
  losses: number;
  breakEven: number;
  winRate: number | null;
};

type ArmScore = {
  closedPositions: number;
  openPositions: number;
  openCapitalUsd: number;
  wins: number;
  losses: number;
  breakEven: number;
  rawPositionWinRate: number | null;
  uniqueMarkets: GroupRate;
  eventClusters: GroupRate;
  deployedCapitalUsd: number;
  payoutUsd: number;
  pnlUsd: number;
  returnOnDeployedCapital: number | null;
  closedCohortCapitalUsd: number;
  returnOnClosedCohortCapital: number | null;
  maxDrawdownUsd: number;
  maxDrawdownFraction: number | null;
  largestEventAbsolutePnlShare: number | null;
};

export type PredictionProperBettingScorecard = {
  type: "prediction-proper-betting-scorecard";
  observedAt: string;
  cohorts: {
    total: number;
    withClosedPositions: number;
    withOpenPositions: number;
  };
  outcomes: {
    resolvedMarkets: number;
  };
  eventClustering: {
    aliasesApplied: number;
  };
  forecasts: {
    settled: number;
    forecasterBrierScore: number | null;
    marketBrierScore: number | null;
    brierImprovement: number | null;
  };
  arms: {
    "brier-treatment": ArmScore;
    "equal-notional-control": ArmScore;
    cash: ArmScore;
  };
  treatmentVsControl: {
    pnlDifferenceUsd: number;
    returnOnDeployedCapitalDifference: number | null;
  };
  edgeEvidence: {
    status: "insufficient-data";
    descriptiveDirection: "positive" | "negative" | "mixed" | "waiting";
    note: string;
  };
  readiness: {
    ready: false;
    reasons: string[];
  };
  claimLimit: string;
};

type ClosedPosition = {
  position: PredictionProperBettingPosition;
  pnlUsd: number;
  payoutUsd: number;
  fillObservedAt: string;
  cohortId: string;
};

function round(value: number, places = 6): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function rate(wins: number, losses: number): number | null {
  return wins + losses > 0 ? wins / (wins + losses) : null;
}

function groupRate(rows: ClosedPosition[], key: (row: ClosedPosition) => string): GroupRate {
  const grouped = new Map<string, number>();
  for (const row of rows) grouped.set(key(row), (grouped.get(key(row)) ?? 0) + row.pnlUsd);
  const values = [...grouped.values()];
  const wins = values.filter((value) => value > 1e-9).length;
  const losses = values.filter((value) => value < -1e-9).length;
  const breakEven = values.length - wins - losses;
  return {
    closed: values.length,
    wins,
    losses,
    breakEven,
    winRate: rate(wins, losses),
  };
}

function canonicalEventKey(eventKey: string, aliases: Record<string, string>): string {
  let current = eventKey;
  const seen = new Set<string>();
  while (aliases[current] && !seen.has(current)) {
    seen.add(current);
    current = aliases[current];
  }
  return current;
}

function emptyArm(): ArmScore {
  return {
    closedPositions: 0,
    openPositions: 0,
    openCapitalUsd: 0,
    wins: 0,
    losses: 0,
    breakEven: 0,
    rawPositionWinRate: null,
    uniqueMarkets: { closed: 0, wins: 0, losses: 0, breakEven: 0, winRate: null },
    eventClusters: { closed: 0, wins: 0, losses: 0, breakEven: 0, winRate: null },
    deployedCapitalUsd: 0,
    payoutUsd: 0,
    pnlUsd: 0,
    returnOnDeployedCapital: null,
    closedCohortCapitalUsd: 0,
    returnOnClosedCohortCapital: null,
    maxDrawdownUsd: 0,
    maxDrawdownFraction: null,
    largestEventAbsolutePnlShare: null,
  };
}

function armScore(
  runs: PredictionProperBettingRun[],
  outcomeByMarket: Map<string, PredictionProperBettingObservedOutcome>,
  arm: PredictionProperBettingPosition["arm"],
  eventClusterAliases: Record<string, string>,
): ArmScore {
  const armPositions = runs.flatMap((run) => run.positions
    .filter((position) => position.arm === arm)
    .map((position) => ({ run, position })));
  const closedRows = armPositions.flatMap(({ run, position }) => {
    const outcome = outcomeByMarket.get(position.marketId)?.outcome;
    if (!outcome) return [];
    const payoutUsd = position.side === outcome ? position.shares : 0;
    return [{
      position,
      payoutUsd,
      pnlUsd: payoutUsd - position.capitalUsd,
      fillObservedAt: run.fillObservedAt,
      cohortId: run.cohortId,
    }];
  });
  const wins = closedRows.filter((row) => row.pnlUsd > 1e-9).length;
  const losses = closedRows.filter((row) => row.pnlUsd < -1e-9).length;
  const breakEven = closedRows.length - wins - losses;
  const deployedCapitalUsd = closedRows.reduce((sum, row) => sum + row.position.capitalUsd, 0);
  const payoutUsd = closedRows.reduce((sum, row) => sum + row.payoutUsd, 0);
  const pnlUsd = closedRows.reduce((sum, row) => sum + row.pnlUsd, 0);
  const closedRunIds = new Set(closedRows.map((row) => row.cohortId));
  const closedCohortCapitalUsd = [...new Map(runs
    .filter((run) => closedRunIds.has(run.cohortId))
    .map((run) => [run.cohortId, run.policy.startingCapitalUsd])).values()]
    .reduce((sum, capital) => sum + capital, 0);
  const openCapitalUsd = armPositions
    .filter(({ position }) => !outcomeByMarket.has(position.marketId))
    .reduce((sum, { position }) => sum + position.capitalUsd, 0);

  const chronological = [...closedRows].sort((left, right) => (
    left.fillObservedAt.localeCompare(right.fillObservedAt)
    || left.position.marketId.localeCompare(right.position.marketId)
  ));
  let equity = 0;
  let peak = 0;
  let maxDrawdownUsd = 0;
  for (const row of chronological) {
    equity += row.pnlUsd;
    peak = Math.max(peak, equity);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peak - equity);
  }

  const eventPnl = new Map<string, number>();
  for (const row of closedRows) {
    const eventKey = canonicalEventKey(row.position.eventKey, eventClusterAliases);
    eventPnl.set(eventKey, (eventPnl.get(eventKey) ?? 0) + row.pnlUsd);
  }
  const absoluteEventPnl = [...eventPnl.values()].map(Math.abs);
  const totalAbsoluteEventPnl = absoluteEventPnl.reduce((sum, value) => sum + value, 0);

  return {
    closedPositions: closedRows.length,
    openPositions: armPositions.length - closedRows.length,
    openCapitalUsd: round(openCapitalUsd),
    wins,
    losses,
    breakEven,
    rawPositionWinRate: rate(wins, losses),
    uniqueMarkets: groupRate(closedRows, (row) => row.position.marketId),
    eventClusters: groupRate(
      closedRows,
      (row) => canonicalEventKey(row.position.eventKey, eventClusterAliases),
    ),
    deployedCapitalUsd: round(deployedCapitalUsd),
    payoutUsd: round(payoutUsd),
    pnlUsd: round(pnlUsd),
    returnOnDeployedCapital: deployedCapitalUsd > 0 ? round(pnlUsd / deployedCapitalUsd) : null,
    closedCohortCapitalUsd: round(closedCohortCapitalUsd),
    returnOnClosedCohortCapital: closedCohortCapitalUsd > 0 ? round(pnlUsd / closedCohortCapitalUsd) : null,
    maxDrawdownUsd: round(maxDrawdownUsd),
    maxDrawdownFraction: closedCohortCapitalUsd > 0 ? round(maxDrawdownUsd / closedCohortCapitalUsd) : null,
    largestEventAbsolutePnlShare: totalAbsoluteEventPnl > 0
      ? round(Math.max(...absoluteEventPnl) / totalAbsoluteEventPnl)
      : null,
  };
}

function cashScore(runs: PredictionProperBettingRun[]): ArmScore {
  const score = emptyArm();
  score.closedCohortCapitalUsd = round(
    [...new Map(runs.map((run) => [run.cohortId, run.policy.startingCapitalUsd])).values()]
      .reduce((sum, capital) => sum + capital, 0),
  );
  score.returnOnClosedCohortCapital = 0;
  score.returnOnDeployedCapital = 0;
  score.maxDrawdownFraction = 0;
  return score;
}

function outcomeByLabel(market: Pick<PredictionMarket, "outcomes">, label: "yes" | "no") {
  return market.outcomes.find((outcome) => outcome.label.trim().toLowerCase() === label);
}

export function deriveResolvedPredictionOutcome(
  market: Pick<PredictionMarket, "id" | "status" | "outcomes">,
  observedAt: string,
): PredictionProperBettingObservedOutcome | null {
  if (market.status !== "closed") return null;
  const yes = outcomeByLabel(market, "yes");
  const no = outcomeByLabel(market, "no");
  if (!yes || !no) return null;
  const outcome = yes.price >= 0.99 && no.price <= 0.01
    ? "yes"
    : no.price >= 0.99 && yes.price <= 0.01
      ? "no"
      : null;
  if (!outcome) return null;
  const parsed = Date.parse(observedAt);
  if (!Number.isFinite(parsed)) throw new Error("Outcome observedAt must be a valid timestamp.");
  return {
    type: "prediction-proper-betting-outcome",
    marketId: market.id,
    outcome,
    observedAt: new Date(parsed).toISOString(),
    sourceStatus: "closed",
    sourcePrices: { yes: yes.price, no: no.price },
  };
}

export function buildProperBettingScorecard(input: {
  runs: PredictionProperBettingRun[];
  outcomes: PredictionProperBettingObservedOutcome[];
  forecastEvaluations: PredictionProperBettingForecastEvaluation[];
  observedAt: string;
  eventClusterAliases?: Record<string, string>;
}): PredictionProperBettingScorecard {
  const observedAtMs = Date.parse(input.observedAt);
  if (!Number.isFinite(observedAtMs)) throw new Error("Scorecard observedAt must be a valid timestamp.");
  if (input.runs.some((run) => !run.researchOnly || run.ordersSubmitted !== 0)) {
    throw new Error("The monitor accepts research-only, zero-order paper runs.");
  }
  const eventClusterAliases = input.eventClusterAliases ?? {};
  const outcomeByMarket = new Map(input.outcomes.map((outcome) => [outcome.marketId, outcome]));
  const treatment = armScore(input.runs, outcomeByMarket, "brier-treatment", eventClusterAliases);
  const control = armScore(input.runs, outcomeByMarket, "equal-notional-control", eventClusterAliases);
  const evaluationRows = input.forecastEvaluations.flatMap((evaluation) => {
    const outcome = outcomeByMarket.get(evaluation.marketId)?.outcome;
    if (!outcome) return [];
    const observed = outcome === "yes" ? 1 : 0;
    return [{
      forecaster: (evaluation.forecastYesProbability - observed) ** 2,
      market: (evaluation.marketYesMidpoint - observed) ** 2,
    }];
  });
  const mean = (values: number[]) => values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
  const forecasterBrier = mean(evaluationRows.map((row) => row.forecaster));
  const marketBrier = mean(evaluationRows.map((row) => row.market));
  const returnDifference = treatment.returnOnDeployedCapital != null
    && control.returnOnDeployedCapital != null
    ? round(treatment.returnOnDeployedCapital - control.returnOnDeployedCapital)
    : null;
  const brierImprovement = forecasterBrier != null && marketBrier != null
    ? round(marketBrier - forecasterBrier)
    : null;
  const settledCohorts = new Set(input.forecastEvaluations
    .filter((evaluation) => outcomeByMarket.has(evaluation.marketId))
    .map((evaluation) => input.runs.find((run) => run.runId === evaluation.runId)?.cohortId)
    .filter((cohortId): cohortId is string => Boolean(cohortId)));
  const minimumSettled = Math.max(252, ...input.runs.map((run) => run.policy.minimumSettledMarkets));
  const minimumCohorts = Math.max(4, ...input.runs.map((run) => run.policy.minimumForwardCohorts));
  const reasons = [
    `${minimumSettled} settled forecasts are required; the scorecard has ${evaluationRows.length}.`,
    `${minimumCohorts} non-overlapping forward cohorts are required; the scorecard has ${settledCohorts.size}.`,
    "HAC inference, bootstrap, placebo, FDR, PBO, deflated-Sharpe, regime, and concentration gates have not passed.",
  ];
  const descriptiveDirection = treatment.closedPositions === 0
    ? "waiting"
    : treatment.pnlUsd > 0 && treatment.pnlUsd > control.pnlUsd && (brierImprovement ?? 0) > 0
      ? "positive"
      : treatment.pnlUsd < 0 && (brierImprovement ?? 0) < 0
        ? "negative"
        : "mixed";

  return {
    type: "prediction-proper-betting-scorecard",
    observedAt: new Date(observedAtMs).toISOString(),
    cohorts: {
      total: new Set(input.runs.map((run) => run.cohortId)).size,
      withClosedPositions: new Set(input.runs
        .filter((run) => run.positions.some((position) => outcomeByMarket.has(position.marketId)))
        .map((run) => run.cohortId)).size,
      withOpenPositions: new Set(input.runs
        .filter((run) => run.positions.some((position) => !outcomeByMarket.has(position.marketId)))
        .map((run) => run.cohortId)).size,
    },
    outcomes: { resolvedMarkets: outcomeByMarket.size },
    eventClustering: { aliasesApplied: Object.keys(eventClusterAliases).length },
    forecasts: {
      settled: evaluationRows.length,
      forecasterBrierScore: forecasterBrier == null ? null : round(forecasterBrier),
      marketBrierScore: marketBrier == null ? null : round(marketBrier),
      brierImprovement,
    },
    arms: {
      "brier-treatment": treatment,
      "equal-notional-control": control,
      cash: cashScore(input.runs),
    },
    treatmentVsControl: {
      pnlDifferenceUsd: round(treatment.pnlUsd - control.pnlUsd),
      returnOnDeployedCapitalDifference: returnDifference,
    },
    edgeEvidence: {
      status: "insufficient-data",
      descriptiveDirection,
      note: "Win rates and returns are descriptive only until every preregistered promotion gate passes.",
    },
    readiness: { ready: false, reasons },
    claimLimit: "Closed-only descriptive paper results cannot establish a persistent edge, constant profit, or future profit.",
  };
}
