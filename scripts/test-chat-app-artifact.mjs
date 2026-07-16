#!/usr/bin/env node
import assert from "node:assert/strict";

const {
  CHAT_APP_ARTIFACT_PROTOCOL,
  chatAppArtifactFromProject,
  chatAppProjectDirectory,
  chatAppProjectName,
  chatAppTemplateForTask,
  chatWorkingDirectoryForThread,
  inferLegacyChatAppDirectory,
  latestChatAppArtifact,
  normalizeChatAppArtifact,
} = await import("../src/lib/services/chat/chat-app-artifact.ts");

assert.equal(chatAppTemplateForTask("build me a flappy bird clone in html and css"), "static");
assert.equal(chatAppTemplateForTask("create a Next.js app with an API"), "nextjs");
assert.equal(chatAppProjectName("build me a flappy bird clone in html and css"), "a flappy bird clone in html and css");
assert.equal(
  chatAppProjectDirectory("/workspace", "build me a flappy bird clone", "plan_ABC12345_rest"),
  "/workspace/scratchpad/a-flappy-bird-clone-planabc1",
);
assert.equal(
  chatAppProjectDirectory("C:\\workspace", "make a game", "plan_12345678"),
  "C:\\workspace\\scratchpad\\a-game-plan1234",
);
assert.equal(chatWorkingDirectoryForThread([
  { storageKey: "thread-a", workingDirectoryPath: "/root/hivemindos-collector-current" },
], "thread-a", "/fallback"), "/root/hivemindos-collector-current");
assert.equal(chatWorkingDirectoryForThread([], "thread-a", "/fallback"), "/fallback");

const artifact = chatAppArtifactFromProject({
  id: "local_flappy",
  name: "Flappy Bird",
  directory: "/workspace/scratchpad/flappy",
  templateId: "static",
  status: "running",
  dependenciesReady: true,
  port: 4173,
  createdAt: "2026-07-15T12:00:00.000Z",
  updatedAt: "2026-07-15T12:01:00.000Z",
}, { key: "ubuntu", name: "Ubuntu" });
assert.equal(artifact.protocol, CHAT_APP_ARTIFACT_PROTOCOL);
assert.equal(artifact.projectId, "local_flappy");
assert.equal(artifact.machineKey, "ubuntu");
assert.equal(artifact.port, 4173);
assert.deepEqual(normalizeChatAppArtifact(artifact), artifact);
assert.equal(latestChatAppArtifact([{ role: "assistant", appArtifact: artifact }])?.projectId, "local_flappy");
assert.equal(normalizeChatAppArtifact({ ...artifact, protocol: "untrusted" }), undefined);

const exactLegacyDirectory = "/root/hivemindos-collector-current/scratchpad/flappy-bird-clone";
assert.equal(inferLegacyChatAppDirectory([
  { role: "user", content: `Location:\n\`${exactLegacyDirectory}\`` },
  { role: "assistant", content: "Location:\n`/tmp/not-the-workspace`" },
  { role: "assistant", content: `Built and verified.\n\nLocation:\n\`${exactLegacyDirectory}\`` },
], "/root/hivemindos-collector-current"), exactLegacyDirectory);
assert.equal(inferLegacyChatAppDirectory([
  { role: "user", content: `Location:\n\`${exactLegacyDirectory}\`` },
], "/root/hivemindos-collector-current"), "", "user-authored paths must not be adopted");
assert.equal(inferLegacyChatAppDirectory([
  { role: "assistant", content: "Location:\n`/root/another-workspace/app`" },
], "/root/hivemindos-collector-current"), "", "paths outside the selected workspace must not be adopted");

console.log("chat-app-artifact: all assertions passed");
