// guard:allow-hive-action-route - dashboard-only Marketplace connect flow (headed browser
// sign-in + session probe); not an agent-invokable Hive action. The browser-use runner
// enforces its own Full-permissions gate for profile use.
import { NextRequest } from "next/server";

import { errorJson, okJson } from "@/lib/utils/api-response";
import { isMarketplaceProvider } from "@/lib/services/marketplace/marketplace-provider-matrix";
import {
  disconnectMarketplaceAccount,
  probeMarketplaceConnectStatus,
  startMarketplaceProfileLogin,
} from "@/lib/services/marketplace/marketplace-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorJson("Invalid JSON body");
  }
  const action = typeof body.action === "string" ? body.action : "";
  try {
    switch (action) {
      case "start-login": {
        const provider = body.provider;
        if (!isMarketplaceProvider(provider)) return errorJson("provider must be a supported marketplace provider");
        const accountId = typeof body.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : undefined;
        const result = await startMarketplaceProfileLogin(provider, accountId ? { accountId } : undefined);
        return okJson({ account: result.account, profileName: result.profileName, reconnect: result.reconnect });
      }
      case "probe": {
        const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
        if (!accountId) return errorJson("accountId is required");
        // passive = the sign-in poll: read-only, never navigates the tab the user is signing in on.
        const probe = await probeMarketplaceConnectStatus(accountId, { passive: body.passive === true });
        return okJson({ status: probe.status, ...(probe.detail ? { detail: probe.detail } : {}) });
      }
      case "disconnect": {
        const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
        if (!accountId) return errorJson("accountId is required");
        await disconnectMarketplaceAccount(accountId);
        return okJson();
      }
      default:
        return errorJson(`Unknown action: ${action || "(none)"}`);
    }
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : String(error), 500);
  }
}
