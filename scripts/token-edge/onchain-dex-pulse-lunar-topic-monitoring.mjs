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
  LUNARCRUSH_EXACT_CONTRACT_TOPIC_RULE,
  collectExactMintLunarCrushTopicEvidence,
} from "./onchain-lunarcrush-provider.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const MAX_LAG_MS = 5 * 60_000;

export const DEX_PULSE_LUNAR_TOPIC_RULE = Object.freeze({
  version: "dex-surface-pulse-lunar-exact-contract-topic-panel-v1",
  evidenceBoundary: "2026-08-03T21:06:30.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  sourceTopicRuleVersion: LUNARCRUSH_EXACT_CONTRACT_TOPIC_RULE.version,
  provider: "lunarcrush",
  screens: Object.freeze([
    Object.freeze({ id: "exact-contract-topic-covered", requireReady: true }),
    Object.freeze({ id: "at-least-ten-topic-contributors", requireReady: true, minimumContributors: 10 }),
    Object.freeze({ id: "at-least-ten-topic-posts", requireReady: true, minimumPosts: 10 }),
    Object.freeze({ id: "at-least-five-hundred-topic-interactions", requireReady: true, minimumInteractions: 500 }),
    Object.freeze({ id: "topic-interaction-depth", requireReady: true, minimumInteractionsPerPost: 100 }),
    Object.freeze({
      id: "exact-contract-topic-breadth-consensus",
      requireReady: true,
      minimumContributors: 10,
      minimumPosts: 10,
      minimumInteractions: 500,
      minimumInteractionsPerPost: 100,
    }),
  ]),
  derivationStatus: "posthoc-dorkl-endpoint-coverage-hypotheses-only",
  derivationNote: "DORKL was absent from the Lunar coin universe but its exact mint resolved as a current topic after its +98.537623% outcome. That response, DORKL, and all evidence through the boundary are excluded. Round aggregate screens are a future multiple-testing panel, not a fitted predictor.",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseLunarTopicRegistrationEvent(registeredAt = new Date()) {
  const spec = { rule: DEX_PULSE_LUNAR_TOPIC_RULE, researchOnly: true, mutationAllowed: false };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: validIso(registeredAt),
    status: "frozen",
    ...spec,
  };
}

export async function registerDexPulseLunarTopic(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseLunarTopicRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(DEX_PULSE_LUNAR_TOPIC_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse Lunar topic registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) throw new Error("Existing Lunar topic registration mismatch.");
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export async function enrichDexSurfacePulseWithLunarTopic(options = {}, dependencies = {}) {
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find(matchesRegistration);
  if (!registration) throw new Error("Register the DEX pulse Lunar topic policy before enrichment.");
  const discovery = [...events].reverse().find((event) => (
    event.type === "discovery"
    && event.provider === DEX_SURFACE_PULSE_RULE.sourceProvider
    && event.ruleVersion === DEX_SURFACE_PULSE_RULE.sourceRuleVersion
  ));
  if (!discovery) return enrichmentResult(ledgerPath, now, "no-source-discovery", null, null);
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  if (!(discoveryAt > Date.parse(registration.registeredAt)
    && discoveryAt > Date.parse(DEX_PULSE_LUNAR_TOPIC_RULE.evidenceBoundary))) {
    return enrichmentResult(ledgerPath, now, "source-not-strictly-future", discovery.id, null);
  }
  if (now.getTime() < discoveryAt || now.getTime() - discoveryAt > MAX_LAG_MS) {
    return enrichmentResult(ledgerPath, now, "source-outside-enrichment-window", discovery.id, null);
  }
  const existing = events.find((event) => (
    event.type === "dex-surface-pulse-lunar-topic-enrichment"
    && event.registrationId === registration.id
    && event.discoveryEventId === discovery.id
  ));
  if (existing) return enrichmentResult(ledgerPath, now, "skipped-existing-discovery", discovery.id, existing);
  const tokenAddresses = [...new Set((discovery.candidates ?? []).filter((candidate) => (
    candidate.status === "eligible" && candidate.chain === "solana"
  )).map((candidate) => candidate.tokenAddress))];
  if (!tokenAddresses.length) return enrichmentResult(ledgerPath, now, "no-eligible-candidates", discovery.id, null);
  const maximum = finiteInteger(options.maxRequests) ?? 10;
  if (tokenAddresses.length > maximum) {
    throw new Error(`Lunar topic enrichment requires ${tokenAddresses.length} requests; budget is ${maximum}.`);
  }
  const collected = await collectExactMintLunarCrushTopicEvidence({
    apiKey: options.apiKey ?? process.env.LUNARCRUSH_API_KEY,
    chain: "solana",
    tokenAddresses,
    observedAt: now,
    maxRequests: maximum,
  }, {
    fetcher: dependencies.fetcher,
    clock: dependencies.responseNow,
  });
  const evidence = [];
  for (const source of collected.events) {
    const event = {
      ...source,
      registrationId: registration.id,
      discoveryEventId: discovery.id,
    };
    const signed = await appendUnique(ledgerPath, events, event);
    evidence.push({
      tokenAddress: signed.tokenAddress,
      evidenceEventId: signed.id,
      status: signed.status,
      topicMetricsDigest: signed.topicMetricsDigest,
    });
  }
  const receipt = {
    type: "dex-surface-pulse-lunar-topic-enrichment",
    id: `dex_surface_pulse_lunar_topic_enrichment_${digestValue({
      registrationId: registration.id, discoveryEventId: discovery.id,
    }).slice(0, 24)}`,
    ruleVersion: DEX_PULSE_LUNAR_TOPIC_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    collectionStartedAt: collected.collectionStartedAt,
    availableAt: latestIso(collected.events.map((event) => event.availableAt)),
    status: "recorded",
    tokenCount: tokenAddresses.length,
    evidence,
    requestBudget: collected.requestBudget,
    researchOnly: true,
    mutationAllowed: false,
  };
  const signedReceipt = await appendLedgerEvent(ledgerPath, receipt);
  return enrichmentResult(ledgerPath, now, signedReceipt.status, discovery.id, signedReceipt);
}

export function validatedDexPulseLunarTopicForecastRows(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const discoveries = new Map(events.filter((event) => (
    event.type === "discovery"
  )).map((event) => [event.id, event]));
  const evidenceEvents = new Map(events.filter((event) => (
    event.type === "lunarcrush-contract-topic-snapshot"
  )).map((event) => [event.id, event]));
  const receipts = new Map(events.filter((event) => (
    event.type === "dex-surface-pulse-lunar-topic-enrichment"
  )).map((event) => [event.id, event]));
  const rejectionCounts = {};
  const forecastRows = [];
  for (const forecast of pulse.forecasts) {
    if (!(Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? ""))) continue;
    const receipt = receipts.get(forecast.lunarcrushTopicEnrichmentReceiptId);
    const evidence = evidenceEvents.get(forecast.lunarcrushTopicEvidenceId);
    const reason = lunarTopicRowRejectionReason({
      forecast,
      receipt,
      evidence,
      registration,
      discovery: discoveries.get(forecast.discoveryEventId),
    });
    if (reason) increment(rejectionCounts, reason);
    const metrics = reason ? null : evidence.topicMetrics;
    forecastRows.push({
      forecast,
      forecastId: forecast.id,
      chain: forecast.chain,
      tokenAddress: forecast.tokenAddress,
      createdAt: forecast.createdAt,
      evidence,
      topicReady: reason == null && evidence.status === "ready",
      topicInteractions24h: finiteNumber(metrics?.interactions24h),
      topicContributors: finiteNumber(metrics?.contributorCount),
      topicPosts: finiteNumber(metrics?.postCount),
      topicInteractionsPerPost: finiteNumber(metrics?.interactionsPerPost),
    });
  }
  return { registration, pulse, forecastRows, rejectionCounts };
}

export function validatedDexPulseLunarTopicEvidenceRows(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const discoveries = new Map(events.filter((event) => (
    event.type === "discovery"
  )).map((event) => [event.id, event]));
  const receipts = new Map(events.filter((event) => (
    event.type === "dex-surface-pulse-lunar-topic-enrichment"
  )).map((event) => [`${event.registrationId}:${event.discoveryEventId}`, event]));
  const rejectionCounts = {};
  const evidenceRows = [];
  for (const evidence of events.filter((event) => (
    event.type === "lunarcrush-contract-topic-snapshot"
  ))) {
    const receipt = receipts.get(`${evidence.registrationId}:${evidence.discoveryEventId}`);
    const reason = lunarTopicEvidenceRejectionReason({
      evidence,
      receipt,
      registration,
      discovery: discoveries.get(evidence.discoveryEventId),
    });
    if (reason) increment(rejectionCounts, reason);
    evidenceRows.push({
      evidence,
      receipt,
      discovery: discoveries.get(evidence.discoveryEventId) ?? null,
      chain: evidence.chain,
      tokenAddress: evidence.tokenAddress,
      availableAt: evidence.availableAt,
      topicReady: reason == null,
      topicInteractions24h: reason ? null : finiteNumber(evidence.topicMetrics?.interactions24h),
      topicContributors: reason ? null : finiteNumber(evidence.topicMetrics?.contributorCount),
      topicPosts: reason ? null : finiteNumber(evidence.topicMetrics?.postCount),
      topicInteractionsPerPost: reason
        ? null : finiteNumber(evidence.topicMetrics?.interactionsPerPost),
    });
  }
  return { registration, evidenceRows, rejectionCounts };
}

export function buildDexPulseLunarTopicScorecard(events) {
  const validated = validatedDexPulseLunarTopicForecastRows(events);
  const { registration, pulse, rejectionCounts } = validated;
  const forecastRows = new Map(validated.forecastRows.map((row) => [row.forecastId, row]));
  const rows = pulse.rows.filter((row) => (
    Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? "")
  )).map((row) => ({ ...row, ...forecastRows.get(row.forecastId) }));
  const frames = independentAssetFrames(rows, {
    durationMs: HOUR_MS,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const candidateForecasts = pulse.forecasts.filter((forecast) => (
    Date.parse(forecast.createdAt) > Date.parse(registration?.registeredAt ?? "")
  ));
  return {
    type: "dex-surface-pulse-lunar-exact-contract-topic-scorecard",
    ruleVersion: DEX_PULSE_LUNAR_TOPIC_RULE.version,
    evidenceBoundary: DEX_PULSE_LUNAR_TOPIC_RULE.evidenceBoundary,
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
    screens: DEX_PULSE_LUNAR_TOPIC_RULE.screens.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, (row) => passesLunarTopicScreen(row, screen)),
    })),
    note: "Every strictly future valid pulse stays in the parent. Missing, blocked, late, mismatched, or tampered exact-contract topic evidence is challenger cash. This multiple-testing panel cannot promote, mutate, or trade.",
  };
}

export function passesLunarTopicScreen(row, screen) {
  return (!screen.requireReady || row.topicReady)
    && (!Object.hasOwn(screen, "minimumContributors")
      || row.topicContributors >= screen.minimumContributors)
    && (!Object.hasOwn(screen, "minimumPosts") || row.topicPosts >= screen.minimumPosts)
    && (!Object.hasOwn(screen, "minimumInteractions")
      || row.topicInteractions24h >= screen.minimumInteractions)
    && (!Object.hasOwn(screen, "minimumInteractionsPerPost")
      || row.topicInteractionsPerPost >= screen.minimumInteractionsPerPost);
}

function lunarTopicRowRejectionReason({
  forecast, receipt, evidence, registration, discovery,
}) {
  if (!registration || !matchesRegistration(registration)) return "missing-or-invalid-registration";
  if (!(Date.parse(forecast.createdAt) > Date.parse(registration.registeredAt))) return "not-strictly-future";
  const evidenceReason = lunarTopicEvidenceRejectionReason({
    evidence, receipt, registration, discovery,
  });
  if (evidenceReason) return evidenceReason;
  if (receipt.id !== forecast.lunarcrushTopicEnrichmentReceiptId
    || receipt.discoveryEventId !== forecast.discoveryEventId
    || evidence.id !== forecast.lunarcrushTopicEvidenceId
    || evidence.discoveryEventId !== forecast.discoveryEventId
    || evidence.chain !== forecast.chain
    || evidence.tokenAddress !== forecast.tokenAddress) {
    return "missing-or-mismatched-exact-contract-topic";
  }
  const sourceAt = Date.parse(forecast.sourceDiscoveryObservedAt ?? "");
  const collectionAt = Date.parse(evidence.collectionStartedAt ?? "");
  const availableAt = Date.parse(evidence.availableAt ?? "");
  const createdAt = Date.parse(forecast.createdAt ?? "");
  if (!(collectionAt >= sourceAt && collectionAt - sourceAt <= MAX_LAG_MS
    && availableAt >= collectionAt && availableAt <= createdAt
    && createdAt - availableAt <= MAX_LAG_MS)) return "invalid-topic-evidence-timing";
  return null;
}

function lunarTopicEvidenceRejectionReason({ evidence, receipt, registration, discovery }) {
  if (!registration || !matchesRegistration(registration)) return "missing-or-invalid-registration";
  if (!receipt || receipt.type !== "dex-surface-pulse-lunar-topic-enrichment"
    || receipt.registrationId !== registration.id
    || receipt.discoveryEventId !== evidence?.discoveryEventId
    || receipt.status !== "recorded"
    || receipt.researchOnly !== true
    || receipt.mutationAllowed !== false) return "missing-or-invalid-enrichment";
  const link = (receipt.evidence ?? []).find((item) => item.tokenAddress === evidence?.tokenAddress);
  if (!evidence || link?.evidenceEventId !== evidence.id
    || link?.topicMetricsDigest !== evidence.topicMetricsDigest
    || evidence.type !== "lunarcrush-contract-topic-snapshot"
    || evidence.provider !== "lunarcrush"
    || evidence.profile !== "exact-contract-topic-point"
    || evidence.ruleVersion !== LUNARCRUSH_EXACT_CONTRACT_TOPIC_RULE.version
    || evidence.registrationId !== registration.id
    || evidence.chain !== "solana"
    || evidence.aggregateOnly !== true
    || evidence.rawPostsRetained !== false
    || evidence.rawCreatorIdentitiesRetained !== false
    || evidence.researchOnly !== true
    || evidence.mutationAllowed !== false) return "missing-or-mismatched-exact-contract-topic";
  if (!discovery
    || discovery.provider !== DEX_SURFACE_PULSE_RULE.sourceProvider
    || discovery.ruleVersion !== DEX_SURFACE_PULSE_RULE.sourceRuleVersion
    || discovery.id !== evidence.discoveryEventId
    || !(discovery.candidates ?? []).some((candidate) => (
      candidate.status === "eligible"
      && candidate.chain === evidence.chain
      && candidate.tokenAddress === evidence.tokenAddress
    ))) return "invalid-topic-source-discovery";
  const discoveryAt = Date.parse(discovery.observedAt ?? "");
  const collectionAt = Date.parse(evidence.collectionStartedAt ?? "");
  const availableAt = Date.parse(evidence.availableAt ?? "");
  if (!(collectionAt >= discoveryAt && collectionAt - discoveryAt <= MAX_LAG_MS
    && availableAt >= collectionAt)) return "invalid-topic-evidence-timing";
  if (evidence.status === "blocked") return "blocked-exact-contract-topic";
  if (evidence.status !== "ready"
    || evidence.identity?.matchStatus !== "exact-contract-topic-and-title"
    || evidence.identity.requestedContractAddress !== evidence.tokenAddress
    || evidence.identity.responseTitle !== evidence.tokenAddress
    || String(evidence.identity.responseTopic).toLowerCase() !== evidence.tokenAddress.toLowerCase()
    || !validTopicMetrics(evidence.topicMetrics)
    || evidence.topicMetricsDigest !== digestValue(evidence.topicMetrics)) {
    return "invalid-exact-contract-topic-aggregate";
  }
  return null;
}

function validTopicMetrics(metrics) {
  return metrics && [metrics.interactions24h, metrics.contributorCount, metrics.postCount]
    .every((value) => Number.isFinite(value) && value >= 0)
    && (metrics.interactionsPerPost == null
      || (Number.isFinite(metrics.interactionsPerPost) && metrics.interactionsPerPost >= 0))
    && (metrics.interactionsPerContributor == null
      || (Number.isFinite(metrics.interactionsPerContributor)
        && metrics.interactionsPerContributor >= 0));
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
    riseRate: nullableRound(selected.length ? selected.filter((row) => row.grossReturnPct > 0).length / selected.length : null),
    netWinRate: nullableRound(selected.length ? selected.filter((row) => row.baseCapacityReturnPct > 0).length / selected.length : null),
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
  return existing ?? appendLedgerEvent(ledgerPath, event);
}

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseLunarTopicRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function enrichmentResult(ledgerPath, now, status, discoveryEventId, receipt) {
  return {
    ledgerPath,
    observedAt: validIso(now),
    status,
    discoveryEventId,
    enrichmentReceiptId: receipt?.id ?? null,
    tokenCount: receipt?.tokenCount ?? 0,
    requestBudget: receipt?.requestBudget ?? { maximum: 0, attempted: 0, succeeded: 0, failed: 0 },
    evidence: receipt?.evidence ?? [],
  };
}

function latestIso(values) {
  const times = values.map((value) => Date.parse(value ?? "")).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function pairedMean(left, right) {
  return left.length === right.length ? mean(left.map((value, index) => value - right[index])) : null;
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
    else if (argv[index] === "--max-lunarcrush-requests") options.maxRequests = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "enrich", "score"].includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-lunar-topic-monitoring.mjs register|enrich|score [--max-lunarcrush-requests 10] [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseLunarTopic(options), null, 2));
    } else if (options.command === "enrich") {
      console.log(JSON.stringify(await enrichDexSurfacePulseWithLunarTopic(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: buildDexPulseLunarTopicScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
