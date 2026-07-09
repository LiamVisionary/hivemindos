import { NextRequest } from "next/server";

import { renderGitHubOAuthPage } from "@/lib/services/integrations/github-oauth";
import { exchangeGoogleCloudCode } from "@/lib/services/integrations/google-cloud-oauth";

export const runtime = "nodejs";

// This is the browser redirect target from Google's consent screen, NOT an
// authed dashboard call, so it is NOT gated by requireAuth — same as the
// Drive/Gmail Google callback route. The signed `state` (PKCE verifier + HMAC +
// 10-minute TTL) is what authenticates the flow.
const RETURN_URL = "/?view=integrations&connections=google-cloud";
const RETURN_LABEL = "Back to integrations";

export async function GET(request: NextRequest) {
  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    return renderGitHubOAuthPage({
      title: "Google Cloud authorization cancelled",
      body: request.nextUrl.searchParams.get("error_description") || oauthError,
      returnUrl: "/?view=integrations",
      returnLabel: RETURN_LABEL,
      status: 400,
    });
  }

  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";

  try {
    await exchangeGoogleCloudCode(code, state, request);
    return renderGitHubOAuthPage({
      title: "Google Cloud connected",
      body: "Saved Google Cloud access to the shared hive env. Your hive can now use Google Cloud on every machine.",
      returnUrl: RETURN_URL,
      returnLabel: RETURN_LABEL,
    });
  } catch (error) {
    return renderGitHubOAuthPage({
      title: "Google Cloud sign-in failed",
      body: error instanceof Error ? error.message : "Could not finish Google Cloud sign-in.",
      returnUrl: "/?view=integrations",
      returnLabel: RETURN_LABEL,
      status: 502,
    });
  }
}
