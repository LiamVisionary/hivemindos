#!/usr/bin/env node
import assert from "node:assert/strict";
import { inputTranscriptionForVoiceRuntime } from "../src/lib/config/voice-call-providers.ts";

assert.deepEqual(
  inputTranscriptionForVoiceRuntime("elevenlabs-tts"),
  {
    mode: "recorded",
    providerId: "elevenlabs",
    model: "scribe_v2",
  },
  "an ElevenLabs pipeline voice should use ElevenLabs Scribe for microphone transcription",
);

assert.equal(
  inputTranscriptionForVoiceRuntime("openai-tts"),
  null,
  "voice runtimes without a dedicated STT transport should keep the realtime/default transcription path",
);

console.log("Queen voice input transcription follows the selected voice provider capability.");
