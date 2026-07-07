// Company email-QA scan: reviews the emails a company's crew actually sent and
// turns defects into surfaced, handleable findings for the Cockpit "email QA"
// band. Two layers:
//   1. Deterministic (always): dead CTA/booking links (live-probed), template
//      placeholders / merge-field leaks, a visible tracking-pixel line left in a
//      plaintext body, and "attachment" claims with no attachment.
//   2. AI (deep scan): content/alignment judgment the deterministic pass can't do
//      (off-strategy copy, personalization mismatch, raw machine-signal text, tone).
//
// Read-only: it probes URLs and runs LLM completions; it never sends, mutates, or
// spends beyond LLM tokens. The corpus is read through the same provider registry
// the Emails tab uses (readCompanyEmailThreads), so it covers every mail provider.
import { readCompanyEmailThreads, type CompanyEmailThread } from "@/lib/services/agent-mailboxes";
import { isReservedOrMockUrl } from "@/lib/net/reserved-urls";
import { probeUrlLiveness } from "@/lib/net/probe-url";
import { makeDeliverableContentFetcher } from "@/lib/services/deliverables/content-fetcher";
import { contractsForArtifact, evaluateArtifactAcceptance, type AcceptanceVerdict } from "@/lib/services/deliverables/acceptance-contracts";
import { reviewOutreachEmail, type EmailQaAiFinding } from "@/lib/services/queen-bee/email-qa-reviewer";

export type EmailQaSeverity = "high" | "medium" | "low";

export type EmailQaFinding = {
  id: string;
  threadId: string;
  /** The prospect/recipient this email went to, for the per-email row. */
  business: string;
  subject: string;
  severity: EmailQaSeverity;
  /** Stable key for grouping identical defects across emails. */
  category: string;
  categoryLabel: string;
  source: "deterministic" | "ai";
  /** What is wrong with THIS email. */
  summary: string;
  /** A standing rule the crew should follow next time (feeds the "Teach the crew" directive). */
  suggestion?: string;
  /** The offending URL, for dead-link findings. */
  badUrl?: string;
};

export type EmailQaReport = {
  scannedAt: number;
  emailCount: number;
  aiReviewed: boolean;
  aiError?: string;
  truncated?: boolean;
  findings: EmailQaFinding[];
};

export type EmailQaScanInput = {
  companyId: string;
  agentIds: string[];
  projectId?: string;
  companyName?: string;
  charter?: string;
  apexGoal?: string;
  deep?: boolean;
  limit?: number;
};

const DEFAULT_LIMIT = 60;
const PROBE_CONCURRENCY = 8;
const AI_CONCURRENCY = 4;
const CACHE_TTL_MS = 5 * 60 * 1000;
const PIXEL_URL_RE = /\/open\.gif|\/t\/open\b/i;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
// Clear merge-field / template leaks — deliberately narrow to avoid false positives
// on ordinary punctuation. Matches {{x}}, ${x}, {slug}, [ALL CAPS], <tag>, %ENV%,
// and bare field names that only appear when a template didn't render.
const PLACEHOLDER_RE = /\{\{[^}]*\}\}|\$\{[^}]*\}|\{[a-z_][a-z0-9_]*\}|\[[A-Z][A-Z0-9 _-]{2,}\]|<[a-z_][a-z0-9_]*>|%[A-Z_]{3,}%|\b(?:first_?name|last_?name|business_?name|company_?name|lead_?name)\b/i;
const ATTACHMENT_CLAIM_RE = /\b(?:attached|see the attachment|find attached|enclosed|attachment below)\b/i;

const cache = new Map<string, { expiresAt: number; report: EmailQaReport }>();

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Decode a tracking-redirect wrapper (`/t/<event>?...&to=<encoded dest>`) to the
 *  real destination so we probe the customer-facing target (cal.com, the preview
 *  site) directly — WITHOUT firing the tracking event. Non-wrapped links pass through. */
function finalDestination(url: string): string {
  try {
    const parsed = new URL(url);
    let to = parsed.searchParams.get("to");
    if (!to) return url;
    for (let i = 0; i < 3 && /%/.test(to); i += 1) {
      const decoded = decodeURIComponent(to);
      if (decoded === to) break;
      to = decoded;
    }
    return to;
  } catch {
    return url;
  }
}

function candidateUrls(thread: CompanyEmailThread): string[] {
  const found = new Set<string>();
  const collect = (value: string | undefined) => {
    for (const raw of value?.match(URL_RE) ?? []) {
      const url = raw.replace(/[.,);]+$/, "");
      if (PIXEL_URL_RE.test(url)) continue; // tracking beacon, not a customer link
      found.add(url);
    }
  };
  collect(thread.body);
  for (const link of thread.links ?? []) if (link.url) found.add(link.url);
  return [...found];
}

function businessLabel(thread: CompanyEmailThread): string {
  return thread.correspondents?.find((entry) => entry.trim()) || thread.inboxAddress || "unknown recipient";
}

/** A thread that represents something the crew actually SENT (vs a queued draft).
 *  The outbox reader marks delivered threads `direction: "outbound"` + a "delivered"
 *  label; AgentMail-style providers use "sent". QA cares most about real sends. */
function isSentThread(thread: CompanyEmailThread): boolean {
  // "sent" is provider vocabulary, not part of CompanyEmailDirection — keep the
  // runtime check for AgentMail-shaped data without lying to the type system.
  return (thread.labels ?? []).includes("delivered") || thread.direction === "outbound" || (thread.direction as string) === "sent";
}

function scannableThreads(result: { threads?: CompanyEmailThread[] }, limit: number): { threads: CompanyEmailThread[]; truncated: boolean } {
  const withBody = (result.threads ?? []).filter((thread) => (thread.body ?? "").trim().length > 0);
  // Scan SENT threads first, then queued — newest within each bucket. This keeps
  // the cap from silently dropping an actually-sent email (e.g. an older delivered
  // pitch) in favour of a newer queued draft, which is what QA most needs to see.
  withBody.sort((a, b) => {
    const rank = (isSentThread(a) ? 0 : 1) - (isSentThread(b) ? 0 : 1);
    return rank !== 0 ? rank : (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
  const scannedSent = Math.min(withBody.filter(isSentThread).length, limit);
  const totalSent = withBody.filter(isSentThread).length;
  // Only call it truncated when a real SENT email had to be dropped — a queued
  // draft falling outside the cap is not a coverage gap worth flagging.
  return { threads: withBody.slice(0, limit), truncated: scannedSent < totalSent };
}

const CATEGORY_LABELS: Record<string, string> = {
  "dead-link": "Dead / broken link",
  placeholder: "Unfilled placeholder",
  "tracking-pixel": "Visible tracking-pixel line",
  "missing-attachment": "Missing attachment",
  "placeholder-deliverable": "Placeholder / unfinished deliverable",
};

const CATEGORY_SUGGESTIONS: Record<string, string> = {
  "dead-link": "Before sending any email, probe every booking/CTA/preview link and never ship one that returns 404, 410, or does not resolve.",
  placeholder: "Never send an email that still contains a template placeholder or merge field — render and verify every field first.",
  "tracking-pixel": "Do not put a visible \"tracking pixel\" line or open-pixel URL in the plaintext body; use a real HTML part where the pixel is invisible, or drop it.",
  "missing-attachment": "If an email says something is attached, verify the attachment is actually included before sending.",
  "placeholder-deliverable": "Never link a prospect to a preview that still shows placeholder content — verify the page has a real menu/offer with prices and real imagery before sending.",
};

async function deterministicFindings(threads: CompanyEmailThread[]): Promise<EmailQaFinding[]> {
  // Probe every unique customer-facing destination once, in a bounded pool.
  const destinations = new Set<string>();
  for (const thread of threads) for (const url of candidateUrls(thread)) {
    const dest = finalDestination(url);
    if (!isReservedOrMockUrl(dest) && !PIXEL_URL_RE.test(dest)) destinations.add(dest);
  }
  const destList = [...destinations];
  const probes = await mapPool(destList, PROBE_CONCURRENCY, (url) => probeUrlLiveness(url));
  const probeByUrl = new Map(destList.map((url, index) => [url, probes[index]]));

  // Content acceptance: for LIVE customer-facing destinations a contract governs
  // (preview/offer pages), fetch the page and check it isn't a placeholder/wireframe
  // skeleton — a real preview shipped to a prospect with fake "menu" items and no
  // prices (2026-07-07). Bounded + best-effort; an unreadable page abstains so this
  // never fires a false finding. Dead/reserved links are handled above.
  const fetchContent = makeDeliverableContentFetcher();
  const acceptanceByUrl = new Map<string, AcceptanceVerdict>();
  if (fetchContent) {
    const governedLive = destList.filter((url) => probeByUrl.get(url)?.live && contractsForArtifact({ url }).length);
    await mapPool(governedLive, PROBE_CONCURRENCY, async (url) => {
      const content = await fetchContent({ url }).catch(() => null);
      if (!content?.body) return;
      const verdict = evaluateArtifactAcceptance({ url }, content);
      if (verdict.status === "fail") acceptanceByUrl.set(url, verdict);
    });
  }

  const findings: EmailQaFinding[] = [];
  for (const thread of threads) {
    const business = businessLabel(thread);
    const body = thread.body ?? "";
    const seenDeadForThread = new Set<string>();
    const seenPlaceholderDeliverableForThread = new Set<string>();
    for (const url of candidateUrls(thread)) {
      const dest = finalDestination(url);
      if (isReservedOrMockUrl(dest)) {
        findings.push({
          id: `${thread.id}:placeholder-url`, threadId: thread.threadId, business, subject: thread.subject,
          severity: "high", category: "placeholder", categoryLabel: CATEGORY_LABELS.placeholder, source: "deterministic",
          summary: `A link is a placeholder/template URL, not a real destination: ${dest}`, suggestion: CATEGORY_SUGGESTIONS.placeholder, badUrl: dest,
        });
        continue;
      }
      const probe = probeByUrl.get(dest);
      if (probe?.dead && !seenDeadForThread.has(dest)) {
        seenDeadForThread.add(dest);
        findings.push({
          id: `${thread.id}:dead:${dest}`, threadId: thread.threadId, business, subject: thread.subject,
          severity: "high", category: "dead-link", categoryLabel: CATEGORY_LABELS["dead-link"], source: "deterministic",
          summary: `A link the recipient is asked to click is dead (${probe.reason}): ${dest}`, suggestion: CATEGORY_SUGGESTIONS["dead-link"], badUrl: dest,
        });
      }
      const rejected = acceptanceByUrl.get(dest);
      if (rejected && !seenPlaceholderDeliverableForThread.has(dest)) {
        seenPlaceholderDeliverableForThread.add(dest);
        findings.push({
          id: `${thread.id}:placeholder-deliverable:${dest}`, threadId: thread.threadId, business, subject: thread.subject,
          severity: "high", category: "placeholder-deliverable", categoryLabel: CATEGORY_LABELS["placeholder-deliverable"], source: "deterministic",
          summary: `The linked deliverable looks unfinished/placeholder (${rejected.violations.map((v) => v.message).join(" ")}): ${dest}`,
          suggestion: CATEGORY_SUGGESTIONS["placeholder-deliverable"], badUrl: dest,
        });
      }
    }
    if (PLACEHOLDER_RE.test(body) || PLACEHOLDER_RE.test(thread.subject)) {
      findings.push({
        id: `${thread.id}:placeholder-text`, threadId: thread.threadId, business, subject: thread.subject,
        severity: "high", category: "placeholder", categoryLabel: CATEGORY_LABELS.placeholder, source: "deterministic",
        summary: "The email still contains an unfilled placeholder / merge field.", suggestion: CATEGORY_SUGGESTIONS.placeholder,
      });
    }
    if (/tracking\s*pixel/i.test(body) || PIXEL_URL_RE.test(body)) {
      findings.push({
        id: `${thread.id}:pixel`, threadId: thread.threadId, business, subject: thread.subject,
        severity: "medium", category: "tracking-pixel", categoryLabel: CATEGORY_LABELS["tracking-pixel"], source: "deterministic",
        summary: "A visible tracking-pixel line / open-pixel URL was left in the plaintext body.", suggestion: CATEGORY_SUGGESTIONS["tracking-pixel"],
      });
    }
    if (ATTACHMENT_CLAIM_RE.test(body) && (thread.attachmentCount ?? 0) === 0 && !(thread.attachments?.length)) {
      findings.push({
        id: `${thread.id}:attachment`, threadId: thread.threadId, business, subject: thread.subject,
        severity: "low", category: "missing-attachment", categoryLabel: CATEGORY_LABELS["missing-attachment"], source: "deterministic",
        summary: "The email refers to an attachment, but none is attached.", suggestion: CATEGORY_SUGGESTIONS["missing-attachment"],
      });
    }
  }
  return findings;
}

async function aiFindings(input: EmailQaScanInput, threads: CompanyEmailThread[]): Promise<{ findings: EmailQaFinding[]; error?: string }> {
  const findings: EmailQaFinding[] = [];
  let error: string | undefined;
  await mapPool(threads, AI_CONCURRENCY, async (thread) => {
    try {
      const reviewed: EmailQaAiFinding[] = await reviewOutreachEmail({
        companyName: input.companyName,
        charter: input.charter,
        apexGoal: input.apexGoal,
        recipient: businessLabel(thread),
        subject: thread.subject,
        body: thread.body ?? "",
      });
      reviewed.forEach((finding, index) => {
        findings.push({
          id: `${thread.id}:ai:${index}`, threadId: thread.threadId, business: businessLabel(thread), subject: thread.subject,
          severity: finding.severity, category: `ai:${finding.category}`, categoryLabel: finding.category, source: "ai",
          summary: finding.summary, suggestion: finding.suggestion || undefined,
        });
      });
    } catch (caught) {
      // One shared error is enough — the whole layer shares one key/model.
      error = error || (caught instanceof Error ? caught.message : "Email QA review failed.");
    }
  });
  return { findings, error };
}

const SEVERITY_RANK: Record<EmailQaSeverity, number> = { high: 0, medium: 1, low: 2 };

export async function scanCompanyEmailQa(input: EmailQaScanInput): Promise<EmailQaReport> {
  const deep = Boolean(input.deep);
  const limit = input.limit ?? DEFAULT_LIMIT;
  const cacheKey = `${input.companyId}:${deep ? "deep" : "fast"}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > timestamp()) return cached.report;

  const corpus = await readCompanyEmailThreads({
    agentIds: input.agentIds,
    companyId: input.companyId,
    projectId: input.projectId,
    // Pull the reader's full window so OUR sent-first ordering governs which
    // threads get scanned, not the reader's recency-only cut.
    totalLimit: Math.max(limit * 3, 150),
  });
  const { threads, truncated } = scannableThreads(corpus, limit);

  const findings = await deterministicFindings(threads);
  let aiReviewed = false;
  let aiError: string | undefined;
  if (deep && threads.length) {
    const ai = await aiFindings(input, threads);
    findings.push(...ai.findings);
    aiReviewed = !ai.error;
    aiError = ai.error;
  }

  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const report: EmailQaReport = {
    scannedAt: timestamp(),
    emailCount: threads.length,
    aiReviewed,
    aiError,
    truncated: truncated || undefined,
    findings,
  };
  cache.set(cacheKey, { expiresAt: timestamp() + CACHE_TTL_MS, report });
  return report;
}

// Isolated so the scan does not depend on a wall-clock call scattered through the
// body (kept as a single seam and easy to reason about).
function timestamp(): number {
  return Date.now();
}
