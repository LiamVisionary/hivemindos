import { issueBlockReason } from "./issue-reason";
import type { Issue } from "./types";

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
