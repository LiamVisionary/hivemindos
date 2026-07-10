// guard:allow-hive-action-route - dashboard-only local package/runtime setup;
// agents may use the configured MCP, but must not install or remove it.
import { NextRequest } from "next/server";

import {
  configureAzureMcp,
  getAzureMcpStatus,
  removeAzureMcp,
  startAzureMcpInstall,
} from "@/lib/services/mcp/azure-mcp";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  return okJson({ status: await getAzureMcpStatus() });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const targets = typeof body?.targets === "string" ? body.targets : "all";
  try {
    if (action === "install") return okJson(await startAzureMcpInstall(targets));
    if (action === "configure") {
      return okJson(await configureAzureMcp({
        access: typeof body?.access === "string" ? body.access : "read",
        targets,
        confirmation: typeof body?.confirmation === "string" ? body.confirmation : undefined,
      }));
    }
    if (action === "remove") return okJson(await removeAzureMcp(targets));
    return errorJson(`Unknown Azure MCP action "${action}".`, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Azure MCP action failed.";
    const needsConfirmation = message.includes("ENABLE_AZURE_MCP_MANAGEMENT")
      ? "ENABLE_AZURE_MCP_MANAGEMENT"
      : undefined;
    return errorJson(message, needsConfirmation ? 400 : 500, needsConfirmation ? { needsConfirmation } : undefined);
  }
}
