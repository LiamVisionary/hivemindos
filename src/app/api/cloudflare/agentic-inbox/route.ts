import { NextRequest, NextResponse } from "next/server";
import { AGENTIC_INBOX_BLUEPRINT } from "@/lib/services/cloudflare/agentic-inbox-blueprint";
import { deployAgenticInbox, provisionAgenticInboxAddress, readAgenticInboxStatus, scaffoldAgenticInbox } from "@/lib/services/cloudflare/agentic-inbox-setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    blueprint: AGENTIC_INBOX_BLUEPRINT,
    status: await readAgenticInboxStatus(),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { action?: unknown; localPart?: unknown; address?: unknown };
  const action = String(body.action || "status");
  try {
    if (action === "status") return NextResponse.json({ ok: true, status: await readAgenticInboxStatus() });
    if (action === "scaffold" || action === "install") {
      const result = await scaffoldAgenticInbox();
      return NextResponse.json({ ok: true, result, status: await readAgenticInboxStatus() });
    }
    if (action === "deploy" || action === "start") {
      const result = await deployAgenticInbox();
      return NextResponse.json({ ok: true, result, status: await readAgenticInboxStatus() });
    }
    if (action === "provision") {
      const localPart = String((typeof body.localPart === "string" && body.localPart) || (typeof body.address === "string" && body.address) || "");
      const result = await provisionAgenticInboxAddress({ localPart });
      return NextResponse.json({ ok: true, result, status: await readAgenticInboxStatus() });
    }
    return NextResponse.json({ ok: false, error: `Unsupported Agentic Inbox action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Agentic Inbox setup failed." }, { status: 400 });
  }
}
