import { NextRequest } from "next/server";

import {
  installHiveComputeWorkerDependencies,
  installHiveComputeWorkerModule,
  openHiveComputeMppSession,
  readHiveComputeHostContext,
  readHiveComputeMarketplaceStatus,
  setupHiveComputeHosting,
  startHiveComputeLocalBackend,
  startHiveComputeWorker,
  stopHiveComputeWorker,
} from "@/lib/services/hive-compute-marketplace";
import type { HiveComputeHostRunConfig, HiveComputeHostTarget } from "@/lib/types/hive-compute-marketplace";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

function targetFromQuery(request: NextRequest): HiveComputeHostTarget | null {
  const params = request.nextUrl.searchParams;
  const collectorUrl = params.get("targetCollectorUrl")?.trim() || "";
  const machineName = params.get("targetMachineName")?.trim() || "";
  const location = params.get("targetLocation")?.trim() || "";
  const isSelf = params.get("targetSelf") === "1";
  if (!collectorUrl && !machineName && !location && !isSelf) return null;
  return {
    ...(collectorUrl ? { collectorUrl } : {}),
    ...(machineName ? { machineName } : {}),
    ...(location ? { location } : {}),
    isSelf,
  };
}

function targetFromBody(target: unknown): HiveComputeHostTarget | null {
  if (!target || typeof target !== "object") return null;
  const record = target as Record<string, unknown>;
  const collectorUrl = typeof record.collectorUrl === "string" ? record.collectorUrl.trim() : "";
  const machineName = typeof record.machineName === "string" ? record.machineName.trim() : "";
  const location = typeof record.location === "string" ? record.location.trim() : "";
  const isSelf = record.isSelf === true;
  if (!collectorUrl && !machineName && !location && !isSelf) return null;
  return {
    ...(collectorUrl ? { collectorUrl } : {}),
    ...(machineName ? { machineName } : {}),
    ...(location ? { location } : {}),
    isSelf,
  };
}

// guard:allow-hive-action-route - dashboard setup endpoint for optional local worker module
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return okJson({ status: await readHiveComputeMarketplaceStatus(targetFromQuery(request)) });
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
    target?: unknown;
  } | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const target = targetFromBody(body?.target);
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
    if (action === "start-lmstudio") {
      return okJson({ status: await startHiveComputeLocalBackend(target) });
    }
    if (action === "refresh") {
      return okJson({ status: await readHiveComputeMarketplaceStatus(target) });
    }
    return errorJson("Unsupported Hive Compute marketplace action.", 400);
  } catch (error) {
    return upstreamErrorJson("Hive Compute marketplace action failed", error);
  }
}
