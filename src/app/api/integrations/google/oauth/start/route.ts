// guard:allow-hive-action-route - OAuth authorization redirect starter for the dashboard Google connect flow.
import { NextRequest, NextResponse } from "next/server";
import { createGitHubOAuthState, normalizeOAuthReturnMode, renderGitHubOAuthPage, type OAuthReturnMode } from "@/lib/services/integrations/github-oauth";
import { readGoogleOAuthConfig } from "@/lib/services/integrations/google-oauth";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const { authorizeUrl, missing } = await googleAuthorizeUrl(request);
  if (missing.length) {
    return renderGoogleMissingClientPage(missing);
  }

  return NextResponse.redirect(authorizeUrl);
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  // Desktop flows declare themselves so the callback (rendered in a cookie-less
  // external browser) can offer the hivemindos:// deep link back to the app.
  const body = (await request.json().catch(() => null)) as { returnMode?: unknown } | null;
  const { authorizeUrl, missing } = await googleAuthorizeUrl(request, normalizeOAuthReturnMode(body?.returnMode));
  if (missing.length) {
    return errorJson(
      `Save a Google OAuth client first (${missing.join(", ")}).`,
      503,
      { missing },
    );
  }

  return okJson({ authorizationUrl: authorizeUrl.toString() });
}

async function googleAuthorizeUrl(request: NextRequest, returnMode: OAuthReturnMode = "") {
  const config = await readGoogleOAuthConfig(request);
  if (config.missing.length) {
    return { authorizeUrl: new URL("https://accounts.google.com/o/oauth2/v2/auth"), missing: config.missing };
  }

  const state = createGitHubOAuthState("integrations", config.clientSecret, returnMode);
  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", config.scopes.join(" "));
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("state", state);

  return { authorizeUrl, missing: [] };
}

function renderGoogleMissingClientPage(missing: string[]) {
  return renderGitHubOAuthPage({
    title: "Google sign-in needs a one-time OAuth client",
    body: `Save a Google OAuth client (Desktop app type) in Integrations first — it stores <code>${missing.join("</code> and <code>")}</code> in the shared hive env.`,
    returnUrl: "/?view=integrations",
    returnLabel: "Back to integrations",
    status: 503,
  });
}
