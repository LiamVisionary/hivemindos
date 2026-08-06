import {
  COPY_TRADE_EVALUATION_BATCH_SIZE,
  type CopyTradeAgentReviewDecision,
  type CopyTradeCounterfactual,
  type CopyTradeCounterfactualHorizon,
  type CopyTradeExecutionCost,
} from "@/lib/types/copy-trading";
import { executionCostUsd } from "./execution-costs";
import { recordCounterfactualRetrospective } from "./retrospective";

export const COPY_TRADE_COUNTERFACTUAL_HORIZONS_MS: Record<CopyTradeCounterfactualHorizon, number> = {
  "5m": 5 * 60_000,
  "30m": 30 * 60_000,
  "4h": 4 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

const COPY_TRADE_COUNTERFACTUAL_TOLERANCE_MS: Record<CopyTradeCounterfactualHorizon, number> = {
  "5m": 3 * 60_000,
  "30m": 10 * 60_000,
  "4h": 60 * 60_000,
  "24h": 4 * 60 * 60_000,
};

export function createCounterfactualRecord(input: {
  sequence: number;
  policyVersion: CopyTradeCounterfactual["policyVersion"];
  targetTxRef: string;
  token: string;
  symbol: string;
  entryAt: number;
  entryPriceUsd: number;
  spentUsd: number;
  acquiredAmount?: number;
  decision: CopyTradeAgentReviewDecision;
  reviewPath?: CopyTradeCounterfactual["reviewPath"];
  confidence: number;
  calibratedConfidence: number;
  closeThreshold: number;
  closePriceUsd?: number;
  closeAt?: number;
  closeExecuted: boolean;
  entryContext?: CopyTradeCounterfactual["entryContext"];
  buyCost: CopyTradeExecutionCost;
  sellCost: CopyTradeExecutionCost;
}): CopyTradeCounterfactual {
  const horizons = Object.fromEntries(
    Object.entries(COPY_TRADE_COUNTERFACTUAL_HORIZONS_MS).map(([horizon, durationMs]) => [
      horizon,
      { dueAt: input.entryAt + durationMs },
    ]),
  ) as CopyTradeCounterfactual["horizons"];
  return {
    ...input,
    evaluationBatch: Math.floor(input.sequence / COPY_TRADE_EVALUATION_BATCH_SIZE),
    horizons,
  };
}

export function observeCounterfactualHorizon(
  record: CopyTradeCounterfactual,
  horizon: CopyTradeCounterfactualHorizon,
  priceUsd: number,
  observedAt: number,
): NonNullable<CopyTradeCounterfactual["horizons"]>[CopyTradeCounterfactualHorizon] {
  const observation = record.horizons[horizon];
  if (!(priceUsd > 0) || !Number.isFinite(priceUsd)) return observation;
  const holdReturnPct = pathReturnPct(record, priceUsd);
  const closeReturnPct = pathReturnPct(record, record.closePriceUsd ?? record.entryPriceUsd);
  const evolvedReturnPct = record.closeExecuted ? closeReturnPct : holdReturnPct;
  const pairedDeltaPct = evolvedReturnPct - holdReturnPct;
  Object.assign(observation, {
    observedAt,
    priceUsd,
    holdReturnPct,
    closeReturnPct,
    evolvedReturnPct,
    pairedDeltaPct,
  });
  if (horizon === "24h") {
    recordCounterfactualRetrospective(record, "24h", observedAt, {
      holdReturnPct,
      evolvedReturnPct,
      pairedDeltaPct,
    });
  }
  return observation;
}

/** Record the target wallet's eventual exit as an additional, variable-horizon
 *  benchmark even when the evolved position was already closed. */
export function observeCounterfactualTargetExit(
  record: CopyTradeCounterfactual,
  targetTxRef: string,
  priceUsd: number,
  observedAt: number,
) {
  if (!(priceUsd > 0) || !Number.isFinite(priceUsd) || record.targetExit) return record.targetExit;
  const holdReturnPct = pathReturnPct(record, priceUsd);
  const closeReturnPct = pathReturnPct(record, record.closePriceUsd ?? record.entryPriceUsd);
  const evolvedReturnPct = record.closeExecuted ? closeReturnPct : holdReturnPct;
  const pairedDeltaPct = evolvedReturnPct - holdReturnPct;
  record.targetExit = {
    targetTxRef,
    observedAt,
    priceUsd,
    holdReturnPct,
    closeReturnPct,
    evolvedReturnPct,
    pairedDeltaPct,
  };
  recordCounterfactualRetrospective(record, "target-exit", observedAt, record.targetExit);
  return record.targetExit;
}

/** A close acts on the whole paper position. Mark every still-open copied lot so
 *  the sum of per-lot evaluations matches the position-level action. */
export function markCounterfactualLotsClosed(
  records: CopyTradeCounterfactual[],
  input: { token: string; decisionTargetTxRef: string; priceUsd: number; closedAt: number },
): number {
  let closed = 0;
  for (const record of records) {
    if (record.token !== input.token || record.closeExecuted || record.targetExit) continue;
    record.closeExecuted = true;
    record.closePriceUsd = input.priceUsd;
    record.closeAt = input.closedAt;
    record.closeDecisionTargetTxRef = input.decisionTargetTxRef;
    closed += 1;
  }
  return closed;
}

export function dueCounterfactualHorizons(
  record: CopyTradeCounterfactual,
  now: number,
): CopyTradeCounterfactualHorizon[] {
  return (Object.keys(COPY_TRADE_COUNTERFACTUAL_HORIZONS_MS) as CopyTradeCounterfactualHorizon[])
    .filter((horizon) => {
      const observation = record.horizons[horizon];
      return observation.observedAt == null
        && observation.missedAt == null
        && observation.dueAt <= now
        && now <= observation.dueAt + COPY_TRADE_COUNTERFACTUAL_TOLERANCE_MS[horizon];
    });
}

/** Mark horizons whose valid observation window elapsed while the daemon was unavailable. */
export function markMissedCounterfactualHorizons(
  record: CopyTradeCounterfactual,
  now: number,
): CopyTradeCounterfactualHorizon[] {
  const missed = (Object.keys(COPY_TRADE_COUNTERFACTUAL_HORIZONS_MS) as CopyTradeCounterfactualHorizon[])
    .filter((horizon) => {
      const observation = record.horizons[horizon];
      return observation.observedAt == null
        && observation.missedAt == null
        && now > observation.dueAt + COPY_TRADE_COUNTERFACTUAL_TOLERANCE_MS[horizon];
    });
  for (const horizon of missed) {
    record.horizons[horizon].missedAt = now;
    record.horizons[horizon].missedReason = "observation-window-expired";
  }
  return missed;
}

function pathReturnPct(record: CopyTradeCounterfactual, exitPriceUsd: number): number {
  if (!(record.spentUsd > 0) || !(record.entryPriceUsd > 0) || !(exitPriceUsd > 0)) return 0;
  const buyCostUsd = Math.min(record.spentUsd, executionCostUsd(record.spentUsd, record.buyCost));
  const acquiredAmount = record.acquiredAmount ?? Math.max(0, record.spentUsd - buyCostUsd) / record.entryPriceUsd;
  const grossProceedsUsd = acquiredAmount * exitPriceUsd;
  const sellCostUsd = Math.min(grossProceedsUsd, executionCostUsd(grossProceedsUsd, record.sellCost));
  const proceedsUsd = grossProceedsUsd - sellCostUsd;
  return ((proceedsUsd - record.spentUsd) / record.spentUsd) * 100;
}
