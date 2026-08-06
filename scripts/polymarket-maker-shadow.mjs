#!/usr/bin/env node

/**
 * Conservative public-data shadow for passive Polymarket quoting.
 *
 * It selects reward-eligible books, assumes every displayed share at the
 * selected price is ahead in queue, and only counts a full paper fill after
 * observed trade volume at-or-through the quote clears that queue plus the
 * hypothetical order. It never signs or submits an order.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const research = await import("../src/lib/services/trading/prediction-arbitrage-research.ts");
const markets = await import("../src/lib/services/trading/prediction-markets.ts");
const MARKET_SOCKET = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

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

export function parseMakerShadowArguments(args) {
  const eventLimit = Math.floor(numberArgument(args, "--event-limit", 50));
  const bankrollUsd = numberArgument(args, "--bankroll-usd", 100);
  const durationSeconds = numberArgument(args, "--duration-seconds", 180);
  const candidateLimit = Math.floor(numberArgument(args, "--candidate-limit", 5));
  const minimumHoursToResolution = numberArgument(args, "--minimum-hours-to-resolution", 12);
  const outputPath = stringArgument(args, "--output");
  if (eventLimit < 1 || eventLimit > 50) throw new Error("--event-limit must be between 1 and 50.");
  if (bankrollUsd < 1 || bankrollUsd > 100_000) throw new Error("--bankroll-usd must be between 1 and 100000.");
  if (durationSeconds < 10 || durationSeconds > 86_400) {
    throw new Error("--duration-seconds must be between 10 and 86400.");
  }
  if (candidateLimit < 1 || candidateLimit > 25) throw new Error("--candidate-limit must be between 1 and 25.");
  if (minimumHoursToResolution < 1 || minimumHoursToResolution > 8_760) {
    throw new Error("--minimum-hours-to-resolution must be between 1 and 8760.");
  }
  return { eventLimit, bankrollUsd, durationSeconds, candidateLimit, minimumHoursToResolution, outputPath };
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function makerState(candidate) {
  const quoteShares = candidate.rewardsMinSize;
  return {
    candidate,
    quoteShares,
    requiredCapitalUsd: quoteShares * (1 + candidate.bestBid),
    bidQueueAheadShares: candidate.bestBidSize,
    askQueueAheadShares: candidate.bestAskSize,
    bidEligibleTradeShares: 0,
    askEligibleTradeShares: 0,
    bidPaperFilled: false,
    askPaperFilled: false,
    tradeEvents: 0,
    finalOutcomeBid: candidate.bestBid,
    finalComplementBid: candidate.complementBestBid,
  };
}

export function applyMakerShadowTrade(state, trade) {
  const price = finite(trade.price);
  const size = finite(trade.size);
  const side = String(trade.side ?? "").toUpperCase();
  if (price == null || size == null || size <= 0) return state;
  const next = { ...state, tradeEvents: state.tradeEvents + 1 };
  if (side === "SELL" && price <= state.candidate.bestBid) {
    next.bidEligibleTradeShares += size;
    next.bidPaperFilled = next.bidEligibleTradeShares + 1e-9
      >= next.bidQueueAheadShares + next.quoteShares;
  }
  if (side === "BUY" && price >= state.candidate.bestAsk) {
    next.askEligibleTradeShares += size;
    next.askPaperFilled = next.askEligibleTradeShares + 1e-9
      >= next.askQueueAheadShares + next.quoteShares;
  }
  return next;
}

export function evaluateMakerShadowState(state) {
  const shares = state.quoteShares;
  let markedPnlUsd = 0;
  let fillState = "none";
  if (state.bidPaperFilled && state.askPaperFilled) {
    fillState = "both";
    markedPnlUsd = shares * (state.candidate.bestAsk - state.candidate.bestBid);
  } else if (state.bidPaperFilled) {
    fillState = "bid-only";
    markedPnlUsd = shares * (
      finite(state.finalOutcomeBid) - state.candidate.bestBid
    );
  } else if (state.askPaperFilled) {
    fillState = "ask-only";
    markedPnlUsd = shares * (
      state.candidate.bestAsk + finite(state.finalComplementBid) - 1
    );
  }
  return {
    eventId: state.candidate.eventId,
    marketId: state.candidate.marketId,
    conditionId: state.candidate.conditionId,
    title: state.candidate.title,
    outcome: state.candidate.outcome,
    resolutionDate: state.candidate.resolutionDate,
    quoteShares: shares,
    initialBestBid: state.candidate.bestBid,
    initialBestAsk: state.candidate.bestAsk,
    initialSpreadPerShare: state.candidate.spreadPerShare,
    bidQueueAheadShares: state.bidQueueAheadShares,
    askQueueAheadShares: state.askQueueAheadShares,
    bidEligibleTradeShares: round(state.bidEligibleTradeShares),
    askEligibleTradeShares: round(state.askEligibleTradeShares),
    bidPaperFilled: state.bidPaperFilled,
    askPaperFilled: state.askPaperFilled,
    fillState,
    finalOutcomeBid: state.finalOutcomeBid,
    finalComplementBid: state.finalComplementBid,
    markedPnlUsd: round(markedPnlUsd),
    requiredCapitalUsd: round(state.requiredCapitalUsd),
    tradeEvents: state.tradeEvents,
  };
}

async function finalBook(outcomeId) {
  try {
    return (await markets.fetchPredictionOrderBooks([outcomeId]))[0] ?? null;
  } catch {
    return null;
  }
}

async function persist(outputPath, value) {
  if (!outputPath) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(value)}\n`, "utf8");
}

export async function runMakerShadow(options) {
  const startedAt = new Date();
  const scan = await research.scanPredictionArbitrageUniverse({
    eventLimit: options.eventLimit,
    bankrollUsd: options.bankrollUsd,
  });
  const minimumResolutionMs = startedAt.getTime() + options.minimumHoursToResolution * 3_600_000;
  const candidates = scan.makerCandidates
    .filter((candidate) => (
      candidate.rewardEligible
      && candidate.rewardsMinSize > 0
      && candidate.rewardsMinSize * (1 + candidate.bestBid) <= options.bankrollUsd
      && finite(candidate.complementBestBid) != null
      && Date.parse(candidate.resolutionDate ?? "") >= minimumResolutionMs
    ))
    .slice(0, options.candidateLimit);
  if (!candidates.length) {
    throw new Error("No reward-eligible maker candidate fit the bankroll and resolution-horizon constraints.");
  }

  const states = new Map(candidates.map((candidate) => [candidate.outcomeId, makerState(candidate)]));
  const assetIds = [...new Set(candidates.flatMap((candidate) => [
    candidate.outcomeId,
    candidate.complementOutcomeId,
  ]))];
  let connected = false;
  let socketError = null;
  const socket = new WebSocket(MARKET_SOCKET);
  const completed = new Promise((resolve) => {
    socket.on("open", () => {
      connected = true;
      socket.send(JSON.stringify({
        assets_ids: assetIds,
        type: "market",
        custom_feature_enabled: true,
      }));
    });
    socket.on("message", (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }
      for (const message of Array.isArray(payload) ? payload : [payload]) {
        if (message?.event_type !== "last_trade_price") continue;
        const outcomeId = String(message.asset_id ?? "");
        const state = states.get(outcomeId);
        if (state) states.set(outcomeId, applyMakerShadowTrade(state, message));
      }
    });
    socket.on("error", (error) => {
      socketError = error instanceof Error ? error.message : String(error);
    });
    socket.on("close", resolve);
  });
  const ping = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send("PING");
  }, 10_000);
  await new Promise((resolve) => setTimeout(resolve, options.durationSeconds * 1_000));
  clearInterval(ping);
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  await Promise.race([completed, new Promise((resolve) => setTimeout(resolve, 2_000))]);

  for (const state of states.values()) {
    const [outcomeBook, complementBook] = await Promise.all([
      finalBook(state.candidate.outcomeId),
      finalBook(state.candidate.complementOutcomeId),
    ]);
    state.finalOutcomeBid = outcomeBook?.bids[0]?.price ?? state.finalOutcomeBid;
    state.finalComplementBid = complementBook?.bids[0]?.price ?? state.finalComplementBid;
  }
  const results = [...states.values()].map(evaluateMakerShadowState);
  const output = {
    type: "polymarket-maker-shadow",
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    durationSeconds: options.durationSeconds,
    bankrollUsd: options.bankrollUsd,
    connected,
    socketError,
    candidates: results.length,
    fullBothSidePaperFills: results.filter((result) => result.fillState === "both").length,
    oneSidePaperFills: results.filter((result) => result.fillState === "bid-only" || result.fillState === "ask-only").length,
    markedPnlUsd: round(sumResults(results)),
    results,
    claimLimit: "Queue-clearing is inferred from public trade prints and a conservative initial queue; side semantics, cancellations, hidden priority, rewards, gas, and real order acknowledgement remain unverified.",
  };
  await persist(options.outputPath, output);
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return output;
}

function sumResults(results) {
  return results.reduce((total, result) => total + result.markedPnlUsd, 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMakerShadow(parseMakerShadowArguments(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
