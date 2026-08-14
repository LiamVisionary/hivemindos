// guard:allow-hive-action-route - authenticated dashboard-only public profile decoration.
import { NextRequest } from "next/server";

import { getSocialAccount } from "@/lib/services/socials/socials-store";
import { getXPublicProfile } from "@/lib/services/socials/social-x-discovery";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const accountId = request.nextUrl.searchParams.get("accountId")?.trim() ?? "";
  const handle = request.nextUrl.searchParams.get("handle")?.trim() ?? "";
  if (!accountId || !handle) return errorJson("accountId and handle are required.");
  try {
    const account = await getSocialAccount(accountId);
    if (!account) return errorJson(`Unknown social account: ${accountId}`, 404);
    if (account.platform !== "x") return errorJson("Public response-profile lookup is currently available for X accounts only.");
    const profile = await getXPublicProfile(account, handle);
    return profile ? okJson({ profile }) : errorJson(`Could not resolve X profile @${handle.replace(/^@/, "")}.`, 404);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Failed to resolve the public social profile.", 500);
  }
}
