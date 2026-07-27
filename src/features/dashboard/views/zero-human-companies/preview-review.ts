// Zero Human Companies — human review of a customer-facing preview deliverable
// (e.g. a `/preview/<lead>` outreach mockup). Pure + React-free so it is
// hermetically testable and shared by the cockpit UI and the resolve handler.
//
// The whole flow rides the existing Work Board `answer` rail: approving or
// requesting changes stamps the operator's decision into the parked task and the
// SAME agent resumes — so there is no new backend surface. `answer` only applies
// to a "Needs You" (needs-human) task, which is exactly the state a "please
// approve this preview" gate should be parked in.
import { bucketDeliverables } from "./deliverables-model";
import type { ClassifiedDeliverable } from "./deliverables-model";
import type { Issue } from "./types";

export type PreviewDecision = "approve" | "changes";

/** The reviewable, customer-facing previews attached to this issue's task, if any. */
export function issueReviewablePreviews(issue: Pick<Issue, "work">): ClassifiedDeliverable[] {
  const deliverables = issue.work?.deliverables;
  if (!deliverables?.length) return [];
  return bucketDeliverables(deliverables).reviewable;
}

/** First openable preview URL for an issue, or undefined when none is reviewable. */
export function issuePreviewUrl(issue: Pick<Issue, "work">): string | undefined {
  return issueReviewablePreviews(issue).find((p) => p.url)?.url;
}

/**
 * The Work Board `answer` text stamped when a human approves a preview or asks for
 * changes from the Company Cockpit. Mirrors `resolvedIssueAnswer`'s "don't treat
 * the human mark as proof — re-check before sending" guard, so an approval never
 * short-circuits the real pre-send gates.
 */
export function previewReviewAnswer(
  issue: Pick<Issue, "title" | "work">,
  decision: PreviewDecision,
  notes: string,
  previewUrl?: string,
): string {
  const taskLine = issue.work?.taskId ? `Work Board task: ${issue.work.taskId}` : null;
  const urlLine = previewUrl ? `Preview reviewed: ${previewUrl}` : null;
  const trimmed = notes.trim();

  if (decision === "approve") {
    return [
      "Human APPROVED this preview from the Company Cockpit.",
      `Approved deliverable: ${issue.title}`,
      urlLine,
      taskLine,
      trimmed ? `Note from the operator: ${trimmed}` : null,
      "Proceed to the next step for this preview (send it to the lead / publish / hand off). First re-run the real pre-send checks and provider state — do not treat the approval as proof that the send, DNS, or spend gates already pass.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  return [
    "Human requested CHANGES to this preview from the Company Cockpit.",
    `Preview to revise: ${issue.title}`,
    urlLine,
    taskLine,
    `Requested changes:\n${trimmed}`,
    "Revise the preview to address these changes, then re-submit it for human review (leave the task in 'Needs You' when the revision is ready). Do not send anything to the lead until the operator approves the revised preview.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
