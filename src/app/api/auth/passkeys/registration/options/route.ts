import { NextRequest } from "next/server";

import { beginDashboardPasskeyRegistration } from "@/lib/services/dashboard-passkeys";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";
import { setPasskeyCeremonyCookie } from "@/app/api/auth/passkeys/_route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const registration = await beginDashboardPasskeyRegistration(request);
    const response = okJson({ options: registration.options });
    setPasskeyCeremonyCookie(response, request, registration.ceremonyId);
    return response;
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not start device-passkey registration.", 400);
  }
}

