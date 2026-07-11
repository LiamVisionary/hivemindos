import { NextRequest } from "next/server";

import {
  deployAzureMarketplaceMachine,
  getAzureMarketplaceMachineCatalog,
  getAzureMarketplaceMachineDeployment,
} from "@/lib/services/hivemindos-machines";
import type { AzureMarketplaceMachinePlan } from "@/lib/services/hivemindos-machines-contract";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  action?: "deploy" | "status";
  subscriptionId?: string;
  resourceGroup?: string;
  location?: string;
  machineName?: string;
  planId?: AzureMarketplaceMachinePlan["id"];
  confirmation?: string;
  acceptMarketplaceTerms?: boolean;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return okJson({ catalog: await getAzureMarketplaceMachineCatalog() });
  } catch (error) {
    return upstreamErrorJson("Could not load the official HivemindOS Machines catalog", error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as Body | null;
  if (!body?.action) return errorJson("A HivemindOS Machines action is required.", 400);
  if (!body.subscriptionId || !body.resourceGroup || !body.location || !body.machineName) return errorJson("Subscription, resource group, location, and machine name are required.", 400);
  try {
    if (body.action === "deploy") {
      if (!body.planId) return errorJson("A Marketplace plan is required.", 400);
      return okJson({ deployment: await deployAzureMarketplaceMachine({
        subscriptionId: body.subscriptionId,
        resourceGroup: body.resourceGroup,
        location: body.location,
        machineName: body.machineName,
        planId: body.planId,
        confirmation: body.confirmation,
        acceptMarketplaceTerms: body.acceptMarketplaceTerms,
      }) });
    }
    if (body.action === "status") {
      return okJson({ deployment: await getAzureMarketplaceMachineDeployment({
        subscriptionId: body.subscriptionId,
        resourceGroup: body.resourceGroup,
        location: body.location,
        machineName: body.machineName,
      }) });
    }
    return errorJson("Unsupported HivemindOS Machines action.", 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "HivemindOS Machines request failed.";
    const expected = /requires confirmation|valid Azure|valid Azure resource|Machine names|canonical Azure|Marketplace terms|waiting for Microsoft|not published/i.test(message);
    return errorJson(message, expected ? 400 : 502);
  }
}
