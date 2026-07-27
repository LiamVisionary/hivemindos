#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-chat-feedback-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const sessionStore = await import("../src/lib/services/chat/runtime-session-store.ts");
const { evaluationOutputFingerprint } = await import("../src/lib/services/evaluation/control-plane.ts");

try {
  assert.equal(
    typeof sessionStore.recordRuntimeChatSessionMessageFeedback,
    "function",
    "runtime chat sessions expose a durable message-feedback writer",
  );

  const sessionId = "feedback-accepted";
  await sessionStore.startRuntimeChatSession({
    sessionId,
    agent: { id: "feedback-agent", name: "Feedback Agent", runtime: "hermes" },
    userContent: "Give me a useful answer.",
    startedAt: 1_800_000_000_000,
  });
  await sessionStore.appendRuntimeChatSessionEvent(sessionId, "Hive capability search", "One process event before the answer.");
  await sessionStore.appendRuntimeChatSessionText(
    sessionId,
    "assistant",
    "This is a substantive assistant response that satisfies the automatic chat evaluation.",
  );
  await sessionStore.finishRuntimeChatSession(sessionId);

  const initial = await sessionStore.readRuntimeChatSession({ sessionId });
  const assistantIndex = initial.messages.find((message) => message.role === "assistant").index;
  assert.equal(initial.evaluation.verdict, "accepted");

  const liked = await sessionStore.recordRuntimeChatSessionMessageFeedback(sessionId, assistantIndex, "up", {
    now: () => 1_800_000_000_500,
  });
  assert.equal(liked.message.feedback.rating, "up");
  assert.equal(liked.message.feedback.providedAt, 1_800_000_000_500);
  assert.equal(liked.evaluation.verdict, "accepted");
  assert.equal(liked.evaluation.humanFeedback.rating, "up");
  assert.equal(liked.evaluation.routingEligible, false, "chat feedback must not manufacture worker-routing history");

  const disliked = await sessionStore.recordRuntimeChatSessionMessageFeedback(sessionId, assistantIndex, "down", {
    now: () => 1_800_000_000_600,
  });
  assert.equal(disliked.message.feedback.rating, "down");
  assert.equal(disliked.evaluation.verdict, "rejected", "negative human feedback downgrades the message evaluation");
  assert.equal(disliked.evaluation.checks.at(-1).id, "human-feedback");
  assert.equal(disliked.evaluation.checks.at(-1).status, "failed");

  const cleared = await sessionStore.recordRuntimeChatSessionMessageFeedback(sessionId, assistantIndex, null, {
    now: () => 1_800_000_000_700,
  });
  assert.equal(cleared.message.feedback, undefined, "clicking the selected rating again clears it");
  assert.equal(cleared.evaluation.verdict, "accepted", "clearing feedback restores the automatic evaluation");
  assert.equal(cleared.evaluation.humanFeedback, undefined);

  const fingerprintMatched = await sessionStore.recordRuntimeChatSessionMessageFeedback(sessionId, Number.NaN, "up", {
    messageFingerprint: evaluationOutputFingerprint(cleared.message.content),
    now: () => 1_800_000_000_800,
  });
  assert.equal(fingerprintMatched.message.index, assistantIndex, "live feedback can resolve the exact stored message by output fingerprint");
  assert.equal(fingerprintMatched.message.feedback.rating, "up");

  const feedbackRoute = await import("../src/app/api/chat/feedback/route.ts");
  const routeResponse = await feedbackRoute.POST(new Request("http://localhost/api/chat/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      messageIndex: assistantIndex - 1,
      messageFingerprint: evaluationOutputFingerprint(fingerprintMatched.message.content),
      rating: "down",
    }),
  }));
  const routePayload = await routeResponse.json();
  assert.equal(routeResponse.status, 200);
  assert.equal(routePayload.ok, true);
  assert.equal(routePayload.feedback.rating, "down");
  assert.equal(routePayload.evaluation.verdict, "rejected");
  assert.deepEqual(routePayload.skillOutcomes, [], "feedback without attributed skills does not fabricate autoresearch outcomes");
  assert.equal(routePayload.skillOutcomeError, null);

  const fallbackSessionId = "feedback-canonical-session";
  const fallbackChatStorageKey = "feedback-agent:chat-thread";
  await sessionStore.startRuntimeChatSession({
    sessionId: fallbackSessionId,
    agent: { id: "feedback-agent", name: "Feedback Agent", runtime: "hermes" },
    chatStorageKey: fallbackChatStorageKey,
    userContent: "Preserve the canonical HivemindOS feedback session.",
  });
  await sessionStore.appendRuntimeChatSessionText(
    fallbackSessionId,
    "assistant",
    "This response remains attributable even if provider hydration replaces the visible session id.",
  );
  await sessionStore.finishRuntimeChatSession(fallbackSessionId);
  const fallbackSession = await sessionStore.readRuntimeChatSession({ sessionId: fallbackSessionId });
  const fallbackAssistant = fallbackSession.messages.find((message) => message.role === "assistant");
  const fallbackRouteResponse = await feedbackRoute.POST(new Request("http://localhost/api/chat/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "upstream-hermes-session-id",
      chatStorageKey: fallbackChatStorageKey,
      messageIndex: 1,
      messageFingerprint: evaluationOutputFingerprint(fallbackAssistant.content),
      rating: "up",
    }),
  }));
  const fallbackRoutePayload = await fallbackRouteResponse.json();
  assert.equal(fallbackRouteResponse.status, 200, "feedback recovers the canonical local session after provider hydration replaces its id");
  assert.equal(fallbackRoutePayload.ok, true);
  assert.equal(fallbackRoutePayload.feedback.rating, "up");

  const invalidRouteResponse = await feedbackRoute.POST(new Request("http://localhost/api/chat/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, messageIndex: "0", rating: "up" }),
  }));
  assert.equal(invalidRouteResponse.status, 400, "message indexes are validated without string coercion");

  const { parseStoredChatMessageFeedback } = await import("../src/features/dashboard/dashboard-storage.ts");
  assert.deepEqual(parseStoredChatMessageFeedback(routePayload.feedback), routePayload.feedback);
  assert.equal(parseStoredChatMessageFeedback({ rating: "up", providedAt: "not-a-number" }), undefined);

  const rejectedSessionId = "feedback-rejected";
  await sessionStore.startRuntimeChatSession({
    sessionId: rejectedSessionId,
    agent: { id: "feedback-agent", name: "Feedback Agent", runtime: "hermes" },
    userContent: "Answer this.",
    startedAt: 1_800_000_001_000,
  });
  await sessionStore.appendRuntimeChatSessionText(rejectedSessionId, "assistant", "No.");
  await sessionStore.finishRuntimeChatSession(rejectedSessionId);
  const rejectedInitial = await sessionStore.readRuntimeChatSession({ sessionId: rejectedSessionId });
  const rejectedAssistantIndex = rejectedInitial.messages.find((message) => message.role === "assistant").index;
  const likedRejected = await sessionStore.recordRuntimeChatSessionMessageFeedback(rejectedSessionId, rejectedAssistantIndex, "up");
  assert.equal(likedRejected.evaluation.verdict, "rejected", "positive feedback cannot override a failed automatic check");

  await assert.rejects(
    () => sessionStore.recordRuntimeChatSessionMessageFeedback(sessionId, 999, "up"),
    /assistant message/i,
  );

  const [routeSource, threadSource, panelSource, storageSource, inputControllerSource] = await Promise.all([
    readFile(new URL("../src/app/api/chat/feedback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/dashboard/views/chat/exchange/MessageThread.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/dashboard/dashboard-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/dashboard/hooks/use-status-chat-input-controller.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(routeSource, /recordRuntimeChatSessionMessageFeedback/);
  assert.match(routeSource, /okJson/);
  assert.match(threadSource, /Good response/);
  assert.match(threadSource, /Bad response/);
  assert.match(threadSource, /aria-pressed/);
  assert.match(panelSource, /\/api\/chat\/feedback/);
  assert.match(panelSource, /sourceSessionId/);
  assert.match(panelSource, /sourceIndex/);
  assert.match(panelSource, /chatStorageKey/);
  assert.match(storageSource, /parseStoredChatMessageFeedback/);
  assert.match(inputControllerSource, /sourceSessionId: localRuntimeSessionId/);
  assert.match(threadSource, /ThumbsUp/);
  assert.match(threadSource, /ThumbsDown/);

  console.log("chat message feedback tests passed");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}
