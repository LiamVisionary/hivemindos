#!/usr/bin/env node
// Hermetic: the typed Queen chat streaming pipeline — SSE frame parsing across
// arbitrary chunk boundaries, OpenAI delta accumulation (content + index-keyed
// tool-call argument fragments), and the finalized turn matching the blocking
// chat-turn contract. Plus the Work Board lookup helpers the read_work_board
// tool and the Discuss enrichment share.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const {
  applyOpenAiChatChunk,
  createQueenChatStreamState,
  createSseJsonParser,
  finalizeQueenChatStream,
} = await import("../src/lib/services/queen-bee/chat-stream.ts");
const {
  QUEEN_INSTRUCTIONS,
  queenChatTools,
  queenInstructionsForPersonality,
  queenRealtimeTools,
  userAuthorizedHiveTaskCreation,
} = await import("../src/lib/services/queen-bee/queen-brain.ts");
const {
  findWorkBoardTasks,
  flattenKanbanColumns,
  formatWorkBoardTaskForPrompt,
  summarizeWorkBoardByStatus,
} = await import("../src/features/dashboard/work-board-lookup.ts");
const {
  findFleetAgents,
  fixTaskSuggestion,
  flattenFleetAgents,
  formatAgentStatusForPrompt,
  isAgentUnhealthy,
  summarizeFleetByStatus,
} = await import("../src/features/dashboard/agent-status-lookup.ts");

// ── typed Queen chat uses the same default/custom personality layer ──────────
{
  assert.match(QUEEN_INSTRUCTIONS, /sharp wit/, "default Queen personality missing from typed chat instructions");
  const custom = queenInstructionsForPersonality("Custom typed Queen personality.");
  assert.match(custom, /Custom typed Queen personality\./, "custom Queen personality missing from typed chat instructions");
  assert.doesNotMatch(custom, /sharp wit/, "custom Queen personality should replace the default");
}

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

// ── fleet agent status: join agent→machine→snapshot, find, format ────────────
{
  // Mirrors /api/fleet/discover?includeSnapshots=1 machines[]: HermesMain is
  // configured on an online box whose collector is up, but its runtime probe
  // timed out (runtimeReachable:false) with a failed run — the exact "timeout"
  // shape the Queen must READ instead of asserting or deflecting.
  const machines = [
    {
      device: { name: "This Mac", os: "darwin", online: true, self: true },
      collector: "ready",
      // Reported unreachable by a peer: the box is locally up but a partition
      // stops cross-machine dispatch to it — the real HermesMain timeout.
      reportedUnreachableBy: ["nyc-mac"],
      agents: [{ id: "a_hermes_main", name: "HermesMain", runtime: "hermes", workerClass: "code" }],
      snapshots: [
        {
          agentId: "a_hermes_main",
          ok: false,
          runtimeReachable: false,
          processRunning: true,
          summary: "Runtime probe timed out.",
          error: "request timed out after 8000ms",
          tasks: [
            { title: "Loop Eval - Research", status: "failed", lastMessage: "worker timeout: no response", updatedAt: 1 },
            { title: "Older done run", status: "completed", lastMessage: "ok", updatedAt: 0 },
          ],
        },
      ],
    },
    {
      // Clean online box hosting a healthy idle agent — the negative control.
      device: { name: "cloud-1", os: "linux", online: true },
      collector: "ready",
      agents: [{ id: "a_idle", name: "ResearchBee", runtime: "hermes" }],
      snapshots: [
        { agentId: "a_idle", ok: true, runtimeReachable: true, processRunning: true, summary: "Idle. No current task." },
      ],
    },
    {
      device: { name: "hel1-2", os: "linux", online: false },
      collector: "offline",
      agents: [{ id: "a_off", name: "EdgeBee", runtime: "aeon" }],
      snapshots: [],
    },
  ];

  const agents = flattenFleetAgents(machines);
  assert.equal(agents.length, 3, "one entry per agent across machines");
  // garbled payload degrades to empty, never throws
  assert.deepEqual(flattenFleetAgents(null), []);
  assert.deepEqual(flattenFleetAgents({ nope: true }), []);

  // find by exact name (case-insensitive), then substring
  const hermes = findFleetAgents(agents, { name: "hermesmain" });
  assert.equal(hermes.length, 1);
  assert.equal(hermes[0].agent.id, "a_hermes_main");
  assert.equal(findFleetAgents(agents, { name: "bee" }).length, 2, "substring matches ResearchBee + EdgeBee");
  assert.deepEqual(findFleetAgents(agents, { name: "ghost" }), []);

  // snapshot joined by snapshot.agentId === agent.id
  assert.equal(hermes[0].snapshot?.error, "request timed out after 8000ms");

  const block = formatAgentStatusForPrompt(hermes[0]);
  assert.match(block, /HermesMain \(hermes\)/);
  assert.match(block, /This Mac · darwin — online/);
  assert.match(block, /Reported unreachable by: nyc-mac/);
  assert.match(block, /runtime unreachable/);
  assert.match(block, /request timed out/);
  assert.match(block, /Recent failure — Loop Eval - Research/);
  assert.doesNotMatch(block, /Older done run/, "completed runs are not listed as failures");

  // offline machine with no snapshot still formats without throwing
  const edge = findFleetAgents(agents, { name: "EdgeBee" })[0];
  const edgeBlock = formatAgentStatusForPrompt(edge);
  assert.match(edgeBlock, /hel1-2 · linux — offline/);
  assert.match(edgeBlock, /No live snapshot returned/);

  const summary = summarizeFleetByStatus(agents);
  assert.match(summary, /3 agents/);
  assert.match(summary, /1 online/, "only ResearchBee is online + ok");
  assert.match(summary, /reporting errors/);
  assert.equal(summarizeFleetByStatus([]), "No agents found in the fleet right now.");

  // ── unhealthy detection + propose-and-confirm fix suggestion ──────────────
  const researchBee = findFleetAgents(agents, { name: "ResearchBee" })[0];
  assert.equal(isAgentUnhealthy(hermes[0]), true, "runtime unreachable + error + partition");
  assert.equal(isAgentUnhealthy(researchBee), false, "online + ok = healthy");
  assert.equal(isAgentUnhealthy(edge), true, "offline machine");

  // a matched unhealthy agent yields a create_hive_task offer naming it
  const suggestion = fixTaskSuggestion(hermes);
  assert.match(suggestion, /HermesMain looks unhealthy/);
  assert.match(suggestion, /Diagnose & fix HermesMain/);
  assert.match(suggestion, /create_hive_task/);
  assert.match(suggestion, /only once the user agrees/);
  // healthy agents produce no nudge (no unsolicited fix task)
  assert.equal(fixTaskSuggestion([researchBee]), null);
  assert.equal(fixTaskSuggestion([]), null);
  // multiple unhealthy agents are listed, task named after the first
  const multi = fixTaskSuggestion([hermes[0], edge]);
  assert.match(multi, /HermesMain and EdgeBee look unhealthy/);
  assert.match(multi, /Diagnose & fix HermesMain/);
}

// ── read_agent_status is offered to BOTH surfaces; read_work_board typed-only ──
{
  const chatNames = queenChatTools().map((t) => t.function.name);
  const voiceNames = queenRealtimeTools().map((t) => t.name);
  // typed chat: both read tools plus create_hive_task (the fix rail)
  assert.ok(chatNames.includes("read_agent_status"), "typed chat offers read_agent_status");
  assert.ok(chatNames.includes("read_work_board"), "typed chat offers read_work_board");
  assert.ok(chatNames.includes("create_hive_task"), "typed chat can create the fix task");
  // voice: read_agent_status + create_hive_task wired; read_work_board is NOT
  assert.ok(voiceNames.includes("read_agent_status"), "voice offers read_agent_status");
  assert.ok(voiceNames.includes("create_hive_task"), "voice can create the fix task");
  assert.ok(!voiceNames.includes("read_work_board"), "voice does not offer read_work_board (no executor)");
}

// ── create_hive_task propose-then-confirm is enforced mechanically ──
// Scout queued a "Fix agent errors" Work Board task off a bare "hi"
// (2026-07-06); the instruction layer alone does not bind small models.
{
  // No work ask, no affirmation → the tool call must be downgraded to a proposal.
  for (const msg of ["hi", "what's new?", "how are the agents doing?", "is everything ok with the fleet?", ""]) {
    assert.equal(userAuthorizedHiveTaskCreation(msg), false, `"${msg}" must NOT authorize task creation`);
  }
  // Explicit work requests and whole-message affirmatives authorize creation.
  for (const msg of ["fix the agent errors", "queue a task to research competitors", "remind me tomorrow", "yes", "queue it", "go ahead!", "sure, thanks"]) {
    assert.equal(userAuthorizedHiveTaskCreation(msg), true, `"${msg}" must authorize task creation`);
  }
}

console.log("PASS test-queen-chat-stream");
