#!/usr/bin/env node
// Hermetic: the needs-human triage layer that keeps the operator's decision
// surfaces honest — (1) pending "human-input" proposals settle when their Work
// Board task moves on (done/archived/rescued/gone/expired), and (2) at volume,
// per-task escalation collapses into ONE per-company daily digest instead of
// one severity-high card+ping per blocked task (the measured overload
// mechanism: 115 daily events from one company, 859 accumulated cards).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-needs-human-triage-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-needs-human-triage-vault-"));
process.env.HOME = tempHome;

const { reconcileProposalAgainstTask, reconcileCompanyProposals } = await import("../src/lib/services/company-needs-human-triage.ts");
const { notifyEscalation, runEscalationSweep } = await import("../src/lib/services/messaging/escalation-notify.ts");
const { listAgentNotifications } = await import("../src/lib/services/obsidian/agent-notifications.ts");
const { createTask, moveTask } = await import("../src/lib/services/kanban/local-kanban-store.ts");

const NOW = Date.parse("2026-07-16T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const pendingProposal = (over = {}) => ({
  id: "cprop_1",
  kind: "human-input",
  status: "pending",
  createdAt: new Date(NOW - DAY).toISOString(),
  sourceTaskId: "t_1",
  idempotencyKey: "task-human:t_1",
  ...over,
});

// ── pure reconcile table ─────────────────────────────────────────────────────
assert.equal(
  reconcileProposalAgainstTask(pendingProposal(), { status: "needs-human" }, NOW),
  null,
  "a live ask stays pending",
);
assert.equal(reconcileProposalAgainstTask(pendingProposal(), { status: "done" }, NOW)?.status, "applied", "completed task → applied");
assert.equal(reconcileProposalAgainstTask(pendingProposal(), { status: "archived" }, NOW)?.status, "superseded", "archived task → superseded");
assert.equal(reconcileProposalAgainstTask(pendingProposal(), { status: "ready" }, NOW)?.status, "superseded", "re-queued task → superseded");
assert.equal(reconcileProposalAgainstTask(pendingProposal(), { status: "working" }, NOW)?.status, "superseded", "picked-up task → superseded");
assert.equal(reconcileProposalAgainstTask(pendingProposal(), null, NOW)?.status, "superseded", "vanished task → superseded");
assert.equal(
  reconcileProposalAgainstTask(pendingProposal({ createdAt: new Date(NOW - 20 * DAY).toISOString() }), { status: "needs-human" }, NOW)?.status,
  "superseded",
  "an ask unanswered past the TTL expires (the board card remains the live surface)",
);
assert.equal(
  reconcileProposalAgainstTask(pendingProposal({ status: "applied" }), { status: "done" }, NOW),
  null,
  "already-settled proposals are never touched",
);
assert.equal(
  reconcileProposalAgainstTask(pendingProposal({ kind: "pricing-change" }), null, NOW),
  null,
  "non task-mirroring kinds (pricing etc.) are the human's to decide, never auto-settled",
);

// ── sweep with injected ledger ───────────────────────────────────────────────
{
  const settled = [];
  const result = await reconcileCompanyProposals(
    [{ id: "co_1" }],
    [
      { id: "t_done", status: "done" },
      { id: "t_blocked", status: "needs-human" },
    ],
    {
      listLedger: async () => ({
        proposals: [
          pendingProposal({ id: "p_done", sourceTaskId: "t_done", idempotencyKey: "task-human:t_done" }),
          pendingProposal({ id: "p_live", sourceTaskId: "t_blocked", idempotencyKey: "task-human:t_blocked" }),
          pendingProposal({ id: "p_gone", sourceTaskId: "t_vanished", idempotencyKey: "task-human:t_vanished" }),
        ],
      }),
      settle: async (companyId, proposalId, input) => {
        settled.push({ companyId, proposalId, status: input.status });
        return { id: proposalId };
      },
      now: NOW,
    },
  );
  assert.equal(result.settled, 2, "done + vanished settle; the live ask stays");
  assert.deepEqual(
    settled.map((s) => s.proposalId).sort(),
    ["p_done", "p_gone"],
    "exactly the moved-on proposals were settled",
  );
  assert.equal(settled.find((s) => s.proposalId === "p_done")?.status, "applied");
  assert.equal(settled.find((s) => s.proposalId === "p_gone")?.status, "superseded");
}

// ── digest behavior against a real temp board + vault ────────────────────────
// NOTE: tasks here carry no company: source (readCompanies() in the sweep reads
// the real store, which is empty under the temp HOME), so they group under the
// "board" bucket — same digest mechanics, no company fixture needed.
const options = { vaultPath };
try {
  const ids = [];
  for (let i = 0; i < 5; i += 1) {
    const { task } = await createTask(null, { title: `Blocked item ${i}`, body: "needs an answer" }, options);
    await moveTask(null, task.id, "needs-human", options);
    ids.push(task.id);
  }
  await runEscalationSweep(options);
  let list = await listAgentNotifications({ ...options, limit: 100 });
  const digestCards = list.notifications.filter((n) => n.tags?.includes("needs-human-digest"));
  const perTaskCards = list.notifications.filter((n) => (n.tags ?? []).some((t) => t.startsWith("task:")) && n.resolution?.status !== "resolved");
  assert.equal(digestCards.length, 1, "5 blocked tasks over the threshold → exactly ONE digest card");
  assert.match(digestCards[0].body, /5 Work Board tasks are waiting/, "digest counts the pile");
  assert.equal(perTaskCards.length, 0, "no live per-task cards while the digest carries them");

  // Re-sweep within TTL: still one digest card (card reuse, no re-mint).
  await runEscalationSweep(options);
  list = await listAgentNotifications({ ...options, limit: 100 });
  assert.equal(
    list.notifications.filter((n) => n.tags?.includes("needs-human-digest") && n.resolution?.status !== "resolved").length,
    1,
    "TTL re-fires must not mint duplicate digest cards",
  );

  // Drain the pile below the threshold → digest resolves itself.
  for (const id of ids.slice(0, 3)) await moveTask(null, id, "done", options);
  await runEscalationSweep(options);
  list = await listAgentNotifications({ ...options, limit: 100 });
  const resolvedDigest = list.notifications.find((n) => n.tags?.includes("needs-human-digest"));
  assert.equal(resolvedDigest?.resolution?.status, "resolved", "pile drained under threshold → digest card resolves");
  const liveTaskCards = list.notifications.filter((n) => (n.tags ?? []).some((t) => t.startsWith("task:")) && n.resolution?.status !== "resolved");
  assert.equal(liveTaskCards.length, 2, "the two still-blocked tasks get individual cards again");

  console.log("PASS test-company-needs-human-triage");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);
