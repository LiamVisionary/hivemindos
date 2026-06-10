// src/components/fleet/fleet-data.ts
// Shape + mock data for the Fleet view. Replace MACHINES/TASKS/ALERTS with
// your real data fetcher when wiring up.

import type { BeeWorkerClass } from "@/lib/types/agent-runtime";
import type { GitLawbNodeStatus } from "@/lib/types/gitlawb";

export type AgentState = "working" | "ready" | "scheduled" | "setup" | "failed";
export type FleetAgentActivityStatus = "active" | "completed" | "failed" | "unknown";

export interface FleetAgentChat {
  id: string;
  title: string;
  task: string;
  since: string;
}

export interface FleetActiveApp {
  id: string;
  name: string;
  initials: string;
  theme: string;
  iconUrl?: string;
  openUrl?: string;
}

export type FleetAgentCapabilityIcon =
  | "analytics"
  | "background"
  | "browser"
  | "chat"
  | "deployment"
  | "filesystem"
  | "http"
  | "mcp"
  | "publishing"
  | "scheduler"
  | "shell"
  | "wallet"
  | "workflow";

export interface FleetAgentCapabilityBadge {
  id: string;
  label: string;
  icon: FleetAgentCapabilityIcon;
  tone: "aqua" | "blue" | "gold" | "green" | "pink" | "purple" | "slate";
}

export interface FleetAgent {
  id: string;
  name: string;
  runtime: string;
  canChat?: boolean;
  state: AgentState;
  role: string;
  beeRole?: string;
  workerClass?: BeeWorkerClass;
  wallet: string;     // formatted e.g. "0.42 ETH" or "—"
  balance: "healthy" | "low_compute" | "dead" | "off";
  task: string;
  currentTaskId?: string;
  currentTaskUpdatedAt?: number;
  activeApp?: FleetActiveApp;
  activityStatus?: FleetAgentActivityStatus;
  capabilities?: FleetAgentCapabilityBadge[];
  since: string;      // formatted e.g. "2m", "5h"
  recentChats?: FleetAgentChat[];
}

export function fleetAgentCanChat(agent: FleetAgent) {
  if (typeof agent.canChat === "boolean") return agent.canChat;
  return /^(hermes|openclaw)$/i.test(agent.runtime.trim());
}

export type MachineVersionState = "current" | "stale" | "needs-setup";

export interface FleetMachineNetworkIssue {
  label: string;
  title: string;
  detail: string;
  fixAction?: "restart-local-tailnet";
  fixLabel?: string;
  commands: string[];
}

export interface FleetMachineSyncIssue {
  label: string;
  title: string;
  detail: string;
  deviceID: string;
  deviceName: string;
  completion?: number | null;
  needItems?: number | null;
  needBytes?: number | null;
  remoteState?: string | null;
  stalled?: boolean;
}

/** Live host metrics reported by the machine's collector `/health` endpoint. */
export interface FleetMachineSystem {
  checkedAt?: number;
  cpuPct?: number;
  cpuCores?: number;
  cpuModel?: string;
  loadAvg1m?: number;
  ramPct?: number;
  ramUsedGb?: number;
  ramTotalGb?: number;
  diskPct?: number | null;
  diskUsedGb?: number | null;
  diskTotalGb?: number | null;
  platform?: string;
  arch?: string;
  osRelease?: string;
  uptimeSec?: number;
}

export interface FleetMachine {
  id: string;
  name: string;
  kind: string;          // Desktop / Cloud Server / Laptop / Home Server / Edge
  role: string;          // Primary / Workhorse / Roaming / Vault / Probe
  os: string;
  tailnet: string;
  ip: string;
  collectorUrl?: string;
  ping: number;          // ms
  cpu: number;           // %
  ram: number;           // %
  disk: number;          // %
  version: string;       // "v0.18.2" or "—"
  versionState: MachineVersionState;
  canUpdate?: boolean;
  location: string;      // "Studio · Brooklyn"
  city: string;          // "Brooklyn"
  lat: number;
  lon: number;
  uptime: string;
  system?: FleetMachineSystem;
  networkIssue?: FleetMachineNetworkIssue;
  syncIssue?: FleetMachineSyncIssue;
  gitlawb?: GitLawbNodeStatus;
  agents: FleetAgent[];
}

export function isFleetMachineMobile(machine: Pick<FleetMachine, "kind" | "os">) {
  return machine.kind === "Mobile" || /^(ios|android)(?:\b|[^a-z])/i.test(machine.os);
}

export interface FleetTask {
  id: string;
  title: string;
  agent: string;
  machine: string;
  state: "in_progress" | "blocked" | "scheduled" | "queue" | "done";
  priority: "low" | "med" | "high";
  eta: string;
  lane: "doing" | "blocked" | "queue" | "done";
}

export interface FleetAlert {
  id: string;
  tone: "danger" | "warn" | "info";
  priority?: "normal" | "high" | "urgent";
  title?: string;
  agent: string;
  machine: string;
  text: string;
  since: string;
  timestamp?: number;
}

export const MACHINES: FleetMachine[] = [
  {
    id: "atlas",
    name: "atlas",
    kind: "Desktop",
    role: "Primary",
    os: "macOS 15.3 · M3 Max",
    tailnet: "atlas.tail-fern.ts.net",
    ip: "100.74.12.4",
    ping: 4,
    cpu: 38, ram: 62, disk: 41,
    version: "v0.18.2",
    versionState: "current",
    location: "Studio · Brooklyn",
    city: "Brooklyn",
    lat: 40.68, lon: -73.96,
    uptime: "12d 4h",
    system: { cpuPct: 38, cpuCores: 14, cpuModel: "Apple M3 Max", ramPct: 62, ramUsedGb: 22.3, ramTotalGb: 36, diskPct: 41 },
    agents: [
      { id: "a1", name: "Hermes-α",       runtime: "Hermes",   state: "working",   role: "Lead",       wallet: "0.42 ETH", balance: "healthy",     task: "Refactoring the swarm agent bridge to stream over Tailscale SSH", since: "2m" },
      { id: "a2", name: "OpenClaw-eng",   runtime: "OpenClaw", state: "ready",     role: "Engineer",   wallet: "0.08 ETH", balance: "healthy",     task: "Idle · waiting for next handoff from Hermes-α", since: "11m" },
      { id: "a3", name: "Aeon-night",     runtime: "Aeon",     state: "scheduled", role: "Background", wallet: "—",        balance: "off",         task: "Nightly skill index rebuild · 02:00 UTC", since: "5h" },
    ],
  },
  {
    id: "nimbus",
    name: "nimbus",
    kind: "Cloud Server",
    role: "Workhorse",
    os: "Ubuntu 24.04 · 32c/128G",
    tailnet: "nimbus.tail-fern.ts.net",
    ip: "100.74.12.18",
    ping: 22,
    cpu: 71, ram: 48, disk: 22,
    version: "v0.18.2",
    versionState: "current",
    location: "us-east-2 · Hetzner",
    city: "Ashburn, VA",
    lat: 39.04, lon: -77.49,
    uptime: "41d 9h",
    system: { cpuPct: 71, cpuCores: 32, cpuModel: "AMD EPYC 7543", ramPct: 48, ramUsedGb: 61.4, ramTotalGb: 128, diskPct: 22 },
    agents: [
      { id: "b1", name: "MiroShark-sim",     runtime: "MiroShark", state: "working", role: "Simulator", wallet: "—",        balance: "off",         task: "Running market-making sim · epoch 8410 of 12000", since: "23m" },
      { id: "b2", name: "Hermes-research",   runtime: "Hermes",    state: "working", role: "Research",  wallet: "0.12 ETH", balance: "low_compute", task: "Synthesizing the Tavily research dump into an Obsidian brief", since: "1m" },
      { id: "b3", name: "Codex-skill",       runtime: "Codex",     state: "ready",   role: "Skills",    wallet: "0.04 ETH", balance: "healthy",     task: "Idle · last ran skill `index-vault` 14m ago", since: "14m" },
      { id: "b4", name: "OpenClaw-x",        runtime: "OpenClaw",  state: "failed",  role: "Channels",  wallet: "0.00 ETH", balance: "dead",        task: "Auth handshake failed against X channel — needs re-login", activityStatus: "failed", since: "1h" },
    ],
  },
  {
    id: "lattice",
    name: "lattice",
    kind: "Laptop",
    role: "Roaming",
    os: "macOS 15.3 · M2",
    tailnet: "lattice.tail-fern.ts.net",
    ip: "100.74.12.27",
    ping: 18,
    cpu: 12, ram: 28, disk: 64,
    version: "v0.18.0",
    versionState: "stale",
    location: "Café · Lisbon",
    city: "Lisbon",
    lat: 38.72, lon: -9.13,
    uptime: "2h 14m",
    system: { cpuPct: 12, cpuCores: 8, cpuModel: "Apple M2", ramPct: 28, ramUsedGb: 6.7, ramTotalGb: 24, diskPct: 64 },
    agents: [
      { id: "c1", name: "Hermes-mobile", runtime: "Hermes", state: "ready", role: "Inbox", wallet: "0.02 ETH", balance: "healthy", task: "Idle · brain sync paused while on hotspot", since: "8m" },
      { id: "c2", name: "Gemini-notes",  runtime: "Gemini", state: "setup", role: "Notes", wallet: "—",        balance: "off",     task: "Needs API key · `hive-env-add GOOGLE_API_KEY`", since: "—" },
    ],
  },
  {
    id: "honeycomb",
    name: "honeycomb",
    kind: "Home Server",
    role: "Vault",
    os: "TrueNAS · 24c/96G",
    tailnet: "honeycomb.tail-fern.ts.net",
    ip: "100.74.12.33",
    ping: 9,
    cpu: 18, ram: 34, disk: 78,
    version: "v0.18.2",
    versionState: "current",
    location: "Closet · Brooklyn",
    city: "Brooklyn",
    lat: 40.69, lon: -73.97,
    uptime: "98d 2h",
    system: { cpuPct: 18, cpuCores: 24, cpuModel: "Intel Xeon E5-2680", ramPct: 34, ramUsedGb: 32.6, ramTotalGb: 96, diskPct: 78 },
    agents: [
      { id: "d1", name: "Brain-sync", runtime: "Syncthing", state: "working",   role: "Vault",     wallet: "—", balance: "off", task: "Reconciling Obsidian vault · 412 files this hour", since: "12s" },
      { id: "d2", name: "Aeon-jobs",  runtime: "Aeon",      state: "scheduled", role: "Schedules", wallet: "—", balance: "off", task: "Next: `pull-rss-digest` in 23m", since: "4m" },
    ],
  },
  {
    id: "drone-01",
    name: "drone-01",
    kind: "Edge",
    role: "Probe",
    os: "Debian 12 · ARM64",
    tailnet: "drone-01.tail-fern.ts.net",
    ip: "100.74.12.41",
    ping: 64,
    cpu: 6, ram: 14, disk: 9,
    version: "—",
    versionState: "needs-setup",
    location: "Field · Berlin",
    city: "Berlin",
    lat: 52.52, lon: 13.40,
    uptime: "—",
    agents: [],
  },
];

export const TASKS: FleetTask[] = [
  { id: "t1",  title: "Stream Tailscale telemetry to dashboard", agent: "Hermes-α",         machine: "atlas",     state: "in_progress", priority: "high", eta: "12m",       lane: "doing" },
  { id: "t2",  title: "Fix OpenClaw X-channel auth",             agent: "OpenClaw-x",       machine: "nimbus",    state: "blocked",     priority: "high", eta: "—",         lane: "blocked" },
  { id: "t3",  title: "Synthesize Tavily research dump",         agent: "Hermes-research",  machine: "nimbus",    state: "in_progress", priority: "med",  eta: "4m",        lane: "doing" },
  { id: "t4",  title: "Run market-making simulation epoch 8410", agent: "MiroShark-sim",    machine: "nimbus",    state: "in_progress", priority: "med",  eta: "1h 12m",    lane: "doing" },
  { id: "t5",  title: "Reconcile Obsidian vault",                agent: "Brain-sync",       machine: "honeycomb", state: "in_progress", priority: "low",  eta: "ongoing",   lane: "doing" },
  { id: "t6",  title: "Nightly skill index rebuild",             agent: "Aeon-night",       machine: "atlas",     state: "scheduled",   priority: "low",  eta: "02:00 UTC", lane: "queue" },
  { id: "t7",  title: "Refresh GPG-encrypted env backup",        agent: "—",                machine: "atlas",     state: "queue",       priority: "med",  eta: "—",         lane: "queue" },
  { id: "t8",  title: "Onboard drone-01 to the tailnet",         agent: "—",                machine: "drone-01",  state: "queue",       priority: "low",  eta: "—",         lane: "queue" },
];

export const ALERTS: FleetAlert[] = [
  { id: "al1", tone: "danger", agent: "OpenClaw-x",    machine: "nimbus",    text: "X channel re-auth required",                       since: "1h"  },
  { id: "al2", tone: "warn",   agent: "Gemini-notes",  machine: "lattice",   text: "Missing GOOGLE_API_KEY",                            since: "8m"  },
  { id: "al3", tone: "warn",   agent: "—",             machine: "lattice",   text: "Dashboard build stale (v0.18.0 → v0.18.2)",         since: "2h"  },
  { id: "al4", tone: "info",   agent: "Brain-sync",    machine: "honeycomb", text: "Vault sync caught up",                              since: "12s" },
];

export const TICKER: string[] = [
  "Hermes-α   :: writing `agent-bridge/stream.ts` lines 84–142",
  "MiroShark  :: epoch 8410 ▸ pnl Δ +0.42% (sharpe 1.81)",
  "Brain-sync :: 412 files reconciled · 3 conflicts auto-merged",
  "Hermes-res :: ranking 27 Tavily results against memory index",
  "Aeon-night :: scheduled in 5h 42m (`index-vault`)",
  "Atlas      :: cpu 38% · ram 62% · ssd 41% · ping 4ms",
  "Nimbus     :: cpu 71% · ram 48% · 14 streams open",
  "OpenClaw-x :: handshake_failed (401) — retry in 14s",
];

// The edges shown on the graph + map. Could come from the tailnet snapshot.
export const FLEET_EDGES: Array<[string, string]> = [
  ["atlas", "nimbus"],
  ["atlas", "honeycomb"],
  ["atlas", "lattice"],
  ["nimbus", "honeycomb"],
  ["nimbus", "drone-01"],
  ["honeycomb", "drone-01"],
];
