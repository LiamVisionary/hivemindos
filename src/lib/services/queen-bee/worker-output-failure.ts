/**
 * Classify worker chat output that is actually a runtime/transport failure.
 *
 * A worker runtime that can't reach its model API returns the transport error
 * AS its chat text ("API call failed after 3 retries: Connection error."). That
 * non-empty string used to sail through the autonomous-pickup empty-output
 * check and get recorded as a completed result — the task went "done" with a
 * failure message as its deliverable, and company memory then fed the fake DONE
 * to every later planning cycle ("do not repeat work listed as DONE").
 *
 * Only the whole-output shape counts: a long, real result that merely MENTIONS
 * a connection error is legitimate work product. So classification requires the
 * entire (trimmed) output to be short AND to start with a known failure shape.
 *
 * Kept dependency-free so hermetic tests can import it directly.
 */

const RUNTIME_FAILURE_MAX_LEN = 600;

const RUNTIME_FAILURE_PATTERNS: RegExp[] = [
  // Hermes/litellm-style transport failures ("API call failed after 3 retries: Connection error.")
  /^api call failed(?: after \d+ retr(?:y|ies))?\b/i,
  /^(?:error|fatal)?[:\s]*connection (?:error|refused|reset|closed|timed? ?out)/i,
  // Node/undici/OS-level network errors surfaced verbatim
  /^(?:[a-z]*error:\s*)?(?:fetch failed|econnrefused|econnreset|etimedout|enotfound|eai_again|socket hang ?up|network ?error)\b/i,
  // Provider-side rejections that mean "the runtime could not do the work at all"
  /^(?:\d{3}\s*)?(?:unauthorized|forbidden|invalid api key|authentication|rate.?limit(?:ed)?|too many requests|overloaded|insufficient[_ ]quota|quota exceeded)\b/i,
  /^(?:the )?model (?:api|endpoint|provider)?\s*(?:is )?(?:unreachable|unavailable|not configured|not found)\b/i,
  // Generic "request failed" prefixes some runtimes emit as their only message
  /^request (?:to .{0,120} )?failed\b/i,
];

/**
 * Returns a short description of the failure when `text` is failure-shaped
 * output, or null when it looks like a real result.
 */
export function classifyRuntimeFailureOutput(text: string): string | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed || trimmed.length > RUNTIME_FAILURE_MAX_LEN) return null;
  const collapsed = trimmed.replace(/\s+/g, " ");
  for (const pattern of RUNTIME_FAILURE_PATTERNS) {
    if (pattern.test(collapsed)) return collapsed.slice(0, 200);
  }
  return null;
}
