import { NextRequest, NextResponse } from "next/server";
import { createGitHubOAuthState, renderGitHubOAuthPage } from "@/lib/services/integrations/github-oauth";
import { readGoogleOAuthConfig } from "@/lib/services/integrations/google-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = await readGoogleOAuthConfig(request);
  if (config.missing.length) {
    return renderGitHubOAuthPage({
      title: "Google sign-in needs a one-time OAuth client",
      body: `Save a Google OAuth client (Desktop app type) in Integrations first — it stores <code>${config.missing.join("</code> and <code>")}</code> in the shared hive env.`,
      returnUrl: "/?view=integrations",
      returnLabel: "Back to integrations",
      status: 503,
    });
  }

  const state = createGitHubOAuthState("integrations", config.clientSecret);
  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", config.scopes.join(" "));
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("state", state);

  return NextResponse.redirect(authorizeUrl);
}
