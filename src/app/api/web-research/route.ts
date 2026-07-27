import { NextRequest } from "next/server";
import { webResearchStatus } from "@/lib/services/web-research/service";
import { okJson } from "@/lib/utils/api-response";
import { requireAuthContext } from "@/lib/utils/server-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;
  return okJson(webResearchStatus());
}
