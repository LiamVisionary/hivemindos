import { NextRequest, NextResponse } from "next/server";
import {
  LINKEDIN_AUTHORIZE_URL,
  createLinkedInOAuthState,
  readLinkedInOAuthConfig,
  renderLinkedInOAuthPage,
} from "@/lib/services/integrations/linkedin-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = await readLinkedInOAuthConfig(request);
  if (config.missing.length) {
    return renderLinkedInOAuthPage({
      title: "LinkedIn OAuth needs setup",
      body: `Add <code>${config.missing.join("</code> and <code>")}</code> to shared env or the dashboard process env, then retry — or paste a LinkedIn access token in Integrations instead.`,
      status: 503,
    });
  }

  const state = createLinkedInOAuthState(config.clientSecret);
  const authorizeUrl = new URL(LINKEDIN_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("scope", config.scopes.join(" "));
  authorizeUrl.searchParams.set("state", state);

  return NextResponse.redirect(authorizeUrl);
}
