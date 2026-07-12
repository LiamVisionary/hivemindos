import { NextRequest } from "next/server";

import { renderGitHubOAuthPage } from "@/lib/services/integrations/github-oauth";
import { finishRobinhoodAgenticOAuth } from "@/lib/services/trading/robinhood-agentic";

export const runtime = "nodejs";

const RETURN_URL = "/?view=integrations&tab=mcp&robinhood=connected";

export async function GET(request: NextRequest) {
  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    return renderGitHubOAuthPage({
      title: "Robinhood authorization cancelled",
      body: request.nextUrl.searchParams.get("error_description") || oauthError,
      returnUrl: "/?view=integrations&tab=mcp",
      returnLabel: "Back to integrations",
      status: 400,
    });
  }
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  try {
    const status = await finishRobinhoodAgenticOAuth({ code, state });
    return renderGitHubOAuthPage({
      title: "Robinhood Agentic Trading connected",
      body: status.accounts.length
        ? "HivemindOS can now read your authorized Robinhood account context. Trading remains behind HivemindOS review, caps, and explicit confirmation."
        : "Robinhood authorization completed. Return to HivemindOS to select the dedicated Agentic account.",
      returnUrl: RETURN_URL,
      returnLabel: "Back to HivemindOS",
    });
  } catch (error) {
    return renderGitHubOAuthPage({
      title: "Robinhood connection failed",
      body: error instanceof Error ? error.message : "Could not finish Robinhood authorization.",
      returnUrl: "/?view=integrations&tab=mcp",
      returnLabel: "Back to integrations",
      status: 502,
    });
  }
}
