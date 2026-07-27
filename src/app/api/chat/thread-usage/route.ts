import { NextRequest } from "next/server";

import { readChatThreadUsage } from "@/lib/services/chat/thread-usage";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const chatStorageKey = request.nextUrl.searchParams.get("chatStorageKey")?.trim() ?? "";
  if (!chatStorageKey) return errorJson("A chatStorageKey query parameter is required.", 400);
  try {
    const usage = await readChatThreadUsage(chatStorageKey);
    return okJson(usage);
  } catch (error) {
    return upstreamErrorJson("Could not read chat thread usage", error);
  }
}
