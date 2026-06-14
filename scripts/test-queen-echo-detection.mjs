#!/usr/bin/env node
// Unit coverage for the Queen Bee realtime echo classifier - the guard that
// stops her from answering her own loudspeaker audio bleeding back into the
// still-open mic, WITHOUT muting the mic (so the user can always barge in).
// Bias under test: never drop a genuine user turn; suppress only true echoes.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { isLikelyEcho, normalizeTranscript } = await import(
  "../src/features/queen-voice/echo-detection.ts"
);

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${label}`);
}

check("normalize lowercases, strips punctuation, collapses whitespace", () => {
  assert.equal(
    normalizeTranscript("  Let's BUY the stock!! "),
    "let s buy the stock",
  );
});

// --- echoes that MUST be suppressed -------------------------------------
check("verbatim echo of the Queen's words is suppressed", () => {
  const queen = "I have queued the buy-stock task on the work board.";
  assert.equal(isLikelyEcho(queen, queen), true);
});

check("punctuation/case-only difference is still echo", () => {
  assert.equal(
    isLikelyEcho(
      "i have queued the buy stock task on the work board",
      "I have queued the buy-stock task on the work board.",
    ),
    true,
  );
});

check("garbled echo with most words shared is suppressed", () => {
  const queen =
    "Let me pull up the Alpaca brokerage and the on-chain xStocks rail for you";
  const echo = "let me pull up the alpaca brokerage and the on chain stocks rail";
  assert.equal(isLikelyEcho(echo, queen), true);
});

check("echo of the live (partial) Queen text is suppressed", () => {
  const partial = "okay i am opening the fleet view now";
  assert.equal(isLikelyEcho("okay i am opening the fleet view now", partial), true);
});

// --- genuine user turns that MUST survive --------------------------------
check("short confirmation is never dropped", () => {
  const queen = "I have queued the buy-stock task on the work board.";
  assert.equal(isLikelyEcho("yes do that", queen), false);
  assert.equal(isLikelyEcho("no wait", queen), false);
  assert.equal(isLikelyEcho("okay", queen), false);
});

check("user reusing a couple of the Queen's words still survives", () => {
  // Shares "alpaca"/"buy"/"stock" but covers little of her long utterance.
  const queen =
    "I can route this through the Alpaca brokerage or the on-chain xStocks buy-stock rail, whichever you prefer.";
  assert.equal(isLikelyEcho("use alpaca for the buy", queen), false);
});

check("a brand-new instruction is not an echo", () => {
  const queen = "The buy-stock task is queued on the work board.";
  assert.equal(
    isLikelyEcho("now check the fleet health on the hetzner box", queen),
    false,
  );
});

check("empty / trivially short strings are never echo", () => {
  assert.equal(isLikelyEcho("", "anything at all"), false);
  assert.equal(isLikelyEcho("ok", "anything at all"), false);
  assert.equal(isLikelyEcho("hello there", ""), false);
});

console.log(`\nqueen echo-detection: ${passed} checks passed.`);
