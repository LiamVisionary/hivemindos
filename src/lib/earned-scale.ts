export const EARNED_SCALE_POLICY_VERSION = "earned-scale-v1" as const;
export const EARNED_SCALE_MIN_RUNS = 3;

export type EarnedScaleRecommendation = "scale" | "hold" | "reduce" | "collect-evidence";
export type EarnedScaleDimensionKey =
  | "outcome"
  | "proof"
  | "latency"
  | "tokens"
  | "uniqueContribution"
  | "duplicationConflict"
  | "humanIntervention"
  | "reviewerDisagreement";

export type EarnedScaleObservation = {
  id: string;
  settledTasks: number;
  completedTasks: number;
  outcomeScore?: number;
  proofRate?: number;
  latencyMs?: number;
  totalTokens?: number;
  uniqueContributionRate?: number;
  duplicationConflictRate?: number;
  humanInterventionRate?: number;
  reviewerDisagreementRate?: number;
};

export type EarnedScaleDimension = {
  key: EarnedScaleDimensionKey;
  label: string;
  baseline?: number;
  treatment?: number;
  delta?: number;
  direction: "increase" | "decrease";
  weight: number;
  status: "improved" | "steady" | "regressed" | "missing";
};

export type EarnedScaleDecision = {
  policyVersion: typeof EARNED_SCALE_POLICY_VERSION;
  recommendation: EarnedScaleRecommendation;
  confidence: "insufficient" | "directional" | "comparative";
  score: number;
  baselineRuns: number;
  treatmentRuns: number;
  baselineCompletionRate?: number;
  treatmentCompletionRate?: number;
  dimensions: EarnedScaleDimension[];
  reasons: string[];
  evidenceGaps: string[];
  automaticAction: false;
};

type DimensionSpec = {
  key: EarnedScaleDimensionKey;
  label: string;
  field: keyof EarnedScaleObservation;
  direction: EarnedScaleDimension["direction"];
  weight: number;
  relative?: boolean;
};

const DIMENSIONS: readonly DimensionSpec[] = [
  { key: "outcome", label: "Outcome / rubric", field: "outcomeScore", direction: "increase", weight: 0.3 },
  { key: "proof", label: "Proof satisfied", field: "proofRate", direction: "increase", weight: 0.2 },
  { key: "latency", label: "Latency", field: "latencyMs", direction: "decrease", weight: 0.06, relative: true },
  { key: "tokens", label: "Tokens", field: "totalTokens", direction: "decrease", weight: 0.06, relative: true },
  { key: "uniqueContribution", label: "Unique contribution", field: "uniqueContributionRate", direction: "increase", weight: 0.12 },
  { key: "duplicationConflict", label: "Duplication / conflict", field: "duplicationConflictRate", direction: "decrease", weight: 0.1 },
  { key: "humanIntervention", label: "Human intervention", field: "humanInterventionRate", direction: "decrease", weight: 0.08 },
  { key: "reviewerDisagreement", label: "Reviewer disagreement", field: "reviewerDisagreementRate", direction: "decrease", weight: 0.08 },
];

/**
 * Compare fixed baseline and treatment runs. The result never changes spend or
 * policy automatically; it can be used as one server-side stage guard.
 */
export function evaluateEarnedScale(input: {
  baseline: readonly EarnedScaleObservation[];
  treatment: readonly EarnedScaleObservation[];
}): EarnedScaleDecision {
  const baseline = input.baseline.map(normalizeObservation);
  const treatment = input.treatment.map(normalizeObservation);
  const dimensions = DIMENSIONS.map((spec) => compareDimension(spec, baseline, treatment));
  const evidenceGaps: string[] = [];
  if (baseline.length < EARNED_SCALE_MIN_RUNS) evidenceGaps.push(`${EARNED_SCALE_MIN_RUNS - baseline.length} more baseline run${EARNED_SCALE_MIN_RUNS - baseline.length === 1 ? "" : "s"}`);
  if (treatment.length < EARNED_SCALE_MIN_RUNS) evidenceGaps.push(`${EARNED_SCALE_MIN_RUNS - treatment.length} more treatment run${EARNED_SCALE_MIN_RUNS - treatment.length === 1 ? "" : "s"}`);
  for (const dimension of dimensions) {
    if (dimension.status === "missing") evidenceGaps.push(`${dimension.label.toLowerCase()} measurements`);
  }

  const baselineCompletionRate = completionRate(baseline);
  const treatmentCompletionRate = completionRate(treatment);
  const score = round(dimensions.reduce((sum, dimension) => sum + (dimension.delta ?? 0) * dimension.weight, 0));
  const outcome = dimensions.find((dimension) => dimension.key === "outcome");
  const proof = dimensions.find((dimension) => dimension.key === "proof");
  const duplication = dimensions.find((dimension) => dimension.key === "duplicationConflict");
  const disagreement = dimensions.find((dimension) => dimension.key === "reviewerDisagreement");
  const hardRegression = (outcome?.delta ?? 0) < -0.03
    || (proof?.delta ?? 0) < 0
    || (proof?.treatment ?? 1) < 0.9
    || (duplication?.delta ?? 0) < -0.2
    || (disagreement?.delta ?? 0) < -0.2;
  const completionRegression = baselineCompletionRate !== undefined
    && treatmentCompletionRate !== undefined
    && treatmentCompletionRate < baselineCompletionRate - 0.02;

  let recommendation: EarnedScaleRecommendation;
  const reasons: string[] = [];
  if (evidenceGaps.length) {
    recommendation = "collect-evidence";
    reasons.push(`Comparative scale claims require ${EARNED_SCALE_MIN_RUNS} baseline and ${EARNED_SCALE_MIN_RUNS} treatment runs with every Scale Curve dimension observed.`);
  } else if (hardRegression || completionRegression || score <= -0.05) {
    recommendation = "reduce";
    if ((proof?.delta ?? 0) < 0 || (proof?.treatment ?? 1) < 0.9) reasons.push("Proof quality regressed or fell below the 90% safety floor.");
    if ((outcome?.delta ?? 0) < -0.03) reasons.push("Measured outcome quality regressed by more than three points.");
    if (completionRegression) reasons.push("Task completion regressed despite the larger operating condition.");
    if ((duplication?.delta ?? 0) < -0.2) reasons.push("Duplication or coordination conflict increased materially.");
    if ((disagreement?.delta ?? 0) < -0.2) reasons.push("Independent reviewers disagreed materially more often.");
    if (!reasons.length) reasons.push("The weighted Scale Curve regressed enough to reduce the operating condition.");
  } else if (score >= 0.05) {
    recommendation = "scale";
    reasons.push("Outcome and proof held or improved while the weighted Scale Curve cleared the scale threshold.");
    const improved = dimensions.filter((dimension) => dimension.status === "improved").map((dimension) => dimension.label.toLowerCase());
    if (improved.length) reasons.push(`Measured improvement: ${improved.join(", ")}.`);
  } else {
    recommendation = "hold";
    reasons.push("The treatment is safe but has not produced enough net improvement to earn more scale.");
  }

  return {
    policyVersion: EARNED_SCALE_POLICY_VERSION,
    recommendation,
    confidence: evidenceGaps.length ? "insufficient" : baseline.length >= 5 && treatment.length >= 5 ? "comparative" : "directional",
    score,
    baselineRuns: baseline.length,
    treatmentRuns: treatment.length,
    baselineCompletionRate,
    treatmentCompletionRate,
    dimensions,
    reasons,
    evidenceGaps: [...new Set(evidenceGaps)],
    automaticAction: false,
  };
}

/** Pilot calibrates the first baseline; entering Frontier requires Team to beat it. */
export function earnedScaleStageTransitionBlock(
  current: "pilot" | "team" | "frontier",
  target: "pilot" | "team" | "frontier",
  decision: Pick<EarnedScaleDecision, "recommendation" | "baselineRuns" | "treatmentRuns" | "reasons">,
) {
  const order = ["pilot", "team", "frontier"] as const;
  const currentIndex = order.indexOf(current);
  const targetIndex = order.indexOf(target);
  if (targetIndex <= currentIndex) return undefined;
  if (targetIndex > currentIndex + 1) return `Enter ${order[currentIndex + 1]} before scaling to ${target}; Frontier Lab expands one measured stage at a time.`;
  if (current === "pilot" && target === "team") return undefined;
  if (current === "team" && target === "frontier" && decision.recommendation !== "scale") {
    return `Team has not earned Frontier scale. The Scale Curve recommends ${decision.recommendation.replace("-", " ")} after ${decision.baselineRuns} baseline and ${decision.treatmentRuns} Team runs. ${decision.reasons[0] ?? "Collect comparative outcome and proof evidence first."}`;
  }
  return undefined;
}

export type EarnedScaleSettlementEvidence = {
  policyVersion: typeof EARNED_SCALE_POLICY_VERSION;
  outcomeScore?: number;
  proofSatisfied?: boolean;
  latencyMs?: number;
  uniqueContribution?: boolean;
  duplicationConflict?: boolean;
  humanIntervention?: boolean;
  reviewerDisagreement?: boolean;
};

export function earnedScaleSettlementEvidence(input: {
  outcome: "completed" | "blocked" | "failed";
  startedAt?: number;
  completedAt?: number;
  reason?: string;
  evaluation?: {
    verdict?: string;
    score?: number | null;
    routingEligible?: boolean;
    judge?: { verdict?: string; confidence?: number; axes?: readonly unknown[]; evaluator?: { independent?: boolean } };
  };
}): EarnedScaleSettlementEvidence {
  const completed = input.outcome === "completed";
  const duplicateConflict = /identical|misattribut|duplicate|conflict/i.test(input.reason ?? "");
  const judge = input.evaluation?.judge;
  const reportedScore = finite01(input.evaluation?.score);
  // Non-rubric judges intentionally return no axes, so the control-plane score
  // is 0 even for an accepted result. Use the independent judge's confidence
  // in that one shape; rubric-scored zeroes remain real zeroes.
  const outcomeScore = completed
    && input.evaluation?.verdict === "accepted"
    && judge
    && (judge.axes?.length ?? 0) === 0
    && reportedScore === 0
      ? finite01(judge.confidence) ?? 1
      : reportedScore ?? (completed ? undefined : 0);
  return {
    policyVersion: EARNED_SCALE_POLICY_VERSION,
    outcomeScore,
    proofSatisfied: completed
      ? input.evaluation?.routingEligible === true && input.evaluation?.verdict === "accepted"
      : false,
    latencyMs: Number.isFinite(input.startedAt) && Number.isFinite(input.completedAt)
      ? Math.max(0, Number(input.completedAt) - Number(input.startedAt))
      : undefined,
    uniqueContribution: completed ? !duplicateConflict : false,
    duplicationConflict: duplicateConflict,
    humanIntervention: input.outcome === "blocked",
    reviewerDisagreement: judge
      ? judge.evaluator?.independent !== true || judge.verdict !== (completed ? "accepted" : judge.verdict)
      : undefined,
  };
}

export type OutcomeAwareAllocation = {
  mode: "adaptive-local-first" | "frontier-oauth";
  evidenceSamples: number;
  lanes: Array<{
    tier: "scout" | "builder" | "reviewer";
    route: string;
    intent: string;
  }>;
  checkpoints: Array<{
    id: "plan" | "mid-run" | "final-review";
    trigger: string;
    action: string;
  }>;
  escalationTriggers: string[];
};

export function buildOutcomeAwareAllocation(input: {
  frontierEnabled: boolean;
  models: { scout: string; builder: string; reviewer: string };
  evidenceSamples?: number;
  recentFailureRate?: number;
}): OutcomeAwareAllocation {
  const failureRate = finite01(input.recentFailureRate) ?? 0;
  const mode = input.frontierEnabled ? "frontier-oauth" : "adaptive-local-first";
  return {
    mode,
    evidenceSamples: Math.max(0, Math.floor(input.evidenceSamples ?? 0)),
    lanes: input.frontierEnabled
      ? [
          { tier: "scout", route: `OpenAI OAuth · ${input.models.scout}`, intent: "Research, triage, and plan with the least expensive reviewed Frontier tier." },
          { tier: "builder", route: `OpenAI OAuth · ${input.models.builder}`, intent: "Build only after the plan names the outcome, proof, and budget boundary." },
          { tier: "reviewer", route: `OpenAI OAuth · ${input.models.reviewer}`, intent: "Independently verify the worker result before completion can earn scale." },
        ]
      : [
          { tier: "scout", route: "Adaptive free / local-first", intent: "Use free or local candidates for research and triage when privacy and quality permit." },
          { tier: "builder", route: "Outcome-ranked strong builder", intent: "Select from observed accepted outcomes, quality, budget, latency, and privacy constraints." },
          { tier: "reviewer", route: "Independent strongest available reviewer", intent: "Use a different identity and escalate when proof or reviewer confidence is weak." },
        ],
    checkpoints: [
      { id: "plan", trigger: "Before the first costly or mutating action", action: "Name the outcome metric, required proof, task split, budget, and rollback path." },
      { id: "mid-run", trigger: failureRate >= 0.25 ? "At the first contradictory result or 50% of the task budget" : "When evidence contradicts the plan, reviewers disagree, or 50% of the task budget is consumed", action: "Pause, compare evidence to the plan, then continue, reroute, or reduce scope." },
      { id: "final-review", trigger: "Before completion or stage expansion", action: "Require independent proof and score the full Scale Curve before recommending more scale." },
    ],
    escalationTriggers: ["irreversible or external action", "proof below 90%", "reviewer disagreement", "outcome regression", "budget exception"],
  };
}

export type SwarmBlackboardSummary = {
  activeChallenges: number;
  boardEntries: number;
  lineageNodes: number;
  integrityAlerts: number;
  contributors: number;
  challenges: Array<{
    id: string;
    title: string;
    objective: string;
    bestScore?: number;
    metricName?: string;
    frontierResults: number;
    boardEntries: number;
    contributors: number;
  }>;
};

export function summarizeSwarmBlackboard(challenges: ReadonlyArray<{
  id: string;
  title: string;
  objective: string;
  status: string;
  metricName?: string;
  bestScore?: number;
  frontier?: readonly unknown[];
  leaderboard?: readonly unknown[];
  totals: { boardEntries: number; lineageNodes: number; integrityAlerts: number };
}>): SwarmBlackboardSummary {
  const active = challenges.filter((challenge) => challenge.status === "active");
  return {
    activeChallenges: active.length,
    boardEntries: sum(active.map((challenge) => challenge.totals.boardEntries)),
    lineageNodes: sum(active.map((challenge) => challenge.totals.lineageNodes)),
    integrityAlerts: sum(active.map((challenge) => challenge.totals.integrityAlerts)),
    contributors: sum(active.map((challenge) => challenge.leaderboard?.length ?? 0)),
    challenges: active.slice(0, 5).map((challenge) => ({
      id: challenge.id,
      title: challenge.title,
      objective: challenge.objective,
      bestScore: challenge.bestScore,
      metricName: challenge.metricName,
      frontierResults: challenge.frontier?.length ?? 0,
      boardEntries: challenge.totals.boardEntries,
      contributors: challenge.leaderboard?.length ?? 0,
    })),
  };
}

export type DelightProposal = {
  id: string;
  skillSlug: string;
  kind: "skill" | "schedule" | "company";
  title: string;
  reason: string;
  successCount: number;
  successRate: number;
  averageScore?: number;
  scope: "company" | "workspace";
  reviewRequired: true;
};

export function mineDelightProposals(events: ReadonlyArray<{
  id?: string;
  skillSlug: string;
  status?: string;
  event?: string;
  taskSource?: string;
  companyId?: string;
  score?: number;
  createdAt: string;
}>, companyId?: string): DelightProposal[] {
  const companyEvents = companyId ? events.filter((event) => event.companyId === companyId) : [];
  const scopedEvents = companyEvents.length >= EARNED_SCALE_MIN_RUNS ? companyEvents : events;
  const scope: DelightProposal["scope"] = companyEvents.length >= EARNED_SCALE_MIN_RUNS ? "company" : "workspace";
  const groups = new Map<string, typeof scopedEvents>();
  for (const event of scopedEvents) {
    const slug = event.skillSlug?.trim().toLowerCase();
    if (!slug || slug.startsWith("frontier-lab:tier:")) continue;
    groups.set(slug, [...(groups.get(slug) ?? []), event]);
  }
  const proposals: DelightProposal[] = [];
  for (const [skillSlug, group] of groups) {
    const successes = group.filter(isSuccessfulDelightEvent);
    const distinctRuns = new Set(successes.map((event) => event.taskSource || event.id).filter(Boolean));
    if (distinctRuns.size < EARNED_SCALE_MIN_RUNS) continue;
    const successRate = successes.length / Math.max(1, group.length);
    const scores = successes.map((event) => finite01(event.score)).filter((value): value is number => value !== undefined);
    const averageScore = scores.length ? average(scores) : undefined;
    if (successRate < 0.8 || (averageScore !== undefined && averageScore < 0.75)) continue;
    const base = { skillSlug, successCount: successes.length, successRate: round(successRate), averageScore: averageScore === undefined ? undefined : round(averageScore), scope, reviewRequired: true as const };
    proposals.push({ ...base, id: `${skillSlug}:skill`, kind: "skill", title: `Distill ${skillSlug} into a stronger reusable skill`, reason: `${distinctRuns.size} distinct successful runs repeated this workflow without a measured quality regression.` });
    const days = new Set(successes.map((event) => event.createdAt.slice(0, 10)).filter(Boolean));
    if (successes.length >= 4 && days.size >= 2) proposals.push({ ...base, id: `${skillSlug}:schedule`, kind: "schedule", title: `Schedule the ${skillSlug} workflow`, reason: `${successes.length} successful uses across ${days.size} days suggest a repeatable cadence; review timing before scheduling.` });
    const companies = new Set(successes.map((event) => event.companyId).filter(Boolean));
    if (successes.length >= 5 && (companies.size >= 2 || scope === "company")) proposals.push({ ...base, id: `${skillSlug}:company`, kind: "company", title: `Promote ${skillSlug} into a standing company capability`, reason: `${successes.length} successful uses support a review of a dedicated operating unit, budget, and owner.` });
  }
  return proposals.sort((left, right) => right.successCount - left.successCount || right.successRate - left.successRate).slice(0, 8);
}

function compareDimension(spec: DimensionSpec, baseline: EarnedScaleObservation[], treatment: EarnedScaleObservation[]): EarnedScaleDimension {
  const baselineValue = averagePresent(baseline, spec.field);
  const treatmentValue = averagePresent(treatment, spec.field);
  if (baselineValue === undefined || treatmentValue === undefined) return { key: spec.key, label: spec.label, baseline: baselineValue, treatment: treatmentValue, direction: spec.direction, weight: spec.weight, status: "missing" };
  const raw = spec.direction === "increase" ? treatmentValue - baselineValue : baselineValue - treatmentValue;
  const delta = round(spec.relative ? raw / Math.max(Math.abs(baselineValue), 1) : raw);
  const threshold = spec.relative ? 0.03 : 0.02;
  return {
    key: spec.key,
    label: spec.label,
    baseline: round(baselineValue),
    treatment: round(treatmentValue),
    delta,
    direction: spec.direction,
    weight: spec.weight,
    status: delta > threshold ? "improved" : delta < -threshold ? "regressed" : "steady",
  };
}

function normalizeObservation(value: EarnedScaleObservation): EarnedScaleObservation {
  const settledTasks = nonNegative(value.settledTasks);
  return {
    id: value.id,
    settledTasks,
    completedTasks: Math.min(settledTasks, nonNegative(value.completedTasks)),
    outcomeScore: finite01(value.outcomeScore),
    proofRate: finite01(value.proofRate),
    latencyMs: nonNegativeOptional(value.latencyMs),
    totalTokens: nonNegativeOptional(value.totalTokens),
    uniqueContributionRate: finite01(value.uniqueContributionRate),
    duplicationConflictRate: finite01(value.duplicationConflictRate),
    humanInterventionRate: finite01(value.humanInterventionRate),
    reviewerDisagreementRate: finite01(value.reviewerDisagreementRate),
  };
}

function completionRate(observations: readonly EarnedScaleObservation[]) {
  const settled = sum(observations.map((observation) => observation.settledTasks));
  return settled ? round(sum(observations.map((observation) => observation.completedTasks)) / settled) : undefined;
}

function averagePresent(observations: readonly EarnedScaleObservation[], field: keyof EarnedScaleObservation) {
  const values = observations.map((observation) => observation[field]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length === observations.length && values.length ? average(values) : undefined;
}

function isSuccessfulDelightEvent(event: { status?: string; event?: string }) {
  return event.status === "success" || event.event === "action-completed" || event.event === "task-completed";
}

function average(values: readonly number[]) {
  return values.length ? sum(values) / values.length : 0;
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function finite01(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

function nonNegative(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function nonNegativeOptional(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : undefined;
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
