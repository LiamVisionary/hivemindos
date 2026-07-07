import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import { replyToCompanyEmailThread } from "@/lib/services/agent-mailboxes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reply into a company crew email thread from the mobile inbox. Device-token
// gated (requireAuth) so the phone sends through an authenticated hub route
// instead of touching the unauthenticated inbox Worker directly. AgentMail
// threads only for now; other providers return a clear "not supported" error.
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  let body: { threadId?: unknown; text?: unknown; html?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!threadId) return NextResponse.json({ ok: false, error: "threadId is required." }, { status: 400 });
  if (!text.trim()) return NextResponse.json({ ok: false, error: "Reply text is required." }, { status: 400 });

  try {
    const result = await replyToCompanyEmailThread({
      threadId,
      text,
      html: typeof body.html === "string" ? body.html : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to send the reply." },
      { status: 400 },
    );
  }
}
