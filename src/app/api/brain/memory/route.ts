import { NextRequest, NextResponse } from "next/server";
import {
  answerFromAgentMemory,
  evolveAgentMemory,
  recallAgentMemory,
  recordAgentMemoryUsage,
  rememberAgentMemory,
  rememberActionAgentMemory,
  rebuildAgentMemoryIndex,
  type EvolveAgentMemoryInput,
  type RecallAgentMemoryInput,
  type RebuildAgentMemoryIndexInput,
  type RecordAgentMemoryUsageInput,
  type RememberAgentMemoryInput,
} from "@/lib/services/obsidian/agent-memory";

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
    scope: params.get("scope") ?? undefined,
    temporalMode: (params.get("temporalMode") as RecallAgentMemoryInput["temporalMode"] | null) ?? undefined,
    asOf: params.get("asOf") ?? undefined,
    trackUsage: params.get("trackUsage") === "1",
    usageContext: params.get("usageContext") ?? undefined,
  };
}

export async function GET(request: NextRequest) {
  try {
    const mode = request.nextUrl.searchParams.get("mode") ?? "recall";
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
      action?: "remember" | "remember-action" | "evolve" | "recall" | "answer" | "rebuild-index" | "record-usage";
    });
    const action = body.action ?? "recall";
    if (action === "remember") {
      const result = await rememberAgentMemory(body);
      return NextResponse.json({ ok: true, action, ...result });
    }
    if (action === "remember-action") {
      const result = await rememberActionAgentMemory(body);
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
