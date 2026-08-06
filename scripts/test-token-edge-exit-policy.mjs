#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendLedgerEvent,
  createChallengerRegistrationEvents,
  createForecastEvents,
  createSnapshotEvent,
  readLedger,
  verifyLedger,
} from "./token-edge/onchain-forward-core.mjs";
import { createExecutionPolicyRegistrationEvents } from "./token-edge/onchain-capacity-scorecard.mjs";
import { DEX_EARLY_SURFACE_RULE } from "./token-edge/onchain-dex-early-rule.mjs";
import {
  TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY,
  TOKEN_EDGE_24H_TAIL_STOP_POLICY,
  TOKEN_EDGE_DEX_CONFIRMED_TAKE_PROFIT_POLICY,
  TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY,
  TOKEN_EDGE_EXIT_POLICY,
  TOKEN_EDGE_DEX_TAIL_STOP_POLICY,
  TOKEN_EDGE_PARTIAL_TRIM_POLICY,
  TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY,
  TOKEN_EDGE_TAIL_STOP_POLICY,
  buildAsymmetricBracketPolicyScorecard,
  build24hTailStopPolicyScorecard,
  buildDexConfirmedTakeProfitPolicyScorecard,
  buildDexTakeProfitPolicyScorecard,
  buildDexTailStopPolicyScorecard,
  buildExitPolicyScorecard,
  buildPartialTrimPolicyScorecard,
  buildOvershootPreservePolicyScorecard,
  buildTailStopPolicyScorecard,
  createAsymmetricBracketPolicyRegistrationEvent,
  create24hTailStopPolicyRegistrationEvent,
  createDexConfirmedTakeProfitPolicyRegistrationEvent,
  createDexTakeProfitPolicyRegistrationEvent,
  createDexTailStopPolicyRegistrationEvent,
  createExitPolicyRegistrationEvent,
  createPartialTrimPolicyRegistrationEvent,
  createOvershootPreservePolicyRegistrationEvent,
  createTailStopPolicyRegistrationEvent,
  requiredTailWinnerGrossReturnPct,
  registerAsymmetricBracketPolicy,
  register24hTailStopPolicy,
  registerDexConfirmedTakeProfitPolicy,
  registerDexTakeProfitPolicy,
  registerDexTailStopPolicy,
  registerExitPolicy,
  registerPartialTrimPolicy,
  registerOvershootPreservePolicy,
  registerTailStopPolicy,
} from "./token-edge/onchain-exit-policy-scorecard.mjs";

const directory = await mkdtemp(path.join(os.tmpdir(), "token-edge-exit-policy-"));
const ledgerPath = path.join(directory, "ledger.jsonl");
const execution = createExecutionPolicyRegistrationEvents(
  new Date("2026-08-03T08:34:00.000Z"),
)[0];
const exitRegistration = createExitPolicyRegistrationEvent(
  new Date("2026-08-03T08:34:10.000Z"),
);
await appendLedgerEvent(ledgerPath, execution);
await appendLedgerEvent(ledgerPath, exitRegistration);

await appendCohort({
  ledgerPath,
  execution,
  id: "pre",
  tokenAddress: "PreBoundaryMint111",
  createdAt: "2026-08-03T08:33:00.000Z",
  finalGrossReturnPct: 100,
  paths: [{ observedAt: "2026-08-03T08:40:00.000Z", grossReturnPct: 80 }],
});
await appendCohort({
  ledgerPath,
  execution,
  id: "hit",
  tokenAddress: "HitMint111",
  createdAt: "2026-08-03T08:35:00.000Z",
  finalGrossReturnPct: 2,
  paths: [
    { observedAt: "2026-08-03T08:44:00.000Z", grossReturnPct: 5 },
    { observedAt: "2026-08-03T08:46:00.000Z", grossReturnPct: 99, pairAddress: "WrongPair" },
    { observedAt: "2026-08-03T08:50:00.000Z", grossReturnPct: 12 },
    { observedAt: "2026-08-03T09:36:00.000Z", grossReturnPct: 50 },
  ],
});
await appendCohort({
  ledgerPath,
  execution,
  id: "hold",
  tokenAddress: "HoldMint111",
  createdAt: "2026-08-03T09:40:00.000Z",
  finalGrossReturnPct: -2,
  paths: [{ observedAt: "2026-08-03T09:55:00.000Z", grossReturnPct: 8 }],
});

const events = await readLedger(ledgerPath);
assert.deepEqual(verifyLedger(events), { ok: true, errors: [], eventCount: events.length });
const scorecard = buildExitPolicyScorecard(events);
assert.equal(scorecard.policyVersion, TOKEN_EDGE_EXIT_POLICY.policyVersion);
assert.equal(scorecard.registrationId, exitRegistration.id);
assert.equal(scorecard.observations, 2);
assert.equal(scorecard.independentFrames, 2);
assert.equal(scorecard.uniqueTokens, 2);
assert.equal(scorecard.takeProfitExits, 1);
assert.equal(scorecard.fixedHorizonExits, 1);
assert.equal(scorecard.exclusionCounts["not-strictly-future"], 1);
assert.equal(scorecard.pathExclusionCounts["path-market-evidence-mismatch"], 1);
assert.equal(scorecard.pathExclusionCounts["path-outside-forecast-window"], 1);
assert.equal(scorecard.provisionalGate, false);
assert.equal(scorecard.evidenceStatus, "collecting");
assert.ok(scorecard.policyFrameMeanNetReturnPct > scorecard.baselineFrameMeanNetReturnPct);
const hit = scorecard.observationsDetail.find((row) => row.forecastId === "forecast-hit");
assert.equal(hit.exitSource, "live-path-take-profit");
assert.equal(hit.exitObservedAt, "2026-08-03T08:50:00.000Z");
assert.equal(hit.exitGrossReturnPct, 12);
const hold = scorecard.observationsDetail.find((row) => row.forecastId === "forecast-hold");
assert.equal(hold.exitSource, "fixed-one-hour-outcome");
assert.equal(hold.exitGrossReturnPct, -2);

const forgedPathReturn = events.map((event) => (
  event.id === "path-hit-2" ? { ...event, grossReturnFromEntryPct: 20 } : event
));
const forgedPathScorecard = buildExitPolicyScorecard(forgedPathReturn);
const forgedPathHit = forgedPathScorecard.observationsDetail.find((row) => (
  row.forecastId === "forecast-hit"
));
assert.equal(forgedPathHit.exitSource, "fixed-one-hour-outcome");
assert.equal(forgedPathHit.exitGrossReturnPct, 2);
assert.equal(forgedPathScorecard.pathExclusionCounts["path-return-mismatch"], 1);

const missingSourceLineage = events.map((event) => (
  event.id === "forecast-hit" ? { ...event, selectionDiscoveryEventId: "missing" } : event
));
const missingSourceScorecard = buildExitPolicyScorecard(missingSourceLineage);
assert.equal(missingSourceScorecard.observations, 1);
assert.equal(missingSourceScorecard.exclusionCounts["invalid-source-lineage"], 1);

const forgedExecutionLink = events.map((event) => (
  event.id === "forecast-hit" ? { ...event, executionPolicyRegistrationId: "forged" } : event
));
const forgedExecutionScorecard = buildExitPolicyScorecard(forgedExecutionLink);
assert.equal(forgedExecutionScorecard.observations, 1);
assert.equal(forgedExecutionScorecard.exclusionCounts["invalid-execution-policy-link"], 1);

const horizonDriftedOutcome = events.map((event) => {
  if (event.id !== "resolution-hit") return event;
  const observedAt = new Date(Date.parse(event.dueAt) + 6 * 60_000).toISOString();
  return {
    ...event,
    observedAt,
    executionEvidence: { ...event.executionEvidence, exitMarketObservedAt: observedAt },
  };
});
const horizonDriftedScorecard = buildExitPolicyScorecard(horizonDriftedOutcome);
assert.equal(horizonDriftedScorecard.observations, 1);
assert.equal(horizonDriftedScorecard.exclusionCounts["live-resolution-horizon-drift"], 1);

const tampered = events.map((event) => (
  event.id === exitRegistration.id ? { ...event, takeProfitGrossReturnPctInclusive: 9 } : event
));
const tamperedScorecard = buildExitPolicyScorecard(tampered);
assert.equal(tamperedScorecard.registrationId, null);
assert.equal(tamperedScorecard.observations, 0);
assert.ok(tamperedScorecard.exclusionCounts["missing-frozen-registration"] >= 1);

const forgedRegistrationId = events.map((event) => (
  event.id === exitRegistration.id ? { ...event, id: "forged-exit-policy-registration" } : event
));
assert.equal(buildExitPolicyScorecard(forgedRegistrationId).registrationId, null);

const registerDirectory = await mkdtemp(path.join(os.tmpdir(), "token-edge-exit-register-"));
const registerLedger = path.join(registerDirectory, "ledger.jsonl");
const first = await registerExitPolicy({ ledgerPath: registerLedger }, {
  now: new Date("2026-08-03T08:36:00.000Z"),
});
const second = await registerExitPolicy({ ledgerPath: registerLedger }, {
  now: new Date("2026-08-03T08:37:00.000Z"),
});
assert.equal(first.status, "registered");
assert.equal(second.status, "existing");
assert.equal(first.registrationId, second.registrationId);
assert.equal((await readLedger(registerLedger)).length, 1);

assert.equal(requiredTailWinnerGrossReturnPct({
  winRate: 0.2,
  stopLossGrossReturnPct: -10,
  roundTripCostPct: 4,
}), 60);

const tailDirectory = await mkdtemp(path.join(os.tmpdir(), "token-edge-tail-stop-"));
const tailLedger = path.join(tailDirectory, "ledger.jsonl");
const tailExecution = createExecutionPolicyRegistrationEvents(
  new Date("2026-08-03T11:34:01.000Z"),
)[0];
const tailRegistration = createTailStopPolicyRegistrationEvent(
  new Date("2026-08-03T11:34:10.000Z"),
);
await appendLedgerEvent(tailLedger, tailExecution);
await appendLedgerEvent(tailLedger, tailRegistration);
await appendCohort({
  ledgerPath: tailLedger,
  execution: tailExecution,
  id: "tail-loss",
  tokenAddress: "TailLossMint111",
  createdAt: "2026-08-03T11:35:00.000Z",
  finalGrossReturnPct: -40,
  paths: completePaths("2026-08-03T11:35:00.000Z", [-2, -6, -11, -15, -20, -24, -28, -31, -34, -37, -39]),
});
await appendCohort({
  ledgerPath: tailLedger,
  execution: tailExecution,
  id: "tail-winner",
  tokenAddress: "TailWinnerMint111",
  createdAt: "2026-08-03T12:40:00.000Z",
  finalGrossReturnPct: 80,
  paths: completePaths("2026-08-03T12:40:00.000Z", [5, 12, 20, 28, 35, 43, 50, 57, 64, 70, 76]),
});
await appendCohort({
  ledgerPath: tailLedger,
  execution: tailExecution,
  id: "tail-recovery",
  tokenAddress: "TailRecoveryMint111",
  createdAt: "2026-08-03T13:45:00.000Z",
  finalGrossReturnPct: 30,
  paths: completePaths("2026-08-03T13:45:00.000Z", [-4, -12, -7, 0, 5, 10, 14, 18, 22, 25, 28]),
});
await appendCohort({
  ledgerPath: tailLedger,
  execution: tailExecution,
  id: "tail-incomplete",
  tokenAddress: "TailIncompleteMint111",
  createdAt: "2026-08-03T14:50:00.000Z",
  finalGrossReturnPct: -50,
  paths: [{ observedAt: "2026-08-03T14:55:00.000Z", grossReturnPct: -20 }],
});

const tailEvents = await readLedger(tailLedger);
const tailScorecard = buildTailStopPolicyScorecard(tailEvents);
assert.equal(tailScorecard.policyVersion, TOKEN_EDGE_TAIL_STOP_POLICY.policyVersion);
assert.equal(tailScorecard.registrationId, tailRegistration.id);
assert.equal(tailScorecard.observations, 3);
assert.equal(tailScorecard.independentFrames, 3);
assert.equal(tailScorecard.stopLossExits, 2);
assert.equal(tailScorecard.fixedHorizonExits, 1);
assert.equal(tailScorecard.pathExclusionCounts["insufficient-path-marks"], 1);
assert.equal(tailScorecard.provisionalGate, false);
const stoppedLoss = tailScorecard.observationsDetail.find((row) => (
  row.forecastId === "forecast-tail-loss"
));
assert.equal(stoppedLoss.exitSource, "live-path-stop-loss");
assert.equal(stoppedLoss.exitGrossReturnPct, -11);
const uncappedWinner = tailScorecard.observationsDetail.find((row) => (
  row.forecastId === "forecast-tail-winner"
));
assert.equal(uncappedWinner.exitSource, "fixed-one-hour-outcome");
assert.equal(uncappedWinner.exitGrossReturnPct, 80);
const stoppedRecovery = tailScorecard.observationsDetail.find((row) => (
  row.forecastId === "forecast-tail-recovery"
));
assert.equal(stoppedRecovery.exitGrossReturnPct, -12);

const tailTamper = tailEvents.map((event) => (
  event.id === tailRegistration.id ? { ...event, stopLossGrossReturnPctInclusive: -9 } : event
));
assert.equal(buildTailStopPolicyScorecard(tailTamper).registrationId, null);

const tailRegisterDirectory = await mkdtemp(path.join(os.tmpdir(), "token-edge-tail-register-"));
const tailRegisterLedger = path.join(tailRegisterDirectory, "ledger.jsonl");
const firstTail = await registerTailStopPolicy({ ledgerPath: tailRegisterLedger }, {
  now: new Date("2026-08-03T11:34:20.000Z"),
});
const secondTail = await registerTailStopPolicy({ ledgerPath: tailRegisterLedger }, {
  now: new Date("2026-08-03T11:34:30.000Z"),
});
assert.equal(firstTail.status, "registered");
assert.equal(secondTail.status, "existing");
assert.equal(firstTail.registrationId, secondTail.registrationId);
assert.equal((await readLedger(tailRegisterLedger)).length, 1);

assert.equal(
  TOKEN_EDGE_DEX_TAIL_STOP_POLICY.sourceModelVersion,
  "frozen-onchain-rank-v11-dex-early-surface",
);
assert.equal(TOKEN_EDGE_DEX_TAIL_STOP_POLICY.sourceCandidateId, "dex-early-surface-rise");
assert.equal(TOKEN_EDGE_DEX_TAIL_STOP_POLICY.selectionProvider, "dexscreener-early-surface");
assert.equal(TOKEN_EDGE_DEX_TAIL_STOP_POLICY.selectionTimeframe, "5m");
const dexTailDirectory = await mkdtemp(path.join(os.tmpdir(), "token-edge-dex-tail-register-"));
const dexTailLedger = path.join(dexTailDirectory, "ledger.jsonl");
const firstDexTail = await registerDexTailStopPolicy({ ledgerPath: dexTailLedger }, {
  now: new Date("2026-08-03T12:06:20.000Z"),
});
const secondDexTail = await registerDexTailStopPolicy({ ledgerPath: dexTailLedger }, {
  now: new Date("2026-08-03T12:06:30.000Z"),
});
assert.equal(firstDexTail.status, "registered");
assert.equal(secondDexTail.status, "existing");
assert.equal(firstDexTail.registrationId, secondDexTail.registrationId);
const dexTailEvents = await readLedger(dexTailLedger);
assert.equal(dexTailEvents.length, 1);
assert.equal(
  dexTailEvents[0].id,
  createDexTailStopPolicyRegistrationEvent(new Date("2026-08-03T12:06:20.000Z")).id,
);
const emptyDexTailScorecard = buildDexTailStopPolicyScorecard(dexTailEvents);
assert.equal(emptyDexTailScorecard.policyVersion, TOKEN_EDGE_DEX_TAIL_STOP_POLICY.policyVersion);
assert.equal(emptyDexTailScorecard.registrationId, dexTailEvents[0].id);
assert.equal(emptyDexTailScorecard.observations, 0);

const dexPolicyRegistration = createDexTailStopPolicyRegistrationEvent(
  new Date("2026-08-03T12:06:20.000Z"),
);
const dexCohort = dexTailCohort(dexPolicyRegistration);
const dexTailScorecard = buildDexTailStopPolicyScorecard(dexCohort);
assert.equal(dexTailScorecard.observations, 1);
assert.equal(dexTailScorecard.stopLossExits, 1);
assert.equal(dexTailScorecard.fixedHorizonExits, 0);
assert.equal(dexTailScorecard.observationsDetail[0].exitSource, "live-path-stop-loss");
assert.equal(dexTailScorecard.observationsDetail[0].exitGrossReturnPct, -11);
const forgedDexCohort = dexCohort.map((event) => {
  if (event.type !== "forecast"
    || event.modelVersion !== "frozen-onchain-rank-v11-dex-early-surface") return event;
  const forged = structuredClone(event);
  forged.inputEvidence.dexEarlySurfaceMetrics.totalBoostAmount = 999;
  return forged;
});
const forgedDexScorecard = buildDexTailStopPolicyScorecard(forgedDexCohort);
assert.equal(forgedDexScorecard.observations, 0);
assert.equal(forgedDexScorecard.exclusionCounts["invalid-source-lineage"], 1);

assert.equal(
  TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY.takeProfitGrossReturnPctInclusive,
  TOKEN_EDGE_EXIT_POLICY.takeProfitGrossReturnPctInclusive,
);
assert.equal(
  TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY.sourceModelVersion,
  "frozen-onchain-rank-v11-dex-early-surface",
);
const dexTakeProfitDirectory = await mkdtemp(path.join(os.tmpdir(), "token-edge-dex-take-profit-"));
const dexTakeProfitLedger = path.join(dexTakeProfitDirectory, "ledger.jsonl");
await assert.rejects(
  registerDexTakeProfitPolicy({ ledgerPath: dexTakeProfitLedger }, {
    now: new Date(TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY.evidenceBoundary),
  }),
  /strictly after its evidence boundary/,
);
const firstDexTakeProfit = await registerDexTakeProfitPolicy({
  ledgerPath: dexTakeProfitLedger,
}, { now: new Date("2026-08-03T17:49:20.000Z") });
const secondDexTakeProfit = await registerDexTakeProfitPolicy({
  ledgerPath: dexTakeProfitLedger,
}, { now: new Date("2026-08-03T17:49:30.000Z") });
assert.equal(firstDexTakeProfit.status, "registered");
assert.equal(secondDexTakeProfit.status, "existing");
assert.equal(firstDexTakeProfit.registrationId, secondDexTakeProfit.registrationId);
const dexTakeProfitRegistration = createDexTakeProfitPolicyRegistrationEvent(
  new Date("2026-08-03T17:49:20.000Z"),
);
const dexTakeProfitCohort = dexTailCohort(dexTakeProfitRegistration, {
  createdAt: "2026-08-03T17:50:00.000Z",
  id: "dex-take-profit",
  tokenAddress: "DexTakeProfitMint111",
  pathGrossReturns: [2, 12, 8, 4, 0, -5, -10, -15, -20, -25, -30],
  finalGrossReturnPct: -40,
});
const dexTakeProfitScorecard = buildDexTakeProfitPolicyScorecard(dexTakeProfitCohort);
assert.equal(dexTakeProfitScorecard.registrationId, dexTakeProfitRegistration.id);
assert.equal(dexTakeProfitScorecard.observations, 1);
assert.equal(dexTakeProfitScorecard.takeProfitExits, 1);
assert.equal(dexTakeProfitScorecard.observationsDetail[0].exitSource, "live-path-take-profit");
assert.equal(dexTakeProfitScorecard.observationsDetail[0].exitGrossReturnPct, 12);
assert.ok(
  dexTakeProfitScorecard.observationsDetail[0].policyNetReturnPct
    > dexTakeProfitScorecard.observationsDetail[0].baselineNetReturnPct,
);
const tamperedDexTakeProfit = dexTakeProfitCohort.map((event) => (
  event.id === dexTakeProfitRegistration.id
    ? { ...event, takeProfitGrossReturnPctInclusive: 9 }
    : event
));
assert.equal(buildDexTakeProfitPolicyScorecard(tamperedDexTakeProfit).registrationId, null);

assert.equal(
  TOKEN_EDGE_DEX_CONFIRMED_TAKE_PROFIT_POLICY.takeProfitGrossReturnPctInclusive,
  TOKEN_EDGE_DEX_TAKE_PROFIT_POLICY.takeProfitGrossReturnPctInclusive,
);
const dexConfirmedDirectory = await mkdtemp(path.join(
  os.tmpdir(),
  "token-edge-dex-confirmed-take-profit-",
));
const dexConfirmedLedger = path.join(dexConfirmedDirectory, "ledger.jsonl");
await assert.rejects(
  registerDexConfirmedTakeProfitPolicy({ ledgerPath: dexConfirmedLedger }, {
    now: new Date(TOKEN_EDGE_DEX_CONFIRMED_TAKE_PROFIT_POLICY.evidenceBoundary),
  }),
  /strictly after its evidence boundary/,
);
const firstDexConfirmed = await registerDexConfirmedTakeProfitPolicy({
  ledgerPath: dexConfirmedLedger,
}, { now: new Date("2026-08-03T18:26:00.000Z") });
const secondDexConfirmed = await registerDexConfirmedTakeProfitPolicy({
  ledgerPath: dexConfirmedLedger,
}, { now: new Date("2026-08-03T18:26:10.000Z") });
assert.equal(firstDexConfirmed.status, "registered");
assert.equal(secondDexConfirmed.status, "existing");
assert.equal(firstDexConfirmed.registrationId, secondDexConfirmed.registrationId);
const dexConfirmedRegistration = createDexConfirmedTakeProfitPolicyRegistrationEvent(
  new Date("2026-08-03T18:26:00.000Z"),
);
const transientSpikeCohort = dexTailCohort(dexConfirmedRegistration, {
  createdAt: "2026-08-03T18:27:00.000Z",
  id: "dex-transient-spike",
  tokenAddress: "DexTransientSpikeMint111",
  pathGrossReturns: [2, 1_450, -33, -20, -15, -10, -8, -6, -4, -2, -1],
  finalGrossReturnPct: -5,
});
const transientSpikeScorecard = buildDexConfirmedTakeProfitPolicyScorecard(
  transientSpikeCohort,
);
assert.equal(transientSpikeScorecard.observations, 1);
assert.equal(transientSpikeScorecard.confirmedTakeProfitExits, 0);
assert.equal(
  transientSpikeScorecard.observationsDetail[0].exitSource,
  "fixed-one-hour-outcome",
);
assert.equal(transientSpikeScorecard.observationsDetail[0].exitGrossReturnPct, -5);
const persistentThresholdCohort = dexTailCohort(dexConfirmedRegistration, {
  createdAt: "2026-08-03T18:27:00.000Z",
  id: "dex-persistent-threshold",
  tokenAddress: "DexPersistentThresholdMint111",
  pathGrossReturns: [2, 12, 14, 8, 4, 0, -2, -4, -6, -8, -10],
  finalGrossReturnPct: -20,
});
const persistentThresholdScorecard = buildDexConfirmedTakeProfitPolicyScorecard(
  persistentThresholdCohort,
);
assert.equal(persistentThresholdScorecard.observations, 1);
assert.equal(persistentThresholdScorecard.confirmedTakeProfitExits, 1);
assert.equal(
  persistentThresholdScorecard.observationsDetail[0].exitSource,
  "live-path-confirmed-take-profit",
);
assert.equal(persistentThresholdScorecard.observationsDetail[0].exitGrossReturnPct, 14);

const trimDirectory = await mkdtemp(path.join(os.tmpdir(), "token-edge-partial-trim-"));
const trimLedger = path.join(trimDirectory, "ledger.jsonl");
const trimExecution = createExecutionPolicyRegistrationEvents(
  new Date("2026-08-03T13:08:01.000Z"),
)[0];
const trimRegistration = createPartialTrimPolicyRegistrationEvent(
  new Date("2026-08-03T13:08:10.000Z"),
);
await appendLedgerEvent(trimLedger, trimExecution);
await appendLedgerEvent(trimLedger, exitRegistration);
await appendLedgerEvent(trimLedger, trimRegistration);
await appendCohort({
  ledgerPath: trimLedger,
  execution: trimExecution,
  id: "trim-winner",
  tokenAddress: "TrimWinnerMint111",
  createdAt: "2026-08-03T13:09:00.000Z",
  finalGrossReturnPct: 80,
  paths: [{ observedAt: "2026-08-03T13:19:00.000Z", grossReturnPct: 12 }],
});
await appendCohort({
  ledgerPath: trimLedger,
  execution: trimExecution,
  id: "trim-reversal",
  tokenAddress: "TrimReversalMint111",
  createdAt: "2026-08-03T14:14:00.000Z",
  finalGrossReturnPct: -20,
  paths: [{ observedAt: "2026-08-03T14:24:00.000Z", grossReturnPct: 12 }],
});
await appendCohort({
  ledgerPath: trimLedger,
  execution: trimExecution,
  id: "trim-hold",
  tokenAddress: "TrimHoldMint111",
  createdAt: "2026-08-03T15:19:00.000Z",
  finalGrossReturnPct: 5,
  paths: [{ observedAt: "2026-08-03T15:29:00.000Z", grossReturnPct: 8 }],
});
const trimEvents = await readLedger(trimLedger);
const trimScorecard = buildPartialTrimPolicyScorecard(trimEvents);
const allAtTriggerScorecard = buildExitPolicyScorecard(trimEvents);
assert.equal(trimScorecard.policyVersion, TOKEN_EDGE_PARTIAL_TRIM_POLICY.policyVersion);
assert.equal(trimScorecard.registrationId, trimRegistration.id);
assert.equal(trimScorecard.observations, 3);
assert.equal(trimScorecard.independentFrames, 3);
assert.equal(trimScorecard.uniqueTokens, 3);
assert.equal(trimScorecard.trimExits, 2);
assert.equal(trimScorecard.fixedHorizonExits, 1);
assert.equal(trimScorecard.provisionalGate, false);
const trimmedWinner = trimScorecard.observationsDetail.find((row) => (
  row.forecastId === "forecast-trim-winner"
));
const allAtTriggerWinner = allAtTriggerScorecard.observationsDetail.find((row) => (
  row.forecastId === "forecast-trim-winner"
));
assert.equal(trimmedWinner.exitSource, "live-path-half-trim");
assert.equal(trimmedWinner.trimFraction, 0.5);
assert.equal(trimmedWinner.trimGrossReturnPct, 12);
assert.equal(trimmedWinner.remainderGrossReturnPct, 80);
assert.ok(trimmedWinner.policyNetReturnPct > allAtTriggerWinner.policyNetReturnPct);
assert.ok(trimmedWinner.policyNetReturnPct < trimmedWinner.baselineNetReturnPct);
const trimmedReversal = trimScorecard.observationsDetail.find((row) => (
  row.forecastId === "forecast-trim-reversal"
));
const allAtTriggerReversal = allAtTriggerScorecard.observationsDetail.find((row) => (
  row.forecastId === "forecast-trim-reversal"
));
assert.ok(trimmedReversal.policyNetReturnPct > trimmedReversal.baselineNetReturnPct);
assert.ok(trimmedReversal.policyNetReturnPct < allAtTriggerReversal.policyNetReturnPct);
const untrimmed = trimScorecard.observationsDetail.find((row) => (
  row.forecastId === "forecast-trim-hold"
));
assert.equal(untrimmed.exitSource, "fixed-one-hour-outcome");
assert.equal(untrimmed.trimFraction, null);
assert.equal(untrimmed.policyNetReturnPct, untrimmed.baselineNetReturnPct);

const tamperedTrimEvents = trimEvents.map((event) => (
  event.id === trimRegistration.id ? { ...event, trimFraction: 0.6 } : event
));
assert.equal(buildPartialTrimPolicyScorecard(tamperedTrimEvents).registrationId, null);

const trimRegisterDirectory = await mkdtemp(path.join(os.tmpdir(), "token-edge-trim-register-"));
const trimRegisterLedger = path.join(trimRegisterDirectory, "ledger.jsonl");
await assert.rejects(
  registerPartialTrimPolicy({ ledgerPath: trimRegisterLedger }, {
    now: new Date(TOKEN_EDGE_PARTIAL_TRIM_POLICY.evidenceBoundary),
  }),
  /strictly after its evidence boundary/,
);
const firstTrim = await registerPartialTrimPolicy({ ledgerPath: trimRegisterLedger }, {
  now: new Date("2026-08-03T13:08:20.000Z"),
});
const secondTrim = await registerPartialTrimPolicy({ ledgerPath: trimRegisterLedger }, {
  now: new Date("2026-08-03T13:08:30.000Z"),
});
assert.equal(firstTrim.status, "registered");
assert.equal(secondTrim.status, "existing");
assert.equal(firstTrim.registrationId, secondTrim.registrationId);
assert.equal((await readLedger(trimRegisterLedger)).length, 1);

const bracketDirectory = await mkdtemp(path.join(os.tmpdir(), "token-edge-asymmetric-bracket-"));
const bracketLedger = path.join(bracketDirectory, "ledger.jsonl");
const bracketExecution = createExecutionPolicyRegistrationEvents(
  new Date("2026-08-03T14:36:16.000Z"),
)[0];
const bracketRegistration = createAsymmetricBracketPolicyRegistrationEvent(
  new Date("2026-08-03T14:36:20.000Z"),
);
await appendLedgerEvent(bracketLedger, bracketExecution);
await appendLedgerEvent(bracketLedger, bracketRegistration);
await appendCohort({
  ledgerPath: bracketLedger,
  execution: bracketExecution,
  id: "bracket-loss",
  tokenAddress: "BracketLossMint111",
  createdAt: "2026-08-03T14:37:00.000Z",
  finalGrossReturnPct: -40,
  paths: completePaths("2026-08-03T14:37:00.000Z", [-2, -11, -15, -20, -24, -28, -31, -34, -37, -39, -40]),
});
await appendCohort({
  ledgerPath: bracketLedger,
  execution: bracketExecution,
  id: "bracket-winner",
  tokenAddress: "BracketWinnerMint111",
  createdAt: "2026-08-03T15:42:00.000Z",
  finalGrossReturnPct: 80,
  paths: completePaths("2026-08-03T15:42:00.000Z", [5, 12, 20, 28, 35, 43, 50, 57, 64, 70, 76]),
});
const bracketEvents = await readLedger(bracketLedger);
const bracketScorecard = buildAsymmetricBracketPolicyScorecard(bracketEvents);
assert.equal(bracketScorecard.policyVersion, TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY.policyVersion);
assert.equal(bracketScorecard.registrationId, bracketRegistration.id);
assert.equal(bracketScorecard.observations, 2);
assert.equal(bracketScorecard.stopLossExits, 1);
assert.equal(bracketScorecard.trimExits, 1);
assert.equal(bracketScorecard.fixedHorizonExits, 0);
const bracketLoss = bracketScorecard.observationsDetail.find((row) => (
  row.forecastId === "forecast-bracket-loss"
));
assert.equal(bracketLoss.exitSource, "live-path-stop-loss");
assert.equal(bracketLoss.exitGrossReturnPct, -11);
assert.equal(bracketLoss.trimFraction, null);
const bracketWinner = bracketScorecard.observationsDetail.find((row) => (
  row.forecastId === "forecast-bracket-winner"
));
assert.equal(bracketWinner.exitSource, "live-path-half-trim");
assert.equal(bracketWinner.exitGrossReturnPct, 12);
assert.equal(bracketWinner.trimFraction, 0.5);
assert.equal(bracketWinner.remainderGrossReturnPct, 80);
assert.ok(bracketScorecard.policyFrameMeanNetReturnPct > 0);

const tamperedBracketEvents = bracketEvents.map((event) => (
  event.id === bracketRegistration.id ? { ...event, trimFraction: 0.6 } : event
));
assert.equal(buildAsymmetricBracketPolicyScorecard(tamperedBracketEvents).registrationId, null);
const bracketRegisterDirectory = await mkdtemp(path.join(os.tmpdir(), "token-edge-bracket-register-"));
const bracketRegisterLedger = path.join(bracketRegisterDirectory, "ledger.jsonl");
await assert.rejects(
  registerAsymmetricBracketPolicy({ ledgerPath: bracketRegisterLedger }, {
    now: new Date(TOKEN_EDGE_ASYMMETRIC_BRACKET_POLICY.evidenceBoundary),
  }),
  /strictly after its evidence boundary/,
);
const firstBracket = await registerAsymmetricBracketPolicy({ ledgerPath: bracketRegisterLedger }, {
  now: new Date("2026-08-03T14:36:20.000Z"),
});
const secondBracket = await registerAsymmetricBracketPolicy({ ledgerPath: bracketRegisterLedger }, {
  now: new Date("2026-08-03T14:36:30.000Z"),
});
assert.equal(firstBracket.status, "registered");
assert.equal(secondBracket.status, "existing");
assert.equal(firstBracket.registrationId, secondBracket.registrationId);

const overshootDirectory = await mkdtemp(path.join(os.tmpdir(), "token-edge-overshoot-preserve-"));
const overshootLedger = path.join(overshootDirectory, "ledger.jsonl");
const overshootExecution = createExecutionPolicyRegistrationEvents(
  new Date("2026-08-03T15:05:31.000Z"),
)[0];
const overshootRegistration = createOvershootPreservePolicyRegistrationEvent(
  new Date("2026-08-03T15:05:40.000Z"),
);
await appendLedgerEvent(overshootLedger, overshootExecution);
await appendLedgerEvent(overshootLedger, overshootRegistration);
await appendCohort({
  ledgerPath: overshootLedger,
  execution: overshootExecution,
  id: "overshoot-shallow-reversal",
  tokenAddress: "OvershootShallowMint111",
  createdAt: "2026-08-03T15:06:00.000Z",
  finalGrossReturnPct: -20,
  paths: completePaths("2026-08-03T15:06:00.000Z", [5, 12, 8, 1, -5, -9, -12, -15, -18, -19, -20]),
});
await appendCohort({
  ledgerPath: overshootLedger,
  execution: overshootExecution,
  id: "overshoot-strong-winner",
  tokenAddress: "OvershootStrongMint111",
  createdAt: "2026-08-03T16:11:00.000Z",
  finalGrossReturnPct: 80,
  paths: completePaths("2026-08-03T16:11:00.000Z", [5, 25, 15, 30, 40, 48, 55, 62, 68, 74, 78]),
});
const overshootEvents = await readLedger(overshootLedger);
const overshootScorecard = buildOvershootPreservePolicyScorecard(overshootEvents);
assert.equal(overshootScorecard.policyVersion, TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY.policyVersion);
assert.equal(overshootScorecard.registrationId, overshootRegistration.id);
assert.equal(overshootScorecard.observations, 2);
assert.equal(overshootScorecard.shallowTakeProfitExits, 1);
assert.equal(overshootScorecard.preservedTailHolds, 1);
const shallowReversal = overshootScorecard.observationsDetail.find((row) => (
  row.forecastId === "forecast-overshoot-shallow-reversal"
));
assert.equal(shallowReversal.exitSource, "live-path-shallow-take-profit");
assert.equal(shallowReversal.exitGrossReturnPct, 12);
assert.ok(shallowReversal.policyNetReturnPct > shallowReversal.baselineNetReturnPct);
const strongWinner = overshootScorecard.observationsDetail.find((row) => (
  row.forecastId === "forecast-overshoot-strong-winner"
));
assert.equal(strongWinner.exitSource, "fixed-one-hour-overshoot-preserved");
assert.equal(strongWinner.exitGrossReturnPct, 80);
assert.equal(strongWinner.policyNetReturnPct, strongWinner.baselineNetReturnPct);

const tamperedOvershootEvents = overshootEvents.map((event) => (
  event.id === overshootRegistration.id ? { ...event, overshootGrossReturnPctInclusive: 21 } : event
));
assert.equal(buildOvershootPreservePolicyScorecard(tamperedOvershootEvents).registrationId, null);
const overshootRegisterDirectory = await mkdtemp(path.join(os.tmpdir(), "token-edge-overshoot-register-"));
const overshootRegisterLedger = path.join(overshootRegisterDirectory, "ledger.jsonl");
await assert.rejects(
  registerOvershootPreservePolicy({ ledgerPath: overshootRegisterLedger }, {
    now: new Date(TOKEN_EDGE_OVERSHOOT_PRESERVE_POLICY.evidenceBoundary),
  }),
  /strictly after its evidence boundary/,
);
const firstOvershoot = await registerOvershootPreservePolicy({ ledgerPath: overshootRegisterLedger }, {
  now: new Date("2026-08-03T15:05:40.000Z"),
});
const secondOvershoot = await registerOvershootPreservePolicy({ ledgerPath: overshootRegisterLedger }, {
  now: new Date("2026-08-03T15:05:50.000Z"),
});
assert.equal(firstOvershoot.status, "registered");
assert.equal(secondOvershoot.status, "existing");
assert.equal(firstOvershoot.registrationId, secondOvershoot.registrationId);

const dayTailDirectory = await mkdtemp(path.join(os.tmpdir(), "token-edge-24h-tail-stop-"));
const dayTailLedger = path.join(dayTailDirectory, "ledger.jsonl");
const dayTailExecution = createExecutionPolicyRegistrationEvents(
  new Date("2026-08-04T04:19:50.000Z"),
)[0];
const dayTailRegistration = create24hTailStopPolicyRegistrationEvent(
  new Date("2026-08-04T04:20:00.000Z"),
);
await appendLedgerEvent(dayTailLedger, dayTailExecution);
await appendLedgerEvent(dayTailLedger, dayTailRegistration);
const dayTailCreatedAt = "2026-08-04T04:21:00.000Z";
await appendCohort({
  ledgerPath: dayTailLedger,
  execution: dayTailExecution,
  id: "day-tail-recovery",
  tokenAddress: "DayTailRecoveryMint111",
  createdAt: dayTailCreatedAt,
  horizon: "24h",
  finalGrossReturnPct: 100,
  paths: completeTenMinuteDayPaths(dayTailCreatedAt),
});
const dayTailScore = build24hTailStopPolicyScorecard(await readLedger(dayTailLedger));
assert.equal(dayTailScore.policyVersion, TOKEN_EDGE_24H_TAIL_STOP_POLICY.policyVersion);
assert.equal(dayTailScore.registrationId, dayTailRegistration.id);
assert.equal(dayTailScore.observations, 1);
assert.equal(dayTailScore.independentFrames, 1);
assert.equal(dayTailScore.stopLossExits, 1);
assert.equal(dayTailScore.observationsDetail[0].exitSource, "live-path-stop-loss");
assert.equal(dayTailScore.observationsDetail[0].exitGrossReturnPct, -12);
assert.ok(dayTailScore.policyFrameMeanNetReturnPct < 0);
await assert.rejects(register24hTailStopPolicy(
  { ledgerPath: path.join(dayTailDirectory, "boundary.jsonl") },
  { now: new Date(TOKEN_EDGE_24H_TAIL_STOP_POLICY.evidenceBoundary) },
), /strictly after its evidence boundary/);
const dayTailRegistered = await register24hTailStopPolicy(
  { ledgerPath: path.join(dayTailDirectory, "registered.jsonl") },
  { now: new Date("2026-08-04T04:20:10.000Z") },
);
const dayTailRepeated = await register24hTailStopPolicy(
  { ledgerPath: path.join(dayTailDirectory, "registered.jsonl") },
  { now: new Date("2026-08-04T04:20:20.000Z") },
);
assert.equal(dayTailRegistered.status, "registered");
assert.equal(dayTailRepeated.status, "existing");

console.log("Token-edge future-only take-profit, DEX take-profit/confirmation, 1h/24h tail-stop, partial-trim, bracket, and overshoot-preserve policy contracts pass.");

async function appendCohort(input) {
  const createdAt = new Date(input.createdAt);
  const horizon = input.horizon ?? "1h";
  const horizonMs = horizon === "24h" ? 24 * 60 * 60_000 : 60 * 60_000;
  const dueAt = new Date(createdAt.getTime() + horizonMs);
  const discoveryAt = new Date(createdAt.getTime() - 2 * 60_000).toISOString();
  const confirmationAt = new Date(createdAt.getTime() - 60_000).toISOString();
  const pairAddress = `Pair-${input.id}`;
  const discoveryId = `discovery-${input.id}`;
  const confirmationId = `confirmation-${input.id}`;
  const snapshotId = `snapshot-${input.id}`;
  const forecastId = `forecast-${input.id}`;
  await appendLedgerEvent(input.ledgerPath, {
    type: "discovery",
    id: discoveryId,
    observedAt: discoveryAt,
    availableAt: discoveryAt,
    provider: "nansen-token-screener",
    chain: "solana",
    timeframe: "6h",
    candidates: [{
      chain: "solana",
      tokenAddress: input.tokenAddress,
      status: "eligible",
      netflowUsd: 2_000,
      netflowToLiquidity: 0.04,
      buySellVolumeRatio: 2,
      priceChangePct: 0,
    }],
  });
  await appendLedgerEvent(input.ledgerPath, {
    type: "market-confirmation",
    id: confirmationId,
    observedAt: confirmationAt,
    chain: "solana",
    sourceEventId: discoveryId,
    candidates: [{
      chain: "solana",
      tokenAddress: input.tokenAddress,
      status: "eligible",
      market: { liquidityUsd: 50_000 },
    }],
  });
  await appendLedgerEvent(input.ledgerPath, {
    type: "snapshot",
    id: snapshotId,
    observedAt: input.createdAt,
    chain: "solana",
    tokenAddress: input.tokenAddress,
    cohort: "exit-policy-fixture",
    selection: {
      status: "verified",
      provider: "nansen-token-screener",
      timeframe: "6h",
      discoveryEventId: discoveryId,
      confirmationEventId: confirmationId,
      discoveryObservedAt: discoveryAt,
      discoveryAvailableAt: discoveryAt,
      confirmationObservedAt: confirmationAt,
    },
    market: {
      observedAt: input.createdAt,
      pairAddress,
      priceUsd: 1,
      liquidityUsd: 50_000,
      symbol: input.id.toUpperCase(),
    },
  });
  await appendLedgerEvent(input.ledgerPath, {
    type: "forecast",
    id: forecastId,
    snapshotId,
    createdAt: input.createdAt,
    chain: "solana",
    tokenAddress: input.tokenAddress,
    symbol: input.id.toUpperCase(),
    candidateId: "smart-money-selection",
    horizon,
    dueAt: dueAt.toISOString(),
    expiresAt: new Date(dueAt.getTime() + 30 * 60_000).toISOString(),
    status: "ready",
    blockers: [],
    modelVersion: "frozen-onchain-rank-v3",
    selectionProvider: "nansen-token-screener",
    selectionTimeframe: "6h",
    selectionDiscoveryEventId: discoveryId,
    selectionConfirmationEventId: confirmationId,
    predictedRise: true,
    roundTripCostPct: 4,
    inputEvidence: {
      provider: "nansen-token-screener",
      timeframe: "6h",
      discoveryEventId: discoveryId,
      confirmationEventId: confirmationId,
      discoveryNetflowUsd: 2_000,
      discoveryNetflowToLiquidity: 0.04,
      discoveryBuySellVolumeRatio: 2,
      discoveryPriceChangePct: 0,
      confirmedLiquidityUsd: 50_000,
    },
    executionPolicyRegistrationId: input.execution.id,
    executionPolicyRegisteredAt: input.execution.registeredAt,
    executionPolicyVersion: input.execution.policyVersion,
  });
  for (const [index, row] of input.paths.entries()) {
    await appendLedgerEvent(input.ledgerPath, {
      type: "forecast-path-observation",
      id: `path-${input.id}-${index}`,
      snapshotId,
      forecastIds: [forecastId],
      chain: "solana",
      tokenAddress: input.tokenAddress,
      symbol: input.id.toUpperCase(),
      horizon,
      signalCreatedAt: input.createdAt,
      dueAt: dueAt.toISOString(),
      bucketStartedAt: row.observedAt,
      observedAt: row.observedAt,
      observationMode: "live-point-in-time-path",
      entryMarketObservedAt: input.createdAt,
      entryPairAddress: pairAddress,
      entryPriceUsd: 1,
      entryLiquidityUsd: 50_000,
      observedPairAddress: row.pairAddress ?? pairAddress,
      observedPriceUsd: 1 + row.grossReturnPct / 100,
      observedLiquidityUsd: 50_000,
      grossReturnFromEntryPct: row.grossReturnPct,
      providerPriceIntegrity: executionIntegrity(1 + row.grossReturnPct / 100, 50_000),
      researchOnly: true,
      mutationAllowed: false,
    });
  }
  await appendLedgerEvent(input.ledgerPath, {
    type: "resolution",
    id: `resolution-${input.id}`,
    forecastId,
    snapshotId,
    modelVersion: "frozen-onchain-rank-v3",
    selectionProvider: "nansen-token-screener",
    selectionTimeframe: "6h",
    candidateId: "smart-money-selection",
    horizon,
    chain: "solana",
    tokenAddress: input.tokenAddress,
    dueAt: dueAt.toISOString(),
    observedAt: dueAt.toISOString(),
    status: "observed",
    observationMode: "live-point-in-time",
    entryPriceUsd: 1,
    observedPriceUsd: 1 + input.finalGrossReturnPct / 100,
    executionEvidence: {
      entryMarketObservedAt: input.createdAt,
      entryPairAddress: pairAddress,
      entryLiquidityUsd: 50_000,
      exitMarketObservedAt: dueAt.toISOString(),
      exitPairAddress: pairAddress,
      exitLiquidityUsd: 50_000,
    },
    grossReturnPct: input.finalGrossReturnPct,
    netReturnPct: input.finalGrossReturnPct - 4,
    predictedRise: true,
    providerPriceIntegrity: executionIntegrity(1 + input.finalGrossReturnPct / 100, 50_000),
  });
}

function completePaths(createdAt, grossReturns) {
  const start = Date.parse(createdAt);
  return grossReturns.map((grossReturnPct, index) => ({
    observedAt: new Date(start + ((index + 1) * 5 * 60_000)).toISOString(),
    grossReturnPct,
  }));
}

function completeTenMinuteDayPaths(createdAt) {
  const start = Date.parse(createdAt);
  return Array.from({ length: 143 }, (_, index) => ({
    observedAt: new Date(start + ((index + 1) * 10 * 60_000)).toISOString(),
    grossReturnPct: index === 2 ? -12 : (index < 2 ? -4 * (index + 1) : 20),
  }));
}

function dexTailCohort(policyRegistration, options = {}) {
  const createdAt = options.createdAt ?? "2026-08-03T12:07:00.000Z";
  const dueAt = new Date(Date.parse(createdAt) + 60 * 60_000).toISOString();
  const tokenAddress = options.tokenAddress ?? "DexTailMint111";
  const id = options.id ?? "dex-tail";
  const pairAddress = options.pairAddress ?? "DexTailPair111";
  const discoveryAt = new Date(Date.parse(createdAt) - 20_000).toISOString();
  const confirmationAt = new Date(Date.parse(createdAt) - 10_000).toISOString();
  const metrics = {
    sourceTypes: ["boost-latest"],
    sourceBreadth: 1,
    latestBoostAmount: 10,
    totalBoostAmount: 10,
    hasWebsite: false,
    hasTwitter: true,
    pairAgeMinutes: 120,
    discoveryLiquidityUsd: 20_000,
    marketCapUsd: 100_000,
    volumeH1Usd: 12_000,
    hourlyTurnover: 0.6,
    buySellTxnRatio: 1.5,
    priceChange1hPct: 5,
    priceChange24hPct: 20,
  };
  const discoveryCandidate = {
    chain: "solana",
    tokenAddress,
    symbol: "DEXTAIL",
    status: "eligible",
    blockers: [],
    sourceTypes: metrics.sourceTypes,
    sourceBreadth: metrics.sourceBreadth,
    latestSourceTimestamp: null,
    latestBoostAmount: metrics.latestBoostAmount,
    totalBoostAmount: metrics.totalBoostAmount,
    hasWebsite: metrics.hasWebsite,
    hasTwitter: metrics.hasTwitter,
    pairAddress,
    pairAgeMinutes: metrics.pairAgeMinutes,
    priceUsd: 1,
    liquidityUsd: metrics.discoveryLiquidityUsd,
    marketCapUsd: metrics.marketCapUsd,
    volumeH1Usd: metrics.volumeH1Usd,
    hourlyTurnover: metrics.hourlyTurnover,
    buysH1: 150,
    sellsH1: 100,
    buySellTxnRatio: metrics.buySellTxnRatio,
    priceChangeH1Pct: metrics.priceChange1hPct,
    priceChangeH24Pct: metrics.priceChange24hPct,
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
  };
  const discovery = {
    type: "discovery",
    id: `${id}-discovery`,
    provider: "dexscreener-early-surface",
    sourceAttribution: "DEX Screener public API",
    chain: "solana",
    timeframe: "5m",
    ruleVersion: DEX_EARLY_SURFACE_RULE.version,
    rule: DEX_EARLY_SURFACE_RULE,
    collectionStartedAt: "2026-08-03T12:06:39.000Z",
    availableAt: discoveryAt,
    observedAt: discoveryAt,
    candidates: [discoveryCandidate],
    researchOnly: true,
    mutationAllowed: false,
  };
  const confirmation = {
    type: "market-confirmation",
    id: `${id}-confirmation`,
    observedAt: confirmationAt,
    sourceEventId: discovery.id,
    candidates: [{
      chain: "solana",
      tokenAddress,
      status: "eligible",
      market: { liquidityUsd: 20_000 },
    }],
  };
  const snapshot = createSnapshotEvent({
    observedAt: new Date(createdAt),
    chain: "solana",
    tokenAddress,
    cohort: "dex-tail-stop-test",
    selection: {
      status: "verified",
      provider: "dexscreener-early-surface",
      timeframe: "5m",
      ruleVersion: DEX_EARLY_SURFACE_RULE.version,
      discoveryEventId: discovery.id,
      confirmationEventId: confirmation.id,
      discoveryObservedAt: discoveryAt,
      discoveryAvailableAt: discoveryAt,
      confirmationObservedAt: confirmationAt,
      metrics,
    },
    market: {
      source: "dexscreener",
      observedAt: createdAt,
      tokenAddress,
      pairAddress,
      pairUrl: "https://dexscreener.com/solana/dex-tail",
      dexId: "raydium",
      symbol: "DEXTAIL",
      priceUsd: 1,
      liquidityUsd: 20_000,
      marketCapUsd: 100_000,
      fdvUsd: 100_000,
      volumeUsd: { m5: 2_000, h1: 12_000, h6: 20_000, h24: 30_000 },
      priceChangePct: { m5: 1, h1: 5, h6: 10, h24: 20 },
      txns: {
        m5: { buys: 20, sells: 10 },
        h1: { buys: 150, sells: 100 },
        h6: { buys: 200, sells: 100 },
        h24: { buys: 300, sells: 150 },
      },
      pairCreatedAt: Date.parse(createdAt) - (120 * 60_000),
    },
  });
  const challengerRegistrations = createChallengerRegistrationEvents(
    new Date(Date.parse(createdAt) - 30_000),
  );
  const forecasts = createForecastEvents(snapshot, null, challengerRegistrations);
  const sourceForecast = structuredClone(forecasts.find((event) => (
    event.modelVersion === "frozen-onchain-rank-v11-dex-early-surface"
  )));
  const baselineForecast = forecasts.find((event) => (
    event.modelVersion === "frozen-onchain-rank-v3"
    && event.candidateId === "market-only-control"
    && event.horizon === "1h"
  ));
  const execution = createExecutionPolicyRegistrationEvents(
    new Date(Date.parse(createdAt) - 59_000),
  )[0];
  Object.assign(sourceForecast, {
    executionPolicyRegistrationId: execution.id,
    executionPolicyRegisteredAt: execution.registeredAt,
    executionPolicyVersion: execution.policyVersion,
    roundTripCostPct: execution.baseRoundTripCostPct,
  });
  const paths = completePaths(createdAt, options.pathGrossReturns
    ?? [-2, -6, -11, -15, -20, -24, -28, -31, -34, -37, -39])
    .map((row, index) => ({
      type: "forecast-path-observation",
      id: `${id}-path-${index}`,
      snapshotId: snapshot.id,
      forecastIds: [sourceForecast.id],
      chain: "solana",
      tokenAddress,
      symbol: "DEXTAIL",
      horizon: "1h",
      signalCreatedAt: createdAt,
      dueAt,
      bucketStartedAt: row.observedAt,
      observedAt: row.observedAt,
      observationMode: "live-point-in-time-path",
      entryMarketObservedAt: createdAt,
      entryPairAddress: pairAddress,
      entryPriceUsd: 1,
      entryLiquidityUsd: 20_000,
      observedPairAddress: pairAddress,
      observedPriceUsd: 1 + row.grossReturnPct / 100,
      observedLiquidityUsd: 20_000,
      grossReturnFromEntryPct: row.grossReturnPct,
      providerPriceIntegrity: executionIntegrity(1 + row.grossReturnPct / 100, 20_000),
      researchOnly: true,
      mutationAllowed: false,
    }));
  const resolution = {
    type: "resolution",
    id: `${id}-resolution`,
    forecastId: sourceForecast.id,
    snapshotId: snapshot.id,
    modelVersion: sourceForecast.modelVersion,
    selectionProvider: sourceForecast.selectionProvider,
    selectionTimeframe: sourceForecast.selectionTimeframe,
    candidateId: sourceForecast.candidateId,
    horizon: "1h",
    chain: "solana",
    tokenAddress,
    dueAt,
    observedAt: dueAt,
    status: "observed",
    observationMode: "live-point-in-time",
    entryPriceUsd: 1,
    observedPriceUsd: 1 + ((options.finalGrossReturnPct ?? -40) / 100),
    executionEvidence: {
      entryMarketObservedAt: createdAt,
      entryPairAddress: pairAddress,
      entryLiquidityUsd: 20_000,
      exitMarketObservedAt: dueAt,
      exitPairAddress: pairAddress,
      exitLiquidityUsd: 20_000,
    },
    grossReturnPct: options.finalGrossReturnPct ?? -40,
    netReturnPct: (options.finalGrossReturnPct ?? -40) - 4,
    predictedRise: true,
    providerPriceIntegrity: executionIntegrity(
      1 + ((options.finalGrossReturnPct ?? -40) / 100),
      20_000,
    ),
  };
  return [
    execution,
    ...challengerRegistrations,
    policyRegistration,
    discovery,
    confirmation,
    snapshot,
    baselineForecast,
    sourceForecast,
    ...paths,
    resolution,
  ];
}

function executionIntegrity(priceUsd, liquidityUsd) {
  return {
    ruleVersion: "token-edge-dex-execution-cross-endpoint-v1",
    tokenPairsPriceUsd: priceUsd,
    tokenBatchPriceUsd: priceUsd,
    priceRatio: 1,
    tokenPairsLiquidityUsd: liquidityUsd,
    tokenBatchLiquidityUsd: liquidityUsd,
    liquidityRatio: 1,
    selectedQuotePolicy: "lower-price-and-lower-liquidity",
  };
}
