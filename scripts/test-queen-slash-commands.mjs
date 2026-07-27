import { register } from "node:module";
import assert from "node:assert/strict";

// Native TS type-stripping + `@/` alias via the shared loader, then dynamic
// import the pure classifier. Run: node scripts/test-queen-slash-commands.mjs
//
// Guards the general slash-command router for the "Ask the hive" pill: EVERY
// "/command" is recognized and routed (transcript / dashboard-drive / clear /
// help / honest-cli / honest-unknown) instead of being forwarded to the Queen
// as conversation. A regression here reintroduces "I can't fetch that directly".
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { classifyQueenSlashCommand, dispatchQueenSlashCommand } = await import("../src/features/queen-voice/queen-slash-commands.ts");

// Plain text is not a command → the caller runs the normal Queen turn.
for (const text of ["hello", "what's up", "open the work board please", "  ", "", "/", "/ notacommand"]) {
  assert.equal(classifyQueenSlashCommand(text).kind, "none", `not a command: ${JSON.stringify(text)}`);
}

// /transcript → transcript route with the parsed url (empty when none given).
const t1 = classifyQueenSlashCommand("/transcript https://x.com/u/status/1780000000000000001");
assert.equal(t1.kind, "transcript");
assert.equal(t1.url, "https://x.com/u/status/1780000000000000001");
assert.equal(classifyQueenSlashCommand("/transcript").kind, "transcript");
assert.equal(classifyQueenSlashCommand("/transcript").url, "", "bare /transcript prompts for a link");

// Dashboard commands → dashboard route with a natural-language intent for Bee Pilot.
const work = classifyQueenSlashCommand("/work");
assert.equal(work.kind, "dashboard");
assert.equal(work.command.name, "work");
assert.match(work.intent, /work board/i, "intent describes the action");
const note = classifyQueenSlashCommand("/note buy oat milk");
assert.equal(note.kind, "dashboard");
assert.equal(note.intent, "Save a note to the shared brain: buy oat milk", "args fold into the intent");
// aliases resolve (kanban → work board command)
assert.equal(classifyQueenSlashCommand("/kanban").kind, "dashboard");
assert.equal(classifyQueenSlashCommand("/image-gen a honeycomb city").kind, "dashboard");

// Session-local commands.
for (const c of ["/clear", "/new", "/reset"]) assert.equal(classifyQueenSlashCommand(c).kind, "clear", c);
assert.equal(classifyQueenSlashCommand("/help").kind, "help");

// Known Hermes/CLI commands that don't apply to the pill → honest "cli" (not conversational).
const model = classifyQueenSlashCommand("/model gpt-5");
assert.equal(model.kind, "cli");
assert.equal(model.name, "model");
assert.ok(model.description, "carries the command description for an honest reply");
assert.equal(classifyQueenSlashCommand("/goal ship it").kind, "cli");

// Unknown slash → honest "unknown", never forwarded to the Queen as chat.
const unknown = classifyQueenSlashCommand("/definitelynotacommand");
assert.equal(unknown.kind, "unknown");
assert.equal(unknown.name, "definitelynotacommand");

// A long video is inspected before transcription so the Queen can set an
// honest expectation while the expensive request is still running.
const fetchCalls = [];
const events = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  fetchCalls.push({ url: String(url), method: init?.method ?? "GET", body });
  if (body.action === "start") {
    events.push("fetch:start");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        jobId: "transcript-job-1",
        inspection: {
          kind: "video",
          canonicalUrl: "https://x.com/Bencera/status/2075608615986302981",
          durationSec: 975.307,
          title: "The Rise",
        },
      }),
    };
  }
  events.push("fetch:status");
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      job: {
        id: "transcript-job-1",
        status: "succeeded",
        result: {
          kind: "video",
          url: "https://x.com/Bencera/status/2075608615986302981",
          canonicalUrl: "https://x.com/Bencera/status/2075608615986302981",
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
};

const turns = [];
const updates = [];
try {
  const handled = await dispatchQueenSlashCommand(
    "/transcript https://x.com/Bencera/status/2075608615986302981",
    {
      appendTurn: (turn) => {
        const id = `turn-${turns.length + 1}`;
        turns.push({ id, ...turn });
        return id;
      },
      updateTurn: (id, patch) => {
        updates.push({ id, patch });
        if (typeof patch.text === "string" && patch.pending === true) events.push("update:expectation");
      },
      clear: () => {},
    },
  );
  assert.equal(handled, true);
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(fetchCalls.length, 2, "long transcript flow should start a background job, then read its status");
assert.equal(fetchCalls[0].body.action, "start", "the first request should return a job id and media inspection quickly");
assert.equal(fetchCalls[0].body.summarize, true, "the background job should produce a summarized transcript");
assert.match(fetchCalls[1].url, /\?jobId=transcript-job-1$/, "the second request should poll the detached job");
assert.deepEqual(
  events.slice(0, 3),
  ["fetch:start", "update:expectation", "fetch:status"],
  "Queen should tell the user the expected wait before polling the long request",
);
const expectation = updates.find(({ patch }) => patch.pending === true && typeof patch.text === "string")?.patch.text ?? "";
assert.match(expectation, /16 minutes/i, "expectation should include the rounded video length");
assert.match(expectation, /few minutes/i, "expectation should warn that a long video can take a few minutes");

console.log("test-queen-slash-commands: all assertions passed");
