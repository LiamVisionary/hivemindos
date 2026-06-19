import { NextRequest, NextResponse } from "next/server";
import { buildClearSigningReview, normalizeClearSigningKind, type ClearSigningReviewInput } from "@/lib/services/crypto/clear-signing";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({
    ok: true,
    kinds: ["x402", "send", "private-transfer", "bankr-action", "crosschain-intent", "agent-identity", "raw-transaction"],
    note: "POST an action draft to receive a clear-signing review. This route never signs or executes.",
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as ClearSigningReviewInput;
    const review = buildClearSigningReview({
      ...body,
      kind: normalizeClearSigningKind(body.kind ?? body.intent),
    });
    return NextResponse.json({ ok: true, review });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not build clear-signing review.",
    }, { status: 400 });
  }
}
