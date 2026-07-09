import { NextRequest } from "next/server";

import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";
import { resolveXTranscript } from "@/lib/services/x-transcript/x-transcript-service";
import { looksLikeXPost } from "@/lib/services/x-transcript/x-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long videos download + transcribe in chunks; give the whole pipeline room.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => ({})) as { url?: unknown; summarize?: unknown };
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return errorJson("An X post URL is required.", 400);
  if (!looksLikeXPost(url)) return errorJson("That doesn't look like an X post link. Paste a link like https://x.com/user/status/123…", 400);

  try {
    const result = await resolveXTranscript({ request, url, summarize: body.summarize === true });
    return okJson({ result });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not pull the transcript.", 502);
  }
}
