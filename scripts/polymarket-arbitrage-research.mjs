#!/usr/bin/env node

/**
 * Bounded public-data scanner for the prediction-arbitrage strategy matrix.
 *
 * It reads Gamma and CLOB snapshots, writes optional append-only JSONL evidence,
 * and never imports a wallet, signs a payload, or submits an order.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const research = await import("../src/lib/services/trading/prediction-arbitrage-research.ts");

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

export function parseArbitrageResearchArguments(args) {
  const eventLimit = Math.floor(numberArgument(args, "--event-limit", 50));
  const bankrollUsd = numberArgument(args, "--bankroll-usd", 100);
  const durationSeconds = numberArgument(args, "--duration-seconds", 1);
  const sampleMs = numberArgument(args, "--sample-ms", 30_000);
  const outputPath = stringArgument(args, "--output");
  const quiet = args.includes("--quiet");
  if (eventLimit < 1 || eventLimit > 50) throw new Error("--event-limit must be between 1 and 50.");
  if (bankrollUsd < 1 || bankrollUsd > 100_000) throw new Error("--bankroll-usd must be between 1 and 100000.");
  if (durationSeconds < 1 || durationSeconds > 86_400) {
    throw new Error("--duration-seconds must be between 1 and 86400.");
  }
  if (sampleMs < 5_000 || sampleMs > 300_000) {
    throw new Error("--sample-ms must be between 5000 and 300000.");
  }
  return { eventLimit, bankrollUsd, durationSeconds, sampleMs, outputPath, quiet };
}

function quoteSummary(quote, strategy = quote.strategy) {
  return {
    strategy,
    classification: quote.classification ?? "locked-after-complete-fills",
    eventId: quote.eventId,
    eventTitle: quote.eventTitle,
    marketId: quote.marketId,
    title: quote.title,
    decision: quote.decision,
    rawEdgePerShare: quote.rawEdgePerShare,
    takerFeePerShare: quote.takerFeePerShare,
    netEdgePerShare: quote.netEdgePerShare,
    reason: quote.reason,
    legs: quote.legs,
    paperFill: quote.paperFill,
  };
}

function topQuotes(quotes, strategy, limit = 12) {
  return [...quotes]
    .sort((left, right) => (
      (right.netEdgePerShare ?? Number.NEGATIVE_INFINITY)
      - (left.netEdgePerShare ?? Number.NEGATIVE_INFINITY)
    ))
    .slice(0, limit)
    .map((quote) => quoteSummary(quote, strategy));
}

export function compactArbitrageResearchScan(scan) {
  return {
    type: "observation",
    observedAt: scan.observedAt,
    summary: research.summarizePredictionArbitrageUniverse(scan),
    top: {
      binaryCompleteSetBuy: topQuotes(scan.binaryCompleteSetBuys, "binary-complete-set-buy"),
      binaryCompleteSetSell: topQuotes(scan.binaryCompleteSetSells),
      negativeRiskBuyAll: topQuotes(scan.negativeRiskBuyAll),
      negativeRiskConversion: topQuotes(scan.negativeRiskConversions),
      logicalRelations: topQuotes(scan.logicalRelations),
      makerCandidates: scan.makerCandidates.slice(0, 12),
    },
    bookErrors: scan.bookErrors.slice(0, 20),
  };
}

function aggregateObservations(observations, startedAt) {
  const summaries = observations.map((observation) => observation.summary).filter(Boolean);
  const numberSum = (field) => summaries.reduce((sum, summary) => sum + (Number(summary[field]) || 0), 0);
  const maximumNetEdgePerShare = summaries.reduce((maximum, summary) => {
    const value = Number(summary.maximumNetEdgePerShare);
    return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
  }, Number.NEGATIVE_INFINITY);
  return {
    type: "run-summary",
    startedAt,
    completedAt: new Date().toISOString(),
    observations: observations.length,
    errors: observations.filter((observation) => observation.error).length,
    marketObservations: numberSum("marketCount"),
    lockedFillObservations: numberSum("lockedFills"),
    executionRiskFillObservations: numberSum("executionRiskFills"),
    logicalCriteriaReviewFillObservations: numberSum("logicalCriteriaReviewFills"),
    rewardEligibleMakerCandidateObservations: numberSum("rewardEligibleMakerCandidates"),
    maximumNetEdgePerShare: Number.isFinite(maximumNetEdgePerShare) ? maximumNetEdgePerShare : null,
    claimLimit: "A public paper scan cannot establish constant profits, fill priority, criteria equivalence, or future returns.",
  };
}

async function persistLine(outputPath, value) {
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(value)}\n`, "utf8");
}

export async function runArbitrageResearchScanner(options) {
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + options.durationSeconds * 1_000;
  const observations = [];
  while (Date.now() < deadline || observations.length === 0) {
    try {
      const scan = await research.scanPredictionArbitrageUniverse({
        eventLimit: options.eventLimit,
        bankrollUsd: options.bankrollUsd,
        maxDepthFraction: 0.25,
      });
      const observation = compactArbitrageResearchScan(scan);
      observations.push(observation);
      await persistLine(options.outputPath, observation);
      if (!options.quiet) process.stdout.write(`${JSON.stringify(observation)}\n`);
    } catch (error) {
      const observation = {
        type: "observation",
        observedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
      observations.push(observation);
      await persistLine(options.outputPath, observation);
      process.stderr.write(`${JSON.stringify(observation)}\n`);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(options.sampleMs, remaining)));
  }
  const summary = aggregateObservations(observations, startedAt);
  await persistLine(options.outputPath, summary);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return { observations, summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runArbitrageResearchScanner(parseArbitrageResearchArguments(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
