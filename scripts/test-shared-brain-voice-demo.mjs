#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

const demo = read("src/features/dashboard/views/shared-brain-voice-demo.ts");
const explorer = read("src/features/dashboard/views/BrainGraphExplorer.tsx");
const store = read("src/features/queen-voice/queen-chat-store.tsx");
const overlay = read("src/features/queen-voice/QueenBeeVoiceOverlay.tsx");
const queenBrain = read("src/lib/services/queen-bee/queen-brain.ts");

assert.match(
  demo,
  /export const SHARED_BRAIN_VOICE_DEMO_LINES/,
  "The Shared Brain voice demo should keep its script in one canonical module.",
);
assert.doesNotMatch(
  demo,
  /Hey, Z\.E\.R\.O\. Everybody's using Claude Code/,
  "The demo should start with Queen Bee's answer instead of replaying the user's opener.",
);
assert.match(demo, /Claude\? Claude Code is a superb instrument/, "The demo should begin with Queen Bee's answer.");
assert.match(demo, /I am not held\./, "The demo should include the core agent/company contrast.");
assert.match(demo, /I operate it\./, "The demo should include the operating-system contrast.");
assert.match(demo, /repeat yourself, sir\./, "The demo should include the closing line.");
assert.match(
  demo,
  /spokenText:\s*"A coding agent edits files[\s\S]*Thirty-two tools[\s\S]*C R M/,
  "Acronyms and numbers should have a natural spoken-text override for TTS.",
);

const pauses = [...demo.matchAll(/pauseAfterMs:\s*([\d_]+)/g)].map((match) => Number(match[1].replaceAll("_", "")));
assert.ok(pauses.length >= 8, "The script should be split into deliberate spoken lines.");
assert.ok(pauses.some((pause) => pause >= 1_000), "The rhetorical transition should include a long pause.");
assert.equal(pauses.at(-1), 0, "The final line should not add a trailing pause.");

assert.match(
  explorer,
  /process\.env\.NODE_ENV === "development"/,
  "The Shared Brain speech button must be development-only.",
);
assert.match(explorer, /Speak demo/, "The development control should have a visible label.");
assert.match(
  explorer,
  /speakScript\(SHARED_BRAIN_VOICE_DEMO_LINES\)/,
  "The Shared Brain control should use the shared Queen chat scripted-playback path.",
);
assert.doesNotMatch(
  explorer,
  /emitQueenVoiceToggle/,
  "The demo must not open the full voice overlay, which would activate the screen glow.",
);

assert.match(
  store,
  /speakScript:\s*\(lines:\s*readonly QueenVoiceScriptLine\[\]\)\s*=>\s*Promise<boolean>/,
  "The shared Queen chat contract should expose scripted playback.",
);
assert.match(
  store,
  /playSpokenReply\(\s*line\.spokenText \?\? line\.text/,
  "Scripted playback should reuse Queen Bee's selected-voice playback ladder.",
);
assert.match(
  store,
  /setHistoryMinimized\(false\)/,
  "The spoken script should remain visible in the shared Queen transcript.",
);
assert.match(
  overlay,
  /\{open \? <QueenVoiceGlow active=\{open\} \/> : null\}/,
  "The perimeter glow should remain tied only to a genuinely open voice session.",
);

assert.match(
  queenBrain,
  /asks what makes you different/,
  "The shared typed-and-spoken Queen brain should recognize differentiation questions.",
);
assert.match(
  queenBrain,
  /company-like hive of six agents/,
  "Queen Bee's differentiation answer should preserve the agent-company substance of the demo.",
);
assert.match(
  queenBrain,
  /32 connected tools/,
  "Queen Bee's differentiation answer should preserve the connected-tool substance of the demo.",
);
assert.match(
  queenBrain,
  /persistent Shared Brain memory/,
  "Queen Bee's differentiation answer should explain the durable-memory contrast.",
);
assert.match(
  queenBrain,
  /Never introduce Claude, Claude Code, or any other competitor unless the user's current message names it/,
  "Queen Bee must not introduce Claude when the user asks a generic differentiation question.",
);

console.log("Shared Brain dev speech uses paced Queen Bee playback without opening the glow overlay.");
