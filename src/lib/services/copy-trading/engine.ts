import "server-only";

/* The copy-trading engine — runtime-agnostic (no Next imports) so the SAME code
   runs inside the Next server process and inside the standalone daemon. To avoid
   double-execution there is exactly ONE execution host at a time: the daemon when
   installed, otherwise nothing (the Next API route never starts the engine, it
   only reads/writes config). The engine owns one poll loop per enabled config:

     detect target swaps → filter → size → governance (inside executeDexSwap) →
     mirror via executeDexSwap (or log, in dry-run) → track positions → TP/SL exit

   Config changes made through the route land in copy-trading.json; a reconcile
   tick re-reads it and starts/stops/refreshes loops, so "start/stop from the UI"
   and "switch acting wallet without stopping a running config" both just work —
   each config carries its own agentId and runs independently. */

import { hostname } from "os";
import { MAX_SWAP_USD, executeDexSwap } from "@/lib/services/trading/dex-swap";
import { getWalletBalance } from "@/lib/services/wallet/chain-wallet";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import type {
  CopyTradeAgentReview,
  CopyTradeAgentAnalysisState,
  CopyTradeEngineStatus,
  CopyTradeEvent,
  CopyTradeEventKind,
  CopyTradeExecutionCost,
  CopyTradeOpenPosition,
  CopyTradePaperLedger,
  CopyTradeRuntimeState,
  CopyTradingConfig,
} from "@/lib/types/copy-trading";
import { COPY_TRADE_EVALUATION_BATCH_SIZE, isCopyTradeNetwork } from "@/lib/types/copy-trading";
import {
  emptyRuntimeState,
  readConfigs,
  readRuntimeStates,
  writeEngineStatus,
  writeRuntimeState,
} from "./store";
import { nativeUsdPrice, tokenLiquidityUsd, tokenMarket, tokenPriceUsd, type TokenMarket } from "./market";
import {
  copyTradeNativeSymbol,
  fundableSummary,
  fundingAssetsFromBalance,
  selectBuyFunding,
  type BuyFunding,
} from "./funding";
import { applyPaperBuy, applyPaperSell, emptyPaperLedger, paperPositionValue } from "./paper";
import {
  completePendingSignal,
  duePendingSignals,
  isPendingSignal,
  queuePendingSignal,
} from "./pending-signals";
import { detectNewSwaps, type CopyTradeSignal } from "./watcher";
import { reviewCopiedTrade } from "./agent-analysis";
import { calibrateAgentDecision } from "./calibration";
import {
  createCounterfactualRecord,
  dueCounterfactualHorizons,
  markMissedCounterfactualHorizons,
  observeCounterfactualHorizon,
} from "./counterfactual";
import { estimateCopyTradeExecutionCost } from "./execution-costs";
import { paperPortfolioValue, startAgentAnalysisState } from "./evolution";
import {
  evaluatePostFillRisk,
  warmCopyTradeIntelligence,
  type CopyTradeIntelligence,
} from "./risk-intelligence";

const RECONCILE_MS = 10_000;
const HEARTBEAT_MS = 15_000;
const SWAP_CONFIRMATION = "CONFIRM_SWAP";
// Dry-run bankroll fallback when the wallet's fundable balance can't be read and
// no explicit paperStartUsd is set — so paper trading still has cash to spend.
const DEFAULT_PAPER_BANKROLL_USD = 1_000;

type Loop = {
  config: CopyTradingConfig;
  state: CopyTradeRuntimeState;
  timer: NodeJS.Timeout | null;
  busy: boolean;
  stop: boolean;
};

type Engine = {
  host: string;
  pid: number;
  startedAt: number;
  loops: Map<string, Loop>;
  reconcileTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
  starting: boolean;
};

type SignalHandlingResult =
  | { status: "complete"; acted?: boolean }
  | { status: "retry"; reason: string };

const COMPLETE_SIGNAL: SignalHandlingResult = { status: "complete" };

function engineSlot(): { engine: Engine | null } {
  const slot = globalThis as typeof globalThis & { __hivemindCopyTradeEngine?: { engine: Engine | null } };
  if (!slot.__hivemindCopyTradeEngine) slot.__hivemindCopyTradeEngine = { engine: null };
  return slot.__hivemindCopyTradeEngine;
}

// ── lifecycle ────────────────────────────────────────────────────────────────
export async function startEngine(opts: { host?: string } = {}): Promise<CopyTradeEngineStatus> {
  const slot = engineSlot();
  if (slot.engine) return engineStatus(slot.engine);

  const engine: Engine = {
    host: opts.host || hostname() || "engine",
    pid: process.pid,
    startedAt: Date.now(),
    loops: new Map(),
    reconcileTimer: null,
    heartbeatTimer: null,
    starting: false,
  };
  slot.engine = engine;

  await reconcile(engine);
  engine.reconcileTimer = setInterval(() => void reconcile(engine).catch(() => {}), RECONCILE_MS);
  engine.heartbeatTimer = setInterval(() => void heartbeat(engine).catch(() => {}), HEARTBEAT_MS);
  if (engine.reconcileTimer.unref) engine.reconcileTimer.unref();
  await heartbeat(engine);
  return engineStatus(engine);
}

export async function stopEngine(): Promise<void> {
  const slot = engineSlot();
  const engine = slot.engine;
  if (!engine) return;
  if (engine.reconcileTimer) clearInterval(engine.reconcileTimer);
  if (engine.heartbeatTimer) clearInterval(engine.heartbeatTimer);
  for (const loop of engine.loops.values()) {
    loop.stop = true;
    if (loop.timer) clearTimeout(loop.timer);
    loop.state.running = false;
    await writeRuntimeState(loop.state).catch(() => {});
  }
  engine.loops.clear();
  slot.engine = null;
  await writeEngineStatus(null).catch(() => {});
}

export function getEngineStatus(): CopyTradeEngineStatus | null {
  const engine = engineSlot().engine;
  return engine ? engineStatus(engine) : null;
}

function engineStatus(engine: Engine): CopyTradeEngineStatus {
  return {
    host: engine.host,
    pid: engine.pid,
    startedAt: engine.startedAt,
    heartbeatMs: Date.now(),
    activeConfigs: [...engine.loops.values()].filter((l) => !l.stop).length,
  };
}

async function heartbeat(engine: Engine): Promise<void> {
  await writeEngineStatus(engineStatus(engine));
}

/** Re-read configs and start/stop/refresh loops to match. */
async function reconcile(engine: Engine): Promise<void> {
  if (engine.starting) return;
  engine.starting = true;
  try {
    const configs = await readConfigs();
    const persisted = await readRuntimeStates();
    const wanted = new Set<string>();

    for (const config of configs) {
      if (!config.enabled || !runnable(config)) continue;
      wanted.add(config.id);
      const existing = engine.loops.get(config.id);
      if (existing) {
        existing.config = config; // pick up edits live
        continue;
      }
      const state = persisted[config.id] ?? seedEvolvedRuntimeState(config, persisted);
      state.running = true;
      const loop: Loop = { config, state, timer: null, busy: false, stop: false };
      engine.loops.set(config.id, loop);
      scheduleLoop(engine, loop, 0);
    }

    // Stop loops whose config was disabled or deleted.
    for (const [id, loop] of engine.loops) {
      if (wanted.has(id)) continue;
      loop.stop = true;
      if (loop.timer) clearTimeout(loop.timer);
      loop.state.running = false;
      await writeRuntimeState(loop.state).catch(() => {});
      engine.loops.delete(id);
    }
  } finally {
    engine.starting = false;
  }
}

function seedEvolvedRuntimeState(
  config: CopyTradingConfig,
  persisted: Record<string, CopyTradeRuntimeState>,
): CopyTradeRuntimeState {
  const state = emptyRuntimeState(config.id);
  const source = config.evolution ? persisted[config.evolution.sourceConfigId] : undefined;
  if (!source) return state;
  // Begin at the original's current cursor so a new twin evaluates future
  // trades instead of replaying an unrelated historical window.
  state.lastBlock = source.lastBlock;
  state.lastSignature = source.lastSignature;
  state.consumedTxRefs = [...source.consumedTxRefs];
  if (config.dryRun && source.paper?.initialized) {
    state.paper = {
      ...source.paper,
      positions: Object.fromEntries(
        Object.entries(source.paper.positions).map(([token, position]) => [token, { ...position }]),
      ),
    };
  }
  return state;
}

function runnable(config: CopyTradingConfig): boolean {
  return Boolean(config.agentId && config.walletAddress && config.targetAddress && isCopyTradeNetwork(config.network));
}

function scheduleLoop(engine: Engine, loop: Loop, delayMs: number) {
  if (loop.stop) return;
  loop.timer = setTimeout(() => void tick(engine, loop), delayMs);
  if (loop.timer.unref) loop.timer.unref();
}

// ── per-config tick ──────────────────────────────────────────────────────────
async function tick(engine: Engine, loop: Loop): Promise<void> {
  if (loop.stop || loop.busy) return;
  loop.busy = true;
  const { config, state } = loop;
  try {
    state.stats.polls += 1;
    state.lastPollAt = Date.now();

    // Seed the simulated bankroll once, before any paper action can spend it.
    if (config.dryRun) await seedPaperIfNeeded(loop);
    if (config.evolution) {
      await ensureAgentAnalysisState(loop);
      await matureEvolvedCounterfactuals(loop);
    }

    for (const pending of duePendingSignals(state, Date.now())) {
      if (loop.stop) break;
      await processSignal(loop, pending);
    }

    const { signals, cursor } = await detectNewSwaps({
      network: config.network,
      targetAddress: config.targetAddress,
      lastBlock: state.lastBlock,
      lastSignature: state.lastSignature,
    });
    state.lastBlock = cursor.lastBlock ?? state.lastBlock;
    state.lastSignature = cursor.lastSignature ?? state.lastSignature;

    for (const signal of signals) {
      if (loop.stop) break;
      if (state.consumedTxRefs.includes(signal.targetTxRef) || isPendingSignal(state, signal.targetTxRef)) continue;
      await processSignal(loop, signal);
    }

    await runExits(loop);
    state.lastError = null;
  } catch (error) {
    state.stats.errors += 1;
    state.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    await writeRuntimeState(state).catch(() => {});
    loop.busy = false;
    scheduleLoop(engine, loop, loop.config.pollIntervalMs);
  }
}

function record(state: CopyTradeRuntimeState, kind: CopyTradeEventKind, detail: string, extra: Partial<CopyTradeEvent> = {}) {
  state.events.push({ at: Date.now(), kind, detail, ...extra });
  if (state.events.length > 50) state.events = state.events.slice(-50);
}

async function processSignal(loop: Loop, signal: CopyTradeSignal): Promise<void> {
  const { state } = loop;
  try {
    const result = await handleSignal(loop, signal);
    if (result.status === "retry") {
      const pending = queuePendingSignal(state, signal, result.reason, Date.now());
      if (pending.attempts <= 3 || pending.attempts % 10 === 0) {
        const retrySeconds = Math.max(1, Math.ceil((pending.nextAttemptAt - pending.lastAttemptAt) / 1_000));
        record(state, "pending", `[paper] waiting for a verified price for ${short(signal.token)} — retry ${pending.attempts} in ${retrySeconds}s.`, {
          token: signal.token,
          dryRun: loop.config.dryRun,
          targetTxRef: signal.targetTxRef,
        });
      }
      return;
    }
    completePendingSignal(state, signal.targetTxRef);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.consumedTxRefs.includes(signal.targetTxRef)) {
      state.stats.errors += 1;
      state.lastError = message;
      record(state, "error", `Post-commit processing failed for ${short(signal.token)}: ${message}`, {
        token: signal.token,
        targetTxRef: signal.targetTxRef,
      });
      return;
    }
    const pending = queuePendingSignal(state, signal, message, Date.now());
    state.stats.errors += 1;
    state.lastError = message;
    record(state, "pending", `Temporary pre-execution failure for ${short(signal.token)} — retry ${pending.attempts} scheduled.`, {
      token: signal.token,
      dryRun: loop.config.dryRun,
      targetTxRef: signal.targetTxRef,
    });
  }
}

async function handleSignal(loop: Loop, signal: CopyTradeSignal): Promise<SignalHandlingResult> {
  const { config, state } = loop;
  // Preserve case — Solana mints are case-sensitive base58 (lowercasing would
  // corrupt the mint and break the swap). EVM addresses are case-insensitive.
  const token = signal.token;

  if (isBlacklisted(config, token)) {
    state.stats.skipped += 1;
    record(state, "skip", `Blacklisted ${short(token)} — skipped ${signal.direction}.`, { token, targetTxRef: signal.targetTxRef });
    return COMPLETE_SIGNAL;
  }

  const sinceLast = Date.now() - lastActionAt(activePositions(loop));
  if (!isPendingSignal(state, signal.targetTxRef) && sinceLast < config.cooldownMs) {
    state.stats.skipped += 1;
    record(state, "skip", `Cooldown active — skipped ${signal.direction} ${short(token)}.`, { token, targetTxRef: signal.targetTxRef });
    return COMPLETE_SIGNAL;
  }

  if (signal.direction === "buy") {
    return handleBuy(loop, signal, token);
  }
  return handleSell(loop, signal, token, "sell");
}

async function handleBuy(loop: Loop, signal: CopyTradeSignal, token: string): Promise<SignalHandlingResult> {
  const { config, state } = loop;
  // Paper positions live in their own ledger so a dry-run walks the SAME gating
  // (max-open, per-token cap, liquidity floor) as a live run.
  const positions = activePositions(loop);
  const existing = positions[token];

  if (!existing && Object.keys(positions).length >= config.maxOpenPositions) {
    state.stats.skipped += 1;
    record(state, "skip", `Max ${config.maxOpenPositions} open positions — skipped buy ${short(token)}.`, { token });
    return COMPLETE_SIGNAL;
  }

  // Size: fixed USD, or a percent of the target's quote-leg USD when known.
  let usd = config.copyMode === "proportional" && signal.quoteUsd != null
    ? (signal.quoteUsd * config.copyPercent) / 100
    : config.fixedUsd;
  usd = clamp(usd, config.minCopyUsd, Math.min(config.maxCopyUsd, MAX_SWAP_USD));

  const spentOnToken = existing?.spentUsd ?? 0;
  const remaining = config.maxPerTokenUsd - spentOnToken;
  if (remaining < config.minCopyUsd) {
    state.stats.skipped += 1;
    record(state, "skip", `Per-token cap ($${config.maxPerTokenUsd}) reached for ${short(token)}.`, { token });
    return COMPLETE_SIGNAL;
  }
  usd = Math.min(usd, remaining);

  if (config.minLiquidityUsd != null) {
    const liq = await tokenLiquidityUsd(config.network, token);
    if (liq != null && liq < config.minLiquidityUsd) {
      state.stats.skipped += 1;
      record(state, "skip", `Liquidity $${Math.round(liq)} < min $${config.minLiquidityUsd} — skipped ${short(token)}.`, { token });
      return COMPLETE_SIGNAL;
    }
  }

  const prepared = config.evolution ? prepareEvolvedBuy(loop, token) : null;

  if (config.dryRun) {
    const attempt = await paperBuy(loop, signal, token, usd, prepared?.market);
    if (attempt.status === "retry") return attempt;
    if (attempt.fill) {
      await commitSignalState(loop, signal.targetTxRef);
      if (prepared) await analyzeEvolvedBuy(loop, signal, attempt.fill, prepared.intelligence);
    }
    return COMPLETE_SIGNAL;
  }

  const signer = await resolveSigner(config);
  // Fund the mirror from whatever the wallet actually holds — stablecoins first,
  // then the chain's native asset (ETH on Base, SOL on Solana).
  const funding = await resolveBuyFunding(config, usd);
  if (!funding) {
    state.stats.skipped += 1;
    record(state, "skip", `No spendable USDC/${copyTradeNativeSymbol(config.network)} balance to fund buy of ${short(token)}.`, { token, targetTxRef: signal.targetTxRef });
    return COMPLETE_SIGNAL;
  }
  await commitSignalState(loop, signal.targetTxRef);
  try {
    const result = await executeDexSwap({
      agentId: config.agentId,
      network: signer.network,
      fromAddress: signer.fromAddress,
      secret: signer.secret,
      sellToken: funding.sellToken,
      buyToken: token,
      amountHuman: funding.amountHuman,
      slippageBps: config.slippageBps,
      confirmation: SWAP_CONFIRMATION,
    });
    const now = Date.now();
    state.openPositions[token] = {
      token,
      symbol: result.buy,
      spentUsd: spentOnToken + result.valueUsd,
      amount: (existing?.amount ?? 0) + result.buyAmount,
      openedAt: existing?.openedAt ?? now,
      lastActionAt: now,
    };
    state.stats.mirrored += 1;
    record(state, "buy", `Bought ~$${result.valueUsd.toFixed(2)} of ${result.buy} with ${funding.sellToken}. Tx ${short(result.reference)}.`, {
      token, symbol: result.buy, usd: result.valueUsd, txRef: result.reference, targetTxRef: signal.targetTxRef,
    });
    if (prepared) {
      const market = await prepared.market;
      const entryPriceUsd = market.priceUsd ?? (result.buyAmount > 0 ? result.valueUsd / result.buyAmount : null);
      if (entryPriceUsd != null && entryPriceUsd > 0) {
        await analyzeEvolvedBuy(loop, signal, {
          token,
          symbol: result.buy,
          spentUsd: result.valueUsd,
          entryPriceUsd,
          market,
          buyCost: executionCostFor(config, result.valueUsd, market.liquidityUsd),
        }, prepared.intelligence);
      }
    }
  } catch (error) {
    recordSwapError(state, error, "buy", token, signal.targetTxRef);
  }
  return COMPLETE_SIGNAL;
}

type SellReason = "sell" | "take-profit" | "stop-loss" | "agent-close";

async function handleSell(loop: Loop, signal: CopyTradeSignal | null, token: string, reason: SellReason): Promise<SignalHandlingResult> {
  const { config, state } = loop;
  if (reason === "sell" && !config.copySells) return COMPLETE_SIGNAL;
  const position = activePositions(loop)[token];
  if (!position || !(position.amount > 0)) {
    if (reason === "sell") {
      state.stats.skipped += 1;
      record(state, "skip", `No copied position in ${short(token)} to sell.`, { token, targetTxRef: signal?.targetTxRef });
    }
    return COMPLETE_SIGNAL;
  }

  if (config.dryRun) {
    const result = await paperSell(loop, signal, token, reason);
    if (result.status === "complete" && result.acted && signal) {
      await commitSignalState(loop, signal.targetTxRef);
    }
    return result;
  }

  const signer = await resolveSigner(config);
  if (signal) await commitSignalState(loop, signal.targetTxRef);
  try {
    const result = await executeDexSwap({
      agentId: config.agentId,
      network: signer.network,
      fromAddress: signer.fromAddress,
      secret: signer.secret,
      sellToken: token,
      buyToken: "USDC",
      amountHuman: round(position.amount, 9),
      slippageBps: config.slippageBps,
      confirmation: SWAP_CONFIRMATION,
    });
    state.stats.mirrored += 1;
    record(state, reason === "sell" ? "sell" : reason, `Sold ${position.symbol} → ~$${result.valueUsd.toFixed(2)} (${reason}). Tx ${short(result.reference)}.`, {
      token, symbol: position.symbol, usd: result.valueUsd, txRef: result.reference, targetTxRef: signal?.targetTxRef,
    });
    delete state.openPositions[token];
    return { status: "complete", acted: true };
  } catch (error) {
    recordSwapError(state, error, "sell", token, signal?.targetTxRef);
    return COMPLETE_SIGNAL;
  }
}

/** Take-profit / stop-loss exits on the amount owned by this config. */
async function runExits(loop: Loop): Promise<void> {
  const { config, state } = loop;
  if (config.dryRun) {
    await runPaperExits(loop);
    return;
  }
  if (config.takeProfitPct == null && config.stopLossPct == null) return;
  const open = Object.values(state.openPositions);
  if (open.length === 0) return;

  for (const position of open) {
    const priceUsd = await tokenPriceUsd(config.network, position.token);
    const valueUsd = priceUsd == null ? null : priceUsd * position.amount;
    if (valueUsd == null || !(position.spentUsd > 0)) continue;
    const pnlPct = ((valueUsd - position.spentUsd) / position.spentUsd) * 100;
    if (config.takeProfitPct != null && pnlPct >= config.takeProfitPct) {
      await handleSell(loop, null, position.token, "take-profit");
    } else if (config.stopLossPct != null && pnlPct <= -config.stopLossPct) {
      await handleSell(loop, null, position.token, "stop-loss");
    }
  }
}

// ── paper trading (dry-run) ───────────────────────────────────────────────────
/* A dry-run config keeps a simulated portfolio (state.paper) and walks the SAME
   detect → size → gate path as a live one, but fills at the current market price
   against simulated cash instead of touching the chain. So a dry-run reports real
   simulated fills, open positions, and P&L — not just "would buy" log lines. */

/** The position map a config acts on: the paper ledger in dry-run, else the live one. */
function activePositions(loop: Loop): Record<string, CopyTradeOpenPosition> {
  return loop.config.dryRun ? ensurePaperLedger(loop.state).positions : loop.state.openPositions;
}

function ensurePaperLedger(state: CopyTradeRuntimeState): CopyTradePaperLedger {
  if (!state.paper?.initialized) state.paper = emptyPaperLedger(DEFAULT_PAPER_BANKROLL_USD);
  return state.paper;
}

/** Seed the simulated bankroll once — a snapshot of the wallet's fundable USD
 *  (so the paper balance mirrors real spendable funds), or an explicit override. */
async function seedPaperIfNeeded(loop: Loop): Promise<void> {
  const { config, state } = loop;
  if (state.paper?.initialized) return;
  let start = config.paperStartUsd;
  if (start == null) {
    try {
      const [balance, nativePrice] = await Promise.all([
        getWalletBalance(config.walletAddress, config.network),
        nativeUsdPrice(config.network).catch(() => null),
      ]);
      start = fundableSummary(config.network, balance, nativePrice).totalUsd;
    } catch {
      start = null; // balance unreadable this tick → fall back to the default bankroll
    }
  }
  if (start == null || !(start > 0)) start = DEFAULT_PAPER_BANKROLL_USD;
  state.paper = emptyPaperLedger(start);
}

async function ensureAgentAnalysisState(loop: Loop): Promise<void> {
  const { config, state } = loop;
  const evolution = config.evolution;
  if (!evolution) return;
  const sourceState = (await readRuntimeStates())[evolution.sourceConfigId];
  if (!state.agentAnalysis) {
    state.agentAnalysis = startAgentAnalysisState({
      sourceConfigId: evolution.sourceConfigId,
      sourceState,
      evolvedState: state,
    });
    return;
  }
  state.agentAnalysis.counterfactuals ??= [];
  state.agentAnalysis.nextSequence ??= nextCounterfactualSequence(state.agentAnalysis.counterfactuals);
  if (state.agentAnalysis.sourceStartPortfolioUsd == null) {
    state.agentAnalysis.sourceStartPortfolioUsd = paperPortfolioValue(sourceState?.paper);
  }
  if (state.agentAnalysis.evolvedStartPortfolioUsd == null) {
    state.agentAnalysis.evolvedStartPortfolioUsd = paperPortfolioValue(state.paper);
  }
}

type EvolvedBuyFill = {
  token: string;
  symbol: string;
  spentUsd: number;
  entryPriceUsd: number;
  market: TokenMarket;
  buyCost: CopyTradeExecutionCost;
};

type PaperBuyAttempt =
  | { status: "complete"; fill: EvolvedBuyFill | null }
  | { status: "retry"; reason: string };

function prepareEvolvedBuy(loop: Loop, token: string): {
  market: Promise<TokenMarket>;
  intelligence: Promise<CopyTradeIntelligence>;
} {
  const counterfactuals = loop.state.agentAnalysis?.counterfactuals ?? [];
  return {
    market: tokenMarket(loop.config.network, token),
    intelligence: warmCopyTradeIntelligence({
      network: loop.config.network,
      token,
      counterfactuals,
    }),
  };
}

async function analyzeEvolvedBuy(
  loop: Loop,
  signal: CopyTradeSignal,
  fill: EvolvedBuyFill,
  intelligencePromise: Promise<CopyTradeIntelligence>,
): Promise<void> {
  const { config, state } = loop;
  const evolution = config.evolution;
  if (!evolution) return;
  await ensureAgentAnalysisState(loop);
  const analysis = state.agentAnalysis;
  if (!analysis) return;
  analysis.counterfactuals ??= [];
  const sequence = analysis.nextSequence ?? nextCounterfactualSequence(analysis.counterfactuals);
  const evaluationBatch = Math.floor(sequence / COPY_TRADE_EVALUATION_BATCH_SIZE);
  const intelligence = await intelligencePromise;
  const riskGate = evaluatePostFillRisk({
    spentUsd: fill.spentUsd,
    market: fill.market,
    security: intelligence.security,
  });
  const thresholdSnapshot = calibrateAgentDecision({
    rawConfidence: 0,
    baseThreshold: evolution.minCloseConfidence,
    riskScore: riskGate.score,
    securityCoverage: intelligence.security.coverage,
    currentBatch: evaluationBatch,
    counterfactuals: analysis.counterfactuals,
  });
  let review: CopyTradeAgentReview;
  if (riskGate.hardClose) {
    review = {
      reviewedAt: Date.now(),
      targetTxRef: signal.targetTxRef,
      token: fill.token,
      symbol: fill.symbol,
      spentUsd: fill.spentUsd,
      model: evolution.model,
      decision: "close",
      confidence: 1,
      rawConfidence: 1,
      calibratedConfidence: 1,
      closeThreshold: 0,
      reviewPath: "risk-close",
      riskScore: riskGate.score,
      riskFlags: [...intelligence.security.hardRiskFlags, ...intelligence.security.cautionFlags],
      policyVersion: evolution.policyVersion,
      evaluationBatch,
      summary: riskGate.reasons.join(" ") || "The deterministic safety gate found an objective sellability risk.",
      risks: riskGate.reasons,
      sources: [],
      researchUsed: false,
      closeExecuted: false,
    };
  } else {
    review = await reviewCopiedTrade({
      config,
      signal,
      token: fill.token,
      symbol: fill.symbol,
      spentUsd: fill.spentUsd,
      market: fill.market,
      intelligence,
      riskGate,
      calibration: thresholdSnapshot,
      recentReviews: analysis.reviews,
    });
    const calibration = calibrateAgentDecision({
      rawConfidence: review.rawConfidence ?? review.confidence,
      baseThreshold: evolution.minCloseConfidence,
      riskScore: riskGate.score,
      securityCoverage: intelligence.security.coverage,
      currentBatch: evaluationBatch,
      counterfactuals: analysis.counterfactuals,
    });
    review.rawConfidence = calibration.rawConfidence;
    review.calibratedConfidence = calibration.calibratedConfidence;
    review.confidence = calibration.calibratedConfidence;
    review.closeThreshold = calibration.closeThreshold;
    review.evaluationBatch = evaluationBatch;
  }

  const closeThreshold = review.closeThreshold ?? evolution.minCloseConfidence;
  const shouldClose = !review.error
    && review.decision === "close"
    && (review.reviewPath === "risk-close" || review.confidence >= closeThreshold);
  if (review.error) {
    record(state, "agent-error", `GPT-5.6 Sol review failed; kept ${fill.symbol}. ${review.error}`, {
      token: fill.token,
      symbol: fill.symbol,
      usd: fill.spentUsd,
      dryRun: config.dryRun,
      targetTxRef: signal.targetTxRef,
    });
  } else if (shouldClose) {
    const reviewer = review.reviewPath === "risk-close" ? "Safety gate" : "GPT-5.6 Sol";
    record(state, "agent-close", `${reviewer} rejected ${fill.symbol} (${fmtPct(review.confidence)}). ${review.summary}`, {
      token: fill.token,
      symbol: fill.symbol,
      usd: fill.spentUsd,
      dryRun: config.dryRun,
      targetTxRef: signal.targetTxRef,
    });
    const closeResult = await handleSell(loop, signal, fill.token, "agent-close");
    review.closeExecuted = closeResult.status === "complete" && closeResult.acted === true;
  } else {
    const detail = review.decision === "close"
      ? `GPT-5.6 Sol close confidence ${fmtPct(review.confidence)} was below calibrated ${fmtPct(closeThreshold)}; kept ${fill.symbol}. ${review.summary}`
      : `GPT-5.6 Sol ${review.decision === "keep" ? "kept" : "was uncertain about"} ${fill.symbol} (${fmtPct(review.confidence)} calibrated). ${review.summary}`;
    record(state, "agent-keep", detail, {
      token: fill.token,
      symbol: fill.symbol,
      usd: fill.spentUsd,
      dryRun: config.dryRun,
      targetTxRef: signal.targetTxRef,
    });
  }

  analysis.reviews.push(review);
  const closePriceUsd = fill.market.priceUsd ?? fill.entryPriceUsd;
  const sellCost = executionCostFor(config, fill.spentUsd, fill.market.liquidityUsd);
  analysis.counterfactuals.push(createCounterfactualRecord({
    sequence,
    policyVersion: evolution.policyVersion,
    targetTxRef: signal.targetTxRef,
    token: fill.token,
    symbol: fill.symbol,
    entryAt: review.reviewedAt,
    entryPriceUsd: fill.entryPriceUsd,
    spentUsd: fill.spentUsd,
    decision: review.decision,
    reviewPath: review.reviewPath,
    confidence: review.rawConfidence ?? review.confidence,
    calibratedConfidence: review.calibratedConfidence ?? review.confidence,
    closeThreshold,
    closePriceUsd,
    closeAt: review.closeExecuted ? Date.now() : undefined,
    closeExecuted: review.closeExecuted,
    buyCost: fill.buyCost,
    sellCost,
  }));
  analysis.nextSequence = sequence + 1;
}

async function matureEvolvedCounterfactuals(loop: Loop): Promise<void> {
  const records = loop.state.agentAnalysis?.counterfactuals ?? [];
  const now = Date.now();
  const dueByToken = new Map<string, typeof records>();
  for (const counterfactual of records) {
    markMissedCounterfactualHorizons(counterfactual, now);
    if (!dueCounterfactualHorizons(counterfactual, now).length) continue;
    const due = dueByToken.get(counterfactual.token) ?? [];
    due.push(counterfactual);
    dueByToken.set(counterfactual.token, due);
  }
  await Promise.all([...dueByToken.entries()].map(async ([token, due]) => {
    const priceUsd = await tokenPriceUsd(loop.config.network, token);
    if (priceUsd == null) return;
    for (const counterfactual of due) {
      for (const horizon of dueCounterfactualHorizons(counterfactual, now)) {
        observeCounterfactualHorizon(counterfactual, horizon, priceUsd, now);
      }
    }
  }));
}

function nextCounterfactualSequence(records: NonNullable<CopyTradeAgentAnalysisState["counterfactuals"]>): number {
  return records.reduce((highest, record) => Math.max(highest, record.sequence + 1), 0);
}

function executionCostFor(
  config: CopyTradingConfig,
  notionalUsd: number,
  liquidityUsd: number | null,
): CopyTradeExecutionCost {
  const estimate = estimateCopyTradeExecutionCost({
    network: config.network,
    notionalUsd,
    liquidityUsd,
    maxSlippageBps: config.slippageBps,
  });
  return { fixedUsd: estimate.fixedUsd, variableBps: estimate.variableBps };
}

async function paperBuy(
  loop: Loop,
  signal: CopyTradeSignal,
  token: string,
  wantUsd: number,
  marketPromise?: Promise<TokenMarket>,
): Promise<PaperBuyAttempt> {
  const { config, state } = loop;
  const ledger = ensurePaperLedger(state);
  const market = await (marketPromise ?? tokenMarket(config.network, token));
  if (market.priceUsd == null || !(market.priceUsd > 0)) {
    return { status: "retry", reason: "verified market price unavailable" };
  }
  const buyCost = executionCostFor(config, wantUsd, market.liquidityUsd);
  const res = applyPaperBuy(ledger, {
    token,
    symbol: market.symbol,
    priceUsd: market.priceUsd,
    wantUsd,
    minCopyUsd: config.minCopyUsd,
    at: Date.now(),
    executionCost: buyCost,
  });
  if (!res.ok) {
    state.stats.skipped += 1;
    record(state, "skip", `[paper] skipped buy ${short(token)} — ${res.reason}.`, { token, dryRun: true, targetTxRef: signal.targetTxRef });
    return { status: "complete", fill: null };
  }
  const sym = market.symbol || short(token);
  record(state, "buy", `[paper] bought ~$${res.spentUsd.toFixed(2)} of ${sym} @ ${fmtPrice(res.priceUsd)} — sim cash ${fmtUsd(ledger.cashUsd)} (target ${short(signal.targetTxRef)}).`, {
    token, symbol: sym, usd: res.spentUsd, dryRun: true, targetTxRef: signal.targetTxRef,
  });
  return {
    status: "complete",
    fill: {
      token,
      symbol: sym,
      spentUsd: res.notionalUsd,
      entryPriceUsd: res.priceUsd,
      market,
      buyCost,
    },
  };
}

async function paperSell(
  loop: Loop,
  signal: CopyTradeSignal | null,
  token: string,
  reason: SellReason,
  priceHint?: number,
): Promise<SignalHandlingResult> {
  const { config, state } = loop;
  const ledger = ensurePaperLedger(state);
  const market = await tokenMarket(config.network, token);
  const price = priceHint ?? market.priceUsd;
  const position = ledger.positions[token];
  const grossProceedsUsd = price != null && position ? position.amount * price : position?.spentUsd ?? 0;
  const sellCost = executionCostFor(config, grossProceedsUsd, market.liquidityUsd);
  const res = applyPaperSell(ledger, token, price, Date.now(), sellCost);
  if (!res.ok) {
    if (res.reason === "no market price" && signal) {
      return { status: "retry", reason: "verified market price unavailable" };
    }
    // Can't value the exit this tick — leave the position and retry next poll.
    if (reason === "sell") {
      state.stats.skipped += 1;
      record(state, "skip", `[paper] can't value ${short(token)} to sell — ${res.reason}; will retry.`, { token, dryRun: true, targetTxRef: signal?.targetTxRef });
    }
    return COMPLETE_SIGNAL;
  }
  const kind: CopyTradeEventKind = reason === "sell" ? "sell" : reason;
  record(state, kind, `[paper] sold ${res.symbol} → ~$${res.proceedsUsd.toFixed(2)} (${reason}, P&L ${fmtSigned(res.pnlUsd)}) — sim cash ${fmtUsd(ledger.cashUsd)}.`, {
    token, symbol: res.symbol, usd: res.proceedsUsd, dryRun: true, targetTxRef: signal?.targetTxRef,
  });
  return { status: "complete", acted: true };
}

/** Revalue every paper position to market each tick (updates the display mark) and
 *  fire simulated take-profit / stop-loss exits when configured. */
async function runPaperExits(loop: Loop): Promise<void> {
  const { config, state } = loop;
  const ledger = state.paper;
  if (!ledger?.initialized) return;
  const open = Object.values(ledger.positions);
  if (open.length === 0) return;
  const now = Date.now();
  for (const position of open) {
    const price = await tokenPriceUsd(config.network, position.token);
    if (price == null) continue; // can't revalue this tick; try next
    const mark = paperPositionValue(position, price);
    position.markUsd = mark.valueUsd;
    position.markAt = now;
    if (config.takeProfitPct != null && mark.pnlPct >= config.takeProfitPct) {
      await paperSell(loop, null, position.token, "take-profit", price);
    } else if (config.stopLossPct != null && mark.pnlPct <= -config.stopLossPct) {
      await paperSell(loop, null, position.token, "stop-loss", price);
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
async function commitSignalState(loop: Loop, targetTxRef: string): Promise<void> {
  completePendingSignal(loop.state, targetTxRef);
  await writeRuntimeState(loop.state);
}

/** Read the acting wallet's balance and choose which held asset funds this buy. */
async function resolveBuyFunding(config: CopyTradingConfig, usd: number): Promise<BuyFunding | null> {
  let balance;
  try {
    balance = await getWalletBalance(config.walletAddress, config.network);
  } catch {
    return null; // can't read balance this tick → skip rather than blind-swap
  }
  const nativePrice = await nativeUsdPrice(config.network).catch(() => null);
  const funds = fundingAssetsFromBalance(config.network, balance, nativePrice);
  return selectBuyFunding(config.network, usd, funds);
}

async function resolveSigner(config: CopyTradingConfig): Promise<{ fromAddress: string; network: string; secret: string }> {
  const stored = await getWalletSecret(config.agentId);
  if (!stored) throw new Error(`Acting wallet ${config.agentId} has no local signing key (watch-only or Bankr cannot copy-trade).`);
  if (stored.info.network !== config.network) {
    throw new Error(`Acting wallet network ${stored.info.network} does not match config network ${config.network}.`);
  }
  return { fromAddress: stored.info.address, network: stored.info.network, secret: stored.secret };
}

function recordSwapError(state: CopyTradeRuntimeState, error: unknown, side: "buy" | "sell", token: string, targetTxRef?: string) {
  const message = error instanceof Error ? error.message : String(error);
  state.stats.errors += 1;
  state.lastError = message;
  const needsApproval = /approv/i.test(message);
  record(state, needsApproval ? "needs-approval" : "error", `${side} ${short(token)} failed: ${message}`, { token, targetTxRef });
}

function isBlacklisted(config: CopyTradingConfig, token: string): boolean {
  // EVM addresses compare case-insensitively; Solana mints are case-sensitive.
  if (config.network === "solana:mainnet") return config.blacklist.includes(token);
  const lower = token.toLowerCase();
  return config.blacklist.some((b) => b.toLowerCase() === lower);
}

function lastActionAt(positions: Record<string, CopyTradeOpenPosition>): number {
  return Object.values(positions).reduce((max, p) => Math.max(max, p.lastActionAt), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function short(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function fmtUsd(value: number): string {
  if (!Number.isFinite(value)) return "$0.00";
  return `$${value.toFixed(2)}`;
}

function fmtSigned(value: number): string {
  const sign = value < 0 ? "−" : "+";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function fmtPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Price formatting that survives sub-cent meme-token prices (e.g. $0.00000123). */
function fmtPrice(price: number): string {
  if (!(price > 0)) return "$0";
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toPrecision(3)}`;
}
