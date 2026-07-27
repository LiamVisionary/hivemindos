import { NextRequest } from "next/server";
import {
  connectHiveResearchSync,
  disconnectHiveResearchSync,
  hiveResearchSyncStatus,
  runHiveResearchSync,
} from "@/lib/services/hive-research-sync";
import {
  getHiveResearchSyncDriverStatus,
  startHiveResearchSyncDriver,
  stopHiveResearchSyncDriver,
} from "@/lib/services/hive-research-sync-driver";
import { errorJson, okJson } from "@/lib/utils/api-response";

// guard:allow-hive-action-route - user-initiated Hive Research brain-sync pairing; writes only local shared-brain memory notes
// Dashboard-authenticated via the proxy gate (NOT self-authenticating): the
// user pastes a one-time code from hivemindos.app/research to pair, after
// which the driver pull-syncs research memories into the shared brain.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    return okJson({
      sync: await hiveResearchSyncStatus(),
      driver: getHiveResearchSyncDriverStatus(),
    });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not read the research sync status.", 500);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { action?: unknown; code?: unknown };
  const action = typeof body.action === "string" ? body.action : "";
  try {
    switch (action) {
      case "connect": {
        const sync = await connectHiveResearchSync(typeof body.code === "string" ? body.code : "");
        startHiveResearchSyncDriver();
        return okJson({ sync, driver: getHiveResearchSyncDriverStatus() });
      }
      case "sync":
        return okJson({ sync: await runHiveResearchSync() });
      case "disconnect":
        return okJson({ sync: await disconnectHiveResearchSync() });
      case "start":
        return okJson({ driver: startHiveResearchSyncDriver() });
      case "stop":
        return okJson({ driver: await stopHiveResearchSyncDriver() });
      default:
        return errorJson("action must be one of connect, sync, disconnect, start, stop.", 400);
    }
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Research sync action failed.", 500);
  }
}
