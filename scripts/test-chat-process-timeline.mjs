// Chat "Agent worked" timeline hygiene: tool lifecycles collapse to one row,
// junk runtime markers stay hidden, capability continuations share identity
// with the person's original message, and Hermes interim narration survives as
// chronological assistant segments instead of being demoted or replaced.
// Repro context: 2026-07-25 flappy-bird thread — duplicated user turn,
// never-resolving "Starting terminal" rows, and replaced streamed responses.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { collapseProcessEvents, mergeProcessEvents } = await import("../src/features/dashboard/views/chat/process-event-collapse.ts");
const { isHiddenChatProcessEvent } = await import("../src/features/dashboard/views/chat/chat-panel-helpers.ts");
const {
  compactCapabilityContinuation,
  isCapabilityContinuationEcho,
  preserveLocalTurnProcessEvents,
  sameVisibleChatMessage,
  userMessagesLikelySameTurn,
} = await import("../src/features/dashboard/chat-transcript-helpers.ts");
const { chatAppArtifactFromCapabilityContext, chatAppDirectoryFromTaskRecords } = await import("../src/lib/services/chat/chat-app-artifact.ts");
const { CAPABILITY_APPROVAL_CONTINUATION_MARKER } = await import("../src/lib/types/capability-approval.ts");

// --- tool lifecycle collapse -------------------------------------------------

const lifecycle = collapseProcessEvents([
  { at: 1, label: "Starting terminal", detail: "terminal", status: "running" },
  { at: 2, label: "terminal finished", detail: "terminal", status: "completed" },
]);
assert.equal(lifecycle.length, 1, "start+finish is one command, one row");
assert.equal(lifecycle[0].label, "Ran a command");
assert.equal(lifecycle[0].status, "completed");
assert.equal(lifecycle[0].detail, undefined, "a detail that just echoes the tool id is dropped");

const failedLifecycle = collapseProcessEvents([
  { at: 1, label: "Starting write_file", detail: "write_file", status: "running" },
  { at: 2, label: "write_file finished", detail: "write_file", status: "failed" },
]);
assert.equal(failedLifecycle.length, 1);
assert.equal(failedLifecycle[0].label, "File write failed");
assert.equal(failedLifecycle[0].status, "failed");

const unresolved = collapseProcessEvents([
  { at: 1, label: "Starting terminal", detail: "terminal", status: "running" },
]);
assert.equal(unresolved[0].label, "Running a command");
assert.equal(unresolved[0].status, "running");

const twoCommands = collapseProcessEvents([
  { at: 1, label: "Starting terminal", detail: "terminal" },
  { at: 2, label: "terminal finished", detail: "terminal", status: "completed" },
  { at: 3, label: "Hermes progress", detail: "Now the styles.", status: "completed" },
  { at: 4, label: "Starting terminal", detail: "terminal" },
  { at: 5, label: "terminal finished", detail: "terminal", status: "completed" },
]);
assert.equal(twoCommands.length, 3, "two separate commands stay two rows, narration stays in place");
assert.equal(twoCommands[0].label, "Ran a command");
assert.equal(twoCommands[1].label, "Hermes progress");
assert.equal(twoCommands[2].label, "Ran a command");

const commandLineDetail = collapseProcessEvents([
  { at: 1, label: "Starting terminal", detail: "pnpm install", status: "running" },
  { at: 2, label: "terminal finished", detail: "terminal", status: "completed" },
]);
assert.equal(commandLineDetail[0].detail, "pnpm install", "a real command line survives the collapse");

// A finish with no matching start (reload mid-run) still lands as a single done row.
const finishOnly = collapseProcessEvents([
  { at: 1, label: "terminal finished", detail: "terminal", status: "completed" },
]);
assert.equal(finishOnly.length, 1);
assert.equal(finishOnly[0].label, "Ran a command");

// Narration echoed by the session log with a completion status upgrades the
// streamed row in place — even when other narration landed in between.
const narrationTwins = collapseProcessEvents([
  { at: 1, label: "Hermes progress", detail: "Verify the files." },
  { at: 2, label: "Hermes progress", detail: "Fix the duplicate id." },
  { at: 3, label: "Hermes progress", detail: "Verify the files.", status: "completed" },
  { at: 4, label: "Hermes progress", detail: "Fix the duplicate id.", status: "completed" },
]);
assert.equal(narrationTwins.length, 2, "status echoes of identical narration collapse in place");
assert.equal(narrationTwins[0].status, "completed");
assert.equal(narrationTwins[1].status, "completed");

// --- junk runtime markers stay hidden ---------------------------------------

assert.equal(isHiddenChatProcessEvent({ label: "tool.generating" }), true);
assert.equal(isHiddenChatProcessEvent({ label: "tool.started" }), true);
assert.equal(isHiddenChatProcessEvent({ label: "chat.tool.done" }), true);
assert.equal(isHiddenChatProcessEvent({ label: "Hermes Adaptive stream still working" }), true);
assert.equal(isHiddenChatProcessEvent({ label: "tool.generating", detail: "building manifest" }), false, "a marker carrying a payload stays visible");
assert.equal(isHiddenChatProcessEvent({ label: "Hive capability search", detail: "22 retrieval hits" }), false);

// --- status transitions merge in place --------------------------------------

const merged = mergeProcessEvents(
  [{ at: 1, label: "Hermes progress", detail: "Writing files.", runId: "r1" }],
  [{ at: 2, label: "Hermes progress", detail: "Writing files.", status: "completed", runId: "r1" }],
);
assert.equal(merged.length, 1, "running→completed updates the row instead of adding a twin");
assert.equal(merged[0].status, "completed");

// --- capability continuation shares identity with the original message ------

const originalTask = "create a flappy bird clone but use a bee instead";
const continuationContent = `${CAPABILITY_APPROVAL_CONTINUATION_MARKER}\nHivemindOS selected this ready capability automatically. Continue the original task now.\n\nOriginal task: ${originalTask}\n\nProject workspace: /tmp/x`;
const localUser = { role: "user", content: originalTask, createdAt: 1_785_018_611_546 };
const sessionUser = { role: "user", content: continuationContent, createdAt: 1_785_018_612_673 };

assert.equal(compactCapabilityContinuation(continuationContent), originalTask);
assert.equal(sameVisibleChatMessage(localUser, sessionUser), true, "the continuation displays as the original words, so it IS the original turn");
assert.equal(userMessagesLikelySameTurn(localUser, sessionUser), true, "session merges must map the continuation onto the local turn, never append a duplicate");
assert.equal(isCapabilityContinuationEcho(sessionUser), true);
assert.equal(isCapabilityContinuationEcho(localUser), false);

// --- the app artifact survives session rehydration ---------------------------
// Repro context: 2026-07-26 flappy-bird thread — the app existed on disk, but
// the workspace showed "No preview available" because appArtifact is
// client-only state the runtime session store never persists.

const continuationWithProject = [
  { role: "user", content: `${continuationContent}\nAssigned App Builder project:\n- Project id: local_4dbf8f86d7cfd342523d\n- Directory: /tmp/flappy-bird/scratchpad/a-flappy-bird-clone-1ea72d69\n- Template: static\nImplement the app in that exact directory.` },
  { role: "assistant", content: "Flappy Bird clone is built and ready." },
];
const derived = chatAppArtifactFromCapabilityContext(continuationWithProject, { key: "127.0.0.1:8787", name: "This Mac" });
assert.ok(derived, "a rehydrated thread derives its app from the continuation prompt the session store kept");
assert.equal(derived.projectId, "local_4dbf8f86d7cfd342523d");
assert.equal(derived.directory, "/tmp/flappy-bird/scratchpad/a-flappy-bird-clone-1ea72d69");
assert.equal(derived.templateId, "static");
assert.equal(derived.name, "a flappy bird clone but use a bee instead", "the derived name matches what project creation would have produced");
assert.equal(derived.machineKey, "127.0.0.1:8787");
assert.equal(chatAppArtifactFromCapabilityContext([{ role: "user", content: originalTask }]), undefined, "a thread with no assigned project derives nothing");

// When merges rewrote the message content to the person's typed words (so
// neither the artifact nor the continuation text survives), the runtime task
// record still knows the project directory — including when the chat row
// stored a home-relative ("~/") workspace the browser cannot expand.
const taskMessages = [{ sourceSessionId: "agent-chat-turn-ms2abnrb" }];
const taskRecords = [
  { id: "agent-chat-turn-other", workingDirectory: "/Users/x/projects/flappy-bird/scratchpad/other-app", updatedAt: 9 },
  { id: "agent-chat-turn-ms2abnrb", workingDirectory: "/Users/x/projects/flappy-bird/scratchpad/a-flappy-bird-clone-1ea72d69", updatedAt: 5 },
];
assert.equal(
  chatAppDirectoryFromTaskRecords(taskMessages, taskRecords, "~/projects/flappy-bird"),
  "/Users/x/projects/flappy-bird/scratchpad/a-flappy-bird-clone-1ea72d69",
  "the task record recovers the project directory through a home-relative workspace",
);
assert.equal(
  chatAppDirectoryFromTaskRecords(taskMessages, taskRecords, "/Users/x/projects/flappy-bird"),
  "/Users/x/projects/flappy-bird/scratchpad/a-flappy-bird-clone-1ea72d69",
  "absolute workspaces match too",
);
assert.equal(
  chatAppDirectoryFromTaskRecords(taskMessages, [{ id: "agent-chat-turn-ms2abnrb", workingDirectory: "/Users/x/projects/flappy-bird", updatedAt: 5 }], "~/projects/flappy-bird"),
  "",
  "a task cwd that is the workspace itself is never adoptable — only a scratchpad project layout",
);
assert.equal(
  chatAppDirectoryFromTaskRecords(taskMessages, [{ id: "agent-chat-turn-ms2abnrb", workingDirectory: "/Users/x/elsewhere/scratchpad/app", updatedAt: 5 }], "~/projects/flappy-bird"),
  "",
  "a scratchpad outside the thread's workspace is never adoptable",
);

// The poll-takeover merge must not lose the turn's artifact when content
// pairing finds no carrier (segmentation drift between streamed and stored).
const localArtifactTurn = [
  { role: "user", content: originalTask, createdAt: 1 },
  { role: "assistant", content: "Streamed narration that the store kept differently.", createdAt: 2, appArtifact: { protocol: "hivemindos.chat-app/v1", projectId: "local_x", name: "a flappy bird clone", directory: "/tmp/x", templateId: "static", machineKey: "k", machineName: "This Mac", status: "stopped", dependenciesReady: true, createdAt: 1, updatedAt: 1 } },
];
const sessionVersionOfTurn = [
  { role: "user", content: originalTask, createdAt: 5 },
  { role: "assistant", content: "A reworded final summary the local tab never streamed.", createdAt: 6 },
];
const mergedTurn = preserveLocalTurnProcessEvents(sessionVersionOfTurn, localArtifactTurn);
assert.equal(mergedTurn.at(-1).appArtifact?.projectId, "local_x", "an unpaired session turn still keeps the local turn's app artifact on its last assistant row");

// --- source pins: the paths that regressed ----------------------------------

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const dashboardApp = await read("src/features/dashboard/DashboardApp.tsx");
const chatRunTranscripts = await read("src/features/dashboard/chat-run-transcripts.ts");
assert.match(chatRunTranscripts, /isCapabilityContinuationEcho\(message\)\) continue;/, "dedupeChatTranscript repairs transcripts that already saved a duplicated continuation turn");

const controller = await read("src/features/dashboard/hooks/use-status-chat-input-controller.tsx");
assert.match(controller, /sealActiveAssistantSegment\(\);/, "a tool pause seals the streamed narration instead of replacing it");
assert.match(controller, /rawRuntimeEventType\) && streamedAssistantText\.trim\(\)/, "a tool event arriving after streamed narration opens the next segment, so steps never render above text they followed");
assert.match(controller, /interimText !== lastSealedSegmentText/, "a reset after a step-triggered seal must not render the same narration twice");
assert.match(controller, /pruneTrailingEmptyAssistant\(\);/, "a run cannot leave an invisible empty assistant behind");

assert.doesNotMatch(chatRunTranscripts, /fallbackProcessIndex/, "positional pairing is dead: it re-distributed one segment's steps onto another and its identity stamping made the visible dedupe drop finished responses");
assert.match(chatRunTranscripts, /createdAt: processSource\.createdAt \?\? message\.createdAt/, "content-confirmed pairings preserve local identity so React keys stay stable mid-stream");

// The capability preflight is ONE step whose phases replace in place — no row
// may be left frozen at "active" when the next phase begins.
assert.match(controller, /last\?\.runId === runId\s*\n?\s*\?/, "preflight phases update the anchor row in place instead of stacking stale active rows");

const derivedState = await read("src/features/dashboard/hooks/use-dashboard-derived-state.tsx");
assert.match(derivedState, /dropping the\n\s*\/\/ later one deleted real responses/, "the visible dedupe keeps distinct-content messages under a corrupted source identity");

const hermesStream = await read("src/app/api/chat/agent-runtime/stream-adaptive-hermes.ts");
assert.match(hermesStream, /sealRuntimeChatSessionAssistantSegment\(runtimeSessionId, parsed\)/, "the session transcript keeps interim narration as an assistant segment");
assert.doesNotMatch(hermesStream, /"Hermes progress"/, "interim narration is no longer demoted to a process row");
assert.match(hermesStream, /\(\^\|\\\.\)tool\\\./, "a tool event seals the streamed narration server-side, so session text never glues across tool rows");
assert.match(hermesStream, /sealedByToolEvent/, "the bridge reset after a tool-sealed segment is swallowed instead of resealing the next segment's partial text");

const sessionStore = await read("src/lib/services/chat/runtime-session-store.ts");
assert.match(sessionStore, /export async function sealRuntimeChatSessionAssistantSegment/, "the session store can seal a streamed segment");

const messageThread = await read("src/features/dashboard/views/chat/exchange/MessageThread.tsx");
assert.match(messageThread, /lastAppArtifactIndexByProject/, "one app renders one Open-app card, on the run's last carrier");
assert.doesNotMatch(messageThread, /userLiveEvents/, "single-anchor model: there is no user-anchored live panel to hand off to (the handoff caused appear-vanish-reappear churn)");
assert.match(messageThread, /const isLiveTail = !isUser && busy && index === messages\.length - 1;/, "the live tail panel is exempt from the reveal gate so current activity never blinks out");
assert.match(controller, /anchorAssistantMessage/, "the turn's anchor assistant message exists before the first preflight step — one panel from first step to last");
assert.match(controller, /carryProcessEvents: activeProcessEventsForMessage\(\)/, "the capability continuation carries the preflight steps onto the same anchor instead of wiping them");

const streamState = await read("src/features/dashboard/hooks/status-chat-stream-state.ts");
assert.match(streamState, /chatStreamHasLocalRun/, "stream state distinguishes runs whose SSE lives in this tab");
assert.match(dashboardApp, /chatStreamHasLocalRun\(chatStreamingByKeyRef\.current\[storageKey\]\)/, "the 5s poll never merges into a thread this tab is actively streaming — the stream is the single source of truth");
assert.match(messageThread, /firstTypingIndex >= 0 && index > firstTypingIndex/, "sequential reveal: blocks below a still-typing message hold their turn instead of landing mid-animation");
assert.match(messageThread, /document\.hidden/, "a hidden tab renders streamed text instantly instead of accruing typewriter lag behind throttled timers");

console.log("chat process timeline checks passed");
