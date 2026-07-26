#!/usr/bin/env node
import { readFileSync } from "node:fs";

const controllerPath = "src/features/dashboard/hooks/use-status-chat-input-controller.tsx";
const dashboardPath = "src/features/dashboard/DashboardApp.tsx";
const chatRunTranscriptsPath = "src/features/dashboard/chat-run-transcripts.ts";
const inputHelpersPath = "src/features/dashboard/hooks/status-chat-input-helpers.ts";
const processPanelPath = "src/features/dashboard/views/chat/AgentProcessPanel.tsx";
const streamStatePath = "src/features/dashboard/hooks/status-chat-stream-state.ts";

const controller = readFileSync(controllerPath, "utf8");
const dashboard = readFileSync(dashboardPath, "utf8");
const chatRunTranscripts = readFileSync(chatRunTranscriptsPath, "utf8");
const inputHelpers = readFileSync(inputHelpersPath, "utf8");
const processPanel = readFileSync(processPanelPath, "utf8");
const streamState = readFileSync(streamStatePath, "utf8");

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`${label} missing: ${needle}`);
  }
}

function assertMatch(source, pattern, label) {
  if (!pattern.test(source)) {
    throw new Error(`${label} missing: ${pattern}`);
  }
}

assertIncludes(streamState, "sessionId?: string;", "active run stream state accepts session id");
assertIncludes(streamState, "sessionId: input.sessionId", "active run stream state persists session id");

assertIncludes(inputHelpers, "function isChatTransportInterruption(error: unknown)", "transport interruption classifier");
assertIncludes(controller, "isChatTransportInterruption(error)", "chat controller uses transport interruption classifier");
assertIncludes(controller, "const localRuntimeSessionId = taskId;", "each chat turn receives an isolated local runtime session id");
assertMatch(
  controller,
  /startChatStream\(\s*selectedStorageKey,\s*selectedAgent\.id,\s*selectedChatLeafKey,\s*outgoingLabel,\s*taskId,\s*requestStartedAt,\s*localRuntimeSessionId\s*\)/s,
  "chat stream starts with the known local runtime session id",
);
assertIncludes(controller, "let currentRuntimeSessionId = localRuntimeSessionId || \"\";", "polling starts from local runtime session id");
assertIncludes(controller, "runtimeSessionId: localRuntimeSessionId", "request sends the isolated local runtime session id");
assertIncludes(controller, "clientRunId: taskId", "request sends client run id used by runtime-session fallback");

assertMatch(
  controller,
  /if \(parsed\.session\?\.id\) \{\s*const sessionId = parsed\.session\.id;\s*if \(!currentRuntimeSessionId \|\| sessionId === localRuntimeSessionId\) currentRuntimeSessionId = sessionId;/s,
  "nested runtime session events cannot replace the turn-owned local session id",
);
assertMatch(
  controller,
  /recordActiveChatRun\?\.\(\{\s*storageKey: selectedStorageKey,[\s\S]*?sessionId: activeSessionId,[\s\S]*?status: "active",\s*\}\);/s,
  "stream session events keep the active run resumable",
);

assertIncludes(controller, "const transportInterrupted = !aborted && isChatTransportInterruption(error);", "transport interruption catch path");
assertIncludes(controller, "preserveActiveRun = transportInterrupted;", "transport interruption preserves active run marker");
assertIncludes(controller, "sessionId: currentRuntimeSessionId || localRuntimeSessionId || undefined", "interruption records fallback session id");
assertIncludes(controller, "status: aborted ? \"stalled\" : \"active\"", "transport interruption stays active for reload polling");
assertIncludes(controller, "if (transportInterrupted) {", "transport interruption returns without final error bubble");
assertIncludes(controller, "if (!preserveActiveRun && (sawDone || !abortController.signal.aborted || recoveredAssistantText.trim())) clearActiveChatRun?.(selectedStorageKey, taskId);", "finally clears only the completed active run");

assertIncludes(processPanel, "cancelled|canceled|error", "process panel treats error events as terminal");
assertIncludes(chatRunTranscripts, "if (message?.type === \"process\")", "dashboard preserves runtime-session process event labels");
assertIncludes(inputHelpers, "if (message?.type === \"process\")", "live session recovery preserves runtime-session process event labels");
assertIncludes(dashboard, "? !endedAt", "runtime poller uses the explicit session end marker rather than partial assistant text");
assertIncludes(dashboard, "reconcilePolledChatStreamState", "runtime poll reconciliation is monotonic and run-scoped");

console.log("chat reload resume regression passed");
