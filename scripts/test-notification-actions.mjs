#!/usr/bin/env node
// Hermetic: notification cards derive actionable buttons (deep links, send to
// Work Board, discuss with the Queen) from what each notification is about.
// Fixtures mirror the two real 2026-07-03 escalations that motivated the
// feature: a needs-human Work Board escalation and the company-driver
// empty-fleet alarm.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  deriveNotificationActions,
  notificationDiscussPrompt,
  notificationTaskId,
} = await import("../src/features/notifications/notification-actions.ts");
const { selectDiscussionChatAgent } = await import("../src/features/dashboard/chat-discuss-context.ts");

const base = {
  id: "n-1",
  kind: "alert",
  priority: "high",
  agentName: "Queen Bee",
  source: "escalation-bridge",
  createdAt: "2026-07-03T21:34:00.000Z",
};

const labels = (actions) => actions.map((a) => a.label);
const types = (actions) => actions.map((a) => a.type);

// ── needs-human escalation WITH the structured task tag ─────────────────────
{
  const actions = deriveNotificationActions({
    ...base,
    title: "Work is blocked on you",
    body: "Task: Verify outreach email deliverability setup\nCompany: Website Outreach Agency\nAgent: HermesMain\nFailure: timeout\nOpen the Work Board → \"Needs You\" to unblock (19 waiting total).",
    tags: ["escalation", "kanban", "needs-human", "task:t_mr4hb1ee_rrv9o"],
  });
  assert.equal(notificationTaskId({ ...base, title: "", body: "", tags: ["task:t_mr4hb1ee_rrv9o"] }), "t_mr4hb1ee_rrv9o");
  assert.deepEqual(actions[0], { type: "navigate", label: "Open task", target: { view: "kanban", taskId: "t_mr4hb1ee_rrv9o", openTask: true } }, "Open task deep-links (openTask reveals + opens the card, not just the view)");
  assert.ok(labels(actions).includes("Open Companies"), "company mention → companies deep link");
  assert.ok(!types(actions).includes("work-board"), "a notification about an existing task is not re-sent to the board");
  assert.ok(types(actions).includes("discuss"), "discuss is always offered");
}

// ── legacy needs-human escalation WITHOUT the task tag ───────────────────────
{
  const actions = deriveNotificationActions({
    ...base,
    title: "Work is blocked on you",
    body: "Task: Verify outreach email deliverability setup\nCompany: Website Outreach Agency\nOpen the Work Board → \"Needs You\" to unblock (19 waiting total).",
    tags: ["escalation", "kanban", "needs-human"],
  });
  assert.deepEqual(actions[0], { type: "navigate", label: "Open Work Board", target: { view: "kanban" } });
  assert.ok(labels(actions).includes("Open Companies"));
  assert.ok(types(actions).includes("work-board"), "no referenced task → offer send-to-board");
}

// ── company-driver empty-fleet alarm ─────────────────────────────────────────
{
  const actions = deriveNotificationActions({
    ...base,
    title: "Company autonomy driver can't see the fleet",
    body: "The driver's self-fetched fleet snapshot has been empty for 6 consecutive ticks, so no company can dispatch work.",
    tags: ["escalation", "company", "driver"],
  });
  assert.equal(actions[0].label, "Open Companies", "driver alarms lead with the companies view");
  assert.ok(labels(actions).includes("Open Fleet"), "fleet visibility problem → fleet view");
  assert.ok(types(actions).includes("work-board"));
  assert.ok(types(actions).includes("discuss"));
}

// ── spend approval ───────────────────────────────────────────────────────────
{
  const actions = deriveNotificationActions({
    ...base,
    title: "Spend approval needed",
    body: "Ada wants to spend ~$12.00.\nCompany: Website Outreach Agency\nApprove or deny in the dashboard (Companies → approvals, or Wallet).",
    tags: ["escalation", "wallet", "approval"],
  });
  assert.ok(labels(actions).includes("Open Wallet"));
  assert.ok(labels(actions).includes("Open Companies"));
  assert.ok(!types(actions).includes("work-board"), "approval alerts are direct human decisions, not Work Board tasks");
  assert.ok(types(actions).includes("discuss"));
}

// ── capability approval returns to the exact chat, never the wallet ─────────
{
  const actions = deriveNotificationActions({
    ...base,
    title: "Capability plan waiting: Build a launch page",
    body: "Queen Bee mapped the task to implementation and deployment.",
    source: "chat-capability-approval|queen-bee|agent-queen-bee%3A%3Alaunch-page",
    tags: ["approval", "capability-approval", "chat"],
  });
  assert.deepEqual(actions[0], {
    type: "navigate",
    label: "Review capability plan",
    target: { view: "chat", agentId: "queen-bee", chatLeaf: "agent-queen-bee::launch-page" },
  });
  assert.ok(!labels(actions).includes("Open Wallet"), "capability approvals belong to chat, not spend approval");
  assert.ok(!types(actions).includes("work-board"), "capability approval is already a direct decision");
}

// ── env / credential problems open the env setup panel ──────────────────────
{
  const actions = deriveNotificationActions({
    ...base,
    title: "Runner credential missing",
    body: "GOOGLE_MAPS_API_KEY looks billing-dead; set a working key in the shared .env to resume place lookups.",
    tags: ["escalation", "env"],
  });
  const env = actions.find((a) => a.label === "Open Env setup");
  assert.ok(env && env.type === "navigate" && env.target.view === "vault" && env.target.vaultPanel === "env");
}

// ── generic notification still gets the universal pair ──────────────────────
{
  const actions = deriveNotificationActions({
    ...base,
    title: "Daily digest ready",
    body: "Your morning digest is in the vault.",
    tags: [],
  });
  assert.deepEqual(types(actions), ["work-board", "discuss"]);
}

// ── a RESOLVED condition doesn't offer a follow-up board task ────────────────
{
  const actions = deriveNotificationActions({
    ...base,
    title: "Company autonomy driver can't see the fleet",
    body: "The driver's self-fetched fleet snapshot has been empty.",
    tags: ["escalation", "company", "driver"],
    resolution: { status: "resolved", note: "Fleet snapshot recovered.", updatedAt: "2026-07-03T21:03:00.000Z" },
  });
  assert.ok(!types(actions).includes("work-board"), "resolved → no send-to-board");
  assert.ok(types(actions).includes("discuss"), "discuss stays available");
  const inProgress = deriveNotificationActions({
    ...base,
    title: "Work is blocked on you",
    body: "Task: X",
    tags: ["kanban", "needs-human"],
    resolution: { status: "in-progress", updatedAt: "2026-07-03T21:03:00.000Z" },
  });
  assert.ok(inProgress.some((a) => a.type === "work-board"), "in-progress keeps send-to-board (may still need a human)");
}

// ── task id extraction from free text; navigate targets dedupe ──────────────
{
  assert.equal(
    notificationTaskId({ ...base, title: "Loop stuck", body: "Task t_mr3qihhn_zbuff needs a decision", tags: [] }),
    "t_mr3qihhn_zbuff",
  );
  const actions = deriveNotificationActions({
    ...base,
    title: "Company work board company",
    body: "company kanban work board company",
    tags: ["company", "kanban"],
  });
  const navKeys = actions.filter((a) => a.type === "navigate").map((a) => JSON.stringify(a.target));
  assert.equal(new Set(navKeys).size, navKeys.length, "navigate targets are deduped");
}

// ── discuss prompt carries the notification and trims huge bodies ────────────
{
  const prompt = notificationDiscussPrompt({ ...base, title: "Big body", body: "x".repeat(3000), tags: [] });
  assert.ok(prompt.includes("Big body"));
  assert.ok(prompt.length < 1400, "prompt stays chat-sized");
  assert.match(prompt, /next concrete action/);
}

// ── Discuss opens a fresh chat with a capability-compatible agent ───────────
{
  const queen = { id: "queen", beeRole: "queen", canChat: true };
  const unavailableQueen = { id: "unavailable-queen", beeRole: "queen", canChat: false };
  const selected = { id: "selected", beeRole: "worker", canChat: true };
  const fallback = { id: "fallback", beeRole: "worker", canChat: true };
  const canChat = (agent) => agent.canChat;

  assert.equal(selectDiscussionChatAgent([selected, queen, fallback], selected, canChat, "queen"), queen);
  assert.equal(
    selectDiscussionChatAgent([unavailableQueen, selected, fallback], selected, canChat, "unavailable-queen"),
    selected,
    "a non-chat Queen falls back to the user's current chat agent",
  );
  assert.equal(selectDiscussionChatAgent([unavailableQueen, fallback], null, canChat, "unavailable-queen"), fallback);
  assert.equal(selectDiscussionChatAgent([unavailableQueen], unavailableQueen, canChat, "unavailable-queen"), null);

  const dashboard = readFileSync(new URL("../src/features/dashboard/DashboardApp.tsx", import.meta.url), "utf8");
  const handlerStart = dashboard.indexOf("onDiscussInChat: (context: ChatDiscussContext, draft: string) => {");
  const handlerEnd = dashboard.indexOf("}, schedules,", handlerStart);
  assert.notEqual(handlerStart, -1, "the Alerts discussion bridge is wired at the dashboard boundary");
  assert.notEqual(handlerEnd, -1, "the Alerts discussion handler has a stable boundary");
  const handler = dashboard.slice(handlerStart, handlerEnd);
  assert.match(handler, /setChatDiscussContext\(context\)/, "the fresh chat retains the selected alert context");
  assert.match(handler, /setText\(draft \?\? ""\)/, "the fresh chat retains the editable discussion draft");
  assert.match(
    handler,
    /selectDiscussionChatAgent\(displayAgents, selectedAgent, \(agent\) => runtimeCan\(agent, "chat"\), QUEEN_BEE_AGENT_ID\)/,
    "the dashboard bridge selects a capability-compatible discussion agent",
  );
  assert.match(
    handler,
    /startAgentChat\(chatAgent\.id, \{ fresh: true \}\)/,
    "Discuss creates a fresh chat instead of selecting an existing conversation",
  );
  assert.doesNotMatch(handler, /navigateDashboardTarget\(\{ view: "chat"/);
}

console.log("PASS test-notification-actions");
