#!/usr/bin/env node
// Hermetic unit test for the pure chat-thread-usage join. Only exercises
// joinThreadUsage with in-memory fixtures — never touches ~/.hermes,
// ~/.openclaw, or ~/.hivemindos.
import assert from "node:assert/strict";

const { joinThreadUsage } = await import("../src/lib/services/chat/thread-usage.ts");

const KEY = "thread-A";

// Two runtime sessions in one thread, carrying per-message cost/balance billing
// (chat messages never carry token counts).
const sessions = [
  {
    id: "s1",
    sessionId: "s1",
    runtime: "hermes",
    source: "hivemindos-chat",
    agentId: "local-hermes",
    agentName: "Hermes",
    chatStorageKey: KEY,
    startedAt: 1000,
    updatedAt: 2000,
    messages: [
      { index: 0, role: "user", content: "hi", createdAt: 1000 },
      { index: 1, role: "assistant", content: "hello", createdAt: 2000, billing: { provider: "openrouter", costUsd: 0.01, balanceUsd: 5.0 } },
    ],
  },
  {
    id: "s2",
    sessionId: "s2",
    runtime: "openclaw",
    source: "hivemindos-chat",
    agentId: "clawbot",
    agentName: "Claw",
    chatStorageKey: KEY,
    startedAt: 3000,
    updatedAt: 5000,
    messages: [
      { index: 0, role: "user", content: "again", createdAt: 3000 },
      { index: 1, role: "assistant", content: "sure", createdAt: 4000, billing: { provider: "venice", costUsd: 0.02, balanceUsd: 4.5 } },
      { index: 2, role: "assistant", content: "more", createdAt: 5000, billing: { provider: "openrouter", costUsd: 0.005 } },
    ],
  },
];

function row(overrides) {
  return {
    runtime: "hermes",
    agentId: "a",
    sessionId: "s1",
    source: "cli",
    model: "openai/gpt-x",
    updatedAt: new Date(0).toISOString(),
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    ...overrides,
  };
}

const rows = [
  row({ runtime: "hermes", sessionId: "s1", model: "openai/gpt-x", inputTokens: 100, outputTokens: 50, cacheTokens: 10, reasoningTokens: 5, totalTokens: 165 }),
  row({ runtime: "openclaw", sessionId: "s2", model: "anthropic/claude-y", inputTokens: 200, outputTokens: 80, cacheTokens: 0, reasoningTokens: 0, totalTokens: 280 }),
  // Unrelated session — must NOT be counted.
  row({ runtime: "hermes", sessionId: "other", model: "z", inputTokens: 999, outputTokens: 999, cacheTokens: 999, reasoningTokens: 999, totalTokens: 3996 }),
];

// --- Full join: tokens summed only from matched rows -----------------------
const usage = joinThreadUsage(rows, sessions, KEY);
assert.equal(usage.ok, true);
assert.equal(usage.chatStorageKey, KEY);
assert.equal(usage.sessionCount, 2);
assert.equal(usage.messageCount, 5);
assert.equal(usage.tokensAvailable, true);
assert.deepEqual(usage.tokens, { input: 300, output: 130, cache: 10, reasoning: 5, total: 445 });
// cost summed from billing across all sessions' messages (float-safe).
assert.equal(usage.costUsd, 0.035);
// latest known balance = most-recent message that carried a balance (4000, 4.5).
assert.equal(usage.balanceUsd, 4.5);
// distinct, sorted lists.
assert.deepEqual(usage.models, ["anthropic/claude-y", "openai/gpt-x"]);
assert.deepEqual(usage.providers, ["openrouter", "venice"]);
assert.deepEqual(usage.runtimes, ["hermes", "openclaw"]);

// --- chatStorageKey derives from sessions when omitted ---------------------
const derived = joinThreadUsage(rows, sessions);
assert.equal(derived.chatStorageKey, KEY);

// --- No usage row matches -> tokensAvailable false, tokens stay 0 ----------
const noMatch = joinThreadUsage(
  [row({ sessionId: "zzz", inputTokens: 1, outputTokens: 1, totalTokens: 2 })],
  sessions,
  KEY,
);
assert.equal(noMatch.tokensAvailable, false);
assert.deepEqual(noMatch.tokens, { input: 0, output: 0, cache: 0, reasoning: 0, total: 0 });
assert.deepEqual(noMatch.models, []);
// billing-derived fields still populate honestly even without token rows.
assert.equal(noMatch.costUsd, 0.035);
assert.deepEqual(noMatch.providers, ["openrouter", "venice"]);
assert.deepEqual(noMatch.runtimes, ["hermes", "openclaw"]);
assert.equal(noMatch.sessionCount, 2);
assert.equal(noMatch.messageCount, 5);

// --- Empty thread -> honest zero/empty shape -------------------------------
const empty = joinThreadUsage([], [], KEY);
assert.equal(empty.ok, true);
assert.equal(empty.chatStorageKey, KEY);
assert.equal(empty.sessionCount, 0);
assert.equal(empty.messageCount, 0);
assert.equal(empty.tokensAvailable, false);
assert.deepEqual(empty.tokens, { input: 0, output: 0, cache: 0, reasoning: 0, total: 0 });
assert.equal(empty.costUsd, 0);
assert.equal(empty.balanceUsd, undefined);
assert.deepEqual(empty.models, []);
assert.deepEqual(empty.providers, []);
assert.deepEqual(empty.runtimes, []);

console.log("chat thread usage join checks passed");
