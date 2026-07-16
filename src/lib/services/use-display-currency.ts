"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DISPLAY_CURRENCY_STATE_KEY,
  normalizeDisplayCurrency,
} from "@/lib/services/display-currency";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";

const USD_ONLY_RATES = { USD: 1 };
let cachedFxRates: Record<string, number> | null = null;
let fxRatesRequest: Promise<Record<string, number>> | null = null;

function sanitizeFxRates(raw: unknown): Record<string, number> {
  const rates: Record<string, number> = { USD: 1 };
  if (!raw || typeof raw !== "object") return rates;
  for (const [currency, value] of Object.entries(raw)) {
    const rate = Number(value);
    if (Number.isFinite(rate) && rate > 0) rates[currency.toUpperCase()] = rate;
  }
  return rates;
}

function loadFxRates(): Promise<Record<string, number>> {
  if (cachedFxRates) return Promise.resolve(cachedFxRates);
  if (fxRatesRequest) return fxRatesRequest;
  fxRatesRequest = fetch("/api/trading/market", {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ kind: "fx" }),
  })
    .then(async (response) => response.ok ? response.json() as Promise<{ rates?: unknown }> : null)
    .then((result) => {
      const rates = sanitizeFxRates(result?.rates);
      if (result?.rates) cachedFxRates = rates;
      return rates;
    })
    .catch(() => USD_ONLY_RATES)
    .finally(() => { fxRatesRequest = null; });
  return fxRatesRequest;
}

export function useDisplayCurrency() {
  const [storedCurrency, rememberCurrency, preferenceReady] = useRememberedDashboardValue(DISPLAY_CURRENCY_STATE_KEY, "USD");
  const [fxRates, setFxRates] = useState<Record<string, number>>(() => cachedFxRates ?? USD_ONLY_RATES);
  const [ratesReady, setRatesReady] = useState(() => cachedFxRates !== null);

  useEffect(() => {
    let cancelled = false;
    void loadFxRates()
      .then((rates) => {
        if (!cancelled) {
          setFxRates(rates);
          setRatesReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setRatesReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  const currency = normalizeDisplayCurrency(storedCurrency, fxRates);
  const setCurrency = useCallback((nextCurrency: string) => {
    rememberCurrency(normalizeDisplayCurrency(nextCurrency, fxRates));
  }, [fxRates, rememberCurrency]);

  return { currency, fxRates, setCurrency, ready: preferenceReady && ratesReady };
}
