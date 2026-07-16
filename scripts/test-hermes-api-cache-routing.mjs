#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  hermesApiMessages,
  hermesApiSelectionMatchesAgent,
  hermesApiSessionHeaders,
  hermesSessionIdFromResponse,
} = await import("./lib/hermes-api-request-routing.mjs");

const body = {
  sessionKey: "queen-bee-voice:xai-oauth:grok-4.5",
  runtimeSessionId: "runtime-turn-volatile",
  messages: [
    { role: "system", content: "Stable Queen contract" },
    { role: "user", content: "Dynamic user turn" },
  ],
};

const first = hermesApiMessages(body, "fallback text");
const second = hermesApiMessages(body, "fallback text");
assert.deepEqual(first, second, "the same prompt produces the same cache prefix");
assert.equal(first[0].role, "system");
assert.equal(first[0].content, "Stable Queen contract");
assert.equal(
  first.some((message) => /request marker/i.test(String(message.content))),
  false,
  "a per-request marker must not invalidate the prompt prefix",
);

assert.deepEqual(hermesApiSessionHeaders(body), {
  "X-Hermes-Session-Key": "queen-bee-voice:xai-oauth:grok-4.5",
});
assert.deepEqual(
  hermesApiSessionHeaders(body, { authenticated: false }),
  {},
  "Hermes rejects session headers when its API server has no authentication key",
);
assert.deepEqual(
  hermesApiSessionHeaders({ hermesSessionId: "api-explicit", sessionKey: "queen" }),
  {
    "X-Hermes-Session-Id": "api-explicit",
    "X-Hermes-Session-Key": "queen",
  },
);
assert.equal(
  hermesSessionIdFromResponse(new Headers({ "X-Hermes-Session-Id": "api-upstream" })),
  "api-upstream",
);

const gatewaySelection = { provider: "openai-codex", model: "gpt-5.6-sol" };
assert.equal(
  hermesApiSelectionMatchesAgent(
    { provider: "openai-codex", model: "gpt-5.6-sol" },
    gatewaySelection,
  ),
  true,
  "an explicitly selected agent matching the warm gateway must stay on the API path",
);
assert.equal(
  hermesApiSelectionMatchesAgent(
    { provider: "openrouter", model: "gpt-5.6-sol" },
    gatewaySelection,
  ),
  false,
  "a provider mismatch must keep using the model-scoped CLI path",
);
assert.equal(
  hermesApiSelectionMatchesAgent(
    { provider: "openai-codex", model: "gpt-5.5" },
    gatewaySelection,
  ),
  false,
  "a model mismatch must keep using the model-scoped CLI path",
);
assert.equal(
  hermesApiSelectionMatchesAgent({}, gatewaySelection),
  true,
  "an unscoped agent may use the gateway default",
);

const collectorSource = readFileSync(
  new URL("./agent-telemetry-collector.mjs", import.meta.url),
  "utf8",
);
assert.match(collectorSource, /hermesApiSessionHeaders\(body, \{ authenticated: Boolean\(hermesApiKey\) \}\)/);
assert.match(collectorSource, /hermesSessionIdFromResponse\(upstream\.headers\)/);
assert.match(collectorSource, /hermesApiMessages\(body, text, normalizeMessageContent\)/);
assert.match(collectorSource, /hermesApiSelectionMatchesAgent\(agent, gatewaySelection\)/);
assert.match(
  collectorSource,
  /pathname === "\/ready"/,
  "the phone must have a constant-time collector readiness endpoint",
);
assert.doesNotMatch(collectorSource, /HivemindOS request marker:/);

const runtimeSource = readFileSync(
  new URL("../src/app/api/chat/agent-runtime/stream-http-runtime.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  runtimeSource,
  /hermesSessionId:\s*runtimeSessionId/,
  "an app session id must not be mistaken for a persistent Hermes transcript id",
);

console.log("Hermes API cache/session routing contract ok");
