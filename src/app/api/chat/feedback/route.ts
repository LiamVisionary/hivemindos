import { NextRequest } from "next/server";
import { recordRuntimeChatSessionMessageFeedback } from "@/lib/services/chat/runtime-session-store";
import type { EvaluationHumanFeedbackRating } from "@/lib/types/evaluation";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatFeedbackRequest = {
  sessionId?: unknown;
  chatStorageKey?: unknown;
  messageIndex?: unknown;
  messageFingerprint?: unknown;
  rating?: unknown;
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as ChatFeedbackRequest | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  const chatStorageKey = typeof body?.chatStorageKey === "string" ? body.chatStorageKey.trim() : "";
  const messageIndex = typeof body?.messageIndex === "number" ? body.messageIndex : Number.NaN;
  const messageFingerprint = typeof body?.messageFingerprint === "string" ? body.messageFingerprint.trim() : "";
  const rating = body?.rating === null ? null : body?.rating as EvaluationHumanFeedbackRating | undefined;
  const validFingerprint = /^[a-z0-9]{1,16}$/.test(messageFingerprint);
  if (!sessionId || sessionId.length > 200 || chatStorageKey.length > 500 || ((!Number.isInteger(messageIndex) || messageIndex < 0) && !validFingerprint)) {
    return errorJson("Expected a runtime session id plus an assistant message index or output fingerprint.");
  }
  if (rating !== null && rating !== "up" && rating !== "down") {
    return errorJson("Rating must be up, down, or null.");
  }
  try {
    const result = await recordRuntimeChatSessionMessageFeedback(sessionId, messageIndex, rating, { messageFingerprint, chatStorageKey });
    return okJson({
      feedback: result.message.feedback ?? null,
      evaluation: result.evaluation,
      skillOutcomes: result.skillOutcomes.map(({ event, review }) => ({
        skillSlug: event.skillSlug,
        status: event.status,
        autoresearchProposals: review.enqueued.length,
      })),
      skillOutcomeError: result.skillOutcomeError ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save chat feedback.";
    return errorJson(message, /not found/i.test(message) ? 404 : 500);
  }
}
