import { NextRequest, NextResponse } from "next/server";
import {
  createMobileAgent,
  deleteMobileAgent,
  listMobileAgentHosts,
  listMobileAgents,
} from "@/lib/services/mobile-agents/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phone-hosted agents live in the hub's own store (~/.hivemindos) because
// phones run no collector. The phone app runs their turns via /api/phone
// "agent-host-*" actions; fleet discovery merges them onto the phone machine.

function errorResponse(error: unknown, fallback: string) {
  return NextResponse.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : fallback,
    },
    { status: 400 },
  );
}

export async function GET() {
  try {
    const [agents, hosts] = await Promise.all([
      listMobileAgents(),
      listMobileAgentHosts(),
    ]);
    return NextResponse.json({ ok: true, agents, hosts });
  } catch (error) {
    return errorResponse(error, "Could not read mobile agents.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      machineName?: string;
      name?: string;
      model?: string;
      systemPrompt?: string;
    };
    const agent = await createMobileAgent({
      machineName: String(body.machineName ?? ""),
      name: String(body.name ?? ""),
      model: String(body.model ?? ""),
      systemPrompt:
        typeof body.systemPrompt === "string" ? body.systemPrompt : undefined,
    });
    return NextResponse.json({ ok: true, agent });
  } catch (error) {
    return errorResponse(error, "Could not create the mobile agent.");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: string };
    const id = String(body.id ?? "").trim();
    if (!id) throw new Error("An agent id is required.");
    const deleted = await deleteMobileAgent(id);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return errorResponse(error, "Could not delete the mobile agent.");
  }
}
