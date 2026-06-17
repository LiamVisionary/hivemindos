import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Load isVisibleFleetMachine + isDesktopMachineOs from the real module so the
// test exercises the shipped predicate, not a copy.
const sourcePath = new URL(
  "../src/features/fleet/fleet-identity.ts",
  import.meta.url,
);
const source =
  readFileSync(sourcePath, "utf8")
    .replace(/^import\s+type\s+.+;\n/gm, "")
    .replace(/\bexport\s+/g, "") +
  "\n;globalThis.__fleetVisibilityTest = { isVisibleFleetMachine, isDesktopMachineOs };";

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const context = vm.createContext({ URL });
vm.runInContext(compiled, context, { filename: "fleet-identity.ts" });
const { isVisibleFleetMachine, isDesktopMachineOs } =
  context.__fleetVisibilityTest;

// --- The reported bug: a fresh Windows install's own machine vanished from the
// fleet because isVisibleFleetMachine matched neither its "This PC" name nor its
// windows/win32 OS, so the self cell + the add-agent cell (which lives inside
// the machine cluster) never rendered. Shipped broken in v0.2.14. ---

// Windows self device, HTTP-route OS spelling (process.platform === "win32").
assert.equal(
  isVisibleFleetMachine({ self: true, name: "This PC", dnsName: "", os: "win32" }),
  true,
  "Windows self device (win32) must be visible — this was the empty-fleet bug",
);

// Windows self device, native-bridge OS spelling (std::env::consts::OS === "windows").
assert.equal(
  isVisibleFleetMachine({ self: true, name: "This PC", dnsName: "", os: "windows" }),
  true,
  "Windows self device (windows) must be visible",
);

// Linux self device.
assert.equal(
  isVisibleFleetMachine({
    self: true,
    name: "This computer",
    dnsName: "",
    os: "linux",
  }),
  true,
  "Linux self device must be visible",
);

// A non-self Windows peer in a real multi-machine fleet is a real member too.
assert.equal(
  isVisibleFleetMachine({
    self: false,
    name: "Friends-PC",
    dnsName: "friends-pc",
    os: "windows",
  }),
  true,
  "non-self Windows desktop peers must be visible",
);

// Self exemption holds even for an unrecognized OS — the local box is always a member.
assert.equal(
  isVisibleFleetMachine({
    self: true,
    name: "This Machine",
    dnsName: "",
    os: "freebsd",
  }),
  true,
  "self is always a fleet member regardless of OS",
);

// --- Regressions: existing behavior must be preserved. ---
assert.equal(
  isVisibleFleetMachine({ self: true, name: "This Mac", dnsName: "", os: "macos" }),
  true,
  "Mac self still visible",
);
assert.equal(
  isVisibleFleetMachine({ name: "iPhone", dnsName: "", os: "ios" }),
  true,
  "mobile still visible",
);
assert.equal(
  isVisibleFleetMachine({
    name: "hivemindos-vps",
    dnsName: "hivemindos-vps.tail.ts.net",
    os: "linux",
  }),
  true,
  "hivemind-named machine still visible",
);

// A non-self, non-hivemind, non-desktop, non-mobile, non-mac device stays out.
assert.equal(
  isVisibleFleetMachine({
    self: false,
    name: "random-router",
    dnsName: "random-router",
    os: "freebsd",
  }),
  false,
  "unrelated non-self devices must still be filtered out",
);

assert.equal(isDesktopMachineOs("windows"), true);
assert.equal(isDesktopMachineOs("win32"), true);
assert.equal(isDesktopMachineOs("linux"), true);
assert.equal(isDesktopMachineOs("macos"), false);
assert.equal(isDesktopMachineOs("ios"), false);
assert.equal(isDesktopMachineOs(undefined), false);

// --- Drift guard: this exact Windows/Linux fix was silently dropped once by a
// branch merge (the released v0.2.14 route fix in 2c8b5838 was reverted when
// merge 99fe4c1e integrated the in-flight branch). Fail loudly if any of the
// route-level Windows/Linux+self clauses disappears again. ---
function assertRouteKeepsDesktops(relPath, label) {
  const text = readFileSync(new URL(relPath, import.meta.url), "utf8");
  assert.ok(
    /function isDesktopDevice/.test(text),
    `${label}: isDesktopDevice helper must exist`,
  );
  assert.ok(
    /isDesktopDevice\(device\)/.test(text),
    `${label}: dedupeDevices must keep Windows/Linux desktops`,
  );
  assert.ok(
    /device\.self\s*\|\|/.test(text),
    `${label}: dedupeDevices must keep the self device`,
  );
  assert.ok(
    /win32/.test(text),
    `${label}: isDesktopDevice must match the win32 process.platform spelling`,
  );
}
assertRouteKeepsDesktops(
  "../src/app/api/tailscale/devices/route.ts",
  "tailscale/devices route",
);
assertRouteKeepsDesktops(
  "../src/app/api/fleet/discover/route.ts",
  "fleet/discover route",
);

// --- v0.2.16 Windows desktop UX drift guards. A fresh Windows user was shown a
// Unix-only `./setup.sh` setup command and "this Mac" copy on their own PC. ---
const helpers = readFileSync(
  new URL(
    "../src/features/dashboard/dashboard-display-helpers.tsx",
    import.meta.url,
  ),
  "utf8",
);
assert.ok(
  /setup\.ps1/.test(helpers),
  "setupCollectorCommand / network-issue commands must offer the Windows setup.ps1 path",
);
assert.ok(
  /isWindowsOs/.test(helpers),
  "dashboard-display-helpers must branch commands on a Windows OS check",
);
assert.ok(
  !/local agent bridge on this Mac/.test(helpers),
  "the self agent-bridge detail (shown in the default Hive view) must not hardcode 'this Mac'",
);

const setupModal = readFileSync(
  new URL("../src/features/dashboard/views/DashboardModals.tsx", import.meta.url),
  "utf8",
);
assert.ok(
  /setupMachine\.self/.test(setupModal),
  "the Connect-machine wizard must special-case the self machine (no git-clone for the box already running the app)",
);

console.log("✓ fleet Windows/Linux + self visibility: all assertions passed");
console.log(
  "✓ Windows desktop UX (setup.ps1 command, self-aware wizard, default-view copy): all assertions passed",
);
