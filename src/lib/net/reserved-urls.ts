// Single source of truth for "reserved / example / mock / non-routable URL"
// detection. PURE + dependency-free (no fs/fetch/node builtins, no imports) so it
// is safe to import from client bundles (loops/index.ts is client-imported) AND
// from server-side extractors alike.
//
// This is the UNION of what three call sites each used to re-implement:
//   - the loop runner's live-URL integrity gate (isReservedOrMockUrl) — the strictest;
//   - the Zero-Human-Companies deliverable UI (was isPlaceholderUrl);
//   - the kanban deliverable extractor (was isNonRoutableDeliverableUrl).
// The loop-runner copy was a strict SUPERSET of the other two, so unifying on it
// only ever WIDENS the UI/extractor (a `*.example.com` subdomain or a private/
// loopback link that used to slip through is now correctly flagged) — never the
// reverse. Nothing previously flagged becomes unflagged.
//
// A "reserved/mock" URL can never be a real, public, live deliverable:
//   - RFC 2606 / RFC 6761 reserved TLDs (.example/.invalid/.test/.localhost) and the
//     example.{com,org,net} apex AND any subdomain (documentation, never a live page);
//   - loopback / link-local / private / cloud-metadata hosts — a "live payment page"
//     on 127.0.0.1 or 169.254.169.254 is not a customer deliverable, and refusing to
//     treat it as live also closes an SSRF path in the live-URL prober;
//   - obvious placeholder / template markers anywhere in the URL (mock_, your-,
//     ${...}, <slug>, {param}, …).

/** Loopback / link-local / private / metadata hosts — never a public live deliverable. */
export function isNonPublicHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h === "::") return true;
  if (/^127\./.test(h)) return true;                       // loopback
  if (/^169\.254\./.test(h)) return true;                  // link-local + cloud metadata
  if (/^10\./.test(h)) return true;                        // private class A
  if (/^192\.168\./.test(h)) return true;                  // private class C
  if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(h)) return true; // private class B (172.16–172.31)
  if (/^(?:fe80:|fc|fd)/.test(h)) return true;             // IPv6 link-local + ULA
  return false;
}

/**
 * True when `url` can never be a real, public, live deliverable: unparseable, a
 * reserved TLD / example.* apex-or-subdomain, a non-public host, or a URL carrying
 * an obvious mock/template marker. PURE: never touches the network.
 */
export function isReservedOrMockUrl(url: string): boolean {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return true; } // unparseable → unusable
  if (/\.(?:example|invalid|test|localhost)$/.test(host)) return true;
  // Apex AND any subdomain of the reserved example.* domains: `demo.foo.example.com`
  // is documentation, never a live page.
  if (/(?:^|\.)example\.(?:com|org|net)$/.test(host)) return true;
  if (isNonPublicHost(host)) return true;
  return /\b(?:mock_|placeholder|your-|example-|<[^>]+>|\{[^}]+\}|\$\{)/i.test(url);
}
