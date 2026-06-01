import { NextRequest, NextResponse } from "next/server";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { checkUsePodModels, readUsePodSavedSetup, testUsePodChat } from "@/lib/services/usepod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UsePodStatusBody = {
  agent?: AgentProfile;
  action?: "metadata" | "models" | "chat-test";
  model?: string;
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as UsePodStatusBody;
  const agent = body.agent;
  if (!agent) {
    return NextResponse.json({ ok: false, error: "Agent profile is required." }, { status: 400 });
  }
  const profile = { ...agent, provider: "usepod" };
  const result = body.action === "metadata"
    ? await readUsePodSavedSetup(profile)
    : body.action === "chat-test"
    ? await testUsePodChat(profile, body.model ?? profile.model ?? "")
    : await checkUsePodModels(profile);
  return NextResponse.json(result, { status: result.ok ? 200 : 200 });
}
