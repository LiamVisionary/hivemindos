// guard:allow-hive-action-route - dashboard-only Google Cloud OAuth connect
// flow; launches the user's interactive browser sign-in and is intentionally
// NOT an agent-invokable Hive action (agents must never initiate credential
// grants).
import { NextRequest, NextResponse } from "next/server";

import { renderGitHubOAuthPage } from "@/lib/services/integrations/github-oauth";
import { googleCloudAuthorizeUrl } from "@/lib/services/integrations/google-cloud-oauth";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google Cloud OAuth sign-in starter (DESKTOP-app model, PERSISTENT callback).
 * The redirect lands on this app's own always-running callback route
 * (/api/integrations/google-cloud/oauth/callback) — NOT a transient loopback
 * listener — and the PKCE verifier rides along in a signed `state`, so the flow
 * survives dev-server recompiles/restarts. The client is baked into HivemindOS,
 * so there is no pasted-client / key-entry step.
 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const { authorizeUrl, missing } = googleCloudAuthorizeUrl(request);
  if (missing.length) return renderGoogleCloudMissingClientPage();

  return NextResponse.redirect(authorizeUrl);
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const { authorizeUrl, missing } = googleCloudAuthorizeUrl(request);
  if (missing.length) {
    return errorJson(
      "The Google Cloud OAuth client is not configured yet. Set GOOGLE_CLOUD_OAUTH_CLIENT_ID (a Google \"Desktop app\" client) or bake one into HivemindOS.",
      503,
      { clientReady: false },
    );
  }

  return okJson({ authorizationUrl: authorizeUrl });
}

function renderGoogleCloudMissingClientPage() {
  return renderGitHubOAuthPage({
    title: "Google Cloud sign-in isn't configured yet",
    body:
      "This build of HivemindOS doesn't ship a Google Cloud OAuth client. Set the <code>GOOGLE_CLOUD_OAUTH_CLIENT_ID</code> env var to a Google <strong>Desktop app</strong> OAuth client, then retry.",
    returnUrl: "/?view=integrations",
    returnLabel: "Back to integrations",
    status: 503,
  });
}
