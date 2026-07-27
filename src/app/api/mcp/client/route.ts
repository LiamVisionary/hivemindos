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
import { authorizeOperation, decisionAllowed } from "@/lib/services/security/action-authorization";
import { recordAuditEvent } from "@/lib/services/security/audit-events";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuthContext } from "@/lib/utils/server-auth";

export const runtime = "nodejs";

// GET  /api/mcp/client                 -> { enabled, servers: [...] }
export async function GET(request: NextRequest) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;
  return okJson(mcpClientStatus());
}

// POST /api/mcp/client { action, ... }
//   set-enabled  { enabled }
//   connect      { server: McpServerConfig }
//   list-tools   { id }
//   call-tool    { id, name, args }
//   disconnect   { id }
export async function POST(request: NextRequest) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorJson("Invalid JSON body", 400);
  }
  const action = String(body.action ?? "");
  try {
    switch (action) {
      case "set-enabled": {
        const denied = await enforceMcpPolicy("mcp-client:set-enabled", {
          id: "mcp-client:set-enabled",
          title: "Enable or disable MCP client",
          sideEffects: ["write"],
          risk: "medium",
          requiredClaims: ["mcp:connect"],
        }, auth.principal);
        if (denied) return denied;
        await setMcpClientEnabled(Boolean(body.enabled));
        return okJson({ enabled: isMcpClientEnabled() });
      }
      case "connect": {
        const server = body.server as McpServerConfig | undefined;
        if (!server?.id || !server.transport) return errorJson("Missing server config", 400);
        const denied = await enforceMcpPolicy("mcp-client:connect", {
          id: "mcp-client:connect",
          title: "Connect MCP server",
          sideEffects: ["network", "credential"],
          risk: "high",
          requiredClaims: ["mcp:connect"],
        }, auth.principal, { serverId: server.id, transport: server.transport });
        if (denied) return denied;
        return okJson({ server: await connectMcpServer(server) });
      }
      case "list-tools": {
        const denied = await enforceMcpPolicy("mcp-client:list-tools", {
          id: "mcp-client:list-tools",
          title: "List MCP tools",
          sideEffects: ["read", "network"],
          risk: "low",
          readOnly: true,
          requiredClaims: ["mcp:invoke"],
        }, auth.principal, { serverId: String(body.id) });
        if (denied) return denied;
        return okJson({ tools: await listMcpTools(String(body.id)) });
      }
      case "call-tool": {
        const serverId = String(body.id);
        const toolName = String(body.name);
        const denied = await enforceMcpPolicy("mcp-client:call-tool", {
          id: "mcp-client:call-tool",
          title: "Call MCP tool",
          sideEffects: ["network"],
          risk: "high",
          requiredClaims: ["mcp:invoke"],
        }, auth.principal, { serverId, toolName });
        if (denied) return denied;
        const result = await callMcpTool(serverId, toolName, (body.args as Record<string, unknown>) ?? {});
        return okJson({ result });
      }
      case "disconnect": {
        const denied = await enforceMcpPolicy("mcp-client:disconnect", {
          id: "mcp-client:disconnect",
          title: "Disconnect MCP server",
          sideEffects: ["write"],
          risk: "medium",
          requiredClaims: ["mcp:connect"],
        }, auth.principal, { serverId: String(body.id) });
        if (denied) return denied;
        await disconnectMcpServer(String(body.id));
        return okJson();
      }
      default:
        return errorJson(`Unknown action "${action}"`, 400);
    }
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "mcp client error", 500);
  }
}

async function enforceMcpPolicy(
  auditType: string,
  operation: Parameters<typeof authorizeOperation>[0],
  principal: Parameters<typeof authorizeOperation>[1]["principal"],
  payload: Record<string, unknown> = {},
) {
  const decision = authorizeOperation(operation, { principal, caller: "mcp" });
  await recordAuditEvent({
    type: auditType,
    principal,
    decision,
    target: operation.id,
    payload,
  });
  if (decisionAllowed(decision)) return null;
  return errorJson(decision.reason, decision.status === "needs-approval" ? 409 : 403, { decision });
}
