// src/components/fleet/economy-strip.tsx
// Compact fleet-wide economy readout for the fleet side rail: combined agent
// wallet balances, Honey contribution records, and Bankr LLM credits.
"use client";

import * as React from "react";
import type { FleetMachine } from "./fleet-data";
import styles from "./fleet-tokens.module.css";
import { formatEconomyHoney, formatEconomyUsd, useFleetEconomyBalances } from "./use-fleet-economy-balances";

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
  const { data } = useFleetEconomyBalances();

  const wallets = React.useMemo(() => agentWalletTotalUsd(machines), [machines]);

  const cells: Array<{ key: string; label: string; value: string; title: string }> = [
    {
      key: "wallets",
      label: "agent wallets",
      value: wallets.counted > 0 ? formatEconomyUsd(wallets.total) : "—",
      title: wallets.counted > 0
        ? `Combined balance across ${wallets.counted} funded agent wallet${wallets.counted === 1 ? "" : "s"}`
        : "No funded agent wallets yet",
    },
    {
      key: "honey",
      label: "honey",
      value: data?.availableHoney == null ? "—" : formatEconomyHoney(data.availableHoney),
      title: data?.totalHoney != null
        ? `Honey contribution record · ${formatEconomyHoney(data.totalHoney)} recorded lifetime`
        : "Honey contribution record; not cash and not automatically convertible to HIVE",
    },
    {
      key: "bankr",
      label: "bankr credits",
      value: data?.bankrBalanceUsd == null ? "—" : formatEconomyUsd(data.bankrBalanceUsd),
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
