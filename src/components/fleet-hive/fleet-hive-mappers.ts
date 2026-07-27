/* fleet-hive-mappers.ts — adapt the canonical FleetMachine/FleetAgent payload
   (the same data the legacy FleetView consumes) into the lean shapes the Hive
   view reads. Every mapped node keeps a `source` back-reference so the view can
   fire callbacks with the real fleet objects. */

import { isFleetMachineMobile, type FleetAgent, type FleetMachine } from "@/components/fleet/fleet-data";
import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import type { HiveAgent, HiveMachine, HiveMachineKind } from "./fleet-hive-types";

const KNOWN_KINDS: HiveMachineKind[] = ["Desktop", "Cloud Server", "Laptop", "Home Server", "Edge", "Mobile"];

function toMachineKind(kind: string): HiveMachineKind {
  const match = KNOWN_KINDS.find((k) => k.toLowerCase() === kind.trim().toLowerCase());
  if (match) return match;
  // Loose fallbacks for kinds the legacy view sometimes reports differently.
  const lower = kind.trim().toLowerCase();
  if (/mobile|ios|android|phone/.test(lower)) return "Mobile";
  if (/laptop|macbook|notebook/.test(lower)) return "Laptop";
  if (/cloud|server|vps|hetzner|ec2/.test(lower)) return "Cloud Server";
  if (/home|nas|truenas/.test(lower)) return "Home Server";
  if (/edge|pi|arm|drone|probe/.test(lower)) return "Edge";
  return "Desktop";
}

/** Split a combined OS string ("macOS 15.3 · M3 Max") into os + chip. */
function splitOsChip(os: string): { os: string; chip: string } {
  const parts = os.split("·").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { os: parts[0], chip: parts.slice(1).join(" · ") };
  return { os: os.trim(), chip: "" };
}

function hiveAgentIconSrc(agent: FleetAgent): string {
  if (agent.beeRole === "queen") return beeRoleIconPath("queen");
  const customWorkerClass = agent.customWorkerClasses?.find((workerClass) => workerClass.id === agent.selectedCustomWorkerClassId)
    ?? agent.customWorkerClass;
  return customWorkerClass?.imageSrc?.trim()
    || beeRoleIconPath("worker", agent.workerClass ?? "general");
}

export function mapFleetAgent(agent: FleetAgent): HiveAgent {
  return {
    id: agent.id,
    name: agent.name,
    runtime: agent.runtime,
    state: agent.state,
    role: agent.role,
    iconSrc: hiveAgentIconSrc(agent),
    wallet: agent.wallet || "—",
    task: agent.task,
    since: agent.since,
    source: agent,
  };
}

export function mapFleetMachine(machine: FleetMachine): HiveMachine {
  const { os, chip } = splitOsChip(machine.os);
  // Match the legacy view: a device identified as mobile by its OS string gets
  // the Mobile glyph even when its reported kind isn't "Mobile".
  const kind = isFleetMachineMobile(machine) ? "Mobile" : toMachineKind(machine.kind);
  return {
    id: machine.id,
    name: machine.name,
    kind,
    role: machine.role,
    os,
    chip,
    place: machine.location,
    ip: machine.ip,
    ping: machine.ping,
    cpu: machine.cpu,
    ram: machine.ram,
    disk: machine.disk,
    version: machine.version,
    versionState: machine.versionState,
    uptime: machine.uptime,
    agents: machine.agents.map(mapFleetAgent),
    source: machine,
  };
}

/**
 * Map machines, optionally joining in Work-Board-derived delegation health so a
 * box that's silently failing every delegation stops reading as healthy-green.
 * `health` is keyed by machine id (see machine-delegation-health.ts); omit it and
 * the view behaves exactly as before.
 */
export function mapFleetMachines(
  machines: FleetMachine[],
  health?: Map<string, import("./machine-delegation-health").MachineDelegationHealth>,
): HiveMachine[] {
  return machines.map((machine) => {
    const mapped = mapFleetMachine(machine);
    const h = health?.get(machine.id);
    return h ? { ...mapped, health: h } : mapped;
  });
}
