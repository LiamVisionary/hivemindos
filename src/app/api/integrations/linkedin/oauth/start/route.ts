import { NextRequest, NextResponse } from "next/server";
import {
  LINKEDIN_AUTHORIZE_URL,
  createLinkedInOAuthState,
  readLinkedInOAuthConfig,
  renderLinkedInOAuthPage,
} from "@/lib/services/integrations/linkedin-oauth";
import { normalizeOAuthReturnMode, type OAuthReturnMode } from "@/lib/services/integrations/github-oauth";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
// guard:allow-hive-action-route - Authenticated browser OAuth initiation only; provider mutation occurs in the signed callback.

function buildLinkedInAuthorizeUrl(config: Awaited<ReturnType<typeof readLinkedInOAuthConfig>>, returnMode: OAuthReturnMode = "") {
  const state = createLinkedInOAuthState(config.clientSecret, returnMode);
  const authorizeUrl = new URL(LINKEDIN_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("scope", config.scopes.join(" "));
  authorizeUrl.searchParams.set("state", state);
  return authorizeUrl;
}

export async function GET(request: NextRequest) {
  const config = await readLinkedInOAuthConfig(request);
  if (config.missing.length) {
    return renderLinkedInOAuthPage({
      title: "LinkedIn OAuth needs setup",
      body: `Add <code>${config.missing.join("</code> and <code>")}</code> to shared env or the dashboard process env, then retry — or paste a LinkedIn access token in Integrations instead.`,
      status: 503,
    });
  }

  return NextResponse.redirect(buildLinkedInAuthorizeUrl(config));
}

/**
 * POST-JSON variant for the external-browser sign-in pattern: returns the
 * ABSOLUTE LinkedIn authorization URL (signed state included) so the app can
 * hand it to the user's external browser — which has no dashboard session, so
 * a same-origin GET link would 401 at the proxy out there.
 */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const config = await readLinkedInOAuthConfig(request);
  const body = (await request.json().catch(() => null)) as { returnMode?: unknown } | null;
  // Desktop flows declare themselves so the callback (rendered in a cookie-less
  // external browser) can offer the hivemindos:// deep link back to the app.
  const returnMode = normalizeOAuthReturnMode(body?.returnMode);
  if (config.missing.length) {
    return errorJson(
      `LinkedIn sign-in needs setup: add ${config.missing.join(" and ")} to shared env or the dashboard process env — or paste a LinkedIn access token in Integrations instead.`,
      503,
      { missing: config.missing },
    );
  }

  return okJson({ authorizationUrl: buildLinkedInAuthorizeUrl(config, returnMode).toString() });
}
