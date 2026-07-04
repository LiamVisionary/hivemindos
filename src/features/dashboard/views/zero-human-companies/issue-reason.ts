// Zero Human Companies — derive a one-line, human-readable block reason for a
// "Needs you" (board_review) issue from the underlying Work Board record, so the
// cockpit/board can show WHY a company is waiting on a human without a click.
import type { Issue } from "./types";

const MAX = 160;

function truncate(s: string): string {
  return s.length > MAX ? `${s.slice(0, MAX - 1).trimEnd()}…` : s;
}

/** First non-empty, non-fence line of a markdown blob, header/bullet markers stripped. */
function firstMeaningfulLine(text?: string): string {
  if (!text) return "";
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) continue;
    const line = raw.replace(/^\s*#+\s*/, "").replace(/^\s*[-*]\s*/, "").trim();
    if (line) return truncate(line);
  }
  return "";
}

/** Last non-header line of a markdown blob (the tail of the final "## …" section). */
function lastSectionLine(text?: string): string {
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line && !line.startsWith("#") && !/^```/.test(line)) {
      return truncate(line.replace(/^[-*]\s*/, ""));
    }
  }
  return "";
}

/**
 * One-line reason a company issue is blocked on a human. Prefers the task's
 * result summary; falls back to the tail of its body. "" when nothing usable.
 */
export function issueBlockReason(issue: Pick<Issue, "work">): string {
  const work = issue.work;
  if (!work) return "";
  return firstMeaningfulLine(work.result) || lastSectionLine(work.body);
}

/**
 * The message the "Discuss" button sends into the shared Queen chat for a blocked
 * company issue. Mirrors `notificationDiscussPrompt` (notifications route) so both
 * surfaces ask the Queen the same "what's blocking me / what's the next action"
 * question — kept as a sibling here to avoid coupling to the notification type.
 */
export function companyIssueDiscussPrompt(
  companyName: string,
  issue: Pick<Issue, "title" | "agent" | "work">,
): string {
  const taskId = issue.work?.taskId;
  const detail = issue.work?.result || issue.work?.body || "";
  const body = detail.length > 900 ? `${detail.slice(0, 900)}\n[trimmed]` : detail;
  return [
    `A Work Board task for the ${companyName} company is blocked and waiting on me:`,
    ``,
    `Title: ${issue.title}`,
    issue.agent ? `Assigned agent: ${issue.agent}` : null,
    taskId ? `Task id: ${taskId}` : null,
    body ? `Current state:\n${body}` : null,
    ``,
    `Tell me: what caused this, whether it is already resolved, and the single next concrete action to take. If work is blocked on me, list exactly what needs my decision.`,
    taskId
      ? `If you need the task's current state, call the read_work_board tool with taskId ${taskId} — do not ask me where the task lives.`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Age of the work record ("3h", "2d", "just now"), or "" when unknown. */
export function issueAgeLabel(issue: Pick<Issue, "work">, now = Date.now()): string {
  const at = issue.work?.updatedAt;
  if (!at) return "";
  const mins = Math.max(0, Math.round((now - at) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}
