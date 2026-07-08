import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const adaptiveStream = await readFile(join(root, "src/app/api/chat/agent-runtime/stream-adaptive-hermes.ts"), "utf8");

function includes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label} should include ${needle}`);
}

includes(
  adaptiveStream,
  "agent_runtime.hermes_adaptive_openrouter.stream.process_event",
  "adaptive Hermes stream telemetry",
);
includes(
  adaptiveStream,
  "safeEnqueue(ssePayload(parsed));",
  "adaptive Hermes process frames",
);
includes(
  adaptiveStream,
  "agent_runtime.hermes_adaptive_openrouter.stream.text_delta",
  "adaptive Hermes text delta telemetry",
);
includes(
  adaptiveStream,
  "agent_runtime.hermes_adaptive_openrouter.stream.comment",
  "adaptive Hermes comment telemetry",
);
includes(
  adaptiveStream,
  "Hermes Adaptive stream still working",
  "adaptive Hermes visible keepalive comment",
);

console.log("adaptive Hermes stream assertions passed");
