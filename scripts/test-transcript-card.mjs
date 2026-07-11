import { register } from "node:module";
import assert from "node:assert/strict";

// Native TS type-stripping + `@/` alias via the shared loader, then
// dynamic-import the module under test. Run: node scripts/test-transcript-card.mjs
//
// Guards the /transcript chat card's content-marker round-trip: the card lives
// inside the assistant message content (a percent-encoded HTML-comment marker)
// so it persists + rehydrates with no chat-storage changes. A regression here
// silently drops the transcript card. This suite caught a real bug during the
// build — a fenced-code marker collided with transcripts that contain ``` — so
// the marker is now an HTML comment whose payload can never contain "-->".
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { buildTranscriptCardContent, extractTranscriptCard, transcriptCardIsRunning } = await import(
  "../src/features/dashboard/chat-transcript-card.ts"
);

const card = {
  id: "transcript-abc",
  status: "ready",
  url: "https://x.com/user/status/123",
  kind: "video",
  transcript: "line one\nline two",
  author: { handle: "user" },
  source: "yt-dlp + whisper",
};

// 1) Basic round-trip: card is recovered and the trailing summary is remainingText.
const summary = "This is the summary.\n\nAnd a follow-up question?";
const parsed = extractTranscriptCard(buildTranscriptCardContent(card, summary));
assert.ok(parsed, "should extract");
assert.equal(parsed.card.id, "transcript-abc");
assert.equal(parsed.card.transcript, "line one\nline two");
assert.equal(parsed.remainingText, summary, "remainingText is exactly the summary");

// 2) A transcript containing a ``` code fence must NOT break extraction.
const tricky = { ...card, transcript: "code:\n```js\nconst a = 1;\n```\nend" };
const trickyParsed = extractTranscriptCard(buildTranscriptCardContent(tricky, "summary here"));
assert.ok(trickyParsed, "extracts with backticks in transcript");
assert.equal(trickyParsed.card.transcript, tricky.transcript, "backtick transcript preserved");
assert.equal(trickyParsed.remainingText, "summary here");

// 3) Unicode / emoji transcript survives (encodeURIComponent is UTF-8 safe).
const unicode = { ...card, transcript: "café ☕ 日本語 — dash" };
const unicodeParsed = extractTranscriptCard(buildTranscriptCardContent(unicode));
assert.ok(unicodeParsed);
assert.equal(unicodeParsed.card.transcript, "café ☕ 日本語 — dash");

// 4) Summary containing JSON and an HTML-ish arrow survives as remainingText.
const jsonSummary = 'Summary with {"k":"v"} and a --> arrow.';
const jsonParsed = extractTranscriptCard(buildTranscriptCardContent(card, jsonSummary));
assert.ok(jsonParsed);
assert.equal(jsonParsed.remainingText, jsonSummary);

// 5) Running card (no transcript, no trailing) round-trips with empty remainingText.
const runningParsed = extractTranscriptCard(buildTranscriptCardContent({ id: "t2", status: "running", url: "https://x.com/u/status/9" }));
assert.ok(runningParsed);
assert.equal(runningParsed.card.status, "running");
assert.equal(runningParsed.remainingText, "");
assert.equal(transcriptCardIsRunning(buildTranscriptCardContent(runningParsed.card)), true, "running cards keep the sidebar active");
assert.equal(transcriptCardIsRunning(buildTranscriptCardContent(card)), false, "ready cards stop the sidebar activity state");

// 6) Plain messages are never misparsed as a card.
assert.equal(extractTranscriptCard("let's talk about the hive-transcript feature"), null, "no marker → null");
assert.equal(extractTranscriptCard("normal message"), null);
assert.equal(extractTranscriptCard("<!--hive-transcript:not%20valid%20json-->"), null, "non-JSON payload → null, not a crash");

// 7) Missing id is rejected (coerceCard requires a stable id for replace-by-id).
assert.equal(extractTranscriptCard("<!--hive-transcript:" + encodeURIComponent(JSON.stringify({ status: "ready" })) + "-->"), null, "no id → null");

console.log("test-transcript-card: all assertions passed");
