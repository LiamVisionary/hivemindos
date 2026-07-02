import { NextRequest, NextResponse } from "next/server";
import {
  createWorkEvent,
  createWorkEventTrigger,
  deleteWorkEvent,
  publishWorkEvent,
  readWorkEventsState,
} from "@/lib/services/work-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await readWorkEventsState()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.action === "create-event") {
      const result = await createWorkEvent({
        name: body.name ?? body.eventName,
        payloadGuidelines: body.payloadGuidelines,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "create-trigger") {
      const result = await createWorkEventTrigger({
        eventName: body.eventName ?? body.name,
        board: body.board,
        title: body.title,
        body: body.body,
        assignee: body.assignee,
        tenant: body.tenant,
        priority: body.priority,
        status: body.status,
        skills: body.skills,
        targetMachine: body.targetMachine,
        emitEventName: body.emitEventName,
        enabled: body.enabled,
        idempotencyKey: body.idempotencyKey,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "delete-event") {
      const result = await deleteWorkEvent(body.eventName ?? body.name);
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "publish") {
      const result = await publishWorkEvent(
        {
          eventName: body.eventName ?? body.name,
          payload: body.payload,
          faq: body.faq,
          source: body.source,
        },
        {
          vaultPath: body.vaultPath,
          kanbanFolder: body.kanbanFolder,
        },
      );
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json(
      { ok: false, error: `Unknown work-events action "${body.action}".` },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Work event request failed.";
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}
