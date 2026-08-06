#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendLedgerEvent, digestValue, readLedger, verifyLedger } from "./onchain-forward-core.mjs";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import { validatedDexSurfacePulseObservationRows } from "./onchain-dex-pulse-monitoring.mjs";
import {
  DEX_PULSE_LUNAR_CREATOR_RULE,
  passesLunarCreatorScreen,
  validatedDexPulseLunarCreatorObservationRows,
} from "./onchain-dex-pulse-lunar-monitoring.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const FROZEN_CREATOR_ACCELERATION_SCREEN = DEX_PULSE_LUNAR_CREATOR_RULE.screens.find((screen) => (
  screen.id === "distributed-creator-social-acceleration-consensus"
));
if (!FROZEN_CREATOR_ACCELERATION_SCREEN) throw new Error("Missing frozen creator-acceleration screen.");

export const DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE = Object.freeze({
  version: "dex-surface-pulse-lunar-creator-acceleration-v1",
  evidenceBoundary: "2026-08-03T20:24:45.300Z",
  sourcePulseRuleVersion: "dex-surface-pulse-monitoring-panel-v1",
  sourceCreatorRuleVersion: DEX_PULSE_LUNAR_CREATOR_RULE.version,
  sourceScreenId: FROZEN_CREATOR_ACCELERATION_SCREEN.id,
  changedDimension: "distributed-creator-social-acceleration-abstention",
  parentDecision: "paper-long-every-eligible-pulse",
  decision: "paper-long-only-with-frozen-distributed-creator-social-acceleration",
  minimumCreatorCountInclusive: FROZEN_CREATOR_ACCELERATION_SCREEN.minimumCreatorCountInclusive,
  minimumCreatorInteractionsInclusive: FROZEN_CREATOR_ACCELERATION_SCREEN.minimumCreatorInteractionsInclusive,
  maximumTopCreatorInteractionShareInclusive: FROZEN_CREATOR_ACCELERATION_SCREEN.maximumTopCreatorInteractionShareInclusive,
  maximumCreatorInteractionHhiInclusive: FROZEN_CREATOR_ACCELERATION_SCREEN.maximumCreatorInteractionHhiInclusive,
  minimumAccelerationSignalsInclusive: FROZEN_CREATOR_ACCELERATION_SCREEN.minimumAccelerationSignalsInclusive,
  paperNotionalUsd: 100,
  baseRoundTripCostPct: 4,
  stressRoundTripCostPct: 12,
  minimumObservations: 252,
  minimumIndependentFrames: 252,
  minimumUniqueTradedTokens: 30,
  minimumIndependentTradedFrames: 64,
  minimumQualifyingObservations: 50,
  bootstrapIterations: 10_000,
  minimumProfitFactor: 1.2,
  maximumDrawdownPct: 25,
  maximumLargestWinningFrameShare: 0.35,
  derivationStatus: "future-replication-of-predeclared-panel-screen",
  derivationNote: "The predeclared creator panel selected one exact-contract 3place observation: 48 creators, 24,185 interactions, 0.129915 top share, 0.044902 HHI, one social-acceleration signal, and +20.569174% exact one-hour gross return. This rule copies that already-frozen screen without tuning. 3place and every forecast, evidence item, path, and outcome through the boundary are excluded.",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseLunarCreatorAccelerationRegistrationEvent(registeredAt = new Date()) {
  const spec = {
    rule: DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export async function registerDexPulseLunarCreatorAcceleration(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseLunarCreatorAccelerationRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse Lunar creator-acceleration registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error("Existing DEX pulse Lunar creator-acceleration registration mismatch.");
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export function buildDexPulseLunarCreatorAccelerationScorecard(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const creator = validatedDexPulseLunarCreatorObservationRows(events);
  const creatorRows = new Map(creator.rows.map((row) => [row.forecast.id, row]));
  const rows = pulse.rows
    .filter((row) => Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? ""))
    .map((row) => ({
      ...row,
      creatorEvidenceRow: creatorRows.get(row.forecast.id) ?? null,
    }));
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const test = (row) => Boolean(
    row.creatorEvidenceRow
    && passesLunarCreatorScreen(
      row.creatorEvidenceRow,
      FROZEN_CREATOR_ACCELERATION_SCREEN,
    )
  );
  const parent = policySummary(frames, () => true);
  const policy = policySummary(frames, test);
  const parentBase = policyFrameReturns(frames, () => true, "baseCapacityReturnPct");
  const policyBase = policyFrameReturns(frames, test, "baseCapacityReturnPct");
  const pairedDeltas = policyBase.map((value, index) => value - parentBase[index]);
  const pairedInterval = pairedDeltas.length
    ? bootstrapMeanInterval(
      pairedDeltas,
      DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE.bootstrapIterations,
    ) : [null, null];
  const candidateForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  const evidenceShortfall = {
    observations: Math.max(0,
      DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE.minimumObservations - weightedRows.length),
    independentFrames: Math.max(0,
      DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE.minimumIndependentFrames - frames.length),
    uniqueTradedTokens: Math.max(0,
      DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE.minimumUniqueTradedTokens - policy.uniqueTokens),
    independentTradedFrames: Math.max(0,
      DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE.minimumIndependentTradedFrames
      - policy.independentTradedFrames),
    qualifyingObservations: Math.max(0,
      DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE.minimumQualifyingObservations
      - policy.observations),
  };
  const sufficient = Object.values(evidenceShortfall).every((value) => value === 0);
  const provisionalGate = Boolean(
    sufficient
    && policy.averageCapacityReturnPct > 0
    && policy.stressAverageCapacityReturnPct > 0
    && pairedInterval[0] > 0
    && policy.profitFactor >= DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE.minimumProfitFactor
    && policy.maxDrawdownPct <= DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE.maximumDrawdownPct
    && policy.largestWinningFrameShare
      <= DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE.maximumLargestWinningFrameShare
  );
  return {
    type: "dex-surface-pulse-lunar-creator-acceleration-scorecard",
    ruleVersion: DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE.version,
    evidenceBoundary: DEX_PULSE_LUNAR_CREATOR_ACCELERATION_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    researchOnly: true,
    mutationAllowed: false,
    posthocDerived: true,
    candidateForecasts: candidateForecasts.length,
    openForecasts: candidateForecasts.filter((forecast) => (
      pulse.openForecastIds.includes(forecast.id)
    )).length,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    sourcePulseRejectionCounts: pulse.rejectionCounts,
    sourceCreatorRejectionCounts: creator.rejectionCounts,
    parentPolicy: parent,
    creatorAccelerationPolicy: policy,
    pairedFrameMeanDeltaPct: nullableRound(mean(pairedDeltas)),
    pairedBootstrapMeanDeltaCi95Pct: pairedInterval.map(nullableRound),
    evidenceStatus: provisionalGate ? "provisional-gate-passed" : "collecting",
    evidenceShortfall,
    provisionalGate,
    note: "This future-only replication copies one already-predeclared creator/social screen and changes only pulse abstention. Missing or invalid creator/social evidence scores paper cash; it cannot backfill, retune, auto-promote, mutate, or trade.",
  };
}

function policySummary(frames, test) {
  const selected = frames.flatMap((frame) => frame.filter(test));
  const base = policyFrameReturns(frames, test, "baseCapacityReturnPct");
  const stress = policyFrameReturns(frames, test, "stressCapacityReturnPct");
  return {
    observations: selected.length,
    independentFrames: frames.length,
    independentTradedFrames: frames.filter((frame) => frame.some(test)).length,
    uniqueTokens: new Set(selected.map(tokenEdgeAssetKey)).size,
    riseRate: nullableRound(selected.length
      ? selected.filter((row) => row.grossReturnPct > 0).length / selected.length : null),
    netWinRate: nullableRound(selected.length
      ? selected.filter((row) => row.baseCapacityReturnPct > 0).length / selected.length : null),
    averageCapacityReturnPct: nullableRound(mean(base)),
    stressAverageCapacityReturnPct: nullableRound(mean(stress)),
    profitFactor: nullableRound(profitFactor(base)),
    maxDrawdownPct: nullableRound(maxDrawdownPct(base)),
    largestWinningFrameShare: nullableRound(largestWinningShare(base)),
  };
}

function policyFrameReturns(frames, test, field) {
  return frames.map((frame) => mean(frame.map((row) => test(row) ? row[field] : 0)));
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseLunarCreatorAccelerationRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

async function verifiedLedger(ledgerPath) {
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  return events;
}

function bootstrapMeanInterval(values, iterations) {
  let state = 0x1f83d9ab;
  const random = () => {
    state = ((state * 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const means = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(random() * values.length)];
    }
    means.push(total / values.length);
  }
  means.sort((left, right) => left - right);
  return [quantile(means, 0.025), quantile(means, 0.975)];
}

function quantile(values, probability) {
  if (!values.length) return null;
  const index = (values.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper ? values[lower]
    : values[lower] + ((values[upper] - values[lower]) * (index - lower));
}

function profitFactor(values) {
  const wins = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (losses === 0) return wins > 0 ? 999 : null;
  return wins / losses;
}

function maxDrawdownPct(values) {
  let equity = 1;
  let peak = 1;
  let maximum = 0;
  for (const value of values) {
    equity *= Math.max(0, 1 + (value / 100));
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }
  return maximum;
}

function largestWinningShare(values) {
  const winners = values.filter((value) => value > 0);
  const total = winners.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...winners) / total : null;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function nullableRound(value) {
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
}

function validIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Expected a valid timestamp.");
  return date.toISOString();
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonical(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseArgs(argv) {
  const options = { command: argv[2] ?? "score" };
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--ledger") options.ledgerPath = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "score"].includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-lunar-creator-acceleration.mjs register|score [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseLunarCreatorAcceleration(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: buildDexPulseLunarCreatorAccelerationScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
