import { NextRequest } from "next/server";

import { renderGitHubOAuthPage } from "@/lib/services/integrations/github-oauth";
import { exchangeGoogleCloudCode } from "@/lib/services/integrations/google-cloud-oauth";
import { parkOAuthReturn } from "@/lib/services/integrations/oauth-return-store";

export const runtime = "nodejs";

// This is the browser redirect target from Google's consent screen, NOT an
// authed dashboard call, so it is NOT gated by requireAuth — same as the
// Drive/Gmail Google callback route. The signed `state` (PKCE verifier + HMAC +
// 10-minute TTL) is what authenticates the flow.
//
// The consent flow opens in the user's DEFAULT BROWSER (not the Tauri webview),
// so this page renders in a tab that is NOT the HivemindOS app. A relative
// "/?view=integrations" link would just load the dashboard *in the browser* —
// wrong target. Instead we tell the user to close the tab (the app auto-detects
// the connection by polling), and offer a `hivemindos://` deep link that
// foregrounds the desktop app and navigates to Integrations.
const RETURN_URL = "hivemindos://integrations/google-cloud";
const RETURN_LABEL = "Return to HivemindOS";
const CLOSE_TAB_HINT =
  "You can close this tab and return to HivemindOS — it picks up the connection automatically.";

export async function GET(request: NextRequest) {
  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    return renderGitHubOAuthPage({
      title: "Google Cloud authorization cancelled",
      body: `${request.nextUrl.searchParams.get("error_description") || oauthError}<br><br>${CLOSE_TAB_HINT}`,
      returnUrl: RETURN_URL,
      returnLabel: RETURN_LABEL,
      status: 400,
    });
  }

  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";

  try {
    const { returnMode } = await exchangeGoogleCloudCode(code, state, request);
    // Park the outcome so the desktop app routes back to Integrations when it
    // regains focus (installed shells handle integrations/google-cloud, but
    // parking keeps the return working even when the deep link is declined).
    if (returnMode) parkOAuthReturn({ provider: "google-cloud", view: "integrations", status: "connected" });
    // Dev desktop builds register hivemindos-dev://, not hivemindos:// — the
    // signed state carries which one launched this flow.
    const returnUrl = returnMode === "desktop-dev" ? "hivemindos-dev://integrations/google-cloud" : RETURN_URL;
    return renderGitHubOAuthPage({
      title: "Google Cloud connected",
      body: `Saved Google Cloud access to the shared hive env. Your hive can now manage Google Cloud on every machine.<br><br>${CLOSE_TAB_HINT}`,
      returnUrl,
      returnLabel: RETURN_LABEL,
    });
  } catch (error) {
    return renderGitHubOAuthPage({
      title: "Google Cloud sign-in failed",
      body: `${error instanceof Error ? error.message : "Could not finish Google Cloud sign-in."}<br><br>${CLOSE_TAB_HINT}`,
      returnUrl: RETURN_URL,
      returnLabel: RETURN_LABEL,
      status: 502,
    });
  }
}
