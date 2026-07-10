#!/usr/bin/env node
// Hermetic unit test for the pure telemetry line filter that backs deleting a
// chat thread's telemetry. Only exercises telemetryLinesWithoutThread with
// in-memory strings — never touches ~/.hivemindos/telemetry/events.jsonl.
import assert from "node:assert/strict";

const { telemetryLinesWithoutThread } = await import("../src/lib/services/telemetry/local-telemetry.ts");

const KEY = "hermes-scout-a55e2a::folder-abc";
const OTHER = "hermes-scout-a55e2a::folder-xyz";

function line(overrides) {
  return JSON.stringify({
    id: "abc-0-def",
    ts: 1000,
    source: "route",
    type: "chat.turn",
    threadId: null,
    runId: null,
    payload: {},
    ...overrides,
  });
}

// --- Rows for the deleted thread go; every other row stays -----------------
const raw = [
  line({ threadId: KEY, type: "chat.start" }),
  line({ threadId: OTHER, type: "chat.start" }),
  line({ threadId: KEY, type: "chat.finish" }),
  line({ threadId: null, type: "boot" }),
].join("\n") + "\n";

const purged = telemetryLinesWithoutThread(raw, KEY);
assert.equal(purged.removed, 2);
const keptEvents = purged.contents.split("\n").filter(Boolean).map((entry) => JSON.parse(entry));
assert.equal(keptEvents.length, 2);
assert.deepEqual(keptEvents.map((event) => event.threadId), [OTHER, null]);
// Trailing newline preserved so the log stays append-safe.
assert.equal(purged.contents.endsWith("\n"), true);

// --- A thread with no rows leaves the log byte-identical --------------------
const untouched = telemetryLinesWithoutThread(raw, "thread-that-never-existed");
assert.equal(untouched.removed, 0);
assert.equal(untouched.contents, raw);

// --- Unparseable rows are KEPT, never silently discarded --------------------
const corrupt = [line({ threadId: KEY }), "{not json", line({ threadId: OTHER })].join("\n") + "\n";
const survived = telemetryLinesWithoutThread(corrupt, KEY);
assert.equal(survived.removed, 1);
assert.equal(survived.contents.includes("{not json"), true);

// --- Purging the only rows empties the file rather than leaving a bare \n ---
const soleThread = line({ threadId: KEY }) + "\n";
const emptied = telemetryLinesWithoutThread(soleThread, KEY);
assert.equal(emptied.removed, 1);
assert.equal(emptied.contents, "");

// --- threadId match is exact, not a prefix/substring ------------------------
const prefixes = [line({ threadId: KEY }), line({ threadId: `${KEY}-suffix` })].join("\n") + "\n";
const exact = telemetryLinesWithoutThread(prefixes, KEY);
assert.equal(exact.removed, 1);
assert.equal(JSON.parse(exact.contents.trim()).threadId, `${KEY}-suffix`);

console.log("chat thread telemetry delete checks passed");
