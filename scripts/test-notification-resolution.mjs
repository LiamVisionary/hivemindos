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

  console.log("PASS test-notification-resolution");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);
