import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import {
  getXMcpStatus,
  removeXMcpRuntimeConfigs,
  saveXMcpCredentials,
  startXMcpOAuth,
  syncXMcpRuntimeConfigs,
} from "@/lib/services/mcp/x-mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type XMcpBody = {
  action?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  targets?: string;
};

export async function GET(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ ok: true, status: await getXMcpStatus() });
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => ({})) as XMcpBody;
  try {
    switch (body.action) {
      case "save-credentials":
        return NextResponse.json({ ok: true, status: await saveXMcpCredentials(body) });
      case "start-oauth":
        return NextResponse.json(await startXMcpOAuth());
      case "sync-runtimes":
        return NextResponse.json(await syncXMcpRuntimeConfigs(body.targets));
      case "remove-runtimes":
        return NextResponse.json(await removeXMcpRuntimeConfigs(body.targets));
      default:
        return NextResponse.json({ ok: false, error: `Unknown action "${body.action ?? ""}".` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "X MCP action failed." },
      { status: 500 },
    );
  }
}
