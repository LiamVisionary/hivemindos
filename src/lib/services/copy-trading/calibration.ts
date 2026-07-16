import type { CopyTradeCounterfactual } from "@/lib/types/copy-trading";

export type CopyTradeCalibration = {
  rawConfidence: number;
  calibratedConfidence: number;
  closeThreshold: number;
  sampleSize: number;
};

/** Empirically calibrate Sol's confidence using only completed earlier batches.
 *  Excluding the current batch keeps each 50-trade validation window frozen. */
export function calibrateAgentDecision(input: {
  rawConfidence: number;
  baseThreshold: number;
  riskScore: number;
  securityCoverage: "complete" | "partial" | "unavailable";
  currentBatch: number;
  counterfactuals: CopyTradeCounterfactual[];
}): CopyTradeCalibration {
  const samples = input.counterfactuals.filter((record) => {
    if (record.evaluationBatch >= input.currentBatch || record.reviewPath === "risk-close") return false;
    if (record.decision === "uncertain") return false;
    const final = record.horizons["24h"];
    return final.holdReturnPct != null && final.closeReturnPct != null;
  });
  const correct = samples.filter((record) => {
    const final = record.horizons["24h"];
    return record.decision === "close"
      ? final.closeReturnPct! >= final.holdReturnPct!
      : final.holdReturnPct! >= final.closeReturnPct!;
  }).length;
  const rawConfidence = clamp(input.rawConfidence, 0, 1);
  // Beta(2,2) prior prevents tiny samples from producing extreme reliability.
  const empiricalReliability = (correct + 2) / (samples.length + 4);
  const empiricalWeight = samples.length / (samples.length + 20);
  const calibratedConfidence = rawConfidence * (1 - empiricalWeight) + empiricalReliability * empiricalWeight;

  const sparsePenalty = Math.max(0, 30 - samples.length) / 30 * 0.1;
  const missingEvidencePenalty = input.securityCoverage === "unavailable"
    ? 0.05
    : input.securityCoverage === "partial"
      ? 0.025
      : 0;
  const objectiveRiskAdjustment = Math.max(0, input.riskScore - 30) / 70 * 0.08;
  const closeThreshold = clamp(
    input.baseThreshold + sparsePenalty + missingEvidencePenalty - objectiveRiskAdjustment,
    0.6,
    0.9,
  );
  return {
    rawConfidence,
    calibratedConfidence: round(calibratedConfidence, 4),
    closeThreshold: round(closeThreshold, 4),
    sampleSize: samples.length,
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
