import { NextRequest, NextResponse } from "next/server";
import {
  createBlindCompareSession,
  revealBlindCompareVote,
  type BlindCompareCandidate,
  type BlindCompareSession,
} from "@/lib/services/fusion/blind-compare";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as {
    action?: string;
    candidates?: BlindCompareCandidate[];
    session?: BlindCompareSession;
    slotId?: string;
    seed?: string;
  };
  try {
    if (body.action === "reveal") {
      if (!body.session || !body.slotId) throw new Error("session and slotId are required.");
      return NextResponse.json({ ok: true, result: revealBlindCompareVote(body.session, body.slotId) });
    }
    return NextResponse.json({
      ok: true,
      session: createBlindCompareSession(Array.isArray(body.candidates) ? body.candidates : [], { seed: body.seed }),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Blind compare failed.",
    }, { status: 400 });
  }
}
