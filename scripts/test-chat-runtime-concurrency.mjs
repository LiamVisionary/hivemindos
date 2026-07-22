#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { streamOpenAICompatibleRuntime } = await import(
  "../src/app/api/chat/agent-runtime/stream-openai-compatible.ts"
);
const { streamHttpRuntime } = await import(
  "../src/app/api/chat/agent-runtime/stream-http-runtime.ts"
);
const {
  findChatRunAssistantIndex,
  finishChatStreamState,
  markChatStreamChunkState,
  reconcilePolledChatProcessState,
  reconcilePolledChatStreamState,
  startChatStreamState,
} = await import("../src/features/dashboard/hooks/status-chat-stream-state.ts");

let streamState = {};
const setStreamState = (updater) => { streamState = updater(streamState); };
const streamInput = (runId, startedAt) => ({
  agentId: "same-agent",
  leafKey: "same-thread",
  runId,
  startedAt,
  storageKey: "same-thread",
  setChatStreamingByKey: setStreamState,
});
startChatStreamState(streamInput("run-a", 1_000));
startChatStreamState(streamInput("run-b", 2_000));
assert.deepEqual(
  Object.keys(streamState["same-thread"].runs).sort(),
  ["run-a", "run-b"],
  "one chat thread should track simultaneous turns independently",
);
markChatStreamChunkState(setStreamState, "same-thread", "run-a");
assert.equal(streamState["same-thread"].runs["run-a"].hasChunk, true);
finishChatStreamState(setStreamState, "same-thread", "run-a");
assert.equal(streamState["same-thread"].runId, "run-b", "finishing one turn must not clear another active turn");
finishChatStreamState(setStreamState, "same-thread", "run-b");
assert.equal(streamState["same-thread"], undefined);

startChatStreamState(streamInput("run-a", 1_000));
markChatStreamChunkState(setStreamState, "same-thread", "run-a");
startChatStreamState(streamInput("run-b", 2_000));
streamState = reconcilePolledChatStreamState(streamState, {
  active: true,
  agentId: "same-agent",
  hasChunk: false,
  leafKey: "same-thread",
  runId: "run-a",
  startedAt: 1_000,
  storageKey: "same-thread",
});
assert.equal(streamState["same-thread"].runs["run-a"].hasChunk, true, "a lagging session poll must not hide a live response chunk");
streamState = reconcilePolledChatStreamState(streamState, {
  active: false,
  agentId: "same-agent",
  hasChunk: false,
  leafKey: "same-thread",
  runId: "run-a",
  startedAt: 1_000,
  storageKey: "same-thread",
});
assert.equal(streamState["same-thread"].runId, "run-b", "an ended polled run must not clear another turn in the same chat");

let processState = {
  "same-thread": [
    { at: 1_100, label: "run a", runId: "run-a" },
    { at: 2_100, label: "run b", runId: "run-b" },
  ],
};
processState = reconcilePolledChatProcessState(processState, {
  active: true,
  entries: [{ at: 1_200, label: "run a polled", runId: "run-a" }],
  runId: "run-a",
  startedAt: 1_000,
  storageKey: "same-thread",
});
assert.deepEqual(processState["same-thread"].map((event) => event.label), ["run a", "run a polled", "run b"]);
processState = reconcilePolledChatProcessState(processState, {
  active: false,
  entries: [],
  runId: "run-a",
  startedAt: 1_000,
  storageKey: "same-thread",
});
assert.deepEqual(processState["same-thread"].map((event) => event.label), ["run b"], "ending one run preserves another run's process log");
assert.equal(
  findChatRunAssistantIndex([
    { role: "user" },
    { role: "assistant", sourceSessionId: "run-a" },
    { role: "user" },
    { role: "assistant", sourceSessionId: "run-b" },
  ], "run-a"),
  1,
  "an older turn must keep targeting its own response after a newer turn starts",
);

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
  const overlappingSameChatPromise = startTurn("dispatcher-chat-a");
  await waitForFetchCount(3);
  assert.equal(
    pendingFetches.length,
    3,
    "same-agent and same-thread turns should all reach the held-open upstream concurrently",
  );
  for (const resolve of pendingFetches) resolve(completion());
  const [first, second, overlappingSameChat] = await Promise.all([
    firstPromise,
    secondPromise,
    overlappingSameChatPromise,
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(overlappingSameChat.status, 200);

  pendingFetches.length = 0;
  const httpProfile = {
    id: "concurrency-hermes-agent",
    name: "Concurrency Hermes agent",
    runtime: "hermes",
    runtimeKind: "interactive",
    telemetryUrl: "http://mock-collector.invalid",
    chatPath: "/chat",
    provider: "mock-provider",
    model: "mock-model",
  };
  const startHttpTurn = (runtimeSessionId) => streamHttpRuntime(
    httpProfile,
    [{ role: "user", content: "hello" }],
    "hello",
    null,
    "act",
    undefined,
    undefined,
    false,
    runtimeSessionId,
  );
  const firstHttpPromise = startHttpTurn("same-hermes-thread");
  await waitForFetchCount(1);
  const secondHttpPromise = startHttpTurn("same-hermes-thread");
  await waitForFetchCount(2);
  for (const resolve of pendingFetches) resolve(completion());
  const httpResponses = await Promise.all([firstHttpPromise, secondHttpPromise]);
  assert.deepEqual(httpResponses.map((response) => response.status), [200, 200]);
} finally {
  globalThis.fetch = originalFetch;
}

const [httpRuntimeSource, openAiRuntimeSource, composerSource, controllerSource] = await Promise.all([
  readFile(new URL("../src/app/api/chat/agent-runtime/stream-http-runtime.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/chat/agent-runtime/stream-openai-compatible.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/features/dashboard/views/chat/exchange/ExchangeComposer.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/dashboard/hooks/use-status-chat-input-controller.tsx", import.meta.url), "utf8"),
]);
for (const source of [httpRuntimeSource, openAiRuntimeSource]) {
  assert.doesNotMatch(source, /already running another interactive request/i);
}
assert.doesNotMatch(composerSource, /Waiting for the agent/);
assert.doesNotMatch(controllerSource, /Message queued for after the current task finishes/);

console.log("Agent chat turns run concurrently without a per-agent or per-thread mutex.");
