#!/usr/bin/env node

/**
 * Reconciles the public frozen ledger linked by arXiv:2607.06166 against
 * Kalshi's public archived market outcomes.
 *
 * This is an evidence audit, not a trading executor. It never authenticates,
 * imports credentials, places orders, or modifies a venue account.
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_LEDGER_URL = "https://prophets-profit.onrender.com/paper-trades.json";
const KALSHI_API = "https://external-api.kalshi.com/trade-api/v2";

function stringArgument(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseProperBettingAuditArguments(args) {
  return {
    ledgerUrl: stringArgument(args, "--ledger-url", DEFAULT_LEDGER_URL),
    outputPath: stringArgument(args, "--output", undefined),
  };
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, places = 6) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function groupTrades(trades) {
  const groups = new Map();
  for (const trade of trades) {
    const ticker = String(trade?.ticker ?? "").trim();
    if (!ticker) continue;
    const rows = groups.get(ticker) ?? [];
    rows.push(trade);
    groups.set(ticker, rows);
  }
  return groups;
}

function reconstructCashAndPositions(trades) {
  let cashUsd = 0;
  let yesShares = 0;
  let noShares = 0;
  for (const trade of trades) {
    const isBuy = String(trade.action).toUpperCase() === "BUY";
    const shares = finiteNumber(trade.shares);
    const costUsd = finiteNumber(trade.cost);
    const feeUsd = finiteNumber(trade.fee);
    cashUsd += (isBuy ? -costUsd : costUsd) - feeUsd;
    const positionShares = (isBuy ? 1 : -1) * shares;
    if (String(trade.side).toUpperCase() === "YES") yesShares += positionShares;
    if (String(trade.side).toUpperCase() === "NO") noShares += positionShares;
  }
  return { cashUsd, yesShares, noShares };
}

function settlementPnl(reconstruction, outcome) {
  if (outcome === "yes") return reconstruction.cashUsd + reconstruction.yesShares;
  if (outcome === "no") return reconstruction.cashUsd + reconstruction.noShares;
  return null;
}

function sum(rows, selector) {
  return rows.reduce((total, row) => total + finiteNumber(selector(row)), 0);
}

export function auditProperBettingLedger(payload, outcomeByTicker = new Map()) {
  const trades = Array.isArray(payload?.trades) ? payload.trades : [];
  const groups = groupTrades(trades);
  const markets = [];
  for (const [ticker, rows] of groups) {
    const last = rows.at(-1) ?? {};
    const reconstruction = reconstructCashAndPositions(rows);
    const reportedPosition = String(last.market_position ?? "");
    const reportedPnlUsd = finiteNumber(last.market_pnl);
    const archivedOutcome = outcomeByTicker.get(ticker) ?? null;
    const isFrozenOpenPosition = reportedPosition.toLowerCase().startsWith("open");
    const archivedSettlementPnl = settlementPnl(reconstruction, archivedOutcome);
    const finalPnlUsd = isFrozenOpenPosition && archivedSettlementPnl != null
      ? archivedSettlementPnl
      : reportedPnlUsd;
    markets.push({
      ticker,
      title: String(last.title ?? ""),
      trades: rows.length,
      reportedPosition,
      reportedPnlUsd: round(reportedPnlUsd),
      archivedOutcome,
      finalPnlUsd: round(finalPnlUsd),
      frozenMarkToFinalDeltaUsd: round(finalPnlUsd - reportedPnlUsd),
      ...Object.fromEntries(Object.entries(reconstruction).map(([key, value]) => [key, round(value)])),
    });
  }

  const ranked = [...markets].sort((left, right) => right.finalPnlUsd - left.finalPnlUsd);
  const reportedPnlUsd = sum(markets, (market) => market.reportedPnlUsd);
  const finalPnlUsd = sum(markets, (market) => market.finalPnlUsd);
  const startingCapitalUsd = finiteNumber(payload?.summary?.starting_capital);
  const topPnl = (count) => sum(ranked.slice(0, count), (market) => market.finalPnlUsd);
  const withoutTopPnl = (count) => sum(ranked.slice(count), (market) => market.finalPnlUsd);
  const frozenOpenMarkets = markets.filter((market) => market.reportedPosition.toLowerCase().startsWith("open"));
  const archivedOpenOutcomes = frozenOpenMarkets.filter((market) => market.archivedOutcome != null);
  const claimedForecasterBrier = finiteNumber(payload?.summary?.forecaster_brier);
  const claimedMarketBrier = finiteNumber(payload?.summary?.market_brier);

  return {
    type: "prediction-proper-betting-ledger-audit",
    auditedAt: new Date().toISOString(),
    sourceClaim: {
      agent: payload?.summary?.agent ?? null,
      venue: payload?.summary?.venue ?? null,
      startingCapitalUsd,
      reportedEndingNavUsd: finiteNumber(payload?.summary?.ending_nav),
      reportedPnlUsd: finiteNumber(payload?.summary?.net_pnl),
      reportedRoi: finiteNumber(payload?.summary?.roi_pct) / 100,
      reportedSharpe: finiteNumber(payload?.summary?.sharpe_daily),
      reportedMaxDrawdown: finiteNumber(payload?.summary?.max_drawdown_pct) / 100,
      reportedForecasterBrier: claimedForecasterBrier,
      reportedMarketBrier: claimedMarketBrier,
    },
    reconciliation: {
      tradeRows: trades.length,
      uniqueMarkets: markets.length,
      frozenOpenMarkets: frozenOpenMarkets.length,
      archivedOpenOutcomes: archivedOpenOutcomes.length,
      reportedPnlFromUniqueMarketsUsd: round(reportedPnlUsd),
      finalPnlAfterArchivedOpenSettlementsUsd: round(finalPnlUsd),
      finalEndingCapitalUsd: round(startingCapitalUsd + finalPnlUsd),
      finalRoi: startingCapitalUsd > 0 ? round(finalPnlUsd / startingCapitalUsd) : null,
      positiveMarkets: markets.filter((market) => market.finalPnlUsd > 0).length,
      negativeMarkets: markets.filter((market) => market.finalPnlUsd < 0).length,
    },
    concentration: {
      topMarketPnlUsd: round(topPnl(1)),
      topTwoPnlUsd: round(topPnl(2)),
      topThreePnlUsd: round(topPnl(3)),
      topFivePnlUsd: round(topPnl(5)),
      topThreeShareOfPnl: finalPnlUsd !== 0 ? round(topPnl(3) / finalPnlUsd) : null,
      pnlWithoutTopMarketUsd: round(withoutTopPnl(1)),
      pnlWithoutTopTwoUsd: round(withoutTopPnl(2)),
      pnlWithoutTopThreeUsd: round(withoutTopPnl(3)),
      pnlWithoutTopFiveUsd: round(withoutTopPnl(5)),
    },
    warnings: [
      "This is one non-randomized deployment, not an independent prospective replication.",
      "The strategy takes directional forecast risk; it is not arbitrage and cannot guarantee per-trade or constant profit.",
      claimedForecasterBrier > claimedMarketBrier
        ? "The frozen summary reports a worse aggregate forecaster Brier score than the market Brier score despite positive PnL."
        : null,
      topPnl(3) > finalPnlUsd
        ? "The top three markets contributed more than total PnL; the remainder of the ledger lost money."
        : null,
      archivedOpenOutcomes.length !== frozenOpenMarkets.length
        ? "Not every position marked open in the frozen ledger could be reconciled to a public archived outcome."
        : null,
    ].filter(Boolean),
    topMarkets: ranked.slice(0, 10),
    bottomMarkets: ranked.slice(-10),
  };
}

async function fetchArchivedOutcome(ticker, fetcher) {
  const urls = [
    `${KALSHI_API}/markets/${encodeURIComponent(ticker)}`,
    `${KALSHI_API}/historical/markets/${encodeURIComponent(ticker)}`,
  ];
  for (const url of urls) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetcher(url);
      if (response.ok) {
        const payload = await response.json();
        const result = String(payload?.market?.result ?? "").toLowerCase();
        if (result === "yes" || result === "no") return result;
        break;
      }
      if (response.status === 404) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return null;
}

async function persist(outputPath, value) {
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(value)}\n`, "utf8");
}

export async function runProperBettingLedgerAudit(options, fetcher = fetch) {
  const response = await fetcher(options.ledgerUrl);
  if (!response.ok) throw new Error(`Ledger request failed with HTTP ${response.status}.`);
  const payload = await response.json();
  const groups = groupTrades(Array.isArray(payload?.trades) ? payload.trades : []);
  const frozenOpenTickers = [...groups]
    .filter(([, rows]) => String(rows.at(-1)?.market_position ?? "").toLowerCase().startsWith("open"))
    .map(([ticker]) => ticker);
  const outcomeByTicker = new Map();
  for (const ticker of frozenOpenTickers) {
    const outcome = await fetchArchivedOutcome(ticker, fetcher);
    if (outcome) outcomeByTicker.set(ticker, outcome);
  }
  const audit = auditProperBettingLedger(payload, outcomeByTicker);
  await persist(options.outputPath, audit);
  process.stdout.write(`${JSON.stringify(audit)}\n`);
  return audit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProperBettingLedgerAudit(parseProperBettingAuditArguments(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
