import { configureMiroSharkAdminAuth, getMiroSharkCompanionStatus, startMiroSharkSetup } from "@/lib/services/miroshark/companion-client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { action?: "install" | "start" | "configure-admin" } | null;
  const action = body?.action;

  if (action !== "install" && action !== "start" && action !== "configure-admin") {
    return Response.json({ ok: false, error: "Unsupported MiroShark action" }, { status: 400 });
  }

  if (action === "configure-admin") {
    configureMiroSharkAdminAuth();
  } else {
    startMiroSharkSetup(action);
  }
  return Response.json(await getMiroSharkCompanionStatus({ requestUrl: request.url }));
}
