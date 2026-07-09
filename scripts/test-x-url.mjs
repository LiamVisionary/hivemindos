import { register } from "node:module";
import assert from "node:assert/strict";

// Native TS type-stripping + `@/` alias via the shared loader, then
// dynamic-import the module under test (the repo's standard hermetic pattern).
// Run with: node scripts/test-x-url.mjs
//
// Guards the X-post URL parser that both the /transcript command and the
// Integrations panel rely on to find the tweet id + author handle from anything
// a human pastes (full links, mirrors, mobile, /photo, query strings, bare id).
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { parseXPostUrl, looksLikeXPost } = await import("../src/lib/services/x-transcript/x-url.ts");

// ── Valid inputs resolve to the right tweet id (and handle when present) ──────
const VALID = [
  ["https://x.com/paulg/status/1780000000000000001", "1780000000000000001", "paulg"],
  ["https://twitter.com/paulg/status/1780000000000000001?s=20&t=abc", "1780000000000000001", "paulg"],
  ["https://mobile.twitter.com/user_1/status/1780000000000000001/photo/1", "1780000000000000001", "user_1"],
  ["http://x.com/naval/status/1234567890123456789/", "1234567890123456789", "naval"],
  ["https://vxtwitter.com/dril/status/1234567890", "1234567890", "dril"],
  ["https://x.com/i/web/status/1780000000000000001", "1780000000000000001", undefined],
  ["x.com/elonmusk/status/1780000000000000001", "1780000000000000001", "elonmusk"],
  ["1780000000000000001", "1780000000000000001", undefined],
  // Old tweets have tiny sequential ids — a /status/<id> path must accept any length.
  ["https://x.com/jack/status/20", "20", "jack"],
];
for (const [input, tweetId, handle] of VALID) {
  const parsed = parseXPostUrl(input);
  assert.ok(parsed, `should parse: ${input}`);
  assert.equal(parsed.tweetId, tweetId, `tweet id for: ${input}`);
  assert.equal(parsed.handle, handle, `handle for: ${input}`);
  assert.match(parsed.canonicalUrl, /^https:\/\/x\.com\/[^/]+\/status\/\d+$/, `canonical for: ${input}`);
  assert.equal(looksLikeXPost(input), true, `looksLikeXPost true for: ${input}`);
}

// Reserved segments are never treated as a handle.
assert.equal(parseXPostUrl("https://x.com/i/status/1780000000000000001").handle, undefined, "i/ is not a handle");

// ── Invalid inputs return null (and never crash) ─────────────────────────────
const INVALID = [
  "https://youtube.com/watch?v=abc",
  "https://x.com/paulg", // profile, no status
  "https://example.com/user/status/123",
  "not a url at all",
  "",
  "   ",
  "https://x.com/user/status/notanumber",
];
for (const input of INVALID) {
  assert.equal(parseXPostUrl(input), null, `should reject: ${JSON.stringify(input)}`);
  assert.equal(looksLikeXPost(input), false, `looksLikeXPost false for: ${JSON.stringify(input)}`);
}

// A bare SHORT number is not a tweet id (avoids false positives); a bare long id is.
assert.equal(parseXPostUrl("20"), null, "bare short number is not a tweet id");
assert.ok(parseXPostUrl("1780000000000000001"), "bare long id is a tweet id");

// Non-string / nullish inputs must not throw.
assert.equal(parseXPostUrl(undefined), null, "undefined is null");
assert.equal(parseXPostUrl(null), null, "null is null");

console.log("test-x-url: all assertions passed");
