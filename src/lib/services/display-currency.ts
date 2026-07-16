export type DisplayCurrencyMeta = { symbol: string; name: string; dp0?: boolean };

export const DISPLAY_CURRENCY_STATE_KEY = "display.currency";

export const DISPLAY_CURRENCY_META: Record<string, DisplayCurrencyMeta> = {
  USD: { symbol: "$", name: "US Dollar" },
  EUR: { symbol: "€", name: "Euro" },
  GBP: { symbol: "£", name: "British Pound" },
  JPY: { symbol: "¥", name: "Japanese Yen", dp0: true },
  CHF: { symbol: "Fr", name: "Swiss Franc" },
  AUD: { symbol: "A$", name: "Australian Dollar" },
  CAD: { symbol: "C$", name: "Canadian Dollar" },
};

export function availableDisplayCurrencies(rates: Record<string, number>): string[] {
  return Object.keys(DISPLAY_CURRENCY_META).filter((currency) => (
    currency === "USD" || Number(rates?.[currency]) > 0
  ));
}

export function normalizeDisplayCurrency(currency: string, rates: Record<string, number>): string {
  const candidate = String(currency || "").trim().toUpperCase();
  return DISPLAY_CURRENCY_META[candidate] && Number(rates?.[candidate]) > 0 ? candidate : "USD";
}

export function displayCurrencyAmountFromUsd(valueUsd: number, currency: string, rates: Record<string, number>) {
  if (!Number.isFinite(valueUsd)) return null;
  const normalizedCurrency = normalizeDisplayCurrency(currency, rates);
  const rate = Number(rates?.[normalizedCurrency]);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return { currency: normalizedCurrency, amount: valueUsd * rate };
}

export function formatDisplayCurrencyFromUsd(valueUsd: number, currency: string, rates: Record<string, number>): string {
  const converted = displayCurrencyAmountFromUsd(valueUsd, currency, rates);
  if (!converted) return "";
  const wholeCurrency = DISPLAY_CURRENCY_META[converted.currency]?.dp0 === true;
  const smallValue = Math.abs(converted.amount) > 0 && Math.abs(converted.amount) < 0.01;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: converted.currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: wholeCurrency ? 0 : 2,
    maximumFractionDigits: wholeCurrency ? 0 : smallValue ? 6 : 2,
  }).format(converted.amount);
}
