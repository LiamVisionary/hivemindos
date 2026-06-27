import { NextRequest, NextResponse } from "next/server";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { checkVeniceModels, testVeniceChat, veniceKeyPresence } from "@/lib/services/venice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VeniceStatusBody = {
  agent?: AgentProfile;
  action?: "models" | "chat-test" | "key-present";
  model?: string;
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as VeniceStatusBody;
  const agent = body.agent;
  if (!agent) {
    return NextResponse.json({ ok: false, error: "Agent profile is required." }, { status: 400 });
  }
  const profile = { ...agent, provider: "venice" };
  // Fast local presence check — no Venice round-trip — so setup can decide
  // instantly whether a saved credential exists.
  if (body.action === "key-present") {
    const presence = await veniceKeyPresence(profile);
    return NextResponse.json({ ok: true, ...presence }, { status: 200 });
  }
  const result = body.action === "chat-test"
    ? await testVeniceChat(profile, body.model ?? profile.model ?? "")
    : await checkVeniceModels(profile);
  return NextResponse.json(result, { status: 200 });
}
