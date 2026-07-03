// Pure, server-free helper that keeps the autonomy driver from re-dispatching the
// SAME work every cycle. The planner re-decomposes a broad apex goal on each
// re-dispatch and tends to emit near-identical titles ("Research Sarasota leads",
// "Follow up with non-responders") cycle after cycle; without dedup the board
// fills with redundant tasks — this is what produced ~80 deliverables from one
// goal in a few hours. Given newly-planned drafts and the titles of the company's
// recent + in-flight board tasks, drop drafts that substantially match existing
// work. Hermetically testable.

// Function words + generic scaffolding that don't help tell two tasks apart. The
// action verbs (research / build / follow-up / …) are deliberately KEPT — they
// distinguish "research leads" from "update the leads tracker".
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "at", "by", "with", "from", "into",
  "per", "via", "using", "new", "current", "latest", "company", "task", "tasks", "work", "our",
  "this", "that", "these", "those", "its", "their", "then", "next", "batch", "apex", "goal",
]);

export function normalizeTaskTitle(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ") // drop ISO dates
    .replace(/\bt[_-][a-z0-9]{5,}\b/g, " ") // drop task-hash tails
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const tok of normalizeTaskTitle(title).split(" ")) {
    if (tok.length < 3) continue; // drop tiny tokens / bare numbers
    if (STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Two task titles describe substantially the same work. */
export function titlesSimilar(a: string, b: string, threshold = 0.6): boolean {
  const na = normalizeTaskTitle(a);
  const nb = normalizeTaskTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return jaccard(titleTokens(a), titleTokens(b)) >= threshold;
}

export interface DedupeResult<T> {
  fresh: T[];
  dropped: Array<{ draft: T; matched: string }>;
}

/**
 * Drop drafts that substantially match an existing (recent or in-flight) task
 * title — or an earlier draft in the same batch. Biased to PRECISION: dropping a
 * genuinely-new task would stall the company, so only clear matches are removed
 * (default Jaccard ≥ 0.6, or an exact normalized-title match).
 */
export function dedupeDrafts<T extends { title: string }>(
  drafts: readonly T[],
  existingTitles: readonly string[],
  opts: { threshold?: number } = {},
): DedupeResult<T> {
  const threshold = opts.threshold ?? 0.6;
  const fresh: T[] = [];
  const dropped: Array<{ draft: T; matched: string }> = [];
  const kept: string[] = existingTitles.filter(Boolean);
  for (const draft of drafts) {
    const match = kept.find((t) => titlesSimilar(draft.title, t, threshold));
    if (match) {
      dropped.push({ draft, matched: match });
      continue;
    }
    fresh.push(draft);
    kept.push(draft.title); // also dedupe drafts against each other within the batch
  }
  return { fresh, dropped };
}
