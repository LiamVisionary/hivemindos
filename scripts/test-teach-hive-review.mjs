#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-teach-hive-"));
process.env.HOME = tempHome;

try {
  const { maybeCreateTeachHiveReviewProposal } = await import("../src/lib/services/chat/teach-hive.ts");
  const { readBrainReviewQueue } = await import("../src/lib/services/brain-review-queue.ts");
  const { localAdminPrincipal } = await import("../src/lib/types/principal.ts");

  const skipped = await maybeCreateTeachHiveReviewProposal({
    userPrompt: "what can you do with github?",
    principal: localAdminPrincipal("tester", "session"),
  });
  assert.equal(skipped, null);

  const proposal = await maybeCreateTeachHiveReviewProposal({
    userPrompt: "Please remember that dashboard capability metadata belongs in the Context Index.",
    principal: localAdminPrincipal("tester", "session"),
    runtimeSessionId: "session-1",
    chatStorageKey: "thread-1",
  });
  assert.ok(proposal);
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.kind, "memory");
  assert.equal(proposal.createdByPrincipalId, "tester");
  assert.match(proposal.proposedContent, /Context Index/);

  const queue = await readBrainReviewQueue();
  assert.equal(queue.proposals.length, 1);
  assert.equal(queue.proposals[0].appliedMemoryId, undefined);

  console.log("Teach Hive review proposal tests passed.");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
