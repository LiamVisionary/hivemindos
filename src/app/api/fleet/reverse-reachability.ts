import { machineExactIdentity } from "@/features/fleet/fleet-identity";

// Reverse reachability: every collector's /health reports which tailnet peers
// its env sync could not reach. Aggregating those onto the TARGET machines
// exposes asymmetric partitions the dashboard's own outbound probes miss — a
// machine whose linkd is dead still probes "ready" locally while every peer
// reports it unreachable.

type ReachabilityDevice = {
  name: string;
  dnsName?: string;
  ip?: string;
};

export type ReverseReachabilityMachine = {
  device: ReachabilityDevice;
  envSync?: {
    maintenance?: {
      lastSummary?: {
        pull?: { unreachable?: string[] };
        retry?: { unreachable?: string[] };
      };
    };
  };
  reportedUnreachableBy?: string[];
};

function deviceIdentity(device: ReachabilityDevice) {
  return machineExactIdentity(device.name, device.dnsName);
}

// Identity for a raw tailnet host name as reported in a collector's env-sync
// unreachable list (a bare DNS name, so reuse the dnsName slot).
function hostIdentity(host: string) {
  return machineExactIdentity(undefined, String(host));
}

export function annotateReverseReachability(
  machines: ReverseReachabilityMachine[],
) {
  const byIdentity = new Map<string, ReverseReachabilityMachine>();
  const byIp = new Map<string, ReverseReachabilityMachine>();
  for (const machine of machines) {
    const identity = deviceIdentity(machine.device);
    if (identity && !byIdentity.has(identity)) {
      byIdentity.set(identity, machine);
    }
    if (machine.device.ip && !byIp.has(machine.device.ip)) {
      byIp.set(machine.device.ip, machine);
    }
  }
  for (const machine of machines) {
    machine.reportedUnreachableBy = undefined;
  }
  for (const machine of machines) {
    const summary = machine.envSync?.maintenance?.lastSummary;
    if (!summary) continue;
    const unreachable = [
      ...(summary.pull?.unreachable ?? []),
      ...(summary.retry?.unreachable ?? []),
    ];
    const reporter = machine.device.name || deviceIdentity(machine.device);
    for (const host of unreachable) {
      // Pinned targets can be raw tailnet IPs rather than DNS names.
      const target = /^\d+\.\d+\.\d+\.\d+$/.test(host)
        ? byIp.get(host)
        : byIdentity.get(hostIdentity(host));
      if (!target || target === machine) continue;
      target.reportedUnreachableBy ??= [];
      if (!target.reportedUnreachableBy.includes(reporter)) {
        target.reportedUnreachableBy.push(reporter);
      }
    }
  }
}
