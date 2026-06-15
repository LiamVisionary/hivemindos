"use client";

/* TopBar.tsx — the Fleet header (sits to the right of the full-height app rail).
   Title on the left, live status strip on the right. The brand + theme toggle
   live in the app-wide NavShelf; the layout toggle floats over the hive canvas. */

import type { HiveMachine } from "./fleet-hive-types";
import { frFleetSummary } from "./fleet-hive-types";
import { Summary } from "./primitives";

export function TopBar({
  machines,
  eyebrow,
}: {
  machines: HiveMachine[];
  eyebrow?: string;
}) {
  const s = frFleetSummary(machines);
  return (
    <header
      className="fr-topbar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        height: "var(--header-h, 58px)",
        flex: "0 0 auto",
        padding: "0 26px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {/* left — title */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, minWidth: 0 }}>
        <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 17, letterSpacing: "-0.01em" }}>Fleet</span>
        <span style={{ fontSize: 12.5, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{eyebrow || "the swarm, at a glance"}</span>
      </div>

      {/* right — live status strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
        <Summary n={s.machines} label="machines" />
        <Summary n={s.agents} label="agents" />
        <Summary n={s.working} label="working" live />
        <Summary n={s.attention} label="to tend" tone={s.attention ? "var(--honey)" : undefined} />
      </div>
    </header>
  );
}
