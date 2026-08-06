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
import { readRugCheckReport } from "./onchain-dex-pulse-rugcheck-monitoring.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const MAX_SOURCE_LAG_MS = 5 * 60_000;
const MAX_EVIDENCE_LAG_MS = 5 * 60_000;

export const DEX_PULSE_RUGCHECK_MARKET_STRUCTURE_RULE = Object.freeze({
  version: "dex-surface-pulse-rugcheck-market-structure-panel-v1",
  evidenceBoundary: "2026-08-03T19:48:15.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  provider: "rugcheck",
  maximumDiscoveryToCollectionLagMinutes: 5,
  maximumEvidenceToForecastLagMinutes: 5,
  screens: Object.freeze([
    Object.freeze({ id: "known-account-adjusted-top20-at-most-30-percent", maximumUnknownTop20PctInclusive: 30 }),
    Object.freeze({ id: "multiple-reported-markets", minimumMarketCountInclusive: 2 }),
    Object.freeze({ id: "multiple-reported-market-types", minimumDistinctMarketTypeCountInclusive: 2 }),
    Object.freeze({ id: "mint-and-freeze-authorities-revoked", requireRevokedTokenAuthorities: true }),
    Object.freeze({ id: "immutable-token-metadata", requireImmutableMetadata: true }),
    Object.freeze({ id: "pumpfun-amm-present", requirePumpFunAmm: true }),
  ]),
  derivationStatus: "posthoc-provider-field-audit-future-only",
  derivationNote: "RugCheck market-structure fields were inspected after open 19:40-19:45 paths. Those discoveries and forecasts are excluded. Each screen tests one separately declared aggregate dimension; the panel is multiple-testing research and cannot promote a model by itself.",
  privacyPolicy: Object.freeze({
    rawHolderAddressesRetained: false,
    rawOwnerAddressesRetained: false,
    rawKnownAccountsRetained: false,
    aggregateOnly: true,
  }),
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseRugCheckMarketStructureRegistrationEvent(registeredAt = new Date()) {
  const spec = {
    rule: DEX_PULSE_RUGCHECK_MARKET_STRUCTURE_RULE,
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

export async function registerDexPulseRugCheckMarketStructure(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseRugCheckMarketStructureRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt) > Date.parse(
    DEX_PULSE_RUGCHECK_MARKET_STRUCTURE_RULE.evidenceBoundary,
  ))) {
    throw new Error("DEX pulse RugCheck market-structure registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error("Existing DEX pulse RugCheck market-structure registration mismatch.");
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

export async function enrichDexSurfacePulseWithRugCheckMarketStructure(options = {}, dependencies = {}) {
  const now = dependencies.now ?? new Date();
  const responseNow = dependencies.responseNow ?? (() => new Date());
  const reportReader = dependencies.reportReader ?? readRugCheckReport;
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matchesRegistration);
  if (!registration) throw new Error("Register the DEX pulse RugCheck market-structure policy before enrichment.");
  const discovery = [...events].reverse().find((event) => (
    event.type === "discovery"
    && event.provider === DEX_SURFACE_PULSE_RULE.sourceProvider
    && event.ruleVersion === DEX_SURFACE_PULSE_RULE.sourceRuleVersion
  ));
  if (!discovery) return enrichmentResult(ledgerPath, now, "no-source-discovery", null, null);
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  if (!(discoveryAt > Date.parse(registration.registeredAt)
    && discoveryAt > Date.parse(DEX_PULSE_RUGCHECK_MARKET_STRUCTURE_RULE.evidenceBoundary))) {
    return enrichmentResult(ledgerPath, now, "source-not-strictly-future", discovery.id, null);
  }
  if (now.getTime() < discoveryAt || now.getTime() - discoveryAt > MAX_SOURCE_LAG_MS) {
    return enrichmentResult(ledgerPath, now, "source-outside-enrichment-window", discovery.id, null);
  }
  const existing = events.find((event) => (
    event.type === "dex-surface-pulse-rugcheck-market-structure-enrichment"
    && event.registrationId === registration.id
    && event.discoveryEventId === discovery.id
  ));
  if (existing) return enrichmentResult(ledgerPath, now, "skipped-existing-discovery", discovery.id, existing);
  const candidates = [...new Map((discovery.candidates ?? [])
    .filter((candidate) => candidate.status === "eligible" && candidate.chain === "solana")
    .map((candidate) => [candidate.tokenAddress, candidate])).values()];
  if (!candidates.length) {
    return enrichmentResult(ledgerPath, now, "no-eligible-candidates", discovery.id, null);
  }
  const maximum = finiteInteger(options.maxRequests) ?? 10;
  if (candidates.length > maximum) {
    throw new Error(`RugCheck market-structure enrichment requires ${candidates.length} requests; budget is ${maximum}.`);
  }

  let succeeded = 0;
  let failed = 0;
  const evidence = [];
  const evidenceAvailableAt = [];
  for (const candidate of candidates) {
    let aggregate;
    try {
      aggregate = normalizeRugCheckMarketStructure(
        await reportReader(candidate.tokenAddress),
        candidate.tokenAddress,
      );
      succeeded += 1;
    } catch {
      aggregate = unavailableAggregate();
      failed += 1;
    }
    const availableAt = validIso(responseNow());
    evidenceAvailableAt.push(availableAt);
    const source = {
      type: "rugcheck-market-structure-snapshot",
      id: `rugcheck_market_structure_${digestValue({
        registrationId: registration.id,
        discoveryEventId: discovery.id,
        tokenAddress: candidate.tokenAddress,
      }).slice(0, 24)}`,
      ruleVersion: DEX_PULSE_RUGCHECK_MARKET_STRUCTURE_RULE.version,
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
    type: "dex-surface-pulse-rugcheck-market-structure-enrichment",
    id: `dex_surface_pulse_rugcheck_market_structure_enrichment_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    }).slice(0, 24)}`,
    ruleVersion: DEX_PULSE_RUGCHECK_MARKET_STRUCTURE_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    collectionStartedAt: now.toISOString(),
    availableAt: latestIso(evidenceAvailableAt),
    status: "recorded",
    tokenCount: candidates.length,
    evidence,
    requestBudget: { maximum, attempted: candidates.length, succeeded, failed },
    aggregateOnly: true,
    rawIdentitiesRetained: false,
    researchOnly: true,
    mutationAllowed: false,
  };
  const signedReceipt = await appendLedgerEvent(ledgerPath, receipt);
  return enrichmentResult(ledgerPath, now, signedReceipt.status, discovery.id, signedReceipt);
}

export function normalizeRugCheckMarketStructure(report, tokenAddress) {
  if (report?.mint !== tokenAddress) throw new Error("RugCheck returned a mismatched mint.");
  const holders = Array.isArray(report.topHolders) ? report.topHolders : [];
  const knownAccounts = new Set(Object.keys(report.knownAccounts ?? {}));
  const knownHolder = (holder) => knownAccounts.has(holder?.address) || knownAccounts.has(holder?.owner);
  const holderPct = (holder) => percentageValue(holder?.pct) ?? 0;
  const knownAccountTop20Pct = holders.filter(knownHolder)
    .reduce((sum, holder) => sum + holderPct(holder), 0);
  const unknownTop20Pct = holders.filter((holder) => !knownHolder(holder))
    .reduce((sum, holder) => sum + holderPct(holder), 0);
  const insiderTop20Pct = holders.filter((holder) => holder?.insider === true)
    .reduce((sum, holder) => sum + holderPct(holder), 0);
  const markets = Array.isArray(report.markets) ? report.markets : [];
  const marketTypes = [...new Set(markets
    .map((market) => typeof market?.marketType === "string" ? market.marketType : null)
    .filter(Boolean))].sort();
  return canonicalRugCheckMarketStructure({
    coverage: "complete",
    top20HolderCount: holders.length,
    totalTop20Pct: knownAccountTop20Pct + unknownTop20Pct,
    knownAccountTop20Pct,
    unknownTop20Pct,
    insiderTop20Pct,
    marketCount: markets.length,
    marketTypes,
    distinctMarketTypeCount: marketTypes.length,
    totalLpProviders: report.totalLPProviders,
    launchpadPlatform: report?.launchpad?.platform,
    pumpFunAmmPresent: marketTypes.includes("pump_fun_amm"),
    mintAuthorityPresent: Boolean(report?.token?.mintAuthority ?? report?.mintAuthority),
    freezeAuthorityPresent: Boolean(report?.token?.freezeAuthority ?? report?.freezeAuthority),
    metadataMutable: typeof report?.tokenMeta?.mutable === "boolean"
      ? report.tokenMeta.mutable : null,
  });
}

export function canonicalRugCheckMarketStructure(value) {
  return {
    coverage: value?.coverage === "complete" ? "complete" : "unavailable",
    top20HolderCount: nonnegativeInteger(value?.top20HolderCount),
    totalTop20Pct: percentage(value?.totalTop20Pct),
    knownAccountTop20Pct: percentage(value?.knownAccountTop20Pct),
    unknownTop20Pct: percentage(value?.unknownTop20Pct),
    insiderTop20Pct: percentage(value?.insiderTop20Pct),
    marketCount: nonnegativeInteger(value?.marketCount),
    marketTypes: stringArray(value?.marketTypes),
    distinctMarketTypeCount: nonnegativeInteger(value?.distinctMarketTypeCount),
    totalLpProviders: nonnegativeInteger(value?.totalLpProviders),
    launchpadPlatform: optionalString(value?.launchpadPlatform),
    pumpFunAmmPresent: optionalBoolean(value?.pumpFunAmmPresent),
    mintAuthorityPresent: optionalBoolean(value?.mintAuthorityPresent),
    freezeAuthorityPresent: optionalBoolean(value?.freezeAuthorityPresent),
    metadataMutable: optionalBoolean(value?.metadataMutable),
  };
}

export function buildDexPulseRugCheckMarketStructureScorecard(events) {
  const cohort = validatedDexPulseRugCheckMarketStructureRows(events);
  const frames = independentAssetFrames(cohort.rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  return {
    type: "dex-surface-pulse-rugcheck-market-structure-scorecard",
    ruleVersion: DEX_PULSE_RUGCHECK_MARKET_STRUCTURE_RULE.version,
    evidenceBoundary: DEX_PULSE_RUGCHECK_MARKET_STRUCTURE_RULE.evidenceBoundary,
    registrationId: cohort.registration?.id ?? null,
    registeredAt: cohort.registration?.registeredAt ?? null,
    researchOnly: true,
    mutationAllowed: false,
    candidateForecasts: cohort.futureForecasts.length,
    openForecasts: cohort.futureForecasts
      .filter((forecast) => cohort.pulse.openForecastIds.includes(forecast.id)).length,
    eligibleLiveObservations: cohort.rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(cohort.rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    rejectionCounts: cohort.rejectionCounts,
    parent: summarizeFrames(frames, () => true),
    screens: DEX_PULSE_RUGCHECK_MARKET_STRUCTURE_RULE.screens.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, (row) => passesRugCheckMarketStructureScreen(row, screen)),
    })),
    evidenceStatus: weightedRows.length ? "collecting" : "awaiting-future-outcomes",
    note: "RugCheck holder and account identities are reduced in memory to aggregate percentages before append. Known provider-labelled accounts are excluded from the distribution statistic. Each future-only screen can abstain on paper but cannot mutate forecasts, promote a model, or trade.",
  };
}

export function validatedDexPulseRugCheckMarketStructureRows(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const evidenceEvents = new Map(events
    .filter((event) => event.type === "rugcheck-market-structure-snapshot")
    .map((event) => [event.id, event]));
  const receipts = new Map(events
    .filter((event) => event.type === "dex-surface-pulse-rugcheck-market-structure-enrichment")
    .map((event) => [event.id, event]));
  const rejectionCounts = {};
  const rows = [];
  for (const row of pulse.rows) {
    if (!(Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? ""))) continue;
    const forecast = row.forecast;
    const receipt = receipts.get(forecast.rugCheckStructureEnrichmentReceiptId);
    const evidence = evidenceEvents.get(forecast.rugCheckStructureEvidenceId);
    const reason = marketStructureRowRejectionReason({ forecast, receipt, evidence, registration });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      ...row,
      rugCheckMarketStructure: evidence.aggregate,
      rugCheckMarketStructureEvidence: evidence,
      rugCheckMarketStructureReceipt: receipt,
    });
  }
  const futureForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  return { registration, pulse, rejectionCounts, rows, futureForecasts };
}

export function passesRugCheckMarketStructureScreen(row, screen) {
  const aggregate = row.rugCheckMarketStructure;
  if (aggregate?.coverage !== "complete") return false;
  return (!Object.hasOwn(screen, "maximumUnknownTop20PctInclusive")
      || (Number.isFinite(aggregate.unknownTop20Pct)
        && aggregate.unknownTop20Pct <= screen.maximumUnknownTop20PctInclusive))
    && (!Object.hasOwn(screen, "minimumMarketCountInclusive")
      || (Number.isFinite(aggregate.marketCount)
        && aggregate.marketCount >= screen.minimumMarketCountInclusive))
    && (!Object.hasOwn(screen, "minimumDistinctMarketTypeCountInclusive")
      || (Number.isFinite(aggregate.distinctMarketTypeCount)
        && aggregate.distinctMarketTypeCount >= screen.minimumDistinctMarketTypeCountInclusive))
    && (!screen.requireRevokedTokenAuthorities
      || (aggregate.mintAuthorityPresent === false && aggregate.freezeAuthorityPresent === false))
    && (!screen.requireImmutableMetadata || aggregate.metadataMutable === false)
    && (!screen.requirePumpFunAmm || aggregate.pumpFunAmmPresent === true);
}

function marketStructureRowRejectionReason({ forecast, receipt, evidence, registration }) {
  if (!registration || !matchesRegistration(registration)) return "missing-or-invalid-registration";
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))) return "not-strictly-future";
  if (!receipt
    || receipt.type !== "dex-surface-pulse-rugcheck-market-structure-enrichment"
    || receipt.registrationId !== registration.id
    || receipt.discoveryEventId !== forecast.discoveryEventId
    || receipt.status !== "recorded"
    || receipt.aggregateOnly !== true
    || receipt.rawIdentitiesRetained !== false
    || receipt.researchOnly !== true
    || receipt.mutationAllowed !== false) return "missing-or-invalid-enrichment";
  const link = (receipt.evidence ?? []).find((item) => item.tokenAddress === forecast.tokenAddress);
  if (!evidence
    || link?.evidenceEventId !== evidence.id
    || evidence.type !== "rugcheck-market-structure-snapshot"
    || evidence.provider !== "rugcheck"
    || evidence.registrationId !== registration.id
    || evidence.discoveryEventId !== forecast.discoveryEventId
    || evidence.chain !== forecast.chain
    || evidence.tokenAddress !== forecast.tokenAddress
    || evidence.ruleVersion !== DEX_PULSE_RUGCHECK_MARKET_STRUCTURE_RULE.version
    || evidence.aggregateOnly !== true
    || evidence.rawIdentitiesRetained !== false
    || evidence.researchOnly !== true
    || evidence.mutationAllowed !== false) return "missing-or-mismatched-exact-mint-evidence";
  const availableAt = Date.parse(evidence.availableAt ?? "");
  const createdAt = Date.parse(forecast.createdAt);
  if (!(availableAt > Date.parse(registration.registeredAt)
    && availableAt <= createdAt
    && createdAt - availableAt <= MAX_EVIDENCE_LAG_MS)) return "invalid-evidence-timing";
  const aggregate = canonicalRugCheckMarketStructure(evidence.aggregate);
  if (canonical(aggregate) !== canonical(evidence.aggregate)
    || evidence.aggregateDigest !== digestValue(aggregate)) return "invalid-rugcheck-market-structure-aggregate";
  return null;
}

function unavailableAggregate() {
  return canonicalRugCheckMarketStructure({ coverage: "unavailable" });
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
    requestBudget: receipt?.requestBudget ?? { maximum: 0, attempted: 0, succeeded: 0, failed: 0 },
  };
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseRugCheckMarketStructureRegistrationEvent(event.registeredAt);
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

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function percentageValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function percentage(value) {
  const number = percentageValue(value);
  return Number.isFinite(number) ? round6(number) : null;
}

function stringArray(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string"))].sort()
    : [];
}

function optionalString(value) {
  return typeof value === "string" && value.length ? value : null;
}

function optionalBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function latestIso(values) {
  const valid = values.filter((value) => Number.isFinite(Date.parse(value)));
  return valid.length ? valid.sort().at(-1) : null;
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
    else if (argv[index] === "--max-rugcheck-requests") options.maxRequests = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "enrich", "score"].includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-rugcheck-market-structure.mjs register|enrich|score [--max-rugcheck-requests 10] [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseRugCheckMarketStructure(options), null, 2));
    } else if (options.command === "enrich") {
      console.log(JSON.stringify(await enrichDexSurfacePulseWithRugCheckMarketStructure(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: buildDexPulseRugCheckMarketStructureScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
