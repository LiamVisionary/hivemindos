#!/usr/bin/env node
// Hermetic: the typed Queen chat streaming pipeline — SSE frame parsing across
// arbitrary chunk boundaries, OpenAI delta accumulation (content + index-keyed
// tool-call argument fragments), and the finalized turn matching the blocking
// chat-turn contract. Plus the Work Board lookup helpers the read_work_board
// tool and the Discuss enrichment share.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  applyOpenAiChatChunk,
  createQueenChatStreamState,
  createSseJsonParser,
  finalizeQueenChatStream,
} = await import("../src/lib/services/queen-bee/chat-stream.ts");
const {
  findWorkBoardTasks,
  flattenKanbanColumns,
  formatWorkBoardTaskForPrompt,
  summarizeWorkBoardByStatus,
} = await import("../src/features/dashboard/work-board-lookup.ts");

// ── content deltas accumulate and are forwarded one by one ──────────────────
{
  const state = createQueenChatStreamState();
  assert.equal(applyOpenAiChatChunk(state, { choices: [{ delta: { content: "Hel" } }] }), "Hel");
  assert.equal(applyOpenAiChatChunk(state, { choices: [{ delta: { content: "lo" } }] }), "lo");
  assert.equal(applyOpenAiChatChunk(state, { choices: [{ delta: {} }] }), "");
  const done = finalizeQueenChatStream(state);
  assert.equal(done.content, "Hello");
  assert.deepEqual(done.toolCalls, []);
  assert.deepEqual(done.assistant, { role: "assistant", content: "Hello" });
}

// ── tool-call fragments concatenate per index, not per chunk position ────────
{
  const state = createQueenChatStreamState();
  applyOpenAiChatChunk(state, { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read_work_board", arguments: "" } }] } }] });
  applyOpenAiChatChunk(state, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{\"taskId\":" } }] } }] });
  applyOpenAiChatChunk(state, { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"t_abc123_xyz\"}" } }] } }] });
  const done = finalizeQueenChatStream(state);
  assert.equal(done.content, "");
  assert.deepEqual(done.toolCalls, [{ id: "call_1", name: "read_work_board", arguments: '{"taskId":"t_abc123_xyz"}' }]);
  assert.deepEqual(done.assistant, {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "call_1", type: "function", function: { name: "read_work_board", arguments: '{"taskId":"t_abc123_xyz"}' } }],
  });
}

// ── SSE parser survives frames split at arbitrary byte boundaries ────────────
{
  const feed = createSseJsonParser();
  const frames = [
    'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choi',
    'ces":[{"delta":{"content":"b"}}]}\n\nda',
    "ta: [DONE]\n\n",
  ];
  const state = createQueenChatStreamState();
  let sawDone = false;
  for (const frame of frames) {
    const { done, chunks } = feed(frame);
    for (const chunk of chunks) applyOpenAiChatChunk(state, chunk);
    sawDone = sawDone || done;
  }
  assert.equal(state.content, "ab");
  assert.equal(sawDone, true);
}

// ── garbled frames are skipped, not fatal ────────────────────────────────────
{
  const feed = createSseJsonParser();
  const { done, chunks } = feed("data: {not json}\ndata: [DONE]\n");
  assert.equal(chunks.length, 0);
  assert.equal(done, true);
}

// ── work board lookup: flatten, find by id / phrase / loose words ────────────
{
  // Primary fixture mirrors the LIVE /api/kanban shape: an array of lane
  // objects `{ id, title, description, tasks }` (confirmed against the running
  // route 2026-07-04 — an earlier map-shaped assumption made the Queen read an
  // empty board).
  const columns = [
    { id: "ready", title: "Ready", description: "", tasks: [{ id: "t_aaa1_x", title: "Verify outreach email deliverability setup", status: "ready" }] },
    { id: "needs-human", title: "Needs You", description: "", tasks: [{ id: "t_bbb2_y", title: "Resolve email deliverability setup issues", status: "needs-human", assignee: "HermesMain", lastFailureReason: "agent-error", result: "Queen Bee autonomous pickup exhausted all eligible delegates" }] },
    { id: "junk", title: "Junk", description: "", tasks: "not-an-array" },
  ];
  const tasks = flattenKanbanColumns(columns);
  assert.equal(tasks.length, 2);
  // legacy/map tolerance: lane→tasks map still flattens
  assert.equal(flattenKanbanColumns({ ready: [{ id: "t_map_1", title: "Map shape", status: "ready" }] }).length, 1);
  assert.equal(findWorkBoardTasks(tasks, { taskId: "t_bbb2_y" })[0]?.id, "t_bbb2_y");
  assert.equal(findWorkBoardTasks(tasks, { query: "resolve email deliverability" })[0]?.id, "t_bbb2_y");
  assert.equal(findWorkBoardTasks(tasks, { query: "deliverability setup issues resolve" })[0]?.id, "t_bbb2_y", "loose word match");
  assert.deepEqual(findWorkBoardTasks(tasks, { query: "zzz" }), []);
  const block = formatWorkBoardTaskForPrompt(tasks[1]);
  assert.match(block, /t_bbb2_y/);
  assert.match(block, /blocked on the user/);
  assert.match(block, /agent-error/);
  assert.match(summarizeWorkBoardByStatus(tasks), /ready: 1/);
}

console.log("PASS test-queen-chat-stream");
