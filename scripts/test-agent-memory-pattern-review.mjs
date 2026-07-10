import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-memory-pattern-review-"));
process.env.HOME = tempHome;

const { recordAgentOperationalEvent } = await import("../src/lib/services/obsidian/agent-memory/events.ts");
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

const secondEnqueue = await reviewOperationalPatterns({ enqueueProposals: true });
assert.equal(secondEnqueue.enqueued.length, 0, "the same mined pattern should not enqueue twice");
assert.deepEqual(secondEnqueue.skippedExisting, ["repeated-operation:content/product-release-brief"]);
assert.equal((await readBrainReviewQueue()).proposals.length, 1);

console.log("Agent Memory pattern review tests passed.");
