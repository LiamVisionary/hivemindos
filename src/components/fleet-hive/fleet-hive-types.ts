/* fleet-hive-types.ts — types + helpers for the Fleet "Hive" view.
   The view reads only the fields declared here; real fleet data is adapted into
   these shapes by fleet-hive-mappers.ts. State unions are reused from the
   canonical fleet data module so the new view and the legacy FleetView stay in
   lockstep. */

import type { AgentState, FleetAgent, FleetMachine, MachineVersionState } from "@/components/fleet/fleet-data";
import type { MachineDelegationHealth } from "./machine-delegation-health";

export type { AgentState, MachineVersionState };

/** Machine glyph variants. Mirrors the legacy FleetView machine kinds. */
export type HiveMachineKind = "Desktop" | "Cloud Server" | "Laptop" | "Home Server" | "Edge" | "Mobile";

export interface HiveAgent {
  id: string;
  name: string;
  runtime: string;
  state: AgentState;
  role: string;
  iconSrc: string;
  /** display string, e.g. "0.42 ETH" or "—" */
  wallet: string;
  task: string;
  /** human "started X ago" value, e.g. "2m" */
  since: string;
  /** the original fleet agent, kept so callbacks fire with real objects */
  source: FleetAgent;
}

export interface HiveMachine {
  id: string;
  name: string;
  kind: HiveMachineKind;
  role: string;
  os: string;
  chip: string;
  place: string;
  ip: string;
  ping: number;
  cpu: number;
  ram: number;
  disk: number;
  version: string;
  versionState: MachineVersionState;
  uptime: string;
  agents: HiveAgent[];
  /** Work-Board-derived delegation health — how many needs-human tasks this box
   *  is silently failing right now. Undefined until the Work Board is joined in;
   *  when `degraded`, the cell must read as troubled instead of healthy-green. */
  health?: MachineDelegationHealth;
  /** the original fleet machine, kept so callbacks fire with real objects */
  source: FleetMachine;
}

/** What the detail panel + stage are focused on. */
export type HiveSelection =
  | { type: "queen" }
  | { type: "phone" }
  | { type: "machine"; id: string }
  | { type: "agent"; id: string; machineId: string };

export type HivePhoneConnectionState = "connected" | "seen-offline" | "waiting" | "tailnet-issue";

export interface HivePhoneStatus {
  state: HivePhoneConnectionState;
  dashboardStatus: string;
  phoneStatus: string;
  mobileMachines: HiveMachine[];
  onlineMobileMachines: HiveMachine[];
  dashboardTailnetReady: boolean;
}

export interface HiveStateMeta {
  label: string;
  color: string;
  live: boolean;
}

export interface HiveFleetSummary {
  machines: number;
  agents: number;
  working: number;
  attention: number;
}

const FR_STATE: Record<AgentState, HiveStateMeta> = {
  working: { label: "Working", color: "var(--live)", live: true },
  ready: { label: "Ready", color: "var(--fg-3)", live: false },
  scheduled: { label: "Scheduled", color: "var(--honey)", live: false },
  setup: { label: "Setup", color: "var(--honey)", live: false },
  failed: { label: "Failed", color: "var(--danger)", live: false },
};

export function frStateMeta(s: AgentState): HiveStateMeta {
  return FR_STATE[s] || FR_STATE.ready;
}

export function frFleetSummary(machines: HiveMachine[]): HiveFleetSummary {
  const agents = machines.reduce((n, m) => n + m.agents.length, 0);
  const working = machines.reduce(
    (n, m) => n + m.agents.filter((a) => a.state === "working").length,
    0,
  );
  const attention = machines.reduce(
    (n, m) =>
      n +
      m.agents.filter((a) => a.state === "failed" || a.state === "setup").length +
      (m.versionState !== "current" || m.health?.degraded ? 1 : 0),
    0,
  );
  return { machines: machines.length, agents, working, attention };
}

export function frMachineState(m: HiveMachine): AgentState {
  if (m.agents.some((a) => a.state === "failed")) return "failed";
  if (m.versionState === "needs-setup" || m.agents.some((a) => a.state === "setup")) return "setup";
  if (m.agents.some((a) => a.state === "working")) return "working";
  return "ready";
}

export function isHiveMobileMachine(machine: HiveMachine) {
  return machine.kind === "Mobile" || /^(ios|android)(?:\b|[^a-z])/i.test(machine.source.os);
}

export function hivePhoneStatus(machines: HiveMachine[], tailnetLabel = ""): HivePhoneStatus {
  const dashboardStatus = tailnetLabel.trim() || "Checking Tailnet";
  const dashboardTailnetReady =
    /(tailscale\s+running|hivemind link connected)/i.test(dashboardStatus) &&
    !/(stalled|not configured|not running|unavailable|running locally)/i.test(dashboardStatus);
  const mobileMachines = machines.filter(isHiveMobileMachine);
  const onlineMobileMachines = mobileMachines.filter((machine) =>
    machine.ping > 0 ||
    /online/i.test(machine.uptime) ||
    /online/i.test(machine.source.uptime),
  );

  if (onlineMobileMachines.length > 0) {
    return {
      state: "connected",
      dashboardStatus,
      phoneStatus: `Connected to Tailscale · ${onlineMobileMachines.map((machine) => machine.name).join(", ")}`,
      mobileMachines,
      onlineMobileMachines,
      dashboardTailnetReady,
    };
  }

  if (mobileMachines.length > 0) {
    return {
      state: "seen-offline",
      dashboardStatus,
      phoneStatus: `Seen in Tailscale · ${mobileMachines.map((machine) => machine.name).join(", ")} offline`,
      mobileMachines,
      onlineMobileMachines,
      dashboardTailnetReady,
    };
  }

  const tailnetProblem = /(not configured|not running|unavailable|running locally|stalled)/i.test(dashboardStatus);
  return {
    state: tailnetProblem ? "tailnet-issue" : "waiting",
    dashboardStatus,
    phoneStatus: "No phone connected to Tailscale yet.",
    mobileMachines,
    onlineMobileMachines,
    dashboardTailnetReady,
  };
}
