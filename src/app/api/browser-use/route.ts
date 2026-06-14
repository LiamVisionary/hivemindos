import { NextRequest, NextResponse } from "next/server";
import { setBrowserUseFullAccess } from "@/lib/services/browser-use-permissions";
import { runBrowserUse } from "@/lib/services/browser-use-runner";
import { readInstallableServiceStatus, runInstallableServiceAction } from "@/lib/services/installable-services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, service: await readInstallableServiceStatus("browser-use") });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Browser Use status failed." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { action?: string };
  try {
    if (body.action === "set-full-permissions") {
      await setBrowserUseFullAccess((body as { fullAccess?: unknown }).fullAccess === true);
      return NextResponse.json({ ok: true, service: await readInstallableServiceStatus("browser-use") });
    }
    if (body.action === "install" || body.action === "start" || body.action === "stop" || body.action === "status") {
      return NextResponse.json({ ok: true, service: await runInstallableServiceAction("browser-use", body.action) });
    }
    return NextResponse.json({ ok: true, result: await runBrowserUse(body as Parameters<typeof runBrowserUse>[0]) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Browser Use command failed." }, { status: 400 });
  }
}
