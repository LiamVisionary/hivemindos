import { register } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const media = await import("../src/lib/services/x-transcript/media-transcribe.ts");

assert.equal(
  typeof media.parseWebVttTranscript,
  "function",
  "X transcripts should expose a reusable WebVTT-to-transcript parser",
);

const transcript = media.parseWebVttTranscript(`WEBVTT

00:00:00.000 --> 00:00:02.000
<c>Most people are</c>

00:00:02.000 --> 00:00:04.000
<c>Most people are overcomplicating it.</c>

00:00:05.500 --> 00:00:06.500
AI &amp; agents can use tools.

00:00:06.500 --> 00:00:07.500
They work well.
`);
assert.equal(
  transcript,
  "Most people are overcomplicating it.\n\nAI & agents can use tools. They work well.",
  "rolling captions should become clean paragraphs without duplicated prefixes",
);

const inferredPunctuation = media.parseWebVttTranscript(`WEBVTT

00:00:00.000 --> 00:00:01.000
The model can call a tool

00:00:01.800 --> 00:00:02.800
Then it reads the result
`);
assert.equal(
  inferredPunctuation,
  "The model can call a tool. Then it reads the result.",
  "caption timing pauses should restore missing sentence punctuation",
);

const lowercaseContinuation = media.parseWebVttTranscript(`WEBVTT

00:00:00.000 --> 00:00:01.000
what is this times

00:00:02.400 --> 00:00:03.000
this?
`);
assert.equal(
  lowercaseContinuation,
  "what is this times this?",
  "a lowercase cue should remain attached across a visual or thinking pause",
);

const longUnpunctuatedVtt = ["WEBVTT", ...Array.from({ length: 24 }, (_, index) => [
  `00:00:${String(index).padStart(2, "0")}.000 --> 00:00:${String(index).padStart(2, "0")}.900`,
  `This caption segment ${index} keeps the same spoken thought moving without source punctuation`,
].join("\n"))].join("\n\n");
const boundedTranscript = media.parseWebVttTranscript(longUnpunctuatedVtt);
assert.ok(
  boundedTranscript.includes("\n\n"),
  "long unpunctuated captions should still be divided into paragraphs",
);
assert.ok(
  Math.max(...boundedTranscript.split(/\n\n+/).map((paragraph) => paragraph.length)) < 900,
  "a generated transcript paragraph should stay below 900 characters",
);

const connectorBoundaryVtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
${"A detailed explanation keeps building context ".repeat(8)}to

00:00:01.000 --> 00:00:02.000
use tools effectively
`;
assert.doesNotMatch(
  media.parseWebVttTranscript(connectorBoundaryVtt),
  /\bto\. use\b/i,
  "length-based sentence boundaries must not split after connector words",
);

assert.equal(
  typeof media.chooseXTranscriptionProvider,
  "function",
  "uncaptioned X videos should use one explicit transcription-provider policy",
);
assert.equal(
  media.chooseXTranscriptionProvider({
    customWhisperConfigured: false,
    elevenLabsConfigured: true,
    openAiConfigured: true,
  }),
  "elevenlabs",
  "ElevenLabs must win over the generic OpenAI key when both are configured",
);
assert.equal(
  media.chooseXTranscriptionProvider({
    customWhisperConfigured: true,
    elevenLabsConfigured: true,
    openAiConfigured: true,
  }),
  "whisper-compatible",
  "an explicitly configured Whisper-compatible endpoint must remain first",
);

const serviceSource = readFileSync(
  new URL("../src/lib/services/x-transcript/x-transcript-service.ts", import.meta.url),
  "utf8",
);
assert.match(
  serviceSource,
  /probe\.hasEnglishCaptions[\s\S]*downloadXCaptions[\s\S]*downloadXAudio/,
  "existing English captions must be consumed before downloading audio for STT",
);
assert.doesNotMatch(
  serviceSource,
  /source: .*whisper/,
  "X transcript source labels must not claim Whisper when ElevenLabs may be selected",
);

console.log("X transcript caption-first contract ok");
