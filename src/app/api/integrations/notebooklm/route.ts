// guard:allow-hive-action-route - dashboard-only local package/runtime setup;
// agents may use the configured MCP, but must not install, authenticate, or remove it.
import { NextRequest } from "next/server";

import {
  configureNotebookLm,
  getNotebookLmStatus,
  logoutNotebookLm,
  removeNotebookLm,
  startNotebookLmInstall,
  startNotebookLmLogin,
} from "@/lib/services/mcp/notebooklm";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  return okJson({ status: await getNotebookLmStatus() });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const targets = typeof body?.targets === "string" ? body.targets : "all";
  const confirmation = typeof body?.confirmation === "string" ? body.confirmation : undefined;
  try {
    if (action === "install") return okJson(await startNotebookLmInstall(targets));
    if (action === "login") return okJson(await startNotebookLmLogin());
    if (action === "configure") return okJson(await configureNotebookLm(targets));
    if (action === "logout") return okJson(await logoutNotebookLm(confirmation));
    if (action === "remove") return okJson(await removeNotebookLm(targets, confirmation));
    return errorJson(`Unknown NotebookLM action "${action}".`, 400);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "NotebookLM action failed.", 500);
  }
}
