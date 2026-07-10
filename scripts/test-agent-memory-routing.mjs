import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-memory-routing-home-"));
process.env.HOME = tempHome;

const vaultPath = join(tempHome, "vault");
await mkdir(vaultPath, { recursive: true });
await writeFile(join(vaultPath, "Shared Context.md"), "# Shared Context\n", "utf8");

const {
  canonicalMemoryKey,
  selectCanonicalMemoryHeads,
} = await import("../src/lib/services/obsidian/agent-memory/canonical.ts");
const cliCanonical = await import("./lib/hive-brain-canonical.mjs");
const {
  evolveAgentMemory,
  listAgentMemoryRecords,
  rememberActionAgentMemory,
  rememberAgentMemory,
} = await import("../src/lib/services/obsidian/agent-memory/core.ts");
const { listAgentOperationalEvents } = await import("../src/lib/services/obsidian/agent-memory/events.ts");
const { recordVisibleForRecall } = await import("../src/lib/services/obsidian/agent-memory/scoring.ts");

assert.equal(
  canonicalMemoryKey({ explicitKey: "Project / Atlas / Owner", type: "fact", title: "ignored" }),
  "project/atlas/owner",
  "explicit canonical keys should be stable across casing and spacing",
);
assert.equal(
  canonicalMemoryKey({ type: "decision", project: "HivemindOS", title: "Use one memory head" }),
  "decision/hivemindos/use-one-memory-head",
  "implicit keys should be deterministic from type, project, and title",
);
assert.equal(
  cliCanonical.canonicalMemoryKey({ type: "decision", project: "HivemindOS", title: "Use one memory head" }),
  "decision/hivemindos/use-one-memory-head",
  "CLI fallback keys should match application keys",
);

const oldHead = {
  id: "mem-old",
  type: "fact",
  title: "Atlas owner",
  content: "Atlas is owned by Alex.",
  memoryKey: "project/atlas/owner",
  confidence: 0.8,
  status: "active",
  tags: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  notePath: "old.md",
};
const newHead = {
  ...oldHead,
  id: "mem-new",
  content: "Atlas is owned by Sam.",
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  notePath: "new.md",
};
const distinct = {
  ...oldHead,
  id: "mem-distinct",
  title: "Atlas status",
  content: "Atlas is active.",
  memoryKey: "project/atlas/status",
  notePath: "status.md",
};
const selected = selectCanonicalMemoryHeads([oldHead, newHead, distinct]);
assert.deepEqual(selected.records.map((record) => record.id).sort(), ["mem-distinct", "mem-new"]);
assert.deepEqual(selected.conflicts.map((conflict) => conflict.memoryKey), ["project/atlas/owner"]);
assert.deepEqual(
  cliCanonical.selectCanonicalMemoryHeads([oldHead, newHead, distinct]).records.map((record) => record.id).sort(),
  ["mem-distinct", "mem-new"],
  "CLI fallback head selection should match the application",
);

await assert.rejects(
  rememberAgentMemory({
    vaultPath,
    type: "fact",
    title: "Unsafe key",
    content: "This content is otherwise safe.",
    memoryKey: "sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    proof: false,
  }),
  /credential status|contains/i,
  "canonical keys must pass the same secret gate as memory content",
);

const first = await rememberAgentMemory({
  vaultPath,
  type: "fact",
  title: "Atlas owner",
  content: "Atlas is owned by Alex.",
  memoryKey: "project/atlas/owner",
  proof: false,
});
assert.equal(first.record?.memoryKey, "project/atlas/owner");

const blocked = await rememberAgentMemory({
  vaultPath,
  type: "fact",
  title: "Atlas ownership changed",
  content: "Atlas is now owned by Sam.",
  memoryKey: "project/atlas/owner",
  proof: false,
});
assert.equal(blocked.blocked, true, "a second active write for the same canonical key should be blocked");
assert.match(blocked.blockReason ?? "", /canonical memory head/i);

const evolved = await evolveAgentMemory({
  vaultPath,
  memoryId: first.record.id,
  content: "Atlas is now owned by Sam.",
  evolutionReason: "Ownership changed",
  proof: false,
});
assert.equal(evolved.record.memoryKey, "project/atlas/owner", "evolution should preserve the canonical key");

const operational = await rememberActionAgentMemory({
  vaultPath,
  title: "Queen Bee queued Atlas deployment",
  content: "Queued task t_atlas_1 for the deployment worker.",
  source: "Queen Bee receipt",
  agentName: "Queen Bee",
  project: "Atlas",
  tags: ["queen-bee", "receipt"],
  operationKey: "queen-bee/atlas-deployment",
  taskId: "t_atlas_1",
});
assert.ok(operational.event?.id, "remember-action should now return an operational event");
assert.equal("record" in operational, false, "operational events must not masquerade as durable memory records");

const { records } = await listAgentMemoryRecords({ vaultPath });
assert.equal(records.some((record) => record.title.includes("queued Atlas deployment")), false);
assert.equal(records.filter((record) => record.memoryKey === "project/atlas/owner" && record.status === "active").length, 1);

const events = await listAgentOperationalEvents({ limit: 10 });
assert.equal(events.events[0]?.title, "Queen Bee queued Atlas deployment");
assert.equal(events.events[0]?.operationKey, "queen-bee/atlas-deployment");

const { POST: postMemoryRoute } = await import("../src/app/api/brain/memory/route.ts");
const routeResponse = await postMemoryRoute(new Request("http://localhost/api/brain/memory", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action: "record-operation",
    title: "API operational receipt",
    content: "Recorded through the memory API route.",
    operationKey: "api/operational-receipt",
    outcome: "success",
    taskId: "api-task-1",
  }),
}));
const routePayload = await routeResponse.json();
assert.equal(routeResponse.status, 200);
assert.equal(routePayload.durableMemoryWritten, false);
assert.equal(routePayload.event?.operationKey, "api/operational-receipt");
assert.equal((await listAgentOperationalEvents({ query: "API operational receipt" })).events.length, 1);

const offlineCli = spawnSync(process.execPath, [
  "scripts/hive-brain",
  "record-operation",
  "--title", "Offline CLI receipt",
  "--content", "Recorded while the app API was unavailable.",
  "--operation-key", "cli/offline-receipt",
  "--outcome", "success",
  "--task-id", "offline-task-1",
  "--no-api",
  "--json",
], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, HOME: tempHome },
});
assert.equal(offlineCli.status, 0, offlineCli.stderr);
const offlinePayload = JSON.parse(offlineCli.stdout);
assert.equal(offlinePayload.source, "local-fallback");
assert.equal(offlinePayload.durableMemoryWritten, false);
assert.equal(offlinePayload.event?.operationKey, "cli/offline-receipt");
assert.equal((await listAgentOperationalEvents({ query: "Offline CLI receipt" })).events.length, 1);

const legacyAction = {
  ...oldHead,
  id: "legacy-action",
  type: "action",
  title: "Legacy queued receipt",
  memoryKey: "action/global/legacy-queued-receipt",
};
assert.equal(recordVisibleForRecall(legacyAction, {}), false, "legacy action receipts should stay out of default recall");
assert.equal(recordVisibleForRecall(legacyAction, { type: "action" }), true, "explicit action recall should remain available");
assert.equal(recordVisibleForRecall(legacyAction, { includeOperational: true }), true, "callers can explicitly include legacy operations");

console.log("Agent Memory routing and canonical-head tests passed.");
