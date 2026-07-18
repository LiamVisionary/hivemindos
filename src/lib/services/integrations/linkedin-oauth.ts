import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { readSharedAgentEnv, saveSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";
// The branded OAuth return page and local-callback origin helper are generic
// (title/body/returnUrl inputs) — reuse them instead of cloning the HTML.
import { localCallbackOrigin, renderGitHubOAuthPage } from "@/lib/services/integrations/github-oauth";

export const LINKEDIN_OAUTH_STATE_COOKIE = "hive_linkedin_oauth_state";
export const LINKEDIN_OAUTH_SOURCE_COOKIE = "hive_linkedin_oauth_source";

export const LINKEDIN_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
export const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

// w_member_social = posting; openid/profile/email power the identity check the
// Connections card shows after sign-in.
const DEFAULT_LINKEDIN_OAUTH_SCOPES = ["openid", "profile", "email", "w_member_social"];

export type LinkedInOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  missing: string[];
};

export async function readLinkedInOAuthConfig(request: NextRequest): Promise<LinkedInOAuthConfig> {
  const sharedEnv = await readSharedAgentEnv();
  const clientId = sanitizeLinkedInCredential(sharedEnvValue("LINKEDIN_OAUTH_CLIENT_ID", sharedEnv));
  const clientSecret = sanitizeLinkedInCredential(sharedEnvValue("LINKEDIN_OAUTH_CLIENT_SECRET", sharedEnv));
  const redirectUri = sharedEnvValue("LINKEDIN_OAUTH_CALLBACK_URL", sharedEnv)
    || new URL("/api/integrations/linkedin/oauth/callback", localCallbackOrigin(request)).toString();
  const scopes = normalizeScopes(sharedEnvValue("LINKEDIN_OAUTH_SCOPES", sharedEnv));
  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    missing: [
      clientId ? "" : "LINKEDIN_OAUTH_CLIENT_ID",
      clientSecret ? "" : "LINKEDIN_OAUTH_CLIENT_SECRET",
    ].filter(Boolean),
  };
}

export function createLinkedInOAuthState(clientSecret: string) {
  const payload = Buffer.from(JSON.stringify({
    nonce: randomBytes(16).toString("base64url"),
    source: "integrations",
    exp: Date.now() + 10 * 60 * 1000,
  })).toString("base64url");
  const signature = signLinkedInOAuthState(payload, clientSecret);
  return `${payload}.${signature}`;
}

export function verifyLinkedInOAuthState(state: string, clientSecret: string) {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  const expected = signLinkedInOAuthState(payload, clientSecret);
  const signatureBuffer = new Uint8Array(Buffer.from(signature));
  const expectedBuffer = new Uint8Array(Buffer.from(expected));
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return { source: "integrations" as const };
  } catch {
    return null;
  }
}

export function linkedInOAuthReturnUrl() {
  return "/?view=integrations&connections=linkedin";
}

export async function saveLinkedInTokens(accessToken: string, refreshToken?: string) {
  await saveSharedAgentEnv("LINKEDIN_ACCESS_TOKEN", accessToken);
  if (refreshToken) await saveSharedAgentEnv("LINKEDIN_REFRESH_TOKEN", refreshToken);
}

export function renderLinkedInOAuthPage(input: {
  title: string;
  body: string;
  returnUrl?: string;
  returnLabel?: string;
  status?: number;
}) {
  return renderGitHubOAuthPage({
    ...input,
    returnUrl: input.returnUrl ?? linkedInOAuthReturnUrl(),
    returnLabel: input.returnLabel ?? "Back to integrations",
  });
}

// LinkedIn client secrets contain dots and underscores (e.g. WPL_AP1.…), so —
// unlike the GitHub alnum-only sanitizer — only whitespace is stripped here.
function sanitizeLinkedInCredential(value: string) {
  return value.replace(/\s/g, "");
}

function signLinkedInOAuthState(payload: string, clientSecret: string) {
  return createHmac("sha256", clientSecret).update(payload).digest("base64url");
}

function normalizeScopes(rawScopes?: string) {
  const scopes = (rawScopes?.trim() ? rawScopes.split(/\s+/) : DEFAULT_LINKEDIN_OAUTH_SCOPES)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return [...new Set(scopes)];
}
