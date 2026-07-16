import { NextRequest } from "next/server";

import {
  addManagedCloudRemoteMcp,
  addManagedCloudTailnet,
  changeManagedCloudAgentState,
  chatWithManagedCloudAgent,
  createManagedCloudAgent,
  deleteManagedCloudAgent,
  fundManagedCloudAccount,
  getManagedCloudAgent,
  getManagedCloudDashboard,
  listManagedCloudFundingWallets,
  listManagedCloudIntegrations,
  ManagedCloudApiError,
  pairManagedCloudSharedBrain,
  recoverPendingManagedCloudSettlement,
  removeManagedCloudIntegration,
} from "@/lib/services/managed-cloud-agents";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManagedCloudBody = {
  action?: "top_up" | "create" | "status" | "start" | "stop" | "delete" | "chat" | "recover_payment" | "list_integrations" | "connect_tailnet" | "add_mcp" | "pair_brain" | "remove_integration";
  walletAgentId?: string;
  amountUsd?: number;
  confirmation?: string;
  approvalToken?: string;
  companyTaskId?: string;
  instanceId?: string;
  name?: string;
  planId?: "small" | "medium" | "large";
  region?: string;
  modelTier?: "fast" | "balanced";
  idempotencyKey?: string;
  messages?: unknown[];
  authKey?: string;
  advertiseTag?: string;
  integrationName?: string;
  integrationUrl?: string;
  authorization?: string;
  localTailnetDnsName?: string;
  integrationId?: string;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const [dashboard, fundingWallets] = await Promise.all([
      getManagedCloudDashboard(),
      listManagedCloudFundingWallets(),
    ]);
    return okJson({ ...dashboard, fundingWallets });
  } catch (error) {
    return managedCloudError(error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as ManagedCloudBody | null;
  if (!body || !body.action) return errorJson("A managed cloud action is required.", 400);
  try {
    if (body.action === "recover_payment") {
      return okJson({ recovered: await recoverPendingManagedCloudSettlement() });
    }
    if (body.action === "top_up") {
      if (!body.walletAgentId) return errorJson("walletAgentId is required.", 400);
      return okJson(await fundManagedCloudAccount({
        walletAgentId: body.walletAgentId,
        amountUsd: Number(body.amountUsd),
        confirmation: body.confirmation,
        approvalToken: body.approvalToken,
        companyTaskId: body.companyTaskId?.trim() || undefined,
      }));
    }
    if (body.action === "create") {
      if (!body.name || !body.planId) return errorJson("name and planId are required.", 400);
      return okJson(await createManagedCloudAgent({
        name: body.name,
        planId: body.planId,
        region: body.region,
        modelTier: body.modelTier,
        idempotencyKey: body.idempotencyKey,
      }));
    }
    if (!body.instanceId) return errorJson("instanceId is required.", 400);
    if (body.action === "list_integrations") return okJson({ integrations: await listManagedCloudIntegrations(body.instanceId) });
    if (body.action === "connect_tailnet") {
      if (!body.authKey) return errorJson("authKey is required.", 400);
      return okJson(await addManagedCloudTailnet({ instanceId: body.instanceId, authKey: body.authKey, advertiseTag: body.advertiseTag }));
    }
    if (body.action === "add_mcp") {
      if (!body.integrationName || !body.integrationUrl) return errorJson("integrationName and integrationUrl are required.", 400);
      return okJson(await addManagedCloudRemoteMcp({
        instanceId: body.instanceId,
        name: body.integrationName,
        url: body.integrationUrl,
        authorization: body.authorization,
      }));
    }
    if (body.action === "pair_brain") {
      if (!body.localTailnetDnsName) return errorJson("localTailnetDnsName is required.", 400);
      return okJson(await pairManagedCloudSharedBrain({ instanceId: body.instanceId, localTailnetDnsName: body.localTailnetDnsName }));
    }
    if (body.action === "remove_integration") {
      if (!body.integrationId) return errorJson("integrationId is required.", 400);
      return okJson(await removeManagedCloudIntegration(body.instanceId, body.integrationId));
    }
    if (body.action === "status") return okJson(await getManagedCloudAgent(body.instanceId));
    if (body.action === "start" || body.action === "stop") {
      return okJson(await changeManagedCloudAgentState(body.instanceId, body.action));
    }
    if (body.action === "delete") return okJson(await deleteManagedCloudAgent(body.instanceId));
    if (body.action === "chat") {
      if (!Array.isArray(body.messages)) return errorJson("messages must be an array.", 400);
      return okJson({ response: await chatWithManagedCloudAgent(body.instanceId, body.messages) });
    }
    return errorJson("Unsupported managed cloud action.", 400);
  } catch (error) {
    return managedCloudError(error);
  }
}

function managedCloudError(error: unknown) {
  if (error instanceof ManagedCloudApiError) {
    return errorJson(error.message, error.status, { code: error.code, ...error.details });
  }
  return upstreamErrorJson("Managed cloud request failed", error);
}
