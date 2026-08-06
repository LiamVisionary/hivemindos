#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendLedgerEvent,
  digestValue,
  eventWithIntegrity,
  readLedger,
  verifyLedger,
} from "./onchain-forward-core.mjs";
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
const MAX_SOURCE_LAG_MS = 5 * 60_000;
const MAX_EVIDENCE_LAG_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 12_000;

export const DEX_PULSE_RUGCHECK_RULE = Object.freeze({
  version: "dex-surface-pulse-rugcheck-monitoring-panel-v1",
  evidenceBoundary: "2026-08-03T14:51:30.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  provider: "rugcheck",
  maximumDiscoveryToCollectionLagMinutes: 5,
  maximumEvidenceToForecastLagMinutes: 5,
  screens: Object.freeze([
    Object.freeze({ id: "exact-rugcheck-covered", requireCoverage: true }),
    Object.freeze({ id: "no-danger-risks", requireCoverage: true, requireNoDanger: true }),
    Object.freeze({
      id: "low-provider-risk-score",
      requireCoverage: true,
      maximumNormalizedScoreInclusive: 20,
    }),
    Object.freeze({ id: "no-insider-graph", requireCoverage: true, maximumInsidersInclusive: 0 }),
    Object.freeze({
      id: "main-liquidity-locked",
      requireCoverage: true,
      minimumMainPairLockedPctInclusive: 90,
    }),
    Object.freeze({
      id: "strict-rugcheck-consensus",
      requireCoverage: true,
      requireNotRugged: true,
      requireNoDanger: true,
      maximumNormalizedScoreInclusive: 20,
      maximumInsidersInclusive: 0,
      minimumMainPairLockedPctInclusive: 90,
    }),
  ]),
  derivationStatus: "posthoc-open-path-collapse-hypotheses-only",
  derivationNote: "A future-only aggregate risk panel derived after EVILSHIB lost about 97.8% on an open path. EVILSHIB and every token inspected before registration are excluded. Thresholds are round, frozen hypotheses rather than fitted promotion evidence.",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseRugCheckRegistrationEvent(registeredAt = new Date()) {
  const spec = { rule: DEX_PULSE_RUGCHECK_RULE, researchOnly: true, mutationAllowed: false };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export async function registerDexPulseRugCheck(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseRugCheckRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(DEX_PULSE_RUGCHECK_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse RugCheck registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error("Existing DEX pulse RugCheck registration mismatch.");
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

export async function enrichDexSurfacePulseWithRugCheck(options = {}, dependencies = {}) {
  const now = dependencies.now ?? new Date();
  const responseNow = dependencies.responseNow ?? (() => new Date());
  const reportReader = dependencies.reportReader ?? readRugCheckReport;
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matchesRegistration);
  if (!registration) throw new Error("Register the DEX pulse RugCheck policy before enrichment.");
  const discovery = [...events].reverse().find((event) => (
    event.type === "discovery"
    && event.provider === DEX_SURFACE_PULSE_RULE.sourceProvider
    && event.ruleVersion === DEX_SURFACE_PULSE_RULE.sourceRuleVersion
  ));
  if (!discovery) return enrichmentResult(ledgerPath, now, "no-source-discovery", null, null);
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  if (!(discoveryAt > Date.parse(registration.registeredAt)
    && discoveryAt > Date.parse(DEX_PULSE_RUGCHECK_RULE.evidenceBoundary))) {
    return enrichmentResult(ledgerPath, now, "source-not-strictly-future", discovery.id, null);
  }
  if (now.getTime() < discoveryAt || now.getTime() - discoveryAt > MAX_SOURCE_LAG_MS) {
    return enrichmentResult(ledgerPath, now, "source-outside-enrichment-window", discovery.id, null);
  }
  const existing = events.find((event) => (
    event.type === "dex-surface-pulse-rugcheck-enrichment"
    && event.registrationId === registration.id
    && event.discoveryEventId === discovery.id
  ));
  if (existing) return enrichmentResult(ledgerPath, now, "skipped-existing-discovery", discovery.id, existing);
  const candidates = (discovery.candidates ?? []).filter((candidate) => (
    candidate.status === "eligible" && candidate.chain === "solana"
  ));
  const uniqueCandidates = [...new Map(candidates.map((candidate) => (
    [candidate.tokenAddress, candidate]
  ))).values()];
  if (!uniqueCandidates.length) {
    return enrichmentResult(ledgerPath, now, "no-eligible-candidates", discovery.id, null);
  }
  const maximum = finiteInteger(options.maxRequests) ?? 10;
  if (uniqueCandidates.length > maximum) {
    throw new Error(`RugCheck enrichment requires ${uniqueCandidates.length} requests; budget is ${maximum}.`);
  }
  let succeeded = 0;
  let failed = 0;
  const evidence = [];
  const evidenceAvailableAt = [];
  for (const candidate of uniqueCandidates) {
    let aggregate;
    try {
      aggregate = normalizeRugCheckReportAggregate(
        await reportReader(candidate.tokenAddress),
        candidate.tokenAddress,
        candidate.pairAddress,
      );
      succeeded += aggregate.coverage === "complete" ? 1 : 0;
      failed += aggregate.coverage === "complete" ? 0 : 1;
    } catch {
      aggregate = unavailableAggregate();
      failed += 1;
    }
    const availableAt = validIso(responseNow());
    evidenceAvailableAt.push(availableAt);
    const source = {
      type: "rugcheck-token-risk-snapshot",
      id: `rugcheck_token_risk_${digestValue({
        registrationId: registration.id,
        discoveryEventId: discovery.id,
        tokenAddress: candidate.tokenAddress,
      }).slice(0, 24)}`,
      ruleVersion: DEX_PULSE_RUGCHECK_RULE.version,
      registrationId: registration.id,
      discoveryEventId: discovery.id,
      provider: "rugcheck",
      chain: "solana",
      tokenAddress: candidate.tokenAddress,
      observedAt: now.toISOString(),
      availableAt,
      aggregate,
      aggregateDigest: digestValue(aggregate),
      aggregateOnly: true,
      rawIdentitiesRetained: false,
      researchOnly: true,
      mutationAllowed: false,
    };
    const signed = await appendUnique(ledgerPath, events, source);
    evidence.push({
      tokenAddress: candidate.tokenAddress,
      evidenceEventId: signed.id,
      coverage: aggregate.coverage,
    });
  }
  const receipt = {
    type: "dex-surface-pulse-rugcheck-enrichment",
    id: `dex_surface_pulse_rugcheck_enrichment_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    }).slice(0, 24)}`,
    ruleVersion: DEX_PULSE_RUGCHECK_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    collectionStartedAt: now.toISOString(),
    availableAt: latestIso(evidenceAvailableAt),
    status: "recorded",
    tokenCount: uniqueCandidates.length,
    evidence,
    requestBudget: { maximum, attempted: uniqueCandidates.length, succeeded, failed },
    aggregateOnly: true,
    rawIdentitiesRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
  const signedReceipt = await appendLedgerEvent(ledgerPath, receipt);
  return enrichmentResult(ledgerPath, now, signedReceipt.status, discovery.id, signedReceipt);
}

export function buildDexPulseRugCheckScorecard(events) {
  const cohort = validatedDexPulseRugCheckRows(events);
  const {
    registration, pulse, rejectionCounts, rows, futureForecasts,
  } = cohort;
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  return {
    type: "dex-surface-pulse-rugcheck-monitoring-scorecard",
    ruleVersion: DEX_PULSE_RUGCHECK_RULE.version,
    evidenceBoundary: DEX_PULSE_RUGCHECK_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    researchOnly: true,
    mutationAllowed: false,
    candidateForecasts: futureForecasts.length,
    openForecasts: futureForecasts.filter((forecast) => pulse.openForecastIds.includes(forecast.id)).length,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    rejectionCounts,
    parent: summarizeFrames(frames, () => true),
    screens: DEX_PULSE_RUGCHECK_RULE.screens.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, (row) => passesRugCheckScreen(row, screen)),
    })),
    note: "Exact-mint RugCheck responses are reduced to aggregate risk counts, scores, and same-pair liquidity-lock statistics before append. Missing evidence fails screens closed; screens can abstain on paper but cannot mutate forecasts or authorize trades.",
  };
}

export function validatedDexPulseRugCheckRows(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const evidenceEvents = new Map(events
    .filter((event) => event.type === "rugcheck-token-risk-snapshot")
    .map((event) => [event.id, event]));
  const receipts = new Map(events
    .filter((event) => event.type === "dex-surface-pulse-rugcheck-enrichment")
    .map((event) => [event.id, event]));
  const rejectionCounts = {};
  const rows = [];
  for (const row of pulse.rows) {
    if (!(Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? ""))) continue;
    const forecast = row.forecast;
    const receipt = receipts.get(forecast.rugCheckEnrichmentReceiptId);
    const evidence = evidenceEvents.get(forecast.rugCheckEvidenceId);
    const reason = rugCheckRowRejectionReason({ forecast, receipt, evidence, registration });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      ...row,
      rugCheck: evidence.aggregate,
      rugCheckEvidence: evidence,
      rugCheckReceipt: receipt,
    });
  }
  const futureForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  return {
    registration,
    pulse,
    rejectionCounts,
    rows,
    futureForecasts,
  };
}

export function passesRugCheckScreen(row, screen) {
  const aggregate = row.rugCheck;
  return (!screen.requireCoverage || aggregate.coverage === "complete")
    && (!screen.requireNotRugged || aggregate.rugged === false)
    && (!screen.requireNoDanger || aggregate.dangerRiskCount === 0)
    && (!Object.hasOwn(screen, "maximumNormalizedScoreInclusive")
      || (Number.isFinite(aggregate.normalizedRiskScore)
        && aggregate.normalizedRiskScore <= screen.maximumNormalizedScoreInclusive))
    && (!Object.hasOwn(screen, "maximumInsidersInclusive")
      || (Number.isFinite(aggregate.graphInsidersDetected)
        && aggregate.graphInsidersDetected <= screen.maximumInsidersInclusive))
    && (!Object.hasOwn(screen, "minimumMainPairLockedPctInclusive")
      || (Number.isFinite(aggregate.mainPairLockedPct)
        && aggregate.mainPairLockedPct >= screen.minimumMainPairLockedPctInclusive));
}

export async function readRugCheckReport(tokenAddress) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(tokenAddress)}/report`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`RugCheck request failed with HTTP ${response.status}.`);
    const report = await response.json();
    if (!report || typeof report !== "object") throw new Error("RugCheck returned an invalid report.");
    return report;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeRugCheckReportAggregate(report, tokenAddress, pairAddress) {
  if (report?.mint !== tokenAddress) throw new Error("RugCheck returned a mismatched mint.");
  const risks = Array.isArray(report.risks) ? report.risks : [];
  const dangerRisks = risks.filter((risk) => String(risk?.level ?? "").toLowerCase() === "danger");
  const warningRisks = risks.filter((risk) => String(risk?.level ?? "").toLowerCase() === "warn");
  const market = (Array.isArray(report.markets) ? report.markets : [])
    .find((candidate) => candidate?.pubkey === pairAddress);
  const insiderNetworks = Array.isArray(report.insiderNetworks)
    ? report.insiderNetworks
    : (Array.isArray(report.graphInsiderReport) ? report.graphInsiderReport : []);
  const supply = finitePositive(report?.token?.supply ?? report?.tokenMeta?.supply ?? report?.supply);
  const creatorBalance = finiteNumber(report.creatorBalance);
  return canonicalRugCheckAggregate({
    coverage: "complete",
    normalizedRiskScore: finiteNumber(report.score_normalised),
    rugged: typeof report.rugged === "boolean" ? report.rugged : null,
    dangerRiskCount: dangerRisks.length,
    warningRiskCount: warningRisks.length,
    dangerRiskNames: dangerRisks.map((risk) => risk?.name).filter((name) => typeof name === "string"),
    graphInsidersDetected: finiteNumber(report.graphInsidersDetected),
    insiderNetworkCount: insiderNetworks.length,
    maximumInsiderNetworkSize: maximum(insiderNetworks.map((network) => (
      finiteNumber(network?.size ?? network?.tokenAccounts ?? network?.accounts?.length)
    ))),
    totalHolders: finiteNumber(report.totalHolders),
    creatorBalancePct: Number.isFinite(creatorBalance) && Number.isFinite(supply)
      ? (creatorBalance / supply) * 100 : null,
    mainPairLockedPct: finiteNumber(market?.lp?.lpLockedPct),
    mainPairLockedUsd: finiteNumber(market?.lp?.lpLockedUSD),
    reportDetectedAt: validOptionalIso(report.detectedAt),
  });
}

function unavailableAggregate() {
  return canonicalRugCheckAggregate({ coverage: "unavailable" });
}

export function canonicalRugCheckAggregate(value) {
  return {
    coverage: value?.coverage === "complete" ? "complete" : "unavailable",
    normalizedRiskScore: boundedNonnegative(value?.normalizedRiskScore),
    rugged: typeof value?.rugged === "boolean" ? value.rugged : null,
    dangerRiskCount: nonnegativeInteger(value?.dangerRiskCount),
    warningRiskCount: nonnegativeInteger(value?.warningRiskCount),
    dangerRiskNames: stringArray(value?.dangerRiskNames),
    graphInsidersDetected: nonnegativeInteger(value?.graphInsidersDetected),
    insiderNetworkCount: nonnegativeInteger(value?.insiderNetworkCount),
    maximumInsiderNetworkSize: nonnegativeInteger(value?.maximumInsiderNetworkSize),
    totalHolders: nonnegativeInteger(value?.totalHolders),
    creatorBalancePct: percentage(value?.creatorBalancePct),
    mainPairLockedPct: percentage(value?.mainPairLockedPct),
    mainPairLockedUsd: boundedNonnegative(value?.mainPairLockedUsd),
    reportDetectedAt: validOptionalIso(value?.reportDetectedAt),
  };
}

function rugCheckRowRejectionReason({ forecast, receipt, evidence, registration }) {
  if (!registration || !matchesRegistration(registration)) return "missing-or-invalid-registration";
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))) return "not-strictly-future";
  if (!receipt || receipt.type !== "dex-surface-pulse-rugcheck-enrichment"
    || receipt.registrationId !== registration.id
    || receipt.discoveryEventId !== forecast.discoveryEventId
    || receipt.status !== "recorded"
    || receipt.aggregateOnly !== true
    || receipt.rawIdentitiesRetained !== false
    || receipt.researchOnly !== true
    || receipt.mutationAllowed !== false) return "missing-or-invalid-enrichment";
  const link = (receipt.evidence ?? []).find((item) => item.tokenAddress === forecast.tokenAddress);
  if (!evidence || link?.evidenceEventId !== evidence.id
    || evidence.type !== "rugcheck-token-risk-snapshot"
    || evidence.provider !== "rugcheck"
    || evidence.registrationId !== registration.id
    || evidence.discoveryEventId !== forecast.discoveryEventId
    || evidence.chain !== forecast.chain
    || evidence.tokenAddress !== forecast.tokenAddress
    || evidence.ruleVersion !== DEX_PULSE_RUGCHECK_RULE.version
    || evidence.aggregateOnly !== true
    || evidence.rawIdentitiesRetained !== false
    || evidence.researchOnly !== true
    || evidence.mutationAllowed !== false) return "missing-or-mismatched-exact-mint-evidence";
  const availableAt = Date.parse(evidence.availableAt ?? "");
  const createdAt = Date.parse(forecast.createdAt);
  if (!(availableAt > Date.parse(registration.registeredAt)
    && availableAt <= createdAt
    && createdAt - availableAt <= MAX_EVIDENCE_LAG_MS)) return "invalid-evidence-timing";
  const aggregate = canonicalRugCheckAggregate(evidence.aggregate);
  if (canonical(aggregate) !== canonical(evidence.aggregate)
    || evidence.aggregateDigest !== digestValue(aggregate)) return "invalid-rugcheck-aggregate";
  return null;
}

function summarizeFrames(frames, test) {
  const selected = frames.flatMap((frame) => frame.filter(test));
  const parentBase = frames.map((frame) => mean(frame.map((row) => row.baseCapacityReturnPct)));
  const parentStress = frames.map((frame) => mean(frame.map((row) => row.stressCapacityReturnPct)));
  const screenBase = frames.map((frame) => mean(frame.map((row) => test(row) ? row.baseCapacityReturnPct : 0)));
  const screenStress = frames.map((frame) => mean(frame.map((row) => test(row) ? row.stressCapacityReturnPct : 0)));
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

async function appendUnique(ledgerPath, events, event) {
  const proposed = eventWithIntegrity(event);
  const existing = events.find((candidate) => candidate.id === event.id);
  if (existing && existing.digest !== proposed.digest) throw new Error(`Existing event identity mismatch: ${event.id}`);
  const signed = existing ?? await appendLedgerEvent(ledgerPath, event);
  if (!existing) events.push(signed);
  return signed;
}

function enrichmentResult(ledgerPath, now, status, discoveryEventId, receipt) {
  return {
    ledgerPath,
    checkedAt: now.toISOString(),
    status,
    discoveryEventId,
    receiptId: receipt?.id ?? null,
    tokenCount: receipt?.tokenCount ?? 0,
    evidence: receipt?.evidence ?? [],
    requestBudget: receipt?.requestBudget ?? { maximum: 0, attempted: 0, succeeded: 0, failed: 0 },
  };
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseRugCheckRegistrationEvent(event.registeredAt);
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

function maximum(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
}

function finiteInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finitePositive(value) {
  const number = finiteNumber(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function boundedNonnegative(value) {
  const number = finiteNumber(value);
  return Number.isFinite(number) && number >= 0 ? round6(number) : null;
}

function percentage(value) {
  const number = finiteNumber(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? round6(number) : null;
}

function stringArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string"))].sort()
    : [];
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function pairedMean(left, right) {
  return mean(left.map((value, index) => (
    Number.isFinite(value) && Number.isFinite(right[index]) ? value - right[index] : null
  )));
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
  let maximumDrawdown = 0;
  for (const value of values) {
    equity *= Math.max(0, 1 + (value / 100));
    peak = Math.max(peak, equity);
    maximumDrawdown = Math.max(maximumDrawdown, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }
  return maximumDrawdown;
}

function largestWinningShare(values) {
  const winners = values.filter((value) => value > 0);
  const total = winners.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...winners) / total : null;
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

function validOptionalIso(value) {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function latestIso(values) {
  const milliseconds = values.map((value) => Date.parse(value)).filter(Number.isFinite);
  if (!milliseconds.length) throw new Error("Expected at least one evidence availability time.");
  return new Date(Math.max(...milliseconds)).toISOString();
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonical(value[key])}`
  )).join(",")}}`;
  return JSON.stringify(value);
}

function parseArgs(argv) {
  const options = { command: argv[2] ?? "score" };
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--ledger") options.ledgerPath = argv[++index];
    else if (argv[index] === "--max-rugcheck-requests") options.maxRequests = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "enrich", "score"].includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-rugcheck-monitoring.mjs register|enrich|score [--max-rugcheck-requests 10] [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseRugCheck(options), null, 2));
    } else if (options.command === "enrich") {
      console.log(JSON.stringify(await enrichDexSurfacePulseWithRugCheck(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: { ok: true, errors: [], eventCount: events.length },
        scorecard: buildDexPulseRugCheckScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
