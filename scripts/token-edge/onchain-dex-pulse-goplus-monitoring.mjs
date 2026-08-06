#!/usr/bin/env node

import { register } from "node:module";
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

register(new URL("../lib/ts-relative-loader.mjs", import.meta.url));
const { fetchGoPlusTokenSecurity } = await import(
  "../../src/lib/services/copy-trading/risk-intelligence.ts"
);

const HOUR_MS = 60 * 60_000;
const MAX_SOURCE_LAG_MS = 5 * 60_000;
const MAX_EVIDENCE_LAG_MS = 5 * 60_000;

export const DEX_PULSE_GOPLUS_RULE = Object.freeze({
  version: "dex-surface-pulse-goplus-monitoring-panel-v1",
  evidenceBoundary: "2026-08-03T13:40:00.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  provider: "goplus",
  maximumDiscoveryToCollectionLagMinutes: 5,
  maximumEvidenceToForecastLagMinutes: 5,
  screens: Object.freeze([
    Object.freeze({ id: "exact-mint-security-covered", requireCoverage: true }),
    Object.freeze({ id: "reported-holder-distribution", requireHolderDistribution: true }),
    Object.freeze({ id: "no-objective-hard-risk", requireCoverage: true, requireNoHardRisk: true }),
    Object.freeze({ id: "no-authority-caution", requireCoverage: true, requireNoCaution: true }),
    Object.freeze({
      id: "top-holder-at-most-20-percent",
      requireHolderDistribution: true,
      maximumTopHolderPctInclusive: 20,
    }),
    Object.freeze({
      id: "security-holder-consensus",
      requireCoverage: true,
      requireNoHardRisk: true,
      requireNoCaution: true,
      requireHolderDistribution: true,
      maximumTopHolderPctInclusive: 20,
    }),
  ]),
  derivationStatus: "posthoc-open-path-liquidity-collapse-hypotheses-only",
  derivationNote: "A future-only panel after one open BULLVI path lost reported holder data while its pool collapsed. The 20% top-holder cap is a round, unoptimized risk bound; the inspected token and every earlier row are excluded.",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseGoPlusRegistrationEvent(registeredAt = new Date()) {
  const registeredAtIso = validIso(registeredAt);
  const spec = { rule: DEX_PULSE_GOPLUS_RULE, researchOnly: true, mutationAllowed: false };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: registeredAtIso,
    status: "frozen",
    ...spec,
  };
}

export async function registerDexPulseGoPlus(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseGoPlusRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(DEX_PULSE_GOPLUS_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse GoPlus registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error("Existing DEX pulse GoPlus registration mismatch.");
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

export async function enrichDexSurfacePulseWithGoPlus(options = {}, dependencies = {}) {
  const now = dependencies.now ?? new Date();
  const responseNow = dependencies.responseNow ?? (() => new Date());
  const securityReader = dependencies.securityReader ?? fetchGoPlusTokenSecurity;
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matchesRegistration);
  if (!registration) throw new Error("Register the DEX pulse GoPlus policy before enrichment.");
  const discovery = [...events].reverse().find((event) => (
    event.type === "discovery"
    && event.provider === DEX_SURFACE_PULSE_RULE.sourceProvider
    && event.ruleVersion === DEX_SURFACE_PULSE_RULE.sourceRuleVersion
  ));
  if (!discovery) return enrichmentResult(ledgerPath, now, "no-source-discovery", null, null);
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  if (!(discoveryAt > Date.parse(registration.registeredAt)
    && discoveryAt > Date.parse(DEX_PULSE_GOPLUS_RULE.evidenceBoundary))) {
    return enrichmentResult(ledgerPath, now, "source-not-strictly-future", discovery.id, null);
  }
  if (now.getTime() < discoveryAt || now.getTime() - discoveryAt > MAX_SOURCE_LAG_MS) {
    return enrichmentResult(ledgerPath, now, "source-outside-enrichment-window", discovery.id, null);
  }
  const existing = events.find((event) => (
    event.type === "dex-surface-pulse-goplus-enrichment"
    && event.registrationId === registration.id
    && event.discoveryEventId === discovery.id
  ));
  if (existing) {
    return enrichmentResult(
      ledgerPath, now, "skipped-existing-discovery", discovery.id, existing,
    );
  }
  const tokenAddresses = [...new Set((discovery.candidates ?? []).filter((candidate) => (
    candidate.status === "eligible" && candidate.chain === "solana"
  )).map((candidate) => candidate.tokenAddress))];
  if (!tokenAddresses.length) {
    return enrichmentResult(ledgerPath, now, "no-eligible-candidates", discovery.id, null);
  }
  const maximum = finiteInteger(options.maxRequests) ?? 10;
  if (tokenAddresses.length > maximum) {
    throw new Error(`GoPlus enrichment requires ${tokenAddresses.length} requests; budget is ${maximum}.`);
  }
  let succeeded = 0;
  let failed = 0;
  const evidence = [];
  const evidenceAvailableAt = [];
  for (const tokenAddress of tokenAddresses) {
    let security;
    try {
      security = normalizeSecurity(await securityReader("solana:mainnet", tokenAddress));
      succeeded += 1;
    } catch {
      security = unavailableSecurity();
      failed += 1;
    }
    const availableAt = validIso(responseNow());
    evidenceAvailableAt.push(availableAt);
    const source = {
      type: "goplus-token-security-snapshot",
      id: `goplus_token_security_${digestValue({
        registrationId: registration.id,
        discoveryEventId: discovery.id,
        tokenAddress,
      }).slice(0, 24)}`,
      ruleVersion: DEX_PULSE_GOPLUS_RULE.version,
      registrationId: registration.id,
      discoveryEventId: discovery.id,
      provider: "goplus",
      chain: "solana",
      tokenAddress,
      observedAt: now.toISOString(),
      availableAt,
      security,
      securityDigest: digestValue(security),
      researchOnly: true,
      mutationAllowed: false,
    };
    const signed = await appendUnique(ledgerPath, events, source);
    evidence.push({ tokenAddress, evidenceEventId: signed.id, coverage: security.coverage });
  }
  const receipt = {
    type: "dex-surface-pulse-goplus-enrichment",
    id: `dex_surface_pulse_goplus_enrichment_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    }).slice(0, 24)}`,
    ruleVersion: DEX_PULSE_GOPLUS_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    collectionStartedAt: now.toISOString(),
    availableAt: latestIso(evidenceAvailableAt),
    status: "recorded",
    tokenCount: tokenAddresses.length,
    evidence,
    requestBudget: {
      maximum,
      attempted: tokenAddresses.length,
      succeeded,
      failed,
    },
    researchOnly: true,
    mutationAllowed: false,
  };
  const signedReceipt = await appendLedgerEvent(ledgerPath, receipt);
  return enrichmentResult(ledgerPath, now, signedReceipt.status, discovery.id, signedReceipt);
}

export function buildDexPulseGoPlusScorecard(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const evidenceEvents = new Map(events
    .filter((event) => event.type === "goplus-token-security-snapshot")
    .map((event) => [event.id, event]));
  const receipts = new Map(events
    .filter((event) => event.type === "dex-surface-pulse-goplus-enrichment")
    .map((event) => [event.id, event]));
  const rejectionCounts = {};
  const rows = [];
  for (const row of pulse.rows) {
    if (!(Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? ""))) continue;
    const forecast = row.forecast;
    const receipt = receipts.get(forecast.goPlusEnrichmentReceiptId);
    const evidence = evidenceEvents.get(forecast.goPlusEvidenceId);
    const reason = goPlusRowRejectionReason({ forecast, receipt, evidence, registration });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      ...row,
      securityCoverage: evidence.security.coverage,
      hardRiskCount: evidence.security.hardRiskFlags.length,
      cautionCount: evidence.security.cautionFlags.length,
      holderConcentrationPct: finiteNumber(evidence.security.holderConcentrationPct),
    });
  }
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  return {
    type: "dex-surface-pulse-goplus-monitoring-scorecard",
    ruleVersion: DEX_PULSE_GOPLUS_RULE.version,
    evidenceBoundary: DEX_PULSE_GOPLUS_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    researchOnly: true,
    mutationAllowed: false,
    candidateForecasts: pulse.forecasts.filter((forecast) => (
      Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
    )).length,
    openForecasts: pulse.forecasts.filter((forecast) => (
      Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
      && pulse.openForecastIds.includes(forecast.id)
    )).length,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    rejectionCounts,
    parent: summarizeFrames(frames, () => true),
    screens: DEX_PULSE_GOPLUS_RULE.screens.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, (row) => passesGoPlusScreen(row, screen)),
    })),
    note: "Exact-mint GoPlus security evidence is tested only on future fixed-cadence DEX pulse forecasts. Missing provider or holder evidence fails screens closed; a safety screen can abstain but cannot mutate a forecast or authorize a trade.",
  };
}

export function passesGoPlusScreen(row, screen) {
  return (!screen.requireCoverage || row.securityCoverage === "complete")
    && (!screen.requireNoHardRisk || row.hardRiskCount === 0)
    && (!screen.requireNoCaution || row.cautionCount === 0)
    && (!screen.requireHolderDistribution || Number.isFinite(row.holderConcentrationPct))
    && (!Object.hasOwn(screen, "maximumTopHolderPctInclusive")
      || (Number.isFinite(row.holderConcentrationPct)
        && row.holderConcentrationPct <= screen.maximumTopHolderPctInclusive));
}

function goPlusRowRejectionReason({ forecast, receipt, evidence, registration }) {
  if (!registration || !matchesRegistration(registration)) return "missing-or-invalid-registration";
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))) {
    return "not-strictly-future";
  }
  if (!receipt || receipt.type !== "dex-surface-pulse-goplus-enrichment"
    || receipt.registrationId !== registration.id
    || receipt.discoveryEventId !== forecast.discoveryEventId
    || receipt.status !== "recorded"
    || receipt.researchOnly !== true
    || receipt.mutationAllowed !== false) return "missing-or-invalid-enrichment";
  const link = (receipt.evidence ?? []).find((item) => item.tokenAddress === forecast.tokenAddress);
  if (!evidence || link?.evidenceEventId !== evidence.id
    || evidence.type !== "goplus-token-security-snapshot"
    || evidence.provider !== "goplus"
    || evidence.registrationId !== registration.id
    || evidence.discoveryEventId !== forecast.discoveryEventId
    || evidence.chain !== forecast.chain
    || evidence.tokenAddress !== forecast.tokenAddress
    || evidence.ruleVersion !== DEX_PULSE_GOPLUS_RULE.version
    || evidence.researchOnly !== true
    || evidence.mutationAllowed !== false) return "missing-or-mismatched-exact-mint-evidence";
  const availableAt = Date.parse(evidence.availableAt ?? "");
  const createdAt = Date.parse(forecast.createdAt);
  if (!(availableAt > Date.parse(registration.registeredAt)
    && availableAt <= createdAt
    && createdAt - availableAt <= MAX_EVIDENCE_LAG_MS)) return "invalid-evidence-timing";
  const security = normalizeSecurity(evidence.security);
  if (canonical(security) !== canonical(evidence.security)
    || evidence.securityDigest !== digestValue(security)) return "invalid-security-evidence";
  return null;
}

function normalizeSecurity(value) {
  const coverage = ["complete", "partial", "unavailable"].includes(value?.coverage)
    ? value.coverage
    : "unavailable";
  const holder = value?.holderConcentrationPct == null
    ? null
    : Number(value.holderConcentrationPct);
  return {
    provider: "goplus",
    coverage,
    hardRiskFlags: stringArray(value?.hardRiskFlags),
    cautionFlags: stringArray(value?.cautionFlags),
    holderConcentrationPct: Number.isFinite(holder) && holder >= 0 && holder <= 100
      ? round6(holder)
      : null,
    buyTaxPct: finiteNumber(value?.buyTaxPct),
    sellTaxPct: finiteNumber(value?.sellTaxPct),
  };
}

function unavailableSecurity() {
  return normalizeSecurity({ coverage: "unavailable" });
}

function stringArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string"))].sort()
    : [];
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
      ? selected.filter((row) => row.grossReturnPct > 0).length / selected.length
      : null),
    netWinRate: nullableRound(selected.length
      ? selected.filter((row) => row.baseCapacityReturnPct > 0).length / selected.length
      : null),
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
  if (existing && existing.digest !== proposed.digest) {
    throw new Error(`Existing event identity mismatch: ${event.id}`);
  }
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
    requestBudget: receipt?.requestBudget ?? {
      maximum: 0, attempted: 0, succeeded: 0, failed: 0,
    },
  };
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseGoPlusRegistrationEvent(event.registeredAt);
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

function finiteInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
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
    else if (argv[index] === "--max-goplus-requests") options.maxRequests = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "enrich", "score"].includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-goplus-monitoring.mjs register|enrich|score [--max-goplus-requests 10] [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseGoPlus(options), null, 2));
    } else if (options.command === "enrich") {
      console.log(JSON.stringify(await enrichDexSurfacePulseWithGoPlus(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: { ok: true, errors: [], eventCount: events.length },
        scorecard: buildDexPulseGoPlusScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
