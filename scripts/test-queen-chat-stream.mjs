#!/usr/bin/env node
// Hermetic: the typed Queen chat streaming pipeline — SSE frame parsing across
// arbitrary chunk boundaries, OpenAI delta accumulation (content + index-keyed
// tool-call argument fragments), and the finalized turn matching the blocking
// chat-turn contract. Plus the Work Board lookup helpers the read_work_board
// tool and the Discuss enrichment share.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  readRuntimeResponseText,
} = await import("../src/lib/services/phone/runtime-voice-turn.ts");
const {
  QUEEN_INSTRUCTIONS,
  queenChatTools,
  queenInstructionsForPersonality,
  queenRealtimeTools,
  isHivemindLatestBriefCommand,
  userAuthorizedHiveTaskCreation,
  isTrivialConversationalTurn,
  isHivemindFastContextCommand,
  isWalletReadinessCommand,
} = await import("../src/lib/services/queen-bee/queen-brain.ts");
const {
  findWorkBoardTasks,
  flattenKanbanColumns,
  formatWorkBoardTaskForPrompt,
  isPlainWorkBoardNavigationCommand,
  isWorkBoardPipelineQuestion,
  summarizeWorkBoardByStatus,
  summarizeWorkBoardForNavigation,
  summarizeWorkBoardPipeline,
} = await import("../src/features/dashboard/work-board-lookup.ts");
const {
  findFleetAgents,
  fixTaskSuggestion,
  flattenFleetAgents,
  formatAgentStatusForPrompt,
  isAgentUnhealthy,
  summarizeFleetByStatus,
} = await import("../src/features/dashboard/agent-status-lookup.ts");
const {
  QUEEN_TEXT_CHAT_API_PATH,
  QUEEN_VOICE_CHAT_API_PATH,
  queenChatRouteForSend,
  queenVoiceHistoryBeforeTurn,
} = await import("../src/features/queen-voice/queen-chat-routing.ts");

// ── OAuth Queen models must not silently skip to gpt-4o-mini ────────────────
{
  const source = readFileSync(new URL("../src/lib/services/queen-bee/typed-chat-turn.ts", import.meta.url), "utf8");
  const chatStoreSource = readFileSync(new URL("../src/features/queen-voice/queen-chat-store.tsx", import.meta.url), "utf8");
  const agentRuntimeRoute = readFileSync(new URL("../src/app/api/chat/agent-runtime/route.ts", import.meta.url), "utf8");
  const notificationsSource = readFileSync(new URL("../src/features/notifications/NotificationsPanel.tsx", import.meta.url), "utf8");
  const queenVoiceRoute = readFileSync(new URL("../src/app/api/queen-bee/voice/route.ts", import.meta.url), "utf8");
  const queenVoiceTurn = readFileSync(new URL("../src/lib/services/queen-bee/voice-turn.ts", import.meta.url), "utf8");
  assert.match(source, /isRuntimeHeldQueenProvider\(provider\)/, "typed Queen chat should recognize runtime-held OAuth providers");
  assert.match(source, /isXaiOAuthProvider\(provider\)/, "typed Queen chat should recognize xAI OAuth separately");
  assert.match(source, /resolveXaiOAuthChatEndpoint/, "typed Queen chat should call xAI OAuth directly with the selected model");
  assert.match(source, /provider === "copilot"/, "typed Queen chat should route Copilot OAuth through the Queen runtime");
  assert.match(source, /\/api\/chat\/agent-runtime/, "typed Queen chat should route OpenAI Codex through the Queen runtime");
  assert.match(source, /readRuntimeResponseText/, "typed Queen chat should parse the runtime stream response");
  assert.match(source, /queenChatRuntimeStreamResponse/, "typed Queen chat should bridge runtime streams into Queen chat streams");
  assert.match(source, /brain\.kind === "agent-runtime"[\s\S]*queenChatRuntimeStreamResponse/, "runtime-held Queen brains should stream through the runtime bridge before buffered fallbacks");
  assert.match(source, /runtimeStream: true/, "typed Queen chat telemetry should mark runtime-streamed turns");
  assert.match(source, /runtime-stream-heartbeat/, "runtime-held Queen chat streams should emit heartbeat frames while waiting for model text");
  assert.match(source, /agentMode: "plan"/, "runtime-held Queen text chat should use read-only/planning mode instead of command execution mode");
  assert.match(source, /suppressWalletIntents: true/, "runtime-held Queen text chat should always suppress deterministic wallet/payment rails");
  assert.match(source, /RUNTIME_COMMAND_GATE_FALLBACK/, "runtime-held Queen chat should sanitize command-gate timeout replies");
  assert.match(source, /runtimeCommandGate: true/, "Queen chat telemetry should mark sanitized runtime command-gate replies");
  assert.match(source, /QueenTypedSystemPrompt/, "typed Queen chat should split stable and volatile system prompt sections");
  assert.match(source, /openAICompatibleMessageCacheControlSupported/, "typed Queen chat should apply explicit cache-control blocks when supported");
  assert.match(source, /cache_control: \{ type: "ephemeral" \}/, "typed Queen chat should mark stable direct-brain system text cacheable where supported");
  assert.match(queenVoiceTurn, /conversationSystemContent/, "Queen voice direct turns should build stable/volatile system prompt sections");
  assert.match(queenVoiceTurn, /stableSystemAddendum/, "Queen voice direct turns should keep model transparency in the stable cacheable section");
  assert.match(queenVoiceTurn, /openAICompatibleMessageCacheControlSupported/, "Queen voice direct turns should use explicit provider cache-control when available");
  assert.match(queenVoiceTurn, /cacheScope: "queen-agent-turn-fallback"/, "Queen voice agent-turn fallback should carry OpenAI cache hints");
  assert.match(chatStoreSource, /return runQueenVoiceTextTurn\(trimmed, queenId, history, voiceTextAudioContext,/, "typed Queen chat should use the voice-quality conversation route by default");
  assert.match(chatStoreSource, /speak: shouldSpeakReply/, "closed text chat must not trigger spoken audio");
  assert.match(chatStoreSource, /Falling back to typed chat/, "closed text-chat should keep the legacy typed route as a fallback");
  assert.doesNotMatch(chatStoreSource, /hivemindLatestBriefQuery|messagesForModel\(\)/, "shared typed Queen chat should not expose raw hive-context scaffolding to Codex");
  assert.doesNotMatch(source, /provider !== "openai-oauth" && provider !== "openai-codex"/, "typed Queen chat must not skip OpenAI Codex to the built-in fallback");
  assert.match(chatStoreSource, /suppressWalletIntents\?: boolean/, "Queen chat sendText should expose an advice-only wallet-intent suppression option");
  assert.match(chatStoreSource, /runQueenTurn\(trimmed, queenId, opts\?\.screenContext, opts\?\.suppressWalletIntents === true\)/, "legacy typed fallback should pass the suppression flag to the text-chat route");
  assert.match(chatStoreSource, /action: "agent-turn"[\s\S]{0,160}suppressWalletIntents/, "Queen tool relays should keep advice-only turns out of wallet rails");
  assert.match(agentRuntimeRoute, /suppressWalletIntents = body\.suppressWalletIntents === true/, "agent runtime should parse the wallet-intent suppression flag");
  assert.match(agentRuntimeRoute, /if \(!suppressWalletIntents\) \{[\s\S]{0,500}dispatchWalletAndTradeIntents/, "agent runtime should skip deterministic wallet rails when suppression is active");
  assert.match(queenVoiceRoute, /suppressWalletIntents: body\.suppressWalletIntents === true/, "Queen agent-turn route should pass advice-only suppression to relayed agents");
  assert.match(queenVoiceTurn, /suppressWalletIntents: options\?\.suppressWalletIntents === true/, "relayed Queen agent turns should suppress wallet rails when requested");
  assert.equal((notificationsSource.match(/suppressWalletIntents: true/g) ?? []).length, 2, "both alert Discuss paths should mark Queen turns as advice-only");
}

// ── legacy typed Queen chat remains available only as fallback ───────────────
{
  const source = readFileSync(new URL("../src/features/queen-voice/queen-chat-store.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../src/app/api/queen-bee/chat/route.ts", import.meta.url), "utf8");
  assert.equal(QUEEN_TEXT_CHAT_API_PATH, "/api/queen-bee/chat", "legacy typed fallback should keep the text-chat route");
  assert.equal(source.match(/fetch\(QUEEN_TEXT_CHAT_API_PATH,/g)?.length, 2, "legacy typed fallback fetches should still go through the text-chat route constant");
  assert.match(source, /Falling back to typed chat[\s\S]*runQueenTurn/, "closed text-chat should fall back to the legacy route if the voice-quality lane fails");
  assert.match(route, /runQueenChatTurnStream/, "Queen text-chat route should serve the streaming typed chat action");
  assert.match(route, /runQueenChatTurn/, "Queen text-chat route should serve the blocking typed chat action");
}

// ── all shared Queen text starts from the voice conversation lane ────────────
{
  const source = readFileSync(new URL("../src/features/queen-voice/queen-chat-store.tsx", import.meta.url), "utf8");
  const overlay = readFileSync(new URL("../src/features/queen-voice/QueenBeeVoiceOverlay.tsx", import.meta.url), "utf8");
  assert.equal(QUEEN_VOICE_CHAT_API_PATH, "/api/queen-bee/voice", "shared Queen text should use the voice conversation route");
  assert.equal(queenChatRouteForSend(false), "text", "closed voice chat keeps audio muted");
  assert.equal(queenChatRouteForSend(true), "voice", "open voice chat enables spoken replies");
  assert.match(source, /queenChatRouteForSend\(voiceChatActiveRef\.current\)/, "sendText should still use the active voice-chat flag to decide audio behavior");
  assert.match(source, /source: "voice"/, "closed text chat should also render as the voice-quality conversation lane before fallback");
  assert.match(source, /fetch\(QUEEN_VOICE_CHAT_API_PATH,[\s\S]{0,520}action: "converse-stream"/, "shared text sends should hit the voice converse-stream action");
  assert.match(source, /shouldSpeakReply \? ensureVoiceTextAudioContext\(\) : null/, "only voice-open text sends should prime an audio context on the send gesture");
  assert.match(source, /playSpokenReply\(text, abort\.signal, audioContext, false\)/, "voice-active text replies should be spoken through the shared playback ladder");
  assert.match(overlay, /setVoiceChatActive\(open\)/, "the overlay should publish its open state to the shared chat store");
  assert.deepEqual(
    queenVoiceHistoryBeforeTurn([
      { id: "q1", who: "queen", text: "Opening line." },
      { id: "u1", who: "you", text: "  previous spoken turn  " },
      { id: "q2", who: "queen", text: "Pending words", live: true },
      { id: "u2", who: "you", text: "current typed text" },
      { id: "q3", who: "queen", text: "", pending: true },
    ], "u2"),
    [
      { who: "queen", text: "Opening line." },
      { who: "you", text: "previous spoken turn" },
    ],
    "voice-route text history should include only completed turns before the current typed message",
  );
}

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

// ── upstream model/cache evidence survives the Queen stream bridge ──────────
{
  const state = createQueenChatStreamState();
  applyOpenAiChatChunk(state, {
    model: "grok-4.5",
    usage: {
      prompt_tokens: 1000,
      prompt_tokens_details: { cached_tokens: 896 },
    },
    choices: [{ delta: { content: "OK" } }],
  });
  const done = finalizeQueenChatStream(state);
  assert.equal(done.servedModel, "grok-4.5");
  assert.equal(done.usage?.prompt_tokens_details?.cached_tokens, 896);
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

// ── runtime agent streams expose text deltas before the final text ───────────
{
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  const deltas = [];
  const text = await readRuntimeResponseText(new Response(body), undefined, (delta) => deltas.push(delta));
  assert.deepEqual(deltas, ["Hel", "lo"]);
  assert.equal(text, "Hello");
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
    { id: "ideas", title: "Ideas", description: "", tasks: [{ id: "t_idea_1", title: "Draft partner landing page idea", status: "ideas" }] },
    { id: "ready", title: "Ready", description: "", tasks: [{ id: "t_aaa1_x", title: "Verify outreach email deliverability setup", status: "ready" }] },
    { id: "working", title: "Working", description: "", tasks: [
      { id: "t_working_1", title: "Build paid-demo workflow", status: "working" },
      { id: "t_working_2", title: "Refresh demo follow-up copy", status: "working" },
    ] },
    { id: "needs-human", title: "Needs You", description: "", tasks: [{ id: "t_bbb2_y", title: "Resolve email deliverability setup issues", status: "needs-human", assignee: "HermesMain", lastFailureReason: "agent-error", result: "Queen Bee autonomous pickup exhausted all eligible delegates" }] },
    { id: "done", title: "Done", description: "", tasks: [
      { id: "t_pipeline_total", title: "Audit active pipeline close probability", status: "done", updatedAt: 20, result: "Audited active pipeline close probability and updated the weekly revenue ledger: 36 rows, $73,500 quoted/open pipeline, $0 recognized Weekly Revenue." },
      { id: "t_pipeline_blocked", title: "Audit approval bottleneck impact on revenue", status: "done", updatedAt: 30, result: "Result: - $61,500 / $73,500 = 83.7% is blocked by human approval. - $0 / $73,500 = 0.0% is currently blocked by technical readiness. - $12,000 / $73,500 = 16.3% is already in-market and waiting on prospect response. - Weekly Revenue remains $0 / $2,885." },
    ] },
    { id: "junk", title: "Junk", description: "", tasks: "not-an-array" },
  ];
  const tasks = flattenKanbanColumns(columns);
  assert.equal(tasks.length, 7);
  // legacy/map tolerance: lane→tasks map still flattens
  assert.equal(flattenKanbanColumns({ ready: [{ id: "t_map_1", title: "Map shape", status: "ready" }] }).length, 1);
  assert.equal(findWorkBoardTasks(tasks, { taskId: "t_bbb2_y" })[0]?.id, "t_bbb2_y");
  assert.equal(findWorkBoardTasks(tasks, { query: "resolve email deliverability" })[0]?.id, "t_bbb2_y");
  assert.equal(findWorkBoardTasks(tasks, { query: "deliverability setup issues resolve" })[0]?.id, "t_bbb2_y", "loose word match");
  assert.deepEqual(findWorkBoardTasks(tasks, { query: "zzz" }), []);
  const blockedTask = tasks.find((task) => task.id === "t_bbb2_y");
  assert.ok(blockedTask);
  const block = formatWorkBoardTaskForPrompt(blockedTask);
  assert.match(block, /t_bbb2_y/);
  assert.match(block, /blocked on the user/);
  assert.match(block, /agent-error/);
  assert.match(summarizeWorkBoardByStatus(tasks), /ready: 1/);
  assert.equal(isPlainWorkBoardNavigationCommand("open the work"), true);
  assert.equal(isPlainWorkBoardNavigationCommand("show me my tasks"), true);
  assert.equal(isPlainWorkBoardNavigationCommand("go to kanban board"), true);
  assert.equal(isPlainWorkBoardNavigationCommand("open the work task about revenue"), false);
  assert.equal(isPlainWorkBoardNavigationCommand("add a task to the work board"), false);
  assert.equal(
    summarizeWorkBoardForNavigation(tasks),
    "Opened Work. You have 1 idea, 1 ready task, 2 tasks currently being worked on, and 1 that needs your attention.",
  );
  assert.equal(summarizeWorkBoardForNavigation([]), "Opened Work. The Work Board is empty.");
  assert.equal(isWorkBoardPipelineQuestion("what is the quoted/open pipeline?"), true);
  assert.equal(isWorkBoardPipelineQuestion("open the work"), false);
  const pipeline = summarizeWorkBoardPipeline(tasks);
  assert.match(pipeline, /Quoted\/open pipeline: \$73,500\./);
  assert.match(pipeline, /Recognized weekly revenue: \$0 \/ \$2,885 target\./);
  assert.match(pipeline, /Blocked by human approval: \$61,500\./);
  assert.match(pipeline, /Already in market\/waiting on prospects: \$12,000\./);
  assert.match(pipeline, /potential pipeline, not booked revenue/);
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

// ── direct read tools are offered to both Queen surfaces ──
{
  const chatNames = queenChatTools().map((t) => t.function.name);
  const voiceNames = queenRealtimeTools().map((t) => t.name);
  // typed chat: direct read tools plus create_hive_task (the fix rail)
  assert.ok(chatNames.includes("read_agent_status"), "typed chat offers read_agent_status");
  assert.ok(chatNames.includes("read_hivemind_context"), "typed chat offers read_hivemind_context");
  assert.ok(chatNames.includes("read_wallet_readiness"), "typed chat offers read_wallet_readiness");
  assert.ok(chatNames.includes("read_work_board"), "typed chat offers read_work_board");
  assert.ok(chatNames.includes("create_hive_task"), "typed chat can create the fix task");
  // voice: the realtime executor is wired for the fast app/brain/wallet reads too
  assert.ok(voiceNames.includes("read_agent_status"), "voice offers read_agent_status");
  assert.ok(voiceNames.includes("read_hivemind_context"), "voice offers read_hivemind_context");
  assert.ok(voiceNames.includes("read_wallet_readiness"), "voice offers read_wallet_readiness");
  assert.ok(voiceNames.includes("create_hive_task"), "voice can create the fix task");
  assert.ok(!voiceNames.includes("read_work_board"), "voice does not offer read_work_board (no executor)");
}

// ── app/brain questions use direct fast context, not full runtime delegation ─
{
  const fastContext = [
    "what does the shared brain know about Hermes?",
    "which app capabilities do we have for image generation?",
    "show me HivemindOS dashboard routes for wallets",
    "what agents are in the fleet?",
    "list schedules in the app data",
    "what tools can Queen Bee use?",
    "what's the latest?",
    "what's new?",
    "what's happening in the hive?",
    "latest in the hive?",
  ];
  for (const msg of fastContext) {
    assert.equal(isHivemindFastContextCommand(msg), true, `"${msg}" should use direct HivemindOS context`);
  }

  const needsAgentOrAction = [
    "remember that I like short replies",
    "create a Work Board task",
    "open Obsidian",
    "fix Hermes timeout",
    "swap 1 usdc to eth",
    "check wallet balances",
    "open wallets",
    "what's the latest Base news?",
  ];
  for (const msg of needsAgentOrAction) {
    assert.equal(isHivemindFastContextCommand(msg), false, `"${msg}" must not use generic fast context`);
  }

  for (const msg of ["what's the latest?", "What’s new?", "latest in the hive?", "catch me up"]) {
    assert.equal(isHivemindLatestBriefCommand(msg), true, `"${msg}" should be a hive latest brief`);
  }
  for (const msg of ["what's the latest Base news?", "latest OpenAI model?", "run the latest tests"]) {
    assert.equal(isHivemindLatestBriefCommand(msg), false, `"${msg}" must not be hijacked as a hive latest brief`);
  }
}

// ── wallet readiness requests use the direct app capability map ──────────────
{
  const readiness = [
    "open wallets",
    "which wallets are spend ready?",
    "wallet rail status",
    "show me Bankr and UsePod setup status",
    "is Veil gated?",
    "what payment rails are configured?",
  ];
  for (const msg of readiness) {
    assert.equal(isWalletReadinessCommand(msg), true, `"${msg}" should be a direct wallet-readiness read`);
  }

  const needsRails = [
    "check wallet balances",
    "what's my Bankr portfolio?",
    "swap 1 usdc to eth",
    "send 10 usdc",
    "give me my deposit address",
    "confirm the payment",
  ];
  for (const msg of needsRails) {
    assert.equal(isWalletReadinessCommand(msg), false, `"${msg}" must stay on the live wallet rails`);
  }
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

// ── isTrivialConversationalTurn: greetings skip tools; compound asks do not ──
// Scout fired read_work_board on a bare "hi", rendering a greeting + tool-spin
// + a second unsolicited paragraph (2026-07-06). The typed loop forces no-tools
// on round 0 when this returns true. Over-suppression (swallowing a real ask
// behind a greeting prefix) is the dangerous direction — assert against it.
{
  const trivial = [
    "hi", "Hi", "HELLO", "hey queen", "hey queen bee", "yo", "sup", "gm",
    "good morning", "morning", "howdy", "thanks", "thank you", "cheers",
    "how are you", "how's it going", "how you doing", "thanks queen!",
    "hi there queen bee", "hi how are you", "how are you doing today",
  ];
  for (const m of trivial) {
    assert.equal(isTrivialConversationalTurn(m), true, `"${m}" should be a trivial (no-tools) turn`);
  }
  // A greeting that PREFIXES a real ask must still run tools — read_agent_status,
  // ask_hivemind_agent, and drive_dashboard are mandatory for these.
  const needsTools = [
    "hey queen, is HermesMain down?",
    "gm, swap 1 usdc to eth",
    "thanks, now open my wallets",
    "how are you doing on the collector fix?",
    "yo, what's the balance on user:mq522kzb?",
    "what's up with the fleet?",
    "good morning, what's on the board?",
    "how are the agents doing?",
    "what's new?",
    "open my wallets",
    "fix the collector",
    "help", "status", "today",
  ];
  for (const m of needsTools) {
    assert.equal(isTrivialConversationalTurn(m), false, `"${m}" must NOT be treated as trivial (it needs tools)`);
  }
  // Must not collide with the affirmative path that authorizes task creation.
  for (const m of ["yes", "ok", "sure", "queue it"]) {
    assert.equal(isTrivialConversationalTurn(m), false, `"${m}" is an affirmative, not a greeting`);
  }
}

console.log("PASS test-queen-chat-stream");
