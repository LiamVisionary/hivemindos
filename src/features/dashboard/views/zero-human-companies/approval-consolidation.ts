import type { SpendApprovalView } from "@/features/approvals/spend-approval-model";

/**
 * Consolidate a company's ~50 look-alike work-approval cards ("approve this send",
 * "launch outreach to …", "convert demos into paid checkouts", …) into a handful
 * of grouped decisions, so the Needs-You grid isn't a wall of near-identical
 * cards. Grouping is by a normalized ASK INTENT — the title with per-lead
 * targets, batch numbers, dates, and money amounts stripped — so "Launch
 * outreach (Batch 1)" and "Launch outreach (Batch 2)" collapse, but "approve an
 * email send" and "approve a website publish" stay distinct (a human decides
 * those differently; the commercial-trust-boundary rule argues against blurring
 * a bulk "approve everything" across kinds).
 *
 * Pure + presentational-free so it's hermetically testable. `groupWorkApprovals`
 * only groups WORK approvals (kind "approval"); wallet spend approvals and any
 * other kinds pass through as singleton groups untouched.
 */
export type ApprovalGroup = {
  /** Stable key for the group (the normalized intent signature). */
  key: string;
  /** Human label — the shortest member title, a reasonable representative. */
  label: string;
  /** The approvals in this group, most-recent first. */
  items: SpendApprovalView[];
};

const NOISE_PATTERNS: RegExp[] = [
  /\bbatch\s*#?\d+\b/gi,
  /\b(?:wave|round|group|set|tier)\s*#?\d+\b/gi,
  /\b\d{1,4}\b/g, // bare numbers (counts, "top 5", "25 leads", years)
  /\$\s?\d[\d,.]*/g, // money
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{0,4}\b/gi,
  /\b\d{4}-\d{2}-\d{2}\b/g, // ISO dates
];

const STOP_WORDS = new Set([
  "the", "a", "an", "for", "to", "of", "and", "or", "with", "into", "from", "on",
  "in", "at", "by", "new", "next", "top", "first", "this", "that", "these", "those",
  "all", "our", "your", "their", "premium", "warm", "hot", "best", "high", "key",
]);

/** Reduce a title to a stable intent signature: lowercase, strip noise (batch
 *  numbers, counts, dates, money), drop stop-words, keep the verb+object stems
 *  sorted. Titles are title-case, so we do NOT strip by capitalization (that
 *  would eat the verb); lead/company names that appear survive as tokens, which
 *  just keeps per-target asks in their own group (precision-biased — safer than
 *  over-merging a bulk decision across genuinely different targets). */
export function approvalIntentKey(title: string): string {
  let text = ` ${title.toLowerCase()} `;
  for (const re of NOISE_PATTERNS) text = text.replace(re, " ");
  const tokens = text
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
    // Cheap stemming so plurals/tenses collapse (pitches/pitch, sends/send).
    .map((t) => t.replace(/(?:ing|ed|es|s)$/,"").replace(/i$/, "y"))
    .filter((t) => t.length > 1);
  const uniq = Array.from(new Set(tokens)).sort();
  return uniq.join(" ");
}

/**
 * Group work-approval views by intent. Non-approval views (wallet spends, etc.)
 * and any view whose intent signature is empty pass through as their own
 * singleton group (never merged), so nothing is silently blurred. Order of
 * groups follows first appearance; items within a group keep input order.
 */
export function groupWorkApprovals(views: SpendApprovalView[]): ApprovalGroup[] {
  const groups = new Map<string, ApprovalGroup>();
  let singleton = 0;
  const order: string[] = [];
  for (const view of views) {
    const intent = view.kind === "approval" ? approvalIntentKey(view.title || "") : "";
    // Only merge when there is a real shared intent AND it's a work approval;
    // everything else gets a unique key so it stands alone.
    const key = intent ? `intent:${intent}` : `solo:${view.id}:${singleton++}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, label: view.title || "Approval", items: [] };
      groups.set(key, group);
      order.push(key);
    }
    group.items.push(view);
    // Keep the shortest title as the group label (usually the least noisy).
    if ((view.title?.length ?? Infinity) < group.label.length) group.label = view.title || group.label;
  }
  return order.map((key) => groups.get(key)!);
}
