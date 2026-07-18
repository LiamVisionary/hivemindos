import { NextRequest } from "next/server";
import {
  LINKEDIN_OAUTH_SOURCE_COOKIE,
  LINKEDIN_OAUTH_STATE_COOKIE,
  LINKEDIN_TOKEN_URL,
  linkedInOAuthReturnUrl,
  readLinkedInOAuthConfig,
  renderLinkedInOAuthPage,
  saveLinkedInTokens,
  verifyLinkedInOAuthState,
} from "@/lib/services/integrations/linkedin-oauth";

export const runtime = "nodejs";

type LinkedInTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

export async function GET(request: NextRequest) {
  const returnUrl = linkedInOAuthReturnUrl();
  const clearCookies = (response: ReturnType<typeof renderLinkedInOAuthPage>) => {
    response.cookies.delete(LINKEDIN_OAUTH_STATE_COOKIE);
    response.cookies.delete(LINKEDIN_OAUTH_SOURCE_COOKIE);
    return response;
  };

  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    return clearCookies(renderLinkedInOAuthPage({
      title: "LinkedIn authorization cancelled",
      body: request.nextUrl.searchParams.get("error_description") || oauthError,
      returnUrl,
      status: 400,
    }));
  }

  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const config = await readLinkedInOAuthConfig(request);
  if (config.missing.length) {
    return clearCookies(renderLinkedInOAuthPage({
      title: "LinkedIn OAuth needs setup",
      body: `Add <code>${config.missing.join("</code> and <code>")}</code> to shared env or the dashboard process env, then retry.`,
      returnUrl,
      status: 503,
    }));
  }

  const verifiedState = verifyLinkedInOAuthState(state, config.clientSecret);
  if (!verifiedState || !code) {
    return clearCookies(renderLinkedInOAuthPage({
      title: "LinkedIn OAuth state mismatch",
      body: "The authorization session expired or did not match this browser session. Start the LinkedIn connection again from Integrations.",
      returnUrl,
      status: 400,
    }));
  }

  try {
    // LinkedIn's token endpoint only accepts application/x-www-form-urlencoded.
    const tokenResponse = await fetch(LINKEDIN_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      cache: "no-store",
    });
    const payload = await tokenResponse.json().catch(() => null) as LinkedInTokenResponse | null;
    if (!tokenResponse.ok || payload?.error || !payload?.access_token) {
      throw new Error(payload?.error_description || payload?.error || `LinkedIn returned HTTP ${tokenResponse.status}.`);
    }

    await saveLinkedInTokens(payload.access_token, payload.refresh_token);
    return clearCookies(renderLinkedInOAuthPage({
      title: "LinkedIn connected",
      body: "Saved LinkedIn OAuth access as <code>LINKEDIN_ACCESS_TOKEN</code> through hive-env-add. Your hive can now post to LinkedIn on every machine.",
      returnUrl,
    }));
  } catch (error) {
    return clearCookies(renderLinkedInOAuthPage({
      title: "LinkedIn OAuth failed",
      body: error instanceof Error ? error.message : "Could not finish LinkedIn OAuth.",
      returnUrl,
      status: 502,
    }));
  }
}
