// guard:allow-hive-action-route - dashboard-only Marketplace account management; not an
// agent-invokable Hive action. Listing creation is gated behind an approved decision record
// (listing-approval-required) enforced at the adapter, never reachable from this route.
import { NextRequest } from "next/server";

import { errorJson, okJson } from "@/lib/utils/api-response";
import { marketplaceProviderCapabilityDtos } from "@/lib/services/marketplace/marketplace-provider-matrix";
import {
  deleteMarketplaceAccount,
  readMarketplaceAccounts,
  readMarketplaceDirectives,
  updateMarketplaceAccount,
} from "@/lib/services/marketplace/marketplace-store";
import { startMarketplaceMonitorDriver } from "@/lib/services/marketplace/marketplace-monitor-driver";
import { readMarketplaceRuntime } from "@/lib/services/marketplace/marketplace-runtime";
import {
  MARKETPLACE_CHAT_AUTONOMY_MODES,
  type MarketplaceChatAutonomy,
} from "@/lib/services/marketplace/marketplace-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Lazy revive (idempotent, lease-elected): the dashboard polls this route,
    // so an open Marketplace view keeps the monitor alive across HMR recycles
    // even when the boot autostart missed (no PORT env).
    startMarketplaceMonitorDriver();
    const [accounts, directives, overlay] = await Promise.all([
      readMarketplaceAccounts(),
      readMarketplaceDirectives(),
      readMarketplaceRuntime(),
    ]);
    const monitorStatus: Record<string, { nextPollAt?: string; lastPollAt?: string; accelerated?: boolean }> = {};
    for (const [accountId, state] of Object.entries(overlay.perAccount)) {
      monitorStatus[accountId] = {
        ...(state.nextPollAt ? { nextPollAt: state.nextPollAt } : {}),
        ...(state.lastPollAt ? { lastPollAt: state.lastPollAt } : {}),
        ...(state.lastActivityAt && Date.now() - Date.parse(state.lastActivityAt) < 30 * 60_000 ? { accelerated: true } : {}),
      };
    }
    return okJson({ accounts, directives, monitorStatus, providers: marketplaceProviderCapabilityDtos() });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : String(error), 500);
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorJson("Invalid JSON body");
  }
  const action = typeof body.action === "string" ? body.action : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  try {
    switch (action) {
      case "delete": {
        if (!id) return errorJson("id is required");
        const removed = await deleteMarketplaceAccount(id);
        return removed ? okJson() : errorJson(`Unknown account: ${id}`, 404);
      }
      case "update-autonomy": {
        if (!id) return errorJson("id is required");
        const autonomy = body.autonomy;
        if (typeof autonomy !== "string" || !(MARKETPLACE_CHAT_AUTONOMY_MODES as readonly string[]).includes(autonomy)) {
          return errorJson(`autonomy must be one of: ${MARKETPLACE_CHAT_AUTONOMY_MODES.join(", ")}`);
        }
        const updated = await updateMarketplaceAccount(id, { autonomy: autonomy as MarketplaceChatAutonomy });
        return updated ? okJson({ account: updated }) : errorJson(`Unknown account: ${id}`, 404);
      }
      case "update-monitor": {
        if (!id) return errorJson("id is required");
        const updated = await updateMarketplaceAccount(id, { monitor: body.monitor as never });
        return updated ? okJson({ account: updated }) : errorJson(`Unknown account: ${id}`, 404);
      }
      case "update-negotiation": {
        if (!id) return errorJson("id is required");
        const updated = await updateMarketplaceAccount(id, { negotiation: body.negotiation as never });
        return updated ? okJson({ account: updated }) : errorJson(`Unknown account: ${id}`, 404);
      }
      case "update-locale": {
        if (!id) return errorJson("id is required");
        const updated = await updateMarketplaceAccount(id, { locale: body.locale as never });
        return updated ? okJson({ account: updated }) : errorJson(`Unknown account: ${id}`, 404);
      }
      case "update-display-name": {
        if (!id) return errorJson("id is required");
        const displayName = typeof body.displayName === "string" ? body.displayName : "";
        const updated = await updateMarketplaceAccount(id, { displayName });
        return updated ? okJson({ account: updated }) : errorJson(`Unknown account: ${id}`, 404);
      }
      default:
        return errorJson(`Unknown action: ${action || "(none)"}`);
    }
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : String(error), 500);
  }
}
