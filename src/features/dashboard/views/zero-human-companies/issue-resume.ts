import { issueBlockReason } from "./issue-reason";
import type { Issue } from "./types";

/**
 * The Work Board `answer` for re-running a task blocked by delegation
 * infrastructure (collector down, machine at capacity, dispatch race) rather
 * than by the work itself. Zero-human boards can't be hand-moved, so the
 * cockpit's "Re-run" rides the same answer rail as Mark Resolved: the answer
 * stamps into the task body, the task returns to Ready, and pickup is
 * scheduled immediately.
 */
export function retryDelegationIssueAnswer(issue: Pick<Issue, "title" | "work">): string {
  const blocker = issueBlockReason(issue).trim();
  return [
    "Human requested a re-run of this task from the Company Cockpit after a delegation infrastructure failure.",
    `Task: ${issue.title}`,
    issue.work?.taskId ? `Work Board task: ${issue.work.taskId}` : null,
    blocker ? `Prior blocker: ${blocker}` : null,
    "The previous attempt failed on dispatch transport (collector down or restarting, machine at capacity, or a dispatch race) — not on the work itself, and nothing about the task changed. Re-attempt the task from its existing body now. If the same infrastructure failure repeats, escalate again with the failure details instead of retrying blindly.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function resolvedIssueAnswer(issue: Pick<Issue, "title" | "work">): string {
  const blocker = issueBlockReason(issue).trim();
  return [
    "Human marked this company blocker resolved from the Company Cockpit.",
    `Resolved issue: ${issue.title}`,
    issue.work?.taskId ? `Work Board task: ${issue.work.taskId}` : null,
    blocker ? `Prior blocker: ${blocker}` : null,
    "Resume this task now. First re-check the external/provider state and verify the fix through the normal gates. Do not treat the human mark as proof; only proceed to sends, DNS changes, spend, or completion after the real checks pass.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
