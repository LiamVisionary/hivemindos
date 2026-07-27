import { NextRequest } from "next/server";
import {
  RESEARCH_BRIDGE_TOKEN_HEADER,
  buildResearchBridgeRecall,
  researchBridgeCorsHeaders,
  takeResearchBridgeRecallToken,
  verifyResearchBridgeToken,
  withResearchBridgeCors,
} from "@/lib/services/research-bridge";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { verifyAuth } from "@/lib/utils/server-auth";

// READ-ONLY shared-brain recall for hivemindos.app/research. The dedicated
// bridge token is an alternative to dashboard auth, never a replacement (the
// generated-media pattern): a request with neither is 401. Output is scrubbed
// in the service — title/type/date/excerpt only.
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
  // After auth on purpose: a 401 spray can't starve the paired page, and a
  // stolen-but-valid token still can't bulk-exfiltrate the shared brain.
  if (!takeResearchBridgeRecallToken()) {
    return cors(request, errorJson("Brain recall is rate-limited. Try again in a minute.", 429));
  }
  try {
    const body = await request.json().catch(() => null) as { query?: unknown; limit?: unknown } | null;
    const query = typeof body?.query === "string" ? body.query : "";
    if (!query.trim()) return cors(request, errorJson("query is required.", 400));
    const recall = await buildResearchBridgeRecall({
      query,
      limit: typeof body?.limit === "number" ? body.limit : undefined,
    });
    return cors(request, okJson({ ...recall }));
  } catch {
    // Generic on purpose: raw error messages can carry absolute local paths,
    // and this response crosses an origin boundary.
    return cors(request, errorJson("Brain recall failed.", 500));
  }
}
