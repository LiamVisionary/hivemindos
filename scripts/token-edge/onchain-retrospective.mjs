import {
  TOKEN_EDGE_MODEL_VERSION,
  buildScorecard,
  digestValue,
} from "./onchain-forward-core.mjs";
import { exactLiveOutcomeTimingReason } from "./onchain-outcome-timing.mjs";

export const TOKEN_EDGE_RETROSPECTIVE_VERSION = "token-edge-retrospective-v1";
export const TOKEN_EDGE_RETROSPECTIVE_EVIDENCE_VERSION = "exact-live-all-horizons-v2";

const OUTCOME_TYPES = new Set(["resolution", "resolution-recovery"]);
const MATERIAL_MAGNITUDE_ERROR_PCT = 5;

export function preferredObservedOutcomes(events) {
  const byForecast = new Map();
  for (const event of events) {
    if (!OUTCOME_TYPES.has(event.type) || event.status !== "observed") continue;
    const current = byForecast.get(event.forecastId);
    if (!current || (current.type === "resolution-recovery" && event.type === "resolution")) {
      byForecast.set(event.forecastId, event);
    }
  }
  return byForecast;
}

export function buildPendingRetrospectives(events, reviewedAt = new Date()) {
  const reviewedAtIso = asIso(reviewedAt);
  const forecasts = new Map(events
    .filter((event) => event.type === "forecast")
    .map((event) => [event.id, event]));
  const existing = new Set(events
    .filter((event) => event.type === "retrospective")
    .map((event) => event.forecastId));
  const outcomes = preferredObservedOutcomes(events);
  const notes = [];
  for (const [forecastId, outcome] of outcomes) {
    if (existing.has(forecastId)) continue;
    const forecast = forecasts.get(forecastId);
    if (!forecast) continue;
    notes.push(retrospectiveEvent(forecast, outcome, reviewedAtIso));
  }
  return notes.sort((left, right) => (
    Date.parse(left.outcomeObservedAt) - Date.parse(right.outcomeObservedAt)
    || left.forecastId.localeCompare(right.forecastId)
  ));
}

export function retrospectiveEvent(forecast, outcome, reviewedAt = new Date()) {
  const reviewedAtIso = asIso(reviewedAt);
  const evidenceExclusionReason = exactLiveOutcomeTimingReason(outcome);
  const classification = classifyForecastOutcome(forecast, outcome);
  const magnitudeJudgment = classifyMagnitude(forecast.predictedReturnPct, outcome.grossReturnPct);
  const causeTags = retrospectiveCauseTags(forecast, outcome, classification);
  return {
    type: "retrospective",
    id: `retrospective_${digestValue({
      version: TOKEN_EDGE_RETROSPECTIVE_VERSION,
      forecastId: forecast.id,
      outcomeId: outcome.id,
    }).slice(0, 24)}`,
    retrospectiveVersion: TOKEN_EDGE_RETROSPECTIVE_VERSION,
    forecastId: forecast.id,
    resolutionId: outcome.id,
    snapshotId: forecast.snapshotId,
    modelVersion: forecast.modelVersion,
    candidateId: forecast.candidateId,
    horizon: forecast.horizon,
    chain: forecast.chain,
    tokenAddress: forecast.tokenAddress,
    selectionProvider: forecast.selectionProvider ?? "unattributed",
    selectionTimeframe: forecast.selectionTimeframe ?? "unattributed",
    predictionCreatedAt: forecast.createdAt,
    outcomeObservedAt: outcome.observedAt,
    reviewedAt: reviewedAtIso,
    observationMode: outcome.observationMode
      ?? (outcome.type === "resolution" ? "live-point-in-time" : "historical-recovery-unspecified"),
    evidenceEligibility: evidenceExclusionReason ? "diagnostic-only" : "scoreable",
    evidenceExclusionReason,
    classification,
    magnitudeJudgment,
    predictedRise: forecast.predictedRise,
    predictedRiseProbability: forecast.predictedRiseProbability,
    predictedReturnPct: forecast.predictedReturnPct,
    grossReturnPct: outcome.grossReturnPct,
    netReturnPct: outcome.netReturnPct,
    causeTags,
    lesson: retrospectiveLesson(classification, magnitudeJudgment, causeTags),
    causalStatus: "hypothesis-only",
    decision: "retain-until-fresh-batch",
  };
}

export function classifyForecastOutcome(forecast, outcome) {
  if (forecast.predictedRise) {
    if (outcome.grossReturnPct >= 25) return "caught-explosion";
    if (outcome.netReturnPct > 0) return "profitable-rise";
    if (outcome.grossReturnPct > 0) return "cost-eroded-rise";
    return "false-positive";
  }
  if (outcome.grossReturnPct >= 25) return "missed-explosion";
  if (outcome.netReturnPct > 0) return "missed-net-upside";
  if (outcome.grossReturnPct > 0) return "missed-small-rise";
  return "correct-rejection";
}

export function buildRetrospectiveSummary(events) {
  const notes = events.filter((event) => event.type === "retrospective");
  const outcomesById = new Map(events
    .filter((event) => OUTCOME_TYPES.has(event.type))
    .map((event) => [event.id, event]));
  const exclusionReason = (note) => (
    note.evidenceExclusionReason
    ?? exactLiveOutcomeTimingReason(outcomesById.get(note.resolutionId))
  );
  const scoreableNotes = notes.filter((note) => !exclusionReason(note));
  const diagnosticNotes = notes.filter((note) => exclusionReason(note));
  const classificationCounts = countBy(scoreableNotes, (note) => note.classification);
  const modelCounts = countBy(scoreableNotes, (note) => note.modelVersion ?? "unknown");
  const candidateHorizonCounts = countBy(
    scoreableNotes,
    (note) => `${note.modelVersion}:${note.candidateId}:${note.horizon}:${note.classification}`,
  );
  const missedExplosions = scoreableNotes.filter((note) => note.classification === "missed-explosion");
  const falsePositives = scoreableNotes.filter((note) => note.classification === "false-positive");
  const caughtExplosions = scoreableNotes.filter((note) => note.classification === "caught-explosion");
  return {
    type: "token-edge-retrospective-summary",
    retrospectiveVersion: TOKEN_EDGE_RETROSPECTIVE_VERSION,
    totalReviewed: notes.length,
    scoreableReviewed: scoreableNotes.length,
    diagnosticOnlyReviewed: diagnosticNotes.length,
    diagnosticExclusionCounts: countBy(diagnosticNotes, exclusionReason),
    classificationCounts,
    diagnosticClassificationCounts: countBy(diagnosticNotes, (note) => note.classification),
    modelCounts,
    candidateHorizonCounts,
    missedExplosionCount: missedExplosions.length,
    caughtExplosionCount: caughtExplosions.length,
    falsePositiveCount: falsePositives.length,
    uniqueMissedExplosionOpportunityCount: uniqueOpportunityCount(missedExplosions),
    uniqueCaughtExplosionOpportunityCount: uniqueOpportunityCount(caughtExplosions),
    uniqueFalsePositiveOpportunityCount: uniqueOpportunityCount(falsePositives),
    topMissedExplosionCooccurrences: topCauseTags(missedExplosions),
    topFalsePositiveCooccurrences: topCauseTags(falsePositives),
    topUniqueMissedExplosionCooccurrences: topCauseTagsByOpportunity(missedExplosions),
    topUniqueFalsePositiveCooccurrences: topCauseTagsByOpportunity(falsePositives),
    latest: [...notes]
      .sort((left, right) => Date.parse(right.reviewedAt) - Date.parse(left.reviewedAt))
      .slice(0, 25),
    interpretation: "Classification counts include only timing-eligible model-review rows; delayed live points remain visible as diagnostic-only reviews. Unique opportunity counts collapse the same chain, exact token, prediction time, and horizon across candidate or selection variants. Cause tags are descriptive co-occurrences, not causal estimates. Later generations may consume only summaries whose outcomes predate that generation.",
  };
}

export function buildEvolutionReviewEvent(events, reviewedAt = new Date()) {
  const retrospectives = events.filter((event) => event.type === "retrospective");
  if (!retrospectives.length) return null;
  const reviewedAtIso = asIso(reviewedAt);
  const sourceOutcomeDigest = digestValue({
    evidenceVersion: TOKEN_EDGE_RETROSPECTIVE_EVIDENCE_VERSION,
    resolutionIds: [...retrospectives].map((event) => event.resolutionId).sort(),
  });
  if (events.some((event) => (
    event.type === "evolution-review" && event.sourceOutcomeDigest === sourceOutcomeDigest
  ))) return null;
  const scorecard = buildScorecard(events);
  const summary = buildRetrospectiveSummary(events);
  const payoffRows = [...scorecard.rows, ...scorecard.selectionRows]
    .filter((row) => (
      row.modelVersion === TOKEN_EDGE_MODEL_VERSION
      && row.independentTradedFrames > 0
    ))
    .sort((left, right) => (
      (right.portfolioAverageNetReturnPct ?? Number.NEGATIVE_INFINITY)
      - (left.portfolioAverageNetReturnPct ?? Number.NEGATIVE_INFINITY)
    ));
  const capacityRows = scorecard.capacityAudit.rows
    .filter((row) => (
      row.modelVersion === TOKEN_EDGE_MODEL_VERSION
      && row.independentTradedFrames > 0
    ))
    .sort((left, right) => (
      (right.portfolioAverageNetReturnPct ?? Number.NEGATIVE_INFINITY)
      - (left.portfolioAverageNetReturnPct ?? Number.NEGATIVE_INFINITY)
    ));
  const reviewEligible = scorecard.rows.some((row) => (
    row.provisionalPromotionGate
    && capacityRows.some((capacityRow) => (
      capacityRow.modelVersion === row.modelVersion
      && capacityRow.candidateId === row.candidateId
      && capacityRow.horizon === row.horizon
      && capacityRow.provisionalCapacityGate
    ))
  ));
  const evidenceBoundary = retrospectives.reduce((latest, event) => (
    Date.parse(event.outcomeObservedAt) > Date.parse(latest) ? event.outcomeObservedAt : latest
  ), retrospectives[0].outcomeObservedAt);
  const hypotheses = challengerHypotheses(summary, payoffRows, evidenceBoundary);
  return {
    type: "evolution-review",
    id: `evolution_review_${sourceOutcomeDigest.slice(0, 24)}`,
    retrospectiveVersion: TOKEN_EDGE_RETROSPECTIVE_VERSION,
    evidenceVersion: TOKEN_EDGE_RETROSPECTIVE_EVIDENCE_VERSION,
    sourceOutcomeDigest,
    reviewedAt: reviewedAtIso,
    evidenceBoundary,
    status: reviewEligible ? "frozen-audit-eligible" : "collecting",
    mutationAllowed: false,
    reviewedOutcomes: summary.scoreableReviewed,
    diagnosticOnlyOutcomes: summary.diagnosticOnlyReviewed,
    systematicErrors: {
      missedExplosions: summary.missedExplosionCount,
      caughtExplosions: summary.caughtExplosionCount,
      falsePositives: summary.falsePositiveCount,
      uniqueMissedExplosionOpportunities: summary.uniqueMissedExplosionOpportunityCount,
      uniqueCaughtExplosionOpportunities: summary.uniqueCaughtExplosionOpportunityCount,
      uniqueFalsePositiveOpportunities: summary.uniqueFalsePositiveOpportunityCount,
    },
    provisionalPayoffRows: payoffRows.slice(0, 12).map(compactPayoffRow),
    executionCapacity: {
      policyStatus: scorecard.capacityAudit.policyStatus,
      policyRegistrationId: scorecard.capacityAudit.policyRegistrationId,
      policyRegisteredAt: scorecard.capacityAudit.policyRegisteredAt,
      eligibleLiveOutcomes: scorecard.capacityAudit.eligibleLiveOutcomes,
      ineligibleLiveOutcomes: scorecard.capacityAudit.ineligibleLiveOutcomes,
      historicalRecoveryOutcomes: scorecard.capacityAudit.historicalRecoveryOutcomes,
      ineligibilityCounts: scorecard.capacityAudit.ineligibilityCounts,
    },
    provisionalCapacityRows: capacityRows.slice(0, 12).map(compactCapacityRow),
    hypotheses,
    promotionRule: scorecard.promotionPolicy,
    decision: reviewEligible ? "freeze-isolated-audit" : "retain-and-collect",
    note: "Every challenger changes one owned dimension and may use only outcomes observed after this evidence boundary. No review can authorize live trading.",
  };
}

export function buildRetrospectiveReport(events) {
  return {
    summary: buildRetrospectiveSummary(events),
    registeredChallengers: [...events]
      .filter((event) => event.type === "challenger-registration")
      .sort((left, right) => Date.parse(right.registeredAt) - Date.parse(left.registeredAt))
      .map(compactChallengerRegistration),
    registeredExecutionPolicies: [...events]
      .filter((event) => event.type === "execution-policy-registration")
      .sort((left, right) => Date.parse(right.registeredAt) - Date.parse(left.registeredAt))
      .map(compactExecutionPolicyRegistration),
    latestEvolutionReview: [...events]
      .filter((event) => event.type === "evolution-review")
      .sort((left, right) => Date.parse(right.reviewedAt) - Date.parse(left.reviewedAt))[0] ?? null,
  };
}

function classifyMagnitude(predicted, observed) {
  const error = Number(predicted) - Number(observed);
  const tolerance = Math.max(MATERIAL_MAGNITUDE_ERROR_PCT, Math.abs(Number(observed)) * 0.25);
  if (Math.abs(error) <= tolerance) return "roughly-calibrated";
  return error < 0 ? "underestimated" : "overestimated";
}

function retrospectiveCauseTags(forecast, outcome, classification) {
  const tags = new Set([
    classification,
    `candidate:${forecast.candidateId}`,
    `horizon:${forecast.horizon}`,
    `selection:${forecast.selectionProvider ?? "unattributed"}`,
    `selection-timeframe:${forecast.selectionTimeframe ?? "unattributed"}`,
    forecast.predictedRise ? "called-rise" : "called-no-rise",
    outcome.type === "resolution-recovery" ? "recovered-outcome" : "live-outcome",
  ]);
  const evidence = forecast.inputEvidence ?? {};
  tagNumber(tags, evidence.buyImbalanceH1, 0.2, "buy-imbalance-positive", "buy-imbalance-not-positive");
  tagNumber(tags, evidence.priceChangeH1Pct, 0, "entry-momentum-positive", "entry-momentum-nonpositive");
  tagNumber(tags, evidence.volumeLiquidityH1, 0.2, "high-volume-to-liquidity", "low-volume-to-liquidity");
  tagNumber(tags, evidence.discoveryNetflowToLiquidity, 0, "selection-netflow-positive", "selection-netflow-nonpositive");
  tagNumber(tags, evidence.discoveryBuySellVolumeRatio, 1, "selection-buy-dominant", "selection-not-buy-dominant");
  tagNumber(tags, evidence.holderGrowthPct, 0, "holder-growth-positive", "holder-growth-nonpositive");
  tagNumber(tags, evidence.uniqueBuyerWindowActivityChangePct, 0, "buyer-growth-positive", "buyer-growth-nonpositive");
  tagNumber(tags, evidence.top10OwnershipChangePct, 0, "concentration-rising", "concentration-flat-or-falling");
  tagNumber(tags, evidence.profitOverhangToLiquidity, 0.25, "high-profit-overhang", "low-profit-overhang");
  if (Number.isFinite(forecast.score)) {
    tags.add(forecast.score >= 0.65 ? "score-high" : forecast.score >= 0.5 ? "score-middle" : "score-low");
  }
  return [...tags].slice(0, 18);
}

function tagNumber(tags, value, threshold, highTag, lowTag) {
  if (!Number.isFinite(value)) return;
  tags.add(value > threshold ? highTag : lowTag);
}

function retrospectiveLesson(classification, magnitudeJudgment, causeTags) {
  const context = causeTags.filter((tag) => !tag.includes(":")).slice(-3).join(", ") || "the recorded entry evidence";
  if (classification === "missed-explosion") {
    return `The model rejected a later 25%+ move and ${magnitudeJudgment} its size. Test whether ${context} recurs in a fresh cohort before changing a gate.`;
  }
  if (classification === "caught-explosion") {
    return `The rise call caught a 25%+ move. Preserve the frozen rule and test whether ${context} repeats without winner concentration.`;
  }
  if (classification === "false-positive") {
    return `The rise call lost before costs. Test whether ${context} identifies avoidable false positives in later evidence.`;
  }
  if (classification === "missed-net-upside") {
    return `The no-rise call missed a move that cleared costs. Treat ${context} as a hypothesis, not a new rule.`;
  }
  return "This outcome is not sufficient to mutate policy; retain it as evidence for the next frozen review batch.";
}

function topCauseTags(notes) {
  const values = new Map();
  for (const note of notes) {
    for (const tag of note.causeTags ?? []) {
      if (tag === note.classification || tag.startsWith("candidate:") || tag.startsWith("horizon:")) continue;
      const current = values.get(tag) ?? { count: 0, returns: [] };
      current.count += 1;
      current.returns.push(note.netReturnPct);
      values.set(tag, current);
    }
  }
  return [...values.entries()]
    .map(([tag, value]) => ({
      tag,
      count: value.count,
      meanNetReturnPct: round(mean(value.returns), 4),
    }))
    .sort((left, right) => right.count - left.count || right.meanNetReturnPct - left.meanNetReturnPct)
    .slice(0, 12);
}

function topCauseTagsByOpportunity(notes) {
  const opportunities = new Map();
  for (const note of notes) {
    const current = opportunities.get(opportunityKey(note)) ?? { tags: new Set(), returns: [] };
    for (const tag of note.causeTags ?? []) {
      if (excludedCauseTag(note, tag)) continue;
      current.tags.add(tag);
    }
    if (Number.isFinite(note.netReturnPct)) current.returns.push(note.netReturnPct);
    opportunities.set(opportunityKey(note), current);
  }
  const values = new Map();
  for (const opportunity of opportunities.values()) {
    const opportunityReturn = mean(opportunity.returns);
    for (const tag of opportunity.tags) {
      const current = values.get(tag) ?? { count: 0, returns: [] };
      current.count += 1;
      if (Number.isFinite(opportunityReturn)) current.returns.push(opportunityReturn);
      values.set(tag, current);
    }
  }
  return [...values.entries()]
    .map(([tag, value]) => ({
      tag,
      count: value.count,
      meanNetReturnPct: round(mean(value.returns), 4),
    }))
    .sort((left, right) => right.count - left.count || right.meanNetReturnPct - left.meanNetReturnPct)
    .slice(0, 12);
}

function excludedCauseTag(note, tag) {
  return tag === note.classification || tag.startsWith("candidate:") || tag.startsWith("horizon:");
}

function uniqueOpportunityCount(notes) {
  return new Set(notes.map(opportunityKey)).size;
}

function opportunityKey(note) {
  const chain = String(note.chain ?? "unknown").trim().toLowerCase();
  const tokenAddress = chain === "solana"
    ? String(note.tokenAddress ?? "unknown").trim()
    : String(note.tokenAddress ?? "unknown").trim().toLowerCase();
  return [chain, tokenAddress, note.predictionCreatedAt, note.horizon].join(":");
}

function challengerHypotheses(summary, payoffRows, evidenceBoundary) {
  const best = payoffRows[0] ?? null;
  return [
    {
      id: "better-inputs-cross-provider-identity-join",
      changedDimension: "inputs",
      status: "proposal-only",
      hypothesis: "The preregistered LunarCrush large-move alert may add timing value when joined by canonical token identity to an on-chain directional gate.",
      pretestPrediction: "A future joined cohort improves cost-aware payoff over the on-chain gate alone without weakening either data-quality contract.",
      falsificationCriteria: "Reject if token identity is ambiguous, fewer than 64 independent traded frames mature, or the paired bootstrap lower bound is non-positive.",
      eligibleOutcomesAfter: evidenceBoundary,
    },
    {
      id: "sharper-output-net-ev-threshold",
      changedDimension: "decision threshold",
      status: "proposal-only",
      hypothesis: "Requiring predicted return to clear modeled friction may remove directionally correct but untradeable calls.",
      pretestPrediction: "Net win rate and profit factor improve against the same frozen forecasts under 4%, 8%, and 12% round-trip costs.",
      falsificationCriteria: "Reject if the paired lower bound is non-positive or the filter's improvement is carried by one winning frame.",
      eligibleOutcomesAfter: evidenceBoundary,
    },
    {
      id: "more-robust-selection-timeframe-and-concentration",
      changedDimension: "selection robustness",
      status: "proposal-only",
      hypothesis: best
        ? `The provisional ${best.selectionTimeframe ?? "unattributed"} ${best.candidateId}/${best.horizon} payoff survives broader tokens, regimes, and winner-concentration controls.`
        : "A selection timeframe may produce a repeatable payoff after concentration controls.",
      pretestPrediction: "The same selection rule stays positive across at least 30 tokens and no winning frame supplies more than 35% of gains.",
      falsificationCriteria: "Reject on negative 3x-cost stress, profit factor below 1.2, drawdown above 25%, or cohort/timeframe instability.",
      eligibleOutcomesAfter: evidenceBoundary,
    },
    {
      id: "rethink-two-stage-explosion-alert-direction",
      changedDimension: "target architecture",
      status: "proposal-only",
      hypothesis: `${summary.uniqueMissedExplosionOpportunityCount} unique missed explosion opportunities (${summary.missedExplosionCount} model reviews) suggest separating large-move probability from direction instead of forcing one directional score to do both jobs.`,
      pretestPrediction: "A frozen large-move alert followed by an independent direction gate improves explosion recall while retaining positive net expectancy.",
      falsificationCriteria: "Reject if alert lift fails its own forward gate, direction remains at chance, or net expectancy is non-positive after costs.",
      eligibleOutcomesAfter: evidenceBoundary,
    },
  ];
}

function compactPayoffRow(row) {
  return {
    modelVersion: row.modelVersion,
    candidateId: row.candidateId,
    horizon: row.horizon,
    selectionProvider: row.selectionProvider ?? "unattributed",
    selectionTimeframe: row.selectionTimeframe ?? "unattributed",
    maturedForecasts: row.maturedForecasts,
    independentSignalFrames: row.independentSignalFrames,
    predictedRiseForecasts: row.predictedRiseForecasts,
    independentTradedFrames: row.independentTradedFrames,
    portfolioAverageNetReturnPct: row.portfolioAverageNetReturnPct,
    portfolioBootstrapMeanNetReturnCi95Pct: row.portfolioBootstrapMeanNetReturnCi95Pct,
    portfolioProfitFactor: row.portfolioProfitFactor,
    portfolioMaxDrawdownPct: row.portfolioMaxDrawdownPct,
    largestWinningFrameShare: row.largestWinningFrameShare,
    stressedPortfolioAverageNetReturnPct: row.stressedPortfolioAverageNetReturnPct,
    provisionalPromotionGate: row.provisionalPromotionGate,
  };
}

function compactCapacityRow(row) {
  return {
    modelVersion: row.modelVersion,
    candidateId: row.candidateId,
    horizon: row.horizon,
    capacityEligibleLiveOutcomes: row.capacityEligibleLiveOutcomes,
    independentSignalFrames: row.independentSignalFrames,
    predictedRiseForecasts: row.predictedRiseForecasts,
    independentTradedFrames: row.independentTradedFrames,
    uniqueTokens: row.uniqueTokens,
    portfolioAverageNetReturnPct: row.portfolioAverageNetReturnPct,
    portfolioBootstrapMeanNetReturnCi95Pct: row.portfolioBootstrapMeanNetReturnCi95Pct,
    portfolioProfitFactor: row.portfolioProfitFactor,
    portfolioMaxDrawdownPct: row.portfolioMaxDrawdownPct,
    largestWinningFrameShare: row.largestWinningFrameShare,
    stressedPortfolioAverageNetReturnPct: row.stressedPortfolioAverageNetReturnPct,
    paperCapitalAssignedUsd: row.paperCapitalAssignedUsd,
    paperNotionalTradedUsd: row.paperNotionalTradedUsd,
    paperPnlAcrossEligibleSignalsUsd: row.paperPnlAcrossEligibleSignalsUsd,
    provisionalCapacityGate: row.provisionalCapacityGate,
  };
}

function compactChallengerRegistration(event) {
  return {
    id: event.id,
    registeredAt: event.registeredAt,
    status: event.status,
    modelVersion: event.modelVersion,
    candidateId: event.candidateId,
    parentModelVersion: event.parentModelVersion,
    parentCandidateId: event.parentCandidateId,
    horizon: event.horizon,
    provider: event.provider,
    selectionTimeframe: event.selectionTimeframe,
    changedDimension: event.changedDimension,
    maximumLiquidityUsd: event.maximumLiquidityUsd,
    evidenceBoundary: event.evidenceBoundary,
    posthocDerived: event.posthocDerived,
    pairedEvaluationPolicy: event.pairedEvaluationPolicy,
    researchOnly: event.researchOnly,
    mutationAllowed: event.mutationAllowed,
  };
}

function compactExecutionPolicyRegistration(event) {
  return {
    id: event.id,
    registeredAt: event.registeredAt,
    status: event.status,
    policyVersion: event.policyVersion,
    paperNotionalUsd: event.paperNotionalUsd,
    baseRoundTripCostPct: event.baseRoundTripCostPct,
    stressRoundTripCostPct: event.stressRoundTripCostPct,
    ammImpactModel: event.ammImpactModel,
    researchOnly: event.researchOnly,
    mutationAllowed: event.mutationAllowed,
  };
}

function countBy(values, keyOf) {
  const result = {};
  for (const value of values) {
    const key = keyOf(value);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function asIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Expected a valid retrospective timestamp.");
  return date.toISOString();
}
