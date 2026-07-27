// guard:allow-hive-action-route - dashboard-only ChatGPT OAuth connect flow;
// launches the user's interactive browser sign-in and is intentionally NOT an
// agent-invokable Hive action (agents must never initiate credential grants).
import { NextRequest, NextResponse } from "next/server";

import {
  openAiOAuthLoginState,
  openAiOAuthStatus,
  startOpenAiOAuthLogin,
} from "@/lib/services/openai-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ChatGPT OAuth connection surface: status for settings UIs, and the sign-in
 * flow starter. The flow binds the OAuth client's registered localhost
 * callback port (1455) inside THIS server process, so the browser callback
 * lands here and the tokens are written straight to the shared hive env
 * (fleet-replicating; separate from OPENAI_API_KEY).
 */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await openAiOAuthStatus()) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "OAuth status failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  try {
    if (body.action === "start") {
      const { authorizeUrl } = await startOpenAiOAuthLogin();
      return NextResponse.json({ ok: true, authorizeUrl });
    }
    if (body.action === "login-state") {
      return NextResponse.json({ ok: true, login: openAiOAuthLoginState() });
    }
    return NextResponse.json({ ok: false, error: `Unknown action: ${body.action ?? ""}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "OAuth action failed." },
      { status: 500 },
    );
  }
}
