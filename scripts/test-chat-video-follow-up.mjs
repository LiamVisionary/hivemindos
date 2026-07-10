#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.NODE_ENV = "production";
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const followUpModule = await import(
  "../src/lib/services/chat/video-generation-follow-up.ts"
).catch(() => null);
assert.equal(
  typeof followUpModule?.resolveVideoGenerationFollowUp,
  "function",
  "video generation needs a reusable prior-session follow-up resolver",
);

const nativeRequestModule = await import(
  "../src/app/api/chat/agent-runtime/native-video-generation-request.ts"
).catch(() => null);
assert.equal(
  typeof nativeRequestModule?.prepareNativeVideoGenerationRequest,
  "function",
  "the native video route needs one preparation boundary for explicit and follow-up turns",
);

const sourcePath = "/Users/test/bee.jpg";
const previousPrompt = "create a video of this bee flying around";
const sourceUrl = `/api/chat/generated-media?path=${encodeURIComponent(sourcePath)}&exp=9999999999999&sig=${"a".repeat(64)}`;
const sessionMessages = [
  {
    index: 0,
    role: "user",
    content: `${previousPrompt} Attached file references:\n- bee.jpg (kind: file; path: ${sourcePath}; type: image/jpeg)`,
    createdAt: 100,
  },
  {
    index: 1,
    role: "assistant",
    content: `Generated video: ${previousPrompt}`,
    createdAt: 200,
    applicationGeneration: {
      id: "video-1",
      kind: "video",
      status: "ready",
      prompt: previousPrompt,
      sourceArtifacts: [{ kind: "image", url: sourceUrl, label: "bee.jpg", mimeType: "image/jpeg" }],
      artifacts: [{ kind: "video", url: "/generated/bee.mp4" }],
    },
  },
];

const terseFollowUp = followUpModule.resolveVideoGenerationFollowUp(
  "now with a sunset, faster wings, and a wider camera move",
  sessionMessages,
);
assert.ok(terseFollowUp, "a terse modifier after a completed video should resolve as regeneration");
assert.match(terseFollowUp.prompt, /Generate a new video from the same source image/i);
assert.match(terseFollowUp.prompt, /create a video of this bee flying around/i, "the previous prompt remains context");
assert.match(terseFollowUp.prompt, /sunset, faster wings, and a wider camera move/i, "the new modifiers are preserved");
assert.deepEqual(terseFollowUp.inputImages, [{
  path: sourcePath,
  mimeType: "image/jpeg",
  name: "bee.jpg",
}]);

const explicitFollowUp = followUpModule.resolveVideoGenerationFollowUp(
  "now regenerate it with softer motion and no camera shake",
  sessionMessages,
);
assert.ok(explicitFollowUp, "an explicit regenerate-it follow-up should reuse the prior source image");
assert.match(explicitFollowUp.prompt, /softer motion and no camera shake/i);

const legacySessionMessages = sessionMessages.map((message) => (
  message.applicationGeneration
    ? { ...message, applicationGeneration: { ...message.applicationGeneration, sourceArtifacts: undefined } }
    : message
));
const legacyFollowUp = followUpModule.resolveVideoGenerationFollowUp("now with a close-up", legacySessionMessages);
assert.equal(
  legacyFollowUp?.inputImages?.[0]?.path,
  sourcePath,
  "older sessions recover the source path from the original attachment reference",
);

const textToVideoAfterOlderImage = [
  ...sessionMessages,
  { index: 2, role: "user", content: "generate a video of a brand new abstract galaxy", createdAt: 300 },
  {
    index: 3,
    role: "assistant",
    content: "Generated video: abstract galaxy",
    createdAt: 400,
    applicationGeneration: { id: "video-2", kind: "video", status: "ready", prompt: "an abstract galaxy" },
  },
];
assert.equal(
  followUpModule.resolveVideoGenerationFollowUp("now with blue stars", textToVideoAfterOlderImage),
  null,
  "a source-less newer video must not borrow an unrelated image from an older turn",
);

assert.equal(
  followUpModule.resolveVideoGenerationFollowUp("what model generated that?", sessionMessages),
  null,
  "an ordinary question after a video must remain a normal chat turn",
);

const signedSourceUrl = "/api/chat/generated-media?path=source.jpg&exp=1&sig=test";
const explicitPrepared = await nativeRequestModule.prepareNativeVideoGenerationRequest({
  userPrompt: `${previousPrompt} Attached file references:\n- bee.jpg (kind: file; path: ${sourcePath}; type: image/jpeg)`,
  mediaArtifacts: [{
    id: "image-1",
    kind: "image",
    name: "bee.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 100,
    path: sourcePath,
  }],
  sessionMessages: [],
  signMediaUrl: async () => signedSourceUrl,
});
assert.equal(explicitPrepared?.prompt, previousPrompt, "the visible/generation prompt excludes attachment bookkeeping");
assert.deepEqual(explicitPrepared?.sourceArtifacts, [{
  kind: "image",
  url: signedSourceUrl,
  label: "bee.jpg",
  mimeType: "image/jpeg",
}]);

const followUpPrepared = await nativeRequestModule.prepareNativeVideoGenerationRequest({
  userPrompt: "now with glowing fireflies",
  mediaArtifacts: [],
  sessionMessages,
  signMediaUrl: async () => signedSourceUrl,
});
assert.match(followUpPrepared?.prompt ?? "", /glowing fireflies/i);
assert.equal(followUpPrepared?.inputImages[0]?.path, sourcePath);
assert.equal(followUpPrepared?.sourceArtifacts[0]?.url, signedSourceUrl);

const routeSource = readFileSync(new URL("../src/app/api/chat/agent-runtime/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /prepareNativeVideoGenerationRequest\(\{/, "the real chat route should resolve video follow-ups from its runtime session");
assert.match(routeSource, /prompt:\s*nativeVideoRequest\.prompt/, "the expanded follow-up prompt should reach Media Studio");
assert.match(routeSource, /sourceArtifacts:\s*nativeVideoRequest\.sourceArtifacts/, "the source thumbnail should reach the live generation card");

console.log("Video follow-ups reuse the prior prompt and source image without hijacking ordinary questions.");
