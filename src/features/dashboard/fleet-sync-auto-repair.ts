import type { FleetMachine } from "@/components/fleet/fleet-data";
import { applyActiveAppBadges, type FleetHostedApp } from "@/components/fleet/active-apps";

export const FLEET_SYNC_AUTO_REPAIR_COOLDOWN_MS = 10 * 60 * 1000;
export const FLEET_SYNC_AUTO_REPAIR_QUIET_MS = 2 * 60 * 1000;

export type FleetSyncthingDevice = {
  deviceID: string;
  name?: string;
  completion?: number | null;
  remoteState?: string | null;
  needBytes?: number | null;
  needItems?: number | null;
};

export type FleetSyncPeerHealth = FleetSyncthingDevice & {
  stalled: boolean;
  unchangedMs: number;
};

export type FleetSyncRepairTarget = {
  machine: FleetMachine;
  peer: FleetSyncPeerHealth;
  signature: string;
};

export type FleetSyncAutoRepairState = {
  status: "running" | "failed" | "cooldown";
  machineId: string;
  issueSignature: string;
  lastAttemptAt: number;
  failureCount: number;
  message?: string;
};

function normalizeFleetSyncName(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/\.local$/g, "")
    .replace(/\.[a-z0-9-]+\.ts\.net$/g, "")
    .replace(/\bhivemindos\b/g, "")
    .replace(/\blocal\b/g, "")
    .replace(/\bmacbook\b/g, "macbook")
    .replace(/(?:^|[-_\s])\d+$/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function peerMatchesMachine(peer: FleetSyncPeerHealth, machine: FleetMachine) {
  const peerName = normalizeFleetSyncName(peer.name);
  if (!peerName) return false;
  return [machine.name, machine.tailnet, machine.ip, machine.collectorUrl]
    .map(normalizeFleetSyncName)
    .filter(Boolean)
    .some((candidate) => (
      candidate === peerName
      || candidate.includes(peerName)
      || peerName.includes(candidate)
    ));
}

function issueSignature(peer: FleetSyncPeerHealth) {
  return [
    peer.deviceID,
    peer.completion ?? "",
    peer.needItems ?? "",
    peer.needBytes ?? "",
    peer.remoteState ?? "",
    peer.stalled ? "stalled" : "moving",
  ].join(":");
}

function issueDetail(peer: FleetSyncPeerHealth) {
  const completion = typeof peer.completion === "number" ? `${peer.completion.toFixed(1)}%` : "unknown";
  const pending = typeof peer.needItems === "number" ? `${peer.needItems} pending item${peer.needItems === 1 ? "" : "s"}` : "pending items unknown";
  const bytes = typeof peer.needBytes === "number" && peer.needBytes > 0 ? `, ${Math.ceil(peer.needBytes / 1024)} KB` : "";
  const remoteState = peer.remoteState ? ` Remote state: ${peer.remoteState}.` : "";
  const stalled = peer.stalled ? ` No progress for ${Math.max(1, Math.round(peer.unchangedMs / 60_000))} minutes.` : "";
  return `Shared vault sync is incomplete for ${peer.name || peer.deviceID.slice(0, 7)}: ${completion} synced, ${pending}${bytes}.${remoteState}${stalled}`;
}

export function buildFleetSyncRepairTargets(input: {
  machines: FleetMachine[];
  hostedApps: FleetHostedApp[];
  peers: FleetSyncPeerHealth[];
}): FleetSyncRepairTarget[] {
  const machinesWithApps = applyActiveAppBadges(input.machines, input.hostedApps);
  const assignedSyncPeerIds = new Set<string>();
  return machinesWithApps.flatMap((machine) => {
    if (machine.role === "Primary" || machine.name === "This Mac" || machine.kind === "Setup Target") return [];
    const peer = input.peers.find((candidate) => !assignedSyncPeerIds.has(candidate.deviceID) && peerMatchesMachine(candidate, machine));
    if (!peer) return [];
    assignedSyncPeerIds.add(peer.deviceID);
    return [{ machine, peer, signature: issueSignature(peer) }];
  });
}

export function applyFleetSyncAutoRepairIssues<T extends { machines: FleetMachine[] }>(input: {
  fleetViewData: T;
  hostedApps: FleetHostedApp[];
  targets: FleetSyncRepairTarget[];
  autoRepairByDevice: Record<string, FleetSyncAutoRepairState>;
}): T {
  const machinesWithApps = applyActiveAppBadges(input.fleetViewData.machines, input.hostedApps);
  const syncTargetsByMachine = new Map(input.targets.map((target) => [target.machine.id, target]));
  return {
    ...input.fleetViewData,
    machines: machinesWithApps.map((machine) => {
      const target = syncTargetsByMachine.get(machine.id);
      if (!target) return machine;
      const autoRepair = input.autoRepairByDevice[target.peer.deviceID];
      const autoRepairAge = autoRepair ? Date.now() - autoRepair.lastAttemptAt : Number.POSITIVE_INFINITY;
      const quietAutoRepair = Boolean(autoRepair && autoRepair.issueSignature === target.signature && (
        autoRepair.status === "running"
        || autoRepair.status === "cooldown"
        || autoRepairAge < FLEET_SYNC_AUTO_REPAIR_QUIET_MS
      ));
      if (quietAutoRepair || autoRepair?.status !== "failed" || autoRepair.issueSignature !== target.signature) return machine;
      const peer = target.peer;
      return {
        ...machine,
        syncIssue: {
          label: "Sync repair needs attention",
          title: "Automatic sync repair failed",
          detail: [autoRepair.message, issueDetail(peer)].filter(Boolean).join(" "),
          deviceID: peer.deviceID,
          deviceName: peer.name || peer.deviceID.slice(0, 7),
          completion: peer.completion,
          needItems: peer.needItems,
          needBytes: peer.needBytes,
          remoteState: peer.remoteState,
          stalled: peer.stalled,
        },
      };
    }),
  };
}

export function runFleetSyncAutoRepairs(input: {
  enabled: boolean;
  targets: FleetSyncRepairTarget[];
  autoRepairRef: { current: Record<string, FleetSyncAutoRepairState> };
  updateAutoRepair: (deviceID: string, nextState: FleetSyncAutoRepairState | null) => void;
  repairMachine: (machine: FleetMachine) => Promise<void>;
}) {
  if (!input.enabled) return;
  const now = Date.now();
  const activeDeviceIds = new Set(input.targets.map((target) => target.peer.deviceID));
  for (const [deviceID, state] of Object.entries(input.autoRepairRef.current)) {
    if (!activeDeviceIds.has(deviceID) && state.status !== "running") input.updateAutoRepair(deviceID, null);
  }

  for (const target of input.targets) {
    const deviceID = target.peer.deviceID;
    const current = input.autoRepairRef.current[deviceID];
    if (current?.status === "running") continue;
    const coolingDown = current?.issueSignature === target.signature
      && now - current.lastAttemptAt < FLEET_SYNC_AUTO_REPAIR_COOLDOWN_MS;
    if (coolingDown) continue;

    const failureCount = current?.issueSignature === target.signature ? current.failureCount : 0;
    input.updateAutoRepair(deviceID, {
      status: "running",
      machineId: target.machine.id,
      issueSignature: target.signature,
      lastAttemptAt: now,
      failureCount,
    });

    void input.repairMachine(target.machine)
      .then(() => {
        const latest = input.autoRepairRef.current[deviceID];
        if (!latest || latest.issueSignature !== target.signature) return;
        input.updateAutoRepair(deviceID, {
          status: "cooldown",
          machineId: target.machine.id,
          issueSignature: target.signature,
          lastAttemptAt: Date.now(),
          failureCount: 0,
        });
      })
      .catch((error) => {
        const latest = input.autoRepairRef.current[deviceID];
        if (!latest || latest.issueSignature !== target.signature) return;
        input.updateAutoRepair(deviceID, {
          status: "failed",
          machineId: target.machine.id,
          issueSignature: target.signature,
          lastAttemptAt: Date.now(),
          failureCount: failureCount + 1,
          message: error instanceof Error ? error.message : `Automatic sync repair failed for ${target.machine.name}.`,
        });
      });
  }
}
