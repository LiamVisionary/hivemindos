// Hermetic suite for src/features/dashboard/schedule-replication.ts — the pure
// machine-scoping / fleet-replication planning (which machines to write, the
// shared idempotent job id, and the schedule→Hermes-cron-job mapping).
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { stableReplicaJobId, hermesScheduleFromEvery, hermesCronJobFromSchedule, planReplication, REPLICA_MARKER } = await import(
  "../src/features/dashboard/schedule-replication.ts"
);

const sched = (over) => ({
  id: "schedule-abc", name: "Fleet Heartbeat", agentId: "a1", enabled: true, every: "0 8 * * *",
  mode: "prompt", prompt: "ping", skills: [], paths: [], steps: [], createdAt: 0, updatedAt: 0, ...over,
});

// --- stable job id ---------------------------------------------------------
assert.equal(stableReplicaJobId(sched()), stableReplicaJobId(sched()), "deterministic");
assert.match(stableReplicaJobId(sched()), /^[a-f0-9]{12}$/, "12 hex");
assert.notEqual(stableReplicaJobId(sched({ id: "schedule-abc" })), stableReplicaJobId(sched({ id: "schedule-xyz" })), "distinct ids differ");
// an imported schedule reuses its underlying hermes job id so we don't fork its own machine's cron
assert.equal(
  stableReplicaJobId(sched({ externalJobId: "hermes:hermes-x:jobs.json:be00d36360d6" })),
  "be00d36360d6",
  "reuses underlying hermes job id",
);
console.log("PASS stable job id");

// --- schedule → hermes schedule block --------------------------------------
assert.deepEqual(hermesScheduleFromEvery("0 8 * * *"), { kind: "cron", expr: "0 8 * * *", display: "0 8 * * *" });
assert.deepEqual(hermesScheduleFromEvery("every 15m"), { kind: "interval", every: 15, unit: "minutes", display: "every 15m" });
assert.deepEqual(hermesScheduleFromEvery("2h"), { kind: "interval", every: 2, unit: "hours", display: "2h" });
console.log("PASS schedule block mapping");

// --- schedule → cron job ---------------------------------------------------
{
  const job = hermesCronJobFromSchedule(sched({ enabled: false }), "job123");
  assert.equal(job.id, "job123");
  assert.equal(job.name, "Fleet Heartbeat");
  assert.equal(job.prompt, "ping");
  assert.equal(job.enabled, false);
  assert.equal(job.state, "paused");
  assert.equal(job[REPLICA_MARKER], "schedule-abc", "stamped with the source schedule id");
}
console.log("PASS cron job mapping");

// --- replication planning --------------------------------------------------
const targets = [
  { machineId: "m-mac", collectorUrl: "http://127.0.0.1:8787", label: "This Mac" },
  { machineId: "m-ubuntu", collectorUrl: "http://peer/ubuntu", label: "Ubuntu" },
  { machineId: "m-nyc", collectorUrl: "http://peer/nyc", label: "NYC" },
  { machineId: "", collectorUrl: "http://peer/nomachine" }, // no machineId → skipped
];
// run-on-all-machines → upsert everywhere (that has a machineId)
const allPlan = planReplication(sched({ runOnAllMachines: true }), "m-mac", targets);
assert.deepEqual(allPlan.map((s) => `${s.action}:${s.target.machineId}`).sort(), ["upsert:m-mac", "upsert:m-nyc", "upsert:m-ubuntu"]);
// pinned → remove from every machine EXCEPT the designated one
const pinnedPlan = planReplication(sched({ runOnAllMachines: false }), "m-mac", targets);
assert.deepEqual(pinnedPlan.map((s) => `${s.action}:${s.target.machineId}`).sort(), ["remove:m-nyc", "remove:m-ubuntu"]);
assert.ok(!pinnedPlan.some((s) => s.target.machineId === "m-mac"), "designated machine's own cron is left alone");
console.log("PASS replication planning");

console.log("schedule-replication: all assertions green");
