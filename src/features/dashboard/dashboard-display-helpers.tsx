import type { FleetAgent, FleetMachine } from "@/components/fleet";
import { DashboardHiveLoader } from "@/features/dashboard/DashboardHiveLoader";
import type {
  AgentSnapshot,
  AppVersion,
  BrainGraphNode,
  DiscoveredMachine,
  MachineGroup,
} from "@/features/dashboard/dashboard-types";
import {
  isLocalLinkDuplicateOfSelf,
  isLoopbackCollector,
  isMacMachineOs,
  isMobileMachineOs,
  machineExactIdentity,
  machineIdentityFromParts,
  shouldPreserveMissingDiscoveredMachine,
  tailnetSelfIdentityCandidates,
} from "@/features/fleet/fleet-identity";
import type { AgentProfile } from "@/lib/types/agent-runtime";

const REPO_CLONE_URL = "https://github.com/LiamVisionary/hivemindos.git";
const QUIET_SNAPSHOT_HOLD_MS = 15 * 60 * 1000;

export function machineVersionCopy(
  machine: MachineGroup,
  latestCommit?: string,
) {
  const versionState = machineVersionState(machine, latestCommit);
  if (!versionState) return null;
  if (versionState.state === "current")
    return {
      label: "Synced",
      detail: "Latest dashboard tools",
      state: "current",
    };
  if (versionState.state === "stale") {
    return machine.self
      ? {
          label: "Local update ready",
          detail: "New dashboard tools available for this checkout",
          state: "stale",
        }
      : {
          label: "Update ready",
          detail: "New dashboard tools available",
          state: "stale",
        };
  }
  return {
    label: "Refresh setup",
    detail: "Agent bridge needs one update",
    state: "unknown",
  };
}

export function isCollectorAutoUpdateable(
  versionCopy: ReturnType<typeof machineVersionCopy>,
) {
  return Boolean(versionCopy && versionCopy.state !== "current");
}

export function hasNeverHandshake(value?: string) {
  return !value || value.startsWith("0001-01-01");
}

export function tailnetPeerLooksUnreachable(machine: MachineGroup) {
  return (
    !machine.self &&
    machine.online &&
    hasNeverHandshake(machine.lastHandshake) &&
    (machine.rxBytes ?? 0) === 0 &&
    !machine.collectorUrl
  );
}

export function tailnetPeerTrafficLooksStalled(machine: MachineGroup) {
  return (
    !machine.self &&
    machine.online &&
    hasNeverHandshake(machine.lastHandshake) &&
    (machine.rxBytes ?? 0) === 0 &&
    (!machine.curAddr || machine.curAddr.trim() === "")
  );
}

function isWindowsOs(os?: string): boolean {
  return /^(windows|win32)$/i.test(os ?? "");
}

// Self/this-machine device noun, mirroring displayMachineName's OS mapping
// (windows/win32 -> "PC", linux -> "computer", else "Mac") so recovery copy
// shown to a Windows or Linux user never calls their own box a "Mac".
function deviceNounForOs(os?: string): string {
  const value = (os ?? "").toLowerCase();
  if (value === "windows" || value === "win32") return "PC";
  if (value === "linux") return "computer";
  return "Mac";
}

// Per-OS commands to repair / re-run setup for a machine's agent bridge.
// Mac/Linux re-run the collector install script. Windows has no
// install-telemetry-collector.ps1 yet, so it re-runs setup.ps1 (the closest
// available Windows setup path); note setup.ps1 does not yet auto-install the
// collector daemon on Windows — that path is still a follow-up.
function agentBridgeRepairCommands(machine: MachineGroup): string[] {
  if (isWindowsOs(machine.os)) {
    return [
      "cd $env:USERPROFILE\\hivemindos",
      "git pull --ff-only",
      "powershell -ExecutionPolicy Bypass -File setup.ps1 -SkipDashboard -SkipBuild",
    ];
  }
  return [
    "cd ~/hivemindos",
    "git pull --ff-only",
    "./scripts/install-telemetry-collector.sh",
  ];
}

function tailscaleRestartCommands(os?: string): string[] {
  if (isWindowsOs(os)) {
    return [
      "tailscale status --self",
      "tailscale netcheck",
      "# Open the Tailscale app from the system tray, or restart the transport:",
      "tailscale down",
      "tailscale up",
    ];
  }
  return [
    "tailscale status --self",
    "tailscale netcheck",
    "open -a Tailscale",
    "",
    "# If the GUI still shows connected but peers time out",
    "tailscale down",
    "tailscale up",
  ];
}

function collectorHealthCommand(machine: MachineGroup) {
  const collectorUrl = machine.collectorUrl?.replace(/\/+$/, "");
  if (collectorUrl) return `curl --max-time 5 '${collectorUrl}/health'`;
  if (machine.self)
    return isWindowsOs(machine.os)
      ? 'curl.exe --max-time 5 "http://127.0.0.1:8787/health"'
      : 'source ~/.hivemindos/collector.env && curl --max-time 5 "http://127.0.0.1:${AGENT_TELEMETRY_PORT}/health"';
  return "# No verified collector URL yet; run the collector health command on the target machine after sourcing ~/.hivemindos/collector.env";
}

export function machineNetworkIssue(
  machine: MachineGroup,
  tailscaleStatus: string,
): FleetMachine["networkIssue"] {
  if (machine.key === "unassigned") return undefined;
  if (
    /^(ios|android)$/i.test(machine.os ?? "") &&
    machine.collector !== "ready"
  )
    return undefined;
  // Self branches describe THIS machine, so its noun follows machine.os.
  const selfNoun = deviceNounForOs(machine.os);
  if (machine.self && tailscaleStatus.includes("peer traffic stalled")) {
    return {
      label: "Tailscale traffic stalled. Fix?",
      title: "Tailscale peer traffic is stalled",
      detail: `Tailscale is signed in and has the Tailnet route, but this ${selfNoun} is not receiving peer traffic. Restart or reconnect Tailscale on this ${selfNoun} before reinstalling any agent bridges.`,
      fixAction: "restart-local-tailnet",
      fixLabel: "Fix Tailnet now",
      commands: tailscaleRestartCommands(machine.os),
    };
  }
  if (machine.self && tailscaleStatus.startsWith("Tailscale not configured")) {
    return {
      label: "Tailscale not configured. Fix?",
      title: "Tailscale is not configured",
      detail:
        "This dashboard is running locally. That is fine for single-machine use, but Fleet discovery, Hivemind Sync, remote updates, and shared-brain pairing need this machine signed in to Tailscale or connected through Hivemind Link.",
      commands: isWindowsOs(machine.os)
        ? [
            "# Windows: install Tailscale, then sign in",
            "# Download from https://tailscale.com/download/windows",
            "tailscale up",
          ]
        : [
            "# macOS GUI/VPN only",
            "brew install --cask tailscale",
            "open -a Tailscale",
            "",
            "# macOS Tailscale SSH host",
            "brew install --formula tailscale",
            "sudo brew services start tailscale",
            "sudo /opt/homebrew/opt/tailscale/bin/tailscale up",
            "sudo /opt/homebrew/opt/tailscale/bin/tailscale set --ssh",
            "",
            "# Linux",
            "curl -fsSL https://tailscale.com/install.sh | sh",
            "sudo tailscale up",
            "sudo tailscale set --ssh",
          ],
    };
  }
  if (machine.collector === "unknown") return undefined;
  if (!machine.online && machine.collector !== "ready") {
    return {
      label: "Tailscale disconnected. Fix?",
      title: "Machine is offline in Tailscale",
      detail:
        "This machine is known to the Tailnet but is not online, so HivemindOS cannot reach its agent bridge or update it remotely.",
      commands: [
        "tailscale status",
        ...(isWindowsOs(machine.os) ? ["tailscale up"] : ["sudo tailscale up"]),
        ...agentBridgeRepairCommands(machine),
      ],
    };
  }
  if (machine.collector !== "ready") {
    if (machine.self) {
      return {
        label: "Agent bridge not reachable. Fix?",
        title: "Local agent bridge is not reachable",
        detail: `This dashboard cannot reach the local agent bridge on this ${selfNoun} at its configured collector URL. Start or reinstall the local agent bridge, then refresh Fleet.`,
        commands: [
          `# On this ${selfNoun}`,
          ...agentBridgeRepairCommands(machine),
          collectorHealthCommand(machine),
        ],
      };
    }
    if (tailnetPeerLooksUnreachable(machine)) {
      const tailnetTarget = machine.dnsName || machine.ip || "<tailnet-ip>";
      return {
        label: "Tailnet unreachable. Fix?",
        title: "Tailnet peer is not reachable",
        detail:
          "Tailscale lists this machine as online, but this dashboard has never completed a peer handshake with it. Restart or reconnect Tailscale on both machines before reinstalling the agent bridge.",
        commands: [
          "# From this dashboard machine",
          `tailscale ping ${tailnetTarget}`,
          "",
          "# On the other machine",
          "tailscale status",
          isWindowsOs(machine.os)
          ? "tailscale debug prefs | Select-String ShieldsUp"
          : "tailscale debug prefs | grep ShieldsUp",
          "tailscale set --shields-up=false",
          ...(isWindowsOs(machine.os)
            ? ["tailscale down", "tailscale up"]
            : ["sudo tailscale down", "sudo tailscale up"]),
          "",
          "# Then retry from this dashboard machine",
          collectorHealthCommand(machine),
        ],
      };
    }
    if (tailnetPeerTrafficLooksStalled(machine)) {
      const tailnetTarget = machine.dnsName || machine.ip || "<tailnet-ip>";
      return {
        label: "Tailnet traffic stalled. Fix?",
        title: "Tailnet peer traffic is stalled",
        detail:
          "Tailscale lists this machine as online, but this dashboard has no peer receive traffic or current handshake for it. Fix the Tailscale transport first; reinstalling the agent bridge will not help until Tailnet traffic works again.",
        fixAction: "restart-local-tailnet",
        fixLabel: "Fix Tailnet now",
        commands: [
          "# From this dashboard machine",
          `tailscale ping ${tailnetTarget}`,
          "tailscale netcheck",
          "",
          "# If peers still time out, restart the Tailscale transport",
          "tailscale down",
          "tailscale up",
          "",
          "# Then retry the agent bridge",
          collectorHealthCommand(machine),
        ],
      };
    }
    const tailnetTarget = machine.dnsName || machine.ip || "<tailnet-ip>";
    return {
      label: "Agent bridge not reachable. Fix?",
      title: "Agent bridge is not reachable",
      detail:
        "Tailscale lists this machine, but this dashboard cannot reach a verified HivemindOS agent bridge for it. The automatic fix restarts local Tailnet connectivity on this dashboard machine only. If the bridge is still unreachable after that, run the remote-machine commands below for Shields Up, service install, or firewall repair.",
      fixAction: "restart-local-tailnet",
      fixLabel: "Restart local Tailnet",
      commands: [
        "# From this dashboard machine",
        `tailscale ping ${tailnetTarget}`,
        collectorHealthCommand(machine),
        "",
        "# On the other machine",
        "tailscale status",
        isWindowsOs(machine.os)
          ? "tailscale debug prefs | Select-String ShieldsUp"
          : "tailscale debug prefs | grep ShieldsUp",
        "tailscale set --shields-up=false",
        ...(isWindowsOs(machine.os) ? ["tailscale up"] : ["sudo tailscale up"]),
        ...agentBridgeRepairCommands(machine),
        collectorHealthCommand(machine),
        ...(isWindowsOs(machine.os)
          ? []
          : [
              'curl "http://${HIVE_LINK_CONTROL:-127.0.0.1:8788}/status"',
              "lsof -nP -iTCP:${AGENT_TELEMETRY_PORT} -sTCP:LISTEN",
              "",
              "# If local health works but remote curl times out on macOS (collector inbound firewall)",
              'sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$(command -v node)"',
              'sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$(command -v node)"',
            ]),
      ],
    };
  }
  if (
    machine.online &&
    machine.collector === "ready" &&
    (machine.reportedUnreachableBy?.length ?? 0) > 0
  ) {
    const reporters = (machine.reportedUnreachableBy ?? []).join(", ");
    const noun = deviceNounForOs(machine.os);
    return {
      label: "Peers can't reach this machine. Fix?",
      title: "Fleet peers report this machine unreachable",
      detail: `This dashboard reaches the machine, but ${reporters} report${(machine.reportedUnreachableBy?.length ?? 0) === 1 ? "s" : ""} it unreachable over the Tailnet — usually a dead or logged-out hivemind-linkd on this ${noun}, which makes the machine invisible to the rest of the fleet while looking healthy locally.`,
      commands: [
        `# On this ${noun}`,
        'curl "http://${HIVE_LINK_CONTROL:-127.0.0.1:8788}/health"',
        ...(isWindowsOs(machine.os)
          ? []
          : machine.os && !isMacMachineOs(machine.os)
            ? ["systemctl --user restart hivemindos-linkd.service"]
            : [
                'launchctl kickstart -k "gui/$(id -u)/com.hivemindos.linkd.agent"',
                "# If the agent is not loaded at all:",
                'launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.hivemindos.linkd.agent.plist',
              ]),
        "# If linkd reports authNeeded, follow its authUrl or rerun:",
        "cd ~/hivemindos && HIVE_LINK_ENABLED=true ./scripts/install-telemetry-collector.sh",
      ],
    };
  }
  if (machine.envSync && machine.envSync.ready === false) {
    return {
      label: "Hivemind Sync env not ready. Fix?",
      title: "Hivemind Sync env is not ready",
      detail:
        machine.envSync.error ||
        "The local agent bridge is online, but it does not report a working hive-env-add command for env reconciliation.",
      commands: isWindowsOs(machine.os)
        ? [
            "cd $env:USERPROFILE\\hivemindos",
            "powershell -ExecutionPolicy Bypass -File setup.ps1 -SkipDashboard -SkipBuild",
            "hive-env-add --reconcile",
          ]
        : [
            "cd ~/hivemindos",
            "./setup.sh",
            "sudo tailscale set --ssh",
            "hive-env-add --reconcile",
          ],
    };
  }
  return undefined;
}

export function machineNeedsChatBridgeRepair(machine: MachineGroup) {
  return machine.collector === "ready" && machine.capabilities?.chat === false;
}

export function machineNeedsEnvHttpSyncRepair(machine: MachineGroup) {
  return (
    machine.collector === "ready" && machine.capabilities?.envHttpSync !== true
  );
}

export function machineNeedsSkillSyncRepair(machine: MachineGroup) {
  return (
    machine.collector === "ready" &&
    (machine.capabilities?.skillInventory !== true ||
      machine.capabilities?.skillAutoSync !== true)
  );
}

export function localDashboardHasUnpublishedChanges(
  version?: AppVersion | null,
) {
  if (!version) return false;
  if (version.dirty) return true;
  return Boolean(
    version.commit &&
    version.latestCommit &&
    version.commit !== version.latestCommit,
  );
}

export function friendlyEmptyTitle(
  snapshot: AgentSnapshot | undefined,
  hasTelemetryUrl: boolean,
) {
  if (!hasTelemetryUrl) return "Waiting for an agent bridge";
  if (snapshot?.warning?.startsWith("Runtime files are not available"))
    return "Limited history visibility";
  if (snapshot?.summary?.startsWith("Remote agent bridge unavailable"))
    return "Machine is temporarily unreachable";
  if (snapshot?.processRunning) return "Agent is running";
  return "Waiting for new work";
}

export function shouldKeepSnapshot(
  previous: AgentSnapshot | undefined,
  incoming: AgentSnapshot,
) {
  if (!previous?.tasks?.length || incoming.tasks.length > 0 || incoming.error)
    return false;
  if (!incoming.ok || !incoming.runtimeReachable) return false;
  const newestPreviousTask = Math.max(
    ...previous.tasks.map((task) => task.updatedAt || previous.checkedAt || 0),
  );
  return Date.now() - newestPreviousTask < QUIET_SNAPSHOT_HOLD_MS;
}

export function mergeSnapshot(
  previous: AgentSnapshot | undefined,
  incoming: AgentSnapshot,
) {
  if (!shouldKeepSnapshot(previous, incoming)) return incoming;
  if (!previous) return incoming;
  return {
    ...incoming,
    summary: previous.summary,
    sources: [
      ...new Set([...incoming.sources, ...previous.sources, "recent activity"]),
    ],
    tasks: previous.tasks,
    checkedAt: incoming.checkedAt,
  };
}

export function mergeSnapshotRecord(
  current: Record<string, AgentSnapshot>,
  incoming: AgentSnapshot[],
) {
  const next = { ...current };
  for (const snapshot of incoming) {
    next[snapshot.agentId] = mergeSnapshot(current[snapshot.agentId], snapshot);
  }
  return next;
}

export function mergeMachineSnapshots(
  previous: AgentSnapshot[] = [],
  incoming: AgentSnapshot[] = [],
) {
  const previousById = new Map(
    previous.map((snapshot) => [snapshot.agentId, snapshot]),
  );
  return incoming.map((snapshot) =>
    mergeSnapshot(previousById.get(snapshot.agentId), snapshot),
  );
}

export function discoveredMachineIdentity(machine: DiscoveredMachine) {
  const machineId =
    machine.collector === "ready"
      ? machine.machineId?.trim().toLowerCase()
      : "";
  if (machineId && /^hivemind-machine-[a-f0-9]{32}$/.test(machineId))
    return machineId;
  return machineIdentityFromParts({
    self: machine.device.self,
    name: machine.device.name,
    dnsName: machine.device.dnsName,
    collectorUrl: machine.device.collectorUrl,
    ip: machine.device.ip,
  });
}

function discoveredMachineTransportIdentity(machine: DiscoveredMachine) {
  return machineIdentityFromParts({
    self: machine.device.self,
    name: machine.device.name,
    dnsName: machine.device.dnsName,
    collectorUrl: machine.device.collectorUrl,
    ip: machine.device.ip,
  });
}

function isDeviceOnlyDiscovery(machine: DiscoveredMachine) {
  return (
    machine.collector === "unknown" &&
    machine.agents.length === 0 &&
    machine.snapshots.length === 0 &&
    !machine.machineId &&
    !machine.version &&
    !machine.capabilities &&
    !machine.envSync &&
    !machine.system
  );
}

function mergeTransportDevice(
  previous: DiscoveredMachine["device"],
  incoming: DiscoveredMachine["device"],
): DiscoveredMachine["device"] {
  return {
    ...previous,
    ...incoming,
    collectorUrl: previous.collectorUrl || incoming.collectorUrl,
  };
}

export function discoveredMachineScore(machine: DiscoveredMachine) {
  return (
    (machine.device.self ? 10_000 : 0) +
    (machine.collector === "ready" ? 1_000 : 0) +
    machine.agents.length * 10 +
    (machine.device.online ? 5 : 0) +
    (machine.lastSeenAt ? 1 : 0)
  );
}

function machineBaseCandidates(machine: DiscoveredMachine) {
  // Exact identity only (keeps tailscale's `-N` suffix): a `-1` node is a
  // different physical machine with the same hostname, not a duplicate. A
  // ready collector additionally claims its self-reported system tailnet
  // node (dnsName-only, see tailnetSelfIdentityCandidates), so a machine
  // preserved from before a hostname rename still folds instead of living
  // on as an offline ghost.
  const identity = machineExactIdentity(
    machine.device.name,
    machine.device.dnsName,
  );
  return [
    ...(identity ? [identity] : []),
    ...tailnetSelfIdentityCandidates(machine.tailnetSelf),
  ];
}

function hasFreshReadyDuplicate(
  machine: DiscoveredMachine,
  readyMachineBases: Set<string>,
) {
  if (machine.collector === "ready") return false;
  return machineBaseCandidates(machine).some((base) =>
    readyMachineBases.has(base),
  );
}

export function dedupeDiscoveredMachines(machines: DiscoveredMachine[]) {
  const readyMachineBases = new Set(
    machines
      .filter((machine) => machine.collector === "ready")
      .flatMap(machineBaseCandidates),
  );
  const byIdentity = new Map<string, DiscoveredMachine>();
  for (const machine of machines) {
    if (hasFreshReadyDuplicate(machine, readyMachineBases)) continue;
    const key = discoveredMachineIdentity(machine);
    const previous = byIdentity.get(key);
    if (!previous) {
      byIdentity.set(key, machine);
      continue;
    }
    const preferred =
      discoveredMachineScore(machine) > discoveredMachineScore(previous)
        ? machine
        : previous;
    const agents = [...previous.agents, ...machine.agents].filter(
      (agent, index, all) =>
        all.findIndex((item) => item.id === agent.id) === index,
    );
    const snapshots = mergeMachineSnapshots(
      previous.snapshots,
      machine.snapshots,
    );
    byIdentity.set(key, { ...preferred, agents, snapshots });
  }
  return [...byIdentity.values()];
}

// Queen is dashboard-owned: never accept a queen claim from discovery (old
// fleet collectors still self-declare their OpenClaw as one). Local twin of
// dashboard-storage's sanitizeDiscoveredAgentRoles — this module region runs
// standalone in the hermetic fleet-discovery-merge suite, so no cross-module
// call is possible here; keep both in sync.
function demoteDiscoveredQueenClaims(machines: DiscoveredMachine[]): DiscoveredMachine[] {
  return machines.map((machine) => (
    machine.agents?.some((agent) => agent.beeRole === "queen")
      ? {
        ...machine,
        agents: machine.agents.map((agent) => (agent.beeRole === "queen" ? { ...agent, beeRole: "worker" as const } : agent)),
      }
      : machine
  ));
}

export function mergeDiscoveredMachines(
  current: DiscoveredMachine[],
  rawIncoming: DiscoveredMachine[],
) {
  const incoming = demoteDiscoveredQueenClaims(rawIncoming);
  const currentByKey = new Map(
    current.map((machine) => [discoveredMachineIdentity(machine), machine]),
  );
  const currentByTransportIdentity = new Map<string, DiscoveredMachine>();
  for (const machine of current) {
    const key = discoveredMachineTransportIdentity(machine);
    if (!key) continue;
    const previous = currentByTransportIdentity.get(key);
    if (
      !previous ||
      discoveredMachineScore(machine) > discoveredMachineScore(previous)
    ) {
      currentByTransportIdentity.set(key, machine);
    }
  }
  const incomingKeys = new Set(
    incoming.map((machine) => discoveredMachineIdentity(machine)),
  );
  const incomingTransportIdentities = new Set(
    incoming
      .map((machine) => discoveredMachineTransportIdentity(machine))
      .filter(Boolean),
  );
  const incomingHasTailnetSelf = incoming.some(
    (machine) =>
      machine.device.self && !isLoopbackCollector(machine.device.collectorUrl),
  );
  const incomingSelf = incoming.find((machine) => machine.device.self)?.device;
  const incomingReadyMachineBases = new Set(
    incoming
      .filter((machine) => machine.collector === "ready")
      .flatMap(machineBaseCandidates),
  );
  const now = Date.now();

  const merged = incoming.map((machine) => {
    const key = discoveredMachineIdentity(machine);
    const transportKey = discoveredMachineTransportIdentity(machine);
    const previousByKey = currentByKey.get(key);
    const previousByTransport = transportKey
      ? currentByTransportIdentity.get(transportKey)
      : undefined;
    const previous = previousByKey ?? previousByTransport;
    const hasFreshAgentData =
      machine.collector === "ready" && machine.agents.length > 0;
    const mergedSnapshots = mergeMachineSnapshots(
      previous?.snapshots,
      machine.snapshots,
    );
    const hasFreshSnapshots = mergedSnapshots.length > 0;

    if (!previous || hasFreshAgentData || hasFreshSnapshots) {
      return {
        ...machine,
        snapshots: mergedSnapshots,
        lastSeenAt:
          hasFreshAgentData || hasFreshSnapshots ? now : previous?.lastSeenAt,
      };
    }

    if (previous.agents.length === 0 && previous.snapshots.length === 0) {
      return { ...machine, lastSeenAt: previous.lastSeenAt };
    }

    if (!previousByKey && previousByTransport && isDeviceOnlyDiscovery(machine)) {
      return {
        ...previous,
        device: mergeTransportDevice(previous.device, machine.device),
        lastSeenAt: previous.lastSeenAt,
      };
    }

    return {
      ...machine,
      collector:
        previousByKey && previous.collector === "ready"
          ? "ready"
          : machine.collector,
      agents: previous.agents,
      snapshots: previous.snapshots,
      lastSeenAt: previous.lastSeenAt,
    };
  });

  const preserved = current
    .filter((machine) => !incomingKeys.has(discoveredMachineIdentity(machine)))
    .filter(
      (machine) =>
        !incomingTransportIdentities.has(
          discoveredMachineTransportIdentity(machine),
        ),
    )
    .filter(shouldPreserveMissingDiscoveredMachine)
    .filter(
      (machine) =>
        !(
          incomingHasTailnetSelf &&
          machine.device.self &&
          isLoopbackCollector(machine.device.collectorUrl)
        ),
    )
    .filter(
      (machine) => !isLocalLinkDuplicateOfSelf(incomingSelf, machine.device),
    )
    .filter(
      (machine) => !hasFreshReadyDuplicate(machine, incomingReadyMachineBases),
    )
    .map((machine) => ({
      ...machine,
      device: machine.device.self
        ? machine.device
        : { ...machine.device, online: false },
      collector: machine.device.self
        ? machine.collector
        : ("offline" as MachineGroup["collector"]),
    }));

  return dedupeDiscoveredMachines([...merged, ...preserved]);
}

// Collapse duplicate MachineGroup rows for the same physical machine (system
// tailscale node + embedded linkd node, or a re-registered device) into one,
// preferring the row with the richest signal and unioning agents.
export function dedupeMachineGroups(items: MachineGroup[]) {
  const byIdentity = new Map<string, MachineGroup>();
  const score = (machine: MachineGroup) =>
    (machine.self ? 10_000 : 0) +
    (machine.collector === "ready" ? 1_000 : 0) +
    machine.agents.length * 10 +
    (machine.online ? 5 : 0);
  const stableMachineId = (item: MachineGroup) => {
    const machineId =
      item.collector === "ready"
        ? (item.machineId?.trim().toLowerCase() ?? "")
        : "";
    return /^hivemind-machine-[a-f0-9]{32}$/.test(machineId) ? machineId : "";
  };
  // Bridge machineId keys to name-identity keys: a bare tailscale device
  // (no collector probe, so no machineId) must still merge with the
  // discovered copy of the same machine, which is keyed by machineId.
  // Identities claimed by more than one machineId are ambiguous (distinct
  // physical machines whose names collide after -N stripping), so leave
  // those unbridged rather than merging a shadow into the wrong machine.
  const machineIdByNameIdentity = new Map<string, string>();
  for (const item of items) {
    const machineId = stableMachineId(item);
    if (!machineId) continue;
    // Register the exact name identity alongside machineIdentityFromParts:
    // the self machine resolves to "self" there, but its own embedded link
    // node can show up as a separate tailnet device whose only handle is
    // the exact identity ("liamsmacbookpro") — without this entry that
    // shadow never bridges to the real machine.
    const identities = new Set(
      [
        machineIdentityFromParts(item),
        machineExactIdentity(item.name, item.dnsName),
      ].filter(Boolean),
    );
    for (const nameIdentity of identities) {
      const claimed = machineIdByNameIdentity.get(nameIdentity);
      machineIdByNameIdentity.set(
        nameIdentity,
        claimed && claimed !== machineId ? "" : machineId,
      );
    }
  }
  for (const item of items) {
    const nameIdentity = machineIdentityFromParts(item);
    const key =
      stableMachineId(item) ||
      machineIdByNameIdentity.get(nameIdentity) ||
      nameIdentity;
    const previous = byIdentity.get(key);
    if (!previous) {
      byIdentity.set(key, item);
      continue;
    }
    const preferred = score(item) > score(previous) ? item : previous;
    const agents = [...previous.agents, ...item.agents].filter(
      (agent, index, all) =>
        all.findIndex((candidate) => candidate.id === agent.id) === index,
    );
    byIdentity.set(key, { ...preferred, agents });
  }
  return [...byIdentity.values()];
}

// A rename-orphaned system tailnet node — e.g. the NYC MacBook whose system
// node shares the "Liam's MacBook Pro" ComputerName with This Mac, so tailscale
// suffixes it "-1" while its embedded link node re-registered under a distinct
// name — shows up in `tailscaleDevices` as its own bridge-less device. Its real
// collector reports that system node as `tailnetSelf`, so fleet discovery folds
// the two into one DiscoveredMachine. But the fleet view rebuilds MachineGroups
// straight from `tailscaleDevices`, which carries no `tailnetSelf`, so the orphan
// resurfaces as an empty "pending" ghost machine. These two helpers fold it at
// the group layer too, reusing the tailnetSelf claims the ready collectors
// already reported through discovery (mirrors dedupeDiscoveredMachines).
export function readyTailnetSelfShadowBases(
  discoveredMachines: DiscoveredMachine[],
): Set<string> {
  const bases = new Set<string>();
  for (const machine of discoveredMachines) {
    if (machine.collector !== "ready") continue;
    // A collector only ever claims its OWN system node. Excluding its own device
    // identity keeps a machine whose system node shares its name (This Mac:
    // tailnetSelf resolves to This Mac's own identity) from folding itself away.
    const own = machineExactIdentity(
      machine.device.name,
      machine.device.dnsName,
    );
    for (const base of tailnetSelfIdentityCandidates(machine.tailnetSelf)) {
      if (base && base !== own) bases.add(base);
    }
  }
  return bases;
}

export function isTailnetSelfShadowGroup(
  group: MachineGroup,
  shadowBases: Set<string>,
): boolean {
  // Never fold self, nor a machine that answered as a ready collector — only a
  // bridge-less duplicate a ready collector claims as its own system node.
  if (group.self || group.collector === "ready" || shadowBases.size === 0)
    return false;
  const identity = machineExactIdentity(group.name, group.dnsName ?? "");
  return Boolean(identity) && shadowBases.has(identity);
}

export function machineVersionState(
  machine: MachineGroup,
  latestCommit?: string,
) {
  if (machine.key === "unassigned" || machine.collector !== "ready")
    return null;
  const version = machine.version;
  const commit = version?.commit;
  const target = latestCommit || version?.latestCommit;
  if (!commit)
    return {
      state: "unknown",
      label: "Update agent bridge",
      detail:
        "This machine has an older local agent bridge that does not report its version yet.",
    };
  if (target && commit !== target)
    return {
      state: "stale",
      label: "Update available",
      detail: `${version?.shortCommit ?? commit.slice(0, 7)} -> ${version?.latestShortCommit ?? target.slice(0, 7)}`,
    };
  if (version?.dirty)
    return {
      state: "current",
      label: "Up to date",
      detail: `Running ${version.shortCommit ?? commit.slice(0, 7)} with local changes present.`,
    };
  return {
    state: "current",
    label: "Up to date",
    detail: version?.shortCommit ?? commit.slice(0, 7),
  };
}

export function setupCollectorCommand(os?: string) {
  if (isWindowsOs(os)) {
    return [
      `if (-not (Test-Path hivemindos)) { git clone ${REPO_CLONE_URL} hivemindos }`,
      "cd hivemindos",
      "git pull --ff-only",
      "powershell -ExecutionPolicy Bypass -File setup.ps1",
    ].join("\n");
  }
  return [
    `git clone ${REPO_CLONE_URL} hivemindos 2>/dev/null || true`,
    "cd hivemindos",
    "git pull --ff-only",
    "./setup.sh",
  ].join("\n");
}

export function formatBrainDate(value?: string) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function brainNodePoints(cx: number, cy: number, radius: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index + Math.PI / 6;
    return `${formatBrainSvgNumber(cx + Math.cos(angle) * radius)},${formatBrainSvgNumber(cy + Math.sin(angle) * radius)}`;
  }).join(" ");
}

export function splitBrainLabel(label: string): string[] {
  const compact = label.replace(/\.md$/, "");
  if (compact.length <= 13) return [compact];
  const first = compact.slice(0, 13);
  const second = compact.slice(13, 25);
  return [
    first,
    second ? `${second}${compact.length > 25 ? "..." : ""}` : "",
  ].filter(Boolean);
}

export const BRAIN_LOADER_RADIUS = 20;
export const BRAIN_LOADER_CENTER = { x: 64, y: 64 };
export const BRAIN_LOADER_COORDS: BrainHexCoord[] = [
  { q: 0, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
];

export function brainLoaderCenter(coord: BrainHexCoord): BrainPoint {
  return {
    x:
      BRAIN_LOADER_CENTER.x +
      Math.sqrt(3) * BRAIN_LOADER_RADIUS * (coord.q + coord.r / 2),
    y: BRAIN_LOADER_CENTER.y + 1.5 * BRAIN_LOADER_RADIUS * coord.r,
  };
}

export function brainLoaderEdgeLines() {
  const points = new Map<string, BrainPoint>();
  const edgeKeys = new Set<string>();

  for (const coord of BRAIN_LOADER_COORDS) {
    const center = brainLoaderCenter(coord);
    const vertices = Array.from({ length: 6 }, (_, index) =>
      brainHexVertex(center, BRAIN_LOADER_RADIUS, index),
    );
    vertices.forEach((vertex, index) => {
      const next = vertices[(index + 1) % vertices.length];
      const aKey = brainPointKey(vertex);
      const bKey = brainPointKey(next);
      points.set(aKey, vertex);
      points.set(bKey, next);
      edgeKeys.add([aKey, bKey].sort().join("|"));
    });
  }

  return Array.from(edgeKeys).map((key) => {
    const [aKey, bKey] = key.split("|");
    return { key, a: points.get(aKey)!, b: points.get(bKey)! };
  });
}

export const BRAIN_LOADER_EDGES = brainLoaderEdgeLines();

export function BrainGraphLoader({
  compact = true,
  detail = "Reading vault notes and link edges",
  inline = false,
  title = "Mapping shared brain",
}: {
  compact?: boolean;
  detail?: string;
  inline?: boolean;
  title?: string;
}) {
  return (
    <DashboardHiveLoader
      compact={compact}
      detail={detail}
      inline={inline}
      title={title}
    />
  );
}

export type BrainHexCoord = { q: number; r: number };
export type BrainPoint = { x: number; y: number };

export function brainHexVertex(
  center: BrainPoint,
  radius: number,
  index: number,
): BrainPoint {
  const angle = (Math.PI / 3) * index + Math.PI / 6;
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

export function brainPointKey(point: BrainPoint) {
  return `${Math.round(point.x * 1000) / 1000},${Math.round(point.y * 1000) / 1000}`;
}

export function formatBrainSvgNumber(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function brainGraphEdgePath(
  source: BrainHexCoord,
  target: BrainHexCoord,
  positions: Map<string, BrainPoint>,
  radius: number,
) {
  const sourceCenter = positions.get(`${source.q},${source.r}`);
  const targetCenter = positions.get(`${target.q},${target.r}`);
  if (!sourceCenter || !targetCenter) return "";

  const points = new Map<string, BrainPoint>();
  const edges = new Map<string, Set<string>>();
  const addEdge = (a: BrainPoint, b: BrainPoint) => {
    const aKey = brainPointKey(a);
    const bKey = brainPointKey(b);
    points.set(aKey, a);
    points.set(bKey, b);
    edges.set(aKey, edges.get(aKey) ?? new Set<string>());
    edges.set(bKey, edges.get(bKey) ?? new Set<string>());
    edges.get(aKey)!.add(bKey);
    edges.get(bKey)!.add(aKey);
  };

  for (const center of positions.values()) {
    const vertices = Array.from({ length: 6 }, (_, index) =>
      brainHexVertex(center, radius, index),
    );
    vertices.forEach((vertex, index) =>
      addEdge(vertex, vertices[(index + 1) % vertices.length]),
    );
  }

  const sourceKeys = Array.from({ length: 6 }, (_, index) =>
    brainPointKey(brainHexVertex(sourceCenter, radius, index)),
  );
  const targetKeys = new Set(
    Array.from({ length: 6 }, (_, index) =>
      brainPointKey(brainHexVertex(targetCenter, radius, index)),
    ),
  );
  const preferredSource = sourceKeys
    .map((key) => ({ key, point: points.get(key)! }))
    .sort(
      (a, b) =>
        Math.hypot(a.point.x - targetCenter.x, a.point.y - targetCenter.y) -
        Math.hypot(b.point.x - targetCenter.x, b.point.y - targetCenter.y),
    )
    .map((entry) => entry.key);

  const queue = [...preferredSource];
  const previous = new Map<string, string | null>(
    preferredSource.map((key) => [key, null]),
  );
  let found = "";

  while (queue.length && !found) {
    const current = queue.shift()!;
    if (targetKeys.has(current)) {
      found = current;
      break;
    }
    for (const next of edges.get(current) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }

  if (!found) return "";
  const pathKeys: string[] = [];
  for (
    let current: string | null = found;
    current;
    current = previous.get(current) ?? null
  ) {
    pathKeys.unshift(current);
  }
  return pathKeys
    .map((key, index) => {
      const point = points.get(key)!;
      return `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`;
    })
    .join(" ");
}

export function brainGraphLayout(nodes: BrainGraphNode[]) {
  const radius = 66;
  const stepX = Math.sqrt(3) * radius;
  const stepY = 1.5 * radius;
  const centerX = 560;
  const centerY = 420;
  const positions = new Map<string, { x: number; y: number }>();
  const coordsByNode = new Map<string, BrainHexCoord>();
  const positionsByCoord = new Map<string, { x: number; y: number }>();
  const coords: Array<{ q: number; r: number }> = [{ q: 0, r: 0 }];
  const directions = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];

  for (let ring = 1; coords.length < nodes.length; ring += 1) {
    let q = -ring;
    let r = ring;
    for (const direction of directions) {
      for (
        let side = 0;
        side < ring && coords.length < nodes.length;
        side += 1
      ) {
        coords.push({ q, r });
        q += direction.q;
        r += direction.r;
      }
    }
  }

  nodes.forEach((node, index) => {
    const coord = coords[index] ?? { q: 0, r: 0 };
    const position = {
      x: centerX + stepX * (coord.q + coord.r / 2),
      y: centerY + stepY * coord.r,
    };
    positions.set(node.id, position);
    coordsByNode.set(node.id, coord);
    positionsByCoord.set(`${coord.q},${coord.r}`, position);
  });

  return {
    positions,
    coordsByNode,
    positionsByCoord,
    radius,
    width: 1120,
    height: 840,
  };
}

export function fleetHash(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

export function fleetMetric(seed: string, min: number, max: number) {
  return min + (fleetHash(seed) % (max - min + 1));
}

export type FleetLocation = {
  location: string;
  city: string;
  lat: number;
  lon: number;
};

export const TIMEZONE_LOCATIONS: Record<string, FleetLocation> = {
  "Asia/Makassar": {
    location: "Local timezone",
    city: "Makassar",
    lat: -5.1477,
    lon: 119.4327,
  },
  "Asia/Singapore": {
    location: "Local timezone",
    city: "Singapore",
    lat: 1.3521,
    lon: 103.8198,
  },
  "Asia/Jakarta": {
    location: "Local timezone",
    city: "Jakarta",
    lat: -6.2088,
    lon: 106.8456,
  },
  "America/New_York": {
    location: "Local timezone",
    city: "New York",
    lat: 40.7128,
    lon: -74.006,
  },
  "Europe/Helsinki": {
    location: "Local timezone",
    city: "Helsinki",
    lat: 60.1699,
    lon: 24.9384,
  },
};

export const REGION_LOCATIONS: Record<string, FleetLocation> = {
  ash: {
    location: "Hetzner ash",
    city: "Ashburn",
    lat: 39.0438,
    lon: -77.4874,
  },
  ashburn: {
    location: "Hetzner ash",
    city: "Ashburn",
    lat: 39.0438,
    lon: -77.4874,
  },
  hel: {
    location: "Hetzner hel",
    city: "Helsinki",
    lat: 60.1699,
    lon: 24.9384,
  },
  hel1: {
    location: "Hetzner hel1",
    city: "Helsinki",
    lat: 60.1699,
    lon: 24.9384,
  },
  nbg: {
    location: "Hetzner nbg",
    city: "Nuremberg",
    lat: 49.4521,
    lon: 11.0767,
  },
  nbg1: {
    location: "Hetzner nbg1",
    city: "Nuremberg",
    lat: 49.4521,
    lon: 11.0767,
  },
  fsn: {
    location: "Hetzner fsn",
    city: "Falkenstein",
    lat: 50.4779,
    lon: 12.3713,
  },
  fsn1: {
    location: "Hetzner fsn1",
    city: "Falkenstein",
    lat: 50.4779,
    lon: 12.3713,
  },
  hil: {
    location: "Hetzner hil",
    city: "Hillsboro",
    lat: 45.5229,
    lon: -122.9898,
  },
  hil1: {
    location: "Hetzner hil1",
    city: "Hillsboro",
    lat: 45.5229,
    lon: -122.9898,
  },
};

export const TAILSCALE_RELAY_LOCATIONS: Record<string, FleetLocation> = {
  ams: {
    location: "Tailscale relay",
    city: "Amsterdam relay",
    lat: 52.3676,
    lon: 4.9041,
  },
  blr: {
    location: "Tailscale relay",
    city: "Bengaluru relay",
    lat: 12.9716,
    lon: 77.5946,
  },
  bom: {
    location: "Tailscale relay",
    city: "Mumbai relay",
    lat: 19.076,
    lon: 72.8777,
  },
  den: {
    location: "Tailscale relay",
    city: "Denver relay",
    lat: 39.7392,
    lon: -104.9903,
  },
  dfw: {
    location: "Tailscale relay",
    city: "Dallas relay",
    lat: 32.7767,
    lon: -96.797,
  },
  fra: {
    location: "Tailscale relay",
    city: "Frankfurt relay",
    lat: 50.1109,
    lon: 8.6821,
  },
  gru: {
    location: "Tailscale relay",
    city: "Sao Paulo relay",
    lat: -23.5558,
    lon: -46.6396,
  },
  hel: {
    location: "Tailscale relay",
    city: "Helsinki relay",
    lat: 60.1699,
    lon: 24.9384,
  },
  hkg: {
    location: "Tailscale relay",
    city: "Hong Kong relay",
    lat: 22.3193,
    lon: 114.1694,
  },
  jnb: {
    location: "Tailscale relay",
    city: "Johannesburg relay",
    lat: -26.2041,
    lon: 28.0473,
  },
  lax: {
    location: "Tailscale relay",
    city: "Los Angeles relay",
    lat: 34.0522,
    lon: -118.2437,
  },
  lhr: {
    location: "Tailscale relay",
    city: "London relay",
    lat: 51.5072,
    lon: -0.1276,
  },
  lon: {
    location: "Tailscale relay",
    city: "London relay",
    lat: 51.5072,
    lon: -0.1276,
  },
  mad: {
    location: "Tailscale relay",
    city: "Madrid relay",
    lat: 40.4168,
    lon: -3.7038,
  },
  mia: {
    location: "Tailscale relay",
    city: "Miami relay",
    lat: 25.7617,
    lon: -80.1918,
  },
  nrt: {
    location: "Tailscale relay",
    city: "Tokyo relay",
    lat: 35.6762,
    lon: 139.6503,
  },
  nyc: {
    location: "Tailscale relay",
    city: "New York relay",
    lat: 40.7128,
    lon: -74.006,
  },
  par: {
    location: "Tailscale relay",
    city: "Paris relay",
    lat: 48.8566,
    lon: 2.3522,
  },
  prg: {
    location: "Tailscale relay",
    city: "Prague relay",
    lat: 50.0755,
    lon: 14.4378,
  },
  sea: {
    location: "Tailscale relay",
    city: "Seattle relay",
    lat: 47.6062,
    lon: -122.3321,
  },
  sfo: {
    location: "Tailscale relay",
    city: "San Francisco relay",
    lat: 37.7749,
    lon: -122.4194,
  },
  sin: {
    location: "Tailscale relay",
    city: "Singapore relay",
    lat: 1.3521,
    lon: 103.8198,
  },
  sto: {
    location: "Tailscale relay",
    city: "Stockholm relay",
    lat: 59.3293,
    lon: 18.0686,
  },
  syd: {
    location: "Tailscale relay",
    city: "Sydney relay",
    lat: -33.8688,
    lon: 151.2093,
  },
  tok: {
    location: "Tailscale relay",
    city: "Tokyo relay",
    lat: 35.6762,
    lon: 139.6503,
  },
  tor: {
    location: "Tailscale relay",
    city: "Toronto relay",
    lat: 43.6532,
    lon: -79.3832,
  },
  vie: {
    location: "Tailscale relay",
    city: "Vienna relay",
    lat: 48.2082,
    lon: 16.3738,
  },
  waw: {
    location: "Tailscale relay",
    city: "Warsaw relay",
    lat: 52.2297,
    lon: 21.0122,
  },
  yyz: {
    location: "Tailscale relay",
    city: "Toronto relay",
    lat: 43.6532,
    lon: -79.3832,
  },
};

export const UNKNOWN_FLEET_LOCATION: FleetLocation = {
  location: "Location unknown",
  city: "Unknown",
  lat: 0,
  lon: 0,
};

export function localTimezoneLocation() {
  if (typeof Intl === "undefined") return undefined;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timeZone ? TIMEZONE_LOCATIONS[timeZone] : undefined;
}

export function machineRegionLocation(machine: MachineGroup) {
  const haystack = [
    machine.name,
    machine.dnsName,
    machine.collectorUrl,
    machine.ip,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const [code, location] of Object.entries(REGION_LOCATIONS)) {
    if (new RegExp(`(^|[^a-z0-9])${code}(?:\\d+)?($|[^a-z0-9])`).test(haystack))
      return location;
  }
  return undefined;
}

export function machineRelayLocation(machine: MachineGroup) {
  const relay = machine.relay?.trim().toLowerCase();
  return relay ? TAILSCALE_RELAY_LOCATIONS[relay] : undefined;
}

export function fleetMachineLocation(machine: MachineGroup, index: number) {
  void index;
  if (machine.self) {
    const local = localTimezoneLocation();
    if (local) return { ...local, location: `This ${deviceNounForOs(machine.os)}` };
  }
  return (
    machineRegionLocation(machine) ??
    machineRelayLocation(machine) ??
    UNKNOWN_FLEET_LOCATION
  );
}

export function fleetVersionState(
  machine: MachineGroup,
): FleetMachine["versionState"] {
  // Phones never install the agent bridge — "needs setup" would be a dead end.
  if (isMobileMachineOs(machine.os)) return "current";
  if (machine.collector !== "ready") return "needs-setup";
  const version = machine.version;
  if (
    version?.latestCommit &&
    version.commit &&
    version.latestCommit !== version.commit
  )
    return "stale";
  return "current";
}

const FLEET_FAILURE_PATTERN =
  /\b(error|failed|failure|blocked|unavailable|unauthorized|forbidden|timeout|missing|not found|needs|invalid|rejected|login|auth)\b/i;

export function isFleetFailureText(value?: string) {
  return FLEET_FAILURE_PATTERN.test(value ?? "");
}

export function fleetAgentState(
  agent: AgentProfile,
  snapshot: AgentSnapshot | undefined,
  activeCount: number,
  hasMachineWiring: boolean,
): FleetAgent["state"] {
  if (snapshot?.error && isFleetFailureText(snapshot.error)) return "failed";
  if (!hasMachineWiring) return "setup";
  if (activeCount > 0 || snapshot?.processRunning) return "working";
  return "ready";
}
