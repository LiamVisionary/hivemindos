// guard:allow-hive-action-route - dashboard-only Marketplace standing-rules management;
// not an agent-invokable Hive action.
import { NextRequest } from "next/server";

import { errorJson, okJson } from "@/lib/utils/api-response";
import {
  addMarketplaceDirective,
  readMarketplaceDirectives,
  removeMarketplaceDirective,
} from "@/lib/services/marketplace/marketplace-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return okJson({ directives: await readMarketplaceDirectives() });
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
  try {
    switch (action) {
      case "add": {
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return errorJson("text is required");
        const scope = body.scope === "account" ? "account" : "global";
        const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
        if (scope === "account" && !accountId) return errorJson("accountId is required for account-scoped rules");
        const directive = await addMarketplaceDirective({
          text,
          scope,
          ...(scope === "account" ? { accountId } : {}),
          source: "inject",
        });
        return okJson({ directive });
      }
      case "remove": {
        const id = typeof body.id === "string" ? body.id.trim() : "";
        if (!id) return errorJson("id is required");
        const removed = await removeMarketplaceDirective(id);
        return removed ? okJson() : errorJson(`Unknown rule: ${id}`, 404);
      }
      default:
        return errorJson(`Unknown action: ${action || "(none)"}`);
    }
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : String(error), 500);
  }
}
