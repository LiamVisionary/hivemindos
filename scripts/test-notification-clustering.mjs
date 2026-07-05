#!/usr/bin/env node
// Hermetic: look-alike notifications collapse into paged clusters so a batch of
// identical escalations — the 18 "Work is blocked on you" cards one escalation
// sweep mints — reads as ONE card the operator pages through, not a wall of
// near-duplicates. Fixtures mirror the real 2026-07-04 escalation storm.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { clusterNotifications } = await import(
  "../src/features/notifications/notification-clustering.ts"
);

const base = {
  kind: "alert",
  priority: "high",
  agentName: "Queen Bee",
  source: "escalation-bridge",
  read: false,
  tags: ["escalation", "needs-human"],
};

const blocked = (id, task) => ({
  ...base,
  id,
  title: "Work is blocked on you",
  body: `Task: ${task}\nOpen the Work Board → "Needs You" to unblock (18 waiting total).`,
  createdAt: "2026-07-04T20:30:00.000Z",
});

// ── 18 identical-title escalations collapse into ONE cluster ────────────────
{
  const items = Array.from({ length: 18 }, (_, i) => blocked(`n-${i}`, `Loop Eval ${i}`));
  const clusters = clusterNotifications(items);
  assert.equal(clusters.length, 1, "same title+source+priority+kind → single cluster");
  assert.equal(clusters[0].items.length, 18, "the cluster carries every collapsed item");
  // Pager math the panel renders: "activeIndex+1 / total" and "+{total-1} similar".
  assert.equal(`${1}/${clusters[0].items.length}`, "1/18");
  assert.equal(`+${clusters[0].items.length - 1} similar`, "+17 similar");
}

// ── distinct alert TYPES stay in their own clusters, order preserved ────────
{
  const items = [
    blocked("n-1", "A"),
    { ...base, id: "n-2", title: "Spend approval needed", body: "…", createdAt: "2026-07-04T20:31:00.000Z", tags: ["wallet"] },
    blocked("n-3", "B"),
  ];
  const clusters = clusterNotifications(items);
  assert.equal(clusters.length, 2, "different titles → different clusters");
  assert.equal(clusters[0].key === clusters[1].key, false, "cluster keys are distinct");
  assert.deepEqual(clusters[0].items.map((n) => n.id), ["n-1", "n-3"], "same-title items merge across a gap, first-appearance order kept");
  assert.deepEqual(clusters[1].items.map((n) => n.id), ["n-2"]);
  assert.equal(clusters[0].items === clusters[1].items, false);
}

// ── priority/source differences do NOT merge (they read as different alerts) ─
{
  const items = [
    blocked("n-1", "A"),
    { ...blocked("n-2", "B"), priority: "urgent" },
    { ...blocked("n-3", "C"), source: "company-driver" },
  ];
  const clusters = clusterNotifications(items);
  assert.equal(clusters.length, 3, "priority or source difference splits the stack");
}

// ── a lone notification is a singleton cluster (rendered un-paged) ──────────
{
  const clusters = clusterNotifications([blocked("solo", "only one")]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].items.length, 1, "singletons stay singletons");
}

// ── same-machine Hermes sign-outs merge; different machines stay split ──────
// Raw title (not display title) carries the machine name, so per-machine
// sign-out cards do NOT over-collapse into one stack.
{
  const authBase = { ...base, kind: "system", tags: ["auth", "hermes"] };
  const items = [
    { ...authBase, id: "a-1", title: "Hermes auth failed on hel1-2", body: "…", createdAt: "2026-07-04T20:30:00.000Z" },
    { ...authBase, id: "a-2", title: "Hermes auth failed on nyc-mac", body: "…", createdAt: "2026-07-04T20:30:00.000Z" },
    { ...authBase, id: "a-3", title: "Hermes auth failed on hel1-2", body: "…", createdAt: "2026-07-04T20:31:00.000Z" },
  ];
  const clusters = clusterNotifications(items);
  assert.equal(clusters.length, 2, "distinct machines in the title → distinct clusters");
  assert.deepEqual(clusters[0].items.map((n) => n.id), ["a-1", "a-3"], "same machine collapses");
  assert.deepEqual(clusters[1].items.map((n) => n.id), ["a-2"]);
}

// ── empty input is a no-op ──────────────────────────────────────────────────
assert.deepEqual(clusterNotifications([]), [], "no notifications → no clusters");

console.log("notification-clustering: all assertions passed");
