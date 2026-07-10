import type { NextRequest } from "next/server";
import { okJson, errorJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import { probeUrlLiveness } from "@/lib/net/probe-url";
import {
  
  selectChatPreviewTargets,
  type ChatPreviewHostedApp,
} from "@/lib/services/chat/chat-preview-targets";
import { isAllowedChatPreviewUrl } from "@/lib/services/chat/chat-preview-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FLEET_APPS_FETCH_TIMEOUT_MS = 10_000;

// The raw shape of the /api/fleet/apps `HostedApp` records this route reads.
// Only the fields the preview gate/selector need are typed; the discovery
// route owns the full type.
type FleetAppsListItem = {
  id?: string;
  name?: string;
  machineName?: string;
  local?: boolean;
  online?: boolean;
  interactive?: boolean;
  port?: number;
  openUrl?: string;
  healthUrl?: string;
};

// Mirror the client-side HostedApp→FoundryHostedApp mapping (MyAppsPanel.tsx:
// mapHostedApp / foundryStateFor) for the two fields the gate cares about:
// `machine` (local apps present as "This Mac") and `state` (online → running).
function toPreviewHostedApp(app: FleetAppsListItem): ChatPreviewHostedApp {
  return {
    id: app.id ?? "",
    name: app.name ?? "",
    machine: app.local ? "This Mac" : app.machineName ?? "",
    port: typeof app.port === "number" ? app.port : 0,
    state: app.online ? "running" : "stopped",
    openUrl: app.openUrl ?? "",
    healthUrl: app.healthUrl,
    interactive: Boolean(app.interactive),
  };
}

// Enumerate the real fleet-hosted apps server-side by self-fetching
// /api/fleet/apps (the same source DashboardApp's `fleetHostedApps` reads).
// The proxy auth gate requires the server's device token on internal fetches.
async function fetchHostedApps(origin: string): Promise<ChatPreviewHostedApp[]> {
  const url = new URL("/api/fleet/apps", origin);
  const response = await fetch(url, {
    cache: "no-store",
    headers: internalApiAuthHeaders(),
    signal: AbortSignal.timeout(FLEET_APPS_FETCH_TIMEOUT_MS),
  }).catch(() => null);
  if (!response?.ok) return [];
  const payload = (await response.json().catch(() => null)) as {
    apps?: FleetAppsListItem[];
  } | null;
  if (!Array.isArray(payload?.apps)) return [];
  return payload!.apps.map(toPreviewHostedApp);
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url")?.trim() ?? "";
  const machine = request.nextUrl.searchParams.get("machine")?.trim() ?? "";
  if (!url) {
    return errorJson("A 'url' query parameter is required.", 400);
  }

  const hostedApps = await fetchHostedApps(request.nextUrl.origin);

  // SSRF gate: only a URL that exactly matches a discovered hosted app AND sits
  // on the trusted fleet host surface may be probed. On reject, hand back the
  // real previewable targets so the pane can offer live apps instead of a mock.
  if (!isAllowedChatPreviewUrl(url, hostedApps)) {
    return errorJson(
      "Refusing to preview a URL that is not a known fleet-hosted app.",
      403,
      { url, targets: selectChatPreviewTargets(hostedApps, machine) },
    );
  }

  try {
    const probe = await probeUrlLiveness(url);
    return okJson({
      url: probe.url,
      live: probe.live,
      dead: probe.dead,
      status: probe.status,
      reason: probe.reason,
    });
  } catch (error) {
    return upstreamErrorJson("Chat preview probe failed", error);
  }
}
