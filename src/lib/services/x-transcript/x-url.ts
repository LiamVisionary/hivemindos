// Parse an X (Twitter) post URL — or a bare tweet id — into its canonical
// tweet id and (when present) the author handle. Kept dependency-free and pure
// so it can be unit-tested hermetically (scripts/test-x-url.mjs) and reused by
// both the API route and the chat `/transcript` command.

export type ParsedXPost = {
  /** Numeric tweet/status id. */
  tweetId: string;
  /** Author handle without the leading @, when the URL carried one. */
  handle?: string;
  /** A normalized https://x.com/<handle>/status/<id> URL for downstream tools. */
  canonicalUrl: string;
};

// Hosts that are X or well-known X-mirror front-ends people paste. We only use
// the host to decide "this looks like an X link"; the id/handle come from the path.
const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "nitter.net",
  "vxtwitter.com",
  "fxtwitter.com",
  "fixupx.com",
  "fixvx.com",
  "twittpr.com",
]);

// In a `/status/<id>` path the id is unambiguously a tweet id, so accept any
// length (old tweets have tiny sequential ids, e.g. jack's is 20). A bare or
// fallback numeric segment must be longer to avoid mistaking `/photo/1` or a
// profile number for a tweet id.
const TWEET_ID_PATH_RE = /^\d{1,25}$/;
const TWEET_ID_BARE_RE = /^\d{8,25}$/;

function cleanHandle(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const handle = raw.replace(/^@+/, "").trim();
  // Reserved path segments that are not real handles.
  if (!handle || /^(i|web|status|statuses|home|search|hashtag|explore|messages)$/i.test(handle)) return undefined;
  if (!/^[A-Za-z0-9_]{1,20}$/.test(handle)) return undefined;
  return handle;
}

/**
 * Accepts: full X/twitter/mirror status URLs (with or without a handle, with
 * `/photo/1`, `/video/1`, query strings, or trailing slashes), and a bare
 * numeric tweet id. Returns null when no tweet id can be found.
 */
export function parseXPostUrl(input: string): ParsedXPost | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  // Bare tweet id.
  if (TWEET_ID_BARE_RE.test(raw)) {
    return { tweetId: raw, canonicalUrl: `https://x.com/i/status/${raw}` };
  }

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!X_HOSTS.has(host)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  // Find the ".../status(es)/<id>..." pattern anywhere in the path.
  const statusIndex = segments.findIndex((segment) => /^status(es)?$/i.test(segment));
  let tweetId = "";
  let handle: string | undefined;
  if (statusIndex >= 0 && TWEET_ID_PATH_RE.test(segments[statusIndex + 1] ?? "")) {
    tweetId = segments[statusIndex + 1];
    handle = cleanHandle(segments[statusIndex - 1]);
  } else {
    // Fallback: first long-enough numeric segment (covers odd mirrors) — the
    // stricter floor avoids treating /photo/1 or a profile number as an id.
    const numeric = segments.find((segment) => TWEET_ID_BARE_RE.test(segment));
    if (numeric) tweetId = numeric;
  }
  if (!tweetId) return null;

  return {
    tweetId,
    handle,
    canonicalUrl: `https://x.com/${handle ?? "i"}/status/${tweetId}`,
  };
}

/** True when the string plausibly references an X post (used to gate the command). */
export function looksLikeXPost(input: string): boolean {
  return parseXPostUrl(input) !== null;
}
