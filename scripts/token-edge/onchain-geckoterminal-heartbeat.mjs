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
  buildGeckoTerminalNewPoolDelayedShadowScorecard,
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
  for (const actionName of ["resolveGeneric", "resolveJupiter"]) {
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
    if (!insidePhaseWindow(validDate(clock()), phase, scheduledMinuteStartedAtMs)) {
      return heartbeatResult({
        status: "phase-ended-lower-priority-skipped",
        phase,
        startedAt,
        dueState,
        actionOrder,
        actionResults,
      });
    }
    const result = await actions[actionName](options);
    const label = actionLabel(actionName);
    actionOrder.push(label);
    actionResults[label] = result;
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
  return {
    ledgerPath,
    genericDue: genericDue.length,
    jupiterDue: jupiterDue.length,
    genericWindowClosesAt: earliestWindowClose(genericDue),
    jupiterWindowClosesAt: earliestWindowClose(jupiterDue),
  };
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
  if (!due.length) return [];
  const remainingMs = Math.min(...due.map(({ closesAt }) => closesAt)) - now.getTime();
  if (remainingMs > EMERGENCY_EXACT_WINDOW_REMAINING_MS) return [];
  return due.sort((left, right) => (
    left.closesAt - right.closesAt || left.tiePriority - right.tiePriority
  )).map(({ actionName }) => actionName);
}

function exactResolverUsedProviderOrRecordedOutcome(actionResults) {
  return ["resolve-generic", "resolve-jupiter"].some((label) => {
    const result = actionResults[label];
    return (result?.requestsAttempted ?? 0) > 0
      || (result?.recordedResolutions ?? 0) > 0;
  });
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

async function buildHeartbeatScoreSummary(options) {
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
    buildGeckoTerminalNewPoolForecastAbScorecard(events),
    buildGeckoTerminalNewPoolForecastPostsRescueScorecard(events),
  ];
  return {
    ledgerPath,
    requestsAttempted: 0,
    verification: verifyLedger(events),
    scorecards: scorecards.map(scorecardSummary),
  };
}

function scorecardSummary(scorecard) {
  return {
    type: scorecard.type,
    candidateForecasts: scorecard.candidateForecasts ?? null,
    candidateDecisions: scorecard.candidateDecisions ?? null,
    candidateOutcomes: scorecard.candidateOutcomes ?? null,
    observedOutcomes: scorecard.observedOutcomes ?? null,
    missedOutcomes: scorecard.missedOutcomes ?? null,
    eligibleLiveObservations: scorecard.eligibleLiveObservations ?? null,
    independentHourlyFrames: scorecard.independentHourlyFrames ?? null,
    portfolioAverageCapacityReturnPct:
      scorecard.portfolioAverageCapacityReturnPct ?? null,
    stressPortfolioAverageCapacityReturnPct:
      scorecard.stressPortfolioAverageCapacityReturnPct ?? null,
    evidenceStatus: scorecard.evidenceStatus ?? null,
    statisticalCandidateGate: scorecard.statisticalCandidateGate ?? false,
    promotionAuthority: scorecard.promotionAuthority ?? false,
    provisionalGate: scorecard.provisionalGate ?? false,
  };
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
      await runGeckoTerminalHeartbeatPhase(parseArgs(process.argv)),
      null,
      2,
    ));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
