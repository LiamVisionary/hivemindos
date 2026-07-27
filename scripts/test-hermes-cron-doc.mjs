// Hermetic suite for src/lib/services/scheduler/hermes-cron-doc.ts — the pure
// jobs.json mutation logic the cron-write primitive uses so JSON shaping never
// lives in a shell one-liner that could corrupt a production cron file.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { parseHermesCronDoc, applyCronMutation, serializeHermesCronDoc } = await import(
  "../src/lib/services/scheduler/hermes-cron-doc.ts"
);

const NOW = "2026-07-07T12:00:00.000Z";
const base = () => ({
  jobs: [
    { id: "be00d36360d6", name: "Daily Hive Pulse", enabled: true, state: "scheduled", schedule: { expr: "0 8 * * *" } },
    { id: "abc123", name: "Other", enabled: true },
  ],
  updated_at: "2026-07-01T00:00:00.000Z",
});

// --- parse -----------------------------------------------------------------
assert.deepEqual(parseHermesCronDoc("").jobs, [], "empty → empty jobs");
assert.deepEqual(parseHermesCronDoc("   ").jobs, [], "whitespace → empty jobs");
assert.equal(parseHermesCronDoc(JSON.stringify(base())).jobs.length, 2);
assert.deepEqual(parseHermesCronDoc('{"nope":1}').jobs, [], "missing jobs array normalized");
console.log("PASS parse");

// --- set-enabled (the emerson disable) -------------------------------------
{
  const { doc, changed } = applyCronMutation(base(), { action: "set-enabled", jobId: "be00d36360d6", enabled: false }, NOW);
  assert.equal(changed, 1);
  const job = doc.jobs.find((j) => j.id === "be00d36360d6");
  assert.equal(job.enabled, false);
  assert.equal(job.state, "paused");
  assert.equal(doc.jobs.find((j) => j.id === "abc123").enabled, true, "other job untouched");
  assert.equal(doc.updated_at, NOW, "updated_at stamped");
  // absent id is a no-op (changed 0) — callers can detect nothing matched
  assert.equal(applyCronMutation(base(), { action: "set-enabled", jobId: "ghost", enabled: false }, NOW).changed, 0);
}
console.log("PASS set-enabled");

// --- remove ----------------------------------------------------------------
{
  const { doc, changed } = applyCronMutation(base(), { action: "remove", jobId: "abc123" }, NOW);
  assert.equal(changed, 1);
  assert.deepEqual(doc.jobs.map((j) => j.id), ["be00d36360d6"]);
  assert.equal(applyCronMutation(base(), { action: "remove", jobId: "ghost" }, NOW).changed, 0, "removing absent = no-op");
}
console.log("PASS remove");

// --- upsert (create + update) ----------------------------------------------
{
  const created = applyCronMutation(base(), { action: "upsert", job: { id: "new1", name: "Fleet Heartbeat", enabled: true } }, NOW);
  assert.equal(created.changed, 1);
  assert.equal(created.doc.jobs.length, 3);
  assert.equal(created.doc.jobs.at(-1).id, "new1");
  // updating merges shallowly, preserving untouched fields
  const updated = applyCronMutation(base(), { action: "upsert", job: { id: "be00d36360d6", enabled: false } }, NOW);
  assert.equal(updated.doc.jobs.length, 2, "no duplicate row on update");
  const job = updated.doc.jobs.find((j) => j.id === "be00d36360d6");
  assert.equal(job.enabled, false);
  assert.equal(job.name, "Daily Hive Pulse", "existing fields preserved on merge");
}
console.log("PASS upsert");

// --- immutability + round-trip ---------------------------------------------
{
  const doc = base();
  applyCronMutation(doc, { action: "remove", jobId: "abc123" }, NOW);
  assert.equal(doc.jobs.length, 2, "input doc not mutated");
  const out = serializeHermesCronDoc(base());
  assert.ok(out.endsWith("\n"), "trailing newline like Hermes writes");
  assert.deepEqual(parseHermesCronDoc(out).jobs.length, 2, "serialize→parse round-trips");
}
console.log("PASS immutability + round-trip");

console.log("hermes-cron-doc: all assertions green");
