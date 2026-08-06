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
import {
  LUNARCRUSH_MOVE_ALERT_RULE,
  collectExactMintLunarCrushEvidence,
  deriveLunarCrushMoveAlertFeatures,
} from "./onchain-lunarcrush-provider.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const MAX_SOURCE_LAG_MS = 5 * 60_000;
const MAX_EVIDENCE_LAG_MS = 10 * 60_000;

export const DEX_PULSE_LUNAR_RULE = Object.freeze({
  version: "dex-surface-pulse-lunar-monitoring-panel-v1",
  evidenceBoundary: "2026-08-03T12:40:00.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  lunarcrushRuleVersion: LUNARCRUSH_MOVE_ALERT_RULE.version,
  collectionCadence: "once-per-clock-hour",
  maximumDiscoveryToCollectionLagMinutes: 5,
  maximumEvidenceToForecastLagMinutes: 10,
  screens: Object.freeze([
    Object.freeze({ id: "exact-mint-tracked", requireReady: true }),
    Object.freeze({ id: "large-move-alert", requireLargeMoveAlert: true }),
    Object.freeze({ id: "interactions-accelerating", minimumInteractionsZExclusive: 0 }),
    Object.freeze({ id: "posts-accelerating", minimumPostsActiveZExclusive: 0 }),
    Object.freeze({ id: "contributors-accelerating", minimumContributorsActiveZExclusive: 0 }),
    Object.freeze({ id: "social-acceleration-any", minimumAccelerationSignalsInclusive: 1 }),
    Object.freeze({ id: "social-acceleration-multiple", minimumAccelerationSignalsInclusive: 2 }),
    Object.freeze({
      id: "altrank-galaxy-quality",
      maximumAltRankInclusive: 200,
      minimumGalaxyScoreInclusive: 50,
    }),
    Object.freeze({
      id: "interaction-post-contributor-consensus",
      minimumInteractionsZExclusive: 0,
      minimumPostsActiveZExclusive: 0,
      minimumContributorsActiveZExclusive: 0,
    }),
    Object.freeze({
      id: "flow-social-consensus",
      minimumBuySellTxnRatioInclusive: 1,
      minimumHourlyTurnoverInclusive: 0.5,
      minimumAccelerationSignalsInclusive: 1,
    }),
  ]),
  derivationStatus: "posthoc-cross-provider-hypotheses-only",
  researchOnly: true,
  mutationAllowed: false,
});

export const DEX_PULSE_LUNAR_CREATOR_RULE = Object.freeze({
  version: "dex-surface-pulse-lunar-creator-monitoring-panel-v1",
  evidenceBoundary: "2026-08-03T14:24:00.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  sourceLunarRuleVersion: DEX_PULSE_LUNAR_RULE.version,
  collectionCadence: "once-per-clock-hour-within-existing-lunar-budget",
  maximumEvidenceToForecastLagMinutes: 10,
  screens: Object.freeze([
    Object.freeze({ id: "exact-creator-covered", requireReady: true }),
    Object.freeze({
      id: "distributed-creator-swarm",
      requireReady: true,
      minimumCreatorCountInclusive: 10,
      minimumCreatorInteractionsInclusive: 500,
      maximumTopCreatorInteractionShareInclusive: 0.35,
      maximumCreatorInteractionHhiInclusive: 0.2,
    }),
    Object.freeze({
      id: "concentrated-creator-attention",
      requireReady: true,
      minimumCreatorCountInclusive: 3,
      minimumCreatorInteractionsInclusive: 500,
      minimumTopCreatorInteractionShareInclusive: 0.5,
    }),
    Object.freeze({
      id: "mid-tail-creator-swarm",
      requireReady: true,
      minimumCreatorCountInclusive: 10,
      minimumCreatorInteractionsInclusive: 500,
      minimumMedianCreatorFollowersInclusive: 500,
      maximumMedianCreatorFollowersInclusive: 100_000,
      maximumTopCreatorInteractionShareInclusive: 0.5,
    }),
    Object.freeze({
      id: "creator-interaction-depth",
      requireReady: true,
      minimumCreatorCountInclusive: 3,
      minimumInteractionsPerCreatorInclusive: 500,
    }),
    Object.freeze({
      id: "distributed-creator-social-acceleration-consensus",
      requireReady: true,
      minimumCreatorCountInclusive: 10,
      minimumCreatorInteractionsInclusive: 500,
      maximumTopCreatorInteractionShareInclusive: 0.35,
      maximumCreatorInteractionHhiInclusive: 0.2,
      minimumAccelerationSignalsInclusive: 1,
    }),
  ]),
  derivationStatus: "posthoc-creator-aggregate-hypotheses-only",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseLunarRegistrationEvent(registeredAt = new Date()) {
  const registeredAtIso = validIso(registeredAt);
  const spec = { rule: DEX_PULSE_LUNAR_RULE, researchOnly: true, mutationAllowed: false };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: registeredAtIso,
    status: "frozen",
    ...spec,
  };
}

export async function registerDexPulseLunar(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseLunarRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(DEX_PULSE_LUNAR_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse LunarCrush registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) throw new Error("Existing DEX pulse LunarCrush registration mismatch.");
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export function createDexPulseLunarCreatorRegistrationEvent(registeredAt = new Date()) {
  const registeredAtIso = validIso(registeredAt);
  const spec = {
    rule: DEX_PULSE_LUNAR_CREATOR_RULE,
    researchOnly: true,
    mutationAllowed: false,
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: registeredAtIso,
    status: "frozen",
    ...spec,
  };
}

export async function registerDexPulseLunarCreator(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseLunarCreatorRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(DEX_PULSE_LUNAR_CREATOR_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse LunarCrush creator registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesCreatorRegistration(existing)) {
    throw new Error("Existing DEX pulse LunarCrush creator registration mismatch.");
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

export async function enrichDexSurfacePulseWithLunar(options = {}, dependencies = {}) {
  const now = dependencies.now ?? new Date();
  const collector = dependencies.collector ?? collectExactMintLunarCrushEvidence;
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matchesRegistration);
  if (!registration) throw new Error("Register the DEX pulse LunarCrush policy before enrichment.");
  const creatorRegistration = events.find(matchesCreatorRegistration) ?? null;
  const discovery = [...events].reverse().find((event) => (
    event.type === "discovery"
    && event.provider === DEX_SURFACE_PULSE_RULE.sourceProvider
    && event.ruleVersion === DEX_SURFACE_PULSE_RULE.sourceRuleVersion
  ));
  if (!discovery) return enrichmentResult(ledgerPath, now, "no-source-discovery", null, null);
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  if (!(discoveryAt > Date.parse(registration.registeredAt)
    && discoveryAt > Date.parse(DEX_PULSE_LUNAR_RULE.evidenceBoundary))) {
    return enrichmentResult(ledgerPath, now, "source-not-strictly-future", discovery.id, null);
  }
  if (now.getTime() < discoveryAt || now.getTime() - discoveryAt > MAX_SOURCE_LAG_MS) {
    return enrichmentResult(ledgerPath, now, "source-outside-enrichment-window", discovery.id, null);
  }
  const cadenceHour = Math.floor(discoveryAt / HOUR_MS);
  const existing = events.find((event) => (
    event.type === "dex-surface-pulse-lunar-enrichment"
    && event.registrationId === registration.id
    && event.cadenceHour === cadenceHour
  ));
  if (existing) return enrichmentResult(ledgerPath, now, "skipped-existing-cadence", discovery.id, existing);
  const tokenAddresses = (discovery.candidates ?? []).filter((candidate) => (
    candidate.status === "eligible" && candidate.chain === "solana"
  )).map((candidate) => candidate.tokenAddress);
  if (!tokenAddresses.length) return enrichmentResult(ledgerPath, now, "no-eligible-candidates", discovery.id, null);
  const creatorCollectionEnabled = creatorRegistration != null
    && discoveryAt > Date.parse(creatorRegistration.registeredAt)
    && discoveryAt > Date.parse(DEX_PULSE_LUNAR_CREATOR_RULE.evidenceBoundary);
  const collected = await collector({
    apiKey: options.apiKey,
    chain: "solana",
    tokenAddresses,
    ...(creatorCollectionEnabled ? { creatorTokenAddresses: tokenAddresses } : {}),
    observedAt: now,
    maxRequests: options.maxRequests ?? 10,
  }, dependencies.collectorDependencies ?? {});
  if (collected.discovery) await appendUnique(ledgerPath, events, collected.discovery);
  const evidence = [];
  for (const event of collected.events ?? []) {
    const signed = await appendUnique(ledgerPath, events, event);
    if (tokenAddresses.includes(signed.tokenAddress)) {
      evidence.push({ tokenAddress: signed.tokenAddress, evidenceEventId: signed.id, status: signed.status });
    }
  }
  const creatorEvidence = [];
  for (const event of collected.creatorEvents ?? []) {
    const signed = await appendUnique(ledgerPath, events, event);
    if (creatorCollectionEnabled && tokenAddresses.includes(signed.tokenAddress)) {
      creatorEvidence.push({
        tokenAddress: signed.tokenAddress,
        creatorEvidenceEventId: signed.id,
        status: signed.status,
        creatorAggregateDigest: signed.creatorAggregateDigest ?? null,
      });
    }
  }
  const creatorStatus = !creatorCollectionEnabled
    ? "not-eligible"
    : creatorEvidence.length ? "recorded" : "incomplete";
  const receipt = {
    type: "dex-surface-pulse-lunar-enrichment",
    id: `dex_surface_pulse_lunar_enrichment_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
      cadenceHour,
    }).slice(0, 24)}`,
    ruleVersion: DEX_PULSE_LUNAR_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    cadenceHour,
    collectionStartedAt: collected.observedAt ?? now.toISOString(),
    availableAt: collected.availableAt ?? now.toISOString(),
    status: evidence.length === tokenAddresses.length ? "recorded" : "incomplete",
    tokenCount: tokenAddresses.length,
    evidence,
    creatorRuleVersion: creatorCollectionEnabled ? DEX_PULSE_LUNAR_CREATOR_RULE.version : null,
    creatorRegistrationId: creatorCollectionEnabled ? creatorRegistration.id : null,
    creatorRegisteredAt: creatorCollectionEnabled ? creatorRegistration.registeredAt : null,
    creatorStatus,
    creatorTargetCount: creatorCollectionEnabled ? tokenAddresses.length : 0,
    creatorEvidence,
    requestBudget: collected.requestBudget ?? null,
    universe: collected.universe ?? null,
    researchOnly: true,
    mutationAllowed: false,
  };
  const signedReceipt = await appendLedgerEvent(ledgerPath, receipt);
  return enrichmentResult(ledgerPath, now, signedReceipt.status, discovery.id, signedReceipt);
}

export function buildDexPulseLunarScorecard(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const evidenceEvents = new Map(events
    .filter((event) => event.type === "lunarcrush-social-snapshot")
    .map((event) => [event.id, event]));
  const receipts = new Map(events
    .filter((event) => event.type === "dex-surface-pulse-lunar-enrichment")
    .map((event) => [event.id, event]));
  const rejectionCounts = {};
  const rows = [];
  for (const row of pulse.rows) {
    if (!(Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? ""))) continue;
    const forecast = row.forecast;
    const receipt = receipts.get(forecast.lunarcrushEnrichmentReceiptId);
    const evidence = evidenceEvents.get(forecast.lunarcrushEvidenceId);
    const reason = lunarRowRejectionReason({ forecast, receipt, evidence, registration });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    rows.push({
      ...row,
      lunarStatus: evidence.status,
      interactionsZ: finiteNumber(evidence.socialFeatures?.interactionsZ),
      postsActiveZ: finiteNumber(evidence.socialFeatures?.postsActiveZ),
      contributorsActiveZ: finiteNumber(evidence.socialFeatures?.contributorsActiveZ),
      accelerationSignalCount: finiteNumber(evidence.socialFeatures?.accelerationSignalCount),
      altRank: finiteNumber(evidence.socialFeatures?.altRank),
      galaxyScore: finiteNumber(evidence.socialFeatures?.galaxyScore),
      largeMoveAlert: evidence.socialFeatures?.largeMoveAlert === true,
    });
  }
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  return {
    type: "dex-surface-pulse-lunar-monitoring-scorecard",
    ruleVersion: DEX_PULSE_LUNAR_RULE.version,
    evidenceBoundary: DEX_PULSE_LUNAR_RULE.evidenceBoundary,
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
    screens: DEX_PULSE_LUNAR_RULE.screens.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, (row) => passesLunarScreen(row, screen)),
    })),
    note: "Exact-mint LunarCrush interactions, posts, contributor breadth, AltRank, Galaxy Score, and the frozen move alert are tested only as future paper screens on the fixed-cadence DEX surface cohort. Missing/untracked evidence is not silently treated as negative social evidence.",
  };
}

export function buildDexPulseLunarCreatorScorecard(events) {
  const validated = validatedDexPulseLunarCreatorObservationRows(events);
  const {
    registration,
    pulse,
    rows,
    rejectionCounts,
    candidateForecasts,
  } = validated;
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  return {
    type: "dex-surface-pulse-lunar-creator-monitoring-scorecard",
    ruleVersion: DEX_PULSE_LUNAR_CREATOR_RULE.version,
    evidenceBoundary: DEX_PULSE_LUNAR_CREATOR_RULE.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    researchOnly: true,
    mutationAllowed: false,
    candidateForecasts: candidateForecasts.length,
    openForecasts: candidateForecasts.filter((forecast) => pulse.openForecastIds.includes(forecast.id)).length,
    eligibleLiveObservations: rows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    rejectionCounts,
    parent: summarizeFrames(frames, () => true),
    screens: DEX_PULSE_LUNAR_CREATOR_RULE.screens.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, (row) => passesLunarCreatorScreen(row, screen)),
    })),
    note: "Privacy-safe exact-mint creator aggregates are tested only on strictly future fixed-cadence DEX pulse forecasts. Raw creator identities are never retained. Screens are a multiple-testing hypothesis panel and cannot promote, mutate, or trade.",
  };
}

export function validatedDexPulseLunarCreatorObservationRows(events) {
  const registration = events.find(matchesCreatorRegistration) ?? null;
  const lunarRegistration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const creatorEvents = new Map(events
    .filter((event) => event.type === "lunarcrush-creator-aggregate")
    .map((event) => [event.id, event]));
  const socialEvents = new Map(events
    .filter((event) => event.type === "lunarcrush-social-snapshot")
    .map((event) => [event.id, event]));
  const receipts = new Map(events
    .filter((event) => event.type === "dex-surface-pulse-lunar-enrichment")
    .map((event) => [event.id, event]));
  const rejectionCounts = {};
  const rows = [];
  for (const row of pulse.rows) {
    const forecast = row.forecast;
    if (forecast.lunarcrushCreatorRegistrationId !== registration?.id) continue;
    const receipt = receipts.get(forecast.lunarcrushEnrichmentReceiptId);
    const creatorEvidence = creatorEvents.get(forecast.lunarcrushCreatorEvidenceId);
    const reason = creatorRowRejectionReason({
      forecast,
      receipt,
      creatorEvidence,
      registration,
    });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    const socialEvidence = socialEvents.get(forecast.lunarcrushEvidenceId);
    const socialValid = lunarRowRejectionReason({
      forecast,
      receipt,
      evidence: socialEvidence,
      registration: lunarRegistration,
    }) == null;
    const metrics = creatorEvidence.creatorMetrics;
    rows.push({
      ...row,
      creatorStatus: creatorEvidence.status,
      creatorCount: finiteNumber(metrics?.creatorCount),
      creatorInteractions24h: finiteNumber(metrics?.interactions24h),
      topCreatorInteractionShare: finiteNumber(metrics?.topCreatorInteractionShare),
      creatorInteractionHhi: finiteNumber(metrics?.creatorInteractionHhi),
      medianCreatorFollowers: finiteNumber(metrics?.medianCreatorFollowers),
      interactionsPerCreator: Number.isFinite(metrics?.interactions24h)
        && Number.isFinite(metrics?.creatorCount) && metrics.creatorCount > 0
        ? metrics.interactions24h / metrics.creatorCount : null,
      accelerationSignalCount: socialValid
        ? finiteNumber(socialEvidence.socialFeatures?.accelerationSignalCount) : null,
    });
  }
  const candidateForecasts = pulse.forecasts.filter((forecast) => (
    forecast.lunarcrushCreatorRegistrationId === registration?.id
  ));
  return {
    registration,
    pulse,
    rows,
    rejectionCounts,
    candidateForecasts,
  };
}

export function passesLunarCreatorScreen(row, screen) {
  return (!screen.requireReady || row.creatorStatus === "ready")
    && (!Object.hasOwn(screen, "minimumCreatorCountInclusive")
      || (Number.isFinite(row.creatorCount) && row.creatorCount >= screen.minimumCreatorCountInclusive))
    && (!Object.hasOwn(screen, "minimumCreatorInteractionsInclusive")
      || (Number.isFinite(row.creatorInteractions24h)
        && row.creatorInteractions24h >= screen.minimumCreatorInteractionsInclusive))
    && (!Object.hasOwn(screen, "minimumTopCreatorInteractionShareInclusive")
      || (Number.isFinite(row.topCreatorInteractionShare)
        && row.topCreatorInteractionShare >= screen.minimumTopCreatorInteractionShareInclusive))
    && (!Object.hasOwn(screen, "maximumTopCreatorInteractionShareInclusive")
      || (Number.isFinite(row.topCreatorInteractionShare)
        && row.topCreatorInteractionShare <= screen.maximumTopCreatorInteractionShareInclusive))
    && (!Object.hasOwn(screen, "maximumCreatorInteractionHhiInclusive")
      || (Number.isFinite(row.creatorInteractionHhi)
        && row.creatorInteractionHhi <= screen.maximumCreatorInteractionHhiInclusive))
    && (!Object.hasOwn(screen, "minimumMedianCreatorFollowersInclusive")
      || (Number.isFinite(row.medianCreatorFollowers)
        && row.medianCreatorFollowers >= screen.minimumMedianCreatorFollowersInclusive))
    && (!Object.hasOwn(screen, "maximumMedianCreatorFollowersInclusive")
      || (Number.isFinite(row.medianCreatorFollowers)
        && row.medianCreatorFollowers <= screen.maximumMedianCreatorFollowersInclusive))
    && (!Object.hasOwn(screen, "minimumInteractionsPerCreatorInclusive")
      || (Number.isFinite(row.interactionsPerCreator)
        && row.interactionsPerCreator >= screen.minimumInteractionsPerCreatorInclusive))
    && (!Object.hasOwn(screen, "minimumAccelerationSignalsInclusive")
      || (Number.isFinite(row.accelerationSignalCount)
        && row.accelerationSignalCount >= screen.minimumAccelerationSignalsInclusive));
}

export function passesLunarScreen(row, screen) {
  return (!screen.requireReady || row.lunarStatus === "ready")
    && (!screen.requireLargeMoveAlert || row.largeMoveAlert)
    && (!Object.hasOwn(screen, "minimumInteractionsZExclusive")
      || (Number.isFinite(row.interactionsZ) && row.interactionsZ > screen.minimumInteractionsZExclusive))
    && (!Object.hasOwn(screen, "minimumPostsActiveZExclusive")
      || (Number.isFinite(row.postsActiveZ) && row.postsActiveZ > screen.minimumPostsActiveZExclusive))
    && (!Object.hasOwn(screen, "minimumContributorsActiveZExclusive")
      || (Number.isFinite(row.contributorsActiveZ)
        && row.contributorsActiveZ > screen.minimumContributorsActiveZExclusive))
    && (!Object.hasOwn(screen, "minimumAccelerationSignalsInclusive")
      || (Number.isFinite(row.accelerationSignalCount)
        && row.accelerationSignalCount >= screen.minimumAccelerationSignalsInclusive))
    && (!Object.hasOwn(screen, "maximumAltRankInclusive")
      || (Number.isFinite(row.altRank) && row.altRank <= screen.maximumAltRankInclusive))
    && (!Object.hasOwn(screen, "minimumGalaxyScoreInclusive")
      || (Number.isFinite(row.galaxyScore) && row.galaxyScore >= screen.minimumGalaxyScoreInclusive))
    && (!Object.hasOwn(screen, "minimumBuySellTxnRatioInclusive")
      || (Number.isFinite(row.buySellTxnRatio)
        && row.buySellTxnRatio >= screen.minimumBuySellTxnRatioInclusive))
    && (!Object.hasOwn(screen, "minimumHourlyTurnoverInclusive")
      || (Number.isFinite(row.hourlyTurnover)
        && row.hourlyTurnover >= screen.minimumHourlyTurnoverInclusive));
}

function lunarRowRejectionReason({ forecast, receipt, evidence, registration }) {
  if (!registration || !matchesRegistration(registration)) return "missing-or-invalid-registration";
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))) return "not-strictly-future";
  if (!receipt || receipt.type !== "dex-surface-pulse-lunar-enrichment"
    || receipt.registrationId !== registration.id
    || receipt.discoveryEventId !== forecast.discoveryEventId
    || receipt.status !== "recorded"
    || receipt.researchOnly !== true
    || receipt.mutationAllowed !== false) return "missing-or-invalid-enrichment";
  const link = (receipt.evidence ?? []).find((item) => item.tokenAddress === forecast.tokenAddress);
  if (!evidence || link?.evidenceEventId !== evidence.id
    || evidence.type !== "lunarcrush-social-snapshot"
    || evidence.provider !== "lunarcrush"
    || evidence.chain !== forecast.chain
    || evidence.tokenAddress !== forecast.tokenAddress
    || evidence.ruleVersion !== DEX_PULSE_LUNAR_RULE.lunarcrushRuleVersion
    || evidence.researchOnly !== true
    || evidence.mutationAllowed !== false) return "missing-or-mismatched-exact-mint-evidence";
  const availableAt = Date.parse(evidence.availableAt ?? "");
  const generatedAt = evidence.historyGeneratedAt == null
    ? null
    : Date.parse(evidence.historyGeneratedAt);
  const createdAt = Date.parse(forecast.createdAt);
  if (!(availableAt > Date.parse(registration.registeredAt)
    && availableAt <= createdAt
    && createdAt - availableAt <= MAX_EVIDENCE_LAG_MS)
    || (generatedAt != null && !(generatedAt <= createdAt))) return "invalid-evidence-timing";
  if (!['ready', 'blocked'].includes(evidence.status)) return "invalid-evidence-status";
  if (evidence.status === "ready" && (!evidence.identity
    || evidence.identity.matchStatus !== "exact-single-contract-match"
    || evidence.identity.contractAddress !== forecast.tokenAddress
    || !evidence.socialFeatures
    || canonical(evidence.socialFeatures) !== canonical(
      deriveLunarCrushMoveAlertFeatures(evidence.historyRows ?? []),
    ))) return "invalid-ready-evidence";
  return null;
}

function creatorRowRejectionReason({ forecast, receipt, creatorEvidence, registration }) {
  if (!registration || !matchesCreatorRegistration(registration)) {
    return "missing-or-invalid-creator-registration";
  }
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))
    || forecast.lunarcrushCreatorRegistrationId !== registration.id) return "not-strictly-future";
  if (!receipt || receipt.type !== "dex-surface-pulse-lunar-enrichment"
    || receipt.discoveryEventId !== forecast.discoveryEventId
    || receipt.creatorRuleVersion !== DEX_PULSE_LUNAR_CREATOR_RULE.version
    || receipt.creatorRegistrationId !== registration.id
    || receipt.creatorRegisteredAt !== registration.registeredAt
    || receipt.creatorStatus !== "recorded"
    || receipt.researchOnly !== true
    || receipt.mutationAllowed !== false) return "missing-or-invalid-creator-enrichment";
  const link = (receipt.creatorEvidence ?? []).find((item) => (
    item.tokenAddress === forecast.tokenAddress
  ));
  if (!creatorEvidence || link?.creatorEvidenceEventId !== creatorEvidence.id
    || link?.creatorAggregateDigest !== (creatorEvidence.creatorAggregateDigest ?? null)
    || creatorEvidence.type !== "lunarcrush-creator-aggregate"
    || creatorEvidence.provider !== "lunarcrush"
    || creatorEvidence.profile !== "social-discovery-creator-aggregate"
    || creatorEvidence.chain !== forecast.chain
    || creatorEvidence.tokenAddress !== forecast.tokenAddress
    || creatorEvidence.aggregateOnly !== true
    || creatorEvidence.rawCreatorIdentitiesRetained !== false
    || creatorEvidence.researchOnly !== true
    || creatorEvidence.mutationAllowed !== false) return "missing-or-mismatched-creator-evidence";
  const availableAt = Date.parse(creatorEvidence.availableAt ?? "");
  const generatedAt = creatorEvidence.creatorGeneratedAt == null
    ? null : Date.parse(creatorEvidence.creatorGeneratedAt);
  const createdAt = Date.parse(forecast.createdAt);
  if (!(availableAt > Date.parse(registration.registeredAt)
    && availableAt <= createdAt
    && createdAt - availableAt <= MAX_EVIDENCE_LAG_MS)
    || (generatedAt != null && !(generatedAt <= createdAt))) return "invalid-creator-evidence-timing";
  if (!["ready", "blocked"].includes(creatorEvidence.status)) return "invalid-creator-evidence-status";
  if (creatorEvidence.status === "ready" && (!creatorEvidence.identity
    || creatorEvidence.identity.matchStatus !== "exact-single-contract-topic-match"
    || creatorEvidence.identity.contractAddress !== forecast.tokenAddress
    || creatorEvidence.topicJoinStatus !== "provider-coin-row-exact-contract-unique-topic"
    || !validCreatorMetrics(creatorEvidence.creatorMetrics)
    || creatorEvidence.creatorAggregateDigest !== digestValue(creatorEvidence.creatorMetrics))) {
    return "invalid-creator-aggregate";
  }
  if (creatorEvidence.status === "blocked" && creatorEvidence.creatorMetrics != null) {
    return "invalid-creator-aggregate";
  }
  return null;
}

function validCreatorMetrics(metrics) {
  if (!metrics || !Number.isInteger(metrics.creatorCount) || metrics.creatorCount < 1
    || !Number.isFinite(metrics.interactions24h) || metrics.interactions24h < 0
    || !bounded(metrics.topCreatorInteractionShare, 0, 1)
    || !bounded(metrics.creatorInteractionHhi, 0, 1)
    || !(metrics.medianCreatorFollowers == null
      || (Number.isFinite(metrics.medianCreatorFollowers) && metrics.medianCreatorFollowers >= 0))
    || !(metrics.medianCreatorRank == null
      || (Number.isFinite(metrics.medianCreatorRank) && metrics.medianCreatorRank >= 0))
    || !metrics.networkCounts || typeof metrics.networkCounts !== "object"
    || Array.isArray(metrics.networkCounts)) return false;
  const networkCounts = Object.values(metrics.networkCounts);
  return networkCounts.every((value) => Number.isInteger(value) && value >= 0)
    && networkCounts.reduce((sum, value) => sum + value, 0) === metrics.creatorCount;
}

function bounded(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
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
    creatorStatus: receipt?.creatorStatus ?? "not-eligible",
    creatorEvidence: receipt?.creatorEvidence ?? [],
    requestBudget: receipt?.requestBudget ?? { maximum: 0, attempted: 0, succeeded: 0, failed: 0 },
  };
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseLunarRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesCreatorRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseLunarCreatorRegistrationEvent(event.registeredAt);
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
  const values = left.map((value, index) => Number.isFinite(value) && Number.isFinite(right[index])
    ? value - right[index]
    : null).filter(Number.isFinite);
  return mean(values);
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
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
}

function validIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Expected a valid timestamp.");
  return date.toISOString();
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
    else if (argv[index] === "--max-lunarcrush-requests") options.maxRequests = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "register-creator", "enrich", "score", "score-creator"].includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-lunar-monitoring.mjs register|register-creator|enrich|score|score-creator [--max-lunarcrush-requests 10] [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") console.log(JSON.stringify(await registerDexPulseLunar(options), null, 2));
    else if (options.command === "register-creator") {
      console.log(JSON.stringify(await registerDexPulseLunarCreator(options), null, 2));
    }
    else if (options.command === "enrich") console.log(JSON.stringify(await enrichDexSurfacePulseWithLunar({
      ...options,
      apiKey: process.env.LUNARCRUSH_API_KEY,
    }), null, 2));
    else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      const scorecard = options.command === "score-creator"
        ? buildDexPulseLunarCreatorScorecard(events)
        : buildDexPulseLunarScorecard(events);
      console.log(JSON.stringify({ ledgerPath, verification: verifyLedger(events), scorecard }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
