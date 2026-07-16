import { NextRequest } from "next/server";

import { dashboardPasskeyStatus } from "@/lib/services/dashboard-passkeys";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    return okJson(await dashboardPasskeyStatus(request));
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not read device-authentication status.", 500);
  }
}

