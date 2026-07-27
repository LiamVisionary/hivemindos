import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { platform } from "node:os";
import { promisify } from "node:util";
import { NextRequest } from "next/server";

import {
  deliverableFileManagerLabel,
  discoverDeliverableOpenApps,
  openDeliverableInApp,
} from "@/lib/services/deliverable-open-apps";
import {
  DeliverableDownloadError,
  downloadRemoteDeliverable,
} from "@/lib/services/deliverable-download";
import { resolveLocalDeliverableFile } from "@/lib/services/deliverable-file-resolution";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

type DeliverableAction = "download" | "folder" | "open" | "open-in" | "reveal";

function cleanTarget(value: string) {
  return String(value || "").trim().replace(/[\0\r\n]/g, "");
}

function missingFileError(rawPath: string) {
  const remote = /^\/(?:root|home)\//.test(rawPath);
  return remote
    ? "This file is still on the machine that produced it. Synced-vault artifacts can open here automatically."
    : "Deliverable does not exist on this machine.";
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const rawPath = cleanTarget(request.nextUrl.searchParams.get("path") ?? "");
  if (!rawPath) return errorJson("Deliverable path is required.");
  const resolvedFile = await resolveLocalDeliverableFile(rawPath);
  const inspectAvailabilityOnly = request.nextUrl.searchParams.get("inspect") === "availability";
  const fileManagerLabel = deliverableFileManagerLabel();
  if (!resolvedFile) {
    return okJson({
      apps: [],
      available: false,
      error: missingFileError(rawPath),
      fileManagerLabel,
    });
  }

  return okJson({
    apps: inspectAvailabilityOnly ? [] : await discoverDeliverableOpenApps(resolvedFile.path),
    available: true,
    fileManagerLabel,
    source: resolvedFile.source,
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json() as {
      action?: DeliverableAction;
      appId?: string;
      path?: string;
      sourceMachine?: {
        collectorUrl?: string;
        name?: string;
      };
      url?: string;
    };
    const action: DeliverableAction = body.action === "reveal"
      || body.action === "folder"
      || body.action === "open-in"
      || body.action === "download"
      ? body.action
      : "open";
    const target = cleanTarget(body.path || body.url || "");
    if (!target) return errorJson("Deliverable path or URL is required.");

    if (/^https?:\/\//i.test(target)) {
      if (action !== "open") return errorJson("Web URLs can be opened, but do not have a local folder or desktop app list.");
      await openTarget(target);
      return okJson();
    }

    const resolvedFile = await resolveLocalDeliverableFile(target);
    if (action === "download") {
      if (resolvedFile) {
        return okJson({
          displayPath: resolvedFile.path,
          path: resolvedFile.path,
          source: resolvedFile.source,
        });
      }
      const result = await downloadRemoteDeliverable({
        collectorUrl: cleanTarget(body.sourceMachine?.collectorUrl ?? ""),
        machineName: cleanTarget(body.sourceMachine?.name ?? "") || "the other device",
        remotePath: target,
      });
      return okJson({ ...result, source: "remote-download" });
    }
    if (!resolvedFile) return errorJson(missingFileError(target), 404, { path: target });
    if (action === "folder") await openTarget(dirname(resolvedFile.path));
    else if (action === "reveal") await revealPath(resolvedFile.path);
    else if (action === "open-in") {
      const appId = cleanTarget(body.appId ?? "");
      if (!appId) return errorJson("Choose an application first.");
      await openDeliverableInApp(resolvedFile.path, appId);
    } else await openTarget(resolvedFile.path);

    return okJson({ source: resolvedFile.source });
  } catch (error) {
    return errorJson(
      error instanceof Error ? error.message : "Could not open deliverable.",
      error instanceof DeliverableDownloadError ? error.status : 500,
    );
  }
}

async function openTarget(target: string) {
  const os = platform();
  if (os === "darwin") return execFileAsync("open", [target], { timeout: 10_000 });
  if (os === "win32") return execFileAsync("cmd", ["/c", "start", "", target], { timeout: 10_000 });
  return execFileAsync("xdg-open", [target], { timeout: 10_000 });
}

async function revealPath(path: string) {
  const os = platform();
  if (os === "darwin") return execFileAsync("open", ["-R", path], { timeout: 10_000 });
  if (os === "win32") return execFileAsync("explorer.exe", ["/select,", path], { timeout: 10_000 });
  return execFileAsync("xdg-open", [dirname(path)], { timeout: 10_000 });
}
