import {
  mcpClientStatus,
  type McpServerStatus,
} from "@/lib/services/mcp/client";

type McpStatus = { enabled: boolean; servers: McpServerStatus[] };

function compactJson(value: unknown, maxLength = 900) {
  let text = "{}";
  try {
    text = JSON.stringify(value ?? {});
  } catch {
    // Invalid schemas are still discoverable by name and description.
  }
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function toolSafetyLabel(annotations?: Record<string, unknown>) {
  if (annotations?.readOnlyHint === true && annotations?.destructiveHint !== true) {
    return "read-only; may run automatically";
  }
  const confirmation = annotations?.["hivemindos/confirmation"];
  if (confirmation && typeof confirmation === "object") {
    return "mutating; requires its declared confirmation";
  }
  return "write status unknown or mutating; requires explicit permission";
}

/**
 * Volatile prompt-tail inventory for MCP servers connected to the in-app host.
 * The stable model tool stays provider-neutral; this roster tells it which live
 * server/tool/schema to pass to that executor without baking provider names in
 * Queen Bee's prompt.
 */
export function buildConnectedMcpCapabilityContext(
  status: McpStatus = mcpClientStatus(),
) {
  if (!status.enabled || !status.servers.length) return "";
  const lines = [
    "Connected MCP capabilities (live in-app MCP host):",
  ];
  let shown = 0;
  let total = 0;
  for (const server of status.servers) {
    total += server.tools.length;
    for (const tool of server.tools) {
      if (shown >= 24) continue;
      shown += 1;
      lines.push([
        `- server=${server.id}; tool=${tool.name}`,
        `safety=${toolSafetyLabel(tool.annotations)}`,
        tool.description?.trim() ? `description=${tool.description.trim()}` : "",
        `inputSchema=${compactJson(tool.inputSchema)}`,
      ].filter(Boolean).join("; "));
    }
  }
  if (total > shown) lines.push(`- ${total - shown} additional live MCP tool${total - shown === 1 ? "" : "s"}; inspect them with operation=list.`);
  return lines.join("\n");
}
