import { NextRequest } from "next/server";

import { beginDashboardPasskeyAuthentication } from "@/lib/services/dashboard-passkeys";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { setPasskeyCeremonyCookie } from "@/app/api/auth/passkeys/_route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const authentication = await beginDashboardPasskeyAuthentication(request);
    const response = okJson({ options: authentication.options });
    setPasskeyCeremonyCookie(response, request, authentication.ceremonyId);
    return response;
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not start device authentication.", 400);
  }
}

