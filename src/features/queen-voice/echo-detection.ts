// Pure text heuristics for deciding whether a freshly transcribed "user" turn
// is really the Queen's own loudspeaker audio bleeding back into the live mic.
//
// The realtime voice session keeps the mic open while the Queen speaks (so the
// user can barge in), which means her output can be re-heard and transcribed as
// a "user" turn. We never mute the mic; instead the client refuses to generate
// a reply for turns whose transcript echoes what she is/was just saying.
//
// Kept dependency-free (no React, no network) so it unit-tests directly under
// Node. Tuned to bias toward NEVER dropping a real user turn: a short reply that
// merely reuses a couple of the Queen's words must survive, while a full-sentence
// reflection of her speech is suppressed.

export function normalizeTranscript(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * True when `userText` looks like an echo of `queenText`.
 *
 * Conservative by design (bias: responsiveness over silence):
 *  - trivially short strings never match (coincidence is too likely);
 *  - a clean substring reflection is unambiguous echo;
 *  - the fuzzy path requires BOTH that most of the user's words are the Queen's
 *    AND that they cover a large slice of what she actually said — so a brief
 *    genuine confirmation that happens to reuse a few of her words (low coverage
 *    of her long utterance) is not mistaken for an echo.
 */
export function isLikelyEcho(userText: string, queenText: string): boolean {
  const user = normalizeTranscript(userText);
  const queen = normalizeTranscript(queenText);
  if (user.length < 3 || queen.length < 3) return false;
  if (queen.includes(user)) return true;

  const userTokens = user.split(" ").filter(Boolean);
  const queenTokens = queen.split(" ").filter(Boolean);
  // Protect short genuine turns ("yes", "do that", "no wait") from ever being
  // dropped, and don't fuzzy-match against a tiny Queen reference.
  if (userTokens.length < 4 || queenTokens.length < 4) return false;

  const queenSet = new Set(queenTokens);
  const shared = userTokens.filter((token) => queenSet.has(token)).length;
  const userCoverage = shared / userTokens.length;
  const queenCoverage = shared / queenTokens.length;
  return userCoverage >= 0.6 && queenCoverage >= 0.4;
}
