import { NextRequest } from "next/server";
import {
  RESEARCH_BRIDGE_TOKEN_HEADER,
  researchBridgeCorsHeaders,
  saveResearchBridgeArtifact,
  takeResearchBridgeArtifactToken,
  verifyResearchBridgeToken,
  withResearchBridgeCors,
  type ResearchBridgeArtifactInput,
} from "@/lib/services/research-bridge";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { verifyAuth } from "@/lib/utils/server-auth";

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
  if (!takeResearchBridgeArtifactToken()) {
    return cors(request, errorJson("Saving Mini app artifacts is rate-limited. Try again in a minute.", 429));
  }
  try {
    const body = await request.json().catch(() => null) as ResearchBridgeArtifactInput | null;
    if (!body) return cors(request, errorJson("artifact body is required.", 400));
    const result = await saveResearchBridgeArtifact(body);
    return cors(request, okJson({ ...result }));
  } catch (error) {
    const message = error instanceof Error && /required|too large|must use|invalid|looks like it contains/i.test(error.message)
      ? error.message
      : "Saving the Mini app artifact failed.";
    return cors(request, errorJson(message, 400));
  }
}
