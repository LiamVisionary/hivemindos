import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { extractTranscriptCard } = await import("../src/features/dashboard/chat-transcript-card.ts");
const { handleTranscriptCommand } = await import("../src/features/dashboard/hooks/status-chat-transcript.ts");

const url = "https://x.com/Bencera/status/2075608615986302981";
const storageKey = "hermesscout::general";
let stored = { [storageKey]: [] };
let preview = { agentId: "hermesscout", leafKey: "general", messages: [] };
const snapshots = [];
const calls = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (target, init) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  calls.push({ target: String(target), body, method: init?.method ?? "GET" });
  if (body.action === "start") {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        jobId: "job-bencera",
        inspection: { kind: "video", canonicalUrl: url, durationSec: 975.307, title: "The Rise" },
      }),
    };
  }
  if ((init?.method ?? "GET") === "GET") {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        job: {
          id: "job-bencera",
          status: "succeeded",
          result: {
            kind: "video",
            url,
            canonicalUrl: url,
            tweetId: "2075608615986302981",
            durationSec: 975.307,
            transcript: "Transcript text.",
            source: "yt-dlp + whisper",
            summary: "A concise summary.",
            followUpQuestion: "What will you apply?",
            warnings: [],
          },
        },
      }),
    };
  }
  // The old synchronous implementation lands here and therefore remains a
  // valid response; the assertions below fail specifically because it did not
  // start/poll a reconnectable job.
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      result: {
        kind: "video",
        url,
        canonicalUrl: url,
        tweetId: "2075608615986302981",
        durationSec: 975.307,
        transcript: "Legacy synchronous transcript.",
        source: "legacy",
        warnings: [],
      },
    }),
  };
};

try {
  const handled = await handleTranscriptCommand({
    rawPrompt: `/transcript ${url}`,
    selectedAgent: { id: "hermesscout" },
    selectedChatLeafKey: "general",
    selectedStorageKey: storageKey,
    chatAutoScrollRef: { current: false },
    clearChatComposerDraft: () => {},
    appendMessage: (_agentId, message, key = storageKey) => {
      stored = { ...stored, [key]: [...(stored[key] ?? []), message] };
    },
    appendPreviewMessages: (_agentId, _leafKey, messages) => {
      preview = { ...preview, messages: [...preview.messages, ...messages] };
    },
    setMessagesByAgent: (updater) => {
      stored = updater(stored);
      snapshots.push(stored[storageKey].map((message) => message.content));
    },
    setSelectedChatPreview: (updater) => {
      preview = updater(preview);
    },
  });
  assert.equal(handled, true);
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(calls[0].body.action, "start", "Chat should start a detached transcript job");
assert.match(calls[1].target, /\?jobId=job-bencera$/, "Chat should poll the detached job status");
const reconnectableSnapshot = snapshots
  .flat()
  .map((content) => typeof content === "string" ? extractTranscriptCard(content) : null)
  .find((parsed) => parsed?.card.status === "running" && parsed.card.jobId === "job-bencera");
assert.ok(reconnectableSnapshot, "the persisted running card should carry the job id before polling");
const finalAssistant = stored[storageKey]
  .map((message) => typeof message.content === "string" ? extractTranscriptCard(message.content) : null)
  .find((parsed) => parsed?.card.status === "ready");
assert.equal(finalAssistant?.card.transcript, "Transcript text.");
assert.match(finalAssistant?.remainingText ?? "", /concise summary/i);

console.log("test-status-chat-transcript-job: Chat starts, persists, and polls a reconnectable transcript job");
