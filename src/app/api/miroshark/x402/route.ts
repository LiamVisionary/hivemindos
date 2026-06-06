import {
  getMiroSharkX402Report,
  getMiroSharkX402Status,
  runMiroSharkX402,
  suggestMiroSharkX402,
  type MiroSharkX402RunRequest,
} from "@/lib/services/miroshark/x402-buyer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type MiroSharkX402RouteBody = MiroSharkX402RunRequest & {
  action?: "run" | "suggest" | "status" | "report";
  runId?: unknown;
  format?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as MiroSharkX402RouteBody;
    const action = body.action ?? "run";
    if (action === "suggest") {
      return Response.json({ ok: true, miroshark: await suggestMiroSharkX402(body.prompt) });
    }
    if (action === "status") {
      return Response.json({ ok: true, miroshark: await getMiroSharkX402Status(body.runId) });
    }
    if (action === "report") {
      return Response.json({ ok: true, miroshark: await getMiroSharkX402Report(body.runId, body.format) });
    }
    if (action !== "run") throw new Error(`Unsupported MiroShark x402 action: ${String(action)}`);

    const paidRun = await runMiroSharkX402(body);
    return Response.json({ ok: true, ...paidRun });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "MiroShark x402 request failed.",
    }, { status: 400 });
  }
}
