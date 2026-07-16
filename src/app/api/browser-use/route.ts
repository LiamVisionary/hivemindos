import { NextRequest } from "next/server";
import { z } from "zod";
import { setBrowserUseFullAccess } from "@/lib/services/browser-use-permissions";
import { runBrowserUse, type BrowserUseAction } from "@/lib/services/browser-use-runner";
import { readInstallableServiceStatus, runInstallableServiceAction } from "@/lib/services/installable-services";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BROWSER_USE_ACTIONS = [
  "doctor", "open", "state", "current-url", "click", "input", "type", "select", "scroll",
  "upload", "screenshot", "eval", "cloud-task", "close",
] as const satisfies readonly BrowserUseAction[];
const requestSchema = z.object({
  action: z.enum(["set-full-permissions", "install", "start", "stop", "status", ...BROWSER_USE_ACTIONS]),
  fullAccess: z.boolean().optional(),
  url: z.string().optional(),
  index: z.number().int().optional(),
  text: z.string().optional(),
  path: z.string().optional(),
  script: z.string().optional(),
  task: z.string().optional(),
  profile: z.string().optional(),
  cdpUrl: z.string().optional(),
  session: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
  headed: z.boolean().optional(),
  direction: z.enum(["up", "down"]).optional(),
  amount: z.number().int().positive().max(100_000).optional(),
}).strict();

export async function GET() {
  try {
    return okJson({ service: await readInstallableServiceStatus("browser-use") });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Browser Use status failed.", 400);
  }
}

export async function POST(request: NextRequest) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorJson("Invalid Browser Use request.", 400);
  const body = parsed.data;
  try {
    if (body.action === "set-full-permissions") {
      await setBrowserUseFullAccess(body.fullAccess === true);
      return okJson({ service: await readInstallableServiceStatus("browser-use") });
    }
    if (body.action === "install" || body.action === "start" || body.action === "stop" || body.action === "status") {
      return okJson({ service: await runInstallableServiceAction("browser-use", body.action) });
    }
    return okJson({ result: await runBrowserUse(body) });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Browser Use command failed.", 400);
  }
}
