#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

process.env.NODE_ENV = "production";
delete process.env.HIVEMINDOS_TELEMETRY;
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { streamOpenAICompatibleRuntime } = await import(
  "../src/app/api/chat/agent-runtime/stream-openai-compatible.ts"
);

const prompt = "inspect the connected deployment capability";
const requestBodies = [];
const originalFetch = globalThis.fetch;
const malformedCall = `<|tool_call>call:invoke_hive_capability
{
  method: <|"|>GET<|"|>,
  path: <|"|>/api/example<|"|>,
  surface: <|"|>hive_action<|"|>
}<tool_call|>`;

globalThis.fetch = async (input, init = {}) => {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  assert.equal(url.hostname, "mock-runtime.invalid");
  const body = JSON.parse(String(init.body ?? "{}"));
  requestBodies.push(body);
  const recoveryRequested = body.messages?.some((message) => (
    typeof message.content === "string" && message.content.includes("Tool-loop recovery")
  ));
  if (recoveryRequested) {
    return Response.json({
      choices: [{ message: { content: "I couldn't inspect that capability because the tool request was invalid. Nothing was run." } }],
    });
  }
  return Response.json({ choices: [{ message: { content: malformedCall } }] });
};

try {
  const response = await streamOpenAICompatibleRuntime(
    {
      id: "tool-loop-recovery-test",
      name: "Tool Recovery Test",
      runtime: "hivemind-os",
      runtimeKind: "interactive",
      gatewayUrl: "http://mock-runtime.invalid/v1",
      chatPath: "/chat/completions",
      provider: "custom-openai-compatible",
      model: "mock-model",
      runtimeCapabilities: { skillActions: true },
    },
    [{ role: "user", content: prompt }],
    prompt,
    null,
    "act",
    undefined,
    undefined,
    false,
    "",
    {
      request: new Request("http://dashboard.test/api/chat/agent-runtime"),
      routeStartedAt: Date.now(),
      chatStorageKey: "tool-loop-recovery-test",
    },
    "",
    "",
    undefined,
    "",
    "auto",
    [],
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.ok(requestBodies.length >= 3, "the runtime should give malformed tool calls bounded recovery attempts");
  assert.ok(
    requestBodies.some((requestBody) => requestBody.messages?.some((message) => (
      typeof message.content === "string" && message.content.includes("Tool-loop recovery")
    ))),
    "after tool rounds are exhausted the runtime should request one final tool-free user-facing answer",
  );
  assert.match(body, /Nothing was run/);
  // Validator errors are shown in the process-event badges on purpose (so the
  // user sees the real failure instead of a bare "Hive capability failed"),
  // but they must never leak into the assistant's own chat text.
  const assistantText = body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line.trim() !== "data: [DONE]")
    .map((line) => {
      try {
        return JSON.parse(line.slice("data: ".length));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .flatMap((payload) => payload.choices?.flatMap((choice) => choice.delta?.content ? [choice.delta.content] : []) ?? [])
    .join("");
  assert.doesNotMatch(assistantText, /Capability operation must be list or invoke/);
  assert.match(body, /Capability operation must be list or invoke\. The agent produced an invalid capability request; nothing was run\./);
  assert.doesNotMatch(body, /<\|?tool_call/i);
  // Repeated malformed calls inject the corrective system nudge on a later
  // round, and a run that executed nothing ends with the honest notice instead
  // of an unqualified model answer.
  assert.ok(
    requestBodies.some((requestBody) => requestBody.messages?.some((message) => (
      message.role === "system" && typeof message.content === "string" && message.content.includes("failing validation")
    ))),
    "repeated malformed capability calls should inject the corrective system nudge",
  );
  assert.match(assistantText, /invalid capability tool calls/);
  assert.match(assistantText, /stronger tool-calling model/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Malformed capability loops recover to a safe user-facing answer without leaking validator errors.");
