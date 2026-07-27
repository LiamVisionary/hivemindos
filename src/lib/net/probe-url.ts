// Server-side URL liveness probe used by the company email-QA scan to catch
// dead CTA/booking/preview links in sent emails.
//
// Semantics match the live-URL integrity gate's inline prober
// (queen-bee/autonomous-worker.ts → makeLiveUrlProber): a link is "dead" ONLY on
// a definitive 404/410 or a DNS failure. Timeouts, 401/403, 429, and 5xx are
// NOT treated as dead — they are transient/auth conditions a real recipient's
// click would also hit, so flagging them would cry wolf. Reserved/mock/template
// URLs are classified separately by the pure `isReservedOrMockUrl` (reserved-urls.ts),
// which never touches the network.
//
// This module is server-only (it uses `fetch` + AbortSignal.timeout); do NOT
// import it into client bundles.

export type UrlProbeResult = {
  url: string;
  /** HTTP status of the final response after following redirects, when we got one. */
  status?: number;
  /** True only on a definitive dead link: 404, 410, or a host that does not resolve. */
  dead: boolean;
  /** True when the link resolved to a 2xx/3xx — a good, reachable link. */
  live: boolean;
  /** Short human-readable reason ("404", "does not resolve", "reachable (200)", "unverified: 403"). */
  reason: string;
};

/** Undici surfaces DNS/connection errors on `error.cause.code`; some paths use `error.code`. */
function errorCode(error: unknown): string | undefined {
  const direct = (error as { code?: unknown })?.code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: { code?: unknown } })?.cause?.code;
  return typeof cause === "string" ? cause : undefined;
}

export async function probeUrlLiveness(url: string, opts: { timeoutMs?: number } = {}): Promise<UrlProbeResult> {
  const timeoutMs = opts.timeoutMs ?? 8_000;
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const response = await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      if (method === "HEAD" && (response.status === 405 || response.status === 501)) continue; // host dislikes HEAD → GET
      const status = response.status;
      if (status === 404 || status === 410) return { url, status, dead: true, live: false, reason: String(status) };
      if (status >= 200 && status < 400) return { url, status, dead: false, live: true, reason: `reachable (${status})` };
      return { url, status, dead: false, live: false, reason: `unverified: ${status}` };
    } catch (error) {
      if (errorCode(error) === "ENOTFOUND") return { url, dead: true, live: false, reason: "does not resolve" };
      if (method === "GET") {
        const message = error instanceof Error ? error.message : String(error);
        return { url, dead: false, live: false, reason: `unverified: ${message.slice(0, 60)}` };
      }
      // HEAD threw for another reason (some servers hang up on HEAD) → fall through to GET.
    }
  }
  return { url, dead: false, live: false, reason: "unverified: no response" };
}
