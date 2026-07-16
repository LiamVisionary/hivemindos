#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

process.env.NODE_ENV = "production";
delete process.env.HIVEMINDOS_TELEMETRY;
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { streamOpenAICompatibleRuntime } = await import(
  "../src/app/api/chat/agent-runtime/stream-openai-compatible.ts"
);

const explicitPrompt = "use local video generation to generate a video of this bee flying";
const ambiguousPrompt = "create a video announcing our next product release";
const conversationalPrompt = "I'm thinking about video generation for a future launch";
const hypergenPrompt = "use our hypergen skill instead";
const approvedHyperframesPrompt = "[HIVEMINDOS_HYPERFRAMES_RENDER_V1]\n/motion-graphics Make a 6-second 1080×1080 video. Beat 1 (0–6s): a bee glides through a geometric hive. No on-screen copy. Motion: Smooth easing. No narration.";
const uncertainPrompt = "create a video while the semantic classifier is unavailable";
const sourcePath = "/tmp/swarm-scout-card.jpg";
const upstreamBodies = new Map([
  [explicitPrompt, []],
  [ambiguousPrompt, []],
  [conversationalPrompt, []],
  [hypergenPrompt, []],
  [approvedHyperframesPrompt, []],
  [uncertainPrompt, []],
]);
const classifierBodies = [];
const videoDispatchBodies = [];
const originalFetch = globalThis.fetch;

function requestPrompt(body) {
  return body.messages?.findLast?.((message) => message.role === "user")?.content ?? "";
}

globalThis.fetch = async (input, init = {}) => {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "mock-runtime.invalid") {
    const body = JSON.parse(String(init.body ?? "{}"));
    if (body.response_format?.json_schema?.name === "semantic_video_intent") {
      classifierBodies.push(body);
      const transcript = body.messages?.at(-1)?.content ?? "";
      if (transcript.includes(uncertainPrompt)) {
        return Response.json({ choices: [{ message: { content: "classifier unavailable" } }] });
      }
      const intent = transcript.includes(hypergenPrompt)
        ? "create_html"
        : transcript.includes(conversationalPrompt)
          ? "discussion"
          : transcript.includes(explicitPrompt)
            ? "create_local"
            : transcript.includes(ambiguousPrompt) ? "create_unspecified" : "other";
      return Response.json({ choices: [{ message: { content: JSON.stringify({ intent, confidence: 0.99 }) } }] });
    }
    const prompt = requestPrompt(body);
    const requests = upstreamBodies.get(prompt);
    assert.ok(requests, `Unexpected runtime prompt: ${prompt}`);
    requests.push(body);
    if (prompt === conversationalPrompt) {
      return Response.json({
        choices: [{ message: { content: "That could be a good launch format. What are you hoping the video communicates?" } }],
      });
    }
    if (prompt === hypergenPrompt) {
      return Response.json({
        choices: [{ message: { content: "I'll use the HyperFrames HTML workflow for this video." } }],
      });
    }
    if (prompt === approvedHyperframesPrompt) {
      return Response.json({
        choices: [{ message: { content: "I'll build this with the pinned local HyperFrames renderer." } }],
      });
    }
    if (prompt === uncertainPrompt) {
      return Response.json({
        choices: [{ message: { content: "Do you want cloud AI video, local AI video, or HTML / HyperFrames rendering?" } }],
      });
    }
    if (requests.length === 1) {
      return Response.json({
        choices: [{ message: {
          content: "",
          tool_calls: [{
            id: "call_generate_video",
            type: "function",
            function: {
              name: "generate_video",
              arguments: JSON.stringify({ prompt: explicitPrompt, inputImageId: "bee-source" }),
            },
          }],
        } }],
      });
    }
    return Response.json({
      choices: [{ message: { content: "Generated the local video with Media Studio." } }],
    });
  }
  if (url.pathname === "/api/chat/video-generation") {
    const videoDispatchBody = JSON.parse(String(init.body ?? "{}"));
    videoDispatchBodies.push(videoDispatchBody);
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

async function runPrompt(prompt, mediaArtifacts = [], conversation = [{ role: "user", content: prompt }]) {
  const response = await streamOpenAICompatibleRuntime(
    {
      id: `swarm-scout-video-routing-${upstreamBodies.get(prompt)?.length ?? 0}`,
      name: "Swarm Scout",
      runtime: "hivemind-os",
      runtimeKind: "interactive",
      gatewayUrl: "http://mock-runtime.invalid/v1",
      chatPath: "/chat/completions",
      provider: "custom-openai-compatible",
      model: "mock-scout",
      runtimeCapabilities: { skillActions: true },
    },
    conversation,
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
      chatStorageKey: `video-routing-${prompt === explicitPrompt ? "explicit" : prompt === ambiguousPrompt ? "ambiguous" : "conversation"}`,
    },
    "",
    "",
    undefined,
    "",
    "auto",
    mediaArtifacts,
  );
  return { response, body: await response.text() };
}

try {
  const explicit = await runPrompt(explicitPrompt, [{
    id: "bee-source",
    kind: "image",
    name: "swarm-scout-card.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 123,
    path: sourcePath,
  }]);
  const explicitRequests = upstreamBodies.get(explicitPrompt);

  assert.equal(explicit.response.status, 200);
  assert.equal(explicitRequests.length, 2, "an agent-selected video tool call should continue once after generation");
  assert.equal(explicitRequests[0].tool_choice, "auto", "video keywords must not force a tool call");
  assert.equal(videoDispatchBodies[0]?.prompt, explicitPrompt);
  assert.deepEqual(videoDispatchBodies[0]?.inputImages, [{
    path: sourcePath,
    mimeType: "image/jpeg",
    name: "swarm-scout-card.jpg",
  }]);
  assert.match(explicit.body, /"status":"ready"/);
  assert.match(explicit.body, /bee-flight\.mp4/);

  const ambiguous = await runPrompt(ambiguousPrompt);
  const ambiguousRequests = upstreamBodies.get(ambiguousPrompt);

  assert.equal(ambiguous.response.status, 200);
  assert.equal(ambiguousRequests.length, 0, "semantic ambiguity should return a structured clarification before the action model sees tools");
  assert.equal(videoDispatchBodies.length, 1, "an ambiguous creation request must not dispatch before the user's answer");
  assert.match(ambiguous.body, /"type":"chat\.clarify"/);
  assert.match(ambiguous.body, /"question":"How should I make this video\?"/);
  assert.match(ambiguous.body, /"label":"HTML \/ HyperFrames"/);

  const conversational = await runPrompt(conversationalPrompt);
  const conversationalRequests = upstreamBodies.get(conversationalPrompt);

  assert.equal(conversational.response.status, 200);
  assert.equal(conversationalRequests.length, 1, "ordinary video discussion should remain one conversational turn");
  assert.equal(conversationalRequests[0].tool_choice, undefined, "semantic discussion should not expose action tools to a weak model");
  assert.equal(conversationalRequests[0].tools, undefined);
  assert.match(
    conversationalRequests[0].messages?.filter((message) => message.role === "system").map((message) => message.content).join("\n") ?? "",
    /video discussion[\s\S]*respond naturally/i,
  );
  assert.equal(videoDispatchBodies.length, 1, "discussion about video generation must not dispatch generation");
  assert.match(conversational.body, /What are you hoping the video communicates/);

  const hypergen = await runPrompt(hypergenPrompt, [], [
    { role: "user", content: ambiguousPrompt },
    { role: "assistant", content: "The connected image-to-video generator requires an image." },
    { role: "user", content: hypergenPrompt },
  ]);
  const hypergenRequests = upstreamBodies.get(hypergenPrompt);

  assert.equal(hypergen.response.status, 200);
  assert.equal(hypergenRequests.length, 0, "selecting HyperFrames should open the guided prompt card before the action model sees tools");
  assert.match(hypergen.body, /"id":"hyperframes-prompt-builder"/);
  assert.match(hypergen.body, /Shape this HyperFrames video before rendering/);

  const approvedHyperframes = await runPrompt(approvedHyperframesPrompt, [], [
    { role: "user", content: hypergenPrompt },
    { role: "assistant", content: "Shape this HyperFrames video before rendering." },
    { role: "user", content: approvedHyperframesPrompt },
  ]);
  const approvedRequests = upstreamBodies.get(approvedHyperframesPrompt);
  const approvedToolNames = approvedRequests[0]?.tools?.map((tool) => tool.function?.name) ?? [];
  const approvedContext = approvedRequests[0]?.messages?.filter((message) => message.role === "system").map((message) => message.content).join("\n") ?? "";

  assert.equal(approvedHyperframes.response.status, 200);
  assert.equal(approvedRequests.length, 1);
  assert.ok(approvedToolNames.includes("run_command"), "an approved HyperFrames render should retain the command tool");
  assert.ok(!approvedToolNames.includes("invoke_hive_capability"));
  assert.ok(!approvedToolNames.includes("generate_video"));
  assert.match(approvedContext, /skill:packaged:auto-install:hyperframes/);
  assert.match(approvedContext, /command `hyperframes`/);
  assert.match(approvedContext, /Do not run `hyperframes init`/);
  assert.match(approvedContext, /Do not ask for a second render confirmation/);
  assert.match(approvedHyperframes.body, /pinned local HyperFrames renderer/);

  const uncertain = await runPrompt(uncertainPrompt);
  const uncertainRequests = upstreamBodies.get(uncertainPrompt);
  const uncertainContext = uncertainRequests[0]?.messages?.filter((message) => message.role === "system").map((message) => message.content).join("\n") ?? "";

  assert.equal(uncertain.response.status, 200);
  assert.equal(uncertainRequests.length, 1);
  assert.equal(uncertainRequests[0].tools, undefined, "classifier failure must fail closed without exposing action tools");
  assert.match(uncertainContext, /semantic video routing was unavailable/i);
  assert.match(uncertainContext, /Markdown bullet options/i, "the safe fallback must request a dashboard-actionable decision format");
  assert.match(uncertain.body, /cloud AI video, local AI video, or HTML \/ HyperFrames/);
  assert.equal(classifierBodies.length, 5, "video-shaped turns are classified, while the signed guided render handoff bypasses reclassification");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("The agent—not a keyword catch—decides whether video conversation becomes a generation tool call.");
