#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-social-queue-engine-"));
const tempVault = join(tempHome, "vault");
await mkdir(tempVault, { recursive: true });
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = tempVault;
process.env.HIVEMINDOS_SOCIAL_QUEUE_DRIVER_LEASE = "0";

const store = await import("../src/lib/services/socials/socials-store.ts");
const domain = await import("../src/lib/services/socials/social-queue-domain.ts");
const { SocialPostError } = await import("../src/lib/services/socials/adapters/types.ts");
const { runSocialQueueTickNow } = await import("../src/lib/services/socials/social-queue-engine.ts");
const deliveryOnly = { draftingImpl: async () => ({ generated: [], failed: [], skipped: [] }) };

const created = await store.createSocialAccount({ platform: "x", handle: "queue-test", method: "api-token" });
const account = await store.updateSocialAccount(created.id, (current) => ({ ...current, status: "connected" }));
const draft = domain.createQueueItem({ account, text: "approved post", origin: "human", now: new Date("2026-07-20T12:00:00.000Z") });
const approved = domain.transitionQueueItem(draft, "approved", { by: "human", now: new Date("2026-07-20T12:01:00.000Z") });
const suggestion = domain.createQueueItem({ account, text: "agent suggestion", origin: "agent", now: new Date("2026-07-20T12:02:00.000Z") });
await store.mutateSocialQueue(() => [approved, suggestion]);

const postedIds = [];
const first = await runSocialQueueTickNow({
  ...deliveryOnly,
  now: new Date("2026-07-20T13:00:00.000Z"),
  env: {},
  connectionProbeImpl: async () => ({ ok: true, detail: "test" }),
  postImpl: async (item) => {
    postedIds.push(item.id);
    return { externalId: "external-1", url: "https://example.com/external-1" };
  },
});
assert.equal(first.held, true);
assert.deepEqual(postedIds, [approved.id]);
let queue = await store.readSocialQueue();
assert.equal(queue.find((item) => item.id === approved.id)?.state, "posted");
assert.equal(queue.find((item) => item.id === suggestion.id)?.state, "suggested", "unapproved suggestion remains untouched");
assert.ok((await store.readSocialQueueMeta()).lastTickAt);

// A crash after persisting `posting` is never guessed safe to retry.
const stale = {
  ...approved,
  id: "social_stale",
  state: "posting",
  result: undefined,
  delivery: { idempotencyKey: "social_stale", attempt: 1, startedAt: "2026-07-20T10:00:00.000Z" },
  stateHistory: [...approved.stateHistory, { state: "posting", at: "2026-07-20T10:00:00.000Z", by: "tick" }],
};
await store.mutateSocialQueue((items) => [...items, stale]);
await runSocialQueueTickNow({
  ...deliveryOnly,
  now: new Date("2026-07-20T13:00:00.000Z"),
  env: {},
  connectionProbeImpl: async () => ({ ok: true, detail: "test" }),
  postImpl: async () => { throw new Error("must not resend stale delivery"); },
});
queue = await store.readSocialQueue();
const recovered = queue.find((item) => item.id === stale.id);
assert.equal(recovered?.state, "failed");
assert.equal(recovered?.failure?.kind, "ambiguous");
assert.equal(recovered?.failure?.retryable, false);

// A provider-declared, definite temporary failure retries with bounded backoff.
const retryDraft = domain.createQueueItem({ account, text: "retry me", origin: "human", now: new Date("2026-07-20T13:00:00.000Z") });
const retryApproved = domain.transitionQueueItem(retryDraft, "approved", { by: "human", now: new Date("2026-07-20T13:00:00.000Z") });
await store.mutateSocialQueue((items) => [...items, retryApproved]);
let retryCalls = 0;
await runSocialQueueTickNow({
  ...deliveryOnly,
  now: new Date("2026-07-20T13:01:00.000Z"),
  env: {},
  connectionProbeImpl: async () => ({ ok: true, detail: "test" }),
  postImpl: async () => {
    retryCalls += 1;
    throw new SocialPostError("provider busy", { retryable: true, ambiguous: false });
  },
});
queue = await store.readSocialQueue();
const retryScheduled = queue.find((item) => item.id === retryApproved.id);
assert.equal(retryScheduled?.state, "scheduled");
assert.equal(retryScheduled?.failure?.kind, "definite");
assert.equal(retryScheduled?.retryAt, "2026-07-20T13:01:30.000Z");
await runSocialQueueTickNow({
  ...deliveryOnly,
  now: new Date("2026-07-20T13:01:29.000Z"),
  env: {},
  connectionProbeImpl: async () => ({ ok: true, detail: "test" }),
  postImpl: async () => { throw new Error("retry fired too early"); },
});
assert.equal(retryCalls, 1);
await runSocialQueueTickNow({
  ...deliveryOnly,
  now: new Date("2026-07-20T13:01:30.000Z"),
  env: {},
  connectionProbeImpl: async () => ({ ok: true, detail: "test" }),
  postImpl: async () => ({ externalId: "retry-success" }),
});
queue = await store.readSocialQueue();
assert.equal(queue.find((item) => item.id === retryApproved.id)?.state, "posted");

// An unknown transport failure is never auto-retried because delivery may have happened.
const unknownDraft = domain.createQueueItem({ account, text: "unknown", origin: "human", now: new Date("2026-07-20T14:00:00.000Z") });
const unknownApproved = domain.transitionQueueItem(unknownDraft, "approved", { by: "human", now: new Date("2026-07-20T14:00:00.000Z") });
await store.mutateSocialQueue((items) => [...items, unknownApproved]);
await runSocialQueueTickNow({
  ...deliveryOnly,
  now: new Date("2026-07-20T14:01:00.000Z"),
  env: {},
  connectionProbeImpl: async () => ({ ok: true, detail: "test" }),
  postImpl: async () => { throw new Error("socket reset"); },
});
queue = await store.readSocialQueue();
const unknownFailed = queue.find((item) => item.id === unknownApproved.id);
assert.equal(unknownFailed?.state, "failed");
assert.equal(unknownFailed?.failure?.kind, "ambiguous");
assert.equal(unknownFailed?.retryAt, undefined);

// Future work does not hammer provider auth/status endpoints every five seconds.
const futureDraft = domain.createQueueItem({ account, text: "later", origin: "human", now: new Date("2026-07-20T14:10:00.000Z") });
const futureScheduled = domain.transitionQueueItem(futureDraft, "scheduled", {
  by: "human",
  now: new Date("2026-07-20T14:10:00.000Z"),
  scheduledFor: "2026-07-20T15:00:00.000Z",
});
await store.mutateSocialQueue((items) => [...items, futureScheduled]);
let futureProbeCalls = 0;
await runSocialQueueTickNow({
  ...deliveryOnly,
  now: new Date("2026-07-20T14:30:00.000Z"),
  env: {},
  connectionProbeImpl: async () => {
    futureProbeCalls += 1;
    return { ok: true, detail: "test" };
  },
  postImpl: async () => { throw new Error("future item posted too early"); },
});
assert.equal(futureProbeCalls, 0);
const runtimeBeforeIdleTick = await readFile(store.SOCIALS_RUNTIME_PATH, "utf8");
await runSocialQueueTickNow({
  ...deliveryOnly,
  now: new Date("2026-07-20T14:30:05.000Z"),
  env: {},
  connectionProbeImpl: async () => { throw new Error("future item should not be probed"); },
  postImpl: async () => { throw new Error("future item posted too early"); },
});
assert.equal(
  await readFile(store.SOCIALS_RUNTIME_PATH, "utf8"),
  runtimeBeforeIdleTick,
  "an idle sub-minute tick does not rewrite or rotate the durable runtime file",
);

console.log("social queue engine tests passed");
