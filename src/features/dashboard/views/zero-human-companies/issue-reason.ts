// Zero Human Companies — derive a one-line, human-readable block reason for a
// "Needs you" (board_review) issue from the underlying Work Board record, so the
// cockpit/board can show WHY a company is waiting on a human without a click.
import { extractActionNeeded } from "@/features/dashboard/kanban-result-format";
import { normalizeReasoningTrail, type ReasoningTrail } from "@/lib/types/reasoning-trail";
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

// ── Reason classifier ────────────────────────────────────────────────────────
// The autonomous worker stamps EVERY exhausted pickup with the same generic
// header ("…exhausted all eligible delegates…") and buries the real cause in the
// "Failures:" detail lines. This reads those lines so a card shows WHY (delegates
// offline vs at capacity vs a genuine human ask), and gives issues a `signature`
// so near-identical ones can be consolidated instead of spamming the board.

export type IssueReasonCategory =
  | "delegates-offline"
  | "delegates-busy"
  | "delegates-unreachable"
  | "no-delegates"
  | "eval-gate"
  | "runtime-blocked"
  | "needs-input"
  | "other";

export type IssueReasonInfo = {
  category: IssueReasonCategory;
  /** Short label for the card / a consolidated group header. */
  label: string;
  /** One-line human reason. */
  reason: string;
  /** Grouping key — issues that share it are "the same blocker" and can merge. */
  signature: string;
  /** True when this class is safe to consolidate (a shared systemic blocker, not a distinct ask). */
  consolidatable: boolean;
  /**
   * True when the block was written by the system (a gate or the runtime), not by
   * an agent leaving a genuine ACTION NEEDED. The card uses `reason` (a plain,
   * human-framed line) as the ask for these, instead of the raw technical text the
   * producer stored (e.g. "attach passing eval receipts", "Failure reason: … Attempts: 3/3").
   */
  systemGenerated?: boolean;
};

const DELEGATE_EXHAUSTED = /exhausted all eligible delegates/i;
const NO_ELIGIBLE = /no eligible autonomous delegates were available/i;
const NO_LIVE_COLLECTOR = /no live delegated collector\/agent/i;
const AT_CAPACITY = /at its autonomous chat capacity/i;
// Transport-level chat failures: the delegate existed but its machine's collector
// couldn't be reached (down/restarting/overloaded). Mirrors the autonomous worker's
// TRANSIENT_PICKUP_FAILURE vocabulary — these self-heal once the machine is back.
const UNREACHABLE = /(timed?\s*out|timeout|bad gateway|gateway timeout|\b50[234]\b|service unavailable|temporarily unavailable|connection (?:error|reset|refused)|connect: connection refused|econnreset|econnrefused|socket hang ?up|network error|fetch failed|proxy error)/i;
// Collateral of two dispatch sweeps racing one task — not a distinct cause.
const CLAIM_RACE = /not ready to claim|claimed by another worker/i;
// A loop eval-gate parked the task ("attach passing eval receipts …").
const EVAL_GATE_BLOCK = /missing passing eval receipts|loop gate block/i;
// The runtime parked the task: a failTask escalation ("Failure reason: <x>.
// Attempts: n/m.") or an agent with no runnable session.
const RUNTIME_BLOCK = /\bfailure reason:\s*[\w -]+\.\s*attempts:\s*\d+\s*\/\s*\d+|did not attach a pollable session|has no active session|agent runtime\/auth/i;

/** Pull the "- <agent>: <reason>" lines under a "Failures:" section of a result. */
function extractFailureLines(result: string): string[] {
  const out: string[] = [];
  let inFailures = false;
  for (const raw of result.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^Failures:/i.test(line)) { inFailures = true; continue; }
    if (!inFailures) continue;
    if (line === "") continue;
    if (/^ACTION\s*NEEDED/i.test(line)) break;
    out.push(line.replace(/^[-*]\s*/, ""));
  }
  return out;
}

/**
 * Classify why a "Needs you" issue is blocked. Delegation-exhaustion issues (the
 * generic pileup) get a real, specific reason and a shared signature so they
 * consolidate; a genuine human ask stays its own card.
 */
export function classifyIssueReason(issue: Pick<Issue, "work">): IssueReasonInfo {
  const result = issue.work?.result || "";
  const body = issue.work?.body || "";

  if (DELEGATE_EXHAUSTED.test(result) || NO_ELIGIBLE.test(`${result}\n${body}`)) {
    const failures = extractFailureLines(result);
    const offline = failures.filter((line) => NO_LIVE_COLLECTOR.test(line)).length;
    const busy = failures.filter((line) => AT_CAPACITY.test(line)).length;
    // Claim-race lines are collateral of the same underlying event, so they never
    // count as their own cause unless NOTHING else explains the exhaustion.
    const unreachable = failures.filter((line) => !NO_LIVE_COLLECTOR.test(line) && !AT_CAPACITY.test(line) && UNREACHABLE.test(line)).length;
    const raced = failures.filter((line) => CLAIM_RACE.test(line)).length;
    const causes = [offline, busy, unreachable].filter((count) => count > 0).length;
    if (causes === 1 && offline > 0) {
      return {
        category: "delegates-offline",
        label: "Delegates offline",
        reason: `No agent's machine is reachable. ${offline} delegate${offline === 1 ? "" : "s"} have no live collector, so nothing can pick this up.`,
        signature: "delegation:offline",
        consolidatable: true,
      };
    }
    if (causes === 1 && busy > 0) {
      return {
        category: "delegates-busy",
        label: "Delegates at capacity",
        reason: "Every eligible delegate machine is at its autonomous capacity. The work is queued behind other runs.",
        signature: "delegation:busy",
        consolidatable: true,
      };
    }
    if (causes === 1 && unreachable > 0) {
      return {
        category: "delegates-unreachable",
        label: "Machine unreachable",
        reason: "Delegate chats failed on transport (timeouts / refused connections). The target machine's collector was likely down or restarting. It usually self-heals. Re-run once the machine is back.",
        signature: "delegation:unreachable",
        consolidatable: true,
      };
    }
    if (causes > 1) {
      return {
        category: "delegates-offline",
        label: "Delegates unavailable",
        reason: `Delegates couldn't take the work (${offline} offline, ${unreachable} unreachable, ${busy} at capacity).`,
        signature: "delegation:mixed",
        consolidatable: true,
      };
    }
    if (raced > 0) {
      return {
        category: "delegates-busy",
        label: "Dispatch race",
        reason: "Two dispatch sweeps raced for this task and the loser escalated it. The work was actually claimed. Safe to re-run.",
        signature: "delegation:race",
        consolidatable: true,
      };
    }
    return {
      category: "no-delegates",
      label: "No delegates available",
      reason: "No eligible autonomous delegate could pick this up. Check the crew's machines and worker classes.",
      signature: "delegation:none",
      consolidatable: true,
    };
  }

  // System-generated blocks: a gate or the runtime parked the task with technical
  // text, not a human decision. Translate each into a plain, human-framed ask so
  // the owner isn't shown "attach passing eval receipts" or "Failure reason:
  // no-final-response. Attempts: 3/3." (mirrors how delegate exhaustion above is
  // turned into a readable reason). The card renders `reason` as the ask for these.
  const taskId = issue.work?.taskId;
  if (EVAL_GATE_BLOCK.test(result)) {
    return {
      category: "eval-gate",
      label: "Automated checks didn't pass",
      reason:
        "The crew finished the work, but its automated quality checks haven't passed yet. Open what it produced below to review it. If it looks right you can move it forward with Handled, or use Discuss to have the crew fix the checks.",
      signature: `task:eval:${taskId ?? "x"}`,
      consolidatable: false,
      systemGenerated: true,
    };
  }
  if (RUNTIME_BLOCK.test(result)) {
    return {
      category: "runtime-blocked",
      label: "The crew hit a technical error",
      reason:
        "The crew couldn't finish this because of a technical error — its runtime, login, or a provider limit. Nothing here needs a decision from you. Re-run it with Handled once things look healthy, or use Discuss to dig into what failed.",
      signature: `task:runtime:${taskId ?? "x"}`,
      consolidatable: false,
      systemGenerated: true,
    };
  }

  // A genuine, distinct human ask — its own card, never merged. Prefer the
  // explicit `ACTION NEEDED:` ask (what's blocking + how to unblock) over the
  // generic first line, so a real credential/decision blocker is visible on the
  // card itself (live 2026-07-06: "Blocked before send…" hid the real ask).
  const asked = extractActionNeeded(result);
  const reason = (asked && truncate(asked)) || firstMeaningfulLine(result) || lastSectionLine(body);
  return {
    category: "needs-input",
    label: "Needs your input",
    reason,
    signature: `task:${issue.work?.taskId ?? reason}`,
    consolidatable: false,
  };
}

/**
 * One-line reason a company issue is blocked on a human. Uses the classifier so
 * delegation-exhaustion cards show the REAL cause, not the generic header.
 */
export function issueBlockReason(issue: Pick<Issue, "work">): string {
  const work = issue.work;
  if (!work) return "";
  // Prefer the agent's explicit `ACTION NEEDED:` ask — it says WHAT is blocking
  // and HOW to unblock (e.g. "Add PORTFOLIO_OFFER_API_TOKEN to the shared env").
  // A systemic delegation reason (offline/capacity) still wins, but a plain
  // "Blocked before send…" first line must never mask a real, actionable ask
  // (live 2026-07-06: the human couldn't tell a credential was the blocker).
  const systemic = classifyIssueReason(issue).reason;
  if (systemic) return systemic;
  const asked = extractActionNeeded(work.result);
  return (asked && truncate(asked)) || firstMeaningfulLine(work.result) || lastSectionLine(work.body);
}

function issueEvidence(issue: Pick<Issue, "title" | "agent" | "work" | "pipelineImpact">, info: IssueReasonInfo): string[] {
  const work = issue.work;
  return [
    `Issue: ${issue.title}`,
    work?.taskId ? `Work Board task: ${work.taskId}` : null,
    work?.status ? `Work status: ${work.status}` : null,
    issue.agent ? `Assigned agent: ${issue.agent}` : null,
    `Reason category: ${info.label}`,
    issue.pipelineImpact?.amountUsd != null ? `Quoted pipeline at risk: $${issue.pipelineImpact.amountUsd.toFixed(2)}` : null,
    info.reason ? `Blocker: ${info.reason}` : null,
  ].filter((line): line is string => Boolean(line));
}

function issueRequestedAction(issue: Pick<Issue, "work">, info: IssueReasonInfo): string {
  if (info.consolidatable) {
    return "Fix the shared blocker, then re-run the affected tasks. Dismiss only if the work is no longer needed.";
  }
  // System-generated blocks (a gate or the runtime) stored technical text, not a
  // human ACTION NEEDED — use the classifier's plain, human-framed line instead so
  // the card never shows the owner "attach passing eval receipts" or a raw failure
  // reason as their decision.
  if (info.systemGenerated) return info.reason;
  // Extract from the RESULT only — the body is the control-plane task brief, never
  // a human ask, and joining it let the extractor bleed into "Created by the Queen
  // Bee control plane." (real leak 2026-07-08). Callers decide whether the ask is
  // genuine via isGenuineHumanAsk before showing it.
  const explicitAsk = extractActionNeeded(issue.work?.result);
  return explicitAsk || info.reason || "Answer the task's human ask or resolve the blocker, then send the task back to the crew.";
}

export function issueReasoningTrail(issue: Pick<Issue, "title" | "status" | "agent" | "work" | "pipelineImpact" | "reasoning">): ReasoningTrail {
  if (issue.reasoning) return issue.reasoning;
  const info = classifyIssueReason(issue);
  const isSystemic = info.consolidatable;
  const workStatus = issue.work?.status || issue.status;
  return normalizeReasoningTrail({
    headline: info.reason || `${issue.title} needs attention.`,
    summary: isSystemic
      ? `This is a systemic ${info.label.toLowerCase()} blocker. Several tasks can share this same root cause.`
      : "This is a Work Board issue that needs human input before the crew can continue.",
    whyNow: workStatus === "needs-human" || issue.status === "board_review"
      ? "The task is in Needs You, so the autonomous run paused instead of guessing or taking the next action."
      : `The task is currently marked ${workStatus}.`,
    impact: isSystemic
      ? "Until this clears, affected tasks will keep waiting instead of being picked up by autonomous delegates."
      : "Until this is answered or fixed, the company cannot safely continue this task.",
    requestedAction: issueRequestedAction(issue, info),
    evidence: issueEvidence(issue, info),
    missingContext: issue.work?.result || issue.work?.receipts.length
      ? []
      : ["This issue does not include a detailed task result or receipt trail yet."],
    source: "Zero Human Company issue",
  })!;
}

export function issueGroupReasoningTrail(info: IssueReasonInfo, issues: Issue[]): ReasoningTrail {
  const first = issues[0];
  return normalizeReasoningTrail({
    headline: info.reason,
    summary: `This is a consolidated ${info.label.toLowerCase()} issue across ${issues.length} Work Board task${issues.length === 1 ? "" : "s"}.`,
    whyNow: "Multiple tasks reached Needs You with the same blocker, so the cockpit collapsed them into one shared issue.",
    impact: "Fixing the shared cause can unblock the whole group. Handling only one task may leave the rest stuck.",
    requestedAction: info.consolidatable
      ? "Fix the shared blocker, then re-run all affected tasks."
      : "Review each task before deciding.",
    evidence: [
      `Grouped tasks: ${issues.length}`,
      `Reason category: ${info.label}`,
      first?.work?.taskId ? `Example task: ${first.work.taskId}` : null,
      first?.title ? `Example issue: ${first.title}` : null,
      `Blocker: ${info.reason}`,
    ].filter((line): line is string => Boolean(line)),
    missingContext: [],
    source: "Zero Human Company issue group",
  })!;
}

export type IssueGroup = {
  /** Stable render key. */
  signature: string;
  info: IssueReasonInfo;
  issues: Issue[];
};

/**
 * Group "Needs you" issues by shared reason so identical systemic blockers (e.g.
 * 12 tasks all "delegates offline") collapse into ONE card instead of spamming the
 * board, while genuine distinct human asks stay their own cards. First-appearance
 * order is preserved.
 */
export function groupIssuesByReason(issues: Issue[]): IssueGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, IssueGroup>();
  for (const issue of issues) {
    const info = classifyIssueReason(issue);
    // Consolidatable classes merge on their signature; distinct asks get a unique
    // per-issue key so they never merge.
    const key = info.consolidatable ? info.signature : `${info.signature}:${issue.key}`;
    const group = byKey.get(key);
    if (group) {
      group.issues.push(issue);
    } else {
      byKey.set(key, { signature: key, info, issues: [issue] });
      order.push(key);
    }
  }
  return order.map((key) => byKey.get(key)!);
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
