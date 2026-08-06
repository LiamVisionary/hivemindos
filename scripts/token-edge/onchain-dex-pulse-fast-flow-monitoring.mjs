#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendLedgerEvent, digestValue, readLedger, verifyLedger } from "./onchain-forward-core.mjs";
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

export const DEX_PULSE_FAST_FLOW_RULE = Object.freeze({
  version: "dex-surface-pulse-five-minute-flow-monitoring-panel-v1",
  evidenceBoundary: "2026-08-03T14:40:15.000Z",
  sourcePulseRuleVersion: DEX_SURFACE_PULSE_RULE.version,
  screens: Object.freeze([
    Object.freeze({ id: "five-minute-buy-pressure", minimumBuySellTxnRatioInclusive: 1 }),
    Object.freeze({ id: "five-minute-positive-momentum", minimumPriceChangeM5PctExclusive: 0 }),
    Object.freeze({ id: "five-minute-active-turnover", minimumFiveMinuteTurnoverInclusive: 0.05 }),
    Object.freeze({
      id: "five-minute-flow-consensus",
      minimumBuySellTxnRatioInclusive: 1,
      minimumPriceChangeM5PctExclusive: 0,
      minimumFiveMinuteTurnoverInclusive: 0.05,
    }),
    Object.freeze({
      id: "five-minute-flow-accelerating-versus-hour",
      requireBuySellRatioAtLeastHourly: true,
      minimumPriceChangeM5PctExclusive: 0,
    }),
  ]),
  derivationStatus: "posthoc-fast-collapse-hypotheses-only",
  researchOnly: true,
  mutationAllowed: false,
});

export function createDexPulseFastFlowRegistrationEvent(registeredAt = new Date()) {
  const registeredAtIso = validIso(registeredAt);
  const spec = { rule: DEX_PULSE_FAST_FLOW_RULE, researchOnly: true, mutationAllowed: false };
  return {
    type: "monitoring-policy-registration",
    id: `monitoring_policy_registration_${digestValue(spec).slice(0, 24)}`,
    registeredAt: registeredAtIso,
    status: "frozen",
    ...spec,
  };
}

export async function registerDexPulseFastFlow(options = {}, dependencies = {}) {
  const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
  const events = await verifiedLedger(ledgerPath);
  const proposed = createDexPulseFastFlowRegistrationEvent(dependencies.now ?? new Date());
  if (!(Date.parse(proposed.registeredAt) > Date.parse(DEX_PULSE_FAST_FLOW_RULE.evidenceBoundary))) {
    throw new Error("DEX pulse fast-flow registration must be strictly after its evidence boundary.");
  }
  const existing = events.find((event) => event.id === proposed.id);
  if (existing && !matchesRegistration(existing)) throw new Error("Existing fast-flow registration mismatch.");
  const signed = existing ?? await appendLedgerEvent(ledgerPath, proposed);
  return {
    ledgerPath,
    status: existing ? "existing" : "registered",
    registrationId: signed.id,
    registeredAt: signed.registeredAt,
    ruleVersion: signed.rule.version,
  };
}

export function buildDexPulseFastFlowScorecard(events) {
  const registration = events.find(matchesRegistration) ?? null;
  const pulse = validatedDexSurfacePulseObservationRows(events);
  const rejectionCounts = {};
  const rows = [];
  for (const row of pulse.rows) {
    if (!(Date.parse(row.createdAt) > Date.parse(registration?.registeredAt ?? ""))) continue;
    const reason = fastFlowRejectionReason(row);
    if (reason) {
      rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + 1;
      continue;
    }
    rows.push({
      ...row,
      fiveMinuteBuySellTxnRatio: row.forecast.metrics.fiveMinuteBuySellTxnRatio,
      fiveMinuteTurnover: row.forecast.metrics.fiveMinuteTurnover,
      priceChangeM5Pct: row.forecast.metrics.priceChangeM5Pct,
      hourlyBuySellTxnRatio: row.forecast.metrics.buySellTxnRatio,
    });
  }
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
    type: "dex-surface-pulse-five-minute-flow-monitoring-scorecard",
    ruleVersion: DEX_PULSE_FAST_FLOW_RULE.version,
    evidenceBoundary: DEX_PULSE_FAST_FLOW_RULE.evidenceBoundary,
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
    screens: DEX_PULSE_FAST_FLOW_RULE.screens.map((screen) => ({
      id: screen.id,
      ...summarizeFrames(frames, (row) => passesFastFlowScreen(row, screen)),
    })),
    note: "Five-minute flow fields are captured before strictly future pulse forecasts and tested as paper-cash screens against the unchanged all-long parent. The round 5% turnover bound is unoptimized. This multiple-testing panel cannot promote, mutate, or trade.",
  };
}

export function passesFastFlowScreen(row, screen) {
  return (!Object.hasOwn(screen, "minimumBuySellTxnRatioInclusive")
      || row.fiveMinuteBuySellTxnRatio >= screen.minimumBuySellTxnRatioInclusive)
    && (!Object.hasOwn(screen, "minimumPriceChangeM5PctExclusive")
      || row.priceChangeM5Pct > screen.minimumPriceChangeM5PctExclusive)
    && (!Object.hasOwn(screen, "minimumFiveMinuteTurnoverInclusive")
      || row.fiveMinuteTurnover >= screen.minimumFiveMinuteTurnoverInclusive)
    && (!screen.requireBuySellRatioAtLeastHourly
      || row.fiveMinuteBuySellTxnRatio >= row.hourlyBuySellTxnRatio);
}

function fastFlowRejectionReason(row) {
  const metrics = row.forecast.metrics ?? {};
  const fields = [
    metrics.fiveMinuteBuySellTxnRatio,
    metrics.fiveMinuteTurnover,
    metrics.priceChangeM5Pct,
    metrics.buysM5,
    metrics.sellsM5,
    metrics.volumeM5Usd,
    metrics.buySellTxnRatio,
  ];
  if (!fields.every(Number.isFinite) || metrics.sellsM5 <= 0 || row.forecast.entryLiquidityUsd <= 0) {
    return "missing-or-invalid-five-minute-flow";
  }
  if (metrics.fiveMinuteBuySellTxnRatio !== roundRatio(metrics.buysM5, metrics.sellsM5)
    || metrics.fiveMinuteTurnover !== roundRatio(
      metrics.volumeM5Usd,
      row.forecast.entryLiquidityUsd,
    )) return "inconsistent-five-minute-flow";
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

function matchesRegistration(event) {
  if (event?.type !== "monitoring-policy-registration" || event.status !== "frozen") return false;
  const expected = createDexPulseFastFlowRegistrationEvent(event.registeredAt);
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

function roundRatio(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? Math.round((numerator / denominator) * 1_000_000) / 1_000_000 : null;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function pairedMean(left, right) {
  return mean(left.map((value, index) => Number.isFinite(value) && Number.isFinite(right[index])
    ? value - right[index] : null));
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
    maximum = Math.max(maximum, ((peak - equity) / peak) * 100);
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
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!["register", "score"].includes(options.command)) {
    throw new Error("Usage: onchain-dex-pulse-fast-flow-monitoring.mjs register|score [--ledger PATH]");
  }
  return options;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.command === "register") {
      console.log(JSON.stringify(await registerDexPulseFastFlow(options), null, 2));
    } else {
      const ledgerPath = path.resolve(options.ledgerPath ?? defaultTokenEdgeLedgerPath());
      const events = await verifiedLedger(ledgerPath);
      console.log(JSON.stringify({
        ledgerPath,
        verification: verifyLedger(events),
        scorecard: buildDexPulseFastFlowScorecard(events),
      }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
