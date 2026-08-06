#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendLedgerEvent, digestValue, readLedger, verifyLedger } from "./onchain-forward-core.mjs";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  DEX_SURFACE_PULSE_RULE,
  validatedDexSurfacePulseObservationRows,
} from "./onchain-dex-pulse-monitoring.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;

export const DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE = Object.freeze({
  version: "dex-surface-pulse-negative-five-minute-positive-hourly-reversal-v1",
  evidenceBoundary: "2026-08-04T01:09:31.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  parentRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  changedDimension: "require-negative-five-minute-and-positive-one-hour-price-change-signs",
  parentPolicy: Object.freeze({
    id: "all-valid-dex-surface-pulse-observations",
  }),
  challengerPolicy: Object.freeze({
    id: "negative-five-minute-positive-one-hour-reversal-state",
    requireNegativeFiveMinutePriceChange: true,
    requirePositiveOneHourPriceChange: true,
  }),
  paperNotionalUsd: 100,
  baseRoundTripCostPct: 4,
  stressRoundTripCostPct: 12,
  minimumObservations: 252,
  minimumIndependentFrames: 252,
  minimumUniqueTradedTokens: 30,
  minimumIndependentTradedFrames: 64,
  minimumReversalObservations: 50,
  bootstrapIterations: 10_000,
  minimumProfitFactor: 1.2,
  maximumDrawdownPct: 25,
  maximumLargestWinningFrameShare: 0.35,
  derivationStatus: "posthoc-broad-sign-state-hypothesis-only",
  derivationNote: "A bounded audit of 52 weighted pulse observations across 10 independent hourly frames found seven negative-five-minute/positive-hourly observations across five traded frames and six tokens. The screen averaged +1.281251% at base capacity and +0.234584% under stress, but one winner supplied 0.7749 of gains and the first chronological half was negative. The helia winner, WIGLET loss, all other audited outcomes and paths, and every forecast open at registration are derivation-only and excluded. Magnitude and transaction-count variants were inspected but are deliberately not part of this frozen broad sign-state test.",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseCrossWindowReversalRegistrationEvent(registeredAt = new Date()) {
  const spec = {
    rule: DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE,
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

export async function registerDexPulseCrossWindowReversal(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const pulse = validatedDexSurfacePulseObservationRows(events);
  if (!pulse.registration) throw new Error("DEX surface pulse parent registration is required.");
  const proposed = createDexPulseCrossWindowReversalRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.evidenceBoundary))) {
    throw new Error("Cross-window reversal registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error("Existing cross-window reversal registration mismatch.");
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
    parentRegistrationId: pulse.registration.id,
  };
}

export function buildDexPulseCrossWindowReversalScorecard(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const rejectionCounts = {};
  const rows = [];
  for (const row of pulse.rows) {
    if (!(Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? ""))) continue;
    if (!Number.isFinite(row.priceChangeM5Pct)) {
      increment(rejectionCounts, "missing-or-invalid-five-minute-momentum");
      continue;
    }
    if (!Number.isFinite(row.priceChangeH1Pct)) {
      increment(rejectionCounts, "missing-or-invalid-one-hour-momentum");
      continue;
    }
    rows.push({
      ...row,
      reversalDecision: row.priceChangeM5Pct < 0 && row.priceChangeH1Pct > 0,
    });
  }
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const parent = policySummary(frames, () => true);
  const challenger = policySummary(frames, (row) => row.reversalDecision);
  const parentFrameBase = policyFrameReturns(frames, () => true, "baseCapacityReturnPct");
  const challengerFrameBase = policyFrameReturns(
    frames,
    (row) => row.reversalDecision,
    "baseCapacityReturnPct",
  );
  const pairedDeltas = challengerFrameBase.map((value, index) => value - parentFrameBase[index]);
  const pairedInterval = pairedDeltas.length
    ? bootstrapMeanInterval(
      pairedDeltas,
      DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.bootstrapIterations,
    )
    : [null, null];
  const candidateForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  const evidenceShortfall = {
    observations: Math.max(
      0,
      DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.minimumObservations - weightedRows.length,
    ),
    independentFrames: Math.max(
      0,
      DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.minimumIndependentFrames - frames.length,
    ),
    uniqueTradedTokens: Math.max(
      0,
      DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.minimumUniqueTradedTokens
        - challenger.uniqueTokens,
    ),
    independentTradedFrames: Math.max(
      0,
      DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.minimumIndependentTradedFrames
        - challenger.independentTradedFrames,
    ),
    reversalObservations: Math.max(
      0,
      DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.minimumReversalObservations
        - challenger.observations,
    ),
  };
  const sufficient = Object.values(evidenceShortfall).every((value) => value === 0);
  const provisionalGate = Boolean(
    sufficient
    && challenger.averageCapacityReturnPct > 0
    && challenger.stressAverageCapacityReturnPct > 0
    && pairedInterval[0] > 0
    && challenger.profitFactor >= DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.minimumProfitFactor
    && challenger.maxDrawdownPct <= DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.maximumDrawdownPct
    && challenger.largestWinningFrameShare
      <= DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.maximumLargestWinningFrameShare
  );
  return {
    type: "dex-surface-pulse-cross-window-reversal-scorecard",
    ruleVersion: DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.version,
    evidenceBoundary: DEX_PULSE_CROSS_WINDOW_REVERSAL_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    parentRegistrationId: pulse.registration?.id ?? null,
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
    rejectionCounts,
    allPulseParentPolicy: parent,
    crossWindowReversalPolicy: challenger,
    pairedFrameMeanDeltaPct: nullableRound(mean(pairedDeltas)),
    pairedBootstrapMeanDeltaCi95Pct: pairedInterval.map(nullableRound),
    evidenceStatus: provisionalGate ? "provisional-gate-passed" : "collecting",
    evidenceShortfall,
    provisionalGate,
    note: "This future-only paper challenger changes only the source momentum sign state: five-minute return must be negative while one-hour return is positive. The helia/WIGLET derivation comparison, all inspected outcomes and paths, and every forecast open at registration are excluded. Missing or inconsistent source momentum holds challenger cash; the rule cannot backfill, retune, promote, mutate, or trade.",
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
  const expected = createDexPulseCrossWindowReversalRegistrationEvent(event.registeredAt);
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
  let state = 0x6a09e667;
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
  const losses = Math.abs(values.filter((value) => value < 0)
    .reduce((sum, value) => sum + value, 0));
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

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
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
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
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
    throw new Error("Usage: onchain-dex-pulse-cross-window-reversal.mjs register|score [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseCrossWindowReversal(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: buildDexPulseCrossWindowReversalScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
