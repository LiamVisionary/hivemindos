import assert from "node:assert/strict";

import {
  createQueueItem,
  isInsideAwakeHours,
  nextAwakeInstant,
  queueItemReadyToPost,
  retryDelayMs,
  transitionQueueItem,
  validAwakeHoursConfiguration,
} from "../src/lib/services/socials/social-queue-domain.ts";

const account = {
  id: "x:test",
  platform: "x",
  handle: "test",
  method: "managed-oauth",
  status: "connected",
  postingMode: "manual",
  awakeHours: {
    enabled: true,
    start: "09:00",
    end: "17:00",
    timezone: "America/New_York",
    days: [1, 2, 3, 4, 5],
  },
  contextSources: [],
  maxDailyReadOps: 20,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

assert.equal(isInsideAwakeHours(account.awakeHours, new Date("2026-07-20T14:00:00.000Z")), true, "10am New York is awake");
assert.equal(isInsideAwakeHours(account.awakeHours, new Date("2026-07-20T23:00:00.000Z")), false, "7pm New York is asleep");
assert.equal(validAwakeHoursConfiguration(account.awakeHours), true);
assert.equal(validAwakeHoursConfiguration({ ...account.awakeHours, days: [1, 1] }), false, "duplicate days are rejected");
assert.equal(
  nextAwakeInstant(account.awakeHours, new Date("2026-07-17T22:00:00.000Z")).toISOString(),
  "2026-07-20T13:00:00.000Z",
  "Friday after close advances across the weekend",
);

const draft = createQueueItem({ account, text: "Ship it", origin: "human", now: new Date("2026-07-20T12:00:00.000Z") });
assert.equal(draft.state, "draft");
assert.equal(queueItemReadyToPost(draft, account, new Date("2026-07-20T14:00:00.000Z")).ready, false, "drafts never fire");

const approved = transitionQueueItem(draft, "approved", { by: "human", now: new Date("2026-07-20T13:30:00.000Z") });
assert.equal(approved.approval?.by, "human");
assert.equal(queueItemReadyToPost(approved, account, new Date("2026-07-20T14:00:00.000Z")).ready, true);
const invalidHoursReadiness = queueItemReadyToPost(
  approved,
  { ...account, awakeHours: { ...account.awakeHours, timezone: "Not/A_Real_Zone" } },
  new Date("2026-07-20T14:00:00.000Z"),
);
assert.deepEqual(invalidHoursReadiness, { ready: false, reason: "Awake-hours configuration is invalid." });

const scheduled = transitionQueueItem(approved, "scheduled", {
  by: "human",
  now: new Date("2026-07-20T13:31:00.000Z"),
  scheduledFor: "2026-07-20T15:00:00.000Z",
});
assert.equal(queueItemReadyToPost(scheduled, account, new Date("2026-07-20T14:59:59.000Z")).ready, false);
assert.equal(queueItemReadyToPost(scheduled, account, new Date("2026-07-20T15:00:00.000Z")).ready, true);

const autoAccount = {
  ...account,
  postingMode: "auto",
  autoOptIn: { enabledAt: "2026-07-20T12:00:00.000Z", enabledBy: "human" },
};
const suggestion = createQueueItem({
  account: autoAccount,
  text: "Auto with guardrails",
  origin: "agent",
  now: new Date("2026-07-20T13:00:00.000Z"),
  autoCancelWindowMs: 300_000,
});
assert.equal(suggestion.state, "scheduled");
assert.equal(suggestion.approval?.by, "auto-mode");
assert.equal(suggestion.cancelWindowEndsAt, "2026-07-20T13:05:00.000Z");
assert.equal(queueItemReadyToPost(suggestion, autoAccount, new Date("2026-07-20T13:04:59.000Z")).ready, false);
assert.equal(queueItemReadyToPost(suggestion, autoAccount, new Date("2026-07-20T13:05:00.000Z")).ready, true);
assert.equal(queueItemReadyToPost(suggestion, { ...autoAccount, postingMode: "manual", autoOptIn: undefined }, new Date("2026-07-20T13:06:00.000Z")).ready, false, "revoking opt-in fails closed at fire time");

assert.throws(() => transitionQueueItem(draft, "posted", { by: "human", now: new Date() }), /Invalid social queue transition/);
assert.equal(retryDelayMs(1), 30_000);
assert.equal(retryDelayMs(10), 15 * 60_000, "retry backoff is capped");

console.log("social queue domain tests passed");
