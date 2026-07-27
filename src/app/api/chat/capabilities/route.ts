import { NextRequest, NextResponse } from "next/server";

import { runInvokeHiveCapabilityTool } from "@/app/api/chat/agent-runtime/invoke-hive-capability-tool";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin, governed execution surface for tool-capable clients that do not run
 * inside the desktop chat route (notably HivemindOS Mobile's phone-local
 * model). The implementation remains the desktop chat tool's implementation,
 * so MCP/app/Hive Action discovery, confirmation tokens, and mutation policy
 * cannot drift between desktop and mobile.
 *
 * Mobile is intentionally pinned to `manual`: a phone-local model cannot turn
 * a request into Bypass mode. Mutating calls therefore return the same
 * approval-required envelope as desktop until the current user message is an
 * exact declared confirmation token.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as {
      input?: string | Record<string, unknown>;
      userText?: string;
    };
    const outcome = await runInvokeHiveCapabilityTool(body.input ?? {}, {
      origin: new URL(request.url).origin,
      permissionMode: "manual",
      userText: typeof body.userText === "string" ? body.userText : "",
    });
    return NextResponse.json({ ok: outcome.ok, outcome });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Hive capability request failed.",
    }, { status: 400 });
  }
}
