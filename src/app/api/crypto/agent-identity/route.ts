import { NextRequest, NextResponse } from "next/server";
import {
  getAgentIdentity,
  listAgentIdentities,
  retireAgentIdentity,
  upsertAgentIdentity,
  type AgentIdentityInput,
} from "@/lib/services/crypto/agent-identity-registry";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AgentIdentityBody = AgentIdentityInput & {
  action?: "list" | "get" | "upsert" | "retire";
  id?: string;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const id = request.nextUrl.searchParams.get("id")?.trim()
    || request.nextUrl.searchParams.get("agentId")?.trim()
    || "";
  if (id) {
    const record = await getAgentIdentity(id);
    return NextResponse.json({ ok: true, record });
  }
  const records = await listAgentIdentities();
  return NextResponse.json({ ok: true, records });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as AgentIdentityBody;
    const action = body.action ?? "upsert";
    if (action === "list") {
      const records = await listAgentIdentities();
      return NextResponse.json({ ok: true, records });
    }
    if (action === "get") {
      const id = body.id?.trim() || body.agentId?.trim();
      if (!id) return identityError("id or agentId is required.");
      const record = await getAgentIdentity(id);
      return NextResponse.json({ ok: true, record });
    }
    if (action === "retire") {
      const id = body.id?.trim() || body.agentId?.trim();
      if (!id) return identityError("id or agentId is required.");
      const record = await retireAgentIdentity(id);
      return NextResponse.json({ ok: true, record });
    }
    const result = await upsertAgentIdentity(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return identityError(error instanceof Error ? error.message : "Could not update agent identity.");
  }
}

function identityError(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
