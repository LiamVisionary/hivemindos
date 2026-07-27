import assert from "node:assert/strict";
import { appendFile, mkdtemp } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-memory-pattern-review-"));
process.env.HOME = tempHome;

const { agentOperationalEventsPath, recordAgentOperationalEvent } = await import("../src/lib/services/obsidian/agent-memory/events.ts");
const { reviewOperationalPatterns } = await import("../src/lib/services/brain-pattern-mining.ts");
const { readBrainReviewQueue } = await import("../src/lib/services/brain-review-queue.ts");

for (let index = 0; index < 4; index += 1) {
  await recordAgentOperationalEvent({
    title: "Publish product release brief",
    content: `Published release brief ${index + 1}.`,
    operationKey: "content/product-release-brief",
    outcome: "success",
    taskId: `release-brief-${index}`,
    source: "pattern-review-test",
  });
}

const reportOnly = await reviewOperationalPatterns({ enqueueProposals: false });
assert.deepEqual(reportOnly.mining.candidates.map((candidate) => candidate.key), [
  "repeated-operation:content/product-release-brief",
]);
assert.equal(reportOnly.enqueued.length, 0, "dry-run mining must not mutate the review queue");
assert.equal((await readBrainReviewQueue()).proposals.length, 0);

const firstEnqueue = await reviewOperationalPatterns({ enqueueProposals: true });
assert.equal(firstEnqueue.enqueued.length, 1);
assert.equal(firstEnqueue.enqueued[0].kind, "skill");
assert.equal(firstEnqueue.enqueued[0].status, "pending");
assert.equal(firstEnqueue.enqueued[0].metadata?.skepticVerdict, undefined,
  "the skeptic is disabled by default");

const secondEnqueue = await reviewOperationalPatterns({ enqueueProposals: true });
assert.equal(secondEnqueue.enqueued.length, 0, "the same mined pattern should not enqueue twice");
assert.deepEqual(secondEnqueue.skippedExisting, ["repeated-operation:content/product-release-brief"]);
assert.equal((await readBrainReviewQueue()).proposals.length, 1);

// Mining must see the whole bounded journal, not just the newest 1,000
// events of the public list clamp: bury an older pattern beneath 1,040
// unique one-off events and expect the miner to still surface it.
const journalEvent = (fields) => JSON.stringify({
  schema: "hivemindos.agent-operational-event.v1",
  outcome: "success",
  tags: [],
  entities: [],
  ...fields,
});
const buriedLines = [];
for (let index = 0; index < 1_040; index += 1) {
  buriedLines.push(journalEvent({
    id: `op-filler-${index}`,
    title: `Filler operation ${index}`,
    summary: `One-off operation ${index}.`,
    operationKey: `ops/one-off-${index}`,
    taskId: `filler-${index}`,
    occurredAt: new Date(Date.parse("2026-07-20T00:00:00.000Z") + index * 60_000).toISOString(),
  }));
}
// Irregular spacing keeps this a repeated-operation (skill) candidate rather
// than a temporal routine.
const legacyTimes = ["2026-06-01T00:00:00.000Z", "2026-06-02T00:00:00.000Z", "2026-06-07T00:00:00.000Z", "2026-06-09T00:00:00.000Z"];
for (const [index, occurredAt] of legacyTimes.entries()) {
  buriedLines.push(journalEvent({
    id: `op-legacy-${index}`,
    title: "Compact vault archives",
    summary: `Compacted vault archive set ${index}.`,
    operationKey: "maintenance/compact-vault-archives",
    taskId: `legacy-${index}`,
    occurredAt,
  }));
}
await appendFile(agentOperationalEventsPath(), `${buriedLines.join("\n")}\n`, "utf8");

const fullJournal = await reviewOperationalPatterns({ enqueueProposals: false });
assert.equal(fullJournal.truncated, false, "an unclamped pass over the bounded journal is not truncated");
assert.ok(fullJournal.mining.scanned >= 1_048, `expected the full journal, scanned ${fullJournal.mining.scanned}`);
assert.ok(
  fullJournal.mining.candidates.some((candidate) => candidate.key === "repeated-operation:maintenance/compact-vault-archives"),
  "mining must see patterns older than the public 1,000-event clamp",
);

const clamped = await reviewOperationalPatterns({ enqueueProposals: false, limit: 100 });
assert.equal(clamped.truncated, true, "an explicit limit below the journal size reports truncation");
assert.equal(clamped.mining.scanned, 100);
assert.ok(!clamped.mining.candidates.some((candidate) => candidate.key.includes("compact-vault-archives")));

// The skeptic never runs during dry-run mining.
let dryRunSkepticCalls = 0;
await reviewOperationalPatterns({
  enqueueProposals: false,
  skepticWithModel: async () => {
    dryRunSkepticCalls += 1;
    return { verdict: "plausible", objection: "unused" };
  },
});
assert.equal(dryRunSkepticCalls, 0, "dry-run mining must not invoke the skeptic");

// An injected skeptic annotates the enqueued proposal's metadata without
// gating it.
const skepticEnqueue = await reviewOperationalPatterns({
  enqueueProposals: true,
  skepticWithModel: async (candidate) => ({
    verdict: "weak",
    objection: `Only ${candidate.occurrenceCount} occurrences; could be coincidence.`,
  }),
});
const annotated = skepticEnqueue.enqueued.find((proposal) => proposal.title.includes("compact-vault-archives"));
assert.ok(annotated, "the skeptic never gates enqueue");
assert.equal(annotated.status, "pending");
assert.equal(annotated.metadata.skepticVerdict, "weak");
assert.match(annotated.metadata.skepticObjection, /could be coincidence/);

// A failing skeptic falls back to enqueueing with no annotation.
const fallbackTimes = ["2026-06-11T00:00:00.000Z", "2026-06-12T06:00:00.000Z", "2026-06-14T00:00:00.000Z"];
await appendFile(agentOperationalEventsPath(), `${fallbackTimes.map((occurredAt, index) => journalEvent({
  id: `op-rotate-${index}`,
  title: "Rotate backup snapshots",
  summary: `Rotated backup snapshot set ${index}.`,
  operationKey: "maintenance/rotate-backups",
  taskId: `rotate-${index}`,
  occurredAt,
})).join("\n")}\n`, "utf8");
const fallbackEnqueue = await reviewOperationalPatterns({
  enqueueProposals: true,
  skepticWithModel: async () => {
    throw new Error("skeptic offline");
  },
});
const fallback = fallbackEnqueue.enqueued.find((proposal) => proposal.title.includes("rotate-backups"));
assert.ok(fallback, "a failing skeptic must not gate enqueue");
assert.equal(fallback.metadata.skepticVerdict, undefined);
assert.equal(fallback.metadata.skepticObjection, undefined);

console.log("Agent Memory pattern review tests passed.");
