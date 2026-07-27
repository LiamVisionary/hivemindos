import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { getXTranscriptJob, startXTranscriptJob, xTranscriptJobCacheKey } = await import(
  "../src/lib/services/x-transcript/x-transcript-job.ts"
);

const url = `https://x.com/test/status/${Date.now()}`;
const input = { request: {}, url, summarize: true, threadId: "thread-a" };
assert.notEqual(
  xTranscriptJobCacheKey(input, "caption-format-v1"),
  xTranscriptJobCacheKey(input, "caption-format-v2"),
  "a transcript pipeline upgrade must invalidate cached output within the same thread",
);
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

const otherThread = startXTranscriptJob({ ...input, threadId: "thread-b" }, inspection, async () => {
  runs += 1;
  return result;
});
assert.notEqual(
  otherThread.id,
  first.id,
  "the same transcript URL in a different chat thread must receive an isolated job",
);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(runs, 2, "a different chat thread must execute its own transcript job");

const degradedUrl = `https://x.com/test/status/degraded-${Date.now()}`;
const degradedInput = { request: {}, url: degradedUrl, summarize: true };
const degradedResult = {
  ...result,
  kind: "single",
  url: degradedUrl,
  canonicalUrl: degradedUrl,
  tweetId: degradedUrl.split("/").pop(),
  transcript: "Only the post text.",
  source: "x-api thread",
  warnings: ["Authenticated X video transcription failed: quota unavailable."],
};
let degradedRuns = 0;
const degraded = startXTranscriptJob(degradedInput, inspection, async () => {
  degradedRuns += 1;
  return degradedResult;
});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(getXTranscriptJob(degraded.id)?.status, "succeeded");

const retriedDegraded = startXTranscriptJob(degradedInput, inspection, async () => {
  degradedRuns += 1;
  return { ...result, url: degradedUrl, canonicalUrl: degradedUrl };
});
assert.notEqual(
  retriedDegraded.id,
  degraded.id,
  "a detected video must not reuse a cached post-text fallback after transcription failed",
);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(degradedRuns, 2, "retrying a degraded video result must execute the current pipeline");

console.log("test-x-transcript-job: completed transcript jobs are reconnectable without duplicate work");
