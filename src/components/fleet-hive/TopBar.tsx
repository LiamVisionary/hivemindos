"use client";

/* TopBar.tsx — the Fleet header (sits to the right of the full-height app rail).
   Title on the left, live status strip on the right. The brand + theme toggle
   live in the app-wide NavShelf; the layout toggle floats over the hive canvas. */

import type * as React from "react";
import type { FleetSearchFilter, FleetSearchItem } from "@/components/fleet/fleet-search";
import type { HiveMachine } from "./fleet-hive-types";
import { frFleetSummary } from "./fleet-hive-types";
import { FleetFinder } from "./FleetFinder";
import { Summary } from "./primitives";

export function TopBar({
  machines,
  eyebrow,
  searchIndex,
  searchInputRef,
  searchOpen,
  searchQuery,
  searchRecents,
  searchResults,
  statusFilter,
  onLocate,
  onSearchOpenChange,
  onSearchQueryChange,
  onStatusFilterChange,
  onChat,
  onSettings,
}: {
  machines: HiveMachine[];
  eyebrow?: string;
  searchIndex: FleetSearchItem[];
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchOpen: boolean;
  searchQuery: string;
  searchRecents: FleetSearchItem[];
  searchResults: FleetSearchItem[];
  statusFilter: FleetSearchFilter;
  onLocate: (item: FleetSearchItem) => void;
  onSearchOpenChange: (open: boolean) => void;
  onSearchQueryChange: (query: string) => void;
  onStatusFilterChange: (filter: FleetSearchFilter) => void;
  onChat?: (item: FleetSearchItem) => void;
  onSettings?: (item: FleetSearchItem) => void;
}) {
  const s = frFleetSummary(machines);
  return (
    <header
      className="fr-topbar"
      style={{ borderBottom: "1px solid var(--line)" }}
    >
      {/* left — title */}
      <div className="fr-topbar-title">
        <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 17, letterSpacing: "-0.01em" }}>Fleet</span>
        <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>{eyebrow || "the swarm, at a glance"}</span>
      </div>

      <FleetFinder
        index={searchIndex}
        inputRef={searchInputRef}
        open={searchOpen}
        query={searchQuery}
        recentItems={searchRecents}
        results={searchResults}
        onLocate={onLocate}
        onOpenChange={onSearchOpenChange}
        onQueryChange={onSearchQueryChange}
        onChat={onChat}
        onSettings={onSettings}
      />

      {/* right — live status strip */}
      <div className="fr-topbar-summary">
        <Summary n={s.machines} label="machines" />
        <Summary n={s.agents} label="agents" />
        <button
          type="button"
          className="fr-summary-filter"
          aria-pressed={statusFilter === "working"}
          title="Highlight working agents"
          onClick={() => onStatusFilterChange(statusFilter === "working" ? "all" : "working")}
        >
          <Summary n={s.working} label="working" live />
        </button>
        <button
          type="button"
          className="fr-summary-filter"
          aria-pressed={statusFilter === "attention"}
          title="Highlight machines and agents that need attention"
          onClick={() => onStatusFilterChange(statusFilter === "attention" ? "all" : "attention")}
        >
          <Summary n={s.attention} label="to tend" tone={s.attention ? "var(--honey)" : undefined} />
        </button>
      </div>
    </header>
  );
}
