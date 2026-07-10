import { NextRequest } from "next/server";

import { readAzureArm, type AzureReadAction } from "@/lib/services/integrations/azure-arm";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set<AzureReadAction>(["subscriptions", "resource-groups", "resources", "resource"]);

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action as AzureReadAction : "subscriptions";
  if (!ACTIONS.has(action)) return errorJson(`Unknown Azure read action "${String(body?.action || "")}".`, 400);
  try {
    const data = await readAzureArm({
      action,
      subscriptionId: typeof body?.subscriptionId === "string" ? body.subscriptionId : undefined,
      resourceGroup: typeof body?.resourceGroup === "string" ? body.resourceGroup : undefined,
      resourceId: typeof body?.resourceId === "string" ? body.resourceId : undefined,
      apiVersion: typeof body?.apiVersion === "string" ? body.apiVersion : undefined,
      top: typeof body?.top === "number" ? body.top : undefined,
    });
    return okJson({ data, readOnly: true });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Azure read failed.", 502);
  }
}

