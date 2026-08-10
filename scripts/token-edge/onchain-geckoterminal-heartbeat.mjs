#!/usr/bin/env node

import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { readLedger, verifyLedger } from "./onchain-forward-core.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";
import {
  activateGeckoTerminalNewPools,
  buildGeckoTerminalNewPoolBirthCreatorBalanceScorecard,
  buildGeckoTerminalNewPoolBirthDangerCountScorecard,
  buildGeckoTerminalNewPoolBirthJupiterExecutableScorecard,
  buildGeckoTerminalNewPoolBirthJupiterRoundTripScorecard,
  buildGeckoTerminalNewPoolBirthLowMomentumScorecard,
  buildGeckoTerminalNewPoolBirthLpProviderScorecard,
  buildGeckoTerminalNewPoolBirthPairAgeScorecard,
  buildGeckoTerminalNewPoolBirthRugCheckPanelScorecard,
  buildGeckoTerminalNewPoolBirthSocialPresenceScorecard,
  buildGeckoTerminalNewPoolBirthTurnoverScorecard,
  buildGeckoTerminalNewPoolBirthUpperMomentumScorecard,
  buildGeckoTerminalNewPoolScorecard,
  captureGeckoTerminalNewPoolBirthEntries,
  markOpenGeckoTerminalNewPoolBirthPaths,
  resolveGeckoTerminalNewPoolBirthJupiterExecutable,
  resolveGeckoTerminalNewPoolForecasts,
  watchGeckoTerminalNewPools,
} from "./onchain-geckoterminal-new-pool-activation.mjs";
import {
  buildGeckoTerminalNewPoolFastPathDisagreementScorecard,
  markOpenGeckoTerminalNewPoolFastPaths,
  markOpenGeckoTerminalNewPoolStandardMidPaths,
} from "./onchain-geckoterminal-new-pool-fast-path.mjs";
import {
  buildGeckoTerminalNewPoolBirthAttemptCoveredBracketScorecard,
  buildGeckoTerminalNewPoolBirthBracketScorecard,
  buildGeckoTerminalNewPoolBirthFastBracketScorecard,
  buildGeckoTerminalNewPoolBirthPrefixTakeProfitScorecard,
  buildGeckoTerminalNewPoolBirthStandardBracketScorecard,
  buildGeckoTerminalNewPoolBirthStandardMidBracketScorecard,
  buildGeckoTerminalNewPoolBirthTakeProfitScorecard,
} from "./onchain-geckoterminal-new-pool-birth-take-profit.mjs";
import {
  buildGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry,
  buildGeckoTerminalNewPoolDelayedShadowScorecard,
  inspectGeckoTerminalNewPoolDelayedShadowDue,
  resolveGeckoTerminalNewPoolDelayedShadows,
} from "./onchain-geckoterminal-new-pool-delayed-shadow.mjs";
import {
  buildGeckoTerminalNewPoolForecastAbScorecard,
  captureGeckoTerminalNewPoolForecastAb,
} from "./onchain-geckoterminal-new-pool-forecast-ab.mjs";
import {
  buildGeckoTerminalNewPoolForecastPostsRescueScorecard,
  captureGeckoTerminalNewPoolForecastPostsRescue,
} from "./onchain-geckoterminal-new-pool-forecast-posts-rescue.mjs";

const FIVE_MINUTES_MS = 5 * 60_000;
const EMERGENCY_EXACT_WINDOW_REMAINING_MS = 10_000;
const LAST_SAFE_PHASE_SECOND = 54;

export const GECKOTERMINAL_HEARTBEAT_PHASES = Object.freeze([
  Object.freeze({
    minuteModulo: 0,
    startSecond: 5,
    lowerActions: Object.freeze(["resolveDelayedShadow24h", "markBirthPath", "score"]),
  }),
  Object.freeze({
    minuteModulo: 1,
    startSecond: 20,
    lowerActions: Object.freeze([
      "markFastPath", "watch", "captureForecastAb", "captureForecastPostsRescue", "capture",
    ]),
  }),
  Object.freeze({
    minuteModulo: 2,
    startSecond: 35,
    lowerActions: Object.freeze(["markFastPath", "activate"]),
  }),
  Object.freeze({
    minuteModulo: 3,
    startSecond: 50,
    lowerActions: Object.freeze(["resolveDelayedShadow1h", "markStandardMid", "score"]),
  }),
  Object.freeze({
    minuteModulo: 4,
    startSecond: 0,
    lowerActions: Object.freeze(["score"]),
  }),
]);

export async function runGeckoTerminalHeartbeatPhase(options = {}, dependencies = {}) {
  const clock = dependencies.clock ?? (() => new Date());
  const sleeper = dependencies.sleep ?? sleep;
  const initialNow = validDate(clock());
  const scheduledMinuteStartedAtMs = Math.floor(initialNow.getTime() / 60_000) * 60_000;
  const phase = GECKOTERMINAL_HEARTBEAT_PHASES[initialNow.getUTCMinutes() % 5];
  if (initialNow.getUTCSeconds() < phase.startSecond) {
    await sleeper((phase.startSecond - initialNow.getUTCSeconds()) * 1_000);
  }
  const startedAt = validDate(clock());
  const actions = dependencies.actions ?? defaultHeartbeatActions();
  const inspectDue = dependencies.inspectDue ?? inspectGeckoTerminalHeartbeatDue;
  const dueState = await inspectDue(options, startedAt);
  const emergencyOrder = exactEmergencyOrder(dueState, startedAt);
  if (!insidePhaseWindow(startedAt, phase, scheduledMinuteStartedAtMs)) {
    if (emergencyOrder.length) {
      const emergency = await executeEmergencyActions(actions, emergencyOrder, options);
      return heartbeatResult({
        status: "exact-window-only-stale-phase",
        phase,
        startedAt,
        dueState,
        ...emergency,
      });
    }
    return heartbeatResult({
      status: "skipped-stale-phase",
      phase,
      startedAt,
      dueState,
      actionOrder: [],
      actionResults: {},
    });
  }

  if (emergencyOrder.length) {
    const emergency = await executeEmergencyActions(actions, emergencyOrder, options);
    return heartbeatResult({
      status: "exact-window-only",
      phase,
      startedAt,
      dueState,
      ...emergency,
    });
  }

  const actionOrder = [];
  const actionResults = {};
  for (const actionName of dueExactActionOrder(dueState)) {
    const result = await actions[actionName](options);
    const label = actionLabel(actionName);
    actionOrder.push(label);
    actionResults[label] = result;
  }
  if (exactResolverUsedProviderOrRecordedOutcome(actionResults)) {
    return heartbeatResult({
      status: "exact-outcome-recorded-lower-priority-skipped",
      phase,
      startedAt,
      dueState,
      actionOrder,
      actionResults,
    });
  }

  for (const actionName of phase.lowerActions) {
    const actionNow = validDate(clock());
    if (!insidePhaseWindow(actionNow, phase, scheduledMinuteStartedAtMs)) {
      return heartbeatResult({
        status: "phase-ended-lower-priority-skipped",
        phase,
        startedAt,
        dueState,
        actionOrder,
        actionResults,
      });
    }
    const refreshedDueState = await inspectDue(options, actionNow);
    const refreshedEmergencyOrder = exactEmergencyOrder(refreshedDueState, actionNow);
    if (refreshedEmergencyOrder.length) {
      const emergency = await executeEmergencyActions(
        actions,
        refreshedEmergencyOrder,
        options,
      );
      return heartbeatResult({
        status: "due-window-became-imminent-lower-priority-skipped",
        phase,
        startedAt,
        dueState: refreshedDueState,
        actionOrder: [...actionOrder, ...emergency.actionOrder],
        actionResults: { ...actionResults, ...emergency.actionResults },
      });
    }
    if ((refreshedDueState.genericDue ?? 0) > 0
      || (refreshedDueState.jupiterDue ?? 0) > 0) {
      for (const exactActionName of dueExactActionOrder(refreshedDueState)) {
        const result = await actions[exactActionName](options);
        const label = actionLabel(exactActionName);
        actionOrder.push(label);
        actionResults[label] = result;
      }
      return heartbeatResult({
        status: "exact-became-due-lower-priority-skipped",
        phase,
        startedAt,
        dueState: refreshedDueState,
        actionOrder,
        actionResults,
      });
    }
    const result = await actions[actionName](options);
    const label = actionLabel(actionName);
    actionOrder.push(label);
    actionResults[label] = result;
    if (actionUsedProviderOrRecordedOutcome(result)) {
      return heartbeatResult({
        status: (result?.recordedResolutions ?? 0) > 0
          || (result?.recordedOutcomes ?? 0) > 0
          ? "exact-outcome-recorded-lower-priority-skipped"
          : "provider-request-lower-priority-skipped",
        phase,
        startedAt,
        dueState,
        actionOrder,
        actionResults,
      });
    }
  }
  return heartbeatResult({
    status: "completed",
    phase,
    startedAt,
    dueState,
    actionOrder,
    actionResults,
  });
}

async function executeEmergencyActions(actions, emergencyOrder, options) {
  const actionOrder = [];
  const actionResults = {};
  for (const actionName of emergencyOrder) {
    const result = await actions[actionName](options);
    const label = actionLabel(actionName);
    actionOrder.push(label);
    actionResults[label] = result;
  }
  return { actionOrder, actionResults };
}

export async function inspectGeckoTerminalHeartbeatDue(options = {}, now = new Date()) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedEvents(ledgerPath);
  const resolvedForecastIds = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-resolution"
  )).map((event) => event.forecastId));
  const resolvedDecisionIds = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-jupiter-executable-resolution"
  )).map((event) => event.decisionId));
  const nowMs = validDate(now).getTime();
  const genericDue = events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && !resolvedForecastIds.has(event.id)
      && Date.parse(event.dueAt) <= nowMs
  ));
  const jupiterDue = events.filter((event) => (
    event.type === "geckoterminal-new-pool-jupiter-executable-decision"
      && !resolvedDecisionIds.has(event.id)
      && Date.parse(event.dueAt) <= nowMs
  ));
  const delayedShadowDue = inspectGeckoTerminalNewPoolDelayedShadowDue(events, {
    asOf: now,
  });
  return {
    ledgerPath,
    genericDue: genericDue.length,
    jupiterDue: jupiterDue.length,
    genericWindowClosesAt: earliestWindowClose(genericDue),
    jupiterWindowClosesAt: earliestWindowClose(jupiterDue),
    delayedShadowDue,
  };
}

function dueExactActionOrder(dueState) {
  const order = [];
  if ((dueState.genericDue ?? 0) > 0) order.push("resolveGeneric");
  if ((dueState.jupiterDue ?? 0) > 0) order.push("resolveJupiter");
  return order;
}

function exactEmergencyOrder(dueState, now) {
  const due = [];
  if (dueState.jupiterDue > 0 && dueState.jupiterWindowClosesAt) {
    due.push({
      actionName: "resolveJupiter",
      closesAt: Date.parse(dueState.jupiterWindowClosesAt),
      tiePriority: 0,
    });
  }
  if (dueState.genericDue > 0 && dueState.genericWindowClosesAt) {
    due.push({
      actionName: "resolveGeneric",
      closesAt: Date.parse(dueState.genericWindowClosesAt),
      tiePriority: 1,
    });
  }
  for (const [horizon, actionName, tiePriority] of [
    ["1h", "resolveDelayedShadow1h", 2],
    ["24h", "resolveDelayedShadow24h", 3],
  ]) {
    const delayedHorizon = dueState.delayedShadowDue?.horizons?.[horizon];
    if ((delayedHorizon?.liveDueCandidates ?? 0) <= 0
      || !delayedHorizon?.earliestLiveWindowClosesAt) continue;
    due.push({
      actionName,
      closesAt: Date.parse(delayedHorizon.earliestLiveWindowClosesAt),
      tiePriority,
    });
  }
  if (!due.length) return [];
  const remainingMs = Math.min(...due.map(({ closesAt }) => closesAt)) - now.getTime();
  if (remainingMs > EMERGENCY_EXACT_WINDOW_REMAINING_MS) return [];
  return due.sort((left, right) => (
    left.closesAt - right.closesAt || left.tiePriority - right.tiePriority
  )).map(({ actionName }) => actionName);
}

function exactResolverUsedProviderOrRecordedOutcome(actionResults) {
  return ["resolve-generic", "resolve-jupiter"].some((label) => {
    return actionUsedProviderOrRecordedOutcome(actionResults[label]);
  });
}

function actionUsedProviderOrRecordedOutcome(result) {
  return (result?.requestsAttempted ?? 0) > 0
    || (result?.recordedResolutions ?? 0) > 0
    || (result?.recordedOutcomes ?? 0) > 0;
}

function insidePhaseWindow(now, phase, scheduledMinuteStartedAtMs) {
  return Math.floor(now.getTime() / 60_000) * 60_000 === scheduledMinuteStartedAtMs
    && now.getUTCMinutes() % 5 === phase.minuteModulo
    && now.getUTCSeconds() >= phase.startSecond
    && now.getUTCSeconds() <= LAST_SAFE_PHASE_SECOND;
}

function earliestWindowClose(events) {
  if (!events.length) return null;
  return new Date(Math.min(...events.map((event) => (
    Date.parse(event.dueAt) + FIVE_MINUTES_MS
  )))).toISOString();
}

function defaultHeartbeatActions() {
  return {
    resolveGeneric: (options) => resolveGeckoTerminalNewPoolForecasts(options),
    resolveJupiter: (options) => (
      resolveGeckoTerminalNewPoolBirthJupiterExecutable(options)
    ),
    markBirthPath: (options) => markOpenGeckoTerminalNewPoolBirthPaths(options),
    markFastPath: (options) => markOpenGeckoTerminalNewPoolFastPaths(options),
    watch: async (options) => normalizeGeckoTerminalHeartbeatWatchResult(
      await watchGeckoTerminalNewPools(options),
    ),
    captureForecastAb: (options) => captureGeckoTerminalNewPoolForecastAb(options),
    captureForecastPostsRescue: (options) => (
      captureGeckoTerminalNewPoolForecastPostsRescue(options)
    ),
    capture: (options) => captureGeckoTerminalNewPoolBirthEntries(options),
    activate: (options) => activateGeckoTerminalNewPools(options),
    resolveDelayedShadow1h: (options) => resolveGeckoTerminalNewPoolDelayedShadows({
      ...options,
      horizon: "1h",
    }),
    resolveDelayedShadow24h: (options) => resolveGeckoTerminalNewPoolDelayedShadows({
      ...options,
      horizon: "24h",
    }),
    markStandardMid: (options) => markOpenGeckoTerminalNewPoolStandardMidPaths(options),
    score: (options) => buildHeartbeatScoreSummary(options),
  };
}

export function normalizeGeckoTerminalHeartbeatWatchResult(result) {
  if (Number.isFinite(result?.requestsAttempted)) return result;
  return {
    ...result,
    requestsAttempted: result?.status === "recorded" ? 1 : 0,
  };
}

export async function buildHeartbeatScoreSummary(options) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedEvents(ledgerPath);
  const scorecards = [
    buildGeckoTerminalNewPoolScorecard(events),
    buildGeckoTerminalNewPoolBirthCreatorBalanceScorecard(events),
    buildGeckoTerminalNewPoolBirthLpProviderScorecard(events),
    buildGeckoTerminalNewPoolBirthRugCheckPanelScorecard(events),
    buildGeckoTerminalNewPoolBirthPairAgeScorecard(events),
    buildGeckoTerminalNewPoolBirthTurnoverScorecard(events),
    buildGeckoTerminalNewPoolBirthLowMomentumScorecard(events),
    buildGeckoTerminalNewPoolBirthSocialPresenceScorecard(events),
    buildGeckoTerminalNewPoolBirthDangerCountScorecard(events),
    buildGeckoTerminalNewPoolBirthJupiterRoundTripScorecard(events),
    buildGeckoTerminalNewPoolBirthJupiterExecutableScorecard(events),
    buildGeckoTerminalNewPoolBirthUpperMomentumScorecard(events),
    buildGeckoTerminalNewPoolFastPathDisagreementScorecard(events),
    buildGeckoTerminalNewPoolBirthTakeProfitScorecard(events),
    buildGeckoTerminalNewPoolBirthPrefixTakeProfitScorecard(events),
    buildGeckoTerminalNewPoolBirthBracketScorecard(events),
    buildGeckoTerminalNewPoolBirthFastBracketScorecard(events),
    buildGeckoTerminalNewPoolBirthStandardBracketScorecard(events),
    buildGeckoTerminalNewPoolBirthStandardMidBracketScorecard(events),
    buildGeckoTerminalNewPoolBirthAttemptCoveredBracketScorecard(events),
    buildGeckoTerminalNewPoolDelayedShadowScorecard(events),
    buildGeckoTerminalNewPoolDelayedShadowFullCohortAuditRegistry(events),
    buildGeckoTerminalNewPoolForecastAbScorecard(events),
    buildGeckoTerminalNewPoolForecastPostsRescueScorecard(events),
  ];
  const summarizedScorecards = scorecards.map(
    summarizeGeckoTerminalHeartbeatScorecard,
  );
  return {
    ledgerPath,
    requestsAttempted: 0,
    verification: verifyLedger(events),
    gateAudit: buildGeckoTerminalHeartbeatGateAudit(scorecards),
    scorecards: summarizedScorecards,
  };
}

export function buildGeckoTerminalHeartbeatGateAudit(scorecards) {
  const prospectiveStressCandidates = scorecards.filter((scorecard) => (
    scorecard.evidenceStatus !== "descriptive-only"
      && Number.isFinite(scorecard.missingAsLossAverageStressReturnPct)
  )).map((scorecard) => ({
    type: scorecard.type,
    evidenceStatus: scorecard.evidenceStatus ?? null,
    maturedForecastCount: scorecard.maturedForecastCount ?? null,
    maturedDecisionCount: scorecard.maturedDecisionCount ?? null,
    maturedCandidateOutcomes: scorecard.maturedCandidateOutcomes ?? null,
    independentHourlyFrames: scorecard.independentHourlyFrames ?? null,
    missingAsLossAverageBaseReturnPct:
      scorecard.missingAsLossAverageBaseReturnPct ?? null,
    missingAsLossAverageStressReturnPct:
      scorecard.missingAsLossAverageStressReturnPct,
    resolvedCoverageGate: scorecard.resolvedCoverageGate ?? null,
    validCapacityOutcomeCoverageGate:
      scorecard.validCapacityOutcomeCoverageGate ?? null,
    outcomeKeyReconciliationGate:
      scorecard.outcomeKeyReconciliationGate ?? null,
    eligiblePathOutcomeCoverageGate:
      scorecard.eligiblePathOutcomeCoverageGate ?? null,
    chronologicalHalfValidationGate:
      scorecard.chronologicalHalfValidationGate ?? null,
    statisticalCandidateGate: scorecard.statisticalCandidateGate ?? null,
    provisionalGate: scorecard.provisionalGate ?? null,
  })).sort((left, right) => (
    right.missingAsLossAverageStressReturnPct
      - left.missingAsLossAverageStressReturnPct
      || left.type.localeCompare(right.type)
  ));
  const retrospectiveFamilies = scorecards.flatMap((scorecard) => (
    Array.isArray(scorecard.families) ? scorecard.families : []
  )).filter((family) => Number.isFinite(family.bestStressReturnPct))
    .map((family) => ({
      auditVersion: family.auditVersion,
      bestStressReturnPct: family.bestStressReturnPct,
      familyCorrectionStatus: family.familyCorrectionStatus ?? null,
      nominationGate: family.nominationGate ?? null,
    })).sort((left, right) => (
      right.bestStressReturnPct - left.bestStressReturnPct
        || left.auditVersion.localeCompare(right.auditVersion)
    ));
  const provisionalGatePassCount = scorecards.filter((scorecard) => (
    scorecard.provisionalGate === true
  )).length;
  const outcomeKeyReconciliationFailureCount = scorecards.filter((scorecard) => (
    scorecard.outcomeKeyReconciliationGate === false
  )).length;
  return {
    scorecardCount: scorecards.length,
    prospectiveStressCandidateCount: prospectiveStressCandidates.length,
    positiveProspectiveStressCandidateCount:
      prospectiveStressCandidates.filter((candidate) => (
        candidate.missingAsLossAverageStressReturnPct > 0
      )).length,
    prospectiveStressLeader: prospectiveStressCandidates[0] ?? null,
    retrospectiveFamilyCount: retrospectiveFamilies.length,
    positiveRetrospectiveFamilyCount: retrospectiveFamilies.filter((family) => (
      family.bestStressReturnPct > 0
    )).length,
    retrospectiveStressLeader: retrospectiveFamilies[0] ?? null,
    statisticalCandidateGatePassCount: scorecards.filter((scorecard) => (
      scorecard.statisticalCandidateGate === true
    )).length,
    nominationGatePassCount: scorecards.filter((scorecard) => (
      scorecard.nominationGate === true
    )).length,
    familyExpansionPrerequisiteGatePassCount: scorecards.filter((scorecard) => (
      scorecard.familyExpansionPrerequisiteGate === true
    )).length,
    familyExpansionAuthorityPassCount: scorecards.filter((scorecard) => (
      scorecard.familyExpansionAuthority === true
    )).length,
    outcomeKeyReconciliationFailureCount,
    provisionalGatePassCount,
    decisionAuthorityPassCount: scorecards.filter((scorecard) => (
      scorecard.decisionAuthority === true
    )).length,
    promotionAuthorityPassCount: scorecards.filter((scorecard) => (
      scorecard.promotionAuthority === true
    )).length,
    tradingAuthorityPassCount: scorecards.filter((scorecard) => (
      scorecard.tradingAuthority === true
    )).length,
    allScorecardsResearchOnly: scorecards.every((scorecard) => (
      scorecard.researchOnly === true
    )),
    anyScorecardMutationAllowed: scorecards.some((scorecard) => (
      scorecard.mutationAllowed === true
    )),
    evidenceDisposition: outcomeKeyReconciliationFailureCount > 0
      ? "failed-delayed-outcome-key-reconciliation"
      : (provisionalGatePassCount > 0
        ? "candidate-cleared-frozen-gates-requires-independent-review"
        : "no-candidate-cleared-frozen-gates"),
  };
}

export function summarizeGeckoTerminalHeartbeatScorecard(scorecard) {
  return {
    type: scorecard.type,
    scorecardAsOf: scorecard.scorecardAsOf ?? null,
    candidateForecasts: scorecard.candidateForecasts ?? null,
    candidateDecisions: scorecard.candidateDecisions ?? null,
    candidateOutcomes: scorecard.candidateOutcomes ?? null,
    recordedOutcomes: scorecard.recordedOutcomes ?? null,
    recordedOutcomeEvents: scorecard.recordedOutcomeEvents ?? null,
    uniqueOutcomeKeys: scorecard.uniqueOutcomeKeys ?? null,
    matchedOutcomeKeyCount: scorecard.matchedOutcomeKeyCount ?? null,
    invalidOutcomeKeyEventCount:
      scorecard.invalidOutcomeKeyEventCount ?? null,
    unexpectedOutcomeKeyCount: scorecard.unexpectedOutcomeKeyCount ?? null,
    unexpectedOutcomeEventCount:
      scorecard.unexpectedOutcomeEventCount ?? null,
    duplicateOutcomeKeyCount: scorecard.duplicateOutcomeKeyCount ?? null,
    duplicateOutcomeEventCount: scorecard.duplicateOutcomeEventCount ?? null,
    outcomeKeyReconciliationGate:
      scorecard.outcomeKeyReconciliationGate ?? null,
    openForecasts: scorecard.openForecasts ?? null,
    openDecisions: scorecard.openDecisions ?? null,
    openOutcomes: scorecard.openOutcomes ?? null,
    maturedForecastCount: scorecard.maturedForecastCount ?? null,
    recordedMaturedResolutions: scorecard.recordedMaturedResolutions ?? null,
    unrecordedMaturedForecasts: scorecard.unrecordedMaturedForecasts ?? null,
    maturedDecisionCount: scorecard.maturedDecisionCount ?? null,
    unrecordedMaturedDecisions: scorecard.unrecordedMaturedDecisions ?? null,
    maturedCandidateOutcomes: scorecard.maturedCandidateOutcomes ?? null,
    unrecordedMaturedOutcomes: scorecard.unrecordedMaturedOutcomes ?? null,
    observedOutcomes: scorecard.observedOutcomes ?? null,
    missedOutcomes: scorecard.missedOutcomes ?? null,
    eligibleLiveObservations: scorecard.eligibleLiveObservations ?? null,
    independentHourlyFrames: scorecard.independentHourlyFrames ?? null,
    resolvedForecastCoverageRate: scorecard.resolvedForecastCoverageRate ?? null,
    resolvedDecisionCoverageRate: scorecard.resolvedDecisionCoverageRate ?? null,
    recordedOutcomeCoverageRate: scorecard.recordedOutcomeCoverageRate ?? null,
    validCapacityOutcomeCoverageRate:
      scorecard.validCapacityOutcomeCoverageRate ?? null,
    minimumValidCapacityOutcomeCoverageRate:
      scorecard.minimumValidCapacityOutcomeCoverageRate ?? null,
    baselineMaturedCandidates: scorecard.baselineMaturedCandidates ?? null,
    baselineValidCapacityOutcomes:
      scorecard.baselineValidCapacityOutcomes ?? null,
    invalidCapacityOutcomes: scorecard.invalidCapacityOutcomes ?? null,
    minimumAdditionalPerfectValidOutcomesToReachCoverageGate:
      scorecard.minimumAdditionalPerfectValidOutcomesToReachCoverageGate ?? null,
    eligiblePathOutcomeCoverageRate:
      scorecard.eligiblePathOutcomeCoverageRate ?? null,
    cashInclusiveAverageBaseReturnPct:
      scorecard.cashInclusiveAverageBaseReturnPct ?? null,
    cashInclusiveAverageStressReturnPct:
      scorecard.cashInclusiveAverageStressReturnPct ?? null,
    missingAsLossAverageBaseReturnPct:
      scorecard.missingAsLossAverageBaseReturnPct ?? null,
    missingAsLossAverageStressReturnPct:
      scorecard.missingAsLossAverageStressReturnPct ?? null,
    missingAsLossMaturedForecasts:
      scorecard.missingAsLossMaturedForecasts ?? null,
    missingAsLossUnscoredForecasts:
      scorecard.missingAsLossUnscoredForecasts ?? null,
    missingAsLossSelectedForecasts:
      scorecard.missingAsLossSelectedForecasts ?? null,
    missingAsLossMaturedDecisions:
      scorecard.missingAsLossMaturedDecisions ?? null,
    missingAsLossUnscoredDecisions:
      scorecard.missingAsLossUnscoredDecisions ?? null,
    missingAsLossSelectedDecisions:
      scorecard.missingAsLossSelectedDecisions ?? null,
    missingAsLossIndependentHourlyFrames:
      scorecard.missingAsLossIndependentHourlyFrames ?? null,
    missingAsLossSensitivityGate:
      scorecard.missingAsLossSensitivityGate ?? null,
    portfolioAverageCapacityReturnPct:
      scorecard.portfolioAverageCapacityReturnPct ?? null,
    stressPortfolioAverageCapacityReturnPct:
      scorecard.stressPortfolioAverageCapacityReturnPct ?? null,
    evidenceStatus: scorecard.evidenceStatus ?? null,
    resolvedCoverageGate: scorecard.resolvedCoverageGate ?? null,
    validCapacityOutcomeCoverageGate:
      scorecard.validCapacityOutcomeCoverageGate ?? null,
    eligiblePathOutcomeCoverageGate:
      scorecard.eligiblePathOutcomeCoverageGate ?? null,
    chronologicalHalfValidationGate:
      scorecard.chronologicalHalfValidationGate ?? null,
    statisticalCandidateGate: scorecard.statisticalCandidateGate ?? null,
    totalFamilyCount: scorecard.totalFamilyCount ?? null,
    totalVariantCount: scorecard.totalVariantCount ?? null,
    screeningCandidateCount: scorecard.screeningCandidateCount ?? null,
    allFamiliesPrerequisiteRejected:
      scorecard.allFamiliesPrerequisiteRejected ?? null,
    familyCorrectionStatus: scorecard.familyCorrectionStatus ?? null,
    familyExpansionPolicy: scorecard.familyExpansionPolicy ?? null,
    maximumAdditionalFamiliesPerReviewedExpansion:
      scorecard.maximumAdditionalFamiliesPerReviewedExpansion ?? null,
    familyExpansionPrerequisiteGate:
      scorecard.familyExpansionPrerequisiteGate ?? null,
    familyExpansionStatus: scorecard.familyExpansionStatus ?? null,
    familyExpansionAuthority: scorecard.familyExpansionAuthority ?? null,
    lineageIntegrityGate: scorecard.lineageIntegrityGate ?? null,
    evidenceReadinessGate: scorecard.evidenceReadinessGate ?? null,
    independentQuantValidationStatus:
      scorecard.independentQuantValidationStatus ?? null,
    nominationGate: scorecard.nominationGate ?? null,
    researchOnly: scorecard.researchOnly ?? null,
    mutationAllowed: scorecard.mutationAllowed ?? null,
    decisionAuthority: scorecard.decisionAuthority ?? null,
    promotionAuthority: scorecard.promotionAuthority ?? null,
    tradingAuthority: scorecard.tradingAuthority ?? null,
    provisionalGate: scorecard.provisionalGate ?? null,
    families: scorecard.families ?? null,
    horizons: scorecard.horizons
      ? Object.fromEntries(Object.entries(scorecard.horizons).map(
        ([horizon, metrics]) => [horizon, summarizeGeckoTerminalHeartbeatHorizon(metrics)],
      ))
      : null,
    arms: scorecard.arms
      ? Object.fromEntries(Object.entries(scorecard.arms).map(([name, arm]) => (
        [name, summarizeGeckoTerminalHeartbeatArm(arm)]
      )))
      : null,
  };
}

export function summarizeGeckoTerminalHeartbeatHorizon(metrics) {
  return {
    prospectiveCandidates: metrics.prospectiveCandidates ?? null,
    maturedCandidateOutcomes: metrics.maturedCandidateOutcomes ?? null,
    recordedOutcomes: metrics.recordedOutcomes ?? null,
    recordedOutcomeEvents: metrics.recordedOutcomeEvents ?? null,
    uniqueOutcomeKeys: metrics.uniqueOutcomeKeys ?? null,
    matchedOutcomeKeyCount: metrics.matchedOutcomeKeyCount ?? null,
    invalidOutcomeKeyEventCount:
      metrics.invalidOutcomeKeyEventCount ?? null,
    unexpectedOutcomeKeyCount: metrics.unexpectedOutcomeKeyCount ?? null,
    unexpectedOutcomeEventCount:
      metrics.unexpectedOutcomeEventCount ?? null,
    duplicateOutcomeKeyCount: metrics.duplicateOutcomeKeyCount ?? null,
    duplicateOutcomeEventCount: metrics.duplicateOutcomeEventCount ?? null,
    outcomeKeyReconciliationGate:
      metrics.outcomeKeyReconciliationGate ?? null,
    openOutcomes: metrics.openOutcomes ?? null,
    unrecordedMaturedOutcomes: metrics.unrecordedMaturedOutcomes ?? null,
    recordedOutcomeCoverageRate: metrics.recordedOutcomeCoverageRate ?? null,
    observedOutcomes: metrics.observedOutcomes ?? null,
    missedOutcomes: metrics.missedOutcomes ?? null,
    validCapacityOutcomes: metrics.validCapacityOutcomes ?? null,
    validCapacityOutcomeCoverageRate:
      metrics.validCapacityOutcomeCoverageRate ?? null,
    minimumValidCapacityOutcomeCoverageRate:
      metrics.minimumValidCapacityOutcomeCoverageRate ?? null,
    validCapacityOutcomeCoverageGate:
      metrics.validCapacityOutcomeCoverageGate ?? null,
    invalidCapacityOutcomes:
      metrics.coverageDiagnostics?.invalidCapacityOutcomes ?? null,
    invalidCapacityOutcomeCounts:
      metrics.coverageDiagnostics?.invalidCapacityOutcomeCounts ?? null,
    invalidCapacityOutcomeReconciliationGate:
      metrics.coverageDiagnostics?.invalidCapacityOutcomeReconciliationGate ?? null,
    dominantInvalidCapacityOutcomeReason:
      metrics.coverageDiagnostics?.dominantInvalidCapacityOutcomeReason ?? null,
    dominantInvalidCapacityOutcomeCount:
      metrics.coverageDiagnostics?.dominantInvalidCapacityOutcomeCount ?? null,
    minimumAdditionalPerfectValidOutcomesToReachCoverageGate:
      metrics.coverageDiagnostics
        ?.minimumAdditionalPerfectValidOutcomesToReachCoverageGate ?? null,
    discoveryUtcDayCoverageDiagnostics:
      metrics.discoveryUtcDayCoverageDiagnostics ?? null,
    validCapacityRows: metrics.validCapacityRows ?? null,
    independentHourlyFrames: metrics.independentHourlyFrames ?? null,
    cashInclusiveIndependentHourlyFrames:
      metrics.cashInclusiveIndependentHourlyFrames ?? null,
    uniqueTokens: metrics.uniqueTokens ?? null,
    grossRiseRate: metrics.grossRiseRate ?? null,
    explosion25Rate: metrics.explosion25Rate ?? null,
    averageBaseReturnPct: metrics.averageBaseReturnPct ?? null,
    averageStressReturnPct: metrics.averageStressReturnPct ?? null,
    cashInclusiveAverageBaseReturnPct:
      metrics.cashInclusiveAverageBaseReturnPct ?? null,
    cashInclusiveAverageStressReturnPct:
      metrics.cashInclusiveAverageStressReturnPct ?? null,
    missingAsLossAverageBaseReturnPct:
      metrics.missingAsLossAverageBaseReturnPct ?? null,
    missingAsLossAverageStressReturnPct:
      metrics.missingAsLossAverageStressReturnPct ?? null,
    largestWinningFrameShare: metrics.largestWinningFrameShare ?? null,
  };
}

export function summarizeGeckoTerminalHeartbeatArm(arm) {
  return {
    candidateForecasts: arm.candidateForecasts ?? null,
    readyForecasts: arm.readyForecasts ?? null,
    blockedForecasts: arm.blockedForecasts ?? null,
    openOutcomes: arm.openOutcomes ?? null,
    maturedForecastCount: arm.maturedForecastCount ?? null,
    resolvedOutcomes: arm.resolvedOutcomes ?? null,
    unrecordedMaturedOutcomes: arm.unrecordedMaturedOutcomes ?? null,
    outcomeIdentityMismatches: arm.outcomeIdentityMismatches ?? null,
    evaluatedObservedOutcomes: arm.evaluatedObservedOutcomes ?? null,
    paperObservedOutcomes: arm.paperObservedOutcomes ?? null,
    missedOutcomes: arm.missedOutcomes ?? null,
    resolvedCoverage: arm.resolvedCoverage ?? null,
    forecastAvailabilityCoverage: arm.forecastAvailabilityCoverage ?? null,
    independentHourlyFrames: arm.independentHourlyFrames ?? null,
    independentEvaluatedFrames: arm.independentEvaluatedFrames ?? null,
    independentTradedFrames: arm.independentTradedFrames ?? null,
    averageBaseReturnPct: arm.averageBaseReturnPct ?? null,
    averageStressReturnPct: arm.averageStressReturnPct ?? null,
    missingAsLossAverageBaseReturnPct:
      arm.missingAsLossAverageBaseReturnPct ?? null,
    missingAsLossAverageStressReturnPct:
      arm.missingAsLossAverageStressReturnPct ?? null,
    missingAsLossSensitivityGate: arm.missingAsLossSensitivityGate ?? null,
    chronologicalHalfValidationGate:
      arm.chronologicalHalfValidationGate ?? null,
    statisticalCandidateGate: arm.statisticalCandidateGate ?? null,
  };
}

export function summarizeGeckoTerminalHeartbeatCliResult(result) {
  return {
    ...result,
    actionResults: Object.fromEntries(Object.entries(result.actionResults ?? {}).map(
      ([action, actionResult]) => [action, compactHeartbeatActionResult(actionResult)],
    )),
  };
}

function compactHeartbeatActionResult(result) {
  if (!result || typeof result !== "object") return result;
  const compact = { ...result };
  const emittedEventArrays = {};
  for (const [field, values] of Object.entries(result)) {
    if (!Array.isArray(values)
      || !values.length
      || !values.every((value) => value && typeof value === "object" && value.id)) continue;
    emittedEventArrays[field] = {
      count: values.length,
      firstId: values[0].id,
      lastId: values.at(-1).id,
    };
    delete compact[field];
  }
  if (Object.keys(emittedEventArrays).length) compact.emittedEventArrays = emittedEventArrays;
  return pruneNullishCliFields(compact);
}

function pruneNullishCliFields(value) {
  if (Array.isArray(value)) return value.map(pruneNullishCliFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined)
    .map(([field, fieldValue]) => [field, pruneNullishCliFields(fieldValue)]));
}

function heartbeatResult({
  status,
  phase,
  startedAt,
  dueState = null,
  actionOrder,
  actionResults,
}) {
  return {
    status,
    phaseMinuteModulo: phase.minuteModulo,
    scheduledSecond: phase.startSecond,
    startedAt: startedAt.toISOString(),
    dueState,
    actionOrder,
    providerRequestsAttempted: Object.values(actionResults).reduce((sum, result) => (
      sum + (result?.requestsAttempted ?? 0)
    ), 0),
    actionResults,
    researchOnly: true,
    mutationAllowed: false,
    tradingAuthority: false,
  };
}

function actionLabel(actionName) {
  return actionName.replaceAll(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Expected a valid heartbeat timestamp.");
  return date;
}

async function verifiedEvents(ledgerPath) {
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) {
    throw new Error(`Ledger verification failed: ${verification.errors.join("; ")}`);
  }
  return events;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--ledger") options.ledgerPath = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    console.log(JSON.stringify(
      summarizeGeckoTerminalHeartbeatCliResult(
        await runGeckoTerminalHeartbeatPhase(parseArgs(process.argv)),
      ),
      null,
      2,
    ));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
