import type {
  CopyTradeCounterfactual,
  CopyTradeRetrospective,
  CopyTradeRetrospectiveHorizon,
  CopyTradeRetrospectiveOutcome,
} from "@/lib/types/copy-trading";

const MATERIAL_RETURN_PCT = 5;
const MATERIAL_EDGE_PCT = 2;

export type CopyTradeLearningNote = CopyTradeRetrospective & {
  token: string;
  symbol: string;
  evaluationBatch: number;
  targetTxRef: string;
};

export type CopyTradeLearningSummary = {
  total: number;
  avoidedLosses: number;
  missedUpside: number;
  profitableHolds: number;
  lossesHeld: number;
  flat: number;
  topCauses: Array<{ tag: string; count: number; meanDeltaPct: number }>;
  latest: CopyTradeLearningNote[];
  promptLessons: string[];
};

/** Add or replace one deterministic note for a matured evaluation horizon. */
export function recordCounterfactualRetrospective(
  record: CopyTradeCounterfactual,
  horizon: CopyTradeRetrospectiveHorizon,
  observedAt: number,
  outcome: {
    holdReturnPct: number;
    evolvedReturnPct: number;
    pairedDeltaPct: number;
  },
): CopyTradeRetrospective {
  const classification = classifyOutcome(record.closeExecuted, outcome.holdReturnPct, outcome.pairedDeltaPct);
  const causeTags = retrospectiveCauseTags(record, classification);
  const note: CopyTradeRetrospective = {
    createdAt: observedAt,
    horizon,
    outcome: classification,
    holdReturnPct: round(outcome.holdReturnPct, 4),
    evolvedReturnPct: round(outcome.evolvedReturnPct, 4),
    pairedDeltaPct: round(outcome.pairedDeltaPct, 4),
    causeTags,
    summary: retrospectiveSummary(record, horizon, classification, outcome),
    lesson: retrospectiveLesson(classification, causeTags),
  };
  record.retrospectives ??= [];
  const existing = record.retrospectives.findIndex((candidate) => candidate.horizon === horizon);
  if (existing >= 0) record.retrospectives[existing] = note;
  else record.retrospectives.push(note);
  return note;
}

/** Migrates pre-retrospective state without rewriting or resetting trade history. */
export function backfillCounterfactualRetrospectives(record: CopyTradeCounterfactual): number {
  let added = 0;
  const final = record.horizons?.["24h"];
  if (
    final?.observedAt != null
    && final.holdReturnPct != null
    && final.evolvedReturnPct != null
    && final.pairedDeltaPct != null
  ) {
    const existed = record.retrospectives?.some((note) => note.horizon === "24h") ?? false;
    recordCounterfactualRetrospective(record, "24h", final.observedAt, {
      holdReturnPct: final.holdReturnPct,
      evolvedReturnPct: final.evolvedReturnPct,
      pairedDeltaPct: final.pairedDeltaPct,
    });
    if (!existed) added += 1;
  }
  const targetExit = record.targetExit;
  if (targetExit) {
    const existed = record.retrospectives?.some((note) => note.horizon === "target-exit") ?? false;
    recordCounterfactualRetrospective(record, "target-exit", targetExit.observedAt, targetExit);
    if (!existed) added += 1;
  }
  return added;
}

/** Summaries supplied to a decision batch must come only from earlier batches. */
export function summarizeCounterfactualLearning(
  records: CopyTradeCounterfactual[],
  beforeBatch = Number.POSITIVE_INFINITY,
): CopyTradeLearningSummary {
  const notes: CopyTradeLearningNote[] = records
    .filter((record) => record.evaluationBatch < beforeBatch)
    .flatMap((record) => (record.retrospectives ?? []).map((note) => ({
      ...note,
      token: record.token,
      symbol: record.symbol,
      evaluationBatch: record.evaluationBatch,
      targetTxRef: record.targetTxRef,
    })))
    .sort((left, right) => right.createdAt - left.createdAt);
  const causes = new Map<string, { count: number; delta: number }>();
  for (const note of notes) {
    for (const tag of note.causeTags) {
      const current = causes.get(tag) ?? { count: 0, delta: 0 };
      current.count += 1;
      current.delta += note.pairedDeltaPct;
      causes.set(tag, current);
    }
  }
  const topCauses = [...causes.entries()]
    .map(([tag, value]) => ({ tag, count: value.count, meanDeltaPct: round(value.delta / value.count, 2) }))
    .sort((left, right) => right.count - left.count || Math.abs(right.meanDeltaPct) - Math.abs(left.meanDeltaPct))
    .slice(0, 8);
  const summary: CopyTradeLearningSummary = {
    total: notes.length,
    avoidedLosses: countOutcome(notes, "avoided-loss"),
    missedUpside: countOutcome(notes, "missed-upside"),
    profitableHolds: countOutcome(notes, "profitable-hold"),
    lossesHeld: countOutcome(notes, "loss-held"),
    flat: countOutcome(notes, "flat"),
    topCauses,
    latest: notes.slice(0, 8),
    promptLessons: [],
  };
  summary.promptLessons = buildPromptLessons(summary);
  return summary;
}

function classifyOutcome(
  closeExecuted: boolean,
  holdReturnPct: number,
  pairedDeltaPct: number,
): CopyTradeRetrospectiveOutcome {
  if (closeExecuted && pairedDeltaPct >= MATERIAL_EDGE_PCT) return "avoided-loss";
  if (closeExecuted && pairedDeltaPct <= -MATERIAL_EDGE_PCT) return "missed-upside";
  if (!closeExecuted && holdReturnPct >= MATERIAL_RETURN_PCT) return "profitable-hold";
  if (!closeExecuted && holdReturnPct <= -MATERIAL_RETURN_PCT) return "loss-held";
  return "flat";
}

function retrospectiveCauseTags(
  record: CopyTradeCounterfactual,
  outcome: CopyTradeRetrospectiveOutcome,
): string[] {
  const tags = new Set<string>([outcome]);
  if (record.reviewPath === "risk-close") tags.add("objective-risk-close");
  if (record.reviewPath === "sol-failed-open") tags.add("analysis-failed-open");
  if (record.reviewPath === "sol-adjudication") tags.add("model-adjudication");
  const context = record.entryContext;
  if (!context) tags.add("legacy-context-missing");
  if (context?.securityCoverage !== "complete") tags.add("security-evidence-incomplete");
  if (context?.liquidityUsd != null && context.liquidityUsd < 10_000) tags.add("low-liquidity");
  if (context?.priceChange24hPct != null && context.priceChange24hPct <= -10) tags.add("negative-entry-momentum");
  if (context?.priceChange24hPct != null && context.priceChange24hPct >= 10) tags.add("positive-entry-momentum");
  if ((context?.riskScore ?? 0) >= 60) tags.add("high-risk-score");
  for (const flag of context?.riskFlags ?? []) tags.add(`risk:${flag}`);
  const review = context?.reviewSummary?.toLowerCase() ?? "";
  if (/unverified|unofficial|permissionless|no demonstrated endorsement|no official/.test(review)) tags.add("unverified-affiliation");
  if (/exceptionally thin|extremely small|critically thin|low trading activity|minimal activity|exit quality fragile/.test(review)) tags.add("thin-market-evidence");
  if (/suffered a material[^.]*exploit|verification-bypass exploit|unbacked[^.]*minted|integrity failure/.test(review)) tags.add("exploit-or-integrity-history");
  if (/holder concentration (?:prevent|remain|is)|reported [\d.]+% concentration|dump capacity|promoter[^.]*allocation/.test(review)) tags.add("concentration-or-overhang");
  if (/deteriorat|falling|price expansion|sharp price|market-structure/.test(review)) tags.add("momentum-or-market-structure");
  return [...tags].slice(0, 12);
}

function retrospectiveSummary(
  record: CopyTradeCounterfactual,
  horizon: CopyTradeRetrospectiveHorizon,
  outcome: CopyTradeRetrospectiveOutcome,
  values: { holdReturnPct: number; evolvedReturnPct: number; pairedDeltaPct: number },
): string {
  const horizonLabel = horizon === "target-exit" ? "when the target exited" : "after 24 hours";
  const action = record.closeExecuted ? "closed" : "kept";
  return `${record.symbol} was ${action}; ${horizonLabel}, holding returned ${signed(values.holdReturnPct)} and the evolved path returned ${signed(values.evolvedReturnPct)} (${signed(values.pairedDeltaPct)} edge). Outcome: ${outcome}.`;
}

function retrospectiveLesson(outcome: CopyTradeRetrospectiveOutcome, causeTags: string[]): string {
  const context = causeTags.filter((tag) => !tag.endsWith("hold") && tag !== outcome).slice(0, 4).join(", ") || "the recorded entry evidence";
  if (outcome === "avoided-loss") return `The close helped. In later frozen batches, look for repeated evidence matching ${context}; one trade is not enough to change policy.`;
  if (outcome === "missed-upside") return `The close hurt. Later batches should demand concrete sellability or integrity evidence before repeating a close based on ${context}.`;
  if (outcome === "loss-held") return `The kept position lost materially. Later batches should test whether ${context} predicts downside before changing the threshold.`;
  if (outcome === "profitable-hold") return `Holding worked. Preserve patience when later entries resemble ${context}, unless stronger current evidence contradicts it.`;
  return "The difference was immaterial; do not tune policy from this observation.";
}

function buildPromptLessons(summary: CopyTradeLearningSummary): string[] {
  if (!summary.total) return [];
  const lessons = [
    `${summary.total} prior-batch notes: ${summary.avoidedLosses} avoided losses, ${summary.missedUpside} missed upside, ${summary.profitableHolds} profitable holds, ${summary.lossesHeld} losses held, ${summary.flat} flat.`,
  ];
  for (const cause of summary.topCauses.slice(0, 5)) {
    lessons.push(`${cause.tag}: ${cause.count} notes, mean evolved edge ${signed(cause.meanDeltaPct)}.`);
  }
  return lessons;
}

function countOutcome(notes: CopyTradeLearningNote[], outcome: CopyTradeRetrospectiveOutcome): number {
  return notes.filter((note) => note.outcome === outcome).length;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${round(value, 2).toFixed(2)}%`;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
