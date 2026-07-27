import { NextRequest } from "next/server";

import { executeHiveQuery } from "@/lib/services/hive-query";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuthContext } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const result = await executeHiveQuery(
      body && typeof body === "object" && !Array.isArray(body) ? body : {},
      auth.principal,
    );
    return okJson(result);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Hive Query failed.", 400);
  }
}
