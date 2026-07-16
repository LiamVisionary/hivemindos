/* Pure paper-trading ledger for copy-trading dry-run. No "server-only" / node
   imports so it unit-tests on fixtures (like funding.ts + the watcher's classify*
   functions). The engine owns the side effects (price fetches, event records,
   persistence); this module owns ONLY the ledger arithmetic. That split is what
   lets a dry-run config walk the SAME buy/sell/exit path as a live one — it just
   spends simulated cash and fills at the current market price instead of touching
   the chain. Everything here mutates the passed ledger in place (matching how the
   engine already mutates runtime state) and returns a result summary. */

import type {
  CopyTradeExecutionCost,
  CopyTradeOpenPosition,
  CopyTradePaperLedger,
} from "@/lib/types/copy-trading";
import { executionCostUsd } from "./execution-costs";

export type PaperLedger = CopyTradePaperLedger;

export function emptyPaperLedger(startCashUsd: number): PaperLedger {
  const start = Number.isFinite(startCashUsd) && startCashUsd > 0 ? startCashUsd : 0;
  return {
    initialized: true,
    startCashUsd: start,
    cashUsd: start,
    realizedPnlUsd: 0,
    executionCostsUsd: 0,
    mirrored: 0,
    positions: {},
  };
}

export type PaperBuyResult =
  | { ok: true; spentUsd: number; notionalUsd: number; executionCostUsd: number; boughtAmount: number; priceUsd: number }
  | { ok: false; reason: string };

/** Simulate a buy of up to `wantUsd` (already sized/per-token-capped by the caller)
 *  at the current market price. Sizes down to available simulated cash, then opens
 *  or adds to the paper position at weighted-average cost. */
export function applyPaperBuy(
  ledger: PaperLedger,
  args: {
    token: string;
    symbol: string | null;
    priceUsd: number | null;
    wantUsd: number;
    minCopyUsd: number;
    at: number;
    executionCost?: CopyTradeExecutionCost;
  },
): PaperBuyResult {
  const { token, priceUsd, wantUsd, minCopyUsd, at } = args;
  if (priceUsd == null || !(priceUsd > 0)) return { ok: false, reason: "no market price" };
  const cost = args.executionCost ?? { fixedUsd: 0, variableBps: 0 };
  const notionalUsd = Math.min(wantUsd, Math.max(0, ledger.cashUsd - cost.fixedUsd));
  if (!(notionalUsd > 0) || notionalUsd < minCopyUsd) return { ok: false, reason: "insufficient simulated cash" };

  const variableCostUsd = (notionalUsd * Math.max(0, cost.variableBps)) / 10_000;
  const totalExecutionCostUsd = Math.min(notionalUsd, Math.max(0, cost.fixedUsd) + variableCostUsd);
  const boughtAmount = Math.max(0, notionalUsd - variableCostUsd) / priceUsd;
  const existing = ledger.positions[token];
  const cashDebitUsd = notionalUsd + Math.max(0, cost.fixedUsd);
  const spentUsd = (existing?.spentUsd ?? 0) + cashDebitUsd;
  const amount = (existing?.amount ?? 0) + boughtAmount;
  ledger.positions[token] = {
    token,
    symbol: args.symbol || existing?.symbol || shortToken(token),
    spentUsd,
    amount,
    openedAt: existing?.openedAt ?? at,
    lastActionAt: at,
    // Mark the received amount, so modeled execution loss is visible immediately.
    markUsd: amount * priceUsd,
    markAt: at,
  };
  ledger.cashUsd -= cashDebitUsd;
  ledger.executionCostsUsd = (ledger.executionCostsUsd ?? 0) + totalExecutionCostUsd;
  ledger.mirrored += 1;
  return {
    ok: true,
    spentUsd: cashDebitUsd,
    notionalUsd,
    executionCostUsd: totalExecutionCostUsd,
    boughtAmount,
    priceUsd,
  };
}

export type PaperSellResult =
  | { ok: true; proceedsUsd: number; executionCostUsd: number; pnlUsd: number; symbol: string }
  | { ok: false; reason: string };

/** Simulate selling the ENTIRE paper position at the current market price,
 *  crediting proceeds back to simulated cash and booking realized P&L. */
export function applyPaperSell(
  ledger: PaperLedger,
  token: string,
  priceUsd: number | null,
  at: number,
  executionCost: CopyTradeExecutionCost = { fixedUsd: 0, variableBps: 0 },
): PaperSellResult {
  const pos = ledger.positions[token];
  if (!pos || !(pos.amount > 0)) return { ok: false, reason: "no simulated position" };
  if (priceUsd == null || !(priceUsd > 0)) return { ok: false, reason: "no market price" };

  const grossProceeds = pos.amount * priceUsd;
  const totalExecutionCostUsd = Math.min(grossProceeds, executionCostUsd(grossProceeds, executionCost));
  const proceeds = grossProceeds - totalExecutionCostUsd;
  const pnl = proceeds - pos.spentUsd;
  ledger.cashUsd += proceeds;
  ledger.realizedPnlUsd += pnl;
  ledger.executionCostsUsd = (ledger.executionCostsUsd ?? 0) + totalExecutionCostUsd;
  ledger.mirrored += 1;
  pos.lastActionAt = at;
  delete ledger.positions[token];
  return { ok: true, proceedsUsd: proceeds, executionCostUsd: totalExecutionCostUsd, pnlUsd: pnl, symbol: pos.symbol };
}

/** Mark a position to market — pure calc used for revaluation + P&L display. */
export function paperPositionValue(pos: CopyTradeOpenPosition, priceUsd: number): { valueUsd: number; pnlUsd: number; pnlPct: number } {
  const valueUsd = pos.amount * priceUsd;
  const pnlUsd = valueUsd - pos.spentUsd;
  const pnlPct = pos.spentUsd > 0 ? (pnlUsd / pos.spentUsd) * 100 : 0;
  return { valueUsd, pnlUsd, pnlPct };
}

export type PaperPortfolioSummary = {
  startCashUsd: number;
  cashUsd: number;
  positionCostUsd: number;
  positionValueUsd: number;
  equityUsd: number;
  realizedPnlUsd: number;
  executionCostsUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  returnPct: number;
};

/** Plain-language portfolio totals used by every paper-trading display. */
export function paperPortfolioSummary(ledger: PaperLedger): PaperPortfolioSummary {
  const positions = Object.values(ledger.positions);
  const positionCostUsd = positions.reduce((sum, position) => sum + position.spentUsd, 0);
  const positionValueUsd = positions.reduce((sum, position) => sum + (position.markUsd ?? position.spentUsd), 0);
  const unrealizedPnlUsd = positionValueUsd - positionCostUsd;
  const equityUsd = ledger.cashUsd + positionValueUsd;
  const totalPnlUsd = equityUsd - ledger.startCashUsd;
  const returnPct = ledger.startCashUsd > 0 ? (totalPnlUsd / ledger.startCashUsd) * 100 : 0;

  return {
    startCashUsd: ledger.startCashUsd,
    cashUsd: ledger.cashUsd,
    positionCostUsd,
    positionValueUsd,
    equityUsd,
    realizedPnlUsd: ledger.realizedPnlUsd,
    executionCostsUsd: ledger.executionCostsUsd ?? 0,
    unrealizedPnlUsd,
    totalPnlUsd,
    returnPct,
  };
}

/** Equity = simulated cash + marked value of open positions (cost basis until marked). */
export function paperEquityUsd(ledger: PaperLedger): number {
  return paperPortfolioSummary(ledger).equityUsd;
}

function shortToken(token: string): string {
  return token.length <= 12 ? token : `${token.slice(0, 6)}…${token.slice(-4)}`;
}
