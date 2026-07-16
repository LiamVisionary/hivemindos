#!/usr/bin/env node
import assert from "node:assert/strict";

const chatPanelHelpers = await import("../src/features/dashboard/views/chat/chat-panel-helpers.ts");

assert.equal(
  typeof chatPanelHelpers.chatProcessTimerIsActive,
  "function",
  "chat process activity must combine the live stream state with saved process events",
);

assert.equal(
  chatPanelHelpers.chatProcessTimerIsActive(false, true),
  false,
  "a cached non-terminal tool event must not keep a finished chat timer running",
);
assert.equal(
  chatPanelHelpers.chatProcessTimerIsActive(true, true),
  true,
  "a non-terminal tool event remains live while its chat stream is active",
);
assert.equal(
  chatPanelHelpers.chatProcessTimerIsActive(true, false),
  false,
  "a terminal process event stops the timer even before stream cleanup finishes",
);

console.log("test-chat-process-timer: all assertions passed");
