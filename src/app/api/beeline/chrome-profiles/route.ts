import { NextRequest } from "next/server";
import { listChromeProfiles } from "@/lib/services/beeline/chrome-profiles";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { verifyAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth.userId) return errorJson(auth.reason ?? "Dashboard authentication is required.", 401);
  try {
    return okJson({ profiles: await listChromeProfiles() });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not read Chrome profiles.", 500);
  }
}

