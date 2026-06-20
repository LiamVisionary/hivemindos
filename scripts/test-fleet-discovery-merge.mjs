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
  "\n;globalThis.__fleetIdentity = { isLocalLinkDuplicateOfSelf, isLoopbackCollector, isMobileMachineOs, machineExactIdentity, machineIdentityFromParts, shouldPreserveMissingDiscoveredMachine };";

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
  "\n;globalThis.__fleetMerge = { mergeDiscoveredMachines, machineNetworkIssue };";

const helperContext = vm.createContext({
  ...identityContext.__fleetIdentity,
  Date,
});
compileIntoContext(helperSubset, helperContext, "dashboard-display-helpers.tsx");

const { mergeDiscoveredMachines, machineNetworkIssue } =
  helperContext.__fleetMerge;

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

console.log("✓ fleet discovery merge keeps verified bridges across device-only refreshes");
console.log("✓ fleet discovery merge still surfaces real bridge probe failures");
