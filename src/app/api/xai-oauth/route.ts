// guard:allow-hive-action-route - dashboard-only xAI OAuth connect flow;
// launches the user's interactive browser sign-in and is intentionally NOT an
// agent-invokable Hive action (agents must never initiate credential grants).
import { NextRequest, NextResponse } from "next/server";

import {
  startXaiOAuthLogin,
  submitXaiOAuthCode,
  xaiOAuthLoginState,
  xaiOAuthStatus,
} from "@/lib/services/xai-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hermesHomesFromSearch(request: NextRequest) {
  return [
    ...request.nextUrl.searchParams.getAll("hermesHome"),
    ...request.nextUrl.searchParams.getAll("hermesHomes"),
  ];
}

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({
      ok: true,
      ...(await xaiOAuthStatus({
        hermesHomes: hermesHomesFromSearch(request),
        syncFromHermes: request.nextUrl.searchParams.get("sync") === "1",
        validateAccess: true,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "xAI OAuth status failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    code?: unknown;
    hermesHomes?: unknown;
  };
  try {
    if (body.action === "start") {
      const { authorizeUrl } = await startXaiOAuthLogin();
      return NextResponse.json({
        ok: true,
        authorizeUrl,
        statusEndpoint: "/api/xai-oauth",
        message: "xAI sign-in opened in your browser. Finish the OAuth page to connect Grok.",
      });
    }
    if (body.action === "status") {
      return NextResponse.json({
        ok: true,
        ...(await xaiOAuthStatus({
          hermesHomes: body.hermesHomes,
          syncFromHermes: true,
          validateAccess: true,
        })),
      });
    }
    if (body.action === "submit-code") {
      const { warnings } = await submitXaiOAuthCode({ code: body.code });
      return NextResponse.json({
        ok: true,
        connected: true,
        warnings,
        statusEndpoint: "/api/xai-oauth",
        message: "xAI OAuth connected. The HivemindOS-owned local session will refresh automatically.",
      });
    }
    if (body.action === "login-state") {
      return NextResponse.json({ ok: true, login: xaiOAuthLoginState() });
    }
    return NextResponse.json({ ok: false, error: `Unknown action: ${body.action ?? ""}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "xAI OAuth action failed." },
      { status: 500 },
    );
  }
}
