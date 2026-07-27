#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

process.env.NODE_ENV = "production";
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const semanticIntent = await import(
  "../src/lib/services/chat/semantic-video-intent.ts"
).catch(() => null);

assert.equal(
  typeof semanticIntent?.classifySemanticVideoIntent,
  "function",
  "video routing needs a semantic speech-act classifier instead of a keyword interception rule",
);
assert.equal(
  typeof semanticIntent?.semanticVideoMethodClarification,
  "function",
  "semantic ambiguity needs a reusable structured method question",
);
assert.equal(
  semanticIntent.semanticVideoIntentCandidate("I'm thinking of generating a video"),
  true,
  "video discussion must reach semantic classification even when it is not an action request",
);
assert.equal(
  semanticIntent.semanticVideoIntentCandidate("I'm thinking about our release notes"),
  false,
  "the semantic classifier should only run for video-shaped conversation",
);

const prompts = new Map([
  ["create a video announcing our release", "create_unspecified"],
  ["I'm thinking about generating a video for the release", "discussion"],
  ["use local video generation for the release", "create_local"],
  ["make this with HyperFrames", "create_html"],
  ["use our hypergen skill instead", "create_html"],
]);
const requests = [];
const fetcher = async (_url, init = {}) => {
  const body = JSON.parse(String(init.body ?? "{}"));
  requests.push(body);
  const latest = body.messages?.at(-1)?.content ?? "";
  const matched = [...prompts.entries()].find(([prompt]) => latest.includes(prompt));
  return Response.json({
    choices: [{ message: { content: JSON.stringify({ intent: matched?.[1] ?? "other", confidence: 0.98 }) } }],
  });
};

for (const [prompt, expected] of prompts) {
  const result = await semanticIntent.classifySemanticVideoIntent({
    url: "http://runtime.invalid/v1/chat/completions",
    headers: { Authorization: "Bearer test" },
    model: "test-model",
    messages: [{ role: "user", content: prompt }],
    fetcher,
  });
  assert.equal(result?.intent, expected, prompt);
}

assert.equal(requests.length, prompts.size);
assert.equal(requests[0].stream, false);
assert.equal(requests[0].temperature, 0);
assert.equal(requests[0].response_format?.type, "json_schema");
assert.match(requests[0].messages?.[0]?.content ?? "", /hypergen/i, "the common HyperFrames shorthand should resolve semantically");
assert.deepEqual(
  requests[0].response_format?.json_schema?.schema?.properties?.intent?.enum,
  ["other", "discussion", "create_unspecified", "create_cloud", "create_local", "create_html"],
);

const malformed = await semanticIntent.classifySemanticVideoIntent({
  url: "http://runtime.invalid/v1/chat/completions",
  headers: {},
  model: "test-model",
  messages: [{ role: "user", content: "create something" }],
  fetcher: async () => Response.json({ choices: [{ message: { content: "not json" } }] }),
});
assert.equal(malformed, null, "an invalid classifier response must fall back to ordinary agent reasoning");

const clarification = semanticIntent.semanticVideoMethodClarification("create a video announcing our release");
assert.equal(clarification.question, "How should I make this video?");
assert.deepEqual(
  clarification.choices.map((choice) => choice.label),
  ["Cloud AI video", "Local AI video", "HTML / HyperFrames"],
);
assert.match(clarification.choices[0].value, /^Use cloud video generation for this request:/);

console.log("Semantic video intent distinguishes action, discussion, explicit methods, and invalid classifier output.");
