import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compileIntoContext(source, context, filename) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInContext(compiled, context, { filename });
}

const identitySource =
  readFileSync(
    new URL("../src/features/fleet/fleet-identity.ts", import.meta.url),
    "utf8",
  )
    .replace(/^import\s+type\s+.+;\n/gm, "")
    .replace(/\bexport\s+/g, "") +
  "\n;globalThis.__fleetIdentity = { isLocalLinkDuplicateOfSelf, isLoopbackCollector, isMacMachineOs, isMobileMachineOs, machineExactIdentity, machineIdentityFromParts, shouldPreserveMissingDiscoveredMachine, tailnetSelfIdentityCandidates };";

const identityContext = vm.createContext({ URL });
compileIntoContext(identitySource, identityContext, "fleet-identity.ts");

const helperSource = readFileSync(
  new URL("../src/features/dashboard/dashboard-display-helpers.tsx", import.meta.url),
  "utf8",
);
const helperStart = helperSource.indexOf("const REPO_CLONE_URL");
const helperEnd = helperSource.indexOf("export function machineVersionState");
assert.ok(helperStart >= 0, "dashboard helper test start anchor must exist");
assert.ok(helperEnd > helperStart, "dashboard helper test end anchor must exist");

const helperSubset =
  helperSource.slice(helperStart, helperEnd).replace(/\bexport\s+/g, "") +
  "\n;globalThis.__fleetMerge = { mergeDiscoveredMachines, machineNetworkIssue, readyTailnetSelfShadowBases, isTailnetSelfShadowGroup };";

const helperContext = vm.createContext({
  ...identityContext.__fleetIdentity,
  Date,
});
compileIntoContext(helperSubset, helperContext, "dashboard-display-helpers.tsx");

const { mergeDiscoveredMachines, machineNetworkIssue, readyTailnetSelfShadowBases, isTailnetSelfShadowGroup } =
  helperContext.__fleetMerge;

const tailscaleStatusSource = readFileSync(
  new URL("../src/lib/native/tailscale-status.ts", import.meta.url),
  "utf8",
).replace(/\bexport\s+/g, "");
const tailscaleStatusContext = vm.createContext({});
compileIntoContext(
  `${tailscaleStatusSource}\n;globalThis.__tailscaleStatus = { tailscaleAttentionIssueKey, tailscaleStatusPresentation, tailscaleStatusRequiresAttention, shouldClearTailscaleAttentionDismissal, shouldShowTailscaleAttention };`,
  tailscaleStatusContext,
  "tailscale-status.ts",
);
const {
  tailscaleAttentionIssueKey,
  tailscaleStatusPresentation,
  tailscaleStatusRequiresAttention,
  shouldClearTailscaleAttentionDismissal,
  shouldShowTailscaleAttention,
} = tailscaleStatusContext.__tailscaleStatus;

assert.deepEqual(
  JSON.parse(JSON.stringify(tailscaleStatusPresentation({
    ok: false,
    error: "Tailscale LocalAPI unavailable",
    tailnetHealth: {
      state: "status-unavailable",
      detail: "Tailscale status was not available.",
    },
  }))),
  {
    label: "Tailscale needs attention",
    detail: "Tailscale did not respond. HivemindOS is continuing locally; restart or reconnect Tailscale to restore Fleet, sync, and phone access.",
    requiresAttention: true,
  },
  "an unavailable optional Tailnet must produce an actionable, non-blocking status",
);

const unavailableStatus = "Tailscale needs attention. Tailscale did not respond.";
const stoppedStatus = "Tailscale needs attention. Tailscale is stopped.";
const unavailableIssueKey = tailscaleAttentionIssueKey(unavailableStatus);
assert.equal(unavailableIssueKey, unavailableStatus);
assert.equal(tailscaleStatusRequiresAttention(unavailableStatus), true);
assert.equal(
  shouldShowTailscaleAttention(unavailableStatus, ""),
  true,
  "an unacknowledged Tailscale problem must show the global warning",
);
assert.equal(
  shouldShowTailscaleAttention(unavailableStatus, unavailableIssueKey),
  false,
  "dismissing a Tailscale problem must hide that same problem",
);
assert.equal(
  shouldShowTailscaleAttention(stoppedStatus, unavailableIssueKey),
  true,
  "a changed Tailscale problem must reappear after an earlier warning was dismissed",
);
assert.equal(
  shouldClearTailscaleAttentionDismissal("Checking Tailnet...", unavailableIssueKey),
  false,
  "startup status must not erase a remembered acknowledgement before health resolves",
);
assert.equal(
  shouldClearTailscaleAttentionDismissal("Tailscale Running", unavailableIssueKey),
  true,
  "a recovered Tailnet must clear the acknowledgement so the same problem can reappear later",
);

const tailscaleBannerSource = readFileSync(
  new URL("../src/features/dashboard/TailscaleAttentionBanner.tsx", import.meta.url),
  "utf8",
);
assert.match(
  tailscaleBannerSource,
  /onRetry:\s*\(\)\s*=>\s*(?:void\s*\|\s*)?Promise<void>/,
  "the global Tailscale warning must expose an explicit retry action",
);
assert.match(
  tailscaleBannerSource,
  /aria-label="Dismiss Tailscale warning"/,
  "the global Tailscale warning must expose an accessible dismiss action",
);

const dashboardAppSource = readFileSync(
  new URL("../src/features/dashboard/DashboardApp.tsx", import.meta.url),
  "utf8",
);
assert.match(
  dashboardAppSource,
  /enabled:\s*hydrated,[\s\S]*?intervalMs:\s*tailscaleStatusRequiresAttention\(tailscaleStatus\)\s*\?\s*30_000/,
  "an active Tailscale warning must retry automatically while the dashboard is visible",
);
function readyUbuntuMachine() {
  return {
    device: {
      self: false,
      name: "hivemindos-ubuntu-test",
      dnsName: "hivemindos-ubuntu-test.example.ts.net",
      os: "linux",
      online: true,
      ip: "203.0.113.42",
      collectorUrl: "http://127.0.0.1:8788/peer/203.0.113.42%3A8787",
      lastHandshake: "2026-06-20T00:00:00Z",
      curAddr: "203.0.113.42:12345",
      rxBytes: 100,
      txBytes: 200,
      active: true,
      relay: "hel",
    },
    collector: "ready",
    collectorHost: "ubuntu-test",
    machineId: "hivemind-machine-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    version: {
      appDir: "/srv/hivemindos",
      branch: "main",
      shortCommit: "ea6eb83",
    },
    capabilities: { chat: true, runtimeAgentCreation: true },
    envSync: { ready: true },
    system: { cpuPct: 12, ramPct: 37, diskPct: 62 },
    agents: [{ id: "agent-1", name: "Emerson", runtime: "hermes" }],
    snapshots: [],
    lastSeenAt: 123,
  };
}

function machineGroupFrom(machine) {
  return {
    key: "ubuntu-test",
    name: machine.device.name,
    address: machine.device.ip,
    collectorUrl: machine.device.collectorUrl,
    dnsName: machine.device.dnsName,
    ip: machine.device.ip,
    os: machine.device.os,
    relay: machine.device.relay,
    lastHandshake: machine.device.lastHandshake,
    curAddr: machine.device.curAddr,
    rxBytes: machine.device.rxBytes,
    txBytes: machine.device.txBytes,
    active: machine.device.active,
    online: machine.device.online,
    self: machine.device.self,
    collector: machine.collector,
    agents: machine.agents,
    version: machine.version,
    machineId: machine.machineId,
    capabilities: machine.capabilities,
    envSync: machine.envSync,
    system: machine.system,
    lastSeenAt: machine.lastSeenAt,
  };
}

const ready = readyUbuntuMachine();
const deviceOnlyRefresh = {
  device: {
    ...ready.device,
    collectorUrl: "",
    rxBytes: 500,
    txBytes: 700,
  },
  collector: "unknown",
  agents: [],
  snapshots: [],
};

const mergedDeviceOnly = mergeDiscoveredMachines([ready], [deviceOnlyRefresh]);
assert.equal(
  mergedDeviceOnly.length,
  1,
  "device-only refresh should merge into the verified machine row",
);
assert.equal(
  mergedDeviceOnly[0].collector,
  "ready",
  "device-only refresh must not downgrade a verified agent bridge",
);
assert.equal(
  mergedDeviceOnly[0].device.collectorUrl,
  ready.device.collectorUrl,
  "verified collector URL must survive a device-only refresh",
);
assert.equal(
  mergedDeviceOnly[0].device.rxBytes,
  500,
  "transport counters should still update from the device-only refresh",
);
assert.equal(
  mergedDeviceOnly[0].version?.shortCommit,
  "ea6eb83",
  "verified bridge metadata should survive a device-only refresh",
);
assert.equal(mergedDeviceOnly[0].agents.length, 1);
assert.equal(
  machineNetworkIssue(machineGroupFrom(mergedDeviceOnly[0]), "Tailscale Running"),
  undefined,
  "a verified ready bridge should not show the Tailnet-offline warning",
);

const bridgeProbeFailed = {
  device: {
    ...ready.device,
    collectorUrl: "",
    rxBytes: 600,
    txBytes: 800,
  },
  collector: "not-installed",
  agents: [],
  snapshots: [],
};
const mergedBridgeFailure = mergeDiscoveredMachines([ready], [bridgeProbeFailed]);
assert.equal(
  mergedBridgeFailure.length,
  1,
  "collector probe failure should also merge into the existing machine row",
);
assert.equal(
  mergedBridgeFailure[0].collector,
  "not-installed",
  "a real collector probe failure must not be hidden as ready",
);
assert.equal(
  mergedBridgeFailure[0].device.online,
  true,
  "online Tailnet transport should be preserved when the bridge probe fails",
);
assert.equal(
  mergedBridgeFailure[0].version,
  undefined,
  "stale bridge version should not be shown after a real probe failure",
);
assert.equal(
  mergedBridgeFailure[0].agents.length,
  1,
  "recent agents stay visible while the bridge recovers",
);
assert.match(
  machineNetworkIssue(
    machineGroupFrom(mergedBridgeFailure[0]),
    "Tailscale Running",
  )?.title ?? "",
  /Agent bridge is not reachable/,
);

const missingFromRefresh = mergeDiscoveredMachines([ready], []);
assert.equal(
  missingFromRefresh[0].collector,
  "offline",
  "a machine absent from refreshes is still marked offline",
);
assert.equal(missingFromRefresh[0].device.online, false);

// --- hostname rename (NYC 2026-07-05): a machine preserved from BEFORE the
// rename must fold into the ready collector machine that claims its system
// node via /health tailnetSelf, not live on as an offline ghost.
const preRenameNyc = {
  device: {
    self: false,
    name: "Liam’s MacBook Pro",
    dnsName: "liams-macbook-pro-1.tail1.ts.net",
    os: "macOS",
    online: true,
    ip: "100.0.0.9",
    collectorUrl: "",
  },
  collector: "offline",
  agents: [{ id: "agent-nyc", name: "Hermes", runtime: "hermes" }],
  snapshots: [],
};
const postRenameReady = {
  ...readyUbuntuMachine(),
  device: {
    ...readyUbuntuMachine().device,
    name: "LiamsMBP481146",
    dnsName: "hivemindos-liamsmbp481146-lan.tail1.ts.net",
    os: "macOS",
    ip: "100.0.0.10",
  },
  machineId: "hivemind-machine-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  tailnetSelf: {
    name: "Liam’s MacBook Pro",
    dnsName: "liams-macbook-pro-1.tail1.ts.net",
  },
};
const mergedRename = mergeDiscoveredMachines([preRenameNyc], [postRenameReady]);
assert.equal(
  mergedRename.length,
  1,
  "a rename-orphaned machine folds into the collector that claims it via tailnetSelf",
);
assert.equal(mergedRename[0].collector, "ready");

// Without the tailnetSelf claim the machine is still preserved (offline) — the
// fold must never widen into dropping genuinely-missing machines.
const mergedNoClaim = mergeDiscoveredMachines(
  [preRenameNyc],
  [{ ...postRenameReady, tailnetSelf: undefined }],
);
assert.equal(
  mergedNoClaim.length,
  2,
  "an unclaimed missing machine with agents is still preserved",
);

// --- fleet-view group fold (2026-07-10): the fleet view rebuilds MachineGroups
// from the raw tailscale device list, which carries no tailnetSelf, so a
// rename-orphaned system node (a second MacBook sharing the ComputerName, so
// tailscale suffixes it "-1") resurfaces as an empty "pending" ghost machine.
// The group layer must fold it via the tailnetSelf a ready collector reported.
const { machineExactIdentity: exactId } = identityContext.__fleetIdentity;
const shadowDiscovered = [
  {
    device: { self: true, name: "This Mac", dnsName: "hivemindos-liams-macbook-pro.tail1.ts.net" },
    collector: "ready",
    tailnetSelf: { name: "Liam’s MacBook Pro", dnsName: "liams-macbook-pro.tail1.ts.net" },
  },
  {
    device: { self: false, name: "hivemindos-liams-macbook-pro-nyc", dnsName: "hivemindos-liams-macbook-pro-nyc.tail1.ts.net" },
    collector: "ready",
    tailnetSelf: { name: "Liam’s MacBook Pro", dnsName: "liams-macbook-pro-1.tail1.ts.net" },
  },
];
const shadowBases = readyTailnetSelfShadowBases(shadowDiscovered);
assert.ok(
  shadowBases.has(exactId("", "liams-macbook-pro-1.tail1.ts.net")),
  "the NYC collector's claimed system node enters the shadow set",
);
assert.ok(
  !shadowBases.has(exactId("This Mac", "liams-macbook-pro.tail1.ts.net")),
  "a collector's claim on its OWN system node never enters the shadow set (no self-fold)",
);
assert.ok(
  isTailnetSelfShadowGroup(
    { name: "Liam’s MacBook Pro", dnsName: "liams-macbook-pro-1.tail1.ts.net", self: false, collector: "unknown" },
    shadowBases,
  ),
  "the bridge-less NYC system node folds out of the fleet view",
);
assert.ok(
  !isTailnetSelfShadowGroup(
    { name: "hivemindos-liams-macbook-pro-nyc", dnsName: "hivemindos-liams-macbook-pro-nyc.tail1.ts.net", self: false, collector: "ready" },
    shadowBases,
  ),
  "the ready NYC collector node is never folded",
);
assert.ok(
  !isTailnetSelfShadowGroup(
    { name: "This Mac", dnsName: "liams-macbook-pro.tail1.ts.net", self: true, collector: "unknown" },
    shadowBases,
  ),
  "self is never folded, even mid-probe when it looks device-only",
);
assert.ok(
  !isTailnetSelfShadowGroup(
    { name: "someones-laptop", dnsName: "someones-laptop.tail1.ts.net", self: false, collector: "unknown" },
    shadowBases,
  ),
  "an unclaimed standalone machine is never folded",
);
assert.equal(
  readyTailnetSelfShadowBases([]).size,
  0,
  "no ready collectors means no shadow bases (empty fleet is a no-op)",
);

// --- reverse reachability: peers' env-sync unreachable reports annotate the
// target machine and surface a network issue even when the local probe is ok.
const reachabilitySource = readFileSync(
  new URL("../src/app/api/fleet/reverse-reachability.ts", import.meta.url),
  "utf8",
)
  .replace(/^import\s+.+;\n/gm, "")
  .replace(/\bexport\s+/g, "");
const reachabilityContext = vm.createContext({
  machineExactIdentity: identityContext.__fleetIdentity.machineExactIdentity,
});
compileIntoContext(
  reachabilitySource + "\n;globalThis.__rr = { annotateReverseReachability };",
  reachabilityContext,
  "reverse-reachability.ts",
);
const { annotateReverseReachability } = reachabilityContext.__rr;

const selfMac = {
  device: {
    self: true,
    name: "This Mac",
    dnsName: "liams-macbook-pro.example.ts.net",
    ip: "100.1.1.1",
  },
};
const reportingVps = {
  device: {
    self: false,
    name: "hivemindos-ubuntu-test",
    dnsName: "hivemindos-ubuntu-test.example.ts.net",
    ip: "100.2.2.2",
  },
  envSync: {
    maintenance: {
      lastSummary: {
        // Same machine reported once by DNS name and once by pinned raw IP;
        // plus the reporter's own alias and an unknown host, both ignored.
        pull: {
          unreachable: [
            "liams-macbook-pro.example.ts.net",
            "gone-machine.example.ts.net",
          ],
        },
        retry: {
          unreachable: ["100.1.1.1", "hivemindos-ubuntu-test.example.ts.net"],
        },
      },
    },
  },
};
annotateReverseReachability([selfMac, reportingVps]);
assert.equal(
  JSON.stringify(selfMac.reportedUnreachableBy),
  JSON.stringify(["hivemindos-ubuntu-test"]),
  "peer unreachable reports (by name AND pinned IP) annotate the target machine once",
);
assert.equal(
  reportingVps.reportedUnreachableBy,
  undefined,
  "a machine's own report must not mark itself unreachable",
);

const reverseIssue = machineNetworkIssue(
  {
    key: "mac",
    name: "This Mac",
    os: "macos",
    online: true,
    self: false,
    collector: "ready",
    agents: [],
    reportedUnreachableBy: ["hivemindos-ubuntu-test"],
  },
  "Tailscale Running",
);
assert.match(
  reverseIssue?.title ?? "",
  /peers report this machine unreachable/i,
  "ready-but-peer-unreachable machines surface a network issue",
);
assert.ok(
  (reverseIssue?.commands ?? []).some((line) => line.includes("linkd")),
  "reverse-reachability fix commands point at linkd",
);

console.log("✓ fleet discovery merge keeps verified bridges across device-only refreshes");
console.log("✓ fleet view folds rename-orphaned system tailnet nodes out of the machine groups");
console.log("✓ fleet discovery merge still surfaces real bridge probe failures");
console.log("✓ reverse reachability annotates peer-reported unreachable machines");
