import { NextRequest } from "next/server";
import {
  GITHUB_OAUTH_SOURCE_COOKIE,
  GITHUB_OAUTH_STATE_COOKIE,
  githubOAuthReturnUrl,
  normalizeGitHubOAuthSource,
  readGitHubOAuthConfig,
  renderGitHubOAuthPage,
  saveGitHubTokenForAeon,
  verifyGitHubOAuthState,
} from "@/lib/services/integrations/github-oauth";

export const runtime = "nodejs";

type GitHubTokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

export async function GET(request: NextRequest) {
  const initialSource = normalizeGitHubOAuthSource(request.cookies.get(GITHUB_OAUTH_SOURCE_COOKIE)?.value ?? null);
  let returnUrl = githubOAuthReturnUrl(initialSource);
  const clearCookies = (response: ReturnType<typeof renderGitHubOAuthPage>) => {
    response.cookies.delete(GITHUB_OAUTH_STATE_COOKIE);
    response.cookies.delete(GITHUB_OAUTH_SOURCE_COOKIE);
    return response;
  };

  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    return clearCookies(renderGitHubOAuthPage({
      title: "GitHub authorization cancelled",
      body: request.nextUrl.searchParams.get("error_description") || oauthError,
      returnUrl,
      status: 400,
    }));
  }

  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const config = await readGitHubOAuthConfig(request);
  if (config.missing.length) {
    return clearCookies(renderGitHubOAuthPage({
      title: "GitHub OAuth needs setup",
      body: `Add <code>${config.missing.join("</code> and <code>")}</code> to shared env or the dashboard process env, then retry.`,
      returnUrl,
      status: 503,
    }));
  }

  const verifiedState = verifyGitHubOAuthState(state, config.clientSecret);
  if (!verifiedState || !code) {
    return clearCookies(renderGitHubOAuthPage({
      title: "GitHub OAuth state mismatch",
      body: "The authorization session expired or did not match this browser session. Start the GitHub connection again from AEON.",
      returnUrl,
      status: 400,
    }));
  }
  returnUrl = githubOAuthReturnUrl(verifiedState.source);

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
        state,
      }),
      cache: "no-store",
    });
    const payload = await tokenResponse.json().catch(() => null) as GitHubTokenResponse | null;
    if (!tokenResponse.ok || payload?.error || !payload?.access_token) {
      throw new Error(payload?.error_description || payload?.error || `GitHub returned HTTP ${tokenResponse.status}.`);
    }

    await saveGitHubTokenForAeon(payload.access_token);
    return clearCookies(renderGitHubOAuthPage({
      title: "GitHub connected",
      body: "Saved GitHub OAuth access as <code>GH_GLOBAL</code> through hive-env-add. Your hive can now use GitHub on every machine.",
      returnUrl,
      returnLabel: verifiedState.source === "aeon" ? "Back to AEON overview" : "Back to integrations",
    }));
  } catch (error) {
    return clearCookies(renderGitHubOAuthPage({
      title: "GitHub OAuth failed",
      body: error instanceof Error ? error.message : "Could not finish GitHub OAuth.",
      returnUrl,
      status: 502,
    }));
  }
}
