import { NextRequest } from "next/server";
import { integrationsOAuthDeepLink, renderGitHubOAuthPage, verifyGitHubOAuthState } from "@/lib/services/integrations/github-oauth";
import { parkOAuthReturn } from "@/lib/services/integrations/oauth-return-store";
import { readGoogleOAuthConfig, saveGoogleRefreshToken } from "@/lib/services/integrations/google-oauth";

export const runtime = "nodejs";

const RETURN_URL = "/?view=integrations&connections=google";
const RETURN_LABEL = "Back to integrations";

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

export async function GET(request: NextRequest) {
  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    return renderGitHubOAuthPage({
      title: "Google authorization cancelled",
      body: request.nextUrl.searchParams.get("error_description") || oauthError,
      returnUrl: "/?view=integrations",
      returnLabel: RETURN_LABEL,
      status: 400,
    });
  }

  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const config = await readGoogleOAuthConfig(request);
  if (config.missing.length) {
    return renderGitHubOAuthPage({
      title: "Google sign-in needs a one-time OAuth client",
      body: `Save a Google OAuth client in Integrations first — it stores <code>${config.missing.join("</code> and <code>")}</code> in the shared hive env.`,
      returnUrl: "/?view=integrations",
      returnLabel: RETURN_LABEL,
      status: 503,
    });
  }

  const verifiedState = verifyGitHubOAuthState(state, config.clientSecret);
  if (!verifiedState || !code) {
    return renderGitHubOAuthPage({
      title: "Google sign-in expired",
      body: "The authorization session expired or did not match this app session. Start the Google connection again from Integrations.",
      returnUrl: "/?view=integrations",
      returnLabel: RETURN_LABEL,
      status: 400,
    });
  }
  // Desktop flows return through the registered scheme (the relative returnUrl
  // is useless in the external browser). Derived ONLY from the verified state.
  const deepLinkFor = (status: "connected" | "error") => {
    if (!verifiedState.returnMode) return undefined;
    // Park the outcome so the desktop app routes back when it regains focus —
    // installed shells drop unknown deep-link URLs and only foreground.
    parkOAuthReturn({ provider: "google", view: "integrations", status });
    return integrationsOAuthDeepLink(verifiedState.returnMode, { provider: "google", view: "integrations", status }) || undefined;
  };

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
      }),
      cache: "no-store",
    });
    const payload = await tokenResponse.json().catch(() => null) as GoogleTokenResponse | null;
    if (!tokenResponse.ok || payload?.error || !payload?.access_token) {
      throw new Error(payload?.error_description || payload?.error || `Google returned HTTP ${tokenResponse.status}.`);
    }
    if (!payload.refresh_token) {
      throw new Error("Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions, then connect again.");
    }

    await saveGoogleRefreshToken(payload.refresh_token);
    return renderGitHubOAuthPage({
      title: "Google connected",
      body: "Saved Google access to the shared hive env. Drive, editable Slides, Gmail, and Calendar context is now available to your hive on every machine.",
      returnUrl: RETURN_URL,
      returnLabel: RETURN_LABEL,
      deepLink: deepLinkFor("connected"),
    });
  } catch (error) {
    return renderGitHubOAuthPage({
      title: "Google sign-in failed",
      body: error instanceof Error ? error.message : "Could not finish Google sign-in.",
      returnUrl: "/?view=integrations",
      returnLabel: RETURN_LABEL,
      status: 502,
      deepLink: deepLinkFor("error"),
    });
  }
}
