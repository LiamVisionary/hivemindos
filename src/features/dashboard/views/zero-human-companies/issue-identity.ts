import type { Issue } from "./types";

export function getIssueIdentity(issue: Issue): string {
  return issue.work?.taskId ?? issue.key;
}
