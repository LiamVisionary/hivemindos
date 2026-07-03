#!/usr/bin/env node
// Hermetic: the queen-bee autonomous pickup must treat runtime/transport error
// text ("API call failed after 3 retries: Connection error.") as a FAILED
// pickup, never as a completed result. Regression test for the 2026-07-03
// Website Outreach Agency incident where a runner with a dead model API
// "completed" six tasks whose results were the error string, poisoning company
// memory with fake DONEs.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { classifyRuntimeFailureOutput } = await import("../src/lib/services/queen-bee/worker-output-failure.ts");

// ── failure-shaped output must classify ──────────────────────────────────────
const failures = [
  "API call failed after 3 retries: Connection error.",
  "API call failed: Connection error",
  "api call failed after 1 retry: timeout",
  "Connection error",
  "connection timed out",
  "Connection refused",
  "fetch failed",
  "ECONNREFUSED 127.0.0.1:11434",
  "TypeError: fetch failed",
  "ETIMEDOUT",
  "socket hang up",
  "429 Too Many Requests",
  "Rate limited. Please retry later.",
  "rate-limit exceeded",
  "unauthorized: invalid token",
  "Invalid API key provided",
  "insufficient_quota: you have exceeded your quota",
  "The model endpoint is unreachable",
  "model provider not configured",
  "Request to https://api.example.com/v1/chat failed with status 502",
  "  API call failed after 3 retries: Connection error.  ", // whitespace-padded
];
for (const text of failures) {
  assert.ok(
    classifyRuntimeFailureOutput(text),
    `should classify as runtime failure: ${JSON.stringify(text)}`,
  );
}

// ── real results must NOT classify ───────────────────────────────────────────
const results = [
  "Done. Created 5 outreach email templates and saved them to the vault.",
  "Connection pooling improvements shipped; latency down 40%.",
  "I analyzed the outreach data. API call failed rates were reduced by adding retries.",
  // A long real deliverable that MENTIONS a connection error mid-text is work
  // product, not a transport failure.
  `Outreach analysis for Sarasota leads:\n${"- lead row\n".repeat(30)}Note: one webhook saw a transient connection error and recovered.`,
  "Rate limits for the follow-up sequence were configured at 5/day per lead.",
  "",
  "   ",
];
for (const text of results) {
  assert.equal(
    classifyRuntimeFailureOutput(text),
    null,
    `should NOT classify as runtime failure: ${JSON.stringify(text.slice(0, 60))}`,
  );
}

// ── very long error-ish text stays unclassified (likelier real content) ──────
assert.equal(classifyRuntimeFailureOutput(`API call failed after 3 retries: ${"x".repeat(700)}`), null);

// ── classification returns a short description for the failure message ───────
const description = classifyRuntimeFailureOutput("API call failed after 3 retries: Connection error.");
assert.ok(description.length <= 200);
assert.match(description, /API call failed/);

console.log("PASS test-worker-output-failure");
