/* fx-rates.ts — real USD→currency rates for the Trade desk's display-currency
   toggle. All stored money stays in USD; the UI only reskins the formatting, so
   these rates are display-side. Sourced from Frankfurter (ECB data, no key) with
   exchangerate.host as a fallback, cached ~1h. No placeholders: if both sources
   fail, the caller falls back to USD-only rather than guessing a rate. */

export const FX_CURRENCIES = ["EUR", "GBP", "JPY", "CHF", "AUD", "CAD"] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];

export type FxRatesResult = {
  base: "USD";
  rates: Record<string, number>; // includes USD: 1
  updatedAt: number;
  source: "frankfurter" | "open.er-api";
};

let memo: { value: FxRatesResult; expires: number } | null = null;

async function getJson<T>(url: string, timeoutMs = 7000): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal }).catch(() => null);
    if (!response?.ok) return null;
    return (await response.json().catch(() => null)) as T | null;
  } finally {
    clearTimeout(timeout);
  }
}

function sanitize(raw: Record<string, unknown> | undefined): Record<string, number> {
  const rates: Record<string, number> = { USD: 1 };
  for (const currency of FX_CURRENCIES) {
    const value = Number(raw?.[currency]);
    if (Number.isFinite(value) && value > 0) rates[currency] = value;
  }
  return rates;
}

/**
 * Real USD-base FX rates for the supported display currencies. Cached in-memory
 * for an hour. Returns null only when every source fails (the UI then offers USD
 * only). The returned `rates` always includes `USD: 1`.
 */
export async function fetchFxRates(): Promise<FxRatesResult | null> {
  if (memo && memo.expires > Date.now()) return memo.value;

  const symbols = FX_CURRENCIES.join(",");
  const frank = await getJson<{ rates?: Record<string, number> }>(`https://api.frankfurter.app/latest?base=USD&symbols=${symbols}`);
  let result: FxRatesResult | null = null;
  if (frank?.rates) {
    const rates = sanitize(frank.rates);
    if (Object.keys(rates).length > 1) result = { base: "USD", rates, updatedAt: Date.now(), source: "frankfurter" };
  }

  if (!result) {
    // Key-free fallback (ECB-independent). Shape: { result: "success", rates: {…} }.
    const erapi = await getJson<{ result?: string; rates?: Record<string, number> }>(`https://open.er-api.com/v6/latest/USD`);
    if (erapi?.result === "success" && erapi.rates) {
      const rates = sanitize(erapi.rates);
      if (Object.keys(rates).length > 1) result = { base: "USD", rates, updatedAt: Date.now(), source: "open.er-api" };
    }
  }

  if (result) memo = { value: result, expires: Date.now() + 60 * 60_000 };
  return result;
}
