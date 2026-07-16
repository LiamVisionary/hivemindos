import { NextRequest } from "next/server";
import {
  installHyperframesRuntime,
  readHyperframesRuntimeStatus,
  uninstallHyperframesRuntime,
} from "@/lib/services/hyperframes-runtime";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return okJson({ runtime: await readHyperframesRuntimeStatus() });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "HyperFrames status failed.", 500);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as {
    action?: unknown;
    confirm?: unknown;
  } | null;
  if (!body || (body.action !== "install" && body.action !== "uninstall")) {
    return errorJson("Choose install or uninstall for the HyperFrames renderer.", 400);
  }
  if (body.confirm === true) {
    try {
      const runtimeStatus = body.action === "install"
        ? await installHyperframesRuntime()
        : await uninstallHyperframesRuntime();
      return okJson({ runtime: runtimeStatus });
    } catch (error) {
      return errorJson(error instanceof Error ? error.message : "HyperFrames setup failed.", 500);
    }
  }
  return errorJson("Confirm this renderer change before continuing.", 409);
}
