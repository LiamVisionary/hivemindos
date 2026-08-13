import "server-only";

import { captureDecision } from "@/lib/services/security/decision-capture";
import type { KanbanTask } from "@/lib/types/kanban";

/** `company:<id>:<runId>` is how dispatched company work is stamped. */
export function companyIdFromTaskSource(source?: string) {
  const match = /^company:([^:]+):/.exec(source ?? "");
  return match?.[1] ?? null;
}

/**
 * Record an operator answering a Needs You task, so the same question does not
 * have to be asked cold next time.
 *
 * Lives outside local-kanban-store because that file is at its legacy size
 * allowance — the repo rule is to extract from oversized files rather than grow
 * them.
 *
 * Fire-and-forget on purpose: a corpus append must never fail the answer it
 * describes. Callers invoke this AFTER the board write has landed.
 */
export function captureHumanAnswerDecision(input: {
  task: Pick<KanbanTask, "id" | "title" | "body" | "source" | "assignee" | "deliverables">;
  answer: string;
  author: string;
  origin?: "human" | "automation";
}): void {
  // Automation also answers tasks — the infra rescue stamps a machine-written
  // answer onto a stranded task to put it back in flight. Those are not
  // operator decisions, and capturing them would fill the corpus with machine
  // text that later mining would learn from.
  if (input.origin === "automation") return;
  void captureDecision({
    sourceKind: "interaction",
    sourceId: input.task.id,
    companyId: companyIdFromTaskSource(input.task.source),
    subject: input.task.title,
    question: input.task.body ?? "",
    outcome: input.answer,
    actor: input.author,
    context: {
      assignee: input.task.assignee ?? null,
      deliverables: (input.task.deliverables ?? []).map((deliverable) => deliverable.kind),
    },
  }).catch(() => undefined);
}
