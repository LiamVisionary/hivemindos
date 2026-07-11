import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { getXTranscriptJob, startXTranscriptJob } = await import(
  "../src/lib/services/x-transcript/x-transcript-job.ts"
);

const url = `https://x.com/test/status/${Date.now()}`;
const input = { request: {}, url, summarize: true };
const inspection = { kind: "video", canonicalUrl: url, durationSec: 975 };
const result = {
  kind: "video",
  url,
  canonicalUrl: url,
  tweetId: url.split("/").pop(),
  durationSec: 975,
  transcript: "Transcript text.",
  source: "test",
  warnings: [],
};

let runs = 0;
const first = startXTranscriptJob(input, inspection, async () => {
  runs += 1;
  return result;
});
await new Promise((resolve) => setImmediate(resolve));

const finished = getXTranscriptJob(first.id);
assert.equal(finished?.status, "succeeded");
assert.equal(finished?.result?.transcript, "Transcript text.");

const reconnected = startXTranscriptJob(input, inspection, async () => {
  runs += 1;
  return result;
});
assert.equal(reconnected.id, first.id, "a repeated command should reconnect to the recent completed job");
assert.equal(runs, 1, "reconnecting must not purchase a duplicate transcription");

console.log("test-x-transcript-job: completed transcript jobs are reconnectable without duplicate work");
