import { NextRequest } from "next/server";

import {
  CompanyAeonBindingError,
  listCompanyAeonOptions,
} from "@/lib/services/company-aeon-binding";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const profileId = request.nextUrl.searchParams.get("profileId")?.trim();
    return okJson(await listCompanyAeonOptions(profileId));
  } catch (error) {
    if (error instanceof CompanyAeonBindingError) return errorJson(error.message, error.status);
    return upstreamErrorJson("Could not load AEON company options", error);
  }
}
