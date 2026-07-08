import { NextRequest } from "next/server";
import { nansenCredentialStatus } from "@/lib/services/nansen";
import { okJson } from "@/lib/utils/api-response";
import { nansenRouteError, requireNansenRouteAuth } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireNansenRouteAuth(request);
  if (unauthorized) return unauthorized;

  try {
    return okJson({ status: await nansenCredentialStatus() });
  } catch (error) {
    return nansenRouteError("Nansen status failed", error);
  }
}
