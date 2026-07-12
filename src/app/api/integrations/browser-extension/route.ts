import { NextRequest } from "next/server";
import {
  prepareBrowserExtensionInstall,
  readBrowserExtensionInstallStatus,
} from "@/lib/services/browser-extension-install";
import { openBrowserExtensionsPage } from "@/lib/services/system-browsers";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { verifyAuth } from "@/lib/utils/server-auth";

// guard:allow-hive-action-route - dashboard-only, human-initiated extension preparation and browser launching.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(request: NextRequest) {
  const auth = await verifyAuth(request);
  return auth.userId ? null : errorJson(auth.reason ?? "Dashboard authentication is required.", 401);
}

export async function GET(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    return okJson(await readBrowserExtensionInstallStatus());
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not check the browser extension.", 500);
  }
}

export async function POST(request: NextRequest) {
  const denied = await authorize(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => null) as { action?: unknown; browserId?: unknown } | null;
    if (body?.action === "prepare-install") return okJson(await prepareBrowserExtensionInstall());
    if (body?.action === "open-extensions") {
      await openBrowserExtensionsPage(body.browserId);
      return okJson({ opened: true });
    }
    return errorJson("Choose a supported browser-extension action.");
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not prepare the browser extension.", 400);
  }
}
