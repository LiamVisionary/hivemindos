import { NextRequest } from "next/server";
import { computerInteractionRunStore } from "@/lib/services/computer-interaction/server";
import type { ComputerInteractionRunStatus } from "@/lib/services/computer-interaction";
import { errorJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL = new Set<ComputerInteractionRunStatus>(["completed", "failed", "stopped"]);
const encoder = new TextEncoder();

export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("runId")?.trim();
  if (!runId) return errorJson("runId is required for computer interaction events.", 400);
  const run = await computerInteractionRunStore.readRun(runId);
  if (!run) return errorJson("Computer interaction run not found.", 404);
  const queryAfter = Number(request.nextUrl.searchParams.get("after") || 0);
  const headerAfter = Number(request.headers.get("Last-Event-ID") || 0);
  let cursor = Math.max(Number.isFinite(queryAfter) ? queryAfter : 0, Number.isFinite(headerAfter) ? headerAfter : 0);
  let cancelled = false;
  let lastHeartbeatAt = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          while (!cancelled && !request.signal.aborted) {
            const events = await computerInteractionRunStore.listEvents(runId, cursor);
            for (const event of events) {
              cursor = Math.max(cursor, event.sequence);
              controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
            }
            const current = await computerInteractionRunStore.readRun(runId);
            if (!current || (TERMINAL.has(current.status) && events.length === 0)) break;
            if (!events.length && Date.now() - lastHeartbeatAt >= 15_000) {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
              lastHeartbeatAt = Date.now();
            }
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
        } catch (error) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : "Event stream failed." })}\n\n`));
        } finally {
          if (!cancelled) controller.close();
        }
      })();
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
