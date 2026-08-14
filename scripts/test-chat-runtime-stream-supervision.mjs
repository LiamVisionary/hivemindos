#!/usr/bin/env node

import { register } from "node:module";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { createRuntimeStreamActivityTimeout, startRuntimeStreamKeepalive } = await import(
  "../src/app/api/chat/agent-runtime/runtime-stream-supervision.ts"
);
const { interruptedRuntimeRecoveryResult, runtimeSessionRecoveryState } = await import(
  "../src/features/dashboard/hooks/status-chat-runtime-recovery.ts"
);
const { reconcileRuntimeSessionAfterWrapperFailure, runtimeSessionOriginalUserPrompt } = await import(
  "../src/lib/services/chat/runtime-session-reconciliation.ts"
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Activity extends the run beyond the original timer boundary. This is the
// regression that matters for long video/build turns: elapsed wall time alone
// must never abort a stream that is still producing bytes.
{
  const watchdog = createRuntimeStreamActivityTimeout(80);
  await wait(50);
  watchdog.touch();
  await wait(50);
  assert.equal(watchdog.signal.aborted, false, "activity must reset the idle watchdog");
  await wait(45);
  assert.equal(watchdog.signal.aborted, true, "a genuinely idle stream must still abort");
  assert.match(String(watchdog.signal.reason?.message ?? watchdog.signal.reason), /stopped sending data/i);
}

{
  const wrapperEndedAt = Date.now() - 5_000;
  const reconciled = reconcileRuntimeSessionAfterWrapperFailure(
    { endedAt: wrapperEndedAt, endReason: "failed", messages: [] },
    {
      sessionId: "late-hermes",
      updatedAt: wrapperEndedAt + 2_000,
      messages: [
        { role: "user", content: "build the app", createdAt: wrapperEndedAt - 10_000 },
        { role: "assistant", content: "Built and verified the app.", createdAt: wrapperEndedAt + 2_000 },
      ],
    },
  );
  assert.equal(reconciled?.endReason, "completed", "a late Hermes final must repair the failed wrapper");
  assert.equal(reconciled?.recoveredAfterWrapperFailure, true);
  assert.equal(
    runtimeSessionOriginalUserPrompt({ messages: [{ role: "user", content: "[marker]\nOriginal task: build the app\n\nCapability map:" }] }),
    "build the app",
    "wrapper recovery must match the person's original capability-approved task",
  );
  const completedWrapper = reconcileRuntimeSessionAfterWrapperFailure(
    { endedAt: wrapperEndedAt, endReason: "completed", messages: [] },
    { sessionId: "complete-hermes", messages: [{ role: "assistant", content: "Done.", createdAt: wrapperEndedAt - 1 }] },
  );
  assert.equal(completedWrapper?.endReason, "completed", "a completed wrapper must not revive an unterminated Hermes DB snapshot");
}

{
  const watchdog = createRuntimeStreamActivityTimeout(40);
  watchdog.stop();
  await wait(60);
  assert.equal(watchdog.signal.aborted, false, "a completed stream must clear its watchdog");
}

{
  const comments = [];
  const stop = startRuntimeStreamKeepalive((payload) => comments.push(payload), 15);
  await wait(38);
  stop();
  assert.ok(comments.length >= 2, "the downstream SSE bridge must emit periodic keepalives");
  assert.ok(comments.every((payload) => payload.startsWith(":")), "keepalives must remain inert SSE comments");
}

{
  const active = runtimeSessionRecoveryState({ sessionId: "active", messages: [{ role: "assistant", content: "Still building." }] });
  assert.equal(interruptedRuntimeRecoveryResult({ assistantIssue: false, assistantText: "Still building.", interrupted: true, session: active }), "active", "interim narration from an active session must not complete the app turn");
  assert.equal(runtimeSessionRecoveryState({ sessionId: "active-zero", endedAt: 0 }).outcome, "active", "a zero sentinel must not look like an ended timestamp");
  const completed = runtimeSessionRecoveryState({ sessionId: "done", endedAt: Date.now(), endReason: "completed" });
  assert.equal(interruptedRuntimeRecoveryResult({ assistantIssue: false, assistantText: "Build complete.", interrupted: true, session: completed }), "completed");
  const failed = runtimeSessionRecoveryState({ sessionId: "failed", endedAt: Date.now(), endReason: "timeout" });
  assert.equal(interruptedRuntimeRecoveryResult({ assistantIssue: false, assistantText: "Still building.", interrupted: true, session: failed }), "failed");
}

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [streamRuntime, openAiRuntime, streamSupervision, collector, controller, route] = await Promise.all([
  read("src/app/api/chat/agent-runtime/stream-http-runtime.ts"),
  read("src/app/api/chat/agent-runtime/stream-openai-compatible.ts"),
  read("src/app/api/chat/agent-runtime/runtime-stream-supervision.ts"),
  read("scripts/agent-telemetry-collector.mjs"),
  read("src/features/dashboard/hooks/use-status-chat-input-controller.tsx"),
  read("src/app/api/chat/agent-runtime/route.ts"),
]);

assert.doesNotMatch(streamRuntime, /AbortSignal\.timeout\(RUNTIME_FETCH_TIMEOUT_MS\)/, "HTTP chat must not have an absolute ten-minute abort");
assert.match(streamRuntime, /fetchRuntime\.touch\(\)/, "upstream chunks must refresh the inactivity watchdog");
assert.match(streamSupervision, /HivemindOS runtime stream still working/, "the dashboard stream must remain alive while an upstream tool is quiet");
assert.doesNotMatch(openAiRuntime, /AbortSignal\.timeout\(RUNTIME_FETCH_TIMEOUT_MS\)/, "OpenAI-compatible streams must not retain the absolute timeout under another code path");
assert.match(openAiRuntime, /fetchStreamingResponse\.touch\(\)/, "OpenAI-compatible stream chunks must refresh activity supervision");
assert.match(collector, /Hermes CLI stream still working/, "the scoped Hermes CLI bridge must emit heartbeats too");
assert.match(collector, /activityWatchdog\.touch\(\);[\s\S]{0,180}const textChunk = chunk\.toString/, "real CLI output must refresh collector supervision");
assert.match(controller, /interruptedRuntimeRecoveryResult/, "interim recovery text must be checked against terminal session state");
assert.match(route, /export const maxDuration = 3600/, "the route budget must not reintroduce the old ten-minute ceiling");

console.log("chat runtime stream supervision checks passed");
