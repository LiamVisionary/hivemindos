import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function has(source, token, label) {
  assert(
    source.includes(token),
    `${label} missing ${JSON.stringify(token)}`,
  );
}

const voiceRuns = read("src/lib/services/phone/voice-runs.ts");
const recipes = read("src/lib/services/phone/voice-recipes.ts");
const toolBundles = read("src/lib/services/phone/voice-tool-bundles.ts");
const capabilities = read("src/lib/services/phone/voice-provider-capabilities.ts");
const realtime = read("src/lib/services/phone/realtime-voice.ts");
const gateway = read("src/lib/services/phone/call-gateway.ts");
const phoneRoute = read("src/app/api/phone/route.ts");
const voiceRunRouteActions = read("src/lib/services/phone/voice-run-route-actions.ts");
const modal = read("src/components/fleet/agent-call-modal.tsx");
const modalRunEvents = read("src/components/fleet/agent-call-run-events.ts");
const agentsPanel = read("src/features/dashboard/views/AgentsPanel.tsx");
const e2eHarness = read("src/app/e2e/agent-call/AgentCallE2EHarness.tsx");
const worker = read("scripts/hivemindos-call-agent-worker.mjs");
const docs = read("docs/features/calling.md");

has(voiceRuns, 'const VOICE_RUN_ROOT = join(homedir(), ".hivemindos", "voice-runs")', "voice run storage");
has(voiceRuns, "function sanitizeText", "voice run redaction");
has(voiceRuns, "function extractGatheredContext", "voice run extraction");
has(voiceRuns, "function evaluateVoiceRun", "voice run QA");
has(voiceRuns, 'type: "extraction.completed"', "voice run extraction event");
has(voiceRuns, 'type: "qa.completed"', "voice run QA event");

has(toolBundles, 'id: "agent-call-default"', "default voice tool bundle");
has(toolBundles, 'name: "ask_computer_agent"', "computer-agent voice tool");
has(toolBundles, "toolsForVoiceToolBundle", "tool bundle resolver");
has(recipes, 'id: "agent-runtime-bridge"', "agent runtime recipe");
has(recipes, 'id: "cloud-multi-agent-room"', "cloud room recipe");
has(recipes, 'id: "queen-bee-control-plane"', "queen voice recipe");
has(capabilities, 'id: "openai-realtime"', "OpenAI realtime capability");
has(capabilities, 'id: "local-tts"', "Local TTS capability");
has(capabilities, 'id: "livekit-cloud-room"', "LiveKit capability");
has(capabilities, "voiceCapabilitySearchEvidence", "voice capability search evidence");

has(realtime, "toolsForVoiceToolBundle", "Realtime tool bundle use");
has(realtime, "providerCapabilities: voiceProviderCapabilitiesPayload(managed)", "Realtime capability payload");
has(realtime, "recipes: listVoiceRecipes()", "Realtime recipe payload");

has(gateway, "createVoiceRun", "gateway voice run creation");
has(gateway, "voiceRun: voiceRunCallPayload(voiceRun)", "gateway voice run response");
has(gateway, "buildRuntimeAgentVoiceBridge(input, hubUrl, voiceRun.id)", "gateway runtime bridge run id");
has(gateway, 'recipeId: "cloud-multi-agent-room"', "cloud recipe id");
has(gateway, 'recipeId: "agent-runtime-bridge"', "agent bridge recipe id");

for (const action of [
  'action === "voice-runs"',
  'action === "voice-run"',
  'action === "voice-recipes"',
  'action === "voice-capabilities"',
  'body.action === "voice-run-event"',
  'body.action === "voice-run-complete"',
  'body.action === "voice-run-qa"',
  'body.action === "voice-recipe-validate"',
]) {
  has(voiceRunRouteActions, action, `voice run route action ${action}`);
}
has(phoneRoute, "handleVoiceRunGetAction(action, request)", "phone API voice run GET dispatch");
has(phoneRoute, "handleVoiceRunPostAction(body)", "phone API voice run POST dispatch");
has(phoneRoute, 'type: "runtime.turn.started"', "runtime turn start event");
has(phoneRoute, 'type: "runtime.turn.completed"', "runtime turn completion event");
has(phoneRoute, 'type: "runtime.turn.failed"', "runtime turn failure event");
has(phoneRoute, 'type: "user.transcript"', "user transcript event");
has(phoneRoute, 'type: "agent.caption"', "agent caption event");
has(phoneRoute, "const fallbackText = spokenVoiceRuntimeFailure(error)", "Local TTS fallback caption capture");

has(modal, "voiceRun?: AgentCallVoiceRun", "modal voice run prop");
has(modalRunEvents, 'action: "voice-run-event"', "modal event posting");
has(modalRunEvents, 'action: "voice-run-complete"', "modal completion posting");
has(modal, "voiceRunId: target?.voiceRunId", "modal tool voice run id");
has(modalRunEvents, 'type: "tool.call.started"', "modal tool start event");
has(modalRunEvents, 'type: "tool.call.completed"', "modal tool completion event");

has(agentsPanel, "voiceRun: call.voiceRun", "dashboard voice run session state");
has(agentsPanel, "voiceRun={agentCallSession.voiceRun}", "dashboard modal voice run prop");
has(e2eHarness, "voiceRun: call.voiceRun", "E2E harness voice run session state");
has(e2eHarness, "voiceRun={session.voiceRun}", "E2E harness modal voice run prop");

has(worker, "voiceRunId: target.voiceRunId", "LiveKit worker tool voice run id");
has(worker, 'action: "voice-run-event"', "LiveKit worker event posting");
has(worker, 'action: "voice-run-complete"', "LiveKit worker completion posting");

has(docs, "## Voice Runs", "calling docs voice runs section");
has(docs, "## Recipes And Tools", "calling docs recipes section");
has(docs, "GET /api/phone?action=voice-capabilities", "calling docs capability API");

console.log("Voice run source integration checks passed.");
