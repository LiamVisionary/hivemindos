import { NextRequest } from "next/server";
import {
  listLoadedAgentPlugins,
  loadAgentPlugin,
  unloadAgentPlugin,
} from "@/lib/services/agent-plugins/runtime";
import { inspectAgentPlugin } from "@/lib/services/agent-plugins/loader";
import { authorizeOperation, decisionAllowed } from "@/lib/services/security/action-authorization";
import { recordAuditEvent } from "@/lib/services/security/audit-events";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuthContext } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;
  return okJson({ plugins: listLoadedAgentPlugins() });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return errorJson("Invalid JSON body.", 400);

  const action = String(body.action ?? "");
  const pluginPath = String(body.pluginPath ?? "").trim();
  if (!pluginPath) return errorJson("Choose an Agent Plugin directory.", 400);

  if (action === "inspect") {
    const denied = await enforcePluginPolicy("agent-plugin:inspect", {
      id: "agent-plugin:inspect",
      title: "Inspect Agent Plugin package",
      sideEffects: ["read"],
      risk: "low",
      readOnly: true,
      requiredClaims: ["artifacts:read"],
    }, auth.principal, { pluginPath });
    if (denied) return denied;
    return okJson({ plugin: await inspectAgentPlugin(pluginPath) });
  }

  if (action === "load") {
    const denied = await enforcePluginPolicy("agent-plugin:load", {
      id: "agent-plugin:load",
      title: "Load Agent Plugin components",
      sideEffects: ["read", "write", "network", "credential"],
      risk: "high",
      requiredClaims: ["mcp:connect"],
    }, auth.principal, {
      pluginPath,
      importSkills: body.importSkills !== false,
      connectMcp: body.connectMcp !== false,
    });
    if (denied) return denied;
    const report = await loadAgentPlugin({
      pluginPath,
      vaultPath: typeof body.vaultPath === "string" ? body.vaultPath : undefined,
      importSkills: body.importSkills !== false,
      connectMcp: body.connectMcp !== false,
    }).catch((error) => pluginLoadError(error));
    if ("error" in report) return errorJson(report.error, 500);
    if (!report.loaded) {
      return errorJson("Agent Plugin manifest was rejected.", 400, { plugin: report });
    }
    return okJson({ plugin: report });
  }

  if (action === "unload") {
    const denied = await enforcePluginPolicy("agent-plugin:unload", {
      id: "agent-plugin:unload",
      title: "Disconnect Agent Plugin MCP servers",
      sideEffects: ["write"],
      risk: "medium",
      requiredClaims: ["mcp:connect"],
    }, auth.principal, { pluginPath });
    if (denied) return denied;
    return okJson(await unloadAgentPlugin(pluginPath));
  }

  return errorJson("Unknown Agent Plugin action '" + action + "'.", 400);
}

function pluginLoadError(error: unknown) {
  return {
    error: "Agent Plugin loading failed: " + (error instanceof Error ? error.message : "unknown error"),
  };
}

async function enforcePluginPolicy(
  auditType: string,
  operation: Parameters<typeof authorizeOperation>[0],
  principal: Parameters<typeof authorizeOperation>[1]["principal"],
  payload: Record<string, unknown>,
) {
  const decision = authorizeOperation(operation, { principal, caller: "agent-plugin" });
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
