import { NextRequest, NextResponse } from "next/server";
import {
  answerFromAgentMemory,
  consolidateAgentMemory,
  evolveAgentMemory,
  healthAgentMemory,
  recallAgentMemory,
  recordAgentMemoryUsage,
  rememberAgentMemory,
  rebuildAgentMemoryIndex,
  type EvolveAgentMemoryInput,
  type RecallAgentMemoryInput,
  type RebuildAgentMemoryIndexInput,
  type RecordAgentMemoryUsageInput,
  type RememberAgentMemoryInput,
} from "@/lib/services/obsidian/agent-memory";
import { reviewOperationalPatterns } from "@/lib/services/brain-pattern-mining";
import { recordAgentOperationalEvent } from "@/lib/services/obsidian/agent-memory/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function recallInputFromSearchParams(request: NextRequest): RecallAgentMemoryInput {
  const params = request.nextUrl.searchParams;
  return {
    vaultPath: params.get("vaultPath") ?? undefined,
    query: params.get("q") ?? params.get("query") ?? undefined,
    type: params.get("type") ?? undefined,
    project: params.get("project") ?? undefined,
    tags: params.get("tags")?.split(",").map((tag) => tag.trim()).filter(Boolean),
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
    includeArchived: params.get("includeArchived") === "1",
    includeOperational: params.get("includeOperational") === "1",
    scope: params.get("scope") ?? undefined,
    temporalMode: (params.get("temporalMode") as RecallAgentMemoryInput["temporalMode"] | null) ?? undefined,
    asOf: params.get("asOf") ?? undefined,
    trackUsage: params.get("trackUsage") === "1",
    usageContext: params.get("usageContext") ?? undefined,
    minScore: params.get("minScore") ? Number(params.get("minScore")) : undefined,
  };
}

export async function GET(request: NextRequest) {
  try {
    const mode = request.nextUrl.searchParams.get("mode") ?? "recall";
    if (mode === "health") {
      const result = await healthAgentMemory({ vaultPath: request.nextUrl.searchParams.get("vaultPath") ?? undefined });
      return NextResponse.json({ ok: true, mode, ...result });
    }
    const input = recallInputFromSearchParams(request);
    const result = mode === "answer"
      ? await answerFromAgentMemory(input)
      : await recallAgentMemory(input);
    return NextResponse.json({ ok: true, mode, ...result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not recall shared-brain memory.",
    }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as (RememberAgentMemoryInput & EvolveAgentMemoryInput & RecallAgentMemoryInput & RebuildAgentMemoryIndexInput & RecordAgentMemoryUsageInput & {
      action?: "remember" | "remember-action" | "record-operation" | "mine-patterns" | "evolve" | "recall" | "answer" | "rebuild-index" | "record-usage" | "health" | "consolidate";
      applyArchives?: boolean;
      enqueueProposals?: boolean;
      since?: string;
    });
    const action = body.action ?? "recall";
    if (action === "remember") {
      const result = await rememberAgentMemory(body);
      // Suspected duplicate: surface conflicts + evolve hint instead of writing.
      if (result.blocked) return NextResponse.json({ ok: false, action, ...result }, { status: 409 });
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "remember-action" || action === "record-operation") {
      const result = await recordAgentOperationalEvent(body);
      return NextResponse.json({ ok: true, action, durableMemoryWritten: false, ...result });
    }
    if (action === "mine-patterns") {
      const result = await reviewOperationalPatterns(body);
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "health") {
      const result = await healthAgentMemory(body);
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "consolidate") {
      const result = await consolidateAgentMemory(body);
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "evolve") {
      const result = await evolveAgentMemory(body);
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "answer") {
      const result = await answerFromAgentMemory(body);
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "recall") {
      const result = await recallAgentMemory(body);
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "rebuild-index") {
      const result = await rebuildAgentMemoryIndex(body);
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "record-usage") {
      const result = await recordAgentMemoryUsage(body);
      return NextResponse.json({ ok: true, action, ...result });
    }
    return NextResponse.json({ ok: false, error: "Unsupported memory action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not update shared-brain memory.",
    }, { status: 400 });
  }
}
