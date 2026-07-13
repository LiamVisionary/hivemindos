import { NextRequest } from "next/server";
import {
  RESEARCH_BRIDGE_TOKEN_HEADER,
  researchBridgeCorsHeaders,
  saveResearchBridgeSkill,
  takeResearchBridgeSkillToken,
  verifyResearchBridgeToken,
  withResearchBridgeCors,
} from "@/lib/services/research-bridge";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { verifyAuth } from "@/lib/utils/server-auth";

// The one WRITE the local brain bridge allows: save a web-generated SKILL.md
// into the user's shared brain. Same gate as recall — the dedicated bridge
// token (copied from the app) OR dashboard auth; neither → 401. writeBrainSkill
// fail-closed audits the draft, so an embedded secret is rejected, never
// written. Origin-locked via CORS; rate-limited on its own tighter bucket.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cors(request: NextRequest, response: Response) {
  return withResearchBridgeCors(response, request.headers.get("origin"));
}

export async function OPTIONS(request: NextRequest) {
  return new Response(null, { status: 204, headers: researchBridgeCorsHeaders(request.headers.get("origin")) });
}

export async function POST(request: NextRequest) {
  const bridgeToken = request.headers.get(RESEARCH_BRIDGE_TOKEN_HEADER);
  if (!(await verifyResearchBridgeToken(bridgeToken))) {
    const auth = await verifyAuth(request);
    if (!auth.userId) {
      return cors(request, errorJson("A valid research bridge token is required. Copy it from the HivemindOS app.", 401));
    }
  }
  // After auth on purpose: a 401 spray can't starve a paired page, and a
  // stolen-but-valid token still can't spam the shelf.
  if (!takeResearchBridgeSkillToken()) {
    return cors(request, errorJson("Saving skills is rate-limited. Try again in a minute.", 429));
  }
  try {
    const body = await request.json().catch(() => null) as { markdown?: unknown; slug?: unknown } | null;
    if (typeof body?.markdown !== "string" || !body.markdown.trim()) {
      return cors(request, errorJson("markdown is required.", 400));
    }
    const result = await saveResearchBridgeSkill({ markdown: body.markdown, slug: body.slug });
    return cors(request, okJson({ ...result }));
  } catch (error) {
    // A blocked audit (e.g. an embedded secret) is a real, actionable reason —
    // surface a bounded message; everything else stays generic (raw errors can
    // carry absolute local paths and this response crosses an origin boundary).
    const message = error instanceof Error && /audit blocked|too large|required/i.test(error.message)
      ? error.message
      : "Saving the skill failed.";
    return cors(request, errorJson(message, 400));
  }
}
