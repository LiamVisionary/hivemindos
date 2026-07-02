#!/usr/bin/env node
// Unit coverage for Queen Bee's durable voice-preference logic - the layer
// that makes "call me boss" survive closing and reopening the voice overlay.
// Exercises the pure core (parse/normalize/dedupe/cap/append/format); the
// dashboard-state persistence wrapper is a thin read-modify-write over it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  MAX_VOICE_PREFERENCES,
  appendVoicePreference,
  formatVoicePreferencePreamble,
  normalizeVoicePreferences,
  parseVoicePreferences,
  serializeVoicePreferences,
} = await import("../src/lib/services/queen-bee/voice-preferences-core.ts");

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${label}`);
}

check("empty/garbage parses to no preferences", () => {
  assert.deepEqual(parseVoicePreferences(undefined), []);
  assert.deepEqual(parseVoicePreferences(null), []);
  assert.deepEqual(parseVoicePreferences(""), []);
  assert.deepEqual(parseVoicePreferences("not json"), []);
  assert.deepEqual(parseVoicePreferences('{"not":"an array"}'), []);
});

check("a stated preference is captured and round-trips through storage", () => {
  const list = appendVoicePreference([], 'Address the user as "boss".');
  assert.deepEqual(list, ['Address the user as "boss".']);
  const reread = parseVoicePreferences(serializeVoicePreferences(list));
  assert.deepEqual(reread, list);
});

check("the preamble names the preference, and is empty when none", () => {
  assert.equal(formatVoicePreferencePreamble([]), "");
  const preamble = formatVoicePreferencePreamble([
    'Address the user as "boss".',
  ]);
  assert.match(preamble, /boss/);
  assert.match(preamble, /always honor these/i);
});

check("duplicates are deduped case-insensitively, not stacked", () => {
  let list = appendVoicePreference([], "Reply in Spanish.");
  list = appendVoicePreference(list, "reply in spanish.");
  assert.equal(list.length, 1);
});

check("a repeat moves to the end and the latest wording wins", () => {
  let list = ["Keep replies short.", 'Address the user as "boss".'];
  list = appendVoicePreference(list, "keep replies SHORT.");
  // The earlier entry is dropped, the freshest wording is kept, and it lands
  // last so a later-conflicting preference reads as the most recent.
  assert.deepEqual(list, [
    'Address the user as "boss".',
    "keep replies SHORT.",
  ]);
});

check("whitespace is collapsed and blanks are dropped", () => {
  assert.deepEqual(
    normalizeVoicePreferences(["  Speak\n  slowly. ", "", "   "]),
    ["Speak slowly."],
  );
  assert.deepEqual(appendVoicePreference(["keep"], "   "), ["keep"]);
});

check("the list is capped to the most recent MAX_VOICE_PREFERENCES", () => {
  let list = [];
  for (let i = 0; i < MAX_VOICE_PREFERENCES + 5; i += 1) {
    list = appendVoicePreference(list, `Preference number ${i}.`);
  }
  assert.equal(list.length, MAX_VOICE_PREFERENCES);
  // Oldest aged out, newest retained.
  assert.ok(!list.includes("Preference number 0."));
  assert.ok(list.includes(`Preference number ${MAX_VOICE_PREFERENCES + 4}.`));
});

check("non-string entries in stored JSON are ignored", () => {
  assert.deepEqual(
    parseVoicePreferences(JSON.stringify(["Speak up.", 42, null, { a: 1 }])),
    ["Speak up."],
  );
});

// --- Cross-file wiring contracts -------------------------------------------
// The checks above prove the store LOGIC. These prove the WIRING that the
// logic depends on but which a pure-logic test can't see: the realtime tool
// name, the HTTP action string shared by client and server, the storage key,
// and that the minted realtime session returns the preference-augmented
// instructions (not the bare constant). A regression in any of these would
// silently pass every check above while breaking "call me boss" in practice.
const ROOT = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), "utf8");
const route = read("src/app/api/queen-bee/voice/route.ts");
const hook = read("src/features/queen-voice/use-queen-bee-realtime.ts");
const turn = read("src/lib/services/queen-bee/voice-turn.ts");
// The realtime tool declaration moved out of the route into the shared voice
// tool bundle (also used by phone calls) — pin it there instead.
const toolBundles = read("src/lib/services/phone/voice-tool-bundles.ts");

check("CAPTURE: the realtime tool is declared, dispatched, and POSTed by one name", () => {
  assert.match(toolBundles, /name:\s*"remember_preference"/, "tool not declared in the shared voice tool bundle");
  assert.match(hook, /call\.name === "remember_preference"/, "dispatch branch missing");
  assert.match(hook, /action:\s*"remember-preference"/, "client POST action missing");
  assert.match(route, /body\.action === "remember-preference"/, "server action handler missing");
  assert.match(route, /addQueenBeeVoicePreference\(/, "server handler does not persist");
});

check("INJECT: the minted realtime session carries the preference preamble", () => {
  assert.match(route, /queenVoicePreferencePreamble\(/, "mint never reads stored preferences");
  // The pre-fix bug shape returned/sent the bare constant; guard against its return.
  assert.doesNotMatch(
    route,
    /instructions:\s*QUEEN_REALTIME_INSTRUCTIONS/,
    "realtime instructions must be the augmented variable, not the bare constant",
  );
});

check("INJECT: the fallback + relay paths thread the preamble into the prompt", () => {
  assert.match(turn, /queenVoicePreferencePreamble\(/, "fallback never reads stored preferences");
  assert.match(
    turn,
    /conversationMessages\(transcript, history, systemPreamble\)/,
    "system preamble not threaded into conversationMessages",
  );
});

console.log(`\nqueen-voice preferences: ${passed} checks passed.`);
