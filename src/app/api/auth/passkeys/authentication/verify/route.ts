import { NextRequest } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

import { finishDashboardPasskeyAuthentication } from "@/lib/services/dashboard-passkeys";
import { errorJson, okJson } from "@/lib/utils/api-response";
import {
  DASHBOARD_SESSION_COOKIE,
  createDashboardSessionCookieValue,
  dashboardSessionCookieOptions,
} from "@/lib/utils/server-auth";
import { clearPasskeyCeremonyCookie, readPasskeyCeremonyId } from "@/app/api/auth/passkeys/_route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { response?: AuthenticationResponseJSON } | null;
  if (!body?.response) return errorJson("A device-authentication response is required.", 400);
  try {
    await finishDashboardPasskeyAuthentication({
      ceremonyId: readPasskeyCeremonyId(request),
      request,
      response: body.response,
    });
    const response = okJson({ authenticated: true });
    response.cookies.set(
      DASHBOARD_SESSION_COOKIE,
      await createDashboardSessionCookieValue(),
      dashboardSessionCookieOptions(request),
    );
    clearPasskeyCeremonyCookie(response, request);
    return response;
  } catch {
    const response = errorJson("Face ID, Touch ID, or device authentication was not accepted.", 401);
    clearPasskeyCeremonyCookie(response, request);
    return response;
  }
}
