#!/usr/bin/env node
// Unit coverage for the opt-in Queen Bee double-clap wake detector.
// The detector runs locally over Web Audio time-domain frames; this test keeps
// the signal logic pure and guards the overlay wiring that opens voice chat.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  QUEEN_CLAP_CREST_FACTOR_THRESHOLD,
  QUEEN_CLAP_DOUBLE_WINDOW_MS,
  QUEEN_CLAP_HIGH_FREQUENCY_RATIO_THRESHOLD,
  QUEEN_CLAP_HIGH_FREQUENCY_FLUX_THRESHOLD,
  QUEEN_CLAP_LISTENING_SETTLE_MS,
  QUEEN_CLAP_SPECTRAL_FLUX_THRESHOLD,
  QUEEN_CLAP_TRANSIENT_SHARPNESS_THRESHOLD,
  initialQueenClapDetectorState,
  measureFrequencyClapFrame,
  measureFloatTimeDomainClapFrame,
  measureTimeDomainClapFrame,
  nextQueenClapDetectorState,
} = await import("../src/features/queen-voice/clap-activation.ts");

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${label}`);
}

function quietFrame() {
  return new Uint8Array(512).fill(128);
}

function loudFrame() {
  const frame = new Uint8Array(512);
  for (let i = 0; i < frame.length; i += 1) frame[i] = i % 2 ? 0 : 255;
  return frame;
}

function pulse(state, nowMs) {
  return metrics(state, nowMs, 0.092, 0.72);
}

function quiet(state, nowMs) {
  return nextQueenClapDetectorState(state, {
    ...measureTimeDomainClapFrame(quietFrame()),
    nowMs,
  }).state;
}

function metrics(
  state,
  nowMs,
  rms,
  peak,
  highFrequencyRatio = 0.34,
  spectralFlux = 0.24,
  highFrequencyFlux = 0.16,
  crestFactor = 7.8,
  transientSharpness = 1.45,
) {
  return nextQueenClapDetectorState(state, {
    rms,
    peak,
    crestFactor,
    transientSharpness,
    highFrequencyRatio,
    spectralFlux,
    highFrequencyFlux,
    nowMs,
  });
}

function frequencyFrame(kind) {
  const frame = new Uint8Array(256);
  if (kind === "quiet") return frame;
  const start = kind === "high" ? 42 : 3;
  const end = kind === "high" ? frame.length : 32;
  for (let index = start; index < end; index += 1) frame[index] = 220;
  return frame;
}

check("time-domain metrics match quiet and sharp frames", () => {
  const quietMeasured = measureTimeDomainClapFrame(quietFrame());
  assert.equal(quietMeasured.rms, 0);
  assert.equal(quietMeasured.peak, 0);
  assert.equal(quietMeasured.crestFactor, 0);
  assert.equal(quietMeasured.transientSharpness, 0);
  const measured = measureTimeDomainClapFrame(loudFrame());
  assert.ok(measured.rms > 0.95, `expected loud RMS, got ${measured.rms}`);
  assert.ok(measured.peak > 0.99, `expected loud peak, got ${measured.peak}`);
  const floatMeasured = measureFloatTimeDomainClapFrame(
    Float32Array.from([0, 0.8, -0.8, 0.4, -0.4]),
  );
  assert.ok(floatMeasured.rms > 0.53, `expected float RMS, got ${floatMeasured.rms}`);
  assert.ok(Math.abs(floatMeasured.peak - 0.8) < 0.000001);
  const clapLike = new Float32Array(64);
  clapLike[8] = 0.9;
  clapLike[9] = -0.7;
  clapLike[10] = 0.4;
  clapLike[11] = -0.2;
  const clapLikeMeasured = measureFloatTimeDomainClapFrame(clapLike);
  assert.ok(
    clapLikeMeasured.crestFactor > QUEEN_CLAP_CREST_FACTOR_THRESHOLD,
    `expected clap-like crest factor, got ${clapLikeMeasured.crestFactor}`,
  );
  assert.ok(
    clapLikeMeasured.transientSharpness >
      QUEEN_CLAP_TRANSIENT_SHARPNESS_THRESHOLD,
    `expected clap-like sharpness, got ${clapLikeMeasured.transientSharpness}`,
  );
});

check("frequency metrics separate clap-like onsets from low thumps", () => {
  const previous = frequencyFrame("quiet");
  const high = measureFrequencyClapFrame(frequencyFrame("high"), 48_000, previous);
  const low = measureFrequencyClapFrame(frequencyFrame("low"), 48_000, previous);
  assert.ok(
    high.highFrequencyRatio > QUEEN_CLAP_HIGH_FREQUENCY_RATIO_THRESHOLD,
    `expected high-frequency clap-like ratio, got ${high.highFrequencyRatio}`,
  );
  assert.ok(
    high.spectralFlux > QUEEN_CLAP_SPECTRAL_FLUX_THRESHOLD,
    `expected spectral-flux onset, got ${high.spectralFlux}`,
  );
  assert.ok(
    high.highFrequencyFlux > QUEEN_CLAP_HIGH_FREQUENCY_FLUX_THRESHOLD,
    `expected high-frequency onset flux, got ${high.highFrequencyFlux}`,
  );
  assert.ok(
    low.highFrequencyRatio < QUEEN_CLAP_HIGH_FREQUENCY_RATIO_THRESHOLD,
    `expected low-frequency thump ratio, got ${low.highFrequencyRatio}`,
  );
  assert.ok(
    low.highFrequencyFlux < QUEEN_CLAP_HIGH_FREQUENCY_FLUX_THRESHOLD,
    `expected low high-frequency flux, got ${low.highFrequencyFlux}`,
  );
});

check("one clap arms the window but does not activate", () => {
  const result = pulse(initialQueenClapDetectorState, 1_000);
  assert.equal(result.activated, false);
  assert.equal(result.state.firstClapAt, 1_000);
});

check("two separated claps inside the quick window activate", () => {
  let state = pulse(initialQueenClapDetectorState, 1_000).state;
  state = quiet(state, 1_080);
  const result = pulse(state, 1_260);
  assert.equal(result.activated, true);
  assert.equal(result.state.firstClapAt, 0);
});

check("lower-RMS real-world clap pulses still activate above room noise", () => {
  let state = initialQueenClapDetectorState;
  for (let now = 900; now <= 990; now += 30) {
    state = metrics(state, now, 0.035, 0.12).state;
  }
  state = metrics(state, 1_000, 0.092, 0.72).state;
  state = metrics(state, 1_090, 0.044, 0.16).state;
  const result = metrics(state, 1_245, 0.088, 0.69);
  assert.equal(result.activated, true);
});

check("quick second clap can re-arm after a partial clap-tail decay", () => {
  let state = metrics(initialQueenClapDetectorState, 1_000, 0.11, 0.74).state;
  state = metrics(state, 1_080, 0.071, 0.22, 0.22, 0.01, 0.006).state;
  const result = metrics(state, 1_220, 0.105, 0.71);
  assert.equal(result.activated, true);
});

check("low-frequency thumps do not activate clap wake", () => {
  let state = metrics(initialQueenClapDetectorState, 1_000, 0.16, 0.82, 0.04, 0.22, 0.006).state;
  state = metrics(state, 1_120, 0.055, 0.18, 0.03, 0.01, 0.002).state;
  const result = metrics(state, 1_270, 0.15, 0.8, 0.04, 0.2, 0.005);
  assert.equal(result.activated, false);
});

check("speech-like plosive onsets do not activate clap wake", () => {
  let state = metrics(
    initialQueenClapDetectorState,
    1_000,
    0.14,
    0.6,
    0.32,
    0.22,
    0.14,
    3.2,
    0.74,
  ).state;
  state = metrics(state, 1_120, 0.035, 0.12, 0.18, 0.01, 0.004, 2.4, 0.52).state;
  const result = metrics(
    state,
    1_290,
    0.13,
    0.58,
    0.31,
    0.21,
    0.13,
    3.1,
    0.78,
  );
  assert.equal(result.activated, false);
});

check("mismatched click pairs do not activate clap wake", () => {
  let state = metrics(initialQueenClapDetectorState, 1_000, 0.1, 0.95).state;
  state = quiet(state, 1_120);
  const result = metrics(state, 1_280, 0.068, 0.42, 0.34, 0.18, 0.12);
  assert.equal(result.activated, false);
});

check("steady loud audio without fresh spectral flux does not activate", () => {
  let state = metrics(initialQueenClapDetectorState, 1_000, 0.13, 0.8).state;
  state = metrics(state, 1_090, 0.042, 0.2, 0.3, 0.006, 0.003).state;
  const result = metrics(state, 1_250, 0.13, 0.8, 0.34, 0.006, 0.003);
  assert.equal(result.activated, false);
});

check("a slow second clap starts a new window instead of activating", () => {
  let state = pulse(initialQueenClapDetectorState, 1_000).state;
  state = quiet(state, 1_100);
  const result = pulse(state, 1_000 + QUEEN_CLAP_DOUBLE_WINDOW_MS + 40);
  assert.equal(result.activated, false);
  assert.equal(result.state.firstClapAt, 1_000 + QUEEN_CLAP_DOUBLE_WINDOW_MS + 40);
});

check("sustained loud frames are not counted as multiple claps", () => {
  const first = pulse(initialQueenClapDetectorState, 1_000);
  const second = metrics(first.state, 1_260, 0.96, 0.99, 0.34, 0.003, 0.001);
  assert.equal(first.activated, false);
  assert.equal(second.activated, false);
});

// --- Cross-file wiring contracts -------------------------------------------
const ROOT = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), "utf8");
const dashboard = read("src/features/dashboard/DashboardApp.tsx");
const overlay = read("src/features/queen-voice/QueenBeeVoiceOverlay.tsx");
const hook = read("src/features/queen-voice/use-queen-clap-activation.ts");
const realtimeHook = read("src/features/queen-voice/use-queen-bee-realtime.ts");
const pipelineHook = read("src/features/queen-voice/use-queen-bee-voice.ts");
const settingsModal = read("src/features/dashboard/views/chat/AgentSettingsModal.tsx");
const callsPanel = read("src/features/dashboard/views/chat/AgentCallsSettingsPanel.tsx");
const pkg = read("package.json");

check("dashboard owns and persists opt-in clap wake state", () => {
  assert.match(dashboard, /QUEEN_CLAP_WAKE_STORAGE_KEY/);
  assert.match(dashboard, /queenClapWakeEnabled/);
  assert.match(dashboard, /setQueenClapWakeEnabled\(readStoredValue\(dashboardState,\s*QUEEN_CLAP_WAKE_STORAGE_KEY\) === "1"\)/);
  assert.match(dashboard, /persistDashboardStateValue\(QUEEN_CLAP_WAKE_STORAGE_KEY,\s*enabled \? "1" : "0"\)/);
  assert.match(dashboard, /clapWakeEnabled=\{queenClapWakeEnabled\}/);
  assert.match(dashboard, /onClapWakeEnabledChange=\{updateQueenClapWakeEnabled\}/);
  assert.doesNotMatch(overlay, /saveDashboardStateValue/);
});

check("clap activation opens the existing Queen voice overlay path", () => {
  assert.match(overlay, /useQueenClapActivation/);
  assert.match(overlay, /onActivation:\s*openQueenVoiceChat/);
  assert.match(overlay, /paused:\s*open/);
});

check("Queen Bee Calls settings expose the same Clap wake toggle", () => {
  assert.match(settingsModal, /queenClapWakeEnabled/);
  assert.match(settingsModal, /onQueenClapWakeEnabledChange/);
  assert.match(callsPanel, /roleModalAgent\?\.beeRole === "queen"/);
  assert.match(callsPanel, /Clap wake/);
  assert.match(callsPanel, /onQueenClapWakeEnabledChange\(event\.target\.checked\)/);
});

check("Queen Bee starts each voice session with one opening line", () => {
  assert.match(overlay, /QUEEN_VOICE_OPENING_LINE/);
  assert.match(overlay, /useQueenBeeRealtime\([\s\S]*QUEEN_VOICE_OPENING_LINE/);
  assert.match(overlay, /useQueenBeeVoice\([\s\S]*QUEEN_VOICE_OPENING_LINE/);
  assert.match(realtimeHook, /openingLine = ""/);
  assert.match(realtimeHook, /response:\s*\{\s*instructions\s*\}/);
  assert.match(realtimeHook, /JSON\.stringify\(openingText\)/);
  assert.match(pipelineHook, /addTurn\("queen", openingText\)/);
  assert.match(pipelineHook, /history\.push\(\{ who: "queen", text: openingText \}\)/);
  assert.match(pipelineHook, /playSpokenReply\(openingText/);
});

check("clap hook stays local and tears down the microphone stream", () => {
  assert.match(hook, /getUserMedia/);
  assert.match(hook, /createScriptProcessor/);
  assert.match(hook, /onaudioprocess/);
  assert.ok(QUEEN_CLAP_LISTENING_SETTLE_MS >= 500);
  assert.match(hook, /QUEEN_CLAP_LISTENING_SETTLE_MS/);
  assert.match(hook, /nowMs < detectorReadyAt/);
  assert.match(hook, /track\.stop\(\)/);
  assert.doesNotMatch(hook, /fetch\(/);
});

check("package script exposes the regression test", () => {
  assert.match(pkg, /"test:queen-clap":\s*"node scripts\/test-queen-clap-activation\.mjs"/);
});

console.log(`\nqueen clap activation: ${passed} checks passed.`);
