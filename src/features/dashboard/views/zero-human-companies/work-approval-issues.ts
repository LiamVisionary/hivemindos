import { extractActionNeeded } from "@/features/dashboard/kanban-result-format";
import type { ApprovalDecision, SpendApprovalView } from "@/features/approvals/spend-approval-model";
import { normalizeReasoningTrail } from "@/lib/types/reasoning-trail";
import type { Issue } from "./types";

type WorkApprovalCandidate = Pick<Issue, "key" | "title" | "agent" | "status" | "work">;

const APPROVAL_WORDS = /\b(?:approve|approved|approval|authorize|authorized|sign[- ]?off|green[- ]?light)\b/i;
const REJECTION_WORDS = /\b(?:reject|rejected|denied|deny|revise|revision|changes?|do not send|don't send)\b/i;
const APPROVE_OR_REJECT = /\bapprove\s+or\s+reject\b/i;
const OPTIONS_LINE = /(?:^|\n)\s*OPTIONS\s*:\s*(\S[^\n]*)/i;
const LINK_LINE = /(?:^|\n)\s*LINKS?\s*:\s*(\S[^\n]*)/i;
const BARE_URL = /https?:\/\/[^\s"'<>()\[\]]+/i;

function issueText(issue: WorkApprovalCandidate): string {
  return [issue.work?.result, issue.work?.body].filter(Boolean).join("\n").trim();
}

function lineValue(text: string, pattern: RegExp): string {
  return text.match(pattern)?.[1]?.trim() ?? "";
}

export function workApprovalAsk(issue: WorkApprovalCandidate): string {
  const text = issueText(issue);
  const ask = extractActionNeeded(text);
  const options = lineValue(text, OPTIONS_LINE);
  const link = lineValue(text, LINK_LINE);
  return [
    ask,
    options ? `Options: ${options}` : null,
    link ? `Link: ${link}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function workApprovalLink(issue: WorkApprovalCandidate): string | undefined {
  const link = lineValue(issueText(issue), LINK_LINE);
  return link.match(BARE_URL)?.[0];
}

export function isWorkApprovalIssue(issue: WorkApprovalCandidate): boolean {
  const waitingOnHuman = issue.work?.status === "needs-human" || issue.status === "board_review";
  if (!waitingOnHuman) return false;
  const ask = workApprovalAsk(issue);
  if (!ask) return false;
  return APPROVE_OR_REJECT.test(ask) || (APPROVAL_WORDS.test(ask) && REJECTION_WORDS.test(ask));
}

export function workApprovalIssueToView(issue: WorkApprovalCandidate): SpendApprovalView {
  const ask = workApprovalAsk(issue) || "Human approval requested before this task can continue.";
  const target = workApprovalLink(issue);
  return {
    id: issue.work?.taskId ?? issue.key,
    title: issue.title || "Review work approval",
    agent: issue.agent || "the crew",
    kind: "approval",
    risk: "high",
    reason: ask,
    target,
    createdAtMs: issue.work?.updatedAt,
    explanation: normalizeReasoningTrail({
      headline: `${issue.agent || "The crew"} needs a human decision before continuing this task.`,
      summary: "This is a Work Board approval request, not a wallet spend. The agent paused because the next action needs approve or reject from you.",
      whyNow: "The task moved to Needs You with an explicit approval ask.",
      impact: "Approving sends the decision back to the Work Board so the agent can resume. Rejecting tells the agent not to take the action and to revise.",
      requestedAction: "Review the ask, choose Approve or Reject, and add a note when the agent needs constraints or changes.",
      evidence: [
        `Task: ${issue.title || "Review work approval"}`,
        issue.work?.taskId ? `Work Board task: ${issue.work.taskId}` : null,
        target ? `Target: ${target}` : null,
        `Request: ${ask}`,
      ].filter((line): line is string => Boolean(line)),
      missingContext: [],
      source: "Work Board approval",
    }),
  };
}

export function workApprovalDecisionAnswer(issue: WorkApprovalCandidate, decision: ApprovalDecision, note: string): string {
  const approved = decision === "approved";
  const ask = workApprovalAsk(issue);
  const trimmedNote = note.trim();
  return [
    approved
      ? "Human approved this Work Board approval request from the Company Cockpit."
      : "Human rejected this Work Board approval request from the Company Cockpit.",
    `Task: ${issue.title}`,
    issue.work?.taskId ? `Work Board task: ${issue.work.taskId}` : null,
    ask ? `Request: ${ask}` : null,
    trimmedNote ? `Human note: ${trimmedNote}` : null,
    approved
      ? "Resume the task now, but re-check the real provider/channel state and all normal send, publish, spend, and safety gates before taking the approved action."
      : "Do not send, publish, or spend for this request. Revise according to the rejection and human note, then return for approval again if needed.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
