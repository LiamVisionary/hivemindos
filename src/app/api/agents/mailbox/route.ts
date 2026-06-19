import { NextRequest, NextResponse } from "next/server";
import { createAgentMailbox, readAgentMailboxOverview } from "@/lib/services/agent-mailboxes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const agentId = request.nextUrl.searchParams.get("agentId") || undefined;
    const liveCheck = request.nextUrl.searchParams.get("liveCheck") === "1";
    return NextResponse.json({ ok: true, ...(await readAgentMailboxOverview({ agentId, liveCheck })) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Agent mailbox status failed." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { action?: unknown; agentId?: unknown; agentName?: unknown };
    const action = String(body.action || "create");
    if (action !== "create") {
      return NextResponse.json({ ok: false, error: `Unsupported agent mailbox action: ${action}` }, { status: 400 });
    }
    if (typeof body.agentId !== "string") {
      return NextResponse.json({ ok: false, error: "agentId is required." }, { status: 400 });
    }
    const result = await createAgentMailbox({
      agentId: body.agentId,
      agentName: typeof body.agentName === "string" ? body.agentName : undefined,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Agent mailbox creation failed." }, { status: 400 });
  }
}
