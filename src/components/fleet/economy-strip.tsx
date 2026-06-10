// src/components/fleet/economy-strip.tsx
// Compact fleet-wide economy readout for the fleet side rail: combined agent
// wallet balances, the HIVE reward pool, and Bankr LLM credits.
"use client";

import * as React from "react";
import type { FleetMachine } from "./fleet-data";
import styles from "./fleet-tokens.module.css";

const ECONOMY_REFRESH_MS = 60_000;

type EconomyData = {
  availableHoney: number | null;
  totalHoney: number | null;
  bankrLabel: string;
};

function formatUsd(value: number) {
  return value >= 1000
    ? `$${Math.round(value).toLocaleString("en-US")}`
    : `$${value.toFixed(2)}`;
}

// Compact cousin of the wallet panel's formatHiveAmount — the strip cells are
// too narrow for 6 decimals, so tiny balances round to 4 places.
function formatHoney(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 0.0001) return "<0.0001";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: value < 1 ? 4 : 2 });
}

/** Sum the formatted per-agent wallet strings ("$12.50" / "off" / "—"). */
function agentWalletTotalUsd(machines: FleetMachine[]) {
  let total = 0;
  let counted = 0;
  for (const machine of machines) {
    for (const agent of machine.agents) {
      const match = /^\$([0-9][0-9,]*(?:\.[0-9]+)?)$/.exec(agent.wallet.trim());
      if (!match) continue;
      total += Number(match[1].replace(/,/g, ""));
      counted += 1;
    }
  }
  return { total, counted };
}

export function EconomyStrip({ machines }: { machines: FleetMachine[] }) {
  const [data, setData] = React.useState<EconomyData | null>(null);

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
          .catch(() => null) as Promise<{ ok?: boolean; balanceUsd?: number | null; balanceLabel?: string } | null>,
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
        bankrLabel: bankrData?.ok && typeof bankrData.balanceUsd === "number"
          ? formatUsd(bankrData.balanceUsd)
          : "—",
      });
      timer = window.setTimeout(() => void refresh(), ECONOMY_REFRESH_MS);
    };
    void refresh();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  const wallets = React.useMemo(() => agentWalletTotalUsd(machines), [machines]);

  const cells: Array<{ key: string; label: string; value: string; title: string }> = [
    {
      key: "wallets",
      label: "agent wallets",
      value: wallets.counted > 0 ? formatUsd(wallets.total) : "—",
      title: wallets.counted > 0
        ? `Combined balance across ${wallets.counted} funded agent wallet${wallets.counted === 1 ? "" : "s"}`
        : "No funded agent wallets yet",
    },
    {
      key: "honey",
      label: "honey",
      value: data === null ? "···" : data.availableHoney === null ? "—" : formatHoney(data.availableHoney),
      title: data?.totalHoney != null
        ? `Honey available to claim as HIVE · ${formatHoney(data.totalHoney)} earned lifetime`
        : "Honey available to claim as HIVE",
    },
    {
      key: "bankr",
      label: "bankr credits",
      value: data === null ? "···" : data.bankrLabel,
      title: "Bankr LLM credit balance",
    },
  ];

  return (
    <div
      className="rounded-lg grid"
      style={{
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        border: "1px solid rgba(148,163,184,0.16)",
        background: "rgba(16,20,29,0.62)",
        overflow: "hidden",
      }}
    >
      {cells.map((cell, index) => (
        <div
          key={cell.key}
          title={cell.title}
          style={{
            display: "grid",
            gap: 3,
            padding: "9px 10px",
            borderLeft: index > 0 ? "1px solid rgba(148,163,184,0.12)" : "none",
          }}
        >
          <span
            style={{
              fontFamily: "var(--f-display)",
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1,
              color: cell.value === "—" ? "var(--muted)" : "var(--hex-honey-border)",
              whiteSpace: "nowrap",
            }}
          >
            {cell.value}
          </span>
          <span className={styles.monoCap} style={{ color: "var(--muted)", fontSize: 8.5 }}>
            {cell.label}
          </span>
        </div>
      ))}
    </div>
  );
}
