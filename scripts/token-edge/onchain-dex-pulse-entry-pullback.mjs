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
  DEX_PULSE_ENTRY_PROVIDER_PRICE_INTEGRITY_RULE,
  DEX_SURFACE_PULSE_RULE,
  validatedDexSurfacePulseObservationRows,
} from "./onchain-dex-pulse-monitoring.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const MAX_SOURCE_TO_ENTRY_LAG_MS = 5 * 60_000;

export const DEX_PULSE_ENTRY_PULLBACK_RULE = Object.freeze({
  version: "dex-surface-pulse-entry-pullback-v1",
  evidenceBoundary: "2026-08-03T20:00:20.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  changedDimension: "discovery-to-fresh-entry-return",
  parentDecision: "paper-long-every-eligible-pulse",
  decision: "paper-long-only-after-entry-pullback",
  maximumDiscoveryToEntryReturnPctInclusive: -10,
  entryIntegrityRuleVersion: DEX_PULSE_ENTRY_PROVIDER_PRICE_INTEGRITY_RULE.version,
  paperNotionalUsd: 100,
  baseRoundTripCostPct: 4,
  stressRoundTripCostPct: 12,
  minimumObservations: 252,
  minimumIndependentFrames: 252,
  minimumUniqueTradedTokens: 30,
  minimumIndependentTradedFrames: 64,
  minimumPullbackObservations: 50,
  bootstrapIterations: 10_000,
  minimumProfitFactor: 1.2,
  maximumDrawdownPct: 25,
  maximumLargestWinningFrameShare: 0.35,
  derivationStatus: "posthoc-open-dorkl-pullback-rebound-hypothesis-only",
  derivationNote: "DORKL fell 28.890149% from its 19:40 discovery quote to its fresh 19:45 entry, then its retained path rose 31.720287% by 19:50 and 42.727998% by 20:00. DORKL, that entire open cohort, and every forecast through the boundary are excluded. The -10% threshold is a round hypothesis, not a fitted payoff optimum.",
  researchOnly: true,
  mutationAllowed: false,
});

export const DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE = Object.freeze({
  version: "dex-surface-pulse-pullback-positive-momentum-v2",
  evidenceBoundary: "2026-08-03T21:15:23.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  sourcePullbackRuleVersion: DEX_PULSE_ENTRY_PULLBACK_RULE.version,
  changedDimension: "require-positive-source-five-minute-momentum-after-pullback",
  parentDecision: "paper-long-after-entry-pullback",
  decision: "paper-long-after-entry-pullback-only-with-positive-source-momentum",
  maximumDiscoveryToEntryReturnPctInclusive: -10,
  minimumPriceChangeM5PctExclusive: 0,
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
  derivationStatus: "posthoc-dorkl-versus-doge-reversal-hypothesis-only",
  derivationNote: "DORKL and DOGE both repriced at least 10% below discovery and had buy pressure, but DORKL's retained source 5m change was +13.21% before +98.537623% gross while DOGE's was -12.19% before -10.975406%. Both outcomes and all evidence through the boundary are excluded. The zero sign threshold was pre-existing and is not payoff-fitted.",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseEntryPullbackRegistrationEvent(registeredAt = new Date()) {
  const spec = { rule: DEX_PULSE_ENTRY_PULLBACK_RULE, researchOnly: true, mutationAllowed: false };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export function createDexPulsePullbackPositiveMomentumRegistrationEvent(
  registeredAt = new Date(),
) {
  const spec = {
    rule: DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE,
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

export async function registerDexPulseEntryPullback(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseEntryPullbackRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(DEX_PULSE_ENTRY_PULLBACK_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse entry-pullback registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error("Existing DEX pulse entry-pullback registration mismatch.");
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

export async function registerDexPulsePullbackPositiveMomentum(
  options = {}, dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesRegistration)) {
    throw new Error("Register the entry-pullback parent before its momentum challenger.");
  }
  const proposed = createDexPulsePullbackPositiveMomentumRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse pullback-momentum registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesPositiveMomentumRegistration(existing)) {
    throw new Error("Existing DEX pulse pullback-momentum registration mismatch.");
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

export function validatedDexPulseEntryPullbackRows(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const discoveries = new Map(events
    .filter((event) => event.type === "discovery")
    .map((event) => [event.id, event]));
  const rejectionCounts = {};
  const rows = [];
  for (const row of pulse.rows) {
    if (!(Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? ""))) continue;
    const discovery = discoveries.get(row.forecast.discoveryEventId);
    const candidate = (discovery?.candidates ?? []).find((item) => (
      item.chain === row.forecast.chain && item.tokenAddress === row.forecast.tokenAddress
    ));
    const reason = entryPullbackRejectionReason(row, discovery, candidate);
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    const discoveryToEntryReturnPct = round6(
      ((row.forecast.entryPriceUsd / candidate.priceUsd) - 1) * 100,
    );
    rows.push({
      ...row,
      discoveryPriceUsd: candidate.priceUsd,
      discoveryToEntryReturnPct,
      pullbackDecision: discoveryToEntryReturnPct
        <= DEX_PULSE_ENTRY_PULLBACK_RULE.maximumDiscoveryToEntryReturnPctInclusive,
    });
  }
  return { registration, pulse, rows, rejectionCounts };
}

export function buildDexPulseEntryPullbackScorecard(events) {
  const { registration, pulse, rows, rejectionCounts }
    = validatedDexPulseEntryPullbackRows(events);
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const parent = policySummary(frames, () => true);
  const policy = policySummary(frames, (row) => row.pullbackDecision);
  const parentBase = policyFrameReturns(frames, () => true, "baseCapacityReturnPct");
  const policyBase = policyFrameReturns(frames, (row) => row.pullbackDecision, "baseCapacityReturnPct");
  const pairedDeltas = policyBase.map((value, index) => value - parentBase[index]);
  const pairedInterval = pairedDeltas.length
    ? bootstrapMeanInterval(pairedDeltas, DEX_PULSE_ENTRY_PULLBACK_RULE.bootstrapIterations)
    : [null, null];
  const candidateForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  const evidenceShortfall = {
    observations: Math.max(0, DEX_PULSE_ENTRY_PULLBACK_RULE.minimumObservations - weightedRows.length),
    independentFrames: Math.max(0, DEX_PULSE_ENTRY_PULLBACK_RULE.minimumIndependentFrames - frames.length),
    uniqueTradedTokens: Math.max(0, DEX_PULSE_ENTRY_PULLBACK_RULE.minimumUniqueTradedTokens - policy.uniqueTokens),
    independentTradedFrames: Math.max(0, DEX_PULSE_ENTRY_PULLBACK_RULE.minimumIndependentTradedFrames - policy.independentTradedFrames),
    pullbackObservations: Math.max(0, DEX_PULSE_ENTRY_PULLBACK_RULE.minimumPullbackObservations - policy.observations),
  };
  const sufficient = Object.values(evidenceShortfall).every((value) => value === 0);
  const provisionalGate = Boolean(
    sufficient
    && policy.averageCapacityReturnPct > 0
    && policy.stressAverageCapacityReturnPct > 0
    && pairedInterval[0] > 0
    && policy.profitFactor >= DEX_PULSE_ENTRY_PULLBACK_RULE.minimumProfitFactor
    && policy.maxDrawdownPct <= DEX_PULSE_ENTRY_PULLBACK_RULE.maximumDrawdownPct
    && policy.largestWinningFrameShare <= DEX_PULSE_ENTRY_PULLBACK_RULE.maximumLargestWinningFrameShare
  );
  return {
    type: "dex-surface-pulse-entry-pullback-scorecard",
    ruleVersion: DEX_PULSE_ENTRY_PULLBACK_RULE.version,
    evidenceBoundary: DEX_PULSE_ENTRY_PULLBACK_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    researchOnly: true,
    mutationAllowed: false,
    posthocDerived: true,
    candidateForecasts: candidateForecasts.length,
    openForecasts: candidateForecasts.filter((forecast) => pulse.openForecastIds.includes(forecast.id)).length,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    sourcePulseRejectionCounts: pulse.rejectionCounts,
    rejectionCounts,
    parentPolicy: parent,
    entryPullbackPolicy: policy,
    pairedFrameMeanDeltaPct: nullableRound(mean(pairedDeltas)),
    pairedBootstrapMeanDeltaCi95Pct: pairedInterval.map(nullableRound),
    evidenceStatus: provisionalGate ? "provisional-gate-passed" : "collecting",
    evidenceShortfall,
    provisionalGate,
    note: "This future-only paper challenger changes only whether a valid fresh-entry pulse is followed after its price moved at most -10% from the earlier discovery quote. It does not reuse the discovery quote as a fill, infer a rebound, alter entry execution, auto-promote, or trade.",
  };
}

export function buildDexPulsePullbackPositiveMomentumScorecard(events) {
  const registration = events.find(matchesPositiveMomentumRegistration) ?? null;
  const validated = validatedDexPulseEntryPullbackRows(events);
  const rows = validated.rows.filter((row) => (
    Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? "")
  )).map((row) => ({
    ...row,
    sourcePriceChangeM5Pct: finiteNumber(row.forecast.metrics?.priceChangeM5Pct),
    reversalDecision: row.pullbackDecision
      && finiteNumber(row.forecast.metrics?.priceChangeM5Pct)
        > DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.minimumPriceChangeM5PctExclusive,
  }));
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const parentTest = (row) => row.pullbackDecision;
  const policyTest = (row) => row.reversalDecision;
  const parent = policySummary(frames, parentTest);
  const policy = policySummary(frames, policyTest);
  const parentBase = policyFrameReturns(frames, parentTest, "baseCapacityReturnPct");
  const policyBase = policyFrameReturns(frames, policyTest, "baseCapacityReturnPct");
  const pairedDeltas = policyBase.map((value, index) => value - parentBase[index]);
  const pairedInterval = pairedDeltas.length
    ? bootstrapMeanInterval(
      pairedDeltas,
      DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.bootstrapIterations,
    ) : [null, null];
  const candidateForecasts = validated.pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  const evidenceShortfall = {
    observations: Math.max(
      0,
      DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.minimumObservations - weightedRows.length,
    ),
    independentFrames: Math.max(
      0,
      DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.minimumIndependentFrames - frames.length,
    ),
    uniqueTradedTokens: Math.max(
      0,
      DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.minimumUniqueTradedTokens
        - policy.uniqueTokens,
    ),
    independentTradedFrames: Math.max(
      0,
      DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.minimumIndependentTradedFrames
        - policy.independentTradedFrames,
    ),
    reversalObservations: Math.max(
      0,
      DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.minimumReversalObservations
        - policy.observations,
    ),
  };
  const sufficient = Object.values(evidenceShortfall).every((value) => value === 0);
  const provisionalGate = Boolean(
    sufficient
    && policy.averageCapacityReturnPct > 0
    && policy.stressAverageCapacityReturnPct > 0
    && pairedInterval[0] > 0
    && policy.profitFactor >= DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.minimumProfitFactor
    && policy.maxDrawdownPct <= DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.maximumDrawdownPct
    && policy.largestWinningFrameShare
      <= DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.maximumLargestWinningFrameShare
  );
  return {
    type: "dex-surface-pulse-pullback-positive-momentum-scorecard",
    ruleVersion: DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.version,
    evidenceBoundary: DEX_PULSE_PULLBACK_POSITIVE_MOMENTUM_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    parentRegistrationId: validated.registration?.id ?? null,
    researchOnly: true,
    mutationAllowed: false,
    posthocDerived: true,
    candidateForecasts: candidateForecasts.length,
    openForecasts: candidateForecasts.filter((forecast) => (
      validated.pulse.openForecastIds.includes(forecast.id)
    )).length,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    sourcePulseRejectionCounts: validated.pulse.rejectionCounts,
    sourcePullbackRejectionCounts: validated.rejectionCounts,
    pullbackParentPolicy: parent,
    pullbackPositiveMomentumPolicy: policy,
    pairedFrameMeanDeltaPct: nullableRound(mean(pairedDeltas)),
    pairedBootstrapMeanDeltaCi95Pct: pairedInterval.map(nullableRound),
    evidenceStatus: provisionalGate ? "provisional-gate-passed" : "collecting",
    evidenceShortfall,
    provisionalGate,
    note: "This future-only challenger adds only the pre-existing positive five-minute source-momentum sign to the frozen entry-pullback parent. DORKL, DOGE, and all inspected evidence are excluded; no threshold is fitted, backfilled, or traded.",
  };
}

function entryPullbackRejectionReason(row, discovery, candidate) {
  const forecast = row.forecast;
  if (!discovery
    || discovery.provider !== DEX_SURFACE_PULSE_RULE.sourceProvider
    || discovery.ruleVersion !== DEX_SURFACE_PULSE_RULE.sourceRuleVersion
    || discovery.id !== forecast.discoveryEventId
    || discovery.observedAt !== forecast.sourceDiscoveryObservedAt) return "missing-or-mismatched-discovery";
  if (!candidate
    || candidate.status !== "eligible"
    || candidate.pairAddress !== forecast.pairAddress
    || !(candidate.priceUsd > 0)) return "missing-or-mismatched-candidate";
  const sourceAt = Date.parse(discovery.observedAt ?? "");
  const createdAt = Date.parse(forecast.createdAt ?? "");
  if (!(createdAt >= sourceAt && createdAt - sourceAt <= MAX_SOURCE_TO_ENTRY_LAG_MS)) {
    return "invalid-source-to-entry-timing";
  }
  if (forecast.entryObservedAt !== forecast.createdAt
    || forecast.entryIntegrityRuleVersion !== DEX_PULSE_ENTRY_PROVIDER_PRICE_INTEGRITY_RULE.version
    || !forecast.entryIntegrityRegistrationId
    || !(forecast.entryPriceUsd > 0)
    || !forecast.entryProviderPriceIntegrity) return "missing-fresh-entry-integrity";
  return null;
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
  const expected = createDexPulseEntryPullbackRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesPositiveMomentumRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulsePullbackPositiveMomentumRegistrationEvent(event.registeredAt);
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
  let state = 0x510e527f;
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

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function nullableRound(value) {
  return Number.isFinite(value) ? round6(value) : null;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
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
  if (!["register", "score", "register-positive-momentum", "score-positive-momentum"]
    .includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-entry-pullback.mjs register|score|register-positive-momentum|score-positive-momentum [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseEntryPullback(options), null, 2));
    } else if (options.command === "register-positive-momentum") {
      console.log(JSON.stringify(
        await registerDexPulsePullbackPositiveMomentum(options),
        null,
        2,
      ));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: options.command === "score-positive-momentum"
          ? buildDexPulsePullbackPositiveMomentumScorecard(events)
          : buildDexPulseEntryPullbackScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
