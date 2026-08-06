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
  GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
  GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE,
  createGeckoTerminalNewPoolBirthEntryRegistrationEvent,
  createGeckoTerminalNewPoolBirthMarketCapFloorRemovedRegistrationEvent,
  validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows,
} from "./onchain-geckoterminal-new-pool-activation.mjs";
import {
  independentAssetFrames,
  overlappingAssetSignalCount,
  tokenEdgeAssetKey,
} from "./onchain-independent-frames.mjs";
import {
  GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE,
  collectGeckoPoolDexDirectProvider,
  findGeckoPriceAgnosticCollapseScoringRegistration,
  geckoDexDirectExitAssessment,
  priceAgnosticCollapseEligibility,
} from "./onchain-geckoterminal-trending-monitoring.mjs";
import { defaultTokenEdgeLedgerPath } from "./onchain-forward-research.mjs";

const MINUTE_MS = 60_000;

export const GECKOTERMINAL_NEW_POOL_FAST_PATH_RULE = Object.freeze({
  version: "geckoterminal-low-cap-newborn-one-minute-path-observation-v1",
  evidenceBoundary: "2026-08-04T11:31:30.000Z",
  sourceRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  changedDimension: "observation-only-exact-path-cadence-from-five-minutes-to-one-minute",
  cadenceMinutes: 1,
  maximumForecastsPerMinute: 2,
  selectionOrder: "earliest-created-at-then-forecast-id",
  purpose: "Measure whether a separately frozen future stop policy could observe rapid loss before the five-minute path without inferring, interpolating, or changing a forecast.",
  derivationStatus: "posthoc-five-minute-stop-overshoot-future-only-observation",
  derivation: Object.freeze({
    inspectedSymbols: Object.freeze(["PEPHEAD", "Hthcity", "WEN"]),
    excludedTokenAddresses: Object.freeze([
      "J5NVZjRdPBNWQi4aLz6jyouxyznc7nZpJVBhJCiHpump",
      "Df5kCMVJW5owmvZ4eF8sPpxGBqvPfuiKkZDNoJ5jpump",
      "H4ShhuzMpEJJZxr4pV7Cvk22HVvPnuTw8ekRqsgHjM5u",
    ]),
    warning: "The five-minute monitor first saw PEPHEAD at -44.8% and WEN at +25.9% immediately before collapse. Those tokens and all inspected paths are excluded. One-minute data are observation-only until a later separately frozen exit rule is justified.",
  }),
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE = Object.freeze({
  version: "geckoterminal-low-cap-newborn-cross-provider-disagreement-panel-v11",
  evidenceBoundary: "2026-08-04T14:28:20.000Z",
  sourceRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE.version,
  sourcePathRuleVersion: GECKOTERMINAL_NEW_POOL_FAST_PATH_RULE.version,
  changedDimension: "observation-only-preserve-scheduled-exact-provider-ratios-even-when-nonexecutable",
  maximumCrossProviderPriceRatioInclusive:
    GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE
      .maximumCrossProviderPriceRatioInclusive,
  maximumCrossProviderLiquidityRatioInclusive:
    GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE
      .maximumCrossProviderLiquidityRatioInclusive,
  maximumForecastsPerObservation: GECKOTERMINAL_NEW_POOL_FAST_PATH_RULE
    .maximumForecastsPerMinute,
  decisionAuthority: false,
  promotionAuthority: false,
  derivationStatus: "future-only-diagnostic-after-repeated-kio-post-entry-price-disagreement",
  derivation: Object.freeze({
    excludedTokenAddresses: Object.freeze([
      "3K1jZjfygWHVFvmHYWG7HzsGXQaciAFGZfRyuuSEuhvE",
      "8JyH3tSV9yAkJ5B39GEHG5YX2NgzTWWPnQbgXhigV1H5",
      "Evs9SHsTJqQZrds138dQ4o8G8erhpxtAzyZS8R6UGws4",
      "J5NVZjRdPBNWQi4aLz6jyouxyznc7nZpJVBhJCiHpump",
      "Df5kCMVJW5owmvZ4eF8sPpxGBqvPfuiKkZDNoJ5jpump",
      "H4ShhuzMpEJJZxr4pV7Cvk22HVvPnuTw8ekRqsgHjM5u",
      "4FzRL2GUrUEvx1CzSDTXFmPkpnG2V9V1aU7oLQUzAVgi",
      "EFSybXm4R8PSUwULtPXDNgGNiNz2fTzuydjndNg1Y8uV",
      "F2HHYsSrQ3wR389JxcLqk9yvTW8JBEizZrDUVq8Q9D6j",
      "Bt4faxPNLM1J8AWr736ddymEVYJsuLSFeec77MFU8Ha5",
    ]),
    warning: "KIO produced repeated scheduled post-entry exact-provider price disagreements. KIO, every earlier low-cap parent, and every existing path or failure are excluded. This panel records later ratios from the already budgeted request only and selects no trading filter.",
  }),
  researchOnly: true,
  mutationAllowed: false,
});

export const GECKOTERMINAL_NEW_POOL_STANDARD_MID_PATH_RULE = Object.freeze({
  version: "geckoterminal-standard-cap-newborn-mid-bucket-path-observation-v2",
  evidenceBoundary: "2026-08-04T12:50:10.000Z",
  sourceRuleVersion: GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE.version,
  changedDimension: "observation-only-add-three-minute-offset-between-five-minute-standard-path-marks",
  cadenceMinutes: 5,
  requiredUtcMinuteModuloFive: 3,
  maximumForecastsPerObservation: 2,
  selectionOrder: "earliest-created-at-then-forecast-id",
  purpose: "Measure whether one exact mid-bucket quote can reduce standard-cap stop overshoot while sharing the existing rolling provider budget.",
  derivationStatus: "posthoc-standard-five-minute-stop-overshoot-future-only-observation",
  derivation: Object.freeze({
    inspectedSymbols: Object.freeze(["Google", "TikTok", "BAKI", "WFI"]),
    excludedTokenAddresses: Object.freeze([
      "F1mAAHApto5uNM9KRQLWbzSgeEzm21uwL7rDgnKQGhHb",
      "9gra4e8c1kWvPeEWjfPoCY3TE1Tkaq9JBwUzX9hv4oUE",
      "FAc8FytXdmxoscfSKU14DLD8sapQmNw8qeX9SsYubLuw",
      "F1cEbdrNT3GDfwhViRVmA4ABkQw8StoSjawLtVXGrkAP",
    ]),
    warning: "WFI first became observable at -49.446089% on the five-minute path, while BAKI and TikTok reached +10% before collapse. All four inspected standard-cap forecasts are excluded. Mid-bucket points are observations, not fills or reconstructed exits.",
  }),
  researchOnly: true,
  mutationAllowed: false,
});

export function createGeckoTerminalNewPoolFastPathRegistrationEvent(
  registeredAt = new Date(),
) {
  const spec = {
    rule: GECKOTERMINAL_NEW_POOL_FAST_PATH_RULE,
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

export function createGeckoTerminalNewPoolFastPathDisagreementRegistrationEvent(
  registeredAt = new Date(),
) {
  const spec = {
    rule: GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE,
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

export function createGeckoTerminalNewPoolStandardMidPathRegistrationEvent(
  registeredAt = new Date(),
) {
  const spec = {
    rule: GECKOTERMINAL_NEW_POOL_STANDARD_MID_PATH_RULE,
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

export async function registerGeckoTerminalNewPoolFastPath(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesLowCapParentRegistration)) {
    throw new Error("Register the frozen low-cap newborn parent first.");
  }
  const proposed = createGeckoTerminalNewPoolFastPathRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_FAST_PATH_RULE.evidenceBoundary))) {
    throw new Error("Newborn one-minute path registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFastPathRegistration(existing)) {
    throw new Error(`Existing newborn one-minute path registration mismatch: ${proposed.id}`);
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

export async function registerGeckoTerminalNewPoolFastPathDisagreement(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesFastPathRegistration)) {
    throw new Error("Register the frozen low-cap one-minute path first.");
  }
  const proposed = createGeckoTerminalNewPoolFastPathDisagreementRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE.evidenceBoundary))) {
    throw new Error("Newborn provider-disagreement registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesFastPathDisagreementRegistration(existing)) {
    throw new Error(`Existing newborn provider-disagreement registration mismatch: ${proposed.id}`);
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

export async function registerGeckoTerminalNewPoolStandardMidPath(
  options = {},
  dependencies = {},
) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  if (!events.some(matchesStandardParentRegistration)) {
    throw new Error("Register the frozen standard-cap newborn parent first.");
  }
  const proposed = createGeckoTerminalNewPoolStandardMidPathRegistrationEvent(
    dependencies.now ?? new Date(),
  );
  if (!(Date.parse(proposed.registeredAt)
    > Date.parse(GECKOTERMINAL_NEW_POOL_STANDARD_MID_PATH_RULE.evidenceBoundary))) {
    throw new Error("Standard newborn mid-bucket path registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesStandardMidPathRegistration(existing)) {
    throw new Error(`Existing standard newborn mid-bucket registration mismatch: ${proposed.id}`);
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

export async function markOpenGeckoTerminalNewPoolFastPaths(
  options = {},
  dependencies = {},
) {
  const pathRule = dependencies.pathRule ?? GECKOTERMINAL_NEW_POOL_FAST_PATH_RULE;
  const registrationMatcher = dependencies.registrationMatcher ?? matchesFastPathRegistration;
  const assessmentRule = dependencies.assessmentRule
    ?? GECKOTERMINAL_NEW_POOL_BIRTH_MARKET_CAP_FLOOR_REMOVED_RULE;
  const observationMode = dependencies.observationMode
    ?? "live-point-in-time-one-minute-path";
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? new Date();
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const bucketStartedAt = new Date(
    Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS,
  ).toISOString();
  const lockPath = path.join(
    path.dirname(ledgerPath),
    `.gecko-new-pool-fast-path-${digestValue(pathRule.version).slice(0, 8)}-${bucketStartedAt.replaceAll(/[^0-9]/g, "")}.lock`,
  );
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      return markResult(ledgerPath, now, bucketStartedAt, 0, 0, [], []);
    }
    throw error;
  }
  try {
    const events = await verifiedLedger(ledgerPath);
    const registration = events.find(registrationMatcher) ?? null;
    if (!registration) throw new Error(`Register ${pathRule.version} first.`);
    if (!(now.getTime() > Date.parse(registration.registeredAt))) {
      return markResult(ledgerPath, now, bucketStartedAt, 0, 0, [], []);
    }
    if (Number.isInteger(pathRule.requiredUtcMinuteModuloFive)
      && now.getUTCMinutes() % 5 !== pathRule.requiredUtcMinuteModuloFive) {
      return markResult(ledgerPath, now, bucketStartedAt, 0, 0, [], []);
    }
    const collapseRegistration = findGeckoPriceAgnosticCollapseScoringRegistration(events);
    const disagreementRegistration = events.find(
      matchesFastPathDisagreementRegistration,
    ) ?? null;
    const resolvedIds = new Set(events
      .filter((event) => event.type === "geckoterminal-new-pool-resolution")
      .map((event) => event.forecastId));
    const markedIds = new Set(events.filter((event) => (
      (event.type === "geckoterminal-new-pool-fast-path"
        && event.fastPathRegistrationId === registration.id
        && event.bucketStartedAt === bucketStartedAt)
      || (event.type === "geckoterminal-new-pool-provider-diagnostic"
        && event.sourcePathRegistrationId === registration.id
        && event.bucketStartedAt === bucketStartedAt)
    )).map((event) => event.forecastId));
    const terminalIds = new Set(events.filter((event) => (
      event.type === "geckoterminal-new-pool-fast-path"
        && event.fastPathRegistrationId === registration.id
        && event.status === "liquidity-collapse"
    )).map((event) => event.forecastId));
    const open = events.filter((event) => (
      event.type === "geckoterminal-new-pool-forecast"
        && event.ruleVersion === pathRule.sourceRuleVersion
        && Date.parse(event.createdAt) > Date.parse(registration.registeredAt)
        && Date.parse(event.createdAt) > Date.parse(
          pathRule.evidenceBoundary,
        )
        && !pathRule.derivation.excludedTokenAddresses
          .includes(event.tokenAddress)
        && Date.parse(event.createdAt) <= now.getTime()
        && Date.parse(event.dueAt) > now.getTime()
        && !resolvedIds.has(event.id)
        && !markedIds.has(event.id)
        && !terminalIds.has(event.id)
    )).sort((left, right) => (
      Date.parse(left.createdAt) - Date.parse(right.createdAt)
        || left.id.localeCompare(right.id)
    )).slice(0, pathRule.maximumForecastsPerMinute
      ?? pathRule.maximumForecastsPerObservation);
    if (!open.length) return markResult(ledgerPath, now, bucketStartedAt, 0, 0, [], []);
    const provider = await collectGeckoPoolDexDirectProvider(open, fetcher);
    const failures = [...provider.failures];
    const observations = [];
    const diagnostics = [];
    for (const forecast of open) {
      const assessment = geckoDexDirectExitAssessment(
        forecast,
        provider,
        assessmentRule,
        {
          allowPriceDisagreementOnCollapse: priceAgnosticCollapseEligibility(
            forecast,
            collapseRegistration,
          ),
        },
      );
      const diagnostic = providerDiagnostic(forecast, provider);
      if (diagnostic
        && disagreementRegistration
        && Date.parse(forecast.createdAt) > Date.parse(disagreementRegistration.registeredAt)
        && Date.parse(forecast.createdAt)
          > Date.parse(GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE.evidenceBoundary)
        && !GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE.derivation
          .excludedTokenAddresses.includes(forecast.tokenAddress)) {
        const event = {
          type: "geckoterminal-new-pool-provider-diagnostic",
          id: `geckoterminal_new_pool_provider_diagnostic_${digestValue({
            forecastId: forecast.id,
            registrationId: disagreementRegistration.id,
            bucketStartedAt,
          }).slice(0, 24)}`,
          ruleVersion: GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE.version,
          registrationId: disagreementRegistration.id,
          registeredAt: disagreementRegistration.registeredAt,
          sourcePathRuleVersion: pathRule.version,
          sourcePathRegistrationId: registration.id,
          forecastId: forecast.id,
          discoveryEventId: forecast.discoveryEventId,
          chain: forecast.chain,
          tokenAddress: forecast.tokenAddress,
          symbol: forecast.symbol,
          pairAddress: forecast.pairAddress,
          signalCreatedAt: forecast.createdAt,
          dueAt: forecast.dueAt,
          bucketStartedAt,
          observedAt: now.toISOString(),
          ...diagnostic,
          decisionAuthority: false,
          promotionAuthority: false,
          researchOnly: true,
          mutationAllowed: false,
        };
        diagnostics.push(await appendLedgerEvent(ledgerPath, event));
      }
      if (assessment.reason || !["quoted", "liquidity-collapse"].includes(assessment.status)) {
        failures.push(`Newborn ${pathRule.version} path unavailable ${forecast.tokenAddress}: ${assessment.reason ?? assessment.status}`);
        continue;
      }
      const observedPriceUsd = positiveNumber(assessment.pair?.priceUsd);
      const observedLiquidityUsd = nonnegativeNumber(assessment.pair?.liquidity?.usd);
      if (!(observedPriceUsd > 0) || !Number.isFinite(observedLiquidityUsd)) continue;
      const collapsed = assessment.status === "liquidity-collapse";
      const event = {
        type: "geckoterminal-new-pool-fast-path",
        id: `geckoterminal_new_pool_fast_path_${digestValue({
          forecastId: forecast.id,
          fastPathRegistrationId: registration.id,
          bucketStartedAt,
        }).slice(0, 24)}`,
        fastPathRuleVersion: pathRule.version,
        fastPathRegistrationId: registration.id,
        fastPathRegisteredAt: registration.registeredAt,
        sourceRuleVersion: forecast.ruleVersion,
        sourceRegistrationId: forecast.registrationId,
        forecastId: forecast.id,
        discoveryEventId: forecast.discoveryEventId,
        chain: forecast.chain,
        tokenAddress: forecast.tokenAddress,
        symbol: forecast.symbol,
        pairAddress: forecast.pairAddress,
        signalCreatedAt: forecast.createdAt,
        dueAt: forecast.dueAt,
        bucketStartedAt,
        observedAt: now.toISOString(),
        status: collapsed ? "liquidity-collapse" : "observed",
        entryPriceUsd: forecast.entryPriceUsd,
        entryLiquidityUsd: forecast.entryLiquidityUsd,
        observedPriceUsd,
        observedLiquidityUsd,
        grossReturnFromEntryPct: collapsed
          ? GECKOTERMINAL_LIQUIDITY_COLLAPSE_SCORING_RULE.collapsedOutcomeGrossReturnPct
          : round6(((observedPriceUsd / forecast.entryPriceUsd) - 1) * 100),
        providerPriceIntegrity: assessment.integrity,
        priceAgnosticCollapseRegistrationId:
          assessment.integrity?.ruleVersion
            === "geckoterminal-dex-direct-zero-liquidity-collapse-v2"
            ? collapseRegistration.id : null,
        observationMode,
        researchOnly: true,
        mutationAllowed: false,
      };
      observations.push(await appendLedgerEvent(ledgerPath, event));
    }
    return markResult(
      ledgerPath,
      now,
      bucketStartedAt,
      open.length,
      provider.requestsAttempted,
      observations,
      failures,
      diagnostics,
    );
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export async function markOpenGeckoTerminalNewPoolStandardMidPaths(
  options = {},
  dependencies = {},
) {
  return markOpenGeckoTerminalNewPoolFastPaths(options, {
    ...dependencies,
    pathRule: GECKOTERMINAL_NEW_POOL_STANDARD_MID_PATH_RULE,
    registrationMatcher: matchesStandardMidPathRegistration,
    assessmentRule: GECKOTERMINAL_NEW_POOL_BIRTH_ENTRY_RULE,
    observationMode: "live-point-in-time-standard-mid-bucket-path",
  });
}

export function buildGeckoTerminalNewPoolFastPathDisagreementScorecard(events) {
  const rule = GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE;
  const registration = events.find(matchesFastPathDisagreementRegistration) ?? null;
  const sourcePathRegistration = events.find(matchesFastPathRegistration) ?? null;
  const parent = validatedGeckoTerminalNewPoolBirthMarketCapFloorRemovedRows(events);
  const futureForecasts = events.filter((event) => (
    event.type === "geckoterminal-new-pool-forecast"
      && event.ruleVersion === rule.sourceRuleVersion
      && registration
      && Date.parse(event.createdAt) > Date.parse(registration.registeredAt)
      && Date.parse(event.createdAt) > Date.parse(rule.evidenceBoundary)
      && !rule.derivation.excludedTokenAddresses.includes(event.tokenAddress)
  ));
  const forecastsById = new Map(futureForecasts.map((forecast) => [forecast.id, forecast]));
  const rejectionCounts = {};
  const validDiagnostics = [];
  for (const diagnostic of events.filter((event) => (
    event.type === "geckoterminal-new-pool-provider-diagnostic"
      && event.registrationId === registration?.id
  ))) {
    const forecast = forecastsById.get(diagnostic.forecastId);
    const reason = providerDiagnosticRejectionReason({
      diagnostic,
      forecast,
      registration,
      sourcePathRegistration,
    });
    if (reason) {
      increment(rejectionCounts, reason);
      continue;
    }
    validDiagnostics.push(diagnostic);
  }
  const firstDiagnosticByForecast = new Map();
  for (const diagnostic of validDiagnostics.sort((left, right) => (
    Date.parse(left.observedAt) - Date.parse(right.observedAt)
      || left.id.localeCompare(right.id)
  ))) {
    if (!firstDiagnosticByForecast.has(diagnostic.forecastId)) {
      firstDiagnosticByForecast.set(diagnostic.forecastId, diagnostic);
    }
  }
  const rows = parent.rows.filter((row) => forecastsById.has(row.forecastId))
    .filter((row) => firstDiagnosticByForecast.has(row.forecastId))
    .map((row) => ({
      ...row,
      firstDiagnostic: firstDiagnosticByForecast.get(row.forecastId),
    }));
  const frames = independentAssetFrames(rows, {
    durationMs: 60 * 60_000,
    timestamp: (row) => Date.parse(row.createdAt),
    assetKey: tokenEdgeAssetKey,
  });
  const weightedRows = frames.flat();
  const featureSlices = [];
  const fixedBuckets = [
    ["status", "consensus", (row) => row.firstDiagnostic.status === "consensus"],
    ["status", "price-disagreement", (row) => (
      row.firstDiagnostic.status === "price-disagreement"
    )],
    ["status", "liquidity-disagreement", (row) => (
      row.firstDiagnostic.status === "liquidity-disagreement"
    )],
    ["priceRatio", "01.00-01.10", (row) => row.firstDiagnostic.priceRatio <= 1.10],
    ["priceRatio", "01.10-01.25", (row) => (
      row.firstDiagnostic.priceRatio > 1.10 && row.firstDiagnostic.priceRatio <= 1.25
    )],
    ["priceRatio", "01.25-02.00", (row) => (
      row.firstDiagnostic.priceRatio > 1.25 && row.firstDiagnostic.priceRatio <= 2
    )],
    ["priceRatio", "02.00-plus", (row) => row.firstDiagnostic.priceRatio > 2],
  ];
  for (const [field, bucket, predicate] of fixedBuckets) {
    const selected = weightedRows.filter(predicate);
    if (selected.length) featureSlices.push(providerDiagnosticSlice(field, bucket, selected));
  }
  return {
    type: "geckoterminal-new-pool-fast-path-disagreement-scorecard",
    ruleVersion: rule.version,
    evidenceBoundary: rule.evidenceBoundary,
    registrationId: registration?.id ?? null,
    registeredAt: registration?.registeredAt ?? null,
    sourceRuleVersion: rule.sourceRuleVersion,
    sourcePathRuleVersion: rule.sourcePathRuleVersion,
    changedDimension: rule.changedDimension,
    researchOnly: true,
    mutationAllowed: false,
    decisionAuthority: false,
    promotionAuthority: false,
    futureParentForecasts: futureForecasts.length,
    diagnosticForecasts: firstDiagnosticByForecast.size,
    recordedDiagnostics: validDiagnostics.length,
    openForecasts: futureForecasts.filter((forecast) => (
      !events.some((event) => (
        event.type === "geckoterminal-new-pool-resolution"
          && event.forecastId === forecast.id
      ))
    )).length,
    eligibleLiveObservations: weightedRows.length,
    portfolioWeightedObservations: weightedRows.length,
    sameAssetOverlappingObservations: overlappingAssetSignalCount(rows, frames),
    independentHourlyFrames: frames.length,
    uniqueTokens: new Set(weightedRows.map(tokenEdgeAssetKey)).size,
    overall: providerDiagnosticSlice("all", "all", weightedRows),
    featureSlices,
    rejectionCounts,
    evidenceStatus: "descriptive-only",
    provisionalGate: false,
    note: "This future-only panel preserves numeric exact-provider price and liquidity ratios from the already budgeted one-minute newborn request, including nonexecutable disagreement. It selects no threshold or direction and grants no promotion or trading authority. KIO and every earlier observation are excluded.",
  };
}

export function providerDiagnosticRejectionReason({
  diagnostic,
  forecast,
  registration,
  sourcePathRegistration,
}) {
  const rule = GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE;
  if (!registration || !sourcePathRegistration || !forecast) return "missing-lineage";
  if (diagnostic.ruleVersion !== rule.version
    || diagnostic.registeredAt !== registration.registeredAt
    || diagnostic.sourcePathRuleVersion !== rule.sourcePathRuleVersion
    || diagnostic.sourcePathRegistrationId !== sourcePathRegistration.id
    || diagnostic.discoveryEventId !== forecast.discoveryEventId
    || diagnostic.chain !== forecast.chain
    || diagnostic.tokenAddress !== forecast.tokenAddress
    || diagnostic.pairAddress !== forecast.pairAddress
    || diagnostic.signalCreatedAt !== forecast.createdAt
    || diagnostic.dueAt !== forecast.dueAt
    || diagnostic.decisionAuthority !== false
    || diagnostic.promotionAuthority !== false
    || diagnostic.researchOnly !== true
    || diagnostic.mutationAllowed !== false) return "diagnostic-lineage-mismatch";
  const observedAt = Date.parse(diagnostic.observedAt);
  const bucketStartedAt = Date.parse(diagnostic.bucketStartedAt);
  if (!(observedAt >= bucketStartedAt && observedAt < bucketStartedAt + 60_000
    && observedAt > Date.parse(forecast.createdAt)
    && observedAt < Date.parse(forecast.dueAt))) return "diagnostic-time-mismatch";
  const canonicalDiagnostic = providerDiagnosticFromValues(diagnostic);
  if (!canonicalDiagnostic
    || canonical(canonicalDiagnostic) !== canonical({
      status: diagnostic.status,
      geckoPriceUsd: diagnostic.geckoPriceUsd,
      directPriceUsd: diagnostic.directPriceUsd,
      priceRatio: diagnostic.priceRatio,
      geckoLiquidityUsd: diagnostic.geckoLiquidityUsd,
      directLiquidityUsd: diagnostic.directLiquidityUsd,
      liquidityRatio: diagnostic.liquidityRatio,
      maximumCrossProviderPriceRatioInclusive:
        diagnostic.maximumCrossProviderPriceRatioInclusive,
      maximumCrossProviderLiquidityRatioInclusive:
        diagnostic.maximumCrossProviderLiquidityRatioInclusive,
    })) return "diagnostic-value-mismatch";
  return null;
}

function providerDiagnosticFromValues(value) {
  const geckoPriceUsd = positiveNumber(value?.geckoPriceUsd);
  const directPriceUsd = positiveNumber(value?.directPriceUsd);
  const geckoLiquidityUsd = nonnegativeNumber(value?.geckoLiquidityUsd);
  const directLiquidityUsd = nonnegativeNumber(value?.directLiquidityUsd);
  if (![geckoPriceUsd, directPriceUsd, geckoLiquidityUsd, directLiquidityUsd]
    .every(Number.isFinite)) return null;
  return providerDiagnosticFromNumbers({
    geckoPriceUsd,
    directPriceUsd,
    geckoLiquidityUsd,
    directLiquidityUsd,
  });
}

function providerDiagnosticSlice(field, bucket, rows) {
  return {
    field,
    bucket,
    observations: rows.length,
    riseRate: roundRatio(rows.filter((row) => row.grossReturnPct > 0).length, rows.length),
    netWinRate: roundRatio(
      rows.filter((row) => row.baseCapacityReturnPct > 0).length,
      rows.length,
    ),
    averageGrossReturnPct: nullableRound(mean(rows.map((row) => row.grossReturnPct))),
    averageBaseCapacityReturnPct: nullableRound(mean(
      rows.map((row) => row.baseCapacityReturnPct),
    )),
    averageStressCapacityReturnPct: nullableRound(mean(
      rows.map((row) => row.stressCapacityReturnPct),
    )),
    explosion25Count: rows.filter((row) => row.grossReturnPct >= 25).length,
    explosion50Count: rows.filter((row) => row.grossReturnPct >= 50).length,
    explosion100Count: rows.filter((row) => row.grossReturnPct >= 100).length,
    liquidityCollapseCount: rows.filter((row) => (
      row.resolution.status === "liquidity-collapse"
    )).length,
  };
}

function matchesLowCapParentRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthMarketCapFloorRemovedRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesStandardParentRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolBirthEntryRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesFastPathRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolFastPathRegistrationEvent(event.registeredAt);
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesFastPathDisagreementRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") {
    return false;
  }
  const expected = createGeckoTerminalNewPoolFastPathDisagreementRegistrationEvent(
    event.registeredAt,
  );
  return event.id === expected.id
    && canonical(event.rule) === canonical(expected.rule)
    && event.researchOnly === true
    && event.mutationAllowed === false;
}

function matchesStandardMidPathRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createGeckoTerminalNewPoolStandardMidPathRegistrationEvent(
    event.registeredAt,
  );
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

function markResult(
  ledgerPath,
  observedAt,
  bucketStartedAt,
  pendingForecasts,
  requestsAttempted,
  observations,
  failures,
  diagnostics = [],
) {
  return {
    ledgerPath,
    observedAt: observedAt.toISOString(),
    bucketStartedAt,
    pendingForecasts,
    requestsAttempted,
    recordedObservations: observations.length,
    recordedDiagnostics: diagnostics.length,
    liquidityCollapses: observations.filter((event) => (
      event.status === "liquidity-collapse"
    )).length,
    failures,
    observations: observations.map((event) => ({
      id: event.id,
      forecastId: event.forecastId,
      tokenAddress: event.tokenAddress,
      symbol: event.symbol,
      status: event.status,
      grossReturnFromEntryPct: event.grossReturnFromEntryPct,
      observedLiquidityUsd: event.observedLiquidityUsd,
    })),
    diagnostics: diagnostics.map((event) => ({
      id: event.id,
      forecastId: event.forecastId,
      tokenAddress: event.tokenAddress,
      status: event.status,
      priceRatio: event.priceRatio,
      liquidityRatio: event.liquidityRatio,
    })),
  };
}

function providerDiagnostic(forecast, provider) {
  const gecko = provider.geckoCandidatesByPair?.get(forecast.pairAddress);
  const direct = (provider.directPairsByToken.get(forecast.tokenAddress) ?? []).find(
    (row) => row?.pairAddress === forecast.pairAddress,
  );
  const geckoPriceUsd = positiveNumber(gecko?.priceUsd);
  const directPriceUsd = positiveNumber(direct?.priceUsd);
  const geckoLiquidityUsd = nonnegativeNumber(gecko?.liquidityUsd);
  const directLiquidityUsd = nonnegativeNumber(direct?.liquidity?.usd);
  if (![geckoPriceUsd, directPriceUsd, geckoLiquidityUsd, directLiquidityUsd]
    .every(Number.isFinite)) return null;
  return providerDiagnosticFromNumbers({
    geckoPriceUsd,
    directPriceUsd,
    geckoLiquidityUsd,
    directLiquidityUsd,
  });
}

function providerDiagnosticFromNumbers({
  geckoPriceUsd,
  directPriceUsd,
  geckoLiquidityUsd,
  directLiquidityUsd,
}) {
  const priceRatio = Math.max(geckoPriceUsd, directPriceUsd)
    / Math.min(geckoPriceUsd, directPriceUsd);
  const minimumLiquidityUsd = Math.min(geckoLiquidityUsd, directLiquidityUsd);
  const maximumLiquidityUsd = Math.max(geckoLiquidityUsd, directLiquidityUsd);
  const liquidityRatio = maximumLiquidityUsd === 0 ? 1
    : (minimumLiquidityUsd === 0 ? null : maximumLiquidityUsd / minimumLiquidityUsd);
  const rule = GECKOTERMINAL_NEW_POOL_FAST_PATH_DISAGREEMENT_RULE;
  const liquidityDisagreement = liquidityRatio === null
    || liquidityRatio > rule.maximumCrossProviderLiquidityRatioInclusive;
  return {
    status: priceRatio > rule.maximumCrossProviderPriceRatioInclusive
      ? "price-disagreement"
      : (liquidityDisagreement
        ? "liquidity-disagreement" : "consensus"),
    geckoPriceUsd,
    directPriceUsd,
    priceRatio: round6(priceRatio),
    geckoLiquidityUsd,
    directLiquidityUsd,
    liquidityRatio: liquidityRatio === null ? null : round6(liquidityRatio),
    maximumCrossProviderPriceRatioInclusive:
      rule.maximumCrossProviderPriceRatioInclusive,
    maximumCrossProviderLiquidityRatioInclusive:
      rule.maximumCrossProviderLiquidityRatioInclusive,
  };
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length
    ? finite.reduce((sum, value) => sum + value, 0) / finite.length
    : null;
}

function roundRatio(numerator, denominator) {
  return denominator > 0 ? round6(numerator / denominator) : null;
}

function nullableRound(value) {
  return Number.isFinite(value) ? round6(value) : null;
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
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
  const options = { command: argv[2] ?? "mark" };
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--ledger") options.ledgerPath = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "mark", "register-standard-mid", "mark-standard-mid",
    "register-disagreement", "score-disagreement"]
    .includes(options.command)) {
    throw new Error("Usage: onchain-geckoterminal-new-pool-fast-path.mjs register|mark|register-standard-mid|mark-standard-mid|register-disagreement|score-disagreement [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolFastPath(options), null, 2,
      ));
    } else if (options.command === "register-standard-mid") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolStandardMidPath(options), null, 2,
      ));
    } else if (options.command === "register-disagreement") {
      console.log(JSON.stringify(
        await registerGeckoTerminalNewPoolFastPathDisagreement(options), null, 2,
      ));
    } else if (options.command === "mark-standard-mid") {
      console.log(JSON.stringify(
        await markOpenGeckoTerminalNewPoolStandardMidPaths(options), null, 2,
      ));
    } else if (options.command === "score-disagreement") {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: buildGeckoTerminalNewPoolFastPathDisagreementScorecard(events),
      }, null, 2));
    } else {
      console.log(JSON.stringify(
        await markOpenGeckoTerminalNewPoolFastPaths(options), null, 2,
      ));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
