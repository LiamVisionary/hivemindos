#!/usr/bin/env node
// Hermetic test for approval-consolidation: look-alike work-approval cards
// collapse into one group by normalized intent, distinct intents stay separate,
// and non-approval views (wallet spends) never merge.
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { groupWorkApprovals, approvalIntentKey } = await import(
  "../src/features/dashboard/views/zero-human-companies/approval-consolidation.ts"
);

const view = (id, title, kind = "approval") => ({
  id,
  title,
  agent: "the crew",
  kind,
  risk: "high",
  reason: title,
});

try {
  // Same intent, different batch/count/target noise → ONE group.
  assert.equal(
    approvalIntentKey("Unblock queued outreach send (Batch 1)"),
    approvalIntentKey("Unblock queued outreach send (Batch 2)"),
    "batch-number noise doesn't split the intent key",
  );
  assert.equal(
    approvalIntentKey("Send 25 dated close asks"),
    approvalIntentKey("Send dated close asks"),
    "bare counts are stripped from the intent key",
  );

  const views = [
    view("a1", "Unblock queued outreach send (Batch 1)"),
    view("a2", "Unblock queued outreach send (Batch 2)"),
    view("a3", "Unblock queued outreach send"),
    view("b1", "Convert top demos into paid checkouts"),
    view("b2", "Convert demos into paid checkouts"),
    view("c1", "Launch compliant pitches to alternate prospects"),
    view("w1", "Send $1,200 to the ops wallet", "spend"),
    view("w2", "Send $3,000 to the ops wallet", "spend"),
  ];
  const groups = groupWorkApprovals(views);

  const byLabel = Object.fromEntries(groups.map((g) => [g.label, g.items.map((i) => i.id)]));

  // The three "Unblock queued outreach send" variants collapse into one group.
  const unblockGroup = groups.find((g) => g.items.some((i) => i.id === "a1"));
  assert.deepEqual(
    unblockGroup.items.map((i) => i.id).sort(),
    ["a1", "a2", "a3"],
    "the three unblock-send variants collapse into one group",
  );
  assert.equal(unblockGroup.label, "Unblock queued outreach send", "group label is the shortest member title");

  // The two "Convert … paid checkouts" variants collapse into one.
  const convertGroup = groups.find((g) => g.items.some((i) => i.id === "b1"));
  assert.deepEqual(convertGroup.items.map((i) => i.id).sort(), ["b1", "b2"], "convert variants collapse");

  // A distinct single-intent approval stays its own group (no false merge).
  const launchGroup = groups.find((g) => g.items.some((i) => i.id === "c1"));
  assert.equal(launchGroup.items.length, 1, "a distinct approval intent is its own group");

  // Wallet SPENDS never merge — each is its own singleton even with identical text shape.
  const spendGroups = groups.filter((g) => g.items.every((i) => i.kind === "spend"));
  assert.equal(spendGroups.length, 2, "two spend approvals stay as two separate groups");
  assert.ok(spendGroups.every((g) => g.items.length === 1), "spend approvals are never grouped");

  // 8 views → 4 groups (unblock×3, convert×2, launch×1, spend×1, spend×1) = 5 groups actually.
  assert.equal(groups.length, 5, "8 views consolidate to 5 groups");
  // Every input view is represented exactly once.
  const allIds = groups.flatMap((g) => g.items.map((i) => i.id)).sort();
  assert.deepEqual(allIds, ["a1", "a2", "a3", "b1", "b2", "c1", "w1", "w2"], "no view is dropped or duplicated");

  void byLabel;
  console.log("approval consolidation tests passed");
} catch (err) {
  console.error(err);
  process.exit(1);
}
