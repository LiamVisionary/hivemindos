import { NextRequest } from "next/server";
import { createBeelineProfile, readBeelineProfiles } from "@/lib/services/beeline/profile-store";
import type { BeelineProfileCreateInput } from "@/lib/types/beeline";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { verifyAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function denied(request: NextRequest) {
  const auth = await verifyAuth(request);
  return auth.userId ? null : errorJson(auth.reason ?? "Dashboard authentication is required.", 401);
}

export async function GET(request: NextRequest) {
  const unauthorized = await denied(request);
  if (unauthorized) return unauthorized;
  try {
    return okJson(await readBeelineProfiles());
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not load Beeline profiles.", 500);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await denied(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json().catch(() => ({})) as BeelineProfileCreateInput;
    return okJson({ profile: await createBeelineProfile(body) }, { status: 201 });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not create the Beeline profile.");
  }
}

