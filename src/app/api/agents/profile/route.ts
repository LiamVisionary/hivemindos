import { NextRequest, NextResponse } from "next/server";

import { upsertStoredAgentProfile } from "@/lib/services/agent-profile-store";
import type { AgentProfile } from "@/lib/types/agent-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Remote agent-profile edits (phone app). Accepts the full edited profile and
 * upserts it into the dashboard's persisted agent store — the same place the
 * dashboard's own AgentSettingsModal edits land. Fleet discovery overlays
 * these stored profiles onto collector-discovered agents, so edits survive
 * refreshes and reach every client. Like the other phone-facing routes
 * (fleet/discover, chat/agent-runtime) this relies on tailnet-trust transport
 * auth rather than requireAuth.
 */
async function handleUpsert(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { agent?: Partial<AgentProfile> };
    const agent = body.agent;
    if (!agent || typeof agent !== "object" || typeof agent.id !== "string" || !agent.id.trim()) {
      throw new Error("A full agent profile with an id is required.");
    }
    if (typeof agent.name !== "string" || !agent.name.trim()) {
      throw new Error("The agent profile needs a name.");
    }
    const saved = await upsertStoredAgentProfile(agent as AgentProfile);
    return NextResponse.json({ ok: true, agent: saved });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the agent profile.",
    }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  return handleUpsert(request);
}

// POST alias: some transports (and older clients) only speak GET/POST.
export async function POST(request: NextRequest) {
  return handleUpsert(request);
}
