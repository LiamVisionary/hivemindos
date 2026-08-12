/**
 * Company task watchdog — stopped-subtree verification.
 *
 * The autonomy driver already answers "does this company have live work?"
 * (`companyHasActiveWork`: any task in ready/working). When the answer is no it
 * re-plans the apex goal. That is a *keep pushing* response, and it is the wrong
 * response to the failure class this module exists for: work that came to rest
 * for a BAD reason — a task marked done with no evidence, an agent-invented
 * blocker parked in Needs You that nobody ever asked for, or a backlog whose
 * parents all finished but which never got promoted.
 *
 * Re-planning on top of a bad stop compounds it: the company burns tokens
 * re-deriving work while the real defect (a false "done", a bogus ask) sits
 * unexamined. The existing stall path only *notifies a human*
 * (`company-progress-stalled`), which is exactly the human-in-the-loop cost we
 * are trying to remove.
 *
 * So: when a company's whole task set comes to rest and that rest state is NEW,
 * classify the resting leaves and hand them to a verifier agent that reads the
 * evidence and either accepts the stop or restores a live path.
 *
 * This is verification-shaped, not execution-shaped. It never re-runs the
 * original assignee and it never marks work done itself.
 *
 * Three things in this repo carry the word "watchdog"; keep them apart:
 *   - fleet-health-watchdog.mjs  — probes collectors/TTS/driver processes (infra liveness)
 *   - reclaimStaleTasks          — a single claimed task whose lease went stale
 *   - this module                — the whole company came to rest, and the rest may be wrong
 */
import { createHash } from "node:crypto";
import type { KanbanLink, KanbanStatus, KanbanTask } from "@/lib/types/kanban";

/** Work Board tasks a company owns are stamped `company:<id>:…` at dispatch. */
export function companyTaskSourcePrefix(companyId: string): string {
  return `company:${companyId}:`;
}

export function isCompanyTask(task: Pick<KanbanTask, "source">, companyId: string): boolean {
  return (task.source ?? "").startsWith(companyTaskSourcePrefix(companyId));
}

/** Source marker for tasks this watchdog itself created. */
export const WATCHDOG_SOURCE_MARKER = ":watchdog:";

export function watchdogTaskSource(companyId: string, stopFingerprint: string): string {
  return `${companyTaskSourcePrefix(companyId)}watchdog:${stopFingerprint}`;
}

/**
 * A watchdog's own verification task must never be watched.
 *
 * It counts for LIVENESS (while a verifier is working the company is not
 * stopped), but it is excluded from the resting-leaf set. Otherwise the
 * watchdog feeds itself: the verification task finishes, joins the rest set,
 * changes the stop fingerprint, and triggers a fresh review that spawns another
 * verification task, forever.
 */
export function isWatchdogOriginTask(task: Pick<KanbanTask, "source">): boolean {
  return (task.source ?? "").includes(WATCHDOG_SOURCE_MARKER);
}

/**
 * Liveness reuses the driver's established predicate exactly: ready or working.
 * A second, subtly different definition of "live" here would let the driver and
 * the watchdog disagree about whether a company is running — the watchdog would
 * review a company the driver considers busy, or vice versa.
 */
export const COMPANY_LIVE_STATUSES: readonly KanbanStatus[] = ["ready", "working"];

export type CompanyStopLeafReason =
  /** done/archived carrying real completion evidence — a clean finish. */
  | "completed-with-evidence"
  /** done/archived with no result, deliverable, proof, or evaluation to show for it. */
  | "completed-without-evidence"
  /** needs-human the operator has explicitly seen and parked. */
  | "parked-by-operator"
  /** needs-human nobody has answered, still inside the grace window. */
  | "awaiting-human"
  /** needs-human unanswered past the grace window, with nothing else live. */
  | "awaiting-human-stale"
  /** ideas whose parents are all finished — it should have been promoted to ready. */
  | "unpromoted-backlog"
  /** ideas still genuinely waiting on an unfinished parent. */
  | "blocked-by-parent";

export type CompanyStopLeaf = {
  taskId: string;
  title: string;
  status: KanbanStatus;
  reason: CompanyStopLeafReason;
  /** Whether this leaf is what makes the stop worth a verifier's time. */
  suspicious: boolean;
  detail?: string;
};

export type CompanyStopClassification =
  | { state: "not_applicable"; reason: string }
  | { state: "live"; reason: string }
  | { state: "settled"; reason: string; stopFingerprint: string; leaves: CompanyStopLeaf[] }
  | { state: "reviewed"; reason: string; stopFingerprint: string; leaves: CompanyStopLeaf[] }
  | {
      state: "stopped";
      reason: string;
      stopFingerprint: string;
      leaves: CompanyStopLeaf[];
      suspiciousLeaves: CompanyStopLeaf[];
    };

export type ClassifyCompanyStopInput = {
  companyId: string;
  tasks: readonly KanbanTask[];
  links?: readonly KanbanLink[];
  /** Fingerprint of the last stop a verifier already reviewed, if any. */
  reviewedFingerprint?: string | null;
  now?: number;
  /**
   * A task created this recently whose dispatch run may not be visible yet is
   * treated as not-yet-stopped, so the classifier cannot race the driver's own
   * dispatch and produce a false stopped verdict. The driver re-evaluates every
   * tick, so a genuinely idle company still trips shortly after.
   */
  firstRunGraceMs?: number;
  /**
   * How long an unanswered Needs You ask may sit before the watchdog treats it
   * as worth verifying. Below this it is ordinary backpressure, not a defect —
   * firing immediately would make the watchdog nag on every question a company
   * legitimately asks.
   */
  unansweredAskGraceMs?: number;
};

export const DEFAULT_FIRST_RUN_GRACE_MS = 120_000; // 2 min
export const DEFAULT_UNANSWERED_ASK_GRACE_MS = 6 * 3_600_000; // 6h, matching the pause-nudge cadence

const RESTING_STATUSES: readonly KanbanStatus[] = ["ideas", "needs-human", "done", "archived"];
const FINISHED_STATUSES: readonly KanbanStatus[] = ["done", "archived"];

/**
 * Completion evidence is the same rail the deliverable-acceptance gate reads: a
 * written result, a deliverable, a GitLawb proof, or a server-recorded
 * evaluation. A task that reached done with none of those has nothing to show a
 * verifier, which is precisely the "declared done without proof" failure.
 */
export function hasCompletionEvidence(task: Pick<KanbanTask, "result" | "deliverables" | "proofs" | "evaluation">): boolean {
  if ((task.result ?? "").trim().length > 0) return true;
  if ((task.deliverables ?? []).length > 0) return true;
  if ((task.proofs ?? []).length > 0) return true;
  if (task.evaluation) return true;
  return false;
}

function leafTimestamp(task: KanbanTask): number {
  return task.updatedAt || task.createdAt || 0;
}

function classifyLeaf(
  task: KanbanTask,
  parentsById: Map<string, KanbanTask | undefined>,
  parentIdsByChild: Map<string, string[]>,
  now: number,
  unansweredAskGraceMs: number,
): CompanyStopLeaf {
  const base = { taskId: task.id, title: task.title, status: task.status };

  if (FINISHED_STATUSES.includes(task.status)) {
    return hasCompletionEvidence(task)
      ? { ...base, reason: "completed-with-evidence", suspicious: false }
      : {
          ...base,
          reason: "completed-without-evidence",
          suspicious: true,
          detail: "Reached done with no result, deliverable, proof, or evaluation attached.",
        };
  }

  if (task.status === "needs-human") {
    if (task.held) return { ...base, reason: "parked-by-operator", suspicious: false };
    const age = now - leafTimestamp(task);
    if (age >= unansweredAskGraceMs) {
      return {
        ...base,
        reason: "awaiting-human-stale",
        suspicious: true,
        detail: `Unanswered for ${Math.floor(age / 3_600_000)}h with no other live work in the company.`,
      };
    }
    return { ...base, reason: "awaiting-human", suspicious: false };
  }

  // status === "ideas": parked backlog. Suspicious only when its parents are all
  // finished — that means promotion to ready did not happen and the company is
  // sitting on work it was cleared to start.
  const parentIds = parentIdsByChild.get(task.id) ?? [];
  if (!parentIds.length) {
    return {
      ...base,
      reason: "unpromoted-backlog",
      suspicious: true,
      detail: "Backlog item with no blocking parent, never promoted to ready.",
    };
  }
  const allParentsFinished = parentIds.every((parentId) => {
    const parent = parentsById.get(parentId);
    return parent ? FINISHED_STATUSES.includes(parent.status) : false;
  });
  return allParentsFinished
    ? {
        ...base,
        reason: "unpromoted-backlog",
        suspicious: true,
        detail: "Every blocking parent is finished but this was never promoted to ready.",
      }
    : { ...base, reason: "blocked-by-parent", suspicious: false };
}

/** Stable across re-evaluations; changes when the resting set or its reasons change. */
export function computeStopFingerprint(leaves: readonly CompanyStopLeaf[]): string {
  const canonical = leaves
    .map((leaf) => `${leaf.taskId}:${leaf.status}:${leaf.reason}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export function classifyCompanyStopState(input: ClassifyCompanyStopInput): CompanyStopClassification {
  const now = input.now ?? Date.now();
  const firstRunGraceMs = input.firstRunGraceMs ?? DEFAULT_FIRST_RUN_GRACE_MS;
  const unansweredAskGraceMs = input.unansweredAskGraceMs ?? DEFAULT_UNANSWERED_ASK_GRACE_MS;

  const companyTasks = input.tasks.filter((task) => isCompanyTask(task, input.companyId));
  if (!companyTasks.length) {
    return { state: "not_applicable", reason: "Company owns no Work Board tasks." };
  }

  const live = companyTasks.filter((task) => COMPANY_LIVE_STATUSES.includes(task.status));
  if (live.length) {
    return {
      state: "live",
      reason: `${live.length} task(s) still ready or working.`,
    };
  }

  // Grace: a task dispatched moments ago may not have reached ready/working yet.
  const withinGrace = companyTasks.find((task) => now - (task.createdAt || 0) < firstRunGraceMs);
  if (withinGrace) {
    return {
      state: "live",
      reason: "A task was created inside the first-run grace window; its dispatch may not be visible yet.",
    };
  }

  const parentsById = new Map<string, KanbanTask | undefined>(
    input.tasks.map((task) => [task.id, task]),
  );
  const parentIdsByChild = new Map<string, string[]>();
  for (const link of input.links ?? []) {
    const existing = parentIdsByChild.get(link.childId);
    if (existing) existing.push(link.parentId);
    else parentIdsByChild.set(link.childId, [link.parentId]);
  }

  // Watchdog-origin tasks counted for liveness above but are excluded here, so a
  // finished verification task cannot itself become the stop that triggers the
  // next verification task.
  const resting = companyTasks.filter(
    (task) => RESTING_STATUSES.includes(task.status) && !isWatchdogOriginTask(task),
  );
  if (!resting.length) {
    return { state: "not_applicable", reason: "Company has no resting non-watchdog tasks." };
  }
  const leaves = resting.map((task) => classifyLeaf(task, parentsById, parentIdsByChild, now, unansweredAskGraceMs));
  const stopFingerprint = computeStopFingerprint(leaves);
  const suspiciousLeaves = leaves.filter((leaf) => leaf.suspicious);

  if (!suspiciousLeaves.length) {
    return {
      state: "settled",
      reason: "Every resting task is a clean finish, an operator-parked item, or genuinely blocked on a parent.",
      stopFingerprint,
      leaves,
    };
  }

  if (input.reviewedFingerprint && input.reviewedFingerprint === stopFingerprint) {
    return {
      state: "reviewed",
      reason: "This exact stop was already reviewed by the watchdog.",
      stopFingerprint,
      leaves,
    };
  }

  return {
    state: "stopped",
    reason: `No live path and ${suspiciousLeaves.length} resting task(s) need verification.`,
    stopFingerprint,
    leaves,
    suspiciousLeaves,
  };
}

/**
 * The brief handed to the verifier. Deliberately instructs *verification*, not
 * execution, and forbids the two failures that would make the watchdog worse
 * than nothing: rubber-stamping the stop, and marking work done itself.
 */
export function buildStopVerificationBrief(input: {
  companyName: string;
  apexGoal?: string;
  classification: Extract<CompanyStopClassification, { state: "stopped" }>;
  maxLeaves?: number;
}): string {
  const maxLeaves = input.maxLeaves ?? 12;
  const shown = input.classification.suspiciousLeaves.slice(0, maxLeaves);
  const remainder = input.classification.suspiciousLeaves.length - shown.length;
  const lines = shown.map(
    (leaf) => `- [${leaf.status}] ${leaf.title} (${leaf.taskId}) — ${leaf.reason}${leaf.detail ? `: ${leaf.detail}` : ""}`,
  );
  if (remainder > 0) lines.push(`- …and ${remainder} more resting task(s) in the same state`);

  return [
    `${input.companyName} has stopped: no task is ready or working, so no agent will pick anything up.`,
    input.apexGoal ? `Apex goal: ${input.apexGoal}` : null,
    "",
    "Resting tasks that need verification:",
    ...lines,
    "",
    "Your job is to decide whether stopping was correct. For each task above:",
    "1. Read the task, its comments, and any attached result or deliverable.",
    "2. Decide: was this legitimately finished / legitimately blocked / legitimately a question for the operator?",
    "3. If the stop was WRONG, restore a live path — move the task back to ready with a comment saying what",
    "   was actually missing, or open a corrected follow-up task.",
    "4. If the stop was RIGHT, leave it alone and say why in one line.",
    "",
    "Rules:",
    "- Verify, do not execute. Do not do the work yourself and do not mark anything done.",
    "- Do not accept a completion that has no evidence. 'Looks plausible' is not evidence.",
    "- If you cannot tell from the evidence, leave it and say what evidence is missing.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}
