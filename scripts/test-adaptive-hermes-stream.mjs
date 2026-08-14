import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const {
  isFleetSharedEnvAccessErrorBody,
  isHermesCliFailureText,
  isPotentialHermesCliFailureText,
} = await import("../src/app/api/chat/agent-runtime/openai-compat.ts");
const { createHermesCliStreamProtocol, HERMES_CLI_STREAM_EVENT_PREFIX } = await import("./lib/hermes-cli-stream-protocol.mjs");

const root = process.cwd();
const adaptiveStream = await readFile(join(root, "src/app/api/chat/agent-runtime/stream-adaptive-hermes.ts"), "utf8");
const collector = await readFile(join(root, "scripts/agent-telemetry-collector.mjs"), "utf8");
const bridge = await readFile(join(root, "scripts/hermes-hivemind-stream.py"), "utf8");
const dashboardController = await readFile(join(root, "src/features/dashboard/hooks/use-status-chat-input-controller.tsx"), "utf8");
const runtimeSessionStore = await readFile(join(root, "src/lib/services/chat/runtime-session-store.ts"), "utf8");

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
  "if (cliSessionId) hermesCliSessionId = cliSessionId;",
  "adaptive Hermes captures the upstream CLI session for provider retries",
);
assert.doesNotMatch(
  adaptiveStream,
  /else if \(!thinking && parsed\?\.session\) \{[\s\S]{0,500}safeEnqueue\(ssePayload\(parsed\)\)/,
  "the upstream Hermes CLI session must not replace the HivemindOS chat-turn session in the browser",
);
includes(
  collector,
  "readHermesDbSession(hermesHome, emittedHermesSessionId)",
  "collector resolves the canonical final Hermes assistant message",
);
includes(
  collector,
  "createHermesCliStreamProtocol",
  "collector parses structured Hermes model and tool events",
);
includes(
  collector,
  "hermes-hivemind-stream.py",
  "collector launches the HivemindOS Hermes stream bridge",
);
assert.match(bridge, /"streaming": True/);
assert.match(bridge, /"inline_diffs": False/);
assert.match(bridge, /"final_response_markdown": "raw"/);
assert.match(bridge, /assistant\.segment_end/);
includes(
  adaptiveStream,
  "RUNTIME_STREAM_EVENT_TYPES.TEXT_RESET",
  "Adaptive Hermes clears interim model narration before the final segment",
);
includes(
  adaptiveStream,
  "replaceRuntimeChatSessionAssistantText",
  "Adaptive Hermes keeps persisted session text aligned with the visible final segment",
);
includes(
  adaptiveStream,
  "stripHermesInternalToolNarration(fullText)",
  "Adaptive Hermes removes internal tool-routing narration from the final user-facing answer",
);
includes(
  dashboardController,
  "RUNTIME_STREAM_EVENT_TYPES.TEXT_RESET",
  "dashboard replaces the interim assistant draft when Hermes begins its final segment",
);
includes(
  runtimeSessionStore,
  "replaceRuntimeChatSessionAssistantText",
  "runtime session store supports replacing an interim assistant segment",
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
includes(
  adaptiveStream,
  "pendingAssistantText",
  "adaptive Hermes buffers a possible CLI failure prefix before accepting assistant text",
);

assert.equal(isHermesCliFailureText("Provider resolver returned an empty API key."), true);
assert.equal(isHermesCliFailureText("\n⚠️  Provider resolver returned an empty API key.\n"), true);
assert.equal(isHermesCliFailureText("❌ Hermes exited with code 1."), true);
assert.equal(
  isHermesCliFailureText(`Query: output contract test

Initializing agent...
__HIVEMIND_HERMES_EVENT__{"type":"tool.started","name":"terminal","status":"running"}
API call failed after 3 retries: HTTP 429: Provider returned error`),
  true,
  "a raw Hermes transport dump ending in a provider failure must not count as assistant text",
);
assert.equal(
  isHermesCliFailureText(`Query: output contract test
__HIVEMIND_HERMES_EVENT__{"type":"tool.failed","name":"terminal","status":"failed"}
Final error: Request timed out`),
  true,
  "a raw Hermes transport dump with only a final-error summary must not count as assistant text",
);
assert.equal(
  isHermesCliFailureText(`Query: output contract test
__HIVEMIND_HERMES_EVENT__{"type":"tool.failed","name":"terminal","status":"failed"}`),
  true,
  "a private Hermes transport marker must never count as assistant text even without a failure summary",
);
assert.equal(isHermesCliFailureText("Here is the requested app."), false);

let splitFailure = "";
for (const delta of ["\n⚠️  ", "Provider resolver ", "returned an empty API key.\n"]) {
  splitFailure += delta;
  if (!isHermesCliFailureText(splitFailure)) {
    assert.equal(isPotentialHermesCliFailureText(splitFailure), true);
  }
}
assert.equal(isHermesCliFailureText(splitFailure), true, "split decorated provider errors must resolve as failures");
assert.equal(isPotentialHermesCliFailureText("Here is"), false, "ordinary assistant text should flush immediately");

assert.equal(
  isFleetSharedEnvAccessErrorBody(JSON.stringify({ code: "fleet_shared_env_access_blocked" })),
  true,
);
assert.equal(isFleetSharedEnvAccessErrorBody(JSON.stringify({ error: "other" })), false);

const streamEvents = [];
const protocol = createHermesCliStreamProtocol({
  onAssistantDelta: (delta) => streamEvents.push(["delta", delta]),
  onAssistantReset: (content) => streamEvents.push(["reset", content]),
  onProcessEvent: (event) => streamEvents.push(["process", event.type, event.name]),
});
const eventLine = (event) => `${HERMES_CLI_STREAM_EVENT_PREFIX}${JSON.stringify(event)}\n`;
const firstLine = eventLine({ type: "assistant.delta", delta: "I am checking the scaffold." });
protocol.push(`untrusted terminal output\n${firstLine.slice(0, 17)}`);
protocol.push(firstLine.slice(17));
protocol.push(eventLine({ type: "assistant.segment_end" }));
protocol.push(eventLine({ type: "tool.started", name: "write_file" }));
protocol.push(eventLine({ type: "tool.completed", name: "write_file" }));
protocol.push(eventLine({ type: "capability.started", id: "skill:shared:muapi-seedance-video", name: "skill:shared:muapi-seedance-video" }));
protocol.push(eventLine({ type: "capability.completed", id: "skill:shared:muapi-seedance-video", name: "skill:shared:muapi-seedance-video" }));
protocol.push(eventLine({ type: "assistant.delta", delta: "## Build complete\n" }));
protocol.push(eventLine({ type: "assistant.delta", delta: "Verified." }));
protocol.flush();
protocol.reconcileFinal("## Build complete\nVerified.");
assert.deepEqual(streamEvents, [
  ["delta", "I am checking the scaffold."],
  ["process", "tool.started", "write_file"],
  ["process", "tool.completed", "write_file"],
  ["process", "capability.started", "skill:shared:muapi-seedance-video"],
  ["process", "capability.completed", "skill:shared:muapi-seedance-video"],
  ["reset", "I am checking the scaffold."],
  ["delta", "## Build complete\n"],
  ["delta", "Verified."],
]);

assert.match(bridge, /HIVEMINDOS_APPROVED_CAPABILITY_IDS/, "the private Hermes bridge reads the approved execution-receipt contract");
assert.match(bridge, /HIVEMINDOS_CAPABILITY_ID/, "the private Hermes bridge recognizes a selected-capability invocation marker");

const fallbackEvents = [];
const fallbackProtocol = createHermesCliStreamProtocol({
  onAssistantDelta: (delta) => fallbackEvents.push(delta),
});
fallbackProtocol.reconcileFinal("Canonical fallback only.");
assert.deepEqual(fallbackEvents, ["Canonical fallback only."]);

console.log("adaptive Hermes stream assertions passed");
