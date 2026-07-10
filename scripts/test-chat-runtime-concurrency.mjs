#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  interactiveRuntimeLockKey,
  releaseInteractiveRuntime,
  reserveInteractiveRuntime,
} = await import("../src/app/api/chat/agent-runtime/runtime-helpers.ts");
const { streamOpenAICompatibleRuntime } = await import(
  "../src/app/api/chat/agent-runtime/stream-openai-compatible.ts"
);

for (const runtime of ["hivemind-os", "hermes"]) {
  const profile = {
    id: `${runtime}-agent`,
    name: `${runtime} agent`,
    runtime,
    runtimeKind: "interactive",
  };
  const url = `http://127.0.0.1/${runtime}/chat`;
  const firstChatKey = interactiveRuntimeLockKey(profile, url, "chat-session-a");
  const secondChatKey = interactiveRuntimeLockKey(profile, url, "chat-session-b");

  try {
    assert.notEqual(
      firstChatKey,
      secondChatKey,
      `${runtime} should isolate interactive locks by chat session`,
    );
    assert.equal(reserveInteractiveRuntime(firstChatKey), true);
    assert.equal(
      reserveInteractiveRuntime(secondChatKey),
      true,
      `${runtime} should allow the same agent endpoint to serve a different chat concurrently`,
    );
    assert.equal(
      reserveInteractiveRuntime(firstChatKey),
      false,
      `${runtime} should still reject an overlapping turn in the same chat`,
    );
  } finally {
    releaseInteractiveRuntime(firstChatKey);
    releaseInteractiveRuntime(secondChatKey);
  }
}

const originalFetch = globalThis.fetch;
const pendingFetches = [];
globalThis.fetch = async () => new Promise((resolve) => pendingFetches.push(resolve));

const profile = {
  id: "concurrency-smoke-agent",
  name: "Concurrency smoke agent",
  runtime: "hivemind-os",
  runtimeKind: "interactive",
  gatewayUrl: "http://mock-runtime.invalid/v1",
  chatPath: "/chat/completions",
  provider: "custom-openai-compatible",
  model: "mock-model",
};
const startTurn = (runtimeSessionId) => streamOpenAICompatibleRuntime(
  profile,
  [{ role: "user", content: "hello" }],
  "hello",
  null,
  "act",
  undefined,
  undefined,
  false,
  runtimeSessionId,
);
const waitForFetchCount = async (count) => {
  for (let attempt = 0; attempt < 50 && pendingFetches.length < count; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(pendingFetches.length, count, `expected ${count} held upstream fetches`);
};
const completion = () => new Response(
  JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
  { status: 200, headers: { "content-type": "application/json" } },
);

try {
  const firstPromise = startTurn("dispatcher-chat-a");
  await waitForFetchCount(1);
  const secondPromise = startTurn("dispatcher-chat-b");
  await waitForFetchCount(2);
  const duplicate = await startTurn("dispatcher-chat-a");

  assert.equal(duplicate.status, 409, "the dispatcher should serialize one chat");
  assert.equal(
    pendingFetches.length,
    2,
    "two distinct chats should both reach the same held-open upstream",
  );
  for (const resolve of pendingFetches) resolve(completion());
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Interactive runtime locks isolate concurrent chat sessions.");
