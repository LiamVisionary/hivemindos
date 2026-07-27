#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-chat-skill-autoresearch-"));
const vaultPath = join(tempHome, "vault");
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

let runtimeServer;

try {
  const attribution = await import("../src/lib/services/chat/skill-attribution.ts");
  const sessionStore = await import("../src/lib/services/chat/runtime-session-store.ts");
  const { readSkillAnalytics } = await import("../src/lib/services/skills/skill-os.ts");

  const installedSkills = [
    { slug: "research-brief", name: "Research Brief" },
    { slug: "source-checker", name: "Source Checker" },
  ];
  assert.deepEqual(
    attribution.attributeChatSkills({
      prompt: "Use research-brief to investigate this topic.",
      installedSkills,
      preferredSkillSlugs: [],
    }),
    [{ skillSlug: "research-brief", source: "explicit-prompt" }],
    "an explicitly named installed skill should be attributed to the turn",
  );
  assert.deepEqual(
    attribution.attributeChatSkills({
      prompt: "Investigate this topic.",
      installedSkills,
      preferredSkillSlugs: ["source-checker", "not-installed"],
    }),
    [{ skillSlug: "source-checker", source: "agent-preferred" }],
    "an installed skill selected on the agent profile should be attributed on typed and voice turns",
  );
  assert.deepEqual(
    attribution.attributeChatSkills({
      prompt: "Investigate this topic.",
      installedSkills,
      preferredSkillSlugs: [],
      retrievedSkillSlugs: ["research-brief"],
    }),
    [],
    "mere retrieval is context, not proof that a skill was selected",
  );

  await mkdir(join(vaultPath, "Skills", "research-brief"), { recursive: true });
  await writeFile(
    join(vaultPath, "Skills", "research-brief", "SKILL.md"),
    "---\nname: Research Brief\ndescription: Research with sources.\n---\n\n# Research Brief\n",
  );
  await mkdir(join(vaultPath, "Skills", "route-skill"), { recursive: true });
  await writeFile(
    join(vaultPath, "Skills", "route-skill", "SKILL.md"),
    "---\nname: Route Skill\ndescription: Produce concise project updates.\n---\n\n# Route Skill\n",
  );

  runtimeServer = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/chat") {
      response.end(JSON.stringify({ text: "This is a substantive project update produced through the real regular-chat HTTP dispatch path." }));
      return;
    }
    response.end(JSON.stringify({ apps: [], items: [] }));
  });
  runtimeServer.listen(0, "127.0.0.1");
  await once(runtimeServer, "listening");
  const runtimeAddress = runtimeServer.address();
  const runtimeOrigin = `http://127.0.0.1:${runtimeAddress.port}`;
  const chatRoute = await import("../src/app/api/chat/agent-runtime/route.ts");
  const routeSessionId = "chat-skill-route-e2e";
  const routeResponse = await chatRoute.POST(new Request(`${runtimeOrigin}/api/chat/agent-runtime`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent: {
        id: "route-agent",
        name: "Route Agent",
        runtime: "hermes",
        gatewayUrl: runtimeOrigin,
        chatPath: "/chat",
        preferredSkillSlugs: ["route-skill"],
      },
      messages: [{ role: "user", content: "Write a concise project update." }],
      sharedVault: { enabled: true, vaultPath, syncProvider: "external" },
      runtimeSessionId: routeSessionId,
      clientRunId: "route-turn-1",
      suppressWalletIntents: true,
    }),
  }));
  const routeStream = await routeResponse.text();
  assert.equal(routeResponse.status, 200);
  assert.match(routeStream, /real regular-chat HTTP dispatch path/);
  assert.match(routeStream, /\[DONE\]/);
  const routeSession = await sessionStore.readRuntimeChatSession({ sessionId: routeSessionId });
  assert.deepEqual(
    routeSession.messages.find((message) => message.role === "assistant").skillAttribution,
    [{ skillSlug: "route-skill", source: "agent-preferred" }],
    "the real regular chat route persists selected skill attribution through HTTP dispatch and completion",
  );
  const invalidVoiceSessionId = "chat-skill-invalid-voice";
  const invalidVoiceResponse = await chatRoute.POST(new Request(`${runtimeOrigin}/api/chat/agent-runtime`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent: {
        id: "invalid-voice-agent",
        name: "Invalid Voice Agent",
        runtime: "hermes",
        gatewayUrl: "",
        preferredSkillSlugs: ["route-skill"],
      },
      messages: [{ role: "user", content: "Write a concise project update." }],
      sharedVault: { enabled: true, vaultPath, syncProvider: "external" },
      runtimeSessionId: invalidVoiceSessionId,
      clientRunId: "invalid-voice-turn",
      latencyMode: "voice",
      suppressWalletIntents: true,
    }),
  }));
  assert.equal(invalidVoiceResponse.status, 400);
  const invalidVoiceSession = await sessionStore.readRuntimeChatSession({ sessionId: invalidVoiceSessionId });
  assert.equal(invalidVoiceSession.endReason, "failed", "voice validation failures close the attributed turn instead of leaving it dangling");

  const agent = {
    id: "chat-skill-agent",
    name: "Chat Skill Agent",
    runtime: "hermes",
    gatewayUrl: "http://127.0.0.1:1",
  };
  const selectedSkill = [{ skillSlug: "research-brief", source: "explicit-prompt" }];
  const multiTurnSessionId = "chat-skill-multi-turn";
  for (const turnId of ["turn-1", "turn-2"]) {
    await sessionStore.startRuntimeChatSession({
      sessionId: multiTurnSessionId,
      turnId,
      agent,
      sharedVaultPath: vaultPath,
      userContent: "Use research-brief for the same request.",
      skillAttribution: selectedSkill,
      startedAt: 1_800_000_000_000,
    });
    await sessionStore.appendRuntimeChatSessionText(multiTurnSessionId, "assistant", "No.");
    await sessionStore.finishRuntimeChatSession(multiTurnSessionId, "failed");
  }
  const multiTurn = await sessionStore.readRuntimeChatSession({ sessionId: multiTurnSessionId });
  assert.equal(multiTurn.messages.filter((message) => message.role === "user").length, 2, "identical text in distinct turns remains distinct");
  assert.equal(multiTurn.messages.filter((message) => message.role === "assistant").length, 2, "assistant chunks never merge across turns");
  assert.deepEqual(
    multiTurn.messages.filter((message) => message.role === "assistant").map((message) => message.skillAttribution),
    [selectedSkill, selectedSkill],
    "the selected skill follows each turn onto the assistant outcome",
  );

  const noAttributionSessionId = "chat-skill-retrieval-only";
  await sessionStore.startRuntimeChatSession({
    sessionId: noAttributionSessionId,
    turnId: "turn-retrieval-only",
    agent,
    sharedVaultPath: vaultPath,
    userContent: "Investigate this topic.",
    skillAttribution: [],
  });
  await sessionStore.appendRuntimeChatSessionText(noAttributionSessionId, "assistant", "No.");
  await sessionStore.finishRuntimeChatSession(noAttributionSessionId, "failed");

  const receiptSessionId = "chat-skill-runtime-receipt";
  await sessionStore.startRuntimeChatSession({
    sessionId: receiptSessionId,
    turnId: "turn-runtime-receipt",
    agent,
    sharedVaultPath: vaultPath,
    userContent: "Investigate this topic.",
    skillAttribution: [],
  });
  await sessionStore.appendRuntimeChatSessionEvent(
    receiptSessionId,
    "Command",
    `cat ${join(vaultPath, "Skills", "research-brief", "SKILL.md")}`,
    { command: `cat ${join(vaultPath, "Skills", "research-brief", "SKILL.md")}` },
  );
  await sessionStore.appendRuntimeChatSessionText(receiptSessionId, "assistant", "No.");
  await sessionStore.finishRuntimeChatSession(receiptSessionId, "failed");
  const receiptSession = await sessionStore.readRuntimeChatSession({ sessionId: receiptSessionId });
  assert.deepEqual(
    receiptSession.messages.find((message) => message.role === "assistant").skillAttribution,
    [{ skillSlug: "research-brief", source: "runtime-receipt" }],
    "a tool receipt that loads a skill upgrades the active turn to exact runtime attribution",
  );
  const { readBrainReviewQueue } = await import("../src/lib/services/brain-review-queue.ts");
  const reviewQueue = await readBrainReviewQueue();
  assert.equal(
    reviewQueue.proposals.filter((proposal) => proposal.kind === "skill-evolution" && proposal.metadata?.skillSlug === "research-brief").length,
    1,
    "three distinct attributed chat failures create one review-gated autoresearch proposal end to end",
  );

  const feedbackSessionId = "chat-skill-feedback";
  await sessionStore.startRuntimeChatSession({
    sessionId: feedbackSessionId,
    turnId: "turn-feedback",
    agent,
    sharedVaultPath: vaultPath,
    userContent: "Use research-brief.",
    skillAttribution: selectedSkill,
  });
  await sessionStore.appendRuntimeChatSessionText(
    feedbackSessionId,
    "assistant",
    "This is a substantive sourced response that satisfies the automatic chat evaluator.",
  );
  await sessionStore.finishRuntimeChatSession(feedbackSessionId, "completed");
  const feedbackSession = await sessionStore.readRuntimeChatSession({ sessionId: feedbackSessionId });
  const feedbackMessage = feedbackSession.messages.find((message) => message.role === "assistant");
  await sessionStore.startRuntimeChatSession({
    sessionId: feedbackSessionId,
    turnId: "turn-after-feedback-target",
    agent,
    sharedVaultPath: vaultPath,
    userContent: "A later unrelated turn.",
    skillAttribution: [],
  });
  await sessionStore.appendRuntimeChatSessionText(feedbackSessionId, "assistant", "No.");
  await sessionStore.finishRuntimeChatSession(feedbackSessionId, "failed");
  const disliked = await sessionStore.recordRuntimeChatSessionMessageFeedback(feedbackSessionId, feedbackMessage.index, "down");
  assert.equal(disliked.skillOutcomes[0].event.status, "failure", "negative chat feedback corrects the skill outcome to failure");
  const cleared = await sessionStore.recordRuntimeChatSessionMessageFeedback(feedbackSessionId, feedbackMessage.index, null);
  assert.equal(cleared.skillOutcomes[0].event.status, "success", "clearing feedback restores the automatic skill outcome");
  assert.equal(cleared.evaluation.verdict, "accepted", "feedback on an older message uses that turn's completion state, not the newest turn's failure");

  const analytics = await readSkillAnalytics(100);
  assert.equal(
    analytics.some((event) => event.skillSlug === "route-skill" && event.taskSource === `chat:${routeSessionId}:route-turn-1` && event.status === "success"),
    true,
    "the regular chat route records its evaluated skill outcome in app-wide analytics",
  );
  const repeatedTurnEvents = analytics.filter((event) => event.skillSlug === "research-brief" && event.taskSource?.startsWith(`chat:${multiTurnSessionId}:`));
  assert.equal(repeatedTurnEvents.length, 2);
  assert.equal(new Set(repeatedTurnEvents.map((event) => event.taskSource)).size, 2, "each chat turn has a stable, distinct execution key");
  assert.equal(
    analytics.some((event) => event.taskSource === `chat:${noAttributionSessionId}:turn-retrieval-only`),
    false,
    "a retrieved-only skill cannot feed autoresearch analytics",
  );
  assert.equal(
    analytics.some((event) => event.taskSource === `chat:${receiptSessionId}:turn-runtime-receipt` && event.status === "failure"),
    true,
    "runtime receipt attribution feeds the same app-wide analytics stream",
  );

  const [routeSource, fusionSource, mobileSource, packageJson] = await Promise.all([
    readFile(new URL("../src/app/api/chat/agent-runtime/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/services/fusion/route-stream.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/services/mobile-agents/chat-turn.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const centralStart = routeSource.indexOf("const runtimeSession = await startRuntimeChatSession");
  assert(centralStart > 0 && centralStart < routeSource.indexOf("if (isFusionProfile(profile))"), "all chat branches start the attributed turn before dispatch");
  assert.match(routeSource, /resolveChatSkillAttribution/);
  assert.match(routeSource, /turnId/);
  assert.match(fusionSource, /appendRuntimeChatSessionText/);
  assert.match(fusionSource, /finishRuntimeChatSession/);
  assert.match(mobileSource, /turnId: input\.turnId/);
  assert.match(packageJson, /test-chat-skill-autoresearch\.mjs/);

  console.log("chat skill attribution, multi-turn outcomes, feedback correction, and cross-runtime contracts passed");
} finally {
  if (runtimeServer) await new Promise((resolve) => runtimeServer.close(resolve));
  await rm(tempHome, { recursive: true, force: true });
}
