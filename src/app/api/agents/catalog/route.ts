import { NextRequest } from "next/server";
import { getPackagedAgent, listPackagedAgents } from "@/lib/services/agents/agent-catalog";

export const runtime = "nodejs";

// GET /api/agents/catalog            -> list optional packaged agents (metadata, no soul)
// GET /api/agents/catalog?q=react    -> filtered list
// GET /api/agents/catalog?slug=foo   -> one agent incl. soulPrompt (for install)
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const slug = params.get("slug");
  try {
    if (slug) {
      const agent = await getPackagedAgent(slug);
      if (!agent) return Response.json({ ok: false, error: "Agent not found" }, { status: 404 });
      return Response.json({ ok: true, agent });
    }
    const agents = await listPackagedAgents(params.get("q") ?? undefined);
    return Response.json({ ok: true, count: agents.length, agents });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "catalog error" }, { status: 500 });
  }
}
