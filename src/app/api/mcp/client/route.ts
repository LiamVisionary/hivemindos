import { NextRequest } from "next/server";
import {
  callMcpTool,
  connectMcpServer,
  disconnectMcpServer,
  isMcpClientEnabled,
  listMcpTools,
  mcpClientStatus,
  setMcpClientEnabled,
  type McpServerConfig,
} from "@/lib/services/mcp/client";

export const runtime = "nodejs";

// GET  /api/mcp/client                 -> { enabled, servers: [...] }
export async function GET() {
  return Response.json({ ok: true, ...mcpClientStatus() });
}

// POST /api/mcp/client { action, ... }
//   set-enabled  { enabled }
//   connect      { server: McpServerConfig }
//   list-tools   { id }
//   call-tool    { id, name, args }
//   disconnect   { id }
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  try {
    switch (action) {
      case "set-enabled": {
        await setMcpClientEnabled(Boolean(body.enabled));
        return Response.json({ ok: true, enabled: isMcpClientEnabled() });
      }
      case "connect": {
        const server = body.server as McpServerConfig | undefined;
        if (!server?.id || !server.transport) return Response.json({ ok: false, error: "Missing server config" }, { status: 400 });
        return Response.json({ ok: true, server: await connectMcpServer(server) });
      }
      case "list-tools": {
        return Response.json({ ok: true, tools: await listMcpTools(String(body.id)) });
      }
      case "call-tool": {
        const result = await callMcpTool(String(body.id), String(body.name), (body.args as Record<string, unknown>) ?? {});
        return Response.json({ ok: true, result });
      }
      case "disconnect": {
        await disconnectMcpServer(String(body.id));
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ ok: false, error: `Unknown action "${action}"` }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "mcp client error" }, { status: 500 });
  }
}
