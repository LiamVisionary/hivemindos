#!/usr/bin/env node
import assert from "node:assert/strict";
import { realtimeTranscriptionFailureMessage } from "../src/features/queen-voice/realtime-transcription-event.ts";

const quotaMessage = "You exceeded your current quota.";

assert.equal(
  realtimeTranscriptionFailureMessage({
    type: "conversation.item.input_audio_transcription.failed",
    error: {
      type: "insufficient_quota",
      code: "insufficient_quota",
      message: quotaMessage,
    },
  }),
  quotaMessage,
  "a Realtime transcription failure must become an actionable turn error instead of a silent discard",
);

assert.equal(
  realtimeTranscriptionFailureMessage({
    type: "conversation.item.input_audio_transcription.completed",
    transcript: "hello",
  }),
  "",
  "successful transcription events are not failures",
);

console.log("Queen voice surfaces Realtime input-transcription failures.");
