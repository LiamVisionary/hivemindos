import {
  buildChatThreadTitleContext,
  parseChatThreadTitleConfig,
  type ChatThreadTitleContext,
} from "@/lib/config/chat-thread-title";
import { generateChatThreadTitle } from "@/lib/services/chat/thread-title";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";

function parseContext(value: unknown): ChatThreadTitleContext | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { firstUserTurn?: unknown; latestUserTurn?: unknown; assistantReply?: unknown };
  return buildChatThreadTitleContext([
    { role: "user", content: String(record.firstUserTurn ?? ""), surface: "chat" },
    { role: "user", content: String(record.latestUserTurn ?? ""), surface: "chat" },
  ], typeof record.assistantReply === "string" ? record.assistantReply : undefined);
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as { config?: unknown; context?: unknown } | null;
  const config = parseChatThreadTitleConfig(body?.config);
  if (config.mode === "off") return errorJson("Automatic thread titles are disabled.");
  const context = parseContext(body?.context);
  if (!context) return errorJson("A substantive user turn is required.");
  try {
    const result = await generateChatThreadTitle(config, context);
    return okJson(result);
  } catch (error) {
    return upstreamErrorJson("Could not generate the chat thread title", error);
  }
}
