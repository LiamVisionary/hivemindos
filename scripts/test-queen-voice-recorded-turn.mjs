#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { voiceRouteFailureMessage } from "../src/features/queen-voice/converse-stream.ts";
import { runRecordedVoiceTurn } from "../src/features/queen-voice/recorded-turn.ts";
import { elevenLabsTranscriptText } from "../src/lib/services/phone/elevenlabs-stt-response.ts";

assert.equal(
  elevenLabsTranscriptText({ text: "   " }),
  "",
  "a successful ElevenLabs no-speech response should remain an empty transcript instead of throwing",
);
assert.equal(elevenLabsTranscriptText({ text: "  What's new?  " }), "What's new?");

assert.match(
  voiceRouteFailureMessage(new DOMException("The operation timed out", "TimeoutError")),
  /timed out/i,
  "voice-route timeouts should be reported honestly instead of as generic reachability failures",
);

const voiceTurnSource = readFileSync(
  new URL("../src/lib/services/queen-bee/voice-turn.ts", import.meta.url),
  "utf8",
);
const providerTurnStart = voiceTurnSource.indexOf("async function runProviderConversationTurn(");
const providerTurnSource = voiceTurnSource.slice(
  providerTurnStart,
  voiceTurnSource.indexOf("// Minimal OpenAI chat-completions SSE reader", providerTurnStart),
);
assert.match(
  providerTurnSource,
  /const providerTurnSignal = AbortSignal\.timeout\(OPENAI_TURN_TIMEOUT_MS\)/,
  "one total deadline should cover the provider's complete multi-round voice turn",
);
assert.match(
  providerTurnSource,
  /signal: providerTurnSignal/,
  "every provider request in one turn should reuse the total turn deadline",
);

const originalFetch = globalThis.fetch;

try {
  const calls = [];
  globalThis.fetch = async () => new Response(
    JSON.stringify({ ok: true, transcript: "", noSpeech: true }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

  await runRecordedVoiceTurn(new Blob(["quiet-room"], { type: "audio/webm" }), {
    abortSignal: new AbortController().signal,
    isCancelled: () => false,
    mimeType: "audio/webm",
    utteranceFileName: () => "utterance.webm",
    setPhase: (phase) => calls.push(["phase", phase]),
    setSpeechDetected: (detected) => calls.push(["speech", detected]),
    addTurn: () => 7,
    updateTurn: (...args) => calls.push(["update", ...args]),
    dropTurn: (id) => calls.push(["drop", id]),
    failTurn: (message) => calls.push(["fail", message]),
    resumeListening: () => calls.push(["resume"]),
    runConverseTurn: (transcript) => {
      calls.push(["converse", transcript]);
      return Promise.resolve();
    },
  });

  assert.deepEqual(
    calls.filter(([kind]) => ["drop", "resume", "fail", "converse"].includes(kind)),
    [["drop", 7], ["resume"]],
    "a successful no-speech transcription should quietly remove the placeholder and resume listening",
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Queen recorded turns ignore successful no-speech transcripts.");
