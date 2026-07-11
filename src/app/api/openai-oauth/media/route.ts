import { NextRequest } from "next/server";

import {
  openAiOAuthMediaRequest,
  type OpenAiOAuthMediaRequest,
} from "@/lib/services/openai-oauth-media";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as OpenAiOAuthMediaRequest;
  try {
    return okJson({ result: await openAiOAuthMediaRequest(body) });
  } catch (error) {
    return errorJson(
      error instanceof Error ? error.message : "OpenAI OAuth media request failed.",
      400,
    );
  }
}
