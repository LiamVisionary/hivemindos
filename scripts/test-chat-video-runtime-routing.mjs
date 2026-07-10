#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

process.env.NODE_ENV = "production";
delete process.env.HIVEMINDOS_TELEMETRY;
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { streamOpenAICompatibleRuntime } = await import(
  "../src/app/api/chat/agent-runtime/stream-openai-compatible.ts"
);

const prompt = "generate a video of this bee flying";
const sourcePath = "/tmp/swarm-scout-card.jpg";
const leakedWrongCapabilityToolCall = `<|tool_call>call:invoke_hive_capability
{
  method: <|"|>GET<|"|>,
  operation: <|"|>invoke<|"|>,
  path: <|"|>/api/skills/skill-skill-skill<|"|>,
  prompt: <|"|>describe video generation skill and give me the method and path to generate video from an image, including the prompt I should send for a bee flying<|"|>,
  skill: <|"|>skill:packaged:optional:media/hivemindos/launch-video-hyperframes<|"|>,
  skillName: <|"|>launch-video-hyperframes<|"|>,
  serviceKind: <|"|>skill<|"|>,
  surface: <|"|>skill<|"|>
}<tool_call|>`;
const upstreamBodies = [];
let videoDispatchBody = null;
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "mock-runtime.invalid") {
    const body = JSON.parse(String(init.body ?? "{}"));
    upstreamBodies.push(body);
    const content = upstreamBodies.length === 1
      ? leakedWrongCapabilityToolCall
      : `<|tool_call>call:invoke_hive_capability
{
  operation: <|"|>invoke<|"|>,
  surface: <|"|>skill<|"|>
}<tool_call|>`;
    return Response.json({ choices: [{ message: { content } }] });
  }
  if (url.pathname === "/api/chat/video-generation") {
    videoDispatchBody = JSON.parse(String(init.body ?? "{}"));
    return Response.json({
      ok: true,
      prompt: videoDispatchBody.prompt,
      app: { id: "media-studio", name: "Media Studio", machineName: "This Mac" },
      endpoint: "mcp:media_generate_video",
      videos: [{ url: "http://dashboard.test/api/generated-media/bee-flight.mp4", mimeType: "video/mp4", durationMs: 4_000 }],
    });
  }
  throw new Error(`Unexpected fetch: ${url}`);
};

try {
  const response = await streamOpenAICompatibleRuntime(
    {
      id: "swarm-scout-video-routing-test",
      name: "Swarm Scout",
      runtime: "hivemind-os",
      runtimeKind: "interactive",
      gatewayUrl: "http://mock-runtime.invalid/v1",
      chatPath: "/chat/completions",
      provider: "custom-openai-compatible",
      model: "mock-scout",
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
      chatStorageKey: "video-routing-test-chat",
    },
    "",
    "",
    undefined,
    "",
    "auto",
    [{
      id: "bee-source",
      kind: "image",
      name: "swarm-scout-card.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 123,
      path: sourcePath,
    }],
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(upstreamBodies.length, 2, "video generation should continue once after the media tool finishes");
  assert.deepEqual(upstreamBodies[0].tool_choice, {
    type: "function",
    function: { name: "generate_video" },
  }, "an explicit video request should force the dedicated media tool");
  assert.equal(videoDispatchBody?.prompt, prompt);
  assert.deepEqual(videoDispatchBody?.inputImages, [{
    path: sourcePath,
    mimeType: "image/jpeg",
    name: "swarm-scout-card.jpg",
  }]);
  assert.match(body, /"status":"ready"/);
  assert.match(body, /bee-flight\.mp4/);
  assert.match(body, /Generated 1 video with Media Studio\./);
  assert.doesNotMatch(body, /<\|?tool_call/i);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Explicit video chat requests force and dispatch the native Media Studio route.");
