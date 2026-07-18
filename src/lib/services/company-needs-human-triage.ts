import "server-only";

import { listCompanyRuns, settleCompanyProposal } from "@/lib/services/company-runs";
import type { CompanyProposal } from "@/lib/types/company-runs";
import type { KanbanTask } from "@/lib/types/kanban";

// Reconcile the company proposal ledger with Work Board reality.
//
// Every needs-human task mints a "human-input" proposal (company-memory.ts),
// but until this sweep existed the ONLY settle path was task completion — a
// task that got archived, re-queued, rescued, or deleted left its proposal
// pending forever. Measured live 2026-07-16: 113 of WEBS's 120 human-input
// proposals were pending, 75 of them mirroring infra failures the rescue sweep
// re-queues on its own. Three surfaces then advertised the same stale ask
// (proposal + board card + escalation ping). The Work Board task is the single
// source of truth; a proposal is a VIEW of it and must follow its lifecycle.
//
// Runs every driver tick, after task outcomes fold into memory. Pure decision
// logic is exported separately so the sweep is hermetically testable.

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Pending human-input proposals older than this auto-expire (default 14d). */
function proposalTtlMs(): number {
  const parsed = Number.parseFloat(process.env.HIVEMINDOS_COMPANY_PROPOSAL_TTL_DAYS ?? "");
  return (Number.isFinite(parsed) && parsed > 0 ? parsed : 14) * DAY_MS;
}

export type ProposalReconcileAction = {
  proposalId: string;
  status: "applied" | "superseded";
  decision: string;
};

/**
 * Pure: what should happen to one pending task-mirroring proposal given its
 * source task's CURRENT board state. `null` = leave it pending (the ask is
 * genuinely live and waiting on a human).
 */
export function reconcileProposalAgainstTask(
  proposal: Pick<CompanyProposal, "id" | "kind" | "status" | "createdAt" | "sourceTaskId" | "idempotencyKey">,
  task: Pick<KanbanTask, "status"> | null,
  now: number,
): ProposalReconcileAction | null {
  if (proposal.status !== "pending") return null;
  const mirrorsTask = Boolean(proposal.sourceTaskId) || (proposal.idempotencyKey ?? "").startsWith("task-human:");
  if (proposal.kind !== "human-input" || !mirrorsTask) return null;
  if (!task) {
    return { proposalId: proposal.id, status: "superseded", decision: "The Work Board task behind this ask no longer exists." };
  }
  if (task.status === "done") {
    return { proposalId: proposal.id, status: "applied", decision: "The task completed — this ask resolved itself." };
  }
  if (task.status === "archived") {
    return { proposalId: proposal.id, status: "superseded", decision: "The task was archived — no decision is needed anymore." };
  }
  if (task.status === "ready" || task.status === "working") {
    return {
      proposalId: proposal.id,
      status: "superseded",
      decision: "The task was re-queued for autonomous retry (infrastructure rescue or a human answer) — the ask is no longer waiting.",
    };
  }
  // Still needs-human: keep it — unless it has sat unanswered past the TTL.
  // The Work Board card remains the live surface for the ask; an aged-out
  // proposal is a duplicate the operator has already chosen not to act on.
  const createdAt = Date.parse(proposal.createdAt ?? "");
  if (Number.isFinite(createdAt) && now - createdAt > proposalTtlMs()) {
    return {
      proposalId: proposal.id,
      status: "superseded",
      decision: "Expired unanswered — the ask still lives on the Work Board's Needs You lane if it still matters.",
    };
  }
  return null;
}

export type ReconcileCompanyProposalsResult = {
  settled: number;
  byCompany: Record<string, number>;
};

/**
 * Sweep every company's pending task-mirroring proposals against the live
 * board and settle the ones whose task moved on. Best-effort per company —
 * one bad ledger must not stop the pass.
 */
export async function reconcileCompanyProposals(
  companies: Array<{ id: string }>,
  tasks: KanbanTask[],
  deps: {
    listLedger?: typeof listCompanyRuns;
    settle?: typeof settleCompanyProposal;
    now?: number;
  } = {},
): Promise<ReconcileCompanyProposalsResult> {
  const listLedger = deps.listLedger ?? listCompanyRuns;
  const settle = deps.settle ?? settleCompanyProposal;
  const now = deps.now ?? Date.now();
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const result: ReconcileCompanyProposalsResult = { settled: 0, byCompany: {} };
  for (const company of companies) {
    try {
      const ledger = await listLedger(company.id, { status: "pending", proposalLimit: 1_000 });
      for (const proposal of ledger.proposals) {
        const task = proposal.sourceTaskId ? taskById.get(proposal.sourceTaskId) ?? null : null;
        const action = reconcileProposalAgainstTask(proposal, task, now);
        if (!action) continue;
        const settled = await settle(company.id, action.proposalId, {
          status: action.status,
          decision: action.decision,
          decidedBy: "company-autonomy-driver",
        }).catch(() => null);
        if (settled) {
          result.settled += 1;
          result.byCompany[company.id] = (result.byCompany[company.id] ?? 0) + 1;
        }
      }
    } catch (error) {
      console.warn(`[company-needs-human-triage] reconcile failed for ${company.id}:`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}
