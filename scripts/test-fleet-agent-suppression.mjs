import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const sourcePath = new URL("../src/features/fleet/fleet-identity.ts", import.meta.url);
const source = readFileSync(sourcePath, "utf8")
  .replace(/^import\s+type\s+.+;\n/gm, "")
  .replace(/\bexport\s+/g, "")
  + "\n;globalThis.__fleetIdentityTest = { agentSuppressionKeys, agentMatchesSuppression, filterSuppressedAgents, withoutAgentSuppression, suppressionKeysForRemovedAgent };";

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const context = vm.createContext({ URL });
vm.runInContext(compiled, context, { filename: "fleet-identity.ts" });

const {
  agentSuppressionKeys,
  agentMatchesSuppression,
  filterSuppressedAgents,
  withoutAgentSuppression,
  suppressionKeysForRemovedAgent,
} = context.__fleetIdentityTest;

const savedProfile = {
  id: "openclaw-saved-profile",
  name: "OpenClaw",
  runtime: "openclaw",
  agentId: "main",
  telemetryUrl: "http://127.0.0.1:8787",
  localDataDir: "/Users/liam/.openclaw",
  beeRole: "queen",
};

const discoveredProfile = {
  ...savedProfile,
  id: "openclaw-discovered-profile",
  collectorCapabilities: { chat: true },
};

const unrelatedProfile = {
  id: "hermes-kept",
  name: "Hermes",
  runtime: "hermes",
  agentId: "main",
  telemetryUrl: "http://127.0.0.1:8787",
  localDataDir: "/Users/liam/.hermes",
};

const suppressedKeys = new Set(agentSuppressionKeys(discoveredProfile));

assert.equal(agentMatchesSuppression(discoveredProfile, suppressedKeys), true, "the deleted discovered agent should match its tombstone");
assert.equal(agentMatchesSuppression(savedProfile, suppressedKeys), true, "a saved profile for the same workspace should also match the tombstone");
assert.equal(agentMatchesSuppression(unrelatedProfile, suppressedKeys), false, "unrelated agents should not match the tombstone");

assert.deepEqual(
  filterSuppressedAgents([savedProfile, unrelatedProfile], suppressedKeys).map((agent) => agent.id),
  ["hermes-kept"],
  "suppression must apply to saved/configured profiles before Fleet merges sources",
);

assert.deepEqual(
  filterSuppressedAgents([discoveredProfile, unrelatedProfile], suppressedKeys).map((agent) => agent.id),
  ["hermes-kept"],
  "suppression must apply to discovered profiles before Fleet merges sources",
);

// Regression: removing a machine's first Hermes agent (canonical ~/.hermes
// data dir) leaves a name-independent workspace tombstone, so a freshly
// created agent with a different name collides with it and silently vanishes.
// A deliberate add must clear the colliding tombstones.
const removedFirstHermes = {
  id: "hermes-1749500000000-aaaaaa",
  name: "Honey Wasp",
  runtime: "hermes",
  agentId: "",
  telemetryUrl: "http://nimbus.tail.ts.net:4317",
  localDataDir: "~/.hermes",
};

const recreatedHermes = {
  id: "hermes-1749500099999-bbbbbb",
  name: "Pollen Scout",
  runtime: "hermes",
  agentId: "",
  telemetryUrl: "http://nimbus.tail.ts.net:4317",
  localDataDir: "~/.hermes",
};

const tombstones = new Set(agentSuppressionKeys(removedFirstHermes));
assert.equal(
  agentMatchesSuppression(recreatedHermes, tombstones),
  true,
  "a re-created first agent with a different name collides with the removed agent's workspace tombstone",
);

const clearedTombstones = withoutAgentSuppression(tombstones, recreatedHermes);
assert.ok(clearedTombstones, "a deliberate add that collides with a tombstone must produce a cleared suppression set");
assert.equal(
  agentMatchesSuppression(recreatedHermes, clearedTombstones),
  false,
  "after clearing on a deliberate add, the new agent must be visible again",
);
assert.equal(
  clearedTombstones.has(`id:${removedFirstHermes.id}`),
  true,
  "the removed agent's own id tombstone must survive the clear",
);
assert.equal(
  withoutAgentSuppression(tombstones, unrelatedProfile),
  null,
  "an add that collides with nothing must leave the suppression set untouched",
);

// Regression: two saved duplicates of the same agent (same runtime/collector/
// data dir, different ids) share the workspace tombstone. Deleting the stale
// duplicate must not record keys that hide the profile the user kept.
const staleDuplicate = {
  id: "hermes-bankragent-3b03a1",
  name: "BankrAgent",
  runtime: "hermes",
  agentId: "bankragent",
  telemetryUrl: "http://127.0.0.1:8787",
  localDataDir: "/Users/liam/.hermes/profiles/bankragent",
};

const keptDuplicate = {
  ...staleDuplicate,
  id: "hermes-bankragent-f15dbb",
};

const duplicateDeleteKeys = [...suppressionKeysForRemovedAgent(staleDuplicate, staleDuplicate.id, [keptDuplicate, unrelatedProfile])];
assert.deepEqual(
  duplicateDeleteKeys,
  [`id:${staleDuplicate.id}`],
  "deleting a duplicate must record only the id tombstone when a surviving profile shares the workspace key",
);
assert.equal(
  agentMatchesSuppression(keptDuplicate, new Set(duplicateDeleteKeys)),
  false,
  "the surviving duplicate must stay visible after the stale duplicate is deleted",
);

assert.deepEqual(
  [...suppressionKeysForRemovedAgent(staleDuplicate, staleDuplicate.id, [unrelatedProfile])].sort(),
  [...agentSuppressionKeys(staleDuplicate)].sort(),
  "deleting an agent with no surviving duplicate must record the full id + workspace tombstones",
);

assert.deepEqual(
  [...suppressionKeysForRemovedAgent(null, "ghost-agent-id", [unrelatedProfile])],
  ["id:ghost-agent-id"],
  "deleting an unresolvable agent must fall back to the id tombstone",
);

console.log("Fleet agent suppression filters saved and discovered sources before merge.");
console.log("Deliberate re-adds clear colliding suppression tombstones.");
console.log("Deleting a stale duplicate keeps the surviving same-workspace profile visible.");
