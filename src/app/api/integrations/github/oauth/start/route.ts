import { NextRequest, NextResponse } from "next/server";
import {
  createGitHubOAuthState,
  normalizeGitHubOAuthSource,
  normalizeOAuthReturnMode,
  readGitHubOAuthConfig,
  renderGitHubOAuthPage,
  type OAuthReturnMode,
} from "@/lib/services/integrations/github-oauth";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";

function buildGitHubAuthorizeUrl(config: Awaited<ReturnType<typeof readGitHubOAuthConfig>>, source: string, returnMode: OAuthReturnMode = "") {
  const state = createGitHubOAuthState(source, config.clientSecret, returnMode);
  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("scope", config.scopes.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("allow_signup", "true");
  return authorizeUrl;
}

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

  return NextResponse.redirect(buildGitHubAuthorizeUrl(config, source));
}

/**
 * POST-JSON variant for the external-browser sign-in pattern: the app asks its
 * own server (authenticated) for the ABSOLUTE GitHub authorization URL, then
 * hands that to the user's external browser — which has no dashboard session,
 * so a same-origin GET link would 401 at the proxy out there. The `source`
 * ("integrations" | "aeon") rides in the signed `state` exactly like the GET
 * flow and steers the callback's return URL; it is read from the JSON body
 * first, then the query string.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const config = await readGitHubOAuthConfig(request);
  const body = (await request.json().catch(() => null)) as { source?: unknown; returnMode?: unknown } | null;
  const source = normalizeGitHubOAuthSource(
    typeof body?.source === "string" ? body.source : request.nextUrl.searchParams.get("source"),
  );
  // Desktop flows declare themselves so the callback (rendered in a cookie-less
  // external browser) can offer the hivemindos:// deep link back to the app.
  const returnMode = normalizeOAuthReturnMode(body?.returnMode);
  if (config.missing.length) {
    return errorJson(
      `GitHub sign-in needs setup: add ${config.missing.join(" and ")} to shared env or the dashboard process env — or paste a GitHub token in Integrations instead.`,
      503,
      { missing: config.missing },
    );
  }

  return okJson({ authorizationUrl: buildGitHubAuthorizeUrl(config, source, returnMode).toString() });
}
