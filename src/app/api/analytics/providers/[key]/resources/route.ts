import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import { listCompanyAnalyticsResources } from "@/lib/services/company-analytics";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only project/site/property discovery for the company Analytics tab's provider
// cards, so no one types an id. Resolves the provider's shared credential SERVER-SIDE
// (a pasted key, or a Google access token minted from the shared OAuth account) and
// returns only { id, name } pairs — the credential never reaches the client. GET only,
// so it stays out of the Hive action route registry.
export async function GET(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const { key } = await context.params;
  const providerKey = key?.trim();
  if (!providerKey) return errorJson("Provider is required.");

  try {
    const { resources, host } = await listCompanyAnalyticsResources(providerKey);
    return okJson({ resources, host });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not list projects.", 400);
  }
}
