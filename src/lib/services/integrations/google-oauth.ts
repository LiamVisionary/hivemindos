import type { NextRequest } from "next/server";
import { localCallbackOrigin } from "@/lib/services/integrations/github-oauth";
import {
  GOOGLE_CLIENT_ID_ENV,
  GOOGLE_CLIENT_SECRET_ENV,
  GOOGLE_REFRESH_TOKEN_ENV,
} from "@/lib/services/integrations/provider-connections";
import { readSharedAgentEnv, saveSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";

const DEFAULT_GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  // GA4 (Admin API accountSummaries.list + Data API runReport) for the company
  // Analytics tab's Google Analytics 4 provider. Existing Google connections must
  // reconnect once to grant this scope.
  "https://www.googleapis.com/auth/analytics.readonly",
];

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  missing: string[];
};

export async function readGoogleOAuthConfig(request: NextRequest): Promise<GoogleOAuthConfig> {
  const sharedEnv = await readSharedAgentEnv();
  const clientId = sharedEnvValue(GOOGLE_CLIENT_ID_ENV, sharedEnv);
  const clientSecret = sharedEnvValue(GOOGLE_CLIENT_SECRET_ENV, sharedEnv);
  const redirectUri = sharedEnvValue("GOOGLE_OAUTH_CALLBACK_URL", sharedEnv)
    || new URL("/api/integrations/google/oauth/callback", localCallbackOrigin(request)).toString();
  const rawScopes = sharedEnvValue("GOOGLE_OAUTH_SCOPES", sharedEnv);
  const scopes = [...new Set((rawScopes ? rawScopes.split(/\s+/) : DEFAULT_GOOGLE_OAUTH_SCOPES).map((scope) => scope.trim()).filter(Boolean))];
  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    missing: [
      clientId ? "" : GOOGLE_CLIENT_ID_ENV,
      clientSecret ? "" : GOOGLE_CLIENT_SECRET_ENV,
    ].filter(Boolean),
  };
}

export async function saveGoogleRefreshToken(refreshToken: string) {
  await saveSharedAgentEnv(GOOGLE_REFRESH_TOKEN_ENV, refreshToken);
}

/**
 * Exchange the stored shared Google refresh token for a fresh access token, using
 * the shared OAuth client. Request-free (reads the shared hive env directly) so
 * server callers outside a request — e.g. the analytics GA4 adapter — can use it.
 * Throws a human-readable Error when the account isn't connected or Google refuses.
 */
export async function mintGoogleAccessToken(): Promise<string> {
  const clientId = await hiveEnvValue(GOOGLE_CLIENT_ID_ENV);
  const clientSecret = await hiveEnvValue(GOOGLE_CLIENT_SECRET_ENV);
  const refreshToken = await hiveEnvValue(GOOGLE_REFRESH_TOKEN_ENV);
  if (!clientId || !clientSecret) throw new Error("The shared Google OAuth client is not set up.");
  if (!refreshToken) throw new Error("No Google account is connected.");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; error_description?: string; error?: string }
    | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(
      payload?.error_description || payload?.error || `Google rejected the refresh (HTTP ${response.status}).`,
    );
  }
  return payload.access_token;
}
