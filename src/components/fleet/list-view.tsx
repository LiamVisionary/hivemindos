// src/components/fleet/list-view.tsx
"use client";

import * as React from "react";
import {
  Bell,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Database,
  Laptop,
  MessageSquare,
  Monitor,
  PhoneCall,
  Plus,
  Search,
  Server,
  Settings2,
  Smartphone,
  Trash2,
  Users,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { BeeIcon } from "./bee-icon";
import {
  fleetAgentCanChat,
  isFleetMachineMobile,
  type AgentState,
  type FleetAgent,
  type FleetAgentChat,
  type FleetMachine,
} from "./fleet-data";
import { cn } from "@/lib/utils/cn";
import styles from "./list-view.module.css";

export type FleetListViewMode = "hive" | "graph" | "map" | "list";
type FilterKey = "all" | "working" | "attention" | "idle";

interface ListViewProps {
  machines: FleetMachine[];
  selected: string;
  selectedAgentId: string | null;
  onSelectMachine: (id: string) => void;
  onSelectAgent: (m: FleetMachine, a: FleetAgent) => void;
  onAddAgent: (m: FleetMachine) => void;
  onOpenChat?: (m: FleetMachine, a: FleetAgent) => void;
  onOpenTaskChat?: (m: FleetMachine, a: FleetAgent, chat?: FleetAgentChat) => void;
  onCallAgent?: (m: FleetMachine, a: FleetAgent) => void;
  onOpenWallet?: (m: FleetMachine, a: FleetAgent) => void;
  onEditSettings?: (m: FleetMachine, a: FleetAgent) => void;
  onDuplicate?: (m: FleetMachine, a: FleetAgent) => void;
  onRemove?: (m: FleetMachine, a: FleetAgent) => void;
  /** When provided, the list renders its full-screen chrome (header, summary
   *  strip, search + filters, and the view-mode switcher). Omit for the bare
   *  card list embedded inside the legacy FleetView shell. */
  viewMode?: FleetListViewMode;
  onSelectViewMode?: (mode: FleetListViewMode) => void;
  /** Extra control rendered in the header (the Hive/Classic layout toggle). */
  headerAux?: React.ReactNode;
}

const MODE_LABELS: Record<FleetListViewMode, string> = {
  hive: "Hive",
  graph: "Graph",
  map: "Map",
  list: "List",
};

const HEX_CLIP = "polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)";

function machineIconFor(m: FleetMachine): LucideIcon {
  if (isFleetMachineMobile(m)) return Smartphone;
  const k = `${m.kind} ${m.os}`.toLowerCase();
  if (/laptop|macbook|notebook/.test(k)) return Laptop;
  if (/home|nas|truenas|vault|closet/.test(k)) return Database;
  if (/edge|probe|drone|\barm\b|raspberry|\bpi\b/.test(k)) return Cpu;
  if (/server|cloud|node|vps|hetzner|ec2|workhorse/.test(k)) return Server;
  return Monitor;
}

function stateMeta(s: AgentState): { label: string; color: string } {
  if (s === "working") return { label: "Working", color: "var(--lv-live)" };
  if (s === "failed") return { label: "Failed", color: "var(--lv-danger)" };
  if (s === "setup") return { label: "Setup", color: "var(--lv-honey)" };
  if (s === "scheduled") return { label: "Scheduled", color: "var(--lv-honey)" };
  return { label: "Idle", color: "var(--lv-fg-3)" };
}

function meterColor(v: number): string {
  return v >= 85 ? "var(--lv-danger)" : v >= 65 ? "var(--lv-honey)" : "var(--lv-live)";
}

function machineIsConnected(m: FleetMachine): boolean {
  return m.uptime.trim().toLowerCase() === "online" && m.tailnet.trim().toLowerCase() !== "not connected";
}

function formatUptime(sec?: number): string | null {
  if (typeof sec !== "number" || !Number.isFinite(sec) || sec <= 0) return null;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const min = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${min}m`;
  return `${Math.max(min, 1)}m`;
}

function uptimeText(m: FleetMachine): string | null {
  const fromSec = formatUptime(m.system?.uptimeSec);
  if (fromSec) return fromSec;
  const raw = m.uptime.trim();
  const lower = raw.toLowerCase();
  // Real data uses "online"/"offline" as a connectivity flag (surfaced by the
  // network pill instead) — only show a duration when we actually have one.
  if (!raw || lower === "online" || lower === "offline" || raw === "—") return null;
  return raw;
}

function versionInfo(m: FleetMachine): { label: string; color: string; bg: string; border: string } {
  if (m.versionState === "needs-setup") {
    return { label: "needs setup", color: "var(--lv-honey)", bg: "var(--lv-honey-soft)", border: "var(--lv-honey-line)" };
  }
  const word = m.versionState === "stale" ? "stale" : "current";
  const ver = m.version.trim();
  const label = ver && ver !== "—" && ver.toLowerCase() !== word ? `${ver} · ${word}` : word;
  if (m.versionState === "stale") {
    return { label, color: "var(--lv-honey)", bg: "var(--lv-honey-soft)", border: "var(--lv-honey-line)" };
  }
  return { label, color: "var(--lv-live)", bg: "var(--lv-live-soft)", border: "var(--lv-live-line)" };
}

function machineDotColor(m: FleetMachine): string {
  if (m.agents.some((a) => a.state === "failed")) return "var(--lv-danger)";
  if (m.versionState === "needs-setup") return "var(--lv-fg-3)";
  if (m.versionState === "stale" || m.agents.some((a) => a.state === "setup")) return "var(--lv-honey)";
  if (m.agents.some((a) => a.state === "working")) return "var(--lv-live)";
  return "var(--lv-fg-3)";
}

function agentRingColor(state: AgentState): string {
  if (state === "working") return "color-mix(in srgb, var(--lv-live) 52%, transparent)";
  if (state === "failed") return "color-mix(in srgb, var(--lv-danger) 52%, transparent)";
  if (state === "setup" || state === "scheduled") return "var(--lv-honey-line)";
  return "var(--lv-line-2)";
}

function machineAttention(m: FleetMachine): boolean {
  return m.versionState !== "current" || m.agents.some((a) => a.state === "failed" || a.state === "setup");
}

// ── small building blocks ──────────────────────────────────────────────────

function HexBadge({
  size,
  ring,
  children,
}: {
  size: number;
  ring: string;
  children: React.ReactNode;
}) {
  const inner = size - 4;
  return (
    <span
      style={{
        flex: "0 0 auto",
        width: size,
        height: size,
        clipPath: HEX_CLIP,
        background: ring,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span
        style={{
          width: inner,
          height: inner,
          clipPath: HEX_CLIP,
          background: "var(--lv-hex-inner)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {children}
      </span>
    </span>
  );
}

function StatusPill({
  color,
  label,
  live,
}: {
  color: string;
  label: string;
  live?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: 23,
        padding: "0 11px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        fontFamily: "var(--lv-mono)",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color,
        background: `color-mix(in srgb, ${color} 13%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 34%, transparent)`,
      }}
    >
      <span
        className={cn(styles.dot, live && styles.dotLive)}
        style={{ color, width: 6, height: 6 }}
      />
      {label}
    </span>
  );
}

// ── the view ────────────────────────────────────────────────────────────────

export function ListView({
  machines,
  selected,
  selectedAgentId,
  onSelectMachine,
  onSelectAgent,
  onAddAgent,
  onOpenChat,
  onOpenTaskChat,
  onCallAgent,
  onOpenWallet,
  onEditSettings,
  onDuplicate,
  onRemove,
  viewMode,
  onSelectViewMode,
  headerAux,
}: ListViewProps) {
  const fullChrome = Boolean(onSelectViewMode);
  // Bare embeddings (the legacy Classic shell) live in a narrow center column,
  // so the row sheds its secondary wallet/since columns to keep the task legible.
  const compact = !fullChrome;
  const activeMode: FleetListViewMode = viewMode ?? "list";
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<FilterKey>("all");

  const padHead = "16px 20px";
  const padRow = "13px 20px";

  const q = query.trim().toLowerCase();

  // ── stats (from the full, unfiltered fleet) ──
  const stats = React.useMemo(() => {
    let totalAgents = 0;
    let working = 0;
    let attnAgents = 0;
    let attention = 0;
    machines.forEach((m) => {
      totalAgents += m.agents.length;
      m.agents.forEach((a) => {
        if (a.state === "working") working += 1;
        if (a.state === "failed" || a.state === "setup") attnAgents += 1;
      });
      if (m.versionState !== "current") attention += 1;
    });
    attention += attnAgents;
    const idle = Math.max(0, totalAgents - working - attnAgents);
    return { totalAgents, working, attnAgents, attention, idle };
  }, [machines]);

  const statusOk = React.useCallback(
    (a: FleetAgent): boolean => {
      if (filter === "all") return true;
      if (filter === "working") return a.state === "working";
      if (filter === "idle") return a.state === "ready" || a.state === "scheduled";
      return a.state === "failed" || a.state === "setup"; // attention
    },
    [filter],
  );

  const mText = (m: FleetMachine) =>
    `${m.name} ${m.os} ${m.kind} ${m.role} ${m.location} ${m.city}`.toLowerCase();
  const aText = (a: FleetAgent) =>
    `${a.name} ${a.runtime} ${a.role} ${a.task}`.toLowerCase();

  // ── group + filter machines the way the design does ──
  const groups = React.useMemo(() => {
    return machines
      .map((m) => {
        const mMatch = !q || mText(m).includes(q);
        const agents = m.agents.filter(
          (a) => statusOk(a) && (!q || mMatch || aText(a).includes(q)),
        );
        return {
          machine: m,
          agents,
          mMatch,
          attn: machineAttention(m),
          hasAgents: agents.length > 0,
          isEmpty: m.agents.length === 0,
        };
      })
      .filter((g) => {
        if (g.hasAgents) return true;
        if (g.isEmpty) {
          if (filter === "all") return g.mMatch;
          if (filter === "attention") return g.attn && g.mMatch;
          return false;
        }
        // had agents but every one was filtered out
        if (filter === "attention") return g.attn && g.mMatch;
        return false;
      });
  }, [machines, q, filter, statusOk]);

  const noResults = groups.length === 0;

  const fire = (
    m: FleetMachine,
    a: FleetAgent,
    fn?: (m: FleetMachine, a: FleetAgent) => void,
  ) => (event: React.MouseEvent) => {
    event.stopPropagation();
    fn?.(m, a);
  };

  // ── header pieces ──
  const filterChips: Array<{ key: FilterKey; label: string; count: number; dot?: string }> = [
    { key: "all", label: "All", count: stats.totalAgents },
    { key: "working", label: "Working", count: stats.working, dot: "var(--lv-live)" },
    { key: "attention", label: "Attention", count: stats.attention, dot: "var(--lv-honey)" },
    { key: "idle", label: "Idle", count: stats.idle, dot: "var(--lv-fg-3)" },
  ];

  const statCards: Array<{
    Icon: LucideIcon;
    value: number;
    label: string;
    sub: string;
    color: string;
    bg: string;
    border: string;
    iconBg: string;
  }> = [
    { Icon: Server, value: machines.length, label: "Machines", sub: "across your tailnet", color: "var(--lv-fg)", bg: "var(--lv-panel)", border: "var(--lv-line-2)", iconBg: "var(--lv-tint-2)" },
    { Icon: Users, value: stats.totalAgents, label: "Agents", sub: "deployed in the hive", color: "var(--lv-fg)", bg: "var(--lv-panel)", border: "var(--lv-line-2)", iconBg: "var(--lv-tint-2)" },
    { Icon: Zap, value: stats.working, label: "Working", sub: "actively running now", color: "var(--lv-live)", bg: "var(--lv-live-soft)", border: "var(--lv-live-line)", iconBg: "var(--lv-live-soft)" },
    { Icon: Bell, value: stats.attention, label: "Attention", sub: "need a safe next action", color: "var(--lv-honey)", bg: "var(--lv-honey-soft)", border: "var(--lv-honey-line)", iconBg: "var(--lv-honey-soft)" },
  ];

  const attnHealthy = stats.attention === 0;

  return (
    <div className={styles.root}>
      {fullChrome && (
        <>
          {/* HEADER */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 24,
              padding: "22px 34px 16px",
              flex: "0 0 auto",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
              <span
                style={{
                  fontFamily: "var(--lv-mono)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "var(--lv-fg-3)",
                }}
              >
                Fleet · one swarm, humming
              </span>
              <h1
                style={{
                  margin: 0,
                  fontFamily: "var(--lv-display)",
                  fontSize: 27,
                  fontWeight: 600,
                  color: "var(--lv-fg)",
                  letterSpacing: "-0.01em",
                  lineHeight: 1,
                }}
              >
                Your machines &amp; agents
              </h1>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12, flex: "0 0 auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {headerAux}
                <div
                  role="group"
                  aria-label="Fleet view mode"
                  style={{
                    display: "inline-flex",
                    gap: 2,
                    padding: 3,
                    borderRadius: 999,
                    border: "1px solid var(--lv-line-2)",
                    background: "var(--lv-panel)",
                    boxShadow: "0 8px 24px -10px rgba(0,0,0,0.6)",
                  }}
                >
                  {(Object.keys(MODE_LABELS) as FleetListViewMode[]).map((m) => {
                    const active = activeMode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={active}
                        data-bee={`fleet-view-${m}`}
                        title={`${MODE_LABELS[m]} view`}
                        onClick={() => onSelectViewMode?.(m)}
                        className={styles.press}
                        style={{
                          cursor: "pointer",
                          border: 0,
                          borderRadius: 999,
                          padding: "6px 16px",
                          fontFamily: "var(--lv-mono)",
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          background: active ? "var(--lv-honey-soft)" : "transparent",
                          color: active ? "var(--lv-honey)" : "var(--lv-fg-3)",
                        }}
                      >
                        {MODE_LABELS[m]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => { if (!attnHealthy) setFilter("attention"); }}
                aria-disabled={attnHealthy}
                title={attnHealthy ? "Everything is healthy" : "Show items that need attention"}
                className={styles.press}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  height: 32,
                  padding: "0 14px",
                  borderRadius: 999,
                  cursor: attnHealthy ? "default" : "pointer",
                  background: attnHealthy ? "var(--lv-live-soft)" : "var(--lv-honey-soft)",
                  border: `1px solid ${attnHealthy ? "var(--lv-live-line)" : "var(--lv-honey-line)"}`,
                  color: attnHealthy ? "var(--lv-live)" : "var(--lv-honey)",
                  fontFamily: "var(--lv-body)",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {attnHealthy ? <Check size={15} aria-hidden /> : <Bell size={15} aria-hidden />}
                {attnHealthy
                  ? "Everything is healthy"
                  : `${stats.attention} item${stats.attention === 1 ? "" : "s"} need your attention`}
              </button>
            </div>
          </div>

          {/* SUMMARY STRIP */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 12,
              padding: "0 34px 16px",
              flex: "0 0 auto",
            }}
          >
            {statCards.map((s) => (
              <div
                key={s.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 16px",
                  border: `1px solid ${s.border}`,
                  borderRadius: 14,
                  background: s.bg,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    background: s.iconBg,
                    color: s.color,
                    flex: "0 0 auto",
                  }}
                >
                  <s.Icon size={19} aria-hidden />
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                    <strong
                      style={{
                        fontFamily: "var(--lv-display)",
                        fontSize: 22,
                        fontWeight: 600,
                        lineHeight: 1,
                        color: s.color,
                      }}
                    >
                      {s.value}
                    </strong>
                    <span
                      style={{
                        fontFamily: "var(--lv-mono)",
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--lv-fg-3)",
                      }}
                    >
                      {s.label}
                    </span>
                  </div>
                  <span style={{ fontSize: 11.5, lineHeight: 1.3, color: "var(--lv-fg-2)" }}>{s.sub}</span>
                </div>
              </div>
            ))}
          </div>

          {/* TOOLBAR */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              padding: "0 34px 14px",
              flex: "0 0 auto",
            }}
          >
            <div
              className={styles.searchWrap}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                height: 42,
                flex: "1 1 300px",
                maxWidth: 380,
                padding: "0 15px",
                border: "1px solid var(--lv-line-2)",
                borderRadius: 12,
                background: "var(--lv-panel)",
              }}
            >
              <Search size={17} aria-hidden style={{ color: "var(--lv-fg-3)", flex: "0 0 auto" }} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search machines, agents, tasks…"
                aria-label="Search the fleet"
                className={styles.searchInput}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "transparent",
                  border: 0,
                  outline: "none",
                  color: "var(--lv-fg)",
                  fontFamily: "var(--lv-body)",
                  fontSize: 14,
                }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  title="Clear search"
                  aria-label="Clear search"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20,
                    height: 20,
                    border: 0,
                    borderRadius: "50%",
                    background: "var(--lv-tint-2)",
                    color: "var(--lv-fg-2)",
                    cursor: "pointer",
                    flex: "0 0 auto",
                  }}
                >
                  <X size={11} />
                </button>
              )}
            </div>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              {filterChips.map((c) => {
                const active = filter === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setFilter(c.key)}
                    aria-pressed={active}
                    className={styles.press}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      height: 34,
                      padding: "0 13px",
                      borderRadius: 999,
                      cursor: "pointer",
                      background: active ? "var(--lv-honey-soft)" : "var(--lv-tint)",
                      border: `1px solid ${active ? "var(--lv-honey-line)" : "var(--lv-line-2)"}`,
                      color: active ? "var(--lv-fg)" : "var(--lv-fg-2)",
                      fontFamily: "var(--lv-body)",
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    {c.dot && (
                      <span className={styles.dot} style={{ color: c.dot, width: 7, height: 7, flex: "0 0 auto" }} />
                    )}
                    {c.label}
                    <span
                      style={{
                        fontFamily: "var(--lv-mono)",
                        fontSize: 11,
                        fontWeight: 700,
                        color: active ? "var(--lv-honey)" : "var(--lv-fg-3)",
                      }}
                    >
                      {c.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* LIST */}
      <div
        className={styles.scroll}
        style={{
          padding: fullChrome ? "2px 34px 40px" : "14px 16px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {groups.map(({ machine: m, agents, hasAgents, isEmpty, attn }) => {
          const isMSel = selected === m.id && !selectedAgentId;
          const highlight = attn;
          const MachineIcon = machineIconFor(m);
          const connected = machineIsConnected(m);
          const ver = versionInfo(m);
          const up = uptimeText(m);
          // Only surface host meters when the collector actually reported real
          // system metrics — never draw a bar from synthetic fallback numbers.
          const showMeters =
            m.system != null &&
            (typeof m.system.cpuPct === "number" ||
              typeof m.system.ramPct === "number" ||
              typeof m.system.diskPct === "number");
          const meters = [
            { label: "CPU", pct: m.cpu },
            { label: "RAM", pct: m.ram },
            { label: "DISK", pct: m.disk },
          ];
          return (
            <div
              key={m.id}
              style={{
                flex: "0 0 auto",
                border: `1px solid ${
                  isMSel
                    ? "var(--lv-honey-line)"
                    : highlight
                      ? "color-mix(in srgb, var(--lv-honey) 28%, transparent)"
                      : "var(--lv-line-2)"
                }`,
                borderRadius: 16,
                background: "var(--lv-panel)",
                boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 20px 55px -38px rgba(0,0,0,0.75)",
                overflow: "hidden",
              }}
            >
              {/* MACHINE HEADER */}
              <div
                className={styles.machineHeader}
                onClick={() => onSelectMachine(m.id)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  cursor: "pointer",
                  background: isMSel
                    ? "var(--lv-honey-soft)"
                    : highlight
                      ? "color-mix(in srgb, var(--lv-honey) 5%, transparent)"
                      : "transparent",
                  borderBottom: hasAgents || isEmpty ? "1px solid var(--lv-line)" : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: padHead, flexWrap: compact ? "wrap" : "nowrap", rowGap: compact ? 10 : undefined }}>
                  <HexBadge size={42} ring={highlight ? "var(--lv-honey-line)" : "var(--lv-line-2)"}>
                    <MachineIcon
                      size={19}
                      aria-hidden
                      style={{ color: m.versionState === "needs-setup" ? "var(--lv-fg-3)" : "var(--lv-honey)" }}
                    />
                  </HexBadge>

                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "0 0 auto", minWidth: 132 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <strong
                        style={{
                          fontFamily: "var(--lv-mono)",
                          fontSize: 15,
                          fontWeight: 700,
                          color: "var(--lv-fg)",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {m.name}
                      </strong>
                      <span
                        className={styles.dot}
                        style={{
                          color: machineDotColor(m),
                          width: 6,
                          height: 6,
                          flex: "0 0 auto",
                          boxShadow:
                            machineDotColor(m) === "var(--lv-live)"
                              ? "0 0 7px color-mix(in srgb, var(--lv-live) 70%, transparent)"
                              : undefined,
                        }}
                      />
                    </div>
                    <span
                      title={m.os}
                      style={{
                        fontFamily: "var(--lv-mono)",
                        fontSize: 10.5,
                        color: "var(--lv-fg-3)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {m.os}
                    </span>
                  </div>

                  {!compact && <div style={{ width: 1, alignSelf: "stretch", background: "var(--lv-line-2)", flex: "0 0 auto" }} />}

                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 auto", minWidth: compact ? 120 : 0 }}>
                    <span title={`${m.kind} · ${m.role}`} style={{ fontSize: 12.5, color: "var(--lv-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.kind} · {m.role}
                    </span>
                    <span
                      title={m.location}
                      style={{
                        fontFamily: "var(--lv-mono)",
                        fontSize: 10.5,
                        color: "var(--lv-fg-3)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.location}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto", marginLeft: compact ? "auto" : undefined }}>
                    <span
                      title={`${connected ? "Connected" : "Off"}: ${m.tailnet}${m.ip && m.ip !== "—" ? ` · ${m.ip}` : ""}${m.ping ? ` · ${m.ping}ms` : ""}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        height: 26,
                        padding: "0 11px",
                        borderRadius: 999,
                        whiteSpace: "nowrap",
                        fontFamily: "var(--lv-mono)",
                        fontSize: 10,
                        fontWeight: 700,
                        color: connected ? "var(--lv-live)" : "var(--lv-fg-3)",
                        background: connected ? "var(--lv-live-soft)" : "var(--lv-tint-2)",
                        border: `1px solid ${connected ? "var(--lv-live-line)" : "var(--lv-line-2)"}`,
                      }}
                    >
                      <span
                        className={styles.dot}
                        style={{ color: connected ? "var(--lv-live)" : "var(--lv-fg-3)", width: 6, height: 6, flex: "0 0 auto" }}
                      />
                      {connected ? "Connected" : "Off"}
                    </span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        height: 26,
                        padding: "0 11px",
                        borderRadius: 999,
                        whiteSpace: "nowrap",
                        fontFamily: "var(--lv-mono)",
                        fontSize: 10,
                        fontWeight: 700,
                        color: ver.color,
                        background: ver.bg,
                        border: `1px solid ${ver.border}`,
                      }}
                    >
                      {ver.label}
                    </span>
                    {up && !compact && (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1, flex: "0 0 auto", marginLeft: 4 }}>
                        <span style={{ fontFamily: "var(--lv-mono)", fontSize: 11, color: "var(--lv-fg-2)", whiteSpace: "nowrap" }}>{up}</span>
                        <span style={{ fontFamily: "var(--lv-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "var(--lv-fg-4)" }}>UPTIME</span>
                      </div>
                    )}
                  </div>
                </div>

                {showMeters && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 28,
                      padding: "12px 20px",
                      background: "var(--lv-tint)",
                      borderTop: "1px solid var(--lv-line)",
                    }}
                  >
                    {meters.map((mt) => (
                      <div key={mt.label} style={{ display: "flex", alignItems: "center", gap: 11, flex: "1 1 0", minWidth: 0 }}>
                        <span style={{ fontFamily: "var(--lv-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", color: "var(--lv-fg-3)", width: 34, flex: "0 0 auto" }}>
                          {mt.label}
                        </span>
                        <span style={{ flex: 1, height: 4, borderRadius: 4, background: "var(--lv-line-2)", overflow: "hidden" }}>
                          <span style={{ display: "block", height: "100%", width: `${Math.min(100, Math.max(0, mt.pct))}%`, borderRadius: 4, background: meterColor(mt.pct) }} />
                        </span>
                        <span style={{ fontFamily: "var(--lv-mono)", fontSize: 11, fontWeight: 700, color: meterColor(mt.pct), width: 38, textAlign: "right", flex: "0 0 auto" }}>
                          {mt.pct}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* AGENTS */}
              {hasAgents && (
                <div>
                  {agents.map((a) => {
                    const isASel = selected === m.id && selectedAgentId === a.id;
                    const meta = stateMeta(a.state);
                    const canChat = fleetAgentCanChat(a);
                    const walletDim = a.wallet === "—" || a.wallet === "0.00 ETH";
                    const recent = (a.recentChats ?? []).filter((c) => c.id && c.id !== a.currentTaskId).slice(0, 3);
                    return (
                      <div
                        key={a.id}
                        className={styles.agentRow}
                        style={{
                          borderTop: "1px solid var(--lv-line)",
                          background: isASel ? "var(--lv-panel-2)" : "transparent",
                        }}
                      >
                        <div
                          onClick={(e) => { e.stopPropagation(); onSelectAgent(m, a); }}
                          style={{ display: "flex", alignItems: "center", gap: 14, padding: padRow, cursor: "pointer" }}
                        >
                          <HexBadge size={38} ring={agentRingColor(a.state)}>
                            <BeeIcon
                              role={a.beeRole === "queen" ? "queen" : "worker"}
                              workerClass={a.workerClass}
                              size={30}
                              dim={a.state === "ready" && !isASel}
                            />
                          </HexBadge>

                          <div style={{ display: "flex", flexDirection: "column", gap: 2, width: compact ? 132 : 158, flex: "0 0 auto" }}>
                            <strong style={{ fontFamily: "var(--lv-display)", fontSize: 13.5, fontWeight: 600, color: "var(--lv-fg)" }}>
                              {a.name}
                            </strong>
                            <span style={{ fontFamily: "var(--lv-mono)", fontSize: 10, color: "var(--lv-fg-3)" }}>
                              {a.runtime} · {a.role}
                            </span>
                          </div>

                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              fontSize: 12.5,
                              lineHeight: 1.4,
                              color: "var(--lv-fg-2)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {a.task}
                          </span>

                          {!compact && (
                            <span style={{ flex: "0 0 auto", width: 78, textAlign: "right", fontFamily: "var(--lv-mono)", fontSize: 11.5, color: walletDim ? "var(--lv-fg-4)" : "var(--lv-fg-2)" }}>
                              {a.wallet}
                            </span>
                          )}
                          {!compact && (
                            <span style={{ flex: "0 0 auto", width: 52, textAlign: "right", whiteSpace: "nowrap", fontFamily: "var(--lv-mono)", fontSize: 10.5, color: "var(--lv-fg-4)" }}>
                              {a.since}
                            </span>
                          )}
                          <span style={{ flex: "0 0 auto", width: compact ? "auto" : 104, display: "inline-flex", justifyContent: "flex-end" }}>
                            <StatusPill color={meta.color} label={meta.label} live={a.state === "working"} />
                          </span>
                          <span
                            style={{
                              flex: "0 0 auto",
                              color: isASel ? "var(--lv-honey)" : "var(--lv-fg-4)",
                              display: "inline-flex",
                              transform: isASel ? "rotate(90deg)" : "rotate(0deg)",
                              transition: "transform 0.16s ease",
                            }}
                          >
                            <ChevronRight size={16} aria-hidden />
                          </span>
                        </div>

                        {isASel && (
                          <div style={{ padding: "0 20px 16px 66px", display: "flex", flexDirection: "column", gap: 12 }}>
                            <div
                              style={{
                                padding: "12px 14px",
                                borderRadius: 10,
                                background: "var(--lv-tint)",
                                border: "1px solid var(--lv-line)",
                                fontSize: 12.5,
                                lineHeight: 1.55,
                                color: "var(--lv-fg)",
                                whiteSpace: "normal",
                                wordBreak: "break-word",
                              }}
                            >
                              {a.task}
                            </div>

                            {canChat && onOpenTaskChat && recent.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {recent.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onOpenTaskChat(m, a, c); }}
                                    className={styles.actionBtn}
                                    title={`Resume: ${c.title}`}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 7,
                                      maxWidth: 260,
                                      height: 28,
                                      padding: "0 11px",
                                      borderRadius: 8,
                                      cursor: "pointer",
                                      background: "var(--lv-tint-2)",
                                      border: "1px solid var(--lv-line-2)",
                                      color: "var(--lv-fg-2)",
                                      fontFamily: "var(--lv-mono)",
                                      fontSize: 10.5,
                                    }}
                                  >
                                    <MessageSquare size={12} aria-hidden style={{ flex: "0 0 auto", color: "var(--lv-live)" }} />
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
                                    <span style={{ color: "var(--lv-fg-4)", flex: "0 0 auto" }}>{c.since}</span>
                                  </button>
                                ))}
                              </div>
                            )}

                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                              {canChat && onOpenChat && (
                                <button
                                  type="button"
                                  onClick={fire(m, a, onOpenChat)}
                                  className={styles.actionBtn}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 8,
                                    height: 32,
                                    padding: "0 13px",
                                    borderRadius: 9,
                                    cursor: "pointer",
                                    background: "var(--lv-live-soft)",
                                    border: "1px solid var(--lv-live-line)",
                                    color: "var(--lv-live)",
                                    fontFamily: "var(--lv-mono)",
                                    fontSize: 10,
                                    fontWeight: 700,
                                    letterSpacing: "0.06em",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  <MessageSquare size={13} aria-hidden />
                                  New chat
                                </button>
                              )}
                              {[
                                { id: "call", label: "Call", Icon: PhoneCall, fn: onCallAgent },
                                { id: "wallet", label: "Wallet", Icon: Wallet, fn: onOpenWallet },
                                { id: "settings", label: "Settings", Icon: Settings2, fn: onEditSettings },
                                { id: "dup", label: "Duplicate", Icon: Copy, fn: onDuplicate },
                                { id: "remove", label: "Remove", Icon: Trash2, fn: onRemove, danger: true },
                              ]
                                .filter((ac) => Boolean(ac.fn))
                                .map((ac) => (
                                  <button
                                    key={ac.id}
                                    type="button"
                                    onClick={fire(m, a, ac.fn)}
                                    title={ac.label}
                                    className={styles.actionBtn}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 8,
                                      height: 32,
                                      padding: "0 12px",
                                      borderRadius: 9,
                                      cursor: "pointer",
                                      background: ac.danger ? "var(--lv-danger-soft)" : "var(--lv-tint-2)",
                                      border: `1px solid ${ac.danger ? "var(--lv-danger-line)" : "var(--lv-line-2)"}`,
                                      color: ac.danger ? "var(--lv-danger)" : "var(--lv-fg-2)",
                                      fontFamily: "var(--lv-mono)",
                                      fontSize: 10,
                                      fontWeight: 700,
                                      letterSpacing: "0.06em",
                                      textTransform: "uppercase",
                                    }}
                                  >
                                    <ac.Icon size={13} aria-hidden />
                                    {ac.label}
                                  </button>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div
                    className={styles.addRow}
                    onClick={(e) => { e.stopPropagation(); onAddAgent(m); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: padRow,
                      borderTop: "1px solid var(--lv-line)",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        flex: "0 0 auto",
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        border: "1px dashed var(--lv-honey-line)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--lv-honey)",
                      }}
                    >
                      <Plus size={16} aria-hidden />
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <strong style={{ fontFamily: "var(--lv-display)", fontSize: 13.5, fontWeight: 600, color: "var(--lv-honey)" }}>
                        Add agent
                      </strong>
                      <span style={{ fontFamily: "var(--lv-mono)", fontSize: 10, color: "var(--lv-fg-3)" }}>
                        deploy a new agent to {m.name}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* EMPTY MACHINE */}
              {isEmpty && (
                <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "20px 24px" }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                    <strong style={{ fontFamily: "var(--lv-display)", fontSize: 13.5, fontWeight: 600, color: "var(--lv-fg)" }}>
                      No agents on this machine yet
                    </strong>
                    <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--lv-fg-3)", maxWidth: 560 }}>
                      {m.versionState === "needs-setup"
                        ? `Finish onboarding ${m.name} to the tailnet, then install the read-only collector so agents inside your private network are detected here.`
                        : `${m.name} is connected — deploy your first agent to put it to work in the hive.`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onAddAgent(m); }}
                    className={styles.actionBtn}
                    style={{
                      flex: "0 0 auto",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      height: 34,
                      padding: "0 15px",
                      borderRadius: 999,
                      cursor: "pointer",
                      background: "var(--lv-honey)",
                      border: 0,
                      color: "var(--lv-honey-ink)",
                      fontFamily: "var(--lv-body)",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {m.versionState === "needs-setup" ? "Finish setup" : "Add first agent"}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {noResults && fullChrome && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "64px 20px", textAlign: "center" }}>
            <Search size={30} aria-hidden style={{ color: "var(--lv-fg-4)", marginBottom: 4 }} />
            <strong style={{ fontFamily: "var(--lv-display)", fontSize: 16, fontWeight: 600, color: "var(--lv-fg)" }}>
              Nothing matches
            </strong>
            <span style={{ fontSize: 13, color: "var(--lv-fg-3)", maxWidth: 360 }}>
              No machines or agents match your search and filter. Try a different term or clear the filter.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
