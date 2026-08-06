#!/usr/bin/env node

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
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
} from "./onchain-geckoterminal-new-pool-activation.mjs";
import { geckoTrendingCandidate } from "./onchain-geckoterminal-trending-monitoring.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const HOUR_MS = 60 * 60_000;
const MAX_OBSERVATION_LAG_MS = 10 * 60_000;
const HORIZONS = Object.freeze({
  "1h": HOUR_MS,
  "24h": 24 * HOUR_MS,
});

export const GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE = Object.freeze({
  version: "geckoterminal-solana-new-pool-full-cohort-delayed-shadow-v1",
  parentRuleVersion: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.version,
  changedDimension: "measurement-coverage-from-eligible-forecasts-to-all-future-watched-pools",
  sourceProvider: "geckoterminal-multi-exact-pool",
  sourceMaximumRows: GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE.sourceMaximumRows,
  horizons: Object.freeze(Object.keys(HORIZONS)),
  horizonClock: "source-discovery-observed-at",
  maximumObservationLagMinutes: MAX_OBSERVATION_LAG_MS / 60_000,
  maximumProviderRequestsPerRun: 1,
  paperNotionalUsd: TOKEN_EDGE_EXECUTION_POLICY.paperNotionalUsd,
  baseRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.baseRoundTripCostPct,
  stressRoundTripCostPct: TOKEN_EDGE_EXECUTION_POLICY.stressRoundTripCostPct,
  decision: "none-observation-only",
  researchOnly: true,
  mutationAllowed: false,
  decisionAuthority: false,
  promotionAuthority: false,
  tradingAuthority: false,
});

export function createGeckoTerminalNewPoolDelayedShadowRegistrationEvent({
  registeredAt,
  evidenceBoundary,
}) {
  const registered = validDate(registeredAt);
  const boundary = validDate(evidenceBoundary);
  if (registered.getTime() <= boundary.getTime()) {
    throw new Error("Delayed shadow registration must be strictly after its evidence boundary.");
  }
  const rule = {
    ...GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE,
    evidenceBoundary: boundary.toISOString(),
  };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue({
      registeredAt: registered.toISOString(),
      rule,
    }).slice(0, 24)}`,
    registeredAt: registered.toISOString(),
    status: "frozen",
    rule,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

export async function registerGeckoTerminalNewPoolDelayedShadow(
  options = {},
  dependencies = {},
) {
  const now = validDate(dependencies.now ?? new Date());
  const evidenceBoundary = validDate(options.evidenceBoundary);
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const existing = events.find((event) => matchesRegistration(event, evidenceBoundary));
  if (existing) return registrationResult(ledgerPath, "existing", existing);
  const conflicting = events.find((event) => (
    event.type === "monitoring-policy-registration"
      && event.status === "frozen"
      && event.rule?.version === GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version
  ));
  if (conflicting) throw new Error(`Existing delayed shadow registration mismatch: ${conflicting.id}`);
  const event = createGeckoTerminalNewPoolDelayedShadowRegistrationEvent({
    registeredAt: now,
    evidenceBoundary,
  });
  return registrationResult(
    ledgerPath,
    "registered",
    await appendLedgerEvent(ledgerPath, event),
  );
}

export async function resolveGeckoTerminalNewPoolDelayedShadows(
  options = {},
  dependencies = {},
) {
  const horizon = validHorizon(options.horizon);
  const now = validDate(dependencies.now ?? new Date());
  const fetcher = dependencies.fetcher ?? fetch;
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const registration = events.find((event) => matchesRegistration(event));
  if (!registration) throw new Error("Register the delayed full-cohort shadow before resolving it.");
  const existing = new Set(events.filter((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
      && event.registrationId === registration.id
      && event.horizon === horizon
  )).map((event) => `${event.discoveryEventId}:${event.pairAddress}`));
  const groups = events.filter((event) => (
    event.type === "geckoterminal-new-pool-discovery"
      && Date.parse(event.observedAt) > Date.parse(registration.registeredAt)
  )).map((discovery) => {
    const dueAt = new Date(Date.parse(discovery.observedAt) + HORIZONS[horizon]);
    const candidates = (discovery.candidates ?? []).filter((candidate) => (
      candidate.birthQuote
        && !existing.has(`${discovery.id}:${candidate.pairAddress}`)
    ));
    return { discovery, dueAt, candidates };
  }).filter((group) => (
    group.candidates.length && group.dueAt.getTime() <= now.getTime()
  )).sort((left, right) => left.dueAt - right.dueAt);
  if (!groups.length) return resolutionResult(ledgerPath, horizon, now, 0, 0, [], []);

  const outcomes = [];
  const failures = [];
  const expired = groups.filter((group) => (
    now.getTime() - group.dueAt.getTime() > MAX_OBSERVATION_LAG_MS
  ));
  for (const group of expired) {
    for (const candidate of group.candidates) {
      outcomes.push(await appendLedgerEvent(ledgerPath, delayedOutcomeEvent({
        registration,
        discovery: group.discovery,
        candidate,
        horizon,
        dueAt: group.dueAt,
        observedAt: now,
        status: "missed",
        reason: "delayed-shadow-window-expired",
        outcomeQuote: null,
      })));
    }
  }
  const live = groups.filter((group) => !expired.includes(group));
  if (!live.length) {
    return resolutionResult(
      ledgerPath,
      horizon,
      now,
      groups.reduce((sum, group) => sum + group.candidates.length, 0),
      0,
      outcomes,
      failures,
    );
  }

  const selected = live[0];
  const multi = await collectGeckoMultiPools(
    selected.candidates.map((candidate) => candidate.pairAddress),
    fetcher,
  );
  failures.push(...multi.failures);
  if (multi.failures.length && multi.rowsByPair.size === 0) {
    return resolutionResult(
      ledgerPath,
      horizon,
      now,
      groups.reduce((sum, group) => sum + group.candidates.length, 0),
      multi.requestsAttempted,
      outcomes,
      failures,
    );
  }
  const sourceObservedAt = validDate(dependencies.clock?.() ?? (
    dependencies.now ? now : new Date()
  ));
  for (const candidate of selected.candidates) {
    const row = multi.rowsByPair.get(candidate.pairAddress);
    if (!row) {
      const reason = "delayed-shadow-exact-pool-unavailable";
      failures.push(`${reason}: ${candidate.pairAddress}`);
      outcomes.push(await appendLedgerEvent(ledgerPath, delayedOutcomeEvent({
        registration,
        discovery: selected.discovery,
        candidate,
        horizon,
        dueAt: selected.dueAt,
        observedAt: sourceObservedAt,
        status: "missed",
        reason,
        outcomeQuote: null,
      })));
      continue;
    }
    const outcomeQuote = geckoTrendingCandidate(
      row,
      candidate.sourceRank,
      sourceObservedAt,
      GECKOTERMINAL_NEW_POOL_ACTIVATION_RULE,
    );
    let reason = delayedOutcomeIneligibilityReason({
      candidate,
      outcomeQuote,
      dueAt: selected.dueAt,
      observedAt: sourceObservedAt,
    });
    if (reason) failures.push(`${reason}: ${candidate.pairAddress}`);
    outcomes.push(await appendLedgerEvent(ledgerPath, delayedOutcomeEvent({
      registration,
      discovery: selected.discovery,
      candidate,
      horizon,
      dueAt: selected.dueAt,
      observedAt: sourceObservedAt,
      status: reason ? "missed" : "observed",
      reason,
      outcomeQuote: reason ? null : outcomeQuote,
    })));
  }
  return resolutionResult(
    ledgerPath,
    horizon,
    sourceObservedAt,
    groups.reduce((sum, group) => sum + group.candidates.length, 0),
    multi.requestsAttempted,
    outcomes,
    failures,
  );
}

export function buildGeckoTerminalNewPoolDelayedShadowScorecard(events) {
  const registration = events.find((event) => matchesRegistration(event)) ?? null;
  const discoveries = new Map(events.filter((event) => (
    event.type === "geckoterminal-new-pool-discovery"
  )).map((event) => [event.id, event]));
  const prospectiveCandidateCount = registration
    ? [...discoveries.values()].filter((discovery) => (
      Date.parse(discovery.observedAt) > Date.parse(registration.registeredAt)
    )).reduce((sum, discovery) => sum + (discovery.candidates ?? []).filter((candidate) => (
      candidate.birthQuote
    )).length, 0)
    : 0;
  const outcomes = events.filter((event) => (
    event.type === "geckoterminal-new-pool-delayed-shadow-outcome"
      && event.registrationId === registration?.id
  ));
  const horizons = Object.fromEntries(Object.keys(HORIZONS).map((horizon) => {
    const horizonOutcomes = outcomes.filter((event) => event.horizon === horizon);
    const rows = horizonOutcomes.map((outcome) => delayedScoreRow(
      outcome,
      discoveries.get(outcome.discoveryEventId),
    )).filter(Boolean);
    const frames = independentAssetFrames(rows, {
      durationMs: HOUR_MS,
      timestamp: (row) => Date.parse(row.createdAt),
      assetKey: tokenEdgeAssetKey,
    });
    const weightedRows = frames.flat();
    const baseFrames = frames.map((frame) => mean(frame.map((row) => row.baseReturnPct)));
    const stressFrames = frames.map((frame) => mean(frame.map((row) => row.stressReturnPct)));
    return [horizon, {
      prospectiveCandidates: prospectiveCandidateCount,
      candidateOutcomes: horizonOutcomes.length,
      openOutcomes: Math.max(0, prospectiveCandidateCount - horizonOutcomes.length),
      observedOutcomes: horizonOutcomes.filter((event) => event.status === "observed").length,
      missedOutcomes: horizonOutcomes.filter((event) => event.status === "missed").length,
      validCapacityRows: weightedRows.length,
      independentHourlyFrames: frames.length,
      uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
      grossRiseRate: roundRatio(
        weightedRows.filter((row) => row.grossReturnPct > 0).length,
        weightedRows.length,
      ),
      explosion25Rate: roundRatio(
        weightedRows.filter((row) => row.grossReturnPct >= 25).length,
        weightedRows.length,
      ),
      averageBaseReturnPct: nullableRound(mean(baseFrames)),
      averageStressReturnPct: nullableRound(mean(stressFrames)),
      largestWinningFrameShare: nullableRound(largestWinningShare(baseFrames)),
    }];
  }));
  return {
    type: "geckoterminal-new-pool-delayed-shadow-scorecard",
    ruleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    evidenceBoundary: registration?.rule?.evidenceBoundary ?? null,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
    candidateOutcomes: outcomes.length,
    prospectiveCandidates: prospectiveCandidateCount * Object.keys(HORIZONS).length,
    openOutcomes: Math.max(
      0,
      prospectiveCandidateCount * Object.keys(HORIZONS).length - outcomes.length,
    ),
    observedOutcomes: outcomes.filter((event) => event.status === "observed").length,
    missedOutcomes: outcomes.filter((event) => event.status === "missed").length,
    horizons,
    evidenceStatus: "descriptive-only",
    provisionalGate: false,
    note: "This strictly future panel records delayed labels for every watched pool, including pools blocked from paper forecasts. It creates no entry decision and its return distribution is not a tradable strategy or promotion result.",
  };
}

function delayedOutcomeEvent({
  registration,
  discovery,
  candidate,
  horizon,
  dueAt,
  observedAt,
  status,
  reason,
  outcomeQuote,
}) {
  const birthQuote = candidate.birthQuote;
  const grossReturnPct = status === "observed"
    ? nullableRound(((outcomeQuote.priceUsd / birthQuote.priceUsd) - 1) * 100)
    : null;
  return {
    type: "geckoterminal-new-pool-delayed-shadow-outcome",
    id: `geckoterminal_new_pool_delayed_shadow_outcome_${digestValue({
      registrationId: registration.id,
      discoveryEventId: discovery.id,
      pairAddress: candidate.pairAddress,
      horizon,
    }).slice(0, 24)}`,
    ruleVersion: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    discoveryEventId: discovery.id,
    chain: candidate.chain,
    tokenAddress: candidate.tokenAddress,
    symbol: candidate.symbol,
    pairAddress: candidate.pairAddress,
    poolCreatedAt: candidate.poolCreatedAt,
    horizon,
    sourceDiscoveryObservedAt: discovery.observedAt,
    dueAt: dueAt.toISOString(),
    observedAt: observedAt.toISOString(),
    observationLagMs: observedAt.getTime() - dueAt.getTime(),
    status,
    reason,
    birthQuoteDigest: digestValue(birthQuote),
    outcomeQuote,
    grossReturnPct,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

function delayedOutcomeIneligibilityReason({
  candidate,
  outcomeQuote,
  dueAt,
  observedAt,
}) {
  if (observedAt.getTime() - dueAt.getTime() > MAX_OBSERVATION_LAG_MS) {
    return "delayed-shadow-response-after-window";
  }
  if (outcomeQuote.tokenAddress !== candidate.tokenAddress
    || outcomeQuote.pairAddress !== candidate.pairAddress
    || outcomeQuote.poolCreatedAt !== candidate.poolCreatedAt) {
    return "delayed-shadow-identity-mismatch";
  }
  if (!(outcomeQuote.priceUsd > 0) || !(outcomeQuote.liquidityUsd > 0)) {
    return "delayed-shadow-price-or-liquidity-unavailable";
  }
  return null;
}

function delayedScoreRow(outcome, discovery) {
  if (outcome?.status !== "observed" || !discovery) return null;
  const candidate = (discovery.candidates ?? []).find((item) => (
    item.tokenAddress === outcome.tokenAddress
      && item.pairAddress === outcome.pairAddress
  ));
  const birthQuote = candidate?.birthQuote;
  const outcomeQuote = outcome.outcomeQuote;
  if (!birthQuote || digestValue(birthQuote) !== outcome.birthQuoteDigest) return null;
  const baseReturnPct = capacityAdjustedReturnPct({
    grossReturnPct: outcome.grossReturnPct,
    entryLiquidityUsd: birthQuote.liquidityUsd,
    exitLiquidityUsd: outcomeQuote?.liquidityUsd,
    paperNotionalUsd: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.paperNotionalUsd,
    roundTripCostPct: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.baseRoundTripCostPct,
  });
  const stressReturnPct = capacityAdjustedReturnPct({
    grossReturnPct: outcome.grossReturnPct,
    entryLiquidityUsd: birthQuote.liquidityUsd,
    exitLiquidityUsd: outcomeQuote?.liquidityUsd,
    paperNotionalUsd: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.paperNotionalUsd,
    roundTripCostPct: GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.stressRoundTripCostPct,
  });
  if (!Number.isFinite(baseReturnPct) || !Number.isFinite(stressReturnPct)) return null;
  return {
    chain: outcome.chain,
    tokenAddress: outcome.tokenAddress,
    createdAt: outcome.sourceDiscoveryObservedAt,
    grossReturnPct: outcome.grossReturnPct,
    baseReturnPct,
    stressReturnPct,
  };
}

async function collectGeckoMultiPools(pairAddresses, fetcher) {
  const uniquePairs = [...new Set(pairAddresses)].slice(
    0,
    GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.sourceMaximumRows,
  );
  if (!uniquePairs.length) {
    return { rowsByPair: new Map(), failures: [], requestsAttempted: 0 };
  }
  try {
    const response = await fetcher(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/multi/${uniquePairs.map(encodeURIComponent).join(",")}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) {
      throw new Error(`GeckoTerminal multi-pool returned HTTP ${response.status}.`);
    }
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return {
      rowsByPair: new Map(rows.map((row) => {
        const address = text(row?.attributes?.address)
          ?? (text(row?.id)?.startsWith("solana_")
            ? text(row.id).slice("solana_".length) : null);
        return [address, row];
      }).filter(([address]) => address)),
      failures: [],
      requestsAttempted: 1,
    };
  } catch (error) {
    return {
      rowsByPair: new Map(),
      failures: [error instanceof Error ? error.message : String(error)],
      requestsAttempted: 1,
    };
  }
}

function matchesRegistration(event, evidenceBoundary = null) {
  if (event?.type !== "monitoring-policy-registration"
    || event.status !== "frozen"
    || event.rule?.version !== GECKOTERMINAL_NEW_POOL_DELAYED_SHADOW_RULE.version) {
    return false;
  }
  if (evidenceBoundary && event.rule.evidenceBoundary !== evidenceBoundary.toISOString()) {
    return false;
  }
  try {
    const expected = createGeckoTerminalNewPoolDelayedShadowRegistrationEvent({
      registeredAt: event.registeredAt,
      evidenceBoundary: event.rule.evidenceBoundary,
    });
    return event.id === expected.id
      && canonical(event.rule) === canonical(expected.rule)
      && event.researchOnly === true
      && event.mutationAllowed === false
      && event.decisionAuthority === false
      && event.promotionAuthority === false
      && event.tradingAuthority === false;
  } catch {
    return false;
  }
}

async function verifiedLedger(ledgerPath) {
  const events = await readLedger(ledgerPath);
  const verification = verifyLedger(events);
  if (!verification.ok) {
    throw new Error(`Ledger verification failed: ${verification.errors.join("; ")}`);
  }
  return events;
}

function registrationResult(ledgerPath, status, registration) {
  return {
    status,
    ledgerPath,
    registrationId: registration.id,
    registeredAt: registration.registeredAt,
    evidenceBoundary: registration.rule.evidenceBoundary,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

function resolutionResult(
  ledgerPath,
  horizon,
  observedAt,
  dueCandidates,
  requestsAttempted,
  outcomes,
  failures,
) {
  return {
    ledgerPath,
    horizon,
    observedAt: observedAt.toISOString(),
    dueCandidates,
    requestsAttempted,
    recordedOutcomes: outcomes.length,
    observedOutcomes: outcomes.filter((event) => event.status === "observed").length,
    missedOutcomes: outcomes.filter((event) => event.status === "missed").length,
    outcomes,
    failures,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    tradingAuthority: false,
  };
}

function validHorizon(value) {
  if (!Object.hasOwn(HORIZONS, value)) {
    throw new Error(`Expected delayed shadow horizon to be one of: ${Object.keys(HORIZONS).join(", ")}.`);
  }
  return value;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Expected a valid timestamp.");
  return date;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function roundRatio(numerator, denominator) {
  return denominator > 0 ? nullableRound(numerator / denominator) : null;
}

function largestWinningShare(values) {
  const winners = values.filter((value) => value > 0);
  const total = winners.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...winners) / total : null;
}

function nullableRound(value) {
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonical(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseArgs(argv) {
  const [action, ...rest] = argv.slice(2);
  const options = { action };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--ledger") options.ledgerPath = rest[++index];
    else if (rest[index] === "--horizon") options.horizon = rest[++index];
    else if (rest[index] === "--evidence-boundary") options.evidenceBoundary = rest[++index];
    else throw new Error(`Unknown argument: ${rest[index]}`);
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    let result;
    if (options.action === "register") {
      result = await registerGeckoTerminalNewPoolDelayedShadow(options);
    } else if (options.action === "resolve") {
      result = await resolveGeckoTerminalNewPoolDelayedShadows(options);
    } else if (options.action === "score") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      result = buildGeckoTerminalNewPoolDelayedShadowScorecard(
        await verifiedLedger(ledgerPath),
      );
    } else {
      throw new Error("Expected action: register, resolve, or score.");
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
