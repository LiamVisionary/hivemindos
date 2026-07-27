import { NextRequest } from "next/server";
import { errorJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export async function requireNansenRouteAuth(request: NextRequest) {
  return requireAuth(request);
}

export async function readNansenBody<T extends Record<string, unknown>>(request: NextRequest): Promise<T> {
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) return {} as T;
  return body as T;
}

export function nansenRouteError(context: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/required|invalid|set NANSEN_API_KEY|hosted credits|credit balance|credit token|managed Nansen/i.test(message)) {
    return errorJson(message, 400);
  }
  return upstreamErrorJson(context, error);
}
