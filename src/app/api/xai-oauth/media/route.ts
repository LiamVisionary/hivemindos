import { NextRequest, NextResponse } from "next/server";

import {
  xaiOAuthMediaRequest,
  type XaiOAuthMediaRequest,
} from "@/lib/services/xai-oauth-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as XaiOAuthMediaRequest;
  try {
    return NextResponse.json({ ok: true, result: await xaiOAuthMediaRequest(body) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "xAI OAuth media request failed." },
      { status: 400 },
    );
  }
}
