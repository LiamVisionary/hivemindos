// guard:allow-hive-action-route - report-only brain-service driver control surface, driven by the boot loopback self-POST and the dashboard card.
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  getInboxTriageStatus,
  runInboxTriage,
  writeInboxTriageNoteConfig,
} from "@/lib/services/brain/inbox-triage";
import {
  getInboxTriageDriverStatus,
  startInboxTriageDriver,
  stopInboxTriageDriver,
} from "@/lib/services/inbox-triage-driver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Control surface for the report-only Inbox Triage brain service: the boot
// autostart self-POSTs start over loopback; the dashboard card reads GET
// status and drives run/configure.

type Body = {
  action?: string;
  vaultPath?: string;
  brainServicesFolder?: string;
  inboxFolder?: string;
  enabled?: boolean;
  reportHour?: number;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    // Ensure-on-first-contact: `next dev -p` launch paths don't set PORT, so
    // the boot autostart can't reach us there — the dashboard card's status
    // fetch starts the driver instead. Idempotent; respects the kill switch.
    startInboxTriageDriver();
    const params = request.nextUrl.searchParams;
    const status = await getInboxTriageStatus({
      vaultPath: params.get("vaultPath") ?? undefined,
      brainServicesFolder: params.get("brainServicesFolder") ?? undefined,
      inboxFolder: params.get("inboxFolder") ?? undefined,
    });
    return NextResponse.json({ ok: true, status, driver: getInboxTriageDriverStatus() });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read Inbox Triage status.",
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const action = body.action ?? "status";
  const input = {
    vaultPath: body.vaultPath,
    brainServicesFolder: body.brainServicesFolder,
    inboxFolder: body.inboxFolder,
  };

  if (action === "start") {
    // The boot self-POST is direct loopback (no forwarded-for). If the request
    // arrived via a proxy from a non-loopback origin, require auth — same
    // contract as the company-autonomy driver route.
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const external = forwarded && !["127.0.0.1", "::1", "localhost"].includes(forwarded);
    if (external) {
      const unauthorized = await requireAuth(request);
      if (unauthorized) return unauthorized;
    }
    return NextResponse.json({ ok: true, driver: startInboxTriageDriver() });
  }

  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    if (action === "run") {
      const result = await runInboxTriage({ ...input, force: true });
      return NextResponse.json({ ok: true, result, driver: getInboxTriageDriverStatus() });
    }
    if (action === "configure") {
      const config = await writeInboxTriageNoteConfig(input, {
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        ...(typeof body.reportHour === "number" ? { reportHour: body.reportHour } : {}),
      });
      return NextResponse.json({ ok: true, config });
    }
    if (action === "stop") {
      return NextResponse.json({ ok: true, driver: await stopInboxTriageDriver() });
    }
    const status = await getInboxTriageStatus(input);
    return NextResponse.json({ ok: true, status, driver: getInboxTriageDriverStatus() });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Inbox Triage action failed.",
    }, { status: 500 });
  }
}
