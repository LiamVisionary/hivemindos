import { NextRequest } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

import { finishDashboardPasskeyRegistration } from "@/lib/services/dashboard-passkeys";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";
import { clearPasskeyCeremonyCookie, readPasskeyCeremonyId } from "@/app/api/auth/passkeys/_route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as { response?: RegistrationResponseJSON } | null;
  if (!body?.response) return errorJson("A device-passkey registration response is required.", 400);
  try {
    const passkey = await finishDashboardPasskeyRegistration({
      ceremonyId: readPasskeyCeremonyId(request),
      request,
      response: body.response,
    });
    const response = okJson({ passkey });
    clearPasskeyCeremonyCookie(response, request);
    return response;
  } catch (error) {
    const response = errorJson(error instanceof Error ? error.message : "Device-passkey registration failed.", 400);
    clearPasskeyCeremonyCookie(response, request);
    return response;
  }
}

