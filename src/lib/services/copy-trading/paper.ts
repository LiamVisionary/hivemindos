/* Pure paper-trading ledger for copy-trading dry-run. No "server-only" / node
   imports so it unit-tests on fixtures (like funding.ts + the watcher's classify*
   functions). The engine owns the side effects (price fetches, event records,
   persistence); this module owns ONLY the ledger arithmetic. That split is what
   lets a dry-run config walk the SAME buy/sell/exit path as a live one — it just
   spends simulated cash and fills at the current market price instead of touching
   the chain. Everything here mutates the passed ledger in place (matching how the
   engine already mutates runtime state) and returns a result summary. */

import type { CopyTradeOpenPosition, CopyTradePaperLedger } from "@/lib/types/copy-trading";

export type PaperLedger = CopyTradePaperLedger;

export function emptyPaperLedger(startCashUsd: number): PaperLedger {
  const start = Number.isFinite(startCashUsd) && startCashUsd > 0 ? startCashUsd : 0;
  return { initialized: true, startCashUsd: start, cashUsd: start, realizedPnlUsd: 0, mirrored: 0, positions: {} };
}

export type PaperBuyResult =
  | { ok: true; spentUsd: number; boughtAmount: number; priceUsd: number }
  | { ok: false; reason: string };

/** Simulate a buy of up to `wantUsd` (already sized/per-token-capped by the caller)
 *  at the current market price. Sizes down to available simulated cash, then opens
 *  or adds to the paper position at weighted-average cost. */
export function applyPaperBuy(
  ledger: PaperLedger,
  args: { token: string; symbol: string | null; priceUsd: number | null; wantUsd: number; minCopyUsd: number; at: number },
): PaperBuyResult {
  const { token, priceUsd, wantUsd, minCopyUsd, at } = args;
  if (priceUsd == null || !(priceUsd > 0)) return { ok: false, reason: "no market price" };
  const spend = Math.min(wantUsd, ledger.cashUsd);
  if (!(spend > 0) || spend < minCopyUsd) return { ok: false, reason: "insufficient simulated cash" };

  const boughtAmount = spend / priceUsd;
  const existing = ledger.positions[token];
  const spentUsd = (existing?.spentUsd ?? 0) + spend;
  ledger.positions[token] = {
    token,
    symbol: args.symbol || existing?.symbol || shortToken(token),
    spentUsd,
    amount: (existing?.amount ?? 0) + boughtAmount,
    openedAt: existing?.openedAt ?? at,
    lastActionAt: at,
    // Fresh cost basis is the mark until runExits revalues it against the market.
    markUsd: spentUsd,
    markAt: at,
  };
  ledger.cashUsd -= spend;
  ledger.mirrored += 1;
  return { ok: true, spentUsd: spend, boughtAmount, priceUsd };
}

export type PaperSellResult =
  | { ok: true; proceedsUsd: number; pnlUsd: number; symbol: string }
  | { ok: false; reason: string };

/** Simulate selling the ENTIRE paper position at the current market price,
 *  crediting proceeds back to simulated cash and booking realized P&L. */
export function applyPaperSell(ledger: PaperLedger, token: string, priceUsd: number | null, at: number): PaperSellResult {
  const pos = ledger.positions[token];
  if (!pos || !(pos.amount > 0)) return { ok: false, reason: "no simulated position" };
  if (priceUsd == null || !(priceUsd > 0)) return { ok: false, reason: "no market price" };

  const proceeds = pos.amount * priceUsd;
  const pnl = proceeds - pos.spentUsd;
  ledger.cashUsd += proceeds;
  ledger.realizedPnlUsd += pnl;
  ledger.mirrored += 1;
  pos.lastActionAt = at;
  delete ledger.positions[token];
  return { ok: true, proceedsUsd: proceeds, pnlUsd: pnl, symbol: pos.symbol };
}

/** Mark a position to market — pure calc used for revaluation + P&L display. */
export function paperPositionValue(pos: CopyTradeOpenPosition, priceUsd: number): { valueUsd: number; pnlUsd: number; pnlPct: number } {
  const valueUsd = pos.amount * priceUsd;
  const pnlUsd = valueUsd - pos.spentUsd;
  const pnlPct = pos.spentUsd > 0 ? (pnlUsd / pos.spentUsd) * 100 : 0;
  return { valueUsd, pnlUsd, pnlPct };
}

/** Equity = simulated cash + marked value of open positions (cost basis until marked). */
export function paperEquityUsd(ledger: PaperLedger): number {
  const openValue = Object.values(ledger.positions).reduce((sum, p) => sum + (p.markUsd ?? p.spentUsd), 0);
  return ledger.cashUsd + openValue;
}

function shortToken(token: string): string {
  return token.length <= 12 ? token : `${token.slice(0, 6)}…${token.slice(-4)}`;
}
