// Deliverable acceptance orchestrator — the reusable core BOTH enforcement points
// call: the loop-runner completion gate (blocks a task from completing when its
// claimed outward deliverable is a placeholder) and the company email-QA scan
// (flags placeholder previews linked in sent outreach).
//
// It finds the customer-facing URLs a worker/email presents, fetches each through
// an INJECTED content fetcher (the server passes a real bounded `fetch`; tests
// pass a fake), and runs the matching acceptance contract. PURE + client-safe at
// module scope (no network here) so it is importable from `loop-runner.ts`.
//
// FAIL CLOSED on affirmative failure ONLY: an artifact blocks completion when a
// contract positively rejects its content. An unfetchable/ambiguous artifact
// yields `unknown` and NEVER blocks — the same "don't cry wolf on transient
// conditions" rule the live-URL integrity gate already follows.
import { isReservedOrMockUrl } from "@/lib/net/reserved-urls";
import {
  contractsForArtifact,
  evaluateArtifactAcceptance,
  type AcceptanceVerdict,
  type DeliverableArtifact,
  type FetchedContent,
} from "./acceptance-contracts";

/** Injected fetcher. Returns null when the artifact could not be read (→ no block). */
export type DeliverableContentFetcher = (input: { url: string }) => Promise<FetchedContent | null>;

export interface DeliverableAcceptanceInput {
  /** Free text (worker output / email body) to scan for customer-facing URLs. */
  output?: string;
  /** Explicit artifacts to check (e.g. resolved preview URLs from an email). */
  artifacts?: DeliverableArtifact[];
  fetchContent?: DeliverableContentFetcher;
  /** Bound on how many URLs one run fetches. */
  maxChecks?: number;
}

export interface CheckedArtifact {
  url: string;
  verdict: AcceptanceVerdict;
}

export interface DeliverableAcceptanceResult {
  /** Artifacts that matched a contract and were actually judged (pass or fail). */
  checked: CheckedArtifact[];
  /** The subset that a contract affirmatively rejected. */
  violations: CheckedArtifact[];
}

const DEFAULT_MAX_CHECKS = 6; // matches the live-URL integrity cap; fetched concurrently.
const MAX_BODY_BYTES = 512 * 1024;

// Customer-facing CONTENT deliverables — the pages a prospect judges as a finished
// product (preview / offer / landing on a deploy host). Deliberately NOT transactional
// endpoints (/paid, /checkout, /book, /order): those are liveness-gated by the live-URL
// integrity gate, and a legitimately terse confirmation page must not be content-judged.
// Covers the deploy hosts the live-URL gate probes so the two do not diverge in coverage.
const DELIVERABLE_URL_SHAPE =
  /(?:\/(?:preview|p|offer|offers)\/|preview\.[a-z0-9.-]+\/|\.workers\.dev|\.vercel\.app|\.netlify\.app|\.pages\.dev|\.web\.app|\.onrender\.com|\.fly\.dev|\.firebaseapp\.com)/i;

function scanUrls(output: string): string[] {
  const found = new Set<string>();
  for (const match of String(output ?? "").matchAll(/https?:\/\/[^\s"'<>)]+/gi)) {
    found.add(match[0].replace(/[),.;]+$/, ""));
  }
  return [...found];
}

function isReferenceDocUrl(url: string): boolean {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return host.startsWith("docs.") || /\/api-reference\/|\/rate-limit/.test(url.toLowerCase());
}

/** Normalize + dedupe candidate artifacts from explicit input and scanned text. */
function collectArtifacts(input: DeliverableAcceptanceInput): DeliverableArtifact[] {
  const byUrl = new Map<string, DeliverableArtifact>();
  const add = (artifact: DeliverableArtifact) => {
    const url = artifact.url?.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) return;
    if (isReservedOrMockUrl(url) || isReferenceDocUrl(url)) return;
    // Transactional / confirmation endpoints are liveness-gated, not content deliverables —
    // never content-judge them (a terse "Payment received" page is correct, not a placeholder).
    if (/\/(?:paid|checkout|pay|book|order|sign-?up|success|thank-?you)\b/i.test(url)) return;
    // Only URLs shaped like a customer-facing deliverable, unless a kind hint says so.
    if (!DELIVERABLE_URL_SHAPE.test(url) && !/preview site|offer page/i.test(artifact.kindLabel ?? "")) return;
    // Only URLs a contract actually governs — avoids fetching arbitrary links.
    const candidate = { ...artifact, url };
    if (!contractsForArtifact(candidate).length) return;
    const key = url.replace(/\/+$/, "").toLowerCase();
    if (!byUrl.has(key)) byUrl.set(key, candidate);
  };
  for (const artifact of input.artifacts ?? []) add(artifact);
  for (const url of scanUrls(input.output ?? "")) add({ url });
  return [...byUrl.values()];
}

export async function evaluateDeliverableAcceptance(
  input: DeliverableAcceptanceInput,
): Promise<DeliverableAcceptanceResult> {
  const fetchContent = input.fetchContent;
  const checked: CheckedArtifact[] = [];
  if (!fetchContent) return { checked, violations: [] };

  // Fetch the capped set CONCURRENTLY so a batch task's several deliverables are all
  // judged in one round (a sequential loop made the cap latency-bound; a batch could
  // then silently skip trailing deliverables). The cap still bounds work + network;
  // the company email-QA scan is the comprehensive per-link net beyond it.
  const artifacts = collectArtifacts(input).slice(0, input.maxChecks ?? DEFAULT_MAX_CHECKS);
  const evaluated = await Promise.all(
    artifacts.map(async (artifact): Promise<CheckedArtifact | null> => {
      const url = artifact.url!;
      let content: FetchedContent | null = null;
      try {
        content = await fetchContent({ url });
      } catch {
        content = null; // unreadable → abstain, never block.
      }
      if (!content || !content.body) return null;
      const body = content.body.length > MAX_BODY_BYTES ? content.body.slice(0, MAX_BODY_BYTES) : content.body;
      const artVerdict = evaluateArtifactAcceptance(artifact, { ...content, body });
      return artVerdict.status === "unknown" ? null : { url, verdict: artVerdict }; // contract abstained → skip.
    }),
  );
  for (const item of evaluated) if (item) checked.push(item);
  return { checked, violations: checked.filter((c) => c.verdict.status === "fail") };
}

/** One-line human summary of a rejection, for receipts and QA findings. */
export function summarizeAcceptanceViolations(violations: CheckedArtifact[]): string {
  return violations
    .map(({ url, verdict }) => {
      const reasons = verdict.violations.map((v) => v.message).join(" ");
      return `${url} — ${reasons}`;
    })
    .join(" | ");
}
