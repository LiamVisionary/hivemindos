#!/usr/bin/env node
// Unit coverage for Queen Bee's durable voice-preference logic - the layer
// that makes "call me boss" survive closing and reopening the voice overlay.
// Exercises the pure core (parse/normalize/dedupe/cap/append/format); the
// dashboard-state persistence wrapper is a thin read-modify-write over it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  MAX_VOICE_PREFERENCES,
  appendVoicePreference,
  formatVoicePreferencePreamble,
  normalizeVoicePreferences,
  parseVoicePreferences,
  serializeVoicePreferences,
} = await import("../src/lib/services/queen-bee/voice-preferences-core.ts");
const {
  buildAgentCallPreferences,
} = await import("../src/lib/types/agent-runtime.ts");
const {
  runtimeConversationTurnTimeoutMs,
} = await import("../src/lib/services/queen-bee/voice-turn.ts");

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${label}`);
}

check("empty/garbage parses to no preferences", () => {
  assert.deepEqual(parseVoicePreferences(undefined), []);
  assert.deepEqual(parseVoicePreferences(null), []);
  assert.deepEqual(parseVoicePreferences(""), []);
  assert.deepEqual(parseVoicePreferences("not json"), []);
  assert.deepEqual(parseVoicePreferences('{"not":"an array"}'), []);
});

check("a stated preference is captured and round-trips through storage", () => {
  const list = appendVoicePreference([], 'Address the user as "boss".');
  assert.deepEqual(list, ['Address the user as "boss".']);
  const reread = parseVoicePreferences(serializeVoicePreferences(list));
  assert.deepEqual(reread, list);
});

check("the preamble names the preference, and is empty when none", () => {
  assert.equal(formatVoicePreferencePreamble([]), "");
  const preamble = formatVoicePreferencePreamble([
    'Address the user as "boss".',
  ]);
  assert.match(preamble, /boss/);
  assert.match(preamble, /always honor these/i);
});

check("duplicates are deduped case-insensitively, not stacked", () => {
  let list = appendVoicePreference([], "Reply in Spanish.");
  list = appendVoicePreference(list, "reply in spanish.");
  assert.equal(list.length, 1);
});

check("a repeat moves to the end and the latest wording wins", () => {
  let list = ["Keep replies short.", 'Address the user as "boss".'];
  list = appendVoicePreference(list, "keep replies SHORT.");
  // The earlier entry is dropped, the freshest wording is kept, and it lands
  // last so a later-conflicting preference reads as the most recent.
  assert.deepEqual(list, [
    'Address the user as "boss".',
    "keep replies SHORT.",
  ]);
});

check("whitespace is collapsed and blanks are dropped", () => {
  assert.deepEqual(
    normalizeVoicePreferences(["  Speak\n  slowly. ", "", "   "]),
    ["Speak slowly."],
  );
  assert.deepEqual(appendVoicePreference(["keep"], "   "), ["keep"]);
});

check("the list is capped to the most recent MAX_VOICE_PREFERENCES", () => {
  let list = [];
  for (let i = 0; i < MAX_VOICE_PREFERENCES + 5; i += 1) {
    list = appendVoicePreference(list, `Preference number ${i}.`);
  }
  assert.equal(list.length, MAX_VOICE_PREFERENCES);
  // Oldest aged out, newest retained.
  assert.ok(!list.includes("Preference number 0."));
  assert.ok(list.includes(`Preference number ${MAX_VOICE_PREFERENCES + 4}.`));
});

check("non-string entries in stored JSON are ignored", () => {
  assert.deepEqual(
    parseVoicePreferences(JSON.stringify(["Speak up.", 42, null, { a: 1 }])),
    ["Speak up."],
  );
});

// --- Cross-file wiring contracts -------------------------------------------
// The checks above prove the store LOGIC. These prove the WIRING that the
// logic depends on but which a pure-logic test can't see: the realtime tool
// name, the HTTP action string shared by client and server, the storage key,
// and that the minted realtime session returns the preference-augmented
// instructions (not the bare constant). A regression in any of these would
// silently pass every check above while breaking "call me boss" in practice.
const ROOT = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), "utf8");
const readOptional = (rel) => {
  try {
    return read(rel);
  } catch {
    return "";
  }
};
const route = read("src/app/api/queen-bee/voice/route.ts");
const hook = read("src/features/queen-voice/use-queen-bee-realtime.ts");
const geminiHook = read("src/features/queen-voice/use-queen-bee-gemini-live.ts");
const overlay = read("src/features/queen-voice/QueenBeeVoiceOverlay.tsx");
const cloudVoiceTransports = read("src/lib/services/phone/cloud-voice-transports.ts");
const callProviderMatrix = read("src/lib/config/voice-call-providers.ts");
const callGateway = read("src/lib/services/phone/call-gateway.ts");
const turn = read("src/lib/services/queen-bee/voice-turn.ts");
// The voice/calls + ministry preference types were extracted out of
// agent-runtime.ts (file-size ratchet) into their own module — agent-runtime.ts
// re-exports them, so consumers are unchanged, but the source-text pins below
// have to follow the declarations to their new home.
const agentCallPreferenceTypes = read("src/lib/types/agent-call-preferences.ts");
const callsVoiceSection = read("src/features/dashboard/views/chat/AgentSettingsCallsVoiceSection.tsx");
const cloudVoiceRoute = read("src/app/api/phone/cloud-voice/route.ts");
const pcmStreamPlayer = read("src/lib/audio/realtime-pcm-stream-player.ts");
const pcmPreviewPlayer = readOptional("src/lib/audio/pcm-preview-player.ts");
const realtimePreview = readOptional("src/lib/audio/openai-realtime-voice-preview.ts");
// The realtime tool declaration moved out of the route into the shared voice
// tool bundle (also used by phone calls) — pin it there instead.
const toolBundles = read("src/lib/services/phone/voice-tool-bundles.ts");

check("CAPTURE: the realtime tool is declared, dispatched, and POSTed by one name", () => {
  assert.match(toolBundles, /name:\s*"remember_preference"/, "tool not declared in the shared voice tool bundle");
  assert.match(hook, /call\.name === "remember_preference"/, "dispatch branch missing");
  assert.match(hook, /action:\s*"remember-preference"/, "client POST action missing");
  assert.match(route, /body\.action === "remember-preference"/, "server action handler missing");
  assert.match(route, /addQueenBeeVoicePreference\(/, "server handler does not persist");
});

check("INJECT: the minted realtime session carries the preference preamble", () => {
  assert.match(route, /queenVoicePreferencePreamble\(/, "mint never reads stored preferences");
  // The pre-fix bug shape returned/sent the bare constant; guard against its return.
  assert.doesNotMatch(
    route,
    /instructions:\s*QUEEN_REALTIME_INSTRUCTIONS/,
    "realtime instructions must be the augmented variable, not the bare constant",
  );
});

check("INJECT: the fallback + relay paths thread the preamble into the prompt", () => {
  assert.match(turn, /queenVoicePreferencePreamble\(/, "fallback never reads stored preferences");
  assert.match(
    turn,
    /buildRuntimeVoiceMessages\(transcript, history, systemPreamble, personality\)/,
    "system preamble not threaded into runtime voice messages",
  );
  assert.match(
    turn,
    /conversationMessages\(transcript, history, \{[\s\S]*systemPreamble,[\s\S]*personality,/,
    "system preamble not threaded into provider conversation messages",
  );
});

check("BRAIN: legacy fleet-agent prefs do not silently override the Queen model", () => {
  const legacyFleet = buildAgentCallPreferences({
    voiceChatBrain: { source: "fleet-agent", provider: "openai-api" },
  });
  assert.deepEqual(legacyFleet.voiceChatBrain, {
    source: "fleet-agent",
    provider: "openai-api",
    model: undefined,
    explicit: undefined,
  });
  const explicitFleet = buildAgentCallPreferences({
    voiceChatBrain: { source: "fleet-agent", explicit: true },
  });
  assert.equal(explicitFleet.voiceChatBrain?.explicit, true);
  assert.match(agentCallPreferenceTypes, /explicit\?: boolean/, "voice brain preference must persist an explicit user choice");
  assert.match(callsVoiceSection, /explicit:\s*true/, "Calls voice selector must mark new brain choices explicit");
  assert.match(route, /const explicitFleetAgent = pref\?\.source === "fleet-agent" && pref\.explicit === true/, "resolver must only honor explicit fleet-agent overrides");
  assert.match(route, /if \(explicitFleetAgent\) return \{ kind: "fleet-agent" \}/, "resolver must keep explicit fleet-agent selectable");
  assert.doesNotMatch(route, /if \(pref\?\.source === "fleet-agent"\) return \{ kind: "fleet-agent" \}/, "stale fleet-agent rows must not bypass the Queen model");
  assert.match(turn, /readStoredAgentProfilesStrict/, "agent-runtime voice plans must read persisted dashboard agents");
  assert.match(turn, /const stored = await readStoredConversationAgent\(plan\.agentId\)/, "agent-runtime voice plans must try the pinned persisted agent before the ranked fleet");
});

check("BRAIN: OAuth runtime voice brains get enough time for tool-backed answers", () => {
  assert.equal(runtimeConversationTurnTimeoutMs({ provider: "openai-api" }), 20_000);
  assert.equal(runtimeConversationTurnTimeoutMs({ provider: "xai-oauth" }), 75_000);
  assert.equal(runtimeConversationTurnTimeoutMs({ provider: "openai-codex" }), 75_000);
  assert.match(turn, /const OAUTH_AGENT_TURN_TIMEOUT_MS = 75_000/, "OAuth runtime turns must not share the direct-provider 20s budget");
  assert.match(turn, /provider\.includes\("oauth"\)/, "OAuth providers must use the longer runtime turn timeout");
  assert.match(turn, /AbortSignal\.timeout\(runtimeConversationTurnTimeoutMs\(agent\)\)/, "runtime voice fetch must use the provider-aware timeout");
});

check("GEMINI: Queen Calls prefs route Gemini Live to the Gemini hook", () => {
  assert.match(route, /const GEMINI_LIVE_RUNTIME = "gemini-live"/, "Gemini runtime constant missing");
  assert.match(route, /body\.action === "gemini-live-session"/, "Gemini session action missing");
  assert.match(route, /mintGeminiLiveToken\(/, "Gemini session does not mint a Gemini token");
  assert.match(route, /calls\?\.voiceRuntime === GEMINI_LIVE_RUNTIME/, "GET route does not detect saved Gemini Live prefs");
  assert.match(route, /voiceMode:\s*callPrefsUnavailable[\s\S]*geminiLiveSelected[\s\S]*\? "gemini-live"/, "GET route does not return gemini-live voiceMode");
  assert.match(overlay, /useQueenBeeGeminiLive\(/, "overlay does not start the Gemini hook");
  assert.match(overlay, /voiceModeForOpen === "gemini-live"/, "overlay does not branch on gemini-live mode");
  assert.match(geminiHook, /action:\s*"gemini-live-session"/, "Gemini hook does not request the Queen Gemini session");
  assert.match(geminiHook, /voiceName: session\.voice/, "Gemini hook does not pass the saved Gemini voice to speechConfig");
});

check("GEMINI: stale Live models normalize to the current supported default", () => {
  assert.match(cloudVoiceTransports, /export const GEMINI_LIVE_MODEL = "gemini-3\.1-flash-live-preview"/, "Gemini Live default is not the current 3.1 model");
  assert.match(cloudVoiceTransports, /"gemini-2\.0-flash-live-001"/, "stale Gemini 2.0 Live id is not listed for normalization");
  assert.match(cloudVoiceTransports, /normalizeGeminiLiveModel\(options\.model\)/, "token mint does not normalize the requested model");
  assert.match(route, /normalizeGeminiLiveModel\(calls\.voiceModelId\)/, "Queen Gemini session does not normalize saved Calls model");
  assert.match(callProviderMatrix, /defaultModel:\s*"gemini-3\.1-flash-live-preview"/, "Calls picker default is not Gemini 3.1 Live");
  assert.doesNotMatch(callProviderMatrix, /defaultModel:\s*"gemini-2\.5-flash-native-audio-preview-12-2025"/, "Calls picker still defaults to the old Gemini 2.5 Live preview");
  assert.match(callGateway, /normalizeGeminiLiveModel\(payload\.voiceModelId\)/, "dashboard call gateway does not normalize Gemini Live model");
});

check("CLOUD TTS: saved ElevenLabs runtime opens the Queen pipeline", () => {
  assert.match(route, /const resolvedCallVoice = calls \? resolveVoiceRuntime\(calls\.voiceRuntime\) : null/, "Queen settings do not resolve the saved voice runtime through the capability matrix");
  assert.match(route, /const cloudTtsSelected = resolvedCallVoice\?\.kind === "cloud-tts"/, "Queen settings do not detect cloud TTS runtimes");
  assert.match(route, /localTtsSelected \|\| cloudTtsSelected\s*\? "pipeline"/, "Queen settings still route cloud TTS to realtime");
  assert.match(route, /pipelineSelected:\s*callPrefsUnavailable \|\| localTtsSelected \|\| cloudTtsSelected/, "Queen settings do not expose cloud TTS as a pipeline");
});

check("VOICE CONTINUITY: a prefs-store outage routes to the pipeline, never realtime", () => {
  // An unreadable store must not read as "no local voice selected" — the GET
  // resolves the outage to the pipeline, whose per-turn speak paths re-check
  // the store and report voiceUnavailable instead of substituting a voice.
  assert.match(route, /let callPrefsUnavailable = false/, "GET route does not track a call-prefs outage");
  assert.match(route, /voiceMode:\s*callPrefsUnavailable\s*\? "pipeline"/, "a call-prefs outage does not route the overlay to the pipeline");
  assert.doesNotMatch(route, /readQueenBeeCallPreferences\(\)\.catch\(\(\) => null\)[\s\S]{0,600}voiceMode:/, "the GET route may not swallow a prefs outage into a realtime default");
  // The overlay client mirrors the same rule when the settings GET itself
  // fails: default to the pipeline, not to a realtime cloud voice.
  assert.match(overlay, /setResolvedVoiceMode\(\{ nonce, mode: "pipeline", inputTranscriptionMode: "realtime" \}\)/, "overlay GET failure does not fall back to the pipeline");
  assert.doesNotMatch(overlay, /catch[\s\S]{0,200}setResolvedVoiceMode\(\{ nonce, mode: "realtime"/, "overlay GET failure still defaults to the realtime voice");
});

check("CLOUD TTS: Queen PCM speech uses the saved provider voice and model", () => {
  assert.match(route, /resolvedVoice\.kind === "cloud-tts" && resolvedVoice\.provider/, "Queen PCM speech does not branch on the selected cloud TTS capability");
  assert.match(route, /synthesizeVoicePreview\(resolvedVoice\.provider\.id, \{[\s\S]*text,[\s\S]*voice:\s*calls\.voiceId,[\s\S]*model:\s*calls\.voiceModelId,[\s\S]*languageCode:\s*calls\.voiceLanguage,/, "Queen PCM speech does not send the saved cloud voice configuration");
  assert.match(route, /"x-audio-sample-rate": String\(cloudSpeech\.sampleRate\)/, "Queen cloud TTS stream does not expose its PCM sample rate");
});

check("CLOUD TTS: buffered Queen speech returns a decodable selected-voice clip", () => {
  const bufferedSpeak = route.slice(route.indexOf("async function streamSpokenReply("));
  assert.match(bufferedSpeak, /resolvedVoice\.kind === "cloud-tts" && resolvedVoice\.provider/, "buffered Queen speech does not detect the selected cloud TTS capability");
  assert.match(bufferedSpeak, /synthesizeVoicePreview\(resolvedVoice\.provider\.id, \{[\s\S]*text,[\s\S]*voice:\s*calls\.voiceId,[\s\S]*model:\s*calls\.voiceModelId,[\s\S]*languageCode:\s*calls\.voiceLanguage,/, "buffered Queen speech does not send the saved cloud voice configuration");
  assert.match(bufferedSpeak, /pcm16ToWav\(pcm, cloudSpeech\.sampleRate, 1\)/, "buffered cloud speech is not wrapped in a decodable WAV container");
  assert.match(bufferedSpeak, /"Content-Type": "audio\/wav"/, "buffered cloud speech does not advertise WAV audio");
});

check("CLOUD TTS PREVIEW: media playback is unlocked before the provider request", () => {
  const previewStart = callsVoiceSection.indexOf("const previewVoice = async () => {");
  const contextStart = callsVoiceSection.indexOf("createPcmPreviewPlayer()", previewStart);
  const providerRequest = callsVoiceSection.indexOf('fetch("/api/phone/cloud-voice"', previewStart);
  assert.ok(previewStart >= 0, "Preview handler is missing");
  assert.ok(contextStart > previewStart && contextStart < providerRequest, "Preview starts its media player after the network wait and loses the click unlock");
  assert.match(callsVoiceSection.slice(previewStart), /previewPlayer\.play\(response, \{[\s\S]{0,180}sampleRate,/, "Preview does not play through its click-primed buffered player");
  assert.match(pcmPreviewPlayer, /const audio = new Audio\(/, "Preview player does not use a user-started media element");
  assert.match(pcmPreviewPlayer, /audio\.loop = true[\s\S]{0,240}const unlockPromise = audio\.play\(\)/, "Preview media does not remain active while the provider synthesizes");
  assert.doesNotMatch(pcmPreviewPlayer, /AudioContext|AudioWorklet/, "Short voice previews still depend on the blocked Web Audio path");
  assert.match(pcmStreamPlayer, /if \(context\.state !== "running"\) \{[\s\S]{0,180}waitWithTimeout\(context\.resume\(\)/, "PCM playback re-resumes an already-running WebKit context and can hang on the second resume promise");
});

check("OPENAI OAUTH VOICE: Preview names the exact OAuth route limitation", () => {
  assert.match(callsVoiceSection, /authMode:\s*effectiveAuthMode/, "Preview request does not send the selected auth mode");
  assert.match(callsVoiceSection, /data\?\.error/, "Preview does not unwrap the API error for the user");
  assert.match(cloudVoiceRoute, /body\.authMode === "oauth"/, "cloud voice route does not branch on OAuth");
  assert.match(cloudVoiceRoute, /ChatGPT OAuth does power Voice inside ChatGPT/, "OAuth Preview still falsely says ChatGPT OAuth has no voice");
  assert.match(cloudVoiceRoute, /Codex OAuth grant[\s\S]{0,180}private Voice WebRTC route/, "OAuth Preview does not identify the actual grant and route limitation");
  assert.doesNotMatch(cloudVoiceRoute, /getOpenAiOAuthApiKey\(\)/, "OAuth Preview still uses the failed legacy API-key exchange");
  assert.equal(realtimePreview, "", "The unusable OAuth Realtime browser bridge still exists");
  assert.match(callProviderMatrix, /id:\s*"openai"[\s\S]{0,500}voiceAuthModes:\s*\["apikey"\]/, "OpenAI transport matrix still advertises an unusable OAuth route");
});

check("OPENAI OAUTH VOICE: Queen voice preserves OAuth without hidden key fallback", () => {
  assert.match(route, /calls\?\.voiceAuthMode === "oauth"/, "Queen Realtime mint ignores the saved OAuth selection");
  assert.match(route, /ChatGPT OAuth powers Voice inside ChatGPT/, "Queen Realtime still falsely says ChatGPT OAuth has no voice");
  assert.match(route, /Codex OAuth grant[\s\S]{0,180}private Voice WebRTC route/, "Queen Realtime does not identify the actual grant and route limitation");
  assert.doesNotMatch(route, /getOpenAiOAuthApiKey\(\)/, "Queen Realtime still uses the failed legacy API-key exchange");
  assert.match(callsVoiceSection, /OAuth selected[\s\S]{0,160}not substitute your API key/, "OAuth status copy does not confirm that the explicit choice wins");
});

check("OPENAI OAUTH VOICE UI: Toggle remains user-controlled and renders one credential pane", () => {
  assert.match(
    callsVoiceSection,
    /effectiveAuthMode:\s*VoiceProviderAuthMode\s*=\s*agentCallSettings\.voiceAuthMode\s*\?\?\s*autoAuthMode\(status\)/,
    "saved auth choice is not the source of truth",
  );
  assert.doesNotMatch(
    callsVoiceSection,
    /updateAgentCalls\(\{\s*voiceAuthMode:\s*"apikey"\s*\}\)/,
    "Calls UI still rewrites OAuth to API key after credential discovery",
  );
  assert.match(callsVoiceSection, /const oauthCapable = Boolean\(provider\.oauth\)/, "OAuth toggle is hidden despite a real OAuth connector");
  assert.doesNotMatch(callsVoiceSection, /oauthAvailableForBrain/, "OAuth and API-key panes can still render together");
  assert.doesNotMatch(callsVoiceSection, /Spoken turns fall back to the API key/, "OAuth pane still promises a hidden API-key fallback");
  assert.match(callsVoiceSection, /effectiveAuthMode === "oauth" && oauthConnected/, "connected OAuth pane is not mode-gated");
  assert.match(callsVoiceSection, /effectiveAuthMode === "apikey" && keyPresent/, "API-key pane is not mode-gated");
});

console.log(`\nqueen-voice preferences: ${passed} checks passed.`);
