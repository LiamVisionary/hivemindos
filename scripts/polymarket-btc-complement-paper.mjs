#!/usr/bin/env node

/**
 * Paper-only BTC Up/Down complement scanner.
 *
 * Uses public Gamma discovery plus paired CLOB batch books. It never imports a
 * wallet, creates credentials, signs a payload, or submits an order.
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fetchCurrentBtcComplementArbitrageQuotes } from "../src/lib/services/trading/prediction-markets.ts";

function numberArgument(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value)) throw new Error(`${name} requires a number.`);
  return value;
}

function stringArgument(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}

export function parsePaperScannerArguments(args) {
  const durationSeconds = numberArgument(args, "--duration-seconds", 60);
  const sampleMs = numberArgument(args, "--sample-ms", 1_000);
  const bankrollUsd = numberArgument(args, "--bankroll-usd", 100);
  const outputPath = stringArgument(args, "--output");
  const quiet = args.includes("--quiet");
  if (durationSeconds < 1 || durationSeconds > 86_400) {
    throw new Error("--duration-seconds must be between 1 and 86400.");
  }
  if (sampleMs < 250 || sampleMs > 60_000) {
    throw new Error("--sample-ms must be between 250 and 60000.");
  }
  if (bankrollUsd < 1 || bankrollUsd > 100_000) {
    throw new Error("--bankroll-usd must be between 1 and 100000.");
  }
  return { durationSeconds, sampleMs, bankrollUsd, outputPath, quiet };
}

function finite(values) {
  return values.filter((value) => Number.isFinite(value));
}

export function summarizePaperScanner(records, startingBankrollUsd, endingBankrollUsd, trades) {
  const quotes = records.flatMap((record) => record.quotes ?? []);
  const rawEdges = finite(quotes.map((quote) => quote.rawEdgePerShare));
  const netEdges = finite(quotes.map((quote) => quote.netEdgePerShare));
  const combinedAsks = finite(quotes.map((quote) => quote.bestCombinedAsk));
  const snapshotSkews = finite(quotes.map((quote) => quote.snapshotSkewMs));
  return {
    type: "summary",
    startedAt: records[0]?.observedAt ?? null,
    completedAt: new Date().toISOString(),
    samples: records.length,
    quoteObservations: quotes.length,
    uniqueMarkets: new Set(quotes.map((quote) => quote.marketId)).size,
    rawGapObservations: rawEdges.filter((edge) => edge > 0).length,
    postFeeOpportunityObservations: netEdges.filter((edge) => edge > 0).length,
    paperTrades: trades.length,
    startingBankrollUsd,
    endingBankrollUsd,
    paperPnlUsd: endingBankrollUsd - startingBankrollUsd,
    minimumCombinedAsk: combinedAsks.length ? Math.min(...combinedAsks) : null,
    maximumRawEdgePerShare: rawEdges.length ? Math.max(...rawEdges) : null,
    maximumNetEdgePerShare: netEdges.length ? Math.max(...netEdges) : null,
    maximumSnapshotSkewMs: snapshotSkews.length ? Math.max(...snapshotSkews) : null,
    errors: records.filter((record) => record.error).length,
    claimLimit: "Public book observations and modeled paper fills do not prove fillability or future profitability.",
  };
}

async function persistLine(outputPath, value) {
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(value)}\n`, "utf8");
}

export async function runPaperScanner(options) {
  const startedAtMs = Date.now();
  const deadlineMs = startedAtMs + options.durationSeconds * 1_000;
  const records = [];
  const trades = [];
  const filledMarketIds = new Set();
  let paperCashUsd = options.bankrollUsd;
  while (Date.now() < deadlineMs) {
    const observedAt = new Date().toISOString();
    try {
      const quotes = await fetchCurrentBtcComplementArbitrageQuotes({
        bankrollUsd: paperCashUsd,
        maxDepthFraction: 0.25,
      });
      for (const quote of quotes) {
        if (quote.paperFill && !filledMarketIds.has(quote.marketId)) {
          filledMarketIds.add(quote.marketId);
          paperCashUsd += quote.paperFill.pnlUsd;
          trades.push({
            marketId: quote.marketId,
            slug: quote.slug,
            observedAt,
            ...quote.paperFill,
          });
        }
      }
      const record = { type: "observation", observedAt, quotes };
      records.push(record);
      await persistLine(options.outputPath, record);
      if (!options.quiet) process.stdout.write(`${JSON.stringify(record)}\n`);
    } catch (error) {
      const record = {
        type: "observation",
        observedAt,
        quotes: [],
        error: error instanceof Error ? error.message : String(error),
      };
      records.push(record);
      await persistLine(options.outputPath, record);
      process.stderr.write(`${JSON.stringify(record)}\n`);
    }
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(options.sampleMs, remainingMs)));
  }
  const summary = summarizePaperScanner(records, options.bankrollUsd, paperCashUsd, trades);
  await persistLine(options.outputPath, summary);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return { records, trades, summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPaperScanner(parsePaperScannerArguments(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
