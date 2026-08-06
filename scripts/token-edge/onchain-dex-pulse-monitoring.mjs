#!/usr/bin/env node

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendLedgerEvent,
  digestValue,
  readLedger,
  verifyLedger,
} from "./onchain-forward-core.mjs";
import {
  TOKEN_EDGE_EXECUTION_POLICY,
  capacityAdjustedReturnPct,
} from "./onchain-capacity-scorecard.mjs";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  DEX_EARLY_MONITORING_RULE,
  passesDexEarlyMonitoringScreen,
} from "./onchain-dex-early-monitoring-scorecard.mjs";
import { DEX_EARLY_SURFACE_RULE } from "./onchain-dex-early-rule.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const DEX_SCREENER_BASE_URL = "https://api.dexscreener.com";
const HOUR_MS = 60 * 60_000;
const CAPTURE_CADENCE_MS = 15 * 60_000;
const MAX_CAPTURE_LAG_MS = 5 * 60_000;
const MAX_OUTCOME_LAG_MS = 5 * 60_000;
const PATH_CADENCE_MS = 5 * 60_000;

export const DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE = Object.freeze({
  version: "dex-pulse-cross-endpoint-price-integrity-v1",
  appliesFrom: "2026-08-03T18:30:35.578Z",
  maximumPriceRatioInclusive: 1.1,
  maximumLiquidityRatioInclusive: 1.25,
  selectedQuotePolicy: "lower-price-and-lower-liquidity",
  purpose: "Fail pulse path and exact-outcome collection closed when DEX Screener token-batch and token-pairs endpoints disagree on the same exact pair.",
});

export const DEX_PULSE_ENTRY_PROVIDER_PRICE_INTEGRITY_RULE = Object.freeze({
  version: "dex-pulse-entry-cross-endpoint-price-integrity-v1",
  evidenceBoundary: "2026-08-03T19:30:15.000Z",
  providerPriceIntegrityRuleVersion: DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.version,
  maximumSourceToEntryLagMs: MAX_CAPTURE_LAG_MS,
  selectedQuotePolicy: DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.selectedQuotePolicy,
  purpose: "Use a fresh dual-endpoint lower DEX quote at pulse forecast creation instead of the earlier discovery quote.",
  researchOnly: true,
  mutationAllowed: false,
});

export const DEX_SURFACE_PULSE_RULE = Object.freeze({
  version: "dex-surface-pulse-monitoring-panel-v1",
  evidenceBoundary: "2026-08-03T12:30:00.000Z",
  sourceProvider: "dexscreener-early-surface",
  sourceRuleVersion: DEX_EARLY_SURFACE_RULE.version,
  horizon: "1h",
  cadenceMinutes: 15,
  maximumCaptureLagMinutes: 5,
  maximumOutcomeLagMinutes: 5,
  screens: DEX_EARLY_MONITORING_RULE.screens,
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  parentDecision: "paper-long-every-eligible-surface-candidate",
  screenFalseDecision: "paper-cash",
  repeatedAssetPolicy: "first-exact-asset-observation-per-independent-one-hour-frame",
  derivationStatus: "posthoc-sampling-remedy-and-hypotheses-only",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexSurfacePulseRegistrationEvent(registeredAt = new Date()) {
  const registeredAtIso = validIso(registeredAt);
  const registrationSpec = {
    rule: DEX_SURFACE_PULSE_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: registeredAtIso,
    status: "frozen",
    ...registrationSpec,
  };
}

export async function registerDexSurfacePulse(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexSurfacePulseRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(DEX_SURFACE_PULSE_RULE.evidenceBoundary))) {
    throw new Error("DEX surface pulse registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) {
    throw new Error(`Existing DEX surface pulse registration mismatch: ${proposed.id}`);
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

export function createDexPulseEntryProviderPriceIntegrityRegistrationEvent(
  registeredAt = new Date(),
) {
  const registeredAtIso = validIso(registeredAt);
  const registrationSpec = {
    entryExecutionRule: DEX_PULSE_ENTRY_PROVIDER_PRICE_INTEGRITY_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(registrationSpec).slice(0, 24)}`,
    registeredAt: registeredAtIso,
    status: "frozen",
    ...registrationSpec,
  };
}

export async function registerDexPulseEntryProviderPriceIntegrity(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseEntryProviderPriceIntegrityRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(DEX_PULSE_ENTRY_PROVIDER_PRICE_INTEGRITY_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse entry-integrity registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesEntryProviderPriceIntegrityRegistration(existing)) {
    throw new Error(`Existing DEX pulse entry-integrity registration mismatch: ${proposed.id}`);
  }
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.entryExecutionRule.version,
  };
}

export async function captureDexSurfacePulse(options = {}, dependencies = {}) {
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matchesRegistration);
  if (!registration) throw new Error("Register the DEX surface pulse policy before capture.");
  const discovery = [...events].reverse().find((event) => (
    event.type === "discovery"
    && event.provider === DEX_SURFACE_PULSE_RULE.sourceProvider
    && event.ruleVersion === DEX_SURFACE_PULSE_RULE.sourceRuleVersion
  ));
  if (!discovery) return captureResult(ledgerPath, now, "no-source-discovery", null, []);
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  const nowMs = now.getTime();
  if (!(discoveryAt > Date.parse(registration.registeredAt)
    && discoveryAt > Date.parse(DEX_SURFACE_PULSE_RULE.evidenceBoundary))) {
    return captureResult(ledgerPath, now, "source-not-strictly-future", discovery.id, []);
  }
  if (nowMs < discoveryAt || nowMs - discoveryAt > MAX_CAPTURE_LAG_MS) {
    return captureResult(ledgerPath, now, "source-outside-capture-window", discovery.id, []);
  }
  const cadenceBucket = Math.floor(discoveryAt / CAPTURE_CADENCE_MS);
  const candidates = (discovery.candidates ?? []).filter(validCandidate);
  const existing = events.filter((event) => (
    event.type === "dex-surface-pulse-forecast"
    && event.registrationId === registration.id
    && event.cadenceBucket === cadenceBucket
  ));
  if (existing.some((forecast) => forecast.discoveryEventId !== discovery.id)) {
    return captureResult(ledgerPath, now, "skipped-existing-cadence", discovery.id, [], {
      existingForecasts: existing.length,
    });
  }
  const existingTokens = new Set(existing.map((forecast) => forecast.tokenAddress));
  const pendingCandidates = candidates.filter((candidate) => (
    !existingTokens.has(candidate.tokenAddress)
  ));
  if (!pendingCandidates.length) {
    return captureResult(ledgerPath, now, "skipped-existing-cadence", discovery.id, [], {
      existingForecasts: existing.length,
    });
  }
  const requiresFreshEntry = discoveryAt > Date.parse(
    DEX_PULSE_ENTRY_PROVIDER_PRICE_INTEGRITY_RULE.evidenceBoundary,
  );
  const entryRegistration = events.find(matchesEntryProviderPriceIntegrityRegistration) ?? null;
  if (requiresFreshEntry && !(entryRegistration
    && discoveryAt > Date.parse(entryRegistration.registeredAt))) {
    return captureResult(ledgerPath, now, "entry-integrity-policy-not-strictly-prior", discovery.id, [], {
      existingForecasts: existing.length,
    });
  }
  const entryProvider = requiresFreshEntry
    ? await collectDexPulseProviderConsensus(
      pendingCandidates.map((candidate) => candidate.tokenAddress),
      dependencies.fetcher ?? fetch,
    )
    : null;
  const capturedAt = dependencies.clock?.()
    ?? (dependencies.now ? now : new Date());
  const capturedAtMs = capturedAt.getTime();
  if (capturedAtMs < discoveryAt || capturedAtMs - discoveryAt > MAX_CAPTURE_LAG_MS) {
    return captureResult(ledgerPath, capturedAt, "source-outside-capture-window", discovery.id, [], {
      existingForecasts: existing.length,
      requestsAttempted: entryProvider?.requestsAttempted ?? 0,
      failures: entryProvider?.failures ?? [],
    });
  }
  const enrichment = [...events].reverse().find((event) => (
    event.type === "dex-surface-pulse-lunar-enrichment"
    && event.discoveryEventId === discovery.id
    && event.status === "recorded"
  ));
  const lunarEvidenceByToken = new Map((enrichment?.evidence ?? []).map((item) => (
    [item.tokenAddress, item.evidenceEventId]
  )));
  const lunarCreatorEvidenceByToken = new Map((enrichment?.creatorEvidence ?? []).map((item) => (
    [item.tokenAddress, item.creatorEvidenceEventId]
  )));
  const lunarTopicEnrichment = [...events].reverse().find((event) => (
    event.type === "dex-surface-pulse-lunar-topic-enrichment"
    && event.discoveryEventId === discovery.id
    && event.status === "recorded"
  ));
  const lunarTopicEvidenceByToken = new Map((lunarTopicEnrichment?.evidence ?? []).map((item) => (
    [item.tokenAddress, item.evidenceEventId]
  )));
  const lunarTopicStructureEnrichment = [...events].reverse().find((event) => (
    event.type === "dex-surface-pulse-lunar-topic-structure-enrichment"
    && event.discoveryEventId === discovery.id
    && event.status === "recorded"
  ));
  const lunarTopicStructureEvidenceByToken = new Map(
    (lunarTopicStructureEnrichment?.evidence ?? []).map((item) => (
      [item.tokenAddress, item.evidenceEventId]
    )),
  );
  const lunarPostsEnrichment = [...events].reverse().find((event) => (
    event.type === "dex-surface-pulse-lunar-posts-enrichment"
    && event.discoveryEventId === discovery.id
    && event.status === "recorded"
  ));
  const lunarPostsEvidenceByToken = new Map((lunarPostsEnrichment?.evidence ?? []).map((item) => (
    [item.tokenAddress, item.evidenceEventId]
  )));
  const lunarGeminiSemanticsEnrichment = [...events].reverse().find((event) => (
    event.type === "dex-surface-pulse-lunar-gemini-post-semantics-enrichment"
    && event.discoveryEventId === discovery.id
    && event.status === "recorded"
  ));
  const lunarGeminiSemanticsEvidenceByToken = new Map(
    (lunarGeminiSemanticsEnrichment?.evidence ?? []).map((item) => (
      [item.tokenAddress, item]
    )),
  );
  const goPlusEnrichment = [...events].reverse().find((event) => (
    event.type === "dex-surface-pulse-goplus-enrichment"
    && event.discoveryEventId === discovery.id
    && event.status === "recorded"
  ));
  const goPlusEvidenceByToken = new Map((goPlusEnrichment?.evidence ?? []).map((item) => (
    [item.tokenAddress, item.evidenceEventId]
  )));
  const rugCheckEnrichment = [...events].reverse().find((event) => (
    event.type === "dex-surface-pulse-rugcheck-enrichment"
    && event.discoveryEventId === discovery.id
    && event.status === "recorded"
  ));
  const rugCheckEvidenceByToken = new Map((rugCheckEnrichment?.evidence ?? []).map((item) => (
    [item.tokenAddress, item.evidenceEventId]
  )));
  const rugCheckStructureEnrichment = [...events].reverse().find((event) => (
    event.type === "dex-surface-pulse-rugcheck-market-structure-enrichment"
    && event.discoveryEventId === discovery.id
    && event.status === "recorded"
  ));
  const rugCheckStructureEvidenceByToken = new Map((rugCheckStructureEnrichment?.evidence ?? []).map((item) => (
    [item.tokenAddress, item.evidenceEventId]
  )));
  const forecasts = [];
  const failures = [...(entryProvider?.failures ?? [])];
  for (const candidate of pendingCandidates) {
    const consensus = requiresFreshEntry
      ? consensusPairForForecast(entryProvider, candidate)
      : null;
    if (requiresFreshEntry && consensus.reason) {
      failures.push(`DEX pulse entry integrity rejected ${candidate.tokenAddress} ${candidate.pairAddress}: ${consensus.reason}`);
      continue;
    }
    const entryPriceUsd = requiresFreshEntry
      ? positiveNumber(consensus.pair?.priceUsd)
      : candidate.priceUsd;
    const entryLiquidityUsd = requiresFreshEntry
      ? positiveNumber(consensus.pair?.liquidity?.usd)
      : candidate.liquidityUsd;
    if (!(entryPriceUsd > 0) || !(entryLiquidityUsd > 0)) continue;
    const createdAt = capturedAt.toISOString();
    const event = {
      type: "dex-surface-pulse-forecast",
      id: `dex_surface_pulse_forecast_${digestValue({
        registrationId: registration.id,
        discoveryEventId: discovery.id,
        cadenceBucket,
        chain: candidate.chain,
        tokenAddress: candidate.tokenAddress,
      }).slice(0, 24)}`,
      ruleVersion: DEX_SURFACE_PULSE_RULE.version,
      registrationId: registration.id,
      registeredAt: registration.registeredAt,
      discoveryEventId: discovery.id,
      cadenceBucket,
      chain: candidate.chain,
      tokenAddress: candidate.tokenAddress,
      symbol: candidate.symbol ?? null,
      createdAt,
      sourceDiscoveryObservedAt: discovery.observedAt,
      entryObservedAt: requiresFreshEntry ? createdAt : discovery.observedAt,
      dueAt: new Date(capturedAtMs + HOUR_MS).toISOString(),
      pairAddress: candidate.pairAddress,
      entryPriceUsd,
      entryLiquidityUsd,
      entryProviderPriceIntegrity: requiresFreshEntry ? consensus.integrity : null,
      entryIntegrityRegistrationId: requiresFreshEntry ? entryRegistration.id : null,
      entryIntegrityRegisteredAt: requiresFreshEntry ? entryRegistration.registeredAt : null,
      entryIntegrityRuleVersion: requiresFreshEntry
        ? entryRegistration.entryExecutionRule.version
        : null,
      metrics: candidateMetrics(candidate),
      lunarcrushEnrichmentReceiptId: enrichment?.id ?? null,
      lunarcrushEvidenceId: lunarEvidenceByToken.get(candidate.tokenAddress) ?? null,
      lunarcrushCreatorRegistrationId: enrichment?.creatorStatus === "recorded"
        ? enrichment.creatorRegistrationId ?? null : null,
      lunarcrushCreatorEvidenceId: enrichment?.creatorStatus === "recorded"
        ? lunarCreatorEvidenceByToken.get(candidate.tokenAddress) ?? null : null,
      lunarcrushTopicEnrichmentReceiptId: lunarTopicEnrichment?.id ?? null,
      lunarcrushTopicEvidenceId: lunarTopicEvidenceByToken.get(candidate.tokenAddress) ?? null,
      lunarcrushTopicStructureEnrichmentReceiptId:
        lunarTopicStructureEnrichment?.id ?? null,
      lunarcrushTopicStructureEvidenceId:
        lunarTopicStructureEvidenceByToken.get(candidate.tokenAddress) ?? null,
      lunarcrushPostsEnrichmentReceiptId: lunarPostsEnrichment?.id ?? null,
      lunarcrushPostsEvidenceId: lunarPostsEvidenceByToken.get(candidate.tokenAddress) ?? null,
      lunarcrushGeminiSemanticsEnrichmentReceiptId:
        lunarGeminiSemanticsEnrichment?.id ?? null,
      lunarcrushGeminiPostsEvidenceId:
        lunarGeminiSemanticsEvidenceByToken.get(candidate.tokenAddress)
          ?.postsEvidenceEventId ?? null,
      lunarcrushGeminiSemanticsEvidenceId:
        lunarGeminiSemanticsEvidenceByToken.get(candidate.tokenAddress)
          ?.semanticEvidenceEventId ?? null,
      goPlusEnrichmentReceiptId: goPlusEnrichment?.id ?? null,
      goPlusEvidenceId: goPlusEvidenceByToken.get(candidate.tokenAddress) ?? null,
      rugCheckEnrichmentReceiptId: rugCheckEnrichment?.id ?? null,
      rugCheckEvidenceId: rugCheckEvidenceByToken.get(candidate.tokenAddress) ?? null,
      rugCheckStructureEnrichmentReceiptId: rugCheckStructureEnrichment?.id ?? null,
      rugCheckStructureEvidenceId: rugCheckStructureEvidenceByToken.get(candidate.tokenAddress) ?? null,
      parentDecision: DEX_SURFACE_PULSE_RULE.parentDecision,
      researchOnly: true,
      mutationAllowed: false,
    };
    forecasts.push(await appendLedgerEvent(ledgerPath, event));
  }
  return captureResult(
    ledgerPath,
    capturedAt,
    forecasts.length ? "recorded" : (failures.length
      ? "entry-integrity-rejected"
      : "no-eligible-candidates"),
    discovery.id,
    forecasts,
    {
      existingForecasts: existing.length,
      requestsAttempted: entryProvider?.requestsAttempted ?? 0,
      failures,
    },
  );
}

export async function resolveDexSurfacePulse(options = {}, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const resolvedIds = new Set(events
    .filter((event) => event.type === "dex-surface-pulse-resolution")
    .map((event) => event.forecastId));
  const due = events.filter((event) => (
    event.type === "dex-surface-pulse-forecast"
    && !resolvedIds.has(event.id)
    && Date.parse(event.dueAt) <= now.getTime()
  ));
  if (!due.length) return resolutionResult(ledgerPath, now, 0, 0, [], []);
  const tokenAddresses = [...new Set(due.map((event) => event.tokenAddress))];
  const provider = await collectDexPulseProviderConsensus(tokenAddresses, fetcher);
  const failures = [...provider.failures];
  const rejectedPairs = new Set();
  const resolutions = [];
  for (const forecast of due) {
    if (!provider.batchPairsByToken.has(forecast.tokenAddress)
      || !provider.directPairsByToken.has(forecast.tokenAddress)) continue;
    const consensus = consensusPairForForecast(provider, forecast);
    if (consensus.reason) {
      const key = `${forecast.tokenAddress}:${forecast.pairAddress}:${consensus.reason}`;
      if (!rejectedPairs.has(key)) {
        rejectedPairs.add(key);
        failures.push(`DEX pulse price integrity rejected ${forecast.tokenAddress} ${forecast.pairAddress}: ${consensus.reason}`);
      }
      continue;
    }
    const pair = consensus.pair;
    const exitPriceUsd = positiveNumber(pair?.priceUsd);
    const exitLiquidityUsd = positiveNumber(pair?.liquidity?.usd);
    const lagMs = now.getTime() - Date.parse(forecast.dueAt);
    if (!pair && lagMs <= MAX_OUTCOME_LAG_MS) continue;
    const observed = lagMs <= MAX_OUTCOME_LAG_MS && exitPriceUsd != null;
    const grossReturnPct = observed
      ? round6(((exitPriceUsd / forecast.entryPriceUsd) - 1) * 100)
      : null;
    const event = {
      type: "dex-surface-pulse-resolution",
      id: `dex_surface_pulse_resolution_${digestValue({
        forecastId: forecast.id,
        observedAt: now.toISOString(),
        status: observed ? "observed" : "missed",
      }).slice(0, 24)}`,
      ruleVersion: DEX_SURFACE_PULSE_RULE.version,
      registrationId: forecast.registrationId,
      forecastId: forecast.id,
      discoveryEventId: forecast.discoveryEventId,
      chain: forecast.chain,
      tokenAddress: forecast.tokenAddress,
      dueAt: forecast.dueAt,
      observedAt: now.toISOString(),
      observationLagMs: lagMs,
      status: observed ? "observed" : "missed",
      reason: observed ? null : (lagMs > MAX_OUTCOME_LAG_MS
        ? "exact-one-hour-window-expired"
        : "entry-pair-unavailable"),
      pairAddress: forecast.pairAddress,
      entryPriceUsd: forecast.entryPriceUsd,
      exitPriceUsd,
      entryLiquidityUsd: forecast.entryLiquidityUsd,
      exitLiquidityUsd,
      grossReturnPct,
      providerPriceIntegrity: consensus.integrity,
      researchOnly: true,
      mutationAllowed: false,
    };
    resolutions.push(await appendLedgerEvent(ledgerPath, event));
  }
  return resolutionResult(
    ledgerPath,
    now,
    due.length,
    provider.requestsAttempted,
    resolutions,
    failures,
  );
}

export async function markOpenDexSurfacePulse(options = {}, dependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const bucketStartedAt = new Date(Math.floor(now.getTime() / PATH_CADENCE_MS) * PATH_CADENCE_MS)
    .toISOString();
  const lockPath = path.join(
    path.dirname(ledgerPath),
    `.dex-surface-pulse-path-${bucketStartedAt.replaceAll(/[^0-9]/g, "")}.lock`,
  );
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      return pathResult(ledgerPath, now, bucketStartedAt, 0, 0, [], []);
    }
    throw error;
  }
  try {
    const events = await verifiedLedger(ledgerPath);
    const resolvedIds = new Set(events
      .filter((event) => event.type === "dex-surface-pulse-resolution")
      .map((event) => event.forecastId));
    const markedIds = new Set(events.filter((event) => (
      event.type === "dex-surface-pulse-path" && event.bucketStartedAt === bucketStartedAt
    )).map((event) => event.forecastId));
    const open = events.filter((event) => (
      event.type === "dex-surface-pulse-forecast"
      && !resolvedIds.has(event.id)
      && !markedIds.has(event.id)
      && Date.parse(event.createdAt) <= now.getTime()
      && Date.parse(event.dueAt) > now.getTime()
    ));
    if (!open.length) return pathResult(ledgerPath, now, bucketStartedAt, 0, 0, [], []);
    const provider = await collectDexPulseProviderConsensus(
      [...new Set(open.map((event) => event.tokenAddress))],
      fetcher,
    );
    const failures = [...provider.failures];
    const rejectedPairs = new Set();
    const observations = [];
    for (const forecast of open) {
      if (!provider.batchPairsByToken.has(forecast.tokenAddress)
        || !provider.directPairsByToken.has(forecast.tokenAddress)) continue;
      const consensus = consensusPairForForecast(provider, forecast);
      if (consensus.reason) {
        const key = `${forecast.tokenAddress}:${forecast.pairAddress}:${consensus.reason}`;
        if (!rejectedPairs.has(key)) {
          rejectedPairs.add(key);
          failures.push(`DEX pulse price integrity rejected ${forecast.tokenAddress} ${forecast.pairAddress}: ${consensus.reason}`);
        }
        continue;
      }
      const pair = consensus.pair;
      const observedPriceUsd = positiveNumber(pair?.priceUsd);
      if (observedPriceUsd == null) continue;
      const event = {
        type: "dex-surface-pulse-path",
        id: `dex_surface_pulse_path_${digestValue({
          forecastId: forecast.id,
          bucketStartedAt,
        }).slice(0, 24)}`,
        ruleVersion: DEX_SURFACE_PULSE_RULE.version,
        registrationId: forecast.registrationId,
        forecastId: forecast.id,
        discoveryEventId: forecast.discoveryEventId,
        chain: forecast.chain,
        tokenAddress: forecast.tokenAddress,
        pairAddress: forecast.pairAddress,
        observedAt: now.toISOString(),
        bucketStartedAt,
        entryPriceUsd: forecast.entryPriceUsd,
        observedPriceUsd,
        observedLiquidityUsd: positiveNumber(pair?.liquidity?.usd),
        grossReturnFromEntryPct: round6(((observedPriceUsd / forecast.entryPriceUsd) - 1) * 100),
        providerPriceIntegrity: consensus.integrity,
        researchOnly: true,
        mutationAllowed: false,
      };
      observations.push(await appendLedgerEvent(ledgerPath, event));
    }
    return pathResult(
      ledgerPath,
      now,
      bucketStartedAt,
      open.length,
      provider.requestsAttempted,
      observations,
      failures,
    );
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export function buildDexSurfacePulseScorecard(events) {
  const cohort = validatedDexSurfacePulseObservationRows(events);
  const {
    registration, forecasts, openForecasts, rejectionCounts, rows,
  } = cohort;
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  return {
    type: "dex-surface-pulse-monitoring-scorecard",
    ruleVersion: DEX_SURFACE_PULSE_RULE.version,
    evidenceBoundary: DEX_SURFACE_PULSE_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    researchOnly: true,
    mutationAllowed: false,
    candidateForecasts: forecasts.length,
    openForecasts,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    rejectionCounts,
    parent: summarizeFrames(frames, () => true),
    screens: DEX_SURFACE_PULSE_RULE.screens.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, (row) => passesDexEarlyMonitoringScreen(row, screen)),
    })),
    evidenceStatus: weightedRows.length >= 252 && frames.length >= 252
      && new Set(weightedRows.map(tokenEdgeAssetKey)).size >= 30
      ? "reviewable"
      : "collecting",
    note: "This fixed-cadence cohort tests screen value across every eligible social-surface candidate. It is paper-only; pre-registration discoveries, late capture/outcomes, tampered source fields, and repeated same-asset observations cannot inflate the score.",
  };
}

export function validatedDexSurfacePulseObservationRows(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const entryRegistration = events.find(
    matchesEntryProviderPriceIntegrityRegistration,
  ) ?? null;
  const discoveries = new Map(events
    .filter((event) => event.type === "discovery")
    .map((event) => [event.id, event]));
  const resolutions = new Map(events
    .filter((event) => event.type === "dex-surface-pulse-resolution")
    .map((event) => [event.forecastId, event]));
  const rejectionCounts = {};
  const rows = [];
  let openForecasts = 0;
  const openForecastIds = [];
  const forecasts = events.filter((event) => (
    event.type === "dex-surface-pulse-forecast"
    && event.registrationId === registration?.id
  ));
  for (const forecast of forecasts) {
    const discovery = discoveries.get(forecast.discoveryEventId);
    const resolution = resolutions.get(forecast.id);
    if (!resolution) {
      openForecasts += 1;
      openForecastIds.push(forecast.id);
      continue;
    }
    const reason = pulseRowRejectionReason({
      forecast,
      discovery,
      resolution,
      registration,
      entryRegistration,
    });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      forecast,
      resolution,
      forecastId: forecast.id,
      createdAt: forecast.createdAt,
      chain: forecast.chain,
      tokenAddress: forecast.tokenAddress,
      grossReturnPct: resolution.grossReturnPct,
      baseCapacityReturnPct: capacityAdjustedReturnPct({
        grossReturnPct: resolution.grossReturnPct,
        entryLiquidityUsd: forecast.entryLiquidityUsd,
        exitLiquidityUsd: resolution.exitLiquidityUsd,
        paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
        roundTripCostPct: DEX_SURFACE_PULSE_RULE.baseRoundTripCostPct,
      }),
      stressCapacityReturnPct: capacityAdjustedReturnPct({
        grossReturnPct: resolution.grossReturnPct,
        entryLiquidityUsd: forecast.entryLiquidityUsd,
        exitLiquidityUsd: resolution.exitLiquidityUsd,
        paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
        roundTripCostPct: DEX_SURFACE_PULSE_RULE.stressRoundTripCostPct,
      }),
      ...forecast.metrics,
    });
  }
  return {
    registration,
    forecasts,
    openForecasts,
    openForecastIds,
    rejectionCounts,
    rows,
  };
}

function pulseRowRejectionReason({
  forecast,
  discovery,
  resolution,
  registration,
  entryRegistration,
}) {
  if (!registration || !matchesRegistration(registration)) return "missing-or-invalid-registration";
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt)
    && Date.parse(forecast.entryObservedAt) > Date.parse(registration.registeredAt))) {
    return "not-strictly-future";
  }
  if (forecast.ruleVersion !== DEX_SURFACE_PULSE_RULE.version
    || forecast.researchOnly !== true || forecast.mutationAllowed !== false) {
    return "forecast-policy-mismatch";
  }
  const requiresFreshEntry = Date.parse(discovery?.observedAt ?? "") > Date.parse(
    DEX_PULSE_ENTRY_PROVIDER_PRICE_INTEGRITY_RULE.evidenceBoundary,
  );
  const sourceDiscoveryObservedAt = requiresFreshEntry
    ? forecast.sourceDiscoveryObservedAt
    : forecast.entryObservedAt;
  if (!discovery || discovery.provider !== DEX_SURFACE_PULSE_RULE.sourceProvider
    || discovery.ruleVersion !== DEX_SURFACE_PULSE_RULE.sourceRuleVersion
    || discovery.observedAt !== sourceDiscoveryObservedAt) return "source-discovery-mismatch";
  const candidate = (discovery.candidates ?? []).find((row) => (
    row.chain === forecast.chain && row.tokenAddress === forecast.tokenAddress
  ));
  if (!validCandidate(candidate)
    || forecast.pairAddress !== candidate.pairAddress
    || canonical(forecast.metrics) !== canonical(candidateMetrics(candidate))) {
    return "source-candidate-mismatch";
  }
  if (requiresFreshEntry) {
    if (!entryRegistration
      || !matchesEntryProviderPriceIntegrityRegistration(entryRegistration)
      || forecast.entryIntegrityRegistrationId !== entryRegistration.id
      || forecast.entryIntegrityRegisteredAt !== entryRegistration.registeredAt
      || forecast.entryIntegrityRuleVersion
        !== DEX_PULSE_ENTRY_PROVIDER_PRICE_INTEGRITY_RULE.version
      || !(Date.parse(discovery.observedAt) > Date.parse(entryRegistration.registeredAt))) {
      return "entry-integrity-registration-mismatch";
    }
    if (forecast.entryObservedAt !== forecast.createdAt
      || !validDexPulseStoredProviderPriceIntegrity(
        forecast.entryProviderPriceIntegrity,
        forecast.entryPriceUsd,
        forecast.entryLiquidityUsd,
      )) return "entry-provider-price-integrity-mismatch";
  } else if (forecast.entryPriceUsd !== candidate.priceUsd
    || forecast.entryLiquidityUsd !== candidate.liquidityUsd) {
    return "source-candidate-mismatch";
  }
  if (Date.parse(forecast.createdAt) - Date.parse(sourceDiscoveryObservedAt) > MAX_CAPTURE_LAG_MS
    || forecast.dueAt !== new Date(Date.parse(forecast.createdAt) + HOUR_MS).toISOString()) {
    return "capture-timing-mismatch";
  }
  if (resolution.status !== "observed"
    || resolution.ruleVersion !== forecast.ruleVersion
    || resolution.registrationId !== forecast.registrationId
    || resolution.discoveryEventId !== forecast.discoveryEventId
    || resolution.chain !== forecast.chain
    || resolution.tokenAddress !== forecast.tokenAddress
    || resolution.dueAt !== forecast.dueAt
    || resolution.pairAddress !== forecast.pairAddress
    || resolution.entryPriceUsd !== forecast.entryPriceUsd
    || resolution.entryLiquidityUsd !== forecast.entryLiquidityUsd
    || resolution.observationLagMs < 0
    || resolution.observationLagMs > MAX_OUTCOME_LAG_MS
    || resolution.researchOnly !== true
    || resolution.mutationAllowed !== false) return "resolution-mismatch";
  if (!(resolution.exitPriceUsd > 0) || !(resolution.exitLiquidityUsd > 0)
    || resolution.grossReturnPct !== round6(
      ((resolution.exitPriceUsd / forecast.entryPriceUsd) - 1) * 100,
    )) return "resolution-return-mismatch";
  if (Date.parse(resolution.observedAt) >= Date.parse(
    DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.appliesFrom,
  ) && !validDexPulseStoredProviderPriceIntegrity(
    resolution.providerPriceIntegrity,
    resolution.exitPriceUsd,
    resolution.exitLiquidityUsd,
  )) return "provider-price-integrity-mismatch";
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

function candidateMetrics(candidate) {
  const metrics = {
    buySellTxnRatio: finiteNumber(candidate.buySellTxnRatio),
    hourlyTurnover: finiteNumber(candidate.hourlyTurnover),
    pairAgeMinutes: finiteNumber(candidate.pairAgeMinutes),
    priceChangeH1Pct: finiteNumber(candidate.priceChangeH1Pct),
    totalBoostAmount: finiteNumber(candidate.totalBoostAmount),
    sourceBreadth: finiteNumber(candidate.sourceBreadth),
    hasWebsite: candidate.hasWebsite === true,
    hasTwitter: candidate.hasTwitter === true,
  };
  const fastFields = {
    fiveMinuteBuySellTxnRatio: finiteNumber(candidate.fiveMinuteBuySellTxnRatio),
    fiveMinuteTurnover: finiteNumber(candidate.fiveMinuteTurnover),
    priceChangeM5Pct: finiteNumber(candidate.priceChangeM5Pct),
    buysM5: finiteNumber(candidate.buysM5),
    sellsM5: finiteNumber(candidate.sellsM5),
    volumeM5Usd: finiteNumber(candidate.volumeM5Usd),
  };
  if (Object.values(fastFields).some(Number.isFinite)) Object.assign(metrics, fastFields);
  return metrics;
}

function validCandidate(candidate) {
  return candidate?.status === "eligible"
    && candidate.chain === "solana"
    && typeof candidate.tokenAddress === "string"
    && candidate.tokenAddress.length > 0
    && typeof candidate.pairAddress === "string"
    && candidate.pairAddress.length > 0
    && candidate.priceUsd > 0
    && candidate.liquidityUsd > 0
    && candidate.ruleVersion === DEX_SURFACE_PULSE_RULE.sourceRuleVersion;
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexSurfacePulseRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesEntryProviderPriceIntegrityRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseEntryProviderPriceIntegrityRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.entryExecutionRule) === canonical(expected.entryExecutionRule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

async function verifiedLedger(ledgerPath) {
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) throw new Error(`Ledger integrity failed: ${verification.errors.join("; ")}`);
  return events;
}

function captureResult(
  ledgerPath,
  now,
  status,
  discoveryEventId,
  forecasts,
  metadata = {},
) {
  return {
    ledgerPath,
    capturedAt: now.toISOString(),
    status,
    discoveryEventId,
    recordedForecasts: status === "recorded" ? forecasts.length : 0,
    existingForecasts: metadata.existingForecasts ?? 0,
    requestsAttempted: metadata.requestsAttempted ?? 0,
    failures: metadata.failures ?? [],
    forecasts: forecasts.map((event) => ({
      id: event.id,
      tokenAddress: event.tokenAddress,
      symbol: event.symbol,
      dueAt: event.dueAt,
    })),
  };
}

function resolutionResult(ledgerPath, now, dueForecasts, requestsAttempted, resolutions, failures) {
  return {
    ledgerPath,
    checkedAt: now.toISOString(),
    dueForecasts,
    requestsAttempted,
    recordedResolutions: resolutions.length,
    observed: resolutions.filter((event) => event.status === "observed").length,
    missed: resolutions.filter((event) => event.status === "missed").length,
    failures,
  };
}

function pathResult(
  ledgerPath, now, bucketStartedAt, pendingForecasts, requestsAttempted, observations, failures,
) {
  return {
    ledgerPath,
    observedAt: now.toISOString(),
    bucketStartedAt,
    pendingForecasts,
    requestsAttempted,
    recordedObservations: observations.length,
    failures,
    observations: observations.map((event) => ({
      id: event.id,
      forecastId: event.forecastId,
      tokenAddress: event.tokenAddress,
      grossReturnFromEntryPct: event.grossReturnFromEntryPct,
      observedLiquidityUsd: event.observedLiquidityUsd,
    })),
  };
}

export async function collectDexPulseProviderConsensus(tokenAddresses, fetcher) {
  const batchPairsByToken = new Map();
  const directPairsByToken = new Map();
  const failures = [];
  let requestsAttempted = 0;
  for (const batch of chunks(tokenAddresses, 30)) {
    requestsAttempted += 1;
    try {
      const response = await fetcher(
        `${DEX_SCREENER_BASE_URL}/tokens/v1/solana/${batch.map(encodeURIComponent).join(",")}`,
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error(`DEX Screener token batch returned HTTP ${response.status}.`);
      const rows = await response.json();
      for (const tokenAddress of batch) {
        batchPairsByToken.set(tokenAddress, (Array.isArray(rows) ? rows : []).filter((pair) => (
          pair?.baseToken?.address === tokenAddress
        )));
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const tokenAddress of tokenAddresses.filter((token) => batchPairsByToken.has(token))) {
    requestsAttempted += 1;
    try {
      const response = await fetcher(
        `${DEX_SCREENER_BASE_URL}/token-pairs/v1/solana/${encodeURIComponent(tokenAddress)}`,
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error(`DEX Screener token-pairs returned HTTP ${response.status}.`);
      const rows = await response.json();
      directPairsByToken.set(tokenAddress, (Array.isArray(rows) ? rows : []).filter((pair) => (
        pair?.baseToken?.address === tokenAddress
      )));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    batchPairsByToken,
    directPairsByToken,
    failures,
    requestsAttempted,
  };
}

export function consensusPairForForecast(provider, forecast) {
  const batchPair = (provider.batchPairsByToken.get(forecast.tokenAddress) ?? []).find((row) => (
    row?.pairAddress === forecast.pairAddress
  ));
  const directPair = (provider.directPairsByToken.get(forecast.tokenAddress) ?? []).find((row) => (
    row?.pairAddress === forecast.pairAddress
  ));
  const reason = dexPulseProviderPriceIntegrityReason(batchPair, directPair);
  if (reason) return { reason, pair: null, integrity: null };
  const batchPriceUsd = positiveNumber(batchPair.priceUsd);
  const directPriceUsd = positiveNumber(directPair.priceUsd);
  const batchLiquidityUsd = positiveNumber(batchPair.liquidity?.usd);
  const directLiquidityUsd = positiveNumber(directPair.liquidity?.usd);
  const selectedPriceUsd = Math.min(batchPriceUsd, directPriceUsd);
  const selectedLiquidityUsd = Math.min(batchLiquidityUsd, directLiquidityUsd);
  return {
    reason: null,
    pair: {
      ...directPair,
      priceUsd: String(selectedPriceUsd),
      liquidity: { ...directPair.liquidity, usd: selectedLiquidityUsd },
    },
    integrity: {
      ruleVersion: DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.version,
      batchPriceUsd,
      directPriceUsd,
      priceRatio: round6(Math.max(batchPriceUsd, directPriceUsd)
        / Math.min(batchPriceUsd, directPriceUsd)),
      batchLiquidityUsd,
      directLiquidityUsd,
      liquidityRatio: round6(Math.max(batchLiquidityUsd, directLiquidityUsd)
        / Math.min(batchLiquidityUsd, directLiquidityUsd)),
      selectedQuotePolicy: DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.selectedQuotePolicy,
    },
  };
}

export function dexPulseProviderPriceIntegrityReason(batchPair, directPair) {
  if (!batchPair || !directPair) return "exact-pair-missing-from-one-endpoint";
  const prices = [positiveNumber(batchPair.priceUsd), positiveNumber(directPair.priceUsd)];
  const liquidities = [
    positiveNumber(batchPair.liquidity?.usd),
    positiveNumber(directPair.liquidity?.usd),
  ];
  if (![...prices, ...liquidities].every(Number.isFinite)) return "non-positive-price-or-liquidity";
  const priceRatio = Math.max(...prices) / Math.min(...prices);
  if (priceRatio > DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.maximumPriceRatioInclusive) {
    return "cross-endpoint-price-disagreement";
  }
  const liquidityRatio = Math.max(...liquidities) / Math.min(...liquidities);
  if (liquidityRatio > DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.maximumLiquidityRatioInclusive) {
    return "cross-endpoint-liquidity-disagreement";
  }
  return null;
}

export function validDexPulseStoredProviderPriceIntegrity(
  integrity,
  selectedPriceUsd,
  selectedLiquidityUsd,
) {
  const batchPair = {
    priceUsd: integrity?.batchPriceUsd,
    liquidity: { usd: integrity?.batchLiquidityUsd },
  };
  const directPair = {
    priceUsd: integrity?.directPriceUsd,
    liquidity: { usd: integrity?.directLiquidityUsd },
  };
  if (integrity?.ruleVersion !== DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.version
    || integrity?.selectedQuotePolicy
      !== DEX_PULSE_PROVIDER_PRICE_INTEGRITY_RULE.selectedQuotePolicy
    || dexPulseProviderPriceIntegrityReason(batchPair, directPair) !== null) return false;
  const prices = [positiveNumber(integrity.batchPriceUsd), positiveNumber(integrity.directPriceUsd)];
  const liquidities = [
    positiveNumber(integrity.batchLiquidityUsd),
    positiveNumber(integrity.directLiquidityUsd),
  ];
  return integrity.priceRatio === round6(Math.max(...prices) / Math.min(...prices))
    && integrity.liquidityRatio === round6(
      Math.max(...liquidities) / Math.min(...liquidities),
    )
    && selectedPriceUsd === Math.min(...prices)
    && selectedLiquidityUsd === Math.min(...liquidities);
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function pairedMean(left, right) {
  const pairs = left.map((value, index) => ({ value, other: right[index] }))
    .filter((row) => Number.isFinite(row.value) && Number.isFinite(row.other));
  return pairs.length ? mean(pairs.map((row) => row.value - row.other)) : null;
}

function largestWinningShare(values) {
  const winners = values.filter((value) => value > 0);
  const total = winners.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...winners) / total : null;
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

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function nullableRound(value, digits = 6) {
  return Number.isFinite(value) ? Math.round(value * (10 ** digits)) / (10 ** digits) : null;
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
  if (!["register", "register-entry-integrity", "capture", "resolve", "mark", "score"].includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-monitoring.mjs register|register-entry-integrity|capture|resolve|mark|score [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") console.log(JSON.stringify(await registerDexSurfacePulse(options), null, 2));
    else if (options.command === "register-entry-integrity") console.log(JSON.stringify(await registerDexPulseEntryProviderPriceIntegrity(options), null, 2));
    else if (options.command === "capture") console.log(JSON.stringify(await captureDexSurfacePulse(options), null, 2));
    else if (options.command === "resolve") console.log(JSON.stringify(await resolveDexSurfacePulse(options), null, 2));
    else if (options.command === "mark") console.log(JSON.stringify(await markOpenDexSurfacePulse(options), null, 2));
    else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: buildDexSurfacePulseScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
