import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const composer = read("src/features/chat/chat-composer.tsx");
const controller = read("src/features/dashboard/hooks/use-status-chat-input-controller.tsx");
const coldStartStatus = read("src/features/dashboard/hooks/agent-cold-start-status.ts");
const coldStartCore = read("src/lib/services/chat/agent-cold-start.ts");
const chatPanelHelpers = read("src/features/dashboard/views/chat/chat-panel-helpers.ts");
const modelsRoute = read("src/app/api/hivemindos/models/chat/completions/route.ts");
const panel = read("src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx");
const thread = read("src/features/dashboard/views/chat/exchange/MessageThread.tsx");
const motion = read("src/features/dashboard/views/chat/exchange/chat-exchange-motion.css");
const probe = read("scripts/probe-scout-cold-start-message.mjs");
const runtimeEvents = read("src/lib/services/runtime-stream-events.ts");
const statusHelpers = read("src/features/dashboard/hooks/status-chat-input-helpers.ts");
const httpRuntime = read("src/app/api/chat/agent-runtime/stream-http-runtime.ts");
const openAiRuntime = read("src/app/api/chat/agent-runtime/stream-openai-compatible.ts");

assert.match(
  composer,
  /export function AgentResponseLoader\(\{ phrase: phraseOverride \}: \{ phrase\?: string \} = \{\}\)/,
  "AgentResponseLoader should accept an optional fixed phrase",
);
assert.match(
  composer,
  /if \(customPhrase\) return undefined;/,
  "fixed loader phrases should skip the rotating phrase interval",
);
assert.match(
  panel,
  /function coldStartStatusText\(events: any\[\], selectedAgent: any\)/,
  "ChatExchangePanel should isolate the generic cold-start status detector",
);
assert.match(
  panel,
  /coldStartStatusText\(currentProcessEvents, selectedAgent\)/,
  "wake copy should come from current process events and the selected agent",
);
assert.match(
  panel,
  /agentWakeStatusText\(selectedAgent\)/,
  "wake copy should use the generic agent wake formatter",
);
assert.match(
  panel,
  /isAgentColdStartProcessEvent\(event\)/,
  "wake copy should require an explicit cold-start process event",
);
assert.doesNotMatch(
  panel,
  /busy && !hasStreamingChunk && isFreeSwarmScoutAgent\(selectedAgent\)/,
  "active requests without cold-start events must keep the normal thinking loader",
);
assert.doesNotMatch(
  panel,
  /HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER|isFreeHivemindosWalletPaidModel/,
  "ChatExchangePanel should not infer cold starts from the selected provider/model alone",
);
assert.match(
  controller,
  /agentColdStartProcessEvent\(selectedAgent\)/,
  "chat send should probe generic agent cold-start state before the runtime request",
);
assert.match(
  controller,
  /appendRunChatProcess\(coldStartEvent\.label, coldStartEvent\.detail, coldStartEvent\.status\)/,
  "cold-start status should become a live process event",
);
assert.match(
  controller,
  /recordAgentRuntimeWarm\(selectedAgent\)/,
  "successful chat route responses should refresh the generic warm cache",
);
assert.match(
  coldStartStatus,
  /\/api\/hivemindos\/models\/chat\/completions[\s\S]*method: "GET"/,
  "free HivemindOS model status helper should use the local model status route",
);
assert.match(
  coldStartStatus,
  /inferredModalColdStartProcessEvent\(agent\)/,
  "cold-start helper should support generic Modal-hosted agents",
);
assert.match(
  coldStartStatus,
  /inferredRecentSuccessColdStartProcessEvent\(agent, detail\)/,
  "free Scout metadata-missing responses should fall back to the recent-success warm window",
);
assert.match(
  coldStartCore,
  /AGENT_COLD_START_EVENT_LABEL = "Agent cold start"/,
  "cold-start helper should use a generic event label",
);
assert.match(
  coldStartCore,
  /agentWakeStatusText/,
  "cold-start helper should expose a generic wake phrase formatter",
);
assert.match(
  coldStartCore,
  /Starting your free agent session/,
  "free-agent cold starts should use user-facing session copy",
);
assert.match(
  chatPanelHelpers,
  /isAgentColdStartProcessEvent\(event\)/,
  "cold-start events should stay out of the visible process timeline",
);
assert.match(
  coldStartCore,
  /isLikelyModalHostedAgent/,
  "cold-start helper should detect direct Modal-hosted agents",
);
assert.match(
  modelsRoute,
  /export async function GET\(request: NextRequest\)/,
  "local HivemindOS model route should expose free Scout status",
);
assert.match(
  modelsRoute,
  /x-hivemindos-free-model-container-state/,
  "local HivemindOS model route should forward the typed Scout container state header",
);
assert.match(
  panel,
  /pendingAssistantStatusText=\{pendingAssistantStatusText\}/,
  "ChatExchangePanel should pass the pending label into MessageThread",
);
assert.match(
  thread,
  /<AgentResponseLoader phrase=\{cleanPhrase \|\| undefined\} \/>/,
  "MessageThread should pass the fixed phrase to the animated loader",
);
assert.match(
  thread,
  /AgentSessionStartLoader label=\{pendingAssistantStatusText\}/,
  "MessageThread should show the session-start loader outside a pending bubble",
);
assert.match(
  thread,
  /AgentSessionStartLoader label=\{pendingAssistantLabel\}/,
  "MessageThread should show the session-start loader inside a pending bubble",
);
assert.match(
  thread,
  /const visibleEvents = events\.filter\(\(event\) => !isHiddenChatProcessEvent\(event\)\)/,
  "MessageThread should omit hidden-only timelines and their worked divider",
);
assert.match(
  motion,
  /\.fr-agent-session-progress-fill[\s\S]*animation: fr-agent-session-progress/,
  "free-agent session startup should render an animated indeterminate progress bar",
);
assert.match(
  probe,
  /state: "metadata-missing"/,
  "live Scout probe should distinguish missing metadata from a cold container",
);
assert.match(
  probe,
  /const shouldWake = status\.state === "cold" \|\| status\.state === "metadata-missing"/,
  "live Scout probe should model the metadata-missing fallback as a cold-start event",
);
assert.match(
  probe,
  /loader: shouldWake \? "Starting your free agent session" : "thinking"/,
  "live Scout probe should keep warm waits on the thinking loader",
);
assert.match(
  probe,
  /require-cold-message/,
  "live Scout probe should support a failing continuous gate for cold-message validation",
);
assert.match(
  runtimeEvents,
  /COLD_START: "chat\.cold_start"/,
  "runtime stream events should expose a canonical cold-start event type",
);
assert.match(
  statusHelpers,
  /type === AGENT_COLD_START_EVENT_TYPE[\s\S]*AGENT_COLD_START_EVENT_LABEL/,
  "client SSE parser should map route cold-start events to the canonical process event",
);
assert.match(
  httpRuntime,
  /inferredModalColdStartProcessEvent\(runtimeProfile\)[\s\S]*appendRuntimeChatSessionEvent\([\s\S]*coldStartEvent\.label/,
  "HTTP runtime route should record cold starts for Modal-hosted agents",
);
assert.match(
  openAiRuntime,
  /inferredModalColdStartProcessEvent\(candidateProfile\)[\s\S]*appendRuntimeChatSessionEvent\([\s\S]*coldStartEvent\.label/,
  "OpenAI-compatible chat route should record cold starts for Modal-hosted agents",
);

console.log("Scout wake loader guard passed.");
