"use client";

/* sim-context.tsx — the seam between the Simulation UI and its data.

   Every surface in this folder used to read module-level mock globals from
   sim-data.ts (SW_RUNS, SW_AGENTS, SW_MARKET, SW_THREADS, …). They now read the
   dataset from this context instead, so the same components render real
   MiroShark data when a <SimDataProvider> is mounted above them. When no
   provider is present (the standalone example), useSimData() falls back to the
   mock dataset so the drop-in still renders identically. */

import React from "react";
import {
  SW_AGENTS, SW_DECISIONS, SW_MARKET, SW_REDDIT, SW_ROUND_TABLE, SW_RUNS, SW_THREADS, SW_INTEL,
  frSimActive, frSimLive, frSimOthers,
  type Agent, type Decision, type Intel, type RedditPost, type Run, type TemplateId, type XThread,
} from "./sim-data";
import { MIROSHARK_X402_SIMULATION_PRICE_LABEL } from "@/lib/config/miroshark-x402";

export type SimLaunchMode = "local" | "x402";
/** Per-mode readiness for the split launch button — drives the menu + disabled reasons. */
export interface SimLaunchModeStatus {
  /** True if this mode can launch right now. */
  ready: boolean;
  /** Why it can't launch (shown to the user). */
  reason?: string;
  /** x402 only: no usable wallet exists at all → offer to open the Wallets tab. */
  needsWallet?: boolean;
  /** Optional extra hint (e.g. "connected via <machine>" / "~$1.20 USDC"). */
  note?: string;
}
export interface SimLaunchPayload { template: TemplateId; scenario: string; rounds: number; platform: string; mode?: SimLaunchMode; deepResearch?: boolean }
export interface SimStat { value: React.ReactNode; label: string; live?: boolean; tone?: string }
export interface TapeData {
  symbol: string;
  ticks: number[];
  ladder: { px: number; bid: number | null; ask: number | null }[];
  headlines: { t: string; body: string; tone: "bull" | "bear" | "neutral" }[];
}
export interface RoundRow { round: number; pnl: string; sharpe: string; pos: string }
export interface ResearchContent {
  eyebrow: string;
  title: string;
  meta: string;
  body: string;
  records: { title: string; body: string }[];
}
export interface OpsEvent { t: string; level: "info" | "warn" | "error" | "fatal"; msg: string }

export interface SimDataset {
  runs: Run[];
  active: Run | null;
  live: Run[];
  others: Run[];
  stats: SimStat[];
  getRun: (id: string) => Run | null;
  /** market-making theater roster + console + tape + last-rounds table */
  agents: Agent[];
  decisions: Decision[];
  roundTable: RoundRow[];
  tape: TapeData;
  /** native per-run surfaces, derived from real run payloads (null = empty state) */
  threadFor: (run: Run) => XThread | null;
  redditFor: (run: Run) => RedditPost | null;
  researchFor: (run: Run) => ResearchContent | null;
  opsFor: (run: Run) => OpsEvent[];
  intelFor: (run: Run) => Intel | null;
  /** chrome */
  loading?: boolean;
  loadingLabel?: string;
  emptyLabel?: string;
  /** operational handlers — wired to the live controller by the panel */
  onLaunch?: (payload: SimLaunchPayload) => void;
  onPublish?: (run: Run) => void;
  onSelectRun?: (run: Run) => void;
  onExport?: (run: Run) => void;
  /** Stop a live run. */
  onStop?: (run: Run) => void;
  /** Per-mode readiness for the split launch button (local MiroShark vs paid x402). */
  launchModes?: { local: SimLaunchModeStatus; x402: SimLaunchModeStatus };
  /** Deep-link to the Wallets tab (offered when a paid run has no usable wallet). */
  onOpenWallets?: () => void;
}

// ── mock fallback (keeps the standalone example identical) ───────────────────
function mockResearch(): ResearchContent {
  return {
    eyebrow: "briefs / 2026-05-21-cpi.md · synthesized by 8 readers",
    title: "CPI 3.4% — what the hive thinks",
    meta: "27 sources · consensus 0.74 · ready in 12m",
    body: "Eight reading bees ingested 27 Tavily results on the latest CPI print. Five themes converged with high agreement; two split the swarm.",
    records: [
      { title: "Consensus", body: "Headline beat is driven by shelter + transportation services, not goods." },
      { title: "Consensus", body: "Fed pivot is delayed at the margin — markets are repricing terminal +14bp." },
      { title: "Dissent", body: "Base effects bias next month's print lower regardless of organic momentum. Only 28% the trend persists." },
    ],
  };
}
function mockOps(): OpsEvent[] {
  return [
    { t: "00:00", level: "info", msg: "ops-storm: starting vault conflict storm (intensity 2σ, 5 rounds)" },
    { t: "00:04", level: "info", msg: "syncthing: forced conflict on briefs/2026-05-21-cpi.md" },
    { t: "00:08", level: "warn", msg: "rsync: lock contention on /vault/.obsidian (peer atlas)" },
    { t: "00:14", level: "warn", msg: "tailscale: peer drone-01 marked unreachable (retry 1/6)" },
    { t: "00:22", level: "error", msg: "rsync: ssh handshake failed; backoff 3s" },
    { t: "00:48", level: "error", msg: "rsync: ssh handshake failed; backoff 12s" },
    { t: "01:06", level: "fatal", msg: "ops-storm: ABORT — abandoned vault repair after 6 retries" },
  ];
}

export function mockDataset(): SimDataset {
  const live = SW_RUNS.filter((r) => r.state === "live").length;
  const active = frSimActive();
  return {
    runs: SW_RUNS,
    active: active ?? null,
    live: frSimLive(),
    others: frSimOthers(),
    stats: [
      { value: live, label: "running", live: true, tone: "var(--live)" },
      { value: active ? active.agents : SW_AGENTS.length, label: "agents in arena", tone: "var(--honey)" },
      { value: SW_RUNS.length, label: "runs on the shelf" },
    ],
    getRun: (id) => SW_RUNS.find((r) => r.id === id) ?? null,
    agents: SW_AGENTS,
    decisions: SW_DECISIONS,
    roundTable: SW_ROUND_TABLE,
    tape: SW_MARKET,
    threadFor: (run) => SW_THREADS[run.id] ?? null,
    redditFor: (run) => SW_REDDIT[run.id] ?? null,
    researchFor: () => mockResearch(),
    opsFor: () => mockOps(),
    intelFor: (run) => SW_INTEL[run.id] ?? null,
    // Standalone demo: both modes available so the split button is exercisable.
    launchModes: { local: { ready: true }, x402: { ready: true, note: `~${MIROSHARK_X402_SIMULATION_PRICE_LABEL}` } },
  };
}

const SimDataContext = React.createContext<SimDataset | null>(null);

export function SimDataProvider({ value, children }: { value: SimDataset; children: React.ReactNode }) {
  return <SimDataContext.Provider value={value}>{children}</SimDataContext.Provider>;
}

// Built once at module load; only used as the standalone fallback when no
// <SimDataProvider> is mounted (the in-repo example / demo). The real app always
// provides a live dataset, so this is never the rendered data there.
const FALLBACK_DATASET: SimDataset = mockDataset();
export function useSimData(): SimDataset {
  return React.useContext(SimDataContext) ?? FALLBACK_DATASET;
}
