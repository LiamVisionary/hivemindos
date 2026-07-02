#!/usr/bin/env node
// Hermetic coverage for the Queen voice "working" turn surfaces:
// - per-turn progress store (begin/mark/dedupe/finish/read + id normalization)
// - the flattened runtime voice prompt (history + anti-re-greeting contract)
// - tool-activity labels parsed from runtime SSE payloads
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  beginVoiceTurnProgress,
  finishVoiceTurnProgress,
  markVoiceTurnStage,
  normalizeVoiceTurnId,
  readVoiceTurnProgress,
  resetVoiceTurnProgressForTests,
} = await import("../src/lib/services/queen-bee/voice-turn-progress.ts");
const { buildRuntimeVoiceUserText } = await import("../src/lib/services/queen-bee/voice-turn.ts");
const { toolActivityLabel } = await import("../src/lib/services/phone/runtime-voice-turn.ts");

// --- turn id normalization ----------------------------------------------------
{
  assert.equal(normalizeVoiceTurnId("voice-abc123-x9"), "voice-abc123-x9");
  assert.equal(normalizeVoiceTurnId("  voice-1  "), "voice-1");
  assert.equal(normalizeVoiceTurnId("no spaces allowed"), "", "spaces rejected");
  assert.equal(normalizeVoiceTurnId("abc"), "", "too short rejected");
  assert.equal(normalizeVoiceTurnId("x".repeat(81)), "", "too long rejected");
  assert.equal(normalizeVoiceTurnId(42), "", "non-strings rejected");
  console.log("turn id normalization ok");
}

// --- progress store lifecycle --------------------------------------------------
{
  resetVoiceTurnProgressForTests();
  assert.deepEqual(readVoiceTurnProgress("voice-unknown"), {
    known: false,
    finished: false,
    stages: [],
  });

  beginVoiceTurnProgress("voice-t1");
  markVoiceTurnStage("voice-t1", "Thinking with HermesMain");
  markVoiceTurnStage("voice-t1", "Thinking with HermesMain"); // duplicate collapses
  markVoiceTurnStage("voice-t1", "Using run_command");
  let progress = readVoiceTurnProgress("voice-t1");
  assert.equal(progress.known, true);
  assert.equal(progress.finished, false);
  assert.deepEqual(
    progress.stages.map((stage) => stage.label),
    ["Thinking with HermesMain", "Using run_command"],
  );
  assert.equal(progress.stages[0].done, true, "a new stage marks the previous done");
  assert.equal(progress.stages[1].done, false, "latest stage is live");

  finishVoiceTurnProgress("voice-t1");
  progress = readVoiceTurnProgress("voice-t1");
  assert.equal(progress.finished, true);
  assert.ok(progress.stages.every((stage) => stage.done), "finish marks all stages done");

  markVoiceTurnStage("voice-t1", "Late stage after finish");
  assert.equal(
    readVoiceTurnProgress("voice-t1").stages.length,
    2,
    "stages after finish are ignored",
  );
  console.log("progress store lifecycle ok");
}

// --- flattened runtime prompt ---------------------------------------------------
{
  const history = [
    { who: "queen", text: "Hey Liam, I'm here. What should we work on first?" },
    { who: "you", text: "What do you think?" },
  ];
  const prompt = buildRuntimeVoiceUserText("Sure", history, "Call the user boss.");
  assert.ok(prompt.includes("Queen Bee"), "persona present");
  assert.ok(prompt.includes('"speech"'), "JSON contract present");
  assert.ok(/never greet again/i.test(prompt), "anti-re-greeting instruction present");
  assert.ok(prompt.includes("Call the user boss."), "preference preamble spliced in");
  assert.ok(prompt.includes("Queen Bee: Hey Liam, I'm here."), "queen history line present");
  assert.ok(prompt.includes("User: What do you think?"), "user history line present");
  assert.ok(prompt.includes("User's latest spoken message: Sure"), "latest message last");
  assert.ok(
    prompt.indexOf("Conversation so far") < prompt.indexOf("User's latest spoken message"),
    "history precedes the latest message",
  );

  const noHistory = buildRuntimeVoiceUserText("Hello", [], "");
  assert.ok(!noHistory.includes("Conversation so far"), "no empty history block");

  const long = Array.from({ length: 20 }, (_, index) => ({
    who: index % 2 ? "queen" : "you",
    text: `turn ${index}`,
  }));
  const capped = buildRuntimeVoiceUserText("latest", long, "");
  assert.ok(!capped.includes("turn 11"), "history capped to the recent window");
  assert.ok(capped.includes("turn 19"), "most recent history retained");
  console.log("flattened runtime prompt ok");
}

// --- tool activity labels --------------------------------------------------------
{
  assert.equal(
    toolActivityLabel(JSON.stringify({ type: "chat.tool.start", name: "run_command" })),
    "Using run_command",
  );
  assert.equal(
    toolActivityLabel(JSON.stringify({ type: "chat.tool.progress", tool: "web_search" })),
    "Using web_search",
  );
  assert.equal(
    toolActivityLabel(JSON.stringify({ type: "chat.tool.start" })),
    "Using a tool",
    "unnamed tools still surface",
  );
  assert.equal(
    toolActivityLabel(JSON.stringify({ type: "chat.tool.done", name: "run_command" })),
    "",
    "completions do not create a new stage",
  );
  assert.equal(toolActivityLabel(JSON.stringify({ type: "chat.text", delta: "hi" })), "");
  assert.equal(toolActivityLabel("not json"), "");
  console.log("tool activity labels ok");
}

console.log("test-queen-voice-working: all assertions passed");
