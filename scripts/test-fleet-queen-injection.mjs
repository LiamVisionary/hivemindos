// Hermetic test for withStoredQueenAgent in /api/fleet/discover: the stored
// crowned Queen must be injected into the discover payload's self machine when
// no live collector agent carries her id — and must NOT be injected when a
// live agent is already crowned (or shares her id), when no queen is stored,
// or when there is no self machine to host her. Mirrors the vm-slice pattern
// of test-fleet-discovery-merge.mjs (route files can't export helpers).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const routeSource = readFileSync(
  new URL("../src/app/api/fleet/discover/route.ts", import.meta.url),
  "utf8",
);
const start = routeSource.indexOf("function withStoredQueenAgent");
assert.ok(start >= 0, "withStoredQueenAgent must exist in the discover route");
const end = routeSource.indexOf("async function readDiscovery");
assert.ok(end > start, "readDiscovery anchor must follow withStoredQueenAgent");

const compiled = ts.transpileModule(
  routeSource.slice(start, end) +
    "\n;globalThis.__queenInjection = { withStoredQueenAgent };",
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const context = vm.createContext({});
vm.runInContext(compiled, context, "discover-route-queen-slice.ts");
const { withStoredQueenAgent } = context.__queenInjection;

const device = (overrides = {}) => ({
  self: false,
  name: "peer",
  dnsName: "peer.example.ts.net",
  os: "macOS",
  online: true,
  ip: "203.0.113.7",
  collectorUrl: "http://127.0.0.1:8787",
  ...overrides,
});

const selfMachine = (agents = [], overrides = {}) => ({
  device: device({ self: true, name: "This Mac", ip: "203.0.113.1" }),
  collector: "ready",
  capabilities: { chat: true, hostedApps: true },
  agents,
  ...overrides,
});

const queenProfile = {
  id: "hermes-lead",
  name: "Solara",
  runtime: "hermes",
  model: "grok-4.5",
  beeRole: "queen",
  machineName: "This Mac",
};

const worker = (id) => ({ id, name: id, runtime: "hermes", beeRole: "worker" });

// 1. Stored queen with no live counterpart → injected first on the self machine.
{
  const machines = [
    { device: device(), collector: "ready", agents: [worker("w-remote")] },
    selfMachine([worker("w-live")]),
  ];
  const out = withStoredQueenAgent(machines, [worker("w-live"), queenProfile]);
  const self = out.find((m) => m.device.self);
  assert.equal(self.agents.length, 2);
  assert.equal(self.agents[0].id, "hermes-lead");
  assert.equal(self.agents[0].beeRole, "queen");
  // Machine-identity fields come from the host machine, not the stale profile.
  assert.equal(self.agents[0].machineName, "This Mac");
  assert.equal(self.agents[0].telemetryUrl, "http://127.0.0.1:8787");
  assert.deepEqual(self.agents[0].collectorCapabilities, {
    chat: true,
    hostedApps: true,
  });
  // The peer machine is untouched.
  assert.equal(out.find((m) => !m.device.self).agents.length, 1);
}

// 2. A live agent already crowned (overlay landed) → no injection.
{
  const machines = [
    selfMachine([{ ...worker("w-live"), beeRole: "queen" }]),
  ];
  const out = withStoredQueenAgent(machines, [queenProfile]);
  assert.equal(out[0].agents.length, 1);
}

// 3. A live agent shares the queen's id (already overlaid) → no injection.
{
  const machines = [selfMachine([{ ...worker("hermes-lead") }])];
  const out = withStoredQueenAgent(machines, [queenProfile]);
  assert.equal(out[0].agents.length, 1);
}

// 4. No stored queen → unchanged.
{
  const machines = [selfMachine([worker("w-live")])];
  const out = withStoredQueenAgent(machines, [worker("w-live")]);
  assert.equal(out, machines);
}

// 5. No self machine to host her → unchanged (never fabricate a machine).
{
  const machines = [
    { device: device(), collector: "ready", agents: [worker("w-remote")] },
  ];
  const out = withStoredQueenAgent(machines, [queenProfile]);
  assert.equal(out, machines);
}

// 6. Self machine without a ready collector still hosts her (a hub whose own
//    bridge is down must still surface its Queen to phones).
{
  const machines = [selfMachine([], { collector: "not-installed" })];
  const out = withStoredQueenAgent(machines, [queenProfile]);
  assert.equal(out[0].agents.length, 1);
  assert.equal(out[0].agents[0].id, "hermes-lead");
}

console.log("fleet queen injection: all assertions passed");
