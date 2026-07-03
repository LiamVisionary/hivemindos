import type { NextRequest } from "next/server";
import { localCallbackOrigin } from "@/lib/services/integrations/github-oauth";
import {
  GOOGLE_CLIENT_ID_ENV,
  GOOGLE_CLIENT_SECRET_ENV,
  GOOGLE_REFRESH_TOKEN_ENV,
} from "@/lib/services/integrations/provider-connections";
import { readSharedAgentEnv, saveSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";

const DEFAULT_GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
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
