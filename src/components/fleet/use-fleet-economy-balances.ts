"use client";

import * as React from "react";

const ECONOMY_REFRESH_MS = 60_000;

export type FleetEconomyRemoteData = {
  availableHoney: number | null;
  totalHoney: number | null;
  bankrBalanceUsd: number | null;
};

export function formatEconomyUsd(value: number) {
  return value >= 1000
    ? `$${Math.round(value).toLocaleString("en-US")}`
    : `$${value.toFixed(2)}`;
}

export function formatEconomyHoney(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 0.0001) return "<0.0001";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: value < 1 ? 4 : 2 });
}

export function useFleetEconomyBalances() {
  const [data, setData] = React.useState<FleetEconomyRemoteData | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    let timer = 0;
    const refresh = async () => {
      const [honeyData, bankrData] = await Promise.all([
        fetch("/api/honey-ledger", { cache: "no-store", signal: controller.signal })
          .then((response) => response.json())
          .catch(() => null) as Promise<{ ok?: boolean; ledger?: { balances?: Array<{ availableHoney?: number; lifetimeHoney?: number }> } } | null>,
        fetch("/api/bankr/llm-credits?mode=balance", { cache: "no-store", signal: controller.signal })
          .then((response) => response.json())
          .catch(() => null) as Promise<{ ok?: boolean; balanceUsd?: number | null } | null>,
      ]);
      if (controller.signal.aborted) return;
      const balances = honeyData?.ok ? honeyData.ledger?.balances : null;
      setData({
        availableHoney: balances
          ? balances.reduce((total, balance) => total + (balance.availableHoney ?? 0), 0)
          : null,
        totalHoney: balances
          ? balances.reduce((total, balance) => total + (balance.lifetimeHoney ?? 0), 0)
          : null,
        bankrBalanceUsd: bankrData?.ok && typeof bankrData.balanceUsd === "number"
          ? bankrData.balanceUsd
          : null,
      });
      timer = window.setTimeout(() => void refresh(), ECONOMY_REFRESH_MS);
    };
    void refresh();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  return { data, loading: data === null };
}
