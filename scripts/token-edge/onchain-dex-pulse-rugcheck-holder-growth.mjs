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
import { DEX_SURFACE_PULSE_RULE } from "./onchain-dex-pulse-monitoring.mjs";
import {
  DEX_PULSE_RUGCHECK_RULE,
  canonicalRugCheckAggregate,
  createDexPulseRugCheckRegistrationEvent,
  validatedDexPulseRugCheckRows,
} from "./onchain-dex-pulse-rugcheck-monitoring.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const MAX_SOURCE_LAG_MS = 5 * 60_000;

export const DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE = Object.freeze({
  version: "dex-pulse-rugcheck-holder-growth-v1",
  evidenceBoundary: "2026-08-03T16:45:00.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  sourceRugCheckRuleVersion: DEX_PULSE_RUGCHECK_RULE.version,
  screenId: "strict-holder-count-growth",
  minimumEvidenceSeparationMs: 10 * 60_000,
  maximumEvidenceLookbackMs: 30 * 60_000,
  decisionRule: "Paper-long only when the current exact-mint RugCheck total-holder count is strictly greater than the latest valid prior count; otherwise paper cash.",
  minimumMaturedForecasts: TOKEN_EDGE_EXECUTION_POLICY.minimumMaturedForecasts,
  minimumIndependentFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentSignalFrames,
  minimumUniqueTokens: TOKEN_EDGE_EXECUTION_POLICY.minimumUniqueTokens,
  minimumRiseCalls: TOKEN_EDGE_EXECUTION_POLICY.minimumPredictedRiseForecasts,
  minimumIndependentTradedFrames: TOKEN_EDGE_EXECUTION_POLICY.minimumIndependentTradedFrames,
  bootstrapIterations: TOKEN_EDGE_EXECUTION_POLICY.bootstrapIterations,
  minimumProfitFactor: TOKEN_EDGE_EXECUTION_POLICY.minimumProfitFactor,
  maximumDrawdownPct: TOKEN_EDGE_EXECUTION_POLICY.maximumDrawdownPct,
  maximumLargestWinningFrameShare: TOKEN_EDGE_EXECUTION_POLICY.maximumLargestWinningFrameShare,
  derivationStatus: "posthoc-course-holder-growth-sign-hypothesis-only",
  derivation: Object.freeze({
    inspectedIndependentFrames: 1,
    inspectedRepeatedTokens: 2,
    changedDimension: "sign-of-exact-mint-holder-count-change",
    warning: "BULLEN and CHUBBYDOG supplied one correlated seed comparison. Every inspected snapshot, forecast, and outcome is excluded; no magnitude threshold was fitted.",
  }),
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseRugCheckHolderGrowthRegistrationEvent(registeredAt = new Date()) {
  const spec = {
    rule: DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE,
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

export async function registerDexPulseRugCheckHolderGrowth(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesRugCheckRegistration)) {
    throw new Error("Register the frozen DEX pulse RugCheck panel before holder-growth monitoring.");
  }
  const proposed = createDexPulseRugCheckHolderGrowthRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt) > Date.parse(
    DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.evidenceBoundary,
  ))) throw new Error("DEX pulse RugCheck holder-growth registration must be strictly after its evidence boundary.");
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error(`Existing DEX pulse RugCheck holder-growth registration mismatch: ${proposed.id}`);
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

export function buildDexPulseRugCheckHolderGrowthScorecard(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const registrationAt = Date.parse(registration?.registeredAt ?? "");
  const boundaryAt = Date.parse(DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.evidenceBoundary);
  const sourceRegistration = events.find(matchesRugCheckRegistration) ?? null;
  const cohort = validatedDexPulseRugCheckRows(events);
  const futureForecasts = cohort.pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > registrationAt
    && Date.parse(forecast.createdAt) > boundaryAt
  ));
  const futureForecastIds = new Set(futureForecasts.map((forecast) => forecast.id));
  const discoveries = new Map(events
    .filter((event) => event.type === "discovery")
    .map((event) => [event.id, event]));
  const receipts = new Map(events
    .filter((event) => event.type === "dex-surface-pulse-rugcheck-enrichment")
    .map((event) => [`${event.registrationId}:${event.discoveryEventId}`, event]));
  const evidenceRejectionCounts = {};
  const validEvidenceByToken = new Map();
  for (const evidence of events.filter((event) => (
    event.type === "rugcheck-token-risk-snapshot"
    && Date.parse(event.availableAt ?? "") > registrationAt
    && Date.parse(event.availableAt ?? "") > boundaryAt
  ))) {
    const reason = standaloneEvidenceRejectionReason({
      evidence,
      discovery: discoveries.get(evidence.discoveryEventId),
      receipt: receipts.get(`${evidence.registrationId}:${evidence.discoveryEventId}`),
      sourceRegistration,
    });
    if (reason) {
      increment(evidenceRejectionCounts, reason);
      continue;
    }
    const rows = validEvidenceByToken.get(evidence.tokenAddress) ?? [];
    rows.push(evidence);
    validEvidenceByToken.set(evidence.tokenAddress, rows);
  }
  for (const rows of validEvidenceByToken.values()) {
    rows.sort((left, right) => Date.parse(left.availableAt) - Date.parse(right.availableAt));
  }

  const comparisonExclusionCounts = {};
  const observations = [];
  for (const row of cohort.rows) {
    if (!futureForecastIds.has(row.forecastId)) continue;
    const currentEvidence = (validEvidenceByToken.get(row.tokenAddress) ?? [])
      .find((event) => event.id === row.forecast.rugCheckEvidenceId);
    if (!currentEvidence) {
      increment(comparisonExclusionCounts, "missing-valid-current-holder-evidence");
      continue;
    }
    const currentAt = Date.parse(currentEvidence.availableAt);
    const priorEvidence = [...(validEvidenceByToken.get(row.tokenAddress) ?? [])]
      .reverse()
      .find((event) => {
        const priorAt = Date.parse(event.availableAt);
        const separation = currentAt - priorAt;
        return event.id !== currentEvidence.id
          && event.discoveryEventId !== currentEvidence.discoveryEventId
          && separation >= DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.minimumEvidenceSeparationMs
          && separation <= DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.maximumEvidenceLookbackMs
          && priorAt <= Date.parse(row.forecast.createdAt);
      });
    if (!priorEvidence) {
      increment(comparisonExclusionCounts, "missing-valid-prior-holder-evidence");
      continue;
    }
    const currentHolders = currentEvidence.aggregate.totalHolders;
    const priorHolders = priorEvidence.aggregate.totalHolders;
    if (!(Number.isInteger(currentHolders) && currentHolders > 0
      && Number.isInteger(priorHolders) && priorHolders > 0)) {
      increment(comparisonExclusionCounts, "missing-holder-count");
      continue;
    }
    const holderCountDelta = currentHolders - priorHolders;
    observations.push({
      ...row,
      priorEvidenceId: priorEvidence.id,
      currentEvidenceId: currentEvidence.id,
      priorEvidenceAvailableAt: priorEvidence.availableAt,
      currentEvidenceAvailableAt: currentEvidence.availableAt,
      evidenceSeparationMs: currentAt - Date.parse(priorEvidence.availableAt),
      priorHolders,
      currentHolders,
      holderCountDelta,
      holderGrowthPct: round6((holderCountDelta / priorHolders) * 100),
      predictedRise: holderCountDelta > 0,
    });
  }

  const frames = independentAssetFrames(observations, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weighted = frames.flat();
  const screen = summarizeFrames(frames, (row) => row.predictedRise);
  const parent = summarizeFrames(frames, () => true);
  const frameDeltas = frames.map((frame) => mean(frame.map((row) => (
    row.predictedRise ? row.baseCapacityReturnPct : 0
  ))) - mean(frame.map((row) => row.baseCapacityReturnPct)));
  const deltaCi95 = frames.length >= 2
    ? bootstrapMeanInterval(
      frameDeltas,
      DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.bootstrapIterations,
    )
    : [null, null];
  const evidenceReady = Boolean(
    registration
    && sourceRegistration
    && weighted.length >= DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.minimumMaturedForecasts
    && frames.length >= DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.minimumIndependentFrames
    && screen.uniqueTokens >= DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.minimumUniqueTokens
    && screen.observations >= DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.minimumRiseCalls
    && screen.independentTradedFrames
      >= DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.minimumIndependentTradedFrames
  );
  return {
    type: "dex-pulse-rugcheck-holder-growth-scorecard",
    ruleVersion: DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.version,
    evidenceBoundary: DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    sourceRugCheckRegistrationId: sourceRegistration?.id ?? null,
    researchOnly: true,
    mutationAllowed: false,
    posthocDerived: true,
    candidateForecasts: futureForecasts.length,
    openForecasts: futureForecasts.filter((forecast) => (
      cohort.pulse.openForecastIds.includes(forecast.id)
    )).length,
    eligibleHolderComparisons: observations.length,
    portfolioWeightedObservations: weighted.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(observations, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weighted.map(tokenEdgeAssetKey)).size,
    evidenceRejectionCounts,
    comparisonExclusionCounts,
    parent,
    screen: { id: DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.screenId, ...screen },
    pairedBootstrapMeanDeltaCi95Pct: deltaCi95.map(nullableRound),
    evidenceStatus: evidenceReady ? "audit-ready" : "collecting",
    evidenceShortfall: {
      observations: Math.max(
        0,
        DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.minimumMaturedForecasts - weighted.length,
      ),
      independentFrames: Math.max(
        0,
        DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.minimumIndependentFrames - frames.length,
      ),
      uniqueTokens: Math.max(
        0,
        DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.minimumUniqueTokens - screen.uniqueTokens,
      ),
      riseCalls: Math.max(
        0,
        DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.minimumRiseCalls - screen.observations,
      ),
      independentTradedFrames: Math.max(
        0,
        DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.minimumIndependentTradedFrames
          - screen.independentTradedFrames,
      ),
    },
    provisionalGate: Boolean(
      evidenceReady
      && deltaCi95[0] > 0
      && screen.screenAverageCapacityReturnPct > 0
      && screen.screenStressCapacityReturnPct > 0
      && screen.screenProfitFactor >= DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.minimumProfitFactor
      && screen.screenMaxDrawdownPct
        <= DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.maximumDrawdownPct
      && screen.largestWinningFrameShare
        <= DEX_PULSE_RUGCHECK_HOLDER_GROWTH_RULE.maximumLargestWinningFrameShare
    ),
    observationsDetail: observations.map((row) => ({
      forecastId: row.forecastId,
      chain: row.chain,
      tokenAddress: row.tokenAddress,
      symbol: row.forecast.symbol ?? null,
      createdAt: row.createdAt,
      priorEvidenceId: row.priorEvidenceId,
      currentEvidenceId: row.currentEvidenceId,
      evidenceSeparationMs: row.evidenceSeparationMs,
      priorHolders: row.priorHolders,
      currentHolders: row.currentHolders,
      holderCountDelta: row.holderCountDelta,
      holderGrowthPct: row.holderGrowthPct,
      predictedRise: row.predictedRise,
      grossReturnPct: row.grossReturnPct,
      baseCapacityReturnPct: row.baseCapacityReturnPct,
      stressCapacityReturnPct: row.stressCapacityReturnPct,
    })),
    note: "This future-only course-derived monitor changes one dimension: the sign of exact-mint total-holder growth across two post-registration RugCheck snapshots 10 to 30 minutes apart. It does not add price, age, risk-score, creator, or insider thresholds. Missing, stale, forged, pre-registration, identity-retaining, or non-growing evidence holds paper cash and cannot mutate or trade.",
  };
}

function standaloneEvidenceRejectionReason({
  evidence, discovery, receipt, sourceRegistration,
}) {
  if (!sourceRegistration || !matchesRugCheckRegistration(sourceRegistration)) {
    return "missing-or-invalid-source-registration";
  }
  if (evidence.provider !== "rugcheck"
    || evidence.ruleVersion !== DEX_PULSE_RUGCHECK_RULE.version
    || evidence.registrationId !== sourceRegistration.id
    || evidence.chain !== "solana"
    || evidence.aggregateOnly !== true
    || evidence.rawIdentitiesRetained !== false
    || evidence.researchOnly !== true
    || evidence.mutationAllowed !== false) return "invalid-rugcheck-evidence-contract";
  if (!discovery
    || discovery.provider !== DEX_SURFACE_PULSE_RULE.sourceProvider
    || discovery.ruleVersion !== DEX_SURFACE_PULSE_RULE.sourceRuleVersion
    || evidence.discoveryEventId !== discovery.id
    || !(discovery.candidates ?? []).some((candidate) => (
      candidate.status === "eligible"
      && candidate.chain === evidence.chain
      && candidate.tokenAddress === evidence.tokenAddress
    ))) return "invalid-source-discovery";
  const link = (receipt?.evidence ?? []).find((item) => (
    item.tokenAddress === evidence.tokenAddress
  ));
  if (!receipt
    || receipt.registrationId !== sourceRegistration.id
    || receipt.discoveryEventId !== discovery.id
    || receipt.status !== "recorded"
    || link?.evidenceEventId !== evidence.id
    || receipt.aggregateOnly !== true
    || receipt.rawIdentitiesRetained !== false
    || receipt.researchOnly !== true
    || receipt.mutationAllowed !== false) return "invalid-enrichment-link";
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  const observedAt = Date.parse(evidence.observedAt ?? "");
  const availableAt = Date.parse(evidence.availableAt ?? "");
  if (![discoveryAt, observedAt, availableAt].every(Number.isFinite)
    || observedAt < discoveryAt
    || observedAt - discoveryAt > MAX_SOURCE_LAG_MS
    || availableAt < observedAt) return "invalid-evidence-timing";
  const aggregate = canonicalRugCheckAggregate(evidence.aggregate);
  if (canonical(aggregate) !== canonical(evidence.aggregate)
    || evidence.aggregateDigest !== digestValue(aggregate)) return "invalid-rugcheck-aggregate";
  if (aggregate.coverage !== "complete" || !(aggregate.totalHolders > 0)) {
    return "missing-holder-count";
  }
  return null;
}

function summarizeFrames(frames, test) {
  const selected = frames.flatMap((frame) => frame.filter(test));
  const parentBase = frames.map((frame) => mean(frame.map((row) => row.baseCapacityReturnPct)));
  const parentStress = frames.map((frame) => mean(frame.map((row) => row.stressCapacityReturnPct)));
  const screenBase = frames.map((frame) => mean(frame.map((row) => (
    test(row) ? row.baseCapacityReturnPct : 0
  ))));
  const screenStress = frames.map((frame) => mean(frame.map((row) => (
    test(row) ? row.stressCapacityReturnPct : 0
  ))));
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
    pairedCapacityDeltaPct: nullableRound(mean(screenBase.map((value, index) => (
      value - parentBase[index]
    )))),
    parentStressCapacityReturnPct: nullableRound(mean(parentStress)),
    screenStressCapacityReturnPct: nullableRound(mean(screenStress)),
    pairedStressCapacityDeltaPct: nullableRound(mean(screenStress.map((value, index) => (
      value - parentStress[index]
    )))),
    parentProfitFactor: nullableRound(profitFactor(parentBase)),
    screenProfitFactor: nullableRound(profitFactor(screenBase)),
    parentMaxDrawdownPct: nullableRound(maxDrawdownPct(parentBase)),
    screenMaxDrawdownPct: nullableRound(maxDrawdownPct(screenBase)),
    largestWinningFrameShare: nullableRound(largestWinningShare(screenBase)),
  };
}

function bootstrapMeanInterval(values, iterations) {
  let state = 0xbb67ae85;
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

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseRugCheckHolderGrowthRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesRugCheckRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  if (event.rule?.version !== DEX_PULSE_RUGCHECK_RULE.version) return false;
  const expected = createDexPulseRugCheckRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
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

async function verifiedLedger(ledgerPath) {
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  return events;
}

function parseArgs(argv) {
  const options = { command: argv[2] ?? "score" };
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--ledger") options.ledgerPath = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "score"].includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-rugcheck-holder-growth.mjs register|score [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseRugCheckHolderGrowth(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: buildDexPulseRugCheckHolderGrowthScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
