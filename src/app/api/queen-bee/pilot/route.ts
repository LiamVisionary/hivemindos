import { NextRequest, NextResponse } from "next/server";

import type { BeePilotContext } from "@/features/dashboard/bee-pilot/bee-pilot-actions";
import { runQueenBeePilotTurn } from "@/lib/services/queen-bee/pilot-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stringList(value: unknown, max = 64): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim().slice(0, 80))
    .slice(0, max);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      command?: unknown;
      vaultPath?: unknown;
      context?: { agentNames?: unknown; machineNames?: unknown; kanbanColumns?: unknown; activeView?: unknown };
    };
    const command = typeof body.command === "string" ? body.command.trim().slice(0, 600) : "";
    if (!command) {
      return NextResponse.json({ ok: false, error: "A command is required." }, { status: 400 });
    }
    const context: BeePilotContext = {
      agentNames: stringList(body.context?.agentNames),
      machineNames: stringList(body.context?.machineNames, 24),
      kanbanColumns: stringList(body.context?.kanbanColumns, 8),
      activeView: typeof body.context?.activeView === "string" ? body.context.activeView : undefined,
    };
    const plan = await runQueenBeePilotTurn({
      origin: request.nextUrl.origin,
      command,
      context,
      vaultPath: typeof body.vaultPath === "string" ? body.vaultPath : undefined,
    });
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bee pilot request failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
