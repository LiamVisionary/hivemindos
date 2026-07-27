/* format.ts — display-currency-aware money/number formatting for the Trade desk.
   All stored values are USD; the active display currency multiplies by a real FX
   rate (from /api/trading/market kind:"fx") and reskins the symbol at format
   time, so a single toggle restyles the whole route without touching the math.

   The active currency + rate table are module-level (set once per render by the
   view root, like the original drop-in) because the formatters are called from
   every presentational leaf and a single Trade view is mounted at a time. */

import {
  availableDisplayCurrencies,
  DISPLAY_CURRENCY_META,
  normalizeDisplayCurrency,
  type DisplayCurrencyMeta,
} from "@/lib/services/display-currency";

export type FxMeta = DisplayCurrencyMeta;
export const FX_META = DISPLAY_CURRENCY_META;

let CURRENCY = "USD";
let RATES: Record<string, number> = { USD: 1 };

/** Set the active display currency + real FX rate table (called by the view root). */
export function setDisplayCurrency(currency: string, rates: Record<string, number>) {
  RATES = rates && rates.USD ? rates : { USD: 1 };
  CURRENCY = normalizeDisplayCurrency(currency, RATES);
}

/** Currencies actually available right now: USD plus any with a live rate. */
export function availableCurrencies(rates: Record<string, number>): string[] {
  return availableDisplayCurrencies(rates);
}

function meta(): FxMeta { return FX_META[CURRENCY] ?? FX_META.USD; }
function rate(): number { return Number(RATES[CURRENCY]) > 0 ? Number(RATES[CURRENCY]) : 1; }

export function fxSymbol(): string { return meta().symbol; }
export function activeCurrency(): string { return CURRENCY; }

/** Compact: $1.2k for thousands, rounded otherwise. `full` = grouped integer. */
export function trUsd(value: number, full = false): string {
  const f = meta();
  const x = value * rate();
  if (full) return f.symbol + Math.round(x).toLocaleString();
  if (Math.abs(x) >= 1000) return f.symbol + (x / 1000).toFixed(1) + "k";
  return f.symbol + (Math.abs(x) >= 1 ? Math.round(x).toString() : x.toFixed(2));
}

/** Two-decimal (or zero for JPY-style) money. */
export function trUsd2(value: number): string {
  const f = meta();
  const x = value * rate();
  const d = f.dp0 ? 0 : 2;
  return f.symbol + x.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Money at an explicit decimal precision (for sub-dollar token prices). */
export function trMoney(value: number, dp: number): string {
  const f = meta();
  const x = value * rate();
  const d = f.dp0 ? 0 : dp;
  return f.symbol + x.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function trPct(p: number): string {
  return (p < 0 ? "" : "+") + (Number(p) || 0).toFixed(2) + "%";
}

/** Native token amount (not currency-converted). */
export function trAmt(sym: string, amt: number): string {
  const n = Number(amt) || 0;
  if (sym === "ETH" || sym === "cbBTC" || sym === "BTC" || sym === "WBTC") return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(n) < 1 && n !== 0) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
