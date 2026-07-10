#!/usr/bin/env node
// Hermetic unit test for the per-message reasoning-effort types + capability
// matrix (src/lib/types/chat-reasoning-effort.ts). No network, no live app —
// imports the TS module directly via Node's native type-stripping.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  CHAT_REASONING_EFFORTS,
  CHAT_REASONING_EFFORT_OPTIONS,
  normalizeChatReasoningEffort,
  chatReasoningEffortLabel,
  REASONING_EFFORT_PROVIDER_SUPPORT,
  modelSupportsReasoningEffort,
  reasoningEffortRequestBody,
} = await import("../src/lib/types/chat-reasoning-effort.ts");

// --- shape ---------------------------------------------------------------
assert.deepEqual(
  [...CHAT_REASONING_EFFORTS],
  ["minimal", "low", "medium", "high", "max"],
  "effort tuple should carry the five UI levels in order",
);
assert.deepEqual(
  CHAT_REASONING_EFFORT_OPTIONS.map((option) => [option.effort, option.label]),
  [
    ["minimal", "Minimal"],
    ["low", "Low"],
    ["medium", "Medium"],
    ["high", "High"],
    ["max", "Max"],
  ],
  "options should pair each effort with its capitalized label",
);

// --- normalize fallback --------------------------------------------------
assert.equal(normalizeChatReasoningEffort(undefined), "medium", "undefined falls back to medium");
assert.equal(normalizeChatReasoningEffort(null), "medium", "null falls back to medium");
assert.equal(normalizeChatReasoningEffort(""), "medium", "empty string falls back to medium");
assert.equal(normalizeChatReasoningEffort("bogus"), "medium", "unknown value falls back to medium");
assert.equal(normalizeChatReasoningEffort(" HIGH "), "high", "normalizes case and whitespace");
assert.equal(normalizeChatReasoningEffort("max"), "max", "recognizes a valid level");
assert.equal(chatReasoningEffortLabel("high"), "High", "label helper returns the option label");
assert.equal(chatReasoningEffortLabel(normalizeChatReasoningEffort("nope")), "Medium", "label helper handles the fallback");

// --- matrix: unsupported provider returns {} -----------------------------
assert.deepEqual(
  reasoningEffortRequestBody("groq", "llama-3.3-70b", "high"),
  {},
  "an unlisted provider contributes no reasoning body",
);
assert.equal(modelSupportsReasoningEffort("groq", "llama-3.3-70b"), false, "unlisted provider is unsupported");
// Providers explicitly parked as "none" (deliberate exclusions) also yield {}.
assert.equal(REASONING_EFFORT_PROVIDER_SUPPORT.openrouter.wire, "none", "openrouter is deliberately parked as none");
assert.deepEqual(reasoningEffortRequestBody("openrouter", "openai/o3", "high"), {}, "a none-wire provider contributes nothing");
assert.equal(modelSupportsReasoningEffort("openrouter", "openai/o3"), false, "none-wire provider is unsupported");

// --- matrix: supported provider returns the right wire key ---------------
assert.equal(modelSupportsReasoningEffort("openai-api", "o3"), true, "openai reasoning model is supported");
assert.equal(modelSupportsReasoningEffort("openai", "gpt-5.1"), true, "openai gpt-5 family is supported");
assert.deepEqual(
  reasoningEffortRequestBody("openai-api", "o3", "high"),
  { reasoning_effort: "high" },
  "openai reasoning model emits a top-level reasoning_effort field",
);
assert.deepEqual(
  reasoningEffortRequestBody("openai", "gpt-5.1", "low"),
  { reasoning_effort: "low" },
  "provider slug + effort thread through to the wire body",
);
// "max" is not a wire-valid literal anywhere → clamps to the highest ("high").
assert.deepEqual(
  reasoningEffortRequestBody("openai-api", "o3", "max"),
  { reasoning_effort: "high" },
  "max clamps to high on the wire",
);
// A non-reasoning model on a supported provider is gated out by the model regex.
assert.equal(modelSupportsReasoningEffort("openai-api", "gpt-4o"), false, "non-reasoning openai model is gated out");
assert.deepEqual(
  reasoningEffortRequestBody("openai-api", "gpt-4o", "high"),
  {},
  "non-reasoning model contributes no reasoning body even on a supported provider",
);
// A blank/unknown effort still resolves to the safe medium default when supported.
assert.deepEqual(
  reasoningEffortRequestBody("openai-api", "o3", ""),
  { reasoning_effort: "medium" },
  "blank effort resolves to the medium default on a supported model",
);

console.log("chat reasoning effort checks passed");
