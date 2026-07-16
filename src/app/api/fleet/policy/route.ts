import { NextRequest } from "next/server";
import { assertFleetCollectorUrl } from "@/lib/services/local-collector-url";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLICY_TIMEOUT_MS = 10_000;

type PolicyBody = {
  collectorUrl?: string;
  action?: "claim-master" | "update" | "release-master" | "resolve-access";
  access?: unknown;
  performance?: unknown;
  capability?: unknown;
  decision?: unknown;
};

function collectorPolicyUrl(value: string | null | undefined) {
  return `${assertFleetCollectorUrl(value)}/fleet-policy`;
}

function responseData(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const rest = { ...value } as Record<string, unknown>;
  delete rest.ok;
  return rest;
}

async function proxyPolicy(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(POLICY_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => null) as ({ ok?: boolean; error?: string } & Record<string, unknown>) | null;
  if (!response.ok || data?.ok === false) {
    return errorJson(data?.error || `Machine policy request returned ${response.status}.`, response.status || 502);
  }
  return okJson(responseData(data));
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return await proxyPolicy(collectorPolicyUrl(request.nextUrl.searchParams.get("collectorUrl")));
  } catch (error) {
    return upstreamErrorJson("Could not read machine policy", error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json() as PolicyBody;
    if (!body.action) return errorJson("Machine policy action is required.");
    return await proxyPolicy(collectorPolicyUrl(body.collectorUrl), {
      method: "POST",
      body: JSON.stringify({
        action: body.action,
        access: body.access,
        performance: body.performance,
        capability: body.capability,
        decision: body.decision,
      }),
    });
  } catch (error) {
    return upstreamErrorJson("Could not update machine policy", error);
  }
}
