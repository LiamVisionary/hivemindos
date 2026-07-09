#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  hermesApiMessages,
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

const collectorSource = readFileSync(
  new URL("./agent-telemetry-collector.mjs", import.meta.url),
  "utf8",
);
assert.match(collectorSource, /hermesApiSessionHeaders\(body, \{ authenticated: Boolean\(hermesApiKey\) \}\)/);
assert.match(collectorSource, /hermesSessionIdFromResponse\(upstream\.headers\)/);
assert.match(collectorSource, /hermesApiMessages\(body, text, normalizeMessageContent\)/);
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
