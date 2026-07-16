#!/usr/bin/env node
// Hermetic: the typed Queen chat streaming pipeline — SSE frame parsing across
// arbitrary chunk boundaries, OpenAI delta accumulation (content + index-keyed
// tool-call argument fragments), and the finalized turn matching the blocking
// chat-turn contract. Plus the Work Board lookup helpers the read_work_board
// tool and the Discuss enrichment share.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  builtInQueenCapabilityProfile,
  capabilityApprovalFromSse,
  capabilityExecutionFromSse,
  runBuiltInQueenCapabilityTurn,
} = await import("../src/lib/services/queen-bee/capability-fallback.ts");
const {
  QUEEN_INSTRUCTIONS,
  queenChatTools,
  queenInstructionsForPersonality,
  queenPipelineChatTools,
  queenRealtimeTools,
  isHivemindLatestBriefCommand,
  userAuthorizedHiveTaskCreation,
  isTrivialConversationalTurn,
  isHivemindFastContextCommand,
  isWalletReadinessCommand,
} = await import("../src/lib/services/queen-bee/queen-brain.ts");
const {
  formatBrainAccessInsightsForAgent,
  readBrainAccessInsights,
} = await import("../src/lib/services/obsidian/brain-access-insights.ts");
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
const {
  parseUserSlashCommandDisplay,
} = await import("../src/features/queen-voice/queen-command-display.ts");

// ── leading slash commands render as badges without changing their args ─────
{
  assert.deepEqual(
    parseUserSlashCommandDisplay("/transcript https://x.com/user/status/1"),
    { name: "transcript", suffix: " https://x.com/user/status/1" },
  );
  assert.deepEqual(parseUserSlashCommandDisplay("/swarm-goal build it"), {
    name: "swarm-goal",
    suffix: " build it",
  });
  assert.deepEqual(parseUserSlashCommandDisplay("/help"), {
    name: "help",
    suffix: "",
  });
  assert.equal(parseUserSlashCommandDisplay("plain chat"), null);
  assert.equal(parseUserSlashCommandDisplay("/not/a-command"), null);

  const overlay = readFileSync(new URL("../src/features/queen-voice/QueenBeeVoiceOverlay.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/features/queen-voice/queen-voice.module.css", import.meta.url), "utf8");
  assert.match(overlay, /<UserTurnText text=\{turn\.text\} \/>/, "user turns should pass through the slash-command badge renderer");
  assert.match(overlay, /styles\.commandBadge/, "the command token should use the transcript badge style");
  assert.match(styles, /\.commandBadge\s*\{/, "the command badge should have a scoped dark-theme style");
  assert.match(styles, /hive-light[^\n]*\.commandBadge/, "the command badge should have a hive-light override");
}

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
  assert.match(chatStoreSource, /runQueenTurn\([\s\S]{0,180}trimmed,[\s\S]{0,180}opts\?\.screenContext,[\s\S]{0,120}opts\?\.suppressWalletIntents === true,/, "typed Queen chat should use the context-preserving typed route directly");
  assert.doesNotMatch(chatStoreSource, /runQueenVoiceTextTurn/, "typed FAB sends must never enter the voice inference route");
  assert.doesNotMatch(chatStoreSource, /fetchBrainAccessInsight|isMostAccessedBrainNoteCommand/, "typed Brain reads must stay in the intelligent tool loop instead of using a hardcoded answer path");
  assert.match(chatStoreSource, /speak: shouldSpeakReply/, "voice-open typed replies should still be spoken after the typed turn completes");
  assert.doesNotMatch(chatStoreSource, /hivemindLatestBriefQuery|messagesForModel\(\)/, "shared typed Queen chat should not expose raw hive-context scaffolding to Codex");
  assert.doesNotMatch(source, /provider !== "openai-oauth" && provider !== "openai-codex"/, "typed Queen chat must not skip OpenAI Codex to the built-in fallback");
  assert.match(chatStoreSource, /suppressWalletIntents\?: boolean/, "Queen chat sendText should expose an advice-only wallet-intent suppression option");
  assert.match(chatStoreSource, /runQueenTurn\([\s\S]{0,180}trimmed,[\s\S]{0,180}opts\?\.screenContext,[\s\S]{0,120}opts\?\.suppressWalletIntents === true,/, "typed sends should pass screen context and the suppression flag to the text-chat route");
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
  assert.equal(QUEEN_TEXT_CHAT_API_PATH, "/api/queen-bee/chat", "typed sends should keep the dedicated text-chat route");
  assert.equal(source.match(/fetch\(QUEEN_TEXT_CHAT_API_PATH,/g)?.length, 2, "typed turn streaming and blocking fallback should share the text-chat route");
  assert.doesNotMatch(source, /fetch\(QUEEN_VOICE_CHAT_API_PATH/, "typed FAB sends should never fetch the voice converse route");
  assert.match(route, /runQueenChatTurnStream/, "Queen text-chat route should serve the streaming typed chat action");
  assert.match(route, /runQueenChatTurn/, "Queen text-chat route should serve the blocking typed chat action");
}

// ── all shared Queen text starts from the voice conversation lane ────────────
{
  const source = readFileSync(new URL("../src/features/queen-voice/queen-chat-store.tsx", import.meta.url), "utf8");
  const overlay = readFileSync(new URL("../src/features/queen-voice/QueenBeeVoiceOverlay.tsx", import.meta.url), "utf8");
  assert.equal(QUEEN_VOICE_CHAT_API_PATH, "/api/queen-bee/voice", "spoken and TTS actions retain the voice route");
  assert.equal(queenChatRouteForSend(false), "text", "closed voice chat keeps audio muted");
  assert.equal(queenChatRouteForSend(true), "voice", "open voice chat enables spoken replies");
  assert.match(source, /queenChatRouteForSend\(voiceChatActiveRef\.current\)/, "sendText should still use the active voice-chat flag to decide audio behavior");
  assert.match(source, /source: "text"/, "typed turns should remain visibly attributed to the typed lane");
  assert.match(source, /shouldSpeakReply \? ensureVoiceTextAudioContext\(\) : null/, "only voice-open text sends should prime an audio context on the send gesture");
  assert.match(source, /playSpokenReply\([\s\S]{0,120}text,[\s\S]{0,80}abort\.signal,[\s\S]{0,80}audioContext,[\s\S]{0,40}true,?/, "voice-active typed replies should be spoken through the selected playback ladder");
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
  assert.ok(chatNames.includes("read_x_account"), "typed chat offers the authenticated X account reader");
  assert.ok(chatNames.includes("use_hive_capability"), "typed chat offers the generic capability executor");
  assert.ok(!chatNames.includes("ask_hivemind_agent"), "typed chat has one canonical broad capability executor");
  assert.ok(chatNames.includes("read_work_board"), "typed chat offers read_work_board");
  assert.ok(chatNames.includes("create_hive_task"), "typed chat can create the fix task");
  // voice: the realtime executor is wired for the fast app/brain/wallet reads too
  assert.ok(voiceNames.includes("read_agent_status"), "voice offers read_agent_status");
  assert.ok(voiceNames.includes("read_hivemind_context"), "voice offers read_hivemind_context");
  assert.ok(voiceNames.includes("read_wallet_readiness"), "voice offers read_wallet_readiness");
  assert.ok(voiceNames.includes("read_x_account"), "realtime voice offers the authenticated X account reader");
  assert.ok(voiceNames.includes("use_hive_capability"), "realtime voice offers the generic capability executor");
  assert.ok(!voiceNames.includes("ask_hivemind_agent"), "realtime voice has one canonical broad capability executor");
  assert.ok(voiceNames.includes("create_hive_task"), "voice can create the fix task");
  assert.ok(!voiceNames.includes("read_work_board"), "voice does not offer read_work_board (no executor)");
  assert.match(QUEEN_INSTRUCTIONS, /Hive capability search/i, "Queen names her capability-search path");
  assert.match(QUEEN_INSTRUCTIONS, /read_x_account/, "Queen knows authenticated X reads are executable");
  assert.match(QUEEN_INSTRUCTIONS, /own_posts/, "Queen can inspect and paginate her user's own post history");
  assert.match(QUEEN_INSTRUCTIONS, /registered skills, MCP tools, connected app APIs/i, "Queen knows her generic capability bridge searches executable hive surfaces");

  const pipelineNames = queenPipelineChatTools().map((tool) => tool.function.name);
  assert.deepEqual(
    pipelineNames.sort(),
    ["read_hivemind_context", "read_x_account", "use_hive_capability"],
    "pipeline Queen exposes direct read-only brain context before the generic execution bridge",
  );
}

// ── every Queen client executes the shared X account tool ───────────────────
{
  const sources = [
    ["typed chat", "../src/features/queen-voice/queen-chat-store.tsx"],
    ["OpenAI realtime", "../src/features/queen-voice/use-queen-bee-realtime.ts"],
    ["Gemini Live", "../src/features/queen-voice/use-queen-bee-gemini-live.ts"],
  ];
  for (const [label, path] of sources) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /read_x_account/, `${label} recognizes read_x_account`);
    assert.match(source, /fetchXAccountRead/, `${label} executes read_x_account through the shared client`);
    assert.match(source, /use_hive_capability/, `${label} recognizes the generic hive capability executor`);
    assert.match(source, /askHivemindAgent|action: "agent-turn"/, `${label} routes generic capability execution through the full agent runtime`);
    assert.match(source, /preferBuiltInCapability/, `${label} sends canonical generic requests to the registry executor first`);
  }
  const routeSource = readFileSync(
    new URL("../src/app/api/queen-bee/voice/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(routeSource, /action === "read-x-account"/, "Queen API exposes the read-only X executor");
  assert.match(routeSource, /runXAccountReadTool/, "Queen API uses the canonical X account service");

  const pipelineSource = readFileSync(
    new URL("../src/lib/services/queen-bee/voice-turn.ts", import.meta.url),
    "utf8",
  );
  const voiceBrainReadsSource = readFileSync(
    new URL("../src/lib/services/queen-bee/voice-brain-reads.ts", import.meta.url),
    "utf8",
  );
  const voiceBrainContextSource = readFileSync(
    new URL("../src/lib/services/queen-bee/voice-brain-context.ts", import.meta.url),
    "utf8",
  );
  assert.match(pipelineSource, /queenPipelineChatTools/, "pipeline voice advertises the shared generic tool subset");
  assert.match(pipelineSource, /runXAccountReadTool/, "pipeline voice executes the same X tool server-side");
  assert.match(pipelineSource, /isHivemindFastContextCommand/, "pipeline voice intercepts read-only brain questions before generic runtime execution");
  assert.match(pipelineSource, /readQueenVoiceBrainContext/, "pipeline voice resolves read-only brain questions from local context");
  assert.doesNotMatch(pipelineSource, /readDirectVoiceBrainAnswer/, "spoken Brain questions must reach the configured model before tool evidence is read");
  assert.doesNotMatch(voiceBrainReadsSource, /isMostAccessedBrainNoteCommand|readBrainAccessInsights/, "the voice helper must not hardcode access-history answers before inference");
  assert.match(voiceBrainReadsSource, /includeAccessHistory:\s*true/, "the model-invoked voice Brain tool should request access-history evidence");
  assert.match(voiceBrainContextSource, /includeAccessHistory\?:\s*boolean/, "voice Brain context should make access-history evidence opt-in");
  assert.match(pipelineSource, /runQueenBeeAgentTurn/, "pipeline voice executes generic capabilities through the full agent runtime");
  assert.match(pipelineSource, /latencyMode: "capability"/, "generic execution enables full capability preflight instead of the voice fast path");
  assert.match(pipelineSource, /runBuiltInQueenCapabilityTurn/, "generic execution retains a tool-capable built-in fallback when configured runtimes fail");
  assert.match(pipelineSource, /preferBuiltInCapability: true/, "pipeline generic requests try the registry executor before configured runtimes");

  const fallbackProfile = builtInQueenCapabilityProfile("gpt-4o-mini", "test-key");
  assert.equal(fallbackProfile.runtime, "hivemind-os");
  assert.equal(fallbackProfile.provider, "openai");
  assert.equal(fallbackProfile.model, "gpt-4o-mini");
  assert.equal(fallbackProfile.token, "test-key");
  assert.equal(fallbackProfile.runtimeCapabilities?.skillActions, true);
  let fallbackRequest = null;
  let fallbackSessionRead = 0;
  const fallbackText = await runBuiltInQueenCapabilityTurn(
    {
      origin: "http://127.0.0.1:5021",
      messages: [{ role: "user", content: "Inspect a capability." }],
      model: "gpt-4o-mini",
      sessionId: "queen-capability-test",
      actingWalletSource: { agentId: "wallet-1", address: "0xtest", network: "base", kind: "local" },
      suppressWalletIntents: true,
    },
    {
      apiKey: async () => "test-key",
      fetcher: async (_url, init) => {
        fallbackRequest = JSON.parse(String(init?.body ?? "{}"));
        return new Response("ok");
      },
      readResponse: async () => '{"speech":"Observed it.","detail":"receipt"}',
      readSession: async () => ({
        messages: fallbackSessionRead++ === 0
          ? []
          : [{ role: "tool", content: "Hive capability completed\nHive Action test.read" }],
      }),
    },
  );
  assert.match(fallbackText, /Observed it/);
  assert.equal(fallbackRequest?.agentMode, "act");
  assert.equal(fallbackRequest?.latencyMode, "capability");
  assert.equal(fallbackRequest?.agent?.runtime, "hivemind-os");
  assert.equal(fallbackRequest?.actingWalletSource?.agentId, "wallet-1");
  assert.equal(fallbackRequest?.suppressWalletIntents, true);
  assert.equal(
    capabilityExecutionFromSse('data: {"type":"chat.tool.done","toolName":"invoke_hive_capability","operation":"list","status":"completed"}\n\n'),
    false,
    "listing the registry is not an execution receipt",
  );
  assert.equal(
    capabilityExecutionFromSse('data: {"type":"chat.tool.done","toolName":"invoke_hive_capability","operation":"invoke","status":"completed"}\n\n'),
    true,
    "an invoked registered capability is an execution receipt",
  );
  assert.deepEqual(
    capabilityApprovalFromSse(
      'data: {"type":"chat.approval","question":"Approve this command?","commandLine":"xurl --version","detail":"xurl is not allowlisted."}\n\n',
    ),
    {
      speech: "The capability is available, but running xurl --version needs your approval.",
      detail: "Approve this command?\n\nxurl is not allowlisted.",
    },
  );
}

// ── app/brain questions use direct fast context, not full runtime delegation ─
{
  const fastContext = [
    "what’s my most accessed note?",
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
  // use_hive_capability, and drive_dashboard are mandatory for these.
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

// ── local Brain access evidence stays inside the intelligent tool loop ────
{
  const chatStoreSource = readFileSync(new URL("../src/features/queen-voice/queen-chat-store.tsx", import.meta.url), "utf8");
  const fastContextSource = readFileSync(new URL("../src/features/queen-voice/queen-fast-context.ts", import.meta.url), "utf8");
  const brainSource = readFileSync(new URL("../src/lib/services/queen-bee/queen-brain.ts", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("../src/app/api/brain/access-insights/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(chatStoreSource, /fetchBrainAccessInsight|isMostAccessedBrainNoteCommand/, "the typed client must not synthesize Brain answers outside the model loop");
  assert.match(fastContextSource, /Promise\.allSettled\([\s\S]{0,1800}\/api\/brain\/access-insights/, "read_hivemind_context should gather neutral access-history evidence alongside other Brain sources");
  assert.match(brainSource, /own local (?:HivemindOS )?Brain[\s\S]{0,240}(?:never|do not) (?:ask|require)[^\n]{0,80}(?:permission|authorization)/i, "Queen must know the user's explicit local Brain read is already authorized");
  assert.match(routeSource, /readBrainAccessInsights/, "the access-insights API should read the local Brain log directly");
  assert.match(routeSource, /context:\s*formatBrainAccessInsightsForAgent/, "the access API should return neutral tool context for the model");
  assert.doesNotMatch(routeSource, /answer:/, "the access API must not manufacture Queen's final answer");
  assert.match(routeSource, /okJson/, "the access-insights API should use the canonical success envelope");
  const vaultPath = await mkdtemp(join(tmpdir(), "hivemindos-brain-access-"));
  try {
    await mkdir(join(vaultPath, "Operations", "Brain Services"), { recursive: true });
    await mkdir(join(vaultPath, "Projects"), { recursive: true });
    await writeFile(join(vaultPath, "Projects", "Alpha.md"), "# Alpha\n", "utf8");
    await writeFile(join(vaultPath, "Projects", "Beta.md"), "# Beta\n", "utf8");
    const events = [
      ...Array.from({ length: 4 }, (_, index) => ({ notePath: "Deleted/Stale.md", accessedAt: `2026-07-15T10:00:0${index}.000Z` })),
      ...Array.from({ length: 3 }, (_, index) => ({ notePath: "Projects/Alpha.md", accessedAt: `2026-07-15T11:00:0${index}.000Z` })),
      ...Array.from({ length: 3 }, (_, index) => ({ notePath: "Projects/Beta.md", accessedAt: `2026-07-15T12:00:0${index}.000Z` })),
    ].map((event, index) => ({
      id: `event-${index}`,
      notePath: event.notePath,
      agentName: "Test",
      machineName: "test",
      dashboardMachine: "test",
      accessedAt: event.accessedAt,
      action: "read",
    }));
    await writeFile(
      join(vaultPath, "Operations", "Brain Services", "access-log.jsonl"),
      `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      "utf8",
    );

    const insights = await readBrainAccessInsights({ vaultPath });
    assert.equal(insights.totalAccesses, 10);
    assert.deepEqual(
      insights.rankedExisting.map((item) => [item.notePath, item.accessCount]),
      [["Projects/Beta.md", 3], ["Projects/Alpha.md", 3]],
      "ties should be stable and ordered by most recent access",
    );
    assert.deepEqual(
      [insights.topRecorded?.notePath, insights.topRecorded?.accessCount, insights.topRecorded?.exists],
      ["Deleted/Stale.md", 4, false],
      "the raw leader should remain visible even when its note was deleted",
    );
    const context = formatBrainAccessInsightsForAgent(insights);
    assert.match(context, /Brain note access history/i);
    assert.match(context, /Projects\/Beta\.md[^\n]*3 recorded accesses/);
    assert.match(context, /Projects\/Alpha\.md[^\n]*3 recorded accesses/);
    assert.match(context, /Deleted\/Stale\.md[^\n]*exists: no/);
    assert.doesNotMatch(context, /Your most-accessed/, "tool evidence must not impersonate Queen's final answer");
  } finally {
    await rm(vaultPath, { recursive: true, force: true });
  }
}

console.log("PASS test-queen-chat-stream");
