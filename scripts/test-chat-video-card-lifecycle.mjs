#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.NODE_ENV = "production";
delete process.env.HIVEMINDOS_TELEMETRY;
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const nativeVideoModule = await import(
  "../src/app/api/chat/agent-runtime/stream-native-video-generation.ts"
).catch(() => null);
assert.ok(nativeVideoModule?.streamNativeVideoGeneration, "an agent-selected video tool needs a native SSE stream");

const sessionStore = await import("../src/lib/services/chat/runtime-session-store.ts");
assert.equal(
  typeof sessionStore.upsertRuntimeApplicationGenerationMessage,
  "function",
  "runtime sessions need structured generation-card persistence",
);

const {
  applicationGenerationSignature,
  buildActiveImageGenerationCard,
  shouldRenderImageGenerationCard,
} = await import("../src/features/dashboard/hooks/status-chat-process-image-generation.ts");
const { normalizeApplicationGenerationCard } = await import(
  "../src/features/dashboard/chat-application-generation.ts"
);

const prompt = "use local video generation to generate a video of this bee flying";
const runningCard = {
  id: "video-run-1",
  kind: "video",
  prompt,
  status: "running",
  title: "Video generation",
  createdAt: 100,
};
const readyCard = {
  ...runningCard,
  status: "ready",
  appName: "Media Studio",
  sourceArtifacts: [{ kind: "image", url: "/api/chat/generated-media?path=bee.jpg", label: "bee.jpg", mimeType: "image/jpeg" }],
  artifacts: [{ kind: "video", url: "/api/chat/generated-media?path=bee.mp4", mimeType: "video/mp4" }],
  completedAt: 200,
};

const activeCard = buildActiveImageGenerationCard({
  current: null,
  taskId: "video-run-1",
  prompt,
  outgoingLabel: prompt,
  patch: runningCard,
});
assert.equal(activeCard.kind, "video", "the live-card reducer must preserve the video kind");
assert.equal(shouldRenderImageGenerationCard(activeCard), true, "a running video card should render during generation");
assert.notEqual(
  applicationGenerationSignature(runningCard),
  applicationGenerationSignature({ ...runningCard, sourceArtifacts: readyCard.sourceArtifacts }),
  "adding the source thumbnail should invalidate the stored chat-card signature",
);
assert.deepEqual(normalizeApplicationGenerationCard(readyCard), readyCard, "session hydration should retain the ready video artifact");

let sessionMessages = sessionStore.upsertRuntimeApplicationGenerationMessage([], runningCard);
sessionMessages = sessionStore.upsertRuntimeApplicationGenerationMessage(sessionMessages, readyCard);
assert.equal(sessionMessages.length, 1, "running and ready states should update one durable assistant card");
assert.equal(sessionMessages[0].applicationGeneration.status, "ready");
assert.equal(sessionMessages[0].applicationGeneration.artifacts[0].url, readyCard.artifacts[0].url);

let resolveVideoDispatch;
let dispatchBody = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  assert.equal(url.pathname, "/api/chat/video-generation");
  dispatchBody = JSON.parse(String(init.body ?? "{}"));
  return new Promise((resolve) => {
    resolveVideoDispatch = resolve;
  });
};

try {
  const response = nativeVideoModule.streamNativeVideoGeneration({
    origin: "http://dashboard.test",
    prompt,
    inputImages: [{ path: "/tmp/swarm-scout-card.jpg", mimeType: "image/jpeg", name: "swarm-scout-card.jpg" }],
    runtimeSessionId: "",
    runtime: "hivemind-os",
    startedAt: 100,
    runId: "video-run-1",
    chatStorageKey: "video-chat-1",
    sourceArtifacts: readyCard.sourceArtifacts,
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let streamed = "";
  for (let attempt = 0; attempt < 10 && !streamed.includes('"status":"running"'); attempt += 1) {
    const chunk = await reader.read();
    if (chunk.done) break;
    streamed += decoder.decode(chunk.value, { stream: true });
  }
  assert.match(streamed, /"applicationGeneration":\{"id":"video-run-1","status":"running","kind":"video"/);
  assert.match(streamed, /"sourceArtifacts":\[\{"kind":"image"/, "the running card should carry its source-image thumbnail");
  assert.doesNotMatch(streamed, /"status":"ready"/, "the ready card must wait for the video app");
  for (let attempt = 0; attempt < 10 && !resolveVideoDispatch; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(dispatchBody?.inputImages?.[0]?.path, "/tmp/swarm-scout-card.jpg");

  resolveVideoDispatch(Response.json({
    ok: true,
    prompt,
    app: { id: "media-studio", name: "Media Studio", machineName: "This Mac", serviceKind: "video" },
    endpoint: "mcp:media_generate_video",
    videos: [{ url: "/api/chat/generated-media?path=bee.mp4", mimeType: "video/mp4", durationMs: 4_000 }],
  }));
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    streamed += decoder.decode(chunk.value, { stream: true });
  }
  assert.match(streamed, /"status":"ready"/);
  assert.match(streamed, /Media Studio/);
  assert.match(streamed, /bee\.mp4/);
  assert.match(streamed, /data: \[DONE\]/);
} finally {
  globalThis.fetch = originalFetch;
}

const routeSource = readFileSync(new URL("../src/app/api/chat/agent-runtime/route.ts", import.meta.url), "utf8");
assert.doesNotMatch(routeSource, /return streamNativeVideoGeneration\(\{/, "the chat route must not bypass agent inference from video keywords");
const controllerSource = readFileSync(new URL("../src/features/dashboard/hooks/use-status-chat-input-controller.tsx", import.meta.url), "utf8");
assert.match(controllerSource, /normalizeApplicationGenerationCard\(sessionMessage\?\.applicationGeneration\)/, "timeout polling should recover a persisted result card");
const chatRunTranscriptsSource = readFileSync(new URL("../src/features/dashboard/chat-run-transcripts.ts", import.meta.url), "utf8");
assert.match(chatRunTranscriptsSource, /applicationGeneration: normalizeApplicationGenerationCard\(message\.applicationGeneration\)/, "session reload should recover a persisted result card");
const dashboardStorageSource = readFileSync(new URL("../src/features/dashboard/dashboard-storage.ts", import.meta.url), "utf8");
assert.match(dashboardStorageSource, /sourceArtifacts:\s*Array\.isArray\(card\.sourceArtifacts\)/, "durable dashboard chat storage should retain source thumbnails");
const cardSource = readFileSync(new URL("../src/features/dashboard/views/chat/ApplicationGenerationCard.tsx", import.meta.url), "utf8");
assert.match(cardSource, /card\.sourceArtifacts/, "the generation-card prompt row should read the persisted source image");
assert.match(cardSource, /className=\{styles\.sourceThumbnail\}/, "the source image should render as a dedicated prompt-row thumbnail");
const cardStyles = readFileSync(new URL("../src/features/dashboard/views/chat/ImageGenerationCard.module.css", import.meta.url), "utf8");
assert.match(cardStyles, /\.promptRow\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/, "the prompt copy and source thumbnail should share one row");

console.log("Video generation streams a running card and persists the ready result card.");
