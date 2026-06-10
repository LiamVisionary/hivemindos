import {
  canonicalLocalCollectorUrl,
  normalizeCollectorUrl,
} from "@/lib/services/local-collector-url";

export const runtime = "nodejs";

type WorkReceiptRequest = {
  collectorUrl?: string;
  agentId?: string;
  agentName?: string;
  taskId?: string;
  taskTitle?: string;
  board?: string;
  repoPath?: string;
};

// Forwards a work-receipt request to the collector on the machine where the
// agent actually ran, which signs it with that agent's DID. Server-side so the
// browser never talks to remote collectors directly.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as WorkReceiptRequest;
  if (!body.agentId?.trim()) {
    return Response.json(
      { ok: false, error: "agentId is required." },
      { status: 400 },
    );
  }
  const collectorBase =
    normalizeCollectorUrl(body.collectorUrl) ||
    (await canonicalLocalCollectorUrl(body.collectorUrl ?? null).catch(
      () => "",
    ));
  if (!collectorBase) {
    return Response.json(
      { ok: false, error: "No collector URL for this agent's machine." },
      { status: 400 },
    );
  }
  const response = await fetch(
    `${collectorBase.replace(/\/+$/, "")}/work-receipts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: body.agentId,
        agentName: body.agentName,
        taskId: body.taskId,
        taskTitle: body.taskTitle,
        board: body.board,
        repoPath: body.repoPath,
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    },
  ).catch(() => null);
  const data = (await response?.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    receipt?: unknown;
  } | null;
  if (!response?.ok || !data?.ok) {
    return Response.json(
      {
        ok: false,
        error:
          data?.error ??
          "The machine's agent bridge could not sign a work receipt (it may need an update).",
      },
      { status: 502 },
    );
  }
  return Response.json({ ok: true, receipt: data.receipt });
}
