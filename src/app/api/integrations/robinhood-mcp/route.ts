import { NextRequest } from "next/server";

import {
  ROBINHOOD_AGENTIC_READ_TOOLS,
  callRobinhoodAgenticReadTool,
  disconnectRobinhoodAgentic,
  robinhoodAgenticStatus,
  selectRobinhoodAgenticAccount,
  startRobinhoodAgenticOAuth,
} from "@/lib/services/trading/robinhood-agentic";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RobinhoodMcpBody = {
  action?: "connect" | "disconnect" | "select-account" | "read";
  accountId?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  return okJson({
    ...(await robinhoodAgenticStatus({ reconnect: true, includeAccounts: true })),
    readTools: [...ROBINHOOD_AGENTIC_READ_TOOLS],
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as RobinhoodMcpBody;
  try {
    if (body.action === "connect") {
      const callbackUrl = new URL("/api/integrations/robinhood-mcp/callback", request.nextUrl.origin);
      return okJson(await startRobinhoodAgenticOAuth(callbackUrl.toString()));
    }
    if (body.action === "disconnect") {
      await disconnectRobinhoodAgentic();
      return okJson({ connected: false });
    }
    if (body.action === "select-account") {
      const accountId = body.accountId?.trim();
      if (!accountId) return errorJson("Choose a Robinhood Agentic account.", 400);
      await selectRobinhoodAgenticAccount(accountId);
      return okJson(await robinhoodAgenticStatus({ reconnect: false, includeAccounts: true }));
    }
    if (body.action === "read" || body.tool) {
      const tool = body.tool?.trim() || "";
      if (!tool) return errorJson("A read-only Robinhood tool is required.", 400);
      const result = await callRobinhoodAgenticReadTool(tool, body.arguments ?? {});
      return okJson({ tool, result });
    }
    return errorJson("Unknown Robinhood MCP action.", 400);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Robinhood MCP request failed.", 502);
  }
}
