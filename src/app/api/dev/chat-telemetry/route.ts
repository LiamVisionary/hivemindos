import { NextRequest, NextResponse } from "next/server";
import { readRuntimeChatSession } from "@/lib/services/chat/runtime-session-store";
import { chatTelemetrySession } from "@/lib/services/telemetry/chat-dev-telemetry";
import { localTelemetryEnabled, queryTelemetryEvents } from "@/lib/services/telemetry/local-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function numberParam(request: NextRequest, name: string) {
  const value = Number(request.nextUrl.searchParams.get(name) || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function GET(request: NextRequest) {
  if (!localTelemetryEnabled()) {
    return NextResponse.json({ ok: true, enabled: false, events: [], session: null });
  }

  const threadId = request.nextUrl.searchParams.get("threadId") || request.nextUrl.searchParams.get("chatStorageKey");
  const sessionId = request.nextUrl.searchParams.get("sessionId") || undefined;
  const agentId = request.nextUrl.searchParams.get("agentId") || undefined;
  const runtimeName = request.nextUrl.searchParams.get("runtime") || undefined;
  const since = numberParam(request, "since");
  const limit = numberParam(request, "limit");
  const byThread = await queryTelemetryEvents({
    threadId,
    since,
    limit: limit ?? 500,
  });
  const byRun = sessionId ? await queryTelemetryEvents({
    runId: sessionId,
    since,
    limit: limit ?? 500,
  }) : { file: byThread.file, events: [] };
  const eventsById = new Map([...byThread.events, ...byRun.events].map((event) => [event.id, event]));
  const events = [...eventsById.values()].sort((left, right) => right.ts - left.ts).slice(0, limit ?? 500);
  const session = await readRuntimeChatSession({
    sessionId,
    agentId,
    runtime: runtimeName,
    chatStorageKey: threadId ?? undefined,
    sinceMs: since ?? undefined,
  }).catch(() => null);

  return NextResponse.json({
    ok: true,
    enabled: true,
    telemetryFile: byThread.file,
    count: events.length,
    events,
    session: chatTelemetrySession(session),
  });
}
