#!/usr/bin/env node
// Hermetic: notifications that report self-healing conditions carry a
// resolution lifecycle — "resolution in progress" while remediation retries,
// "resolved" once the condition cleared, cleared again if it bounces back.
// Covers the sidecar service, the escalation bridge's key→card mapping (incl.
// the duplicate-card and same-title-overwrite fixes), and the needs-human
// sweep transitions against a real temp Work Board.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-notif-resolution-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-notif-resolution-vault-"));
process.env.HOME = tempHome;

const {
  createAgentNotification,
  listAgentNotifications,
  setAgentNotificationResolution,
} = await import("../src/lib/services/obsidian/agent-notifications.ts");
const {
  needsHumanResolutionFor,
  notifyEscalation,
  resolveEscalationNotification,
  resolveSpendApprovalEscalationNotifications,
  runEscalationSweep,
} = await import("../src/lib/services/messaging/escalation-notify.ts");
const { createTask, moveTask } = await import("../src/lib/services/kanban/local-kanban-store.ts");

const options = { vaultPath };

try {
  // ── pure transition table ──────────────────────────────────────────────────
  assert.equal(needsHumanResolutionFor("needs-human"), null, "still blocked → escalation stays live");
  assert.equal(needsHumanResolutionFor("ready")?.status, "in-progress");
  assert.equal(needsHumanResolutionFor("working")?.status, "in-progress");
  assert.equal(needsHumanResolutionFor("done")?.status, "resolved");
  assert.equal(needsHumanResolutionFor("archived")?.status, "resolved");
  assert.equal(needsHumanResolutionFor(null)?.status, "resolved", "task gone → resolved");

  // ── sidecar service ────────────────────────────────────────────────────────
  const created = await createAgentNotification({ title: "Sidecar check", body: "body", agentName: "Test" }, options);
  assert.ok(created.id, "createAgentNotification returns the created id");
  assert.equal(await setAgentNotificationResolution(created.id, { status: "in-progress", note: "retrying" }, options), true);
  assert.equal(
    await setAgentNotificationResolution(created.id, { status: "in-progress", note: "retrying" }, options),
    false,
    "identical stamp is a no-op (sweeps must not rewrite every tick)",
  );
  let list = await listAgentNotifications(options);
  let note = list.notifications.find((n) => n.id === created.id);
  assert.equal(note?.resolution?.status, "in-progress");
  assert.equal(note?.resolution?.note, "retrying");
  await setAgentNotificationResolution(created.id, { status: "resolved", note: "done" }, options);
  list = await listAgentNotifications(options);
  assert.equal(list.notifications.find((n) => n.id === created.id)?.resolution?.status, "resolved");
  await setAgentNotificationResolution(created.id, null, options);
  list = await listAgentNotifications(options);
  assert.equal(list.notifications.find((n) => n.id === created.id)?.resolution, undefined, "clearing removes the stamp");

  // ── escalation bridge: key→card mapping + duplicate-card gate ─────────────
  const before = (await listAgentNotifications(options)).total;
  await notifyEscalation({ key: "demo:incident-1", title: "Same title", body: "first", severity: "high" }, options);
  await notifyEscalation({ key: "demo:incident-1", title: "Same title", body: "retry within ttl", severity: "high" }, options);
  await notifyEscalation({ key: "demo:incident-2", title: "Same title", body: "different incident", severity: "high" }, options);
  const after = await listAgentNotifications(options);
  assert.equal(after.total - before, 2, "one card per incident key: no dupes within TTL, no same-title overwrite across keys");

  assert.equal(
    await resolveEscalationNotification("demo:incident-1", { status: "resolved", note: "self-healed" }, options),
    true,
  );
  const resolvedCard = (await listAgentNotifications(options)).notifications.find((n) => n.body === "first");
  assert.equal(resolvedCard?.resolution?.status, "resolved");
  assert.equal(resolvedCard?.resolution?.by, "escalation-bridge");
  const otherCard = (await listAgentNotifications(options)).notifications.find((n) => n.body === "different incident");
  assert.equal(otherCard?.resolution, undefined, "resolving one key never touches another key's card");
  assert.equal(await resolveEscalationNotification("demo:never-sent", { status: "resolved" }, options), false);

  // ── spend approvals: decision resolves both normal + expiry alert cards ────
  await notifyEscalation({ key: "approval:approval-123", title: "Spend approval needed", body: "normal approval card", severity: "high", tags: ["wallet", "approval"] }, options);
  await notifyEscalation({ key: "approval-expiring:approval-123", title: "Spend approval about to expire", body: "expiry approval card", severity: "urgent", tags: ["wallet", "approval"] }, options);
  assert.equal(
    await resolveSpendApprovalEscalationNotifications("approval-123", "denied", options),
    true,
    "decision resolves at least one spend-approval notification",
  );
  list = await listAgentNotifications(options);
  const normalApproval = list.notifications.find((n) => n.body === "normal approval card");
  const expiringApproval = list.notifications.find((n) => n.body === "expiry approval card");
  assert.equal(normalApproval?.resolution?.status, "resolved");
  assert.equal(expiringApproval?.resolution?.status, "resolved");
  assert.equal(normalApproval?.read, true, "resolved approval card is marked read");
  assert.equal(expiringApproval?.read, true, "resolved expiry card is marked read");

  // ── needs-human sweep against a real temp board ────────────────────────────
  const { task } = await createTask(null, { title: "Blocked deliverable", body: "needs a decision" }, options);
  await notifyEscalation({ key: `task-needs-human:${task.id}`, title: "Work is blocked on you", body: "Task: Blocked deliverable", severity: "high", tags: ["kanban", "needs-human", `task:${task.id}`] }, options);

  // ready → the sweep stamps "resolution in progress"
  await moveTask(null, task.id, "ready", options);
  await runEscalationSweep(options);
  let card = (await listAgentNotifications(options)).notifications.find((n) => n.title === "Work is blocked on you");
  assert.equal(card?.resolution?.status, "in-progress", "re-dispatched (ready) task → in progress");

  // bounced back to needs-human → the stamp clears (card reads live again)
  await moveTask(null, task.id, "needs-human", options);
  await runEscalationSweep(options);
  card = (await listAgentNotifications(options)).notifications.find((n) => n.title === "Work is blocked on you");
  assert.equal(card?.resolution, undefined, "blocked again → resolution cleared");

  // done → resolved
  await moveTask(null, task.id, "done", options);
  await runEscalationSweep(options);
  card = (await listAgentNotifications(options)).notifications.find((n) => n.title === "Work is blocked on you");
  assert.equal(card?.resolution?.status, "resolved", "completed task → resolved");

  // ── bulk janitor: resolve-stale task cards ─────────────────────────────────
  {
    const { resolveStaleTaskNotifications } = await import("../src/lib/services/obsidian/agent-notifications.ts");
    // Historical re-mints: two cards for the same STALE task (only the newest
    // would ever get a lifecycle stamp), one card for a still-live task, one
    // unrelated non-task card that must never be touched.
    await createAgentNotification({ id: "task-needs-human-t_stale_1-aaa111", title: "Work is blocked on you", body: "old mint", tags: ["escalation", "task:t_stale_1"] }, options);
    await createAgentNotification({ id: "task-needs-human-t_stale_1-bbb222", title: "Work is blocked on you", body: "new mint", tags: ["escalation", "task:t_stale_1"] }, options);
    await createAgentNotification({ id: "task-needs-human-t_live_1-ccc333", title: "Work is blocked on you", body: "live", tags: ["escalation", "task:t_live_1"] }, options);
    // Id-prefix fallback: no task tag, id carries the task (underscored id + stamp suffix).
    await createAgentNotification({ id: "task-needs-human-t_stale_2-ddd444", title: "Work is blocked on you", body: "untagged", tags: ["escalation"] }, options);
    await createAgentNotification({ id: "unrelated-card-eee555", title: "Weekly report", body: "fyi", tags: ["report"] }, options);

    const janitor = await resolveStaleTaskNotifications(["t_live_1"], options);
    assert.equal(janitor.resolved, 3, "both stale re-mints + the untagged stale card resolve in one pass");

    const byId = new Map((await listAgentNotifications({ ...options, limit: 100 })).notifications.map((n) => [n.id, n]));
    assert.equal(byId.get("task-needs-human-t_stale_1-aaa111")?.resolution?.status, "resolved", "historical re-mint resolves too");
    assert.equal(byId.get("task-needs-human-t_stale_1-aaa111")?.read, true, "janitor marks stale cards read");
    assert.equal(byId.get("task-needs-human-t_stale_1-bbb222")?.resolution?.status, "resolved");
    assert.equal(byId.get("task-needs-human-t_stale_2-ddd444")?.resolution?.status, "resolved", "id-prefix fallback matches untagged cards");
    assert.equal(byId.get("task-needs-human-t_live_1-ccc333")?.resolution, undefined, "live task card stays untouched");
    assert.equal(byId.get("task-needs-human-t_live_1-ccc333")?.read, false, "live task card stays unread");
    assert.equal(byId.get("unrelated-card-eee555")?.resolution, undefined, "non-task cards are never janitored");

    const second = await resolveStaleTaskNotifications(["t_live_1"], options);
    assert.equal(second.resolved, 0, "second pass is a no-op — already resolved+read cards are skipped");
  }

  console.log("PASS test-notification-resolution");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);
