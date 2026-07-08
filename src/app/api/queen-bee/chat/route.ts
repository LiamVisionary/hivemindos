import { NextRequest, NextResponse } from "next/server";

import {
  runQueenChatTurn,
  runQueenChatTurnStream,
} from "@/lib/services/queen-bee/typed-chat-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new Response(null, { status: 204 });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === "chat-turn") {
      return await runQueenChatTurn(body, request.nextUrl.origin);
    }
    if (body.action === "chat-turn-stream") {
      return await runQueenChatTurnStream(body, request.nextUrl.origin);
    }
    throw new Error(`Unknown Queen Bee chat action: ${String(body.action ?? "")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queen Bee chat request failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
