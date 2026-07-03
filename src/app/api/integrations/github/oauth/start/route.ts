import { NextRequest, NextResponse } from "next/server";
import {
  createGitHubOAuthState,
  normalizeGitHubOAuthSource,
  readGitHubOAuthConfig,
  renderGitHubOAuthPage,
} from "@/lib/services/integrations/github-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = await readGitHubOAuthConfig(request);
  const source = normalizeGitHubOAuthSource(request.nextUrl.searchParams.get("source"));
  if (config.missing.length) {
    return renderGitHubOAuthPage({
      title: "GitHub OAuth needs setup",
      body: `Add <code>${config.missing.join("</code> and <code>")}</code> to shared env or the dashboard process env, then retry — or paste a GitHub token in Integrations instead.`,
      returnUrl: "/?view=aeon",
      status: 503,
    });
  }

  const state = createGitHubOAuthState(source, config.clientSecret);
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("scope", config.scopes.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("allow_signup", "true");

  return NextResponse.redirect(authorizeUrl);
}
