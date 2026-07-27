import { NextRequest } from "next/server";
import {
  RESEARCH_BRIDGE_PROTOCOL,
  researchBridgeCorsHeaders,
  researchBridgeTokenConfigured,
  withResearchBridgeCors,
} from "@/lib/services/research-bridge";
import { okJson } from "@/lib/utils/api-response";

// Presence probe for hivemindos.app/research: origin-locked CORS means only
// the allowed origins can READ the answer; it carries no data beyond "the app
// is here and whether a bridge token exists yet".
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  return new Response(null, { status: 204, headers: researchBridgeCorsHeaders(request.headers.get("origin")) });
}

export async function GET(request: NextRequest) {
  return withResearchBridgeCors(
    okJson({
      app: "hivemindos",
      bridge: RESEARCH_BRIDGE_PROTOCOL,
      authRequired: true,
      tokenConfigured: await researchBridgeTokenConfigured(),
    }),
    request.headers.get("origin"),
  );
}
