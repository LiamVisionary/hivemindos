// Unit tests for the channel-markup router that splits leaked Harmony /
// <think> control tokens out of streamed model text.
// Run: node --test scripts/test-channel-markup.mjs (Node >= 23 strips the
// TypeScript types from the imported module natively).
import assert from "node:assert/strict";
import test from "node:test";

import {
  createChannelMarkupState,
  flushChannelMarkup,
  routeChannelMarkupDelta,
  routeChannelMarkupText,
} from "../src/lib/services/chat/channel-markup.ts";

function routeChunks(chunks) {
  const state = createChannelMarkupState();
  let content = "";
  let thinking = "";
  for (const chunk of chunks) {
    const routed = routeChannelMarkupDelta(chunk, state);
    content += routed.content;
    thinking += routed.thinking;
  }
  const flushed = flushChannelMarkup(state);
  content += flushed.content;
  thinking += flushed.thinking;
  return { content, thinking };
}

// Split a string into every possible pair of chunks and assert the routing is
// identical no matter where the stream boundary lands.
function assertBoundaryInvariant(text, expected) {
  for (let i = 0; i <= text.length; i += 1) {
    const result = routeChunks([text.slice(0, i), text.slice(i)]);
    assert.deepEqual(result, expected, `split at ${i}: ${JSON.stringify(text.slice(0, i))} | ${JSON.stringify(text.slice(i))}`);
  }
}

test("clean Harmony sequence routes analysis to thinking and final to content", () => {
  const text = "<|channel|>analysis<|message|>Let me think this through.<|end|><|start|>assistant<|channel|>final<|message|>Hello there!<|return|>";
  assert.deepEqual(routeChannelMarkupText(text), {
    content: "Hello there!",
    thinking: "Let me think this through.",
  });
});

test("Harmony sequence is boundary-invariant across all chunk splits", () => {
  const text = "<|channel|>analysis<|message|>Think.<|end|><|start|>assistant<|channel|>final<|message|>Answer.";
  assertBoundaryInvariant(text, { content: "Answer.", thinking: "Think." });
});

test("garbled pipe variants from a degraded model are not leaked", () => {
  // Reproduces the SwarmSovereign transcript: <|channel>thought ... <channel|> ...
  const text = "The visible answer.\n<|channel>thought\nHidden planning text.\n<channel|>More hidden text.";
  const routed = routeChannelMarkupText(text);
  assert.equal(routed.content, "The visible answer.\n");
  assert.equal(routed.thinking, "\nHidden planning text.\nMore hidden text.");
});

test("channel tag split after the closing > still switches channels", () => {
  const result = routeChunks(["Before <|channel|>", "analysis after"]);
  assert.equal(result.content, "Before ");
  assert.equal(result.thinking, " after");
});

test("label split across chunks still switches channels", () => {
  const result = routeChunks(["<|channel|>fin", "al<|message|>Answer"]);
  assert.deepEqual(result, { content: "Answer", thinking: "" });
});

test("tag split mid-token across chunks is reassembled", () => {
  const result = routeChunks(["Hi <|chan", "nel|>analysis hmm"]);
  assert.equal(result.content, "Hi ");
  assert.equal(result.thinking, " hmm");
});

test("<think> spans route to thinking", () => {
  assertBoundaryInvariant("a<think>b</think>c", { content: "ac", thinking: "b" });
});

test("XML channel element switches channels", () => {
  assert.deepEqual(routeChannelMarkupText("<channel>thinking</channel>hidden<channel>final</channel>shown"), {
    content: "shown",
    thinking: "hidden",
  });
});

test("plain text with < comparisons passes through untouched", () => {
  const text = "x < y and a<b, also 5 <6 and a <code-ish> token";
  assertBoundaryInvariant(text, { content: text, thinking: "" });
});

test("markdown/html-ish tags are not withheld at chunk boundaries", () => {
  const result = routeChunks(["see <div", "> tag"]);
  assert.deepEqual(result, { content: "see <div> tag", thinking: "" });
});

test("flush drops a dangling control-token fragment", () => {
  const result = routeChunks(["answer<|chann"]);
  assert.deepEqual(result, { content: "answer", thinking: "" });
});

test("flush emits a held complete tail instead of losing it", () => {
  // Turn ends exactly on a held "<|channel|>final" — nothing visible should leak,
  // and the held tag must not be emitted as text.
  const result = routeChunks(["done<|channel|>final"]);
  assert.deepEqual(result, { content: "done", thinking: "" });
});

test("channel tag followed by non-label prose is stripped without switching", () => {
  assert.deepEqual(routeChannelMarkupText("<channel|>Hello! I am here."), {
    content: "Hello! I am here.",
    thinking: "",
  });
});

test("<|end|> resets a thinking channel back to content", () => {
  assert.deepEqual(routeChannelMarkupText("<|channel|>analysis<|message|>plan<|end|>visible"), {
    content: "visible",
    thinking: "plan",
  });
});

test("tool-call commentary channel routes to thinking", () => {
  const text = "<|channel|>commentary to=functions.run_command<|message|>{\"cmd\":\"ls\"}<|end|>ok";
  const routed = routeChannelMarkupText(text);
  assert.equal(routed.content, "ok");
  assert.equal(routed.thinking, " to=functions.run_command{\"cmd\":\"ls\"}");
});
