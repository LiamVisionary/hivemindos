import { NextRequest } from "next/server";

import {
  benchmarkHiveComputeHostingPrices,
  installHiveComputeWorkerDependencies,
  installHiveComputeWorkerModule,
  openHiveComputeMppSession,
  readHiveComputeHostContext,
  readHiveComputeMarketplaceStatus,
  resumeHiveComputeWorker,
  saveHiveComputeRunConfig,
  setupHiveComputeHosting,
  startHiveComputeLocalBackend,
  startHiveComputeWorker,
  stopHiveComputeWorker,
} from "@/lib/services/hive-compute-marketplace";
import {
  readRemoteHiveComputeHostRun,
  setupRemoteHiveComputeHosting,
  startRemoteHiveComputeWorker,
  stopRemoteHiveComputeWorker,
} from "@/lib/services/hive-compute-marketplace/remote-host";
import type { HiveComputeHostRunConfig, HiveComputeHostTarget } from "@/lib/types/hive-compute-marketplace";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const maxDuration = 600;

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
    models?: unknown;
  } | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const target = targetFromBody(body?.target);
  const onlyModels = Array.isArray(body?.models)
    ? body.models.map((model) => String(model ?? "").trim()).filter(Boolean)
    : [];
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
    if (action === "benchmark-pricing") {
      if (target && !target.isSelf) return errorJson("Benchmark pricing from HivemindOS on the target machine itself.", 400);
      return okJson({
        status: await benchmarkHiveComputeHostingPrices(body?.config, onlyModels.length ? { onlyModels } : {}),
      });
    }
    if (action === "run-worker") {
      return okJson({ status: await startHiveComputeWorker(body?.config) });
    }
    if (action === "stop-worker") {
      return okJson({ status: await stopHiveComputeWorker() });
    }
    if (action === "resume-worker") {
      return okJson({ status: await resumeHiveComputeWorker() });
    }
    if (action === "save-config") {
      return okJson({ status: await saveHiveComputeRunConfig(body?.config) });
    }
    // Remote quick-host: run the worker on another fleet machine over the
    // linkd shell/file rails. Requires an explicit non-self target.
    if (action === "remote-setup-hosting" || action === "remote-run-worker" || action === "remote-stop-worker" || action === "remote-run-status") {
      if (!target?.collectorUrl || target.isSelf) {
        return errorJson("Remote hosting actions need a remote machine's collector URL.", 400);
      }
      if (action === "remote-setup-hosting") {
        return okJson({ remote: await setupRemoteHiveComputeHosting(target) });
      }
      if (action === "remote-run-worker") {
        const status = await readHiveComputeMarketplaceStatus(target);
        return okJson({ remote: await startRemoteHiveComputeWorker(target, status.host.models), status });
      }
      if (action === "remote-stop-worker") {
        return okJson({ remote: await stopRemoteHiveComputeWorker(target) });
      }
      return okJson({ remoteRun: await readRemoteHiveComputeHostRun(target) });
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
