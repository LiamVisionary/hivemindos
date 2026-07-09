import { NextRequest } from "next/server";

import {
  installHiveComputeWorkerDependencies,
  installHiveComputeWorkerModule,
  openHiveComputeMppSession,
  readHiveComputeHostContext,
  readHiveComputeMarketplaceStatus,
  setupHiveComputeHosting,
  startHiveComputeWorker,
  stopHiveComputeWorker,
} from "@/lib/services/hive-compute-marketplace";
import type { HiveComputeHostRunConfig } from "@/lib/types/hive-compute-marketplace";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

// guard:allow-hive-action-route - dashboard setup endpoint for optional local worker module
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return okJson({ status: await readHiveComputeMarketplaceStatus() });
  } catch (error) {
    return upstreamErrorJson("Hive Compute status failed", error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as {
    action?: unknown;
    force?: unknown;
    config?: Partial<HiveComputeHostRunConfig>;
  } | null;
  const action = typeof body?.action === "string" ? body.action : "";
  try {
    if (action === "install-worker" || action === "repair-worker") {
      return okJson(await installHiveComputeWorkerModule({ force: action === "repair-worker" || body?.force === true }));
    }
    if (action === "install-worker-deps") {
      return okJson({ status: await installHiveComputeWorkerDependencies() });
    }
    if (action === "setup-hosting") {
      return okJson({ status: await setupHiveComputeHosting(body?.config) });
    }
    if (action === "preflight-worker") {
      return okJson({ host: await readHiveComputeHostContext(body?.config), status: await readHiveComputeMarketplaceStatus() });
    }
    if (action === "run-worker") {
      return okJson({ status: await startHiveComputeWorker(body?.config) });
    }
    if (action === "stop-worker") {
      return okJson({ status: await stopHiveComputeWorker() });
    }
    if (action === "open-mpp-session") {
      return okJson({ status: await openHiveComputeMppSession() });
    }
    if (action === "refresh") {
      return okJson({ status: await readHiveComputeMarketplaceStatus() });
    }
    return errorJson("Unsupported Hive Compute marketplace action.", 400);
  } catch (error) {
    return upstreamErrorJson("Hive Compute marketplace action failed", error);
  }
}
