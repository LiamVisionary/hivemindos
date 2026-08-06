#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendLedgerEvent, digestValue, readLedger, verifyLedger } from "./onchain-forward-core.mjs";
import { TOKEN_EDGE_EXECUTION_POLICY } from "./onchain-capacity-scorecard.mjs";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  DEX_PULSE_LUNAR_TOPIC_RULE,
  createDexPulseLunarTopicRegistrationEvent,
  validatedDexPulseLunarTopicEvidenceRows,
  validatedDexPulseLunarTopicForecastRows,
} from "./onchain-dex-pulse-lunar-topic-monitoring.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;

export const DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE = Object.freeze({
  version: "dex-surface-pulse-lunar-exact-contract-topic-growth-panel-v1",
  evidenceBoundary: "2026-08-03T21:30:35.000Z",
  sourceTopicRuleVersion: DEX_PULSE_LUNAR_TOPIC_RULE.version,
  changedDimension: "sign-of-exact-contract-topic-aggregate-change",
  minimumEvidenceSeparationMs: 10 * 60_000,
  maximumEvidenceLookbackMs: 30 * 60_000,
  screens: Object.freeze([
    Object.freeze({ id: "topic-interactions-growing", fields: ["interactionsDelta"] }),
    Object.freeze({ id: "topic-contributors-growing", fields: ["contributorsDelta"] }),
    Object.freeze({ id: "topic-posts-growing", fields: ["postsDelta"] }),
    Object.freeze({
      id: "topic-breadth-growing-consensus",
      fields: ["contributorsDelta", "postsDelta"],
    }),
    Object.freeze({
      id: "topic-all-growing-consensus",
      fields: ["interactionsDelta", "contributorsDelta", "postsDelta"],
    }),
  ]),
  minimumObservations: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTradedTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  minimumGrowthObservations: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  derivationStatus: "pre-outcome-social-growth-sign-hypotheses-only",
  derivationNote: "The exact-contract point endpoint exposes live interactions, contributors, and posts but no Individual-tier history. This panel was frozen before any exact-topic cohort outcome and tests only whether each aggregate is strictly increasing across two later post-registration points. The first open topic cohort and every inspected path are excluded; no magnitude threshold was fitted.",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseLunarTopicGrowthRegistrationEvent(registeredAt = new Date()) {
  const spec = {
    rule: DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE,
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

export async function registerDexPulseLunarTopicGrowth(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesSourceRegistration)) {
    throw new Error("Register the exact-contract Lunar topic panel before topic-growth monitoring.");
  }
  const proposed = createDexPulseLunarTopicGrowthRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse Lunar topic-growth registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error("Existing DEX pulse Lunar topic-growth registration mismatch.");
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

export function buildDexPulseLunarTopicGrowthScorecard(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const registrationAt = Date.parse(registration?.registeredAt ?? "");
  const source = validatedDexPulseLunarTopicForecastRows(events);
  const sourceEvidence = validatedDexPulseLunarTopicEvidenceRows(events);
  const validTopicRows = source.forecastRows.filter((row) => (
    row.topicReady
    && Date.parse(row.createdAt) > registrationAt
    && Date.parse(row.evidence?.availableAt ?? "") > registrationAt
  ));
  const evidenceRowsByToken = new Map();
  for (const row of sourceEvidence.evidenceRows.filter((candidate) => (
    candidate.topicReady && Date.parse(candidate.availableAt) > registrationAt
  ))) {
    const rows = evidenceRowsByToken.get(row.tokenAddress) ?? [];
    rows.push(row);
    evidenceRowsByToken.set(row.tokenAddress, rows);
  }
  for (const rows of evidenceRowsByToken.values()) {
    rows.sort((left, right) => (
      Date.parse(left.availableAt) - Date.parse(right.availableAt)
    ));
  }

  const currentByForecastId = new Map(validTopicRows.map((row) => [row.forecastId, row]));
  const comparisonExclusionCounts = {};
  const observations = source.pulse.rows.filter((row) => (
    Date.parse(row.createdAt) > registrationAt
  )).map((row) => {
    const current = currentByForecastId.get(row.forecastId);
    if (!current) {
      increment(comparisonExclusionCounts, "missing-valid-current-topic-point");
      return growthObservation(row, null, null);
    }
    const currentAt = Date.parse(current.evidence.availableAt);
    const prior = [...(evidenceRowsByToken.get(row.tokenAddress) ?? [])].reverse().find((candidate) => {
      const priorAt = Date.parse(candidate.availableAt);
      const separation = currentAt - priorAt;
      return candidate.evidence.id !== current.evidence.id
        && candidate.evidence.discoveryEventId !== current.forecast.discoveryEventId
        && priorAt < currentAt
        && separation >= DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.minimumEvidenceSeparationMs
        && separation <= DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.maximumEvidenceLookbackMs;
    });
    if (!prior) increment(comparisonExclusionCounts, "missing-valid-prior-topic-point");
    return growthObservation(row, current, prior ?? null);
  });

  const frames = independentAssetFrames(observations, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const futureForecasts = source.pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > registrationAt
  ));
  return {
    type: "dex-surface-pulse-lunar-exact-contract-topic-growth-scorecard",
    ruleVersion: DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.version,
    evidenceBoundary: DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    sourceTopicRegistrationId: source.registration?.id ?? null,
    researchOnly: true,
    mutationAllowed: false,
    posthocDerived: false,
    candidateForecasts: futureForecasts.length,
    openForecasts: futureForecasts.filter((forecast) => (
      source.pulse.openForecastIds.includes(forecast.id)
    )).length,
    eligibleLiveObservations: observations.length,
    eligibleTopicComparisons: observations.filter((row) => row.comparisonReady).length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(observations, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    sourceTopicRejectionCounts: source.rejectionCounts,
    sourceTopicEvidenceRejectionCounts: sourceEvidence.rejectionCounts,
    comparisonExclusionCounts,
    parent: summarizeFrames(frames, () => true),
    screens: DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.screens.map((screen) => (
      screenReport(frames, screen)
    )),
    observationsDetail: observations.filter((row) => row.comparisonReady).map((row) => ({
      forecastId: row.forecastId,
      chain: row.chain,
      tokenAddress: row.tokenAddress,
      symbol: row.forecast.symbol ?? null,
      createdAt: row.createdAt,
      priorEvidenceId: row.priorEvidenceId,
      currentEvidenceId: row.currentEvidenceId,
      evidenceSeparationMs: row.evidenceSeparationMs,
      interactionsDelta: row.interactionsDelta,
      contributorsDelta: row.contributorsDelta,
      postsDelta: row.postsDelta,
      grossReturnPct: row.grossReturnPct,
      baseCapacityReturnPct: row.baseCapacityReturnPct,
      stressCapacityReturnPct: row.stressCapacityReturnPct,
    })),
    note: "Every future valid pulse stays in the parent. Each predeclared screen changes only the sign of a single exact-contract Lunar topic aggregate or a declared consensus across those signs. Both points must be post-registration, exact, 10-30 minutes apart, and independently linked to their source discoveries; the current point must also be available before its forecast. Missing comparisons are challenger cash; this multiple-testing panel cannot backfill, promote, mutate, or trade.",
  };
}

function growthObservation(row, current, prior) {
  const comparisonReady = Boolean(current && prior);
  return {
    ...row,
    comparisonReady,
    priorEvidenceId: prior?.evidence.id ?? null,
    currentEvidenceId: current?.evidence.id ?? null,
    evidenceSeparationMs: comparisonReady
      ? Date.parse(current.evidence.availableAt) - Date.parse(prior.availableAt)
      : null,
    interactionsDelta: comparisonReady
      ? current.topicInteractions24h - prior.topicInteractions24h : null,
    contributorsDelta: comparisonReady
      ? current.topicContributors - prior.topicContributors : null,
    postsDelta: comparisonReady ? current.topicPosts - prior.topicPosts : null,
  };
}

function screenReport(frames, screen) {
  const test = (row) => row.comparisonReady && screen.fields.every((field) => row[field] > 0);
  const summary = summarizeFrames(frames, test);
  const parentBase = policyFrameReturns(frames, () => true, "baseCapacityReturnPct");
  const screenBase = policyFrameReturns(frames, test, "baseCapacityReturnPct");
  const deltas = screenBase.map((value, index) => value - parentBase[index]);
  const interval = frames.length >= 2
    ? bootstrapMeanInterval(deltas, DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.bootstrapIterations)
    : [null, null];
  const evidenceShortfall = {
    observations: Math.max(
      0,
      DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.minimumObservations
        - frames.flat().length,
    ),
    independentFrames: Math.max(
      0,
      DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.minimumIndependentFrames - frames.length,
    ),
    uniqueTradedTokens: Math.max(
      0,
      DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.minimumUniqueTradedTokens
        - summary.uniqueTokens,
    ),
    independentTradedFrames: Math.max(
      0,
      DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.minimumIndependentTradedFrames
        - summary.independentTradedFrames,
    ),
    growthObservations: Math.max(
      0,
      DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.minimumGrowthObservations
        - summary.observations,
    ),
  };
  const sufficient = Object.values(evidenceShortfall).every((value) => value === 0);
  return {
    id: screen.id,
    fields: screen.fields,
    ...summary,
    pairedBootstrapMeanDeltaCi95Pct: interval.map(nullableRound),
    evidenceShortfall,
    provisionalGate: Boolean(
      sufficient
      && summary.screenAverageCapacityReturnPct > 0
      && summary.screenStressCapacityReturnPct > 0
      && interval[0] > 0
      && summary.screenProfitFactor >= DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.minimumProfitFactor
      && summary.screenMaxDrawdownPct <= DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.maximumDrawdownPct
      && summary.largestWinningFrameShare
        <= DEX_PULSE_LUNAR_TOPIC_GROWTH_RULE.maximumLargestWinningFrameShare
    ),
  };
}

function summarizeFrames(frames, test) {
  const selected = frames.flatMap((frame) => frame.filter(test));
  const parentBase = policyFrameReturns(frames, () => true, "baseCapacityReturnPct");
  const parentStress = policyFrameReturns(frames, () => true, "stressCapacityReturnPct");
  const screenBase = policyFrameReturns(frames, test, "baseCapacityReturnPct");
  const screenStress = policyFrameReturns(frames, test, "stressCapacityReturnPct");
  return {
    observations: selected.length,
    independentFrames: frames.length,
    independentTradedFrames: frames.filter((frame) => frame.some(test)).length,
    uniqueTokens: new Set(selected.map(tokenEdgeAssetKey)).size,
    riseRate: nullableRound(selected.length
      ? selected.filter((row) => row.grossReturnPct > 0).length / selected.length : null),
    netWinRate: nullableRound(selected.length
      ? selected.filter((row) => row.baseCapacityReturnPct > 0).length / selected.length : null),
    parentAverageCapacityReturnPct: nullableRound(mean(parentBase)),
    screenAverageCapacityReturnPct: nullableRound(mean(screenBase)),
    pairedCapacityDeltaPct: nullableRound(pairedMean(screenBase, parentBase)),
    parentStressCapacityReturnPct: nullableRound(mean(parentStress)),
    screenStressCapacityReturnPct: nullableRound(mean(screenStress)),
    pairedStressCapacityDeltaPct: nullableRound(pairedMean(screenStress, parentStress)),
    parentProfitFactor: nullableRound(profitFactor(parentBase)),
    screenProfitFactor: nullableRound(profitFactor(screenBase)),
    parentMaxDrawdownPct: nullableRound(maxDrawdownPct(parentBase)),
    screenMaxDrawdownPct: nullableRound(maxDrawdownPct(screenBase)),
    largestWinningFrameShare: nullableRound(largestWinningShare(screenBase)),
  };
}

function policyFrameReturns(frames, test, field) {
  return frames.map((frame) => mean(frame.map((row) => test(row) ? row[field] : 0)));
}

function matchesSourceRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseLunarTopicRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseLunarTopicGrowthRegistrationEvent(event.registeredAt);
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
  let state = 0x3c6ef372;
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

function pairedMean(left, right) {
  return left.length === right.length
    ? mean(left.map((value, index) => value - right[index])) : null;
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
    throw new Error("Usage: onchain-dex-pulse-lunar-topic-growth.mjs register|score [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseLunarTopicGrowth(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: buildDexPulseLunarTopicGrowthScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
