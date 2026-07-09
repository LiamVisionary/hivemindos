import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

import { localCallbackOrigin } from "@/lib/services/integrations/github-oauth";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { writeSharedHiveEnvValues } from "@/lib/services/hive-env-write";
import {
  GOOGLE_CLOUD_ACCOUNT_EMAIL_ENV,
  GOOGLE_CLOUD_CLIENT_ID_ENV,
  GOOGLE_CLOUD_CLIENT_SECRET_ENV,
  GOOGLE_CLOUD_REFRESH_TOKEN_ENV,
} from "@/lib/services/integrations/provider-connection-env";

/**
 * Google Cloud OAuth for HivemindOS, built on the DESKTOP-app model (PKCE + a
 * baked-in client) but landing the redirect on a PERSISTENT Next route on the
 * app's own always-running server — NOT a transient in-process loopback
 * listener. The old listener bound 127.0.0.1:1465 for the duration of a single
 * flow and died to Next-dev recompilation mid-sign-in; this version has no
 * server-side session at all.
 *
 * The whole flow is stateless on the server: the PKCE code_verifier is carried
 * inside a self-signed `state` value (HMAC-SHA256, see createGoogleCloudState /
 * verifyGoogleCloudState), so the callback can complete even if the dev server
 * recompiled or restarted between the authorize redirect and Google's callback.
 * The redirect_uri points at this app's own callback route
 * (/api/integrations/google-cloud/oauth/callback) via localCallbackOrigin — the
 * same helper the Drive/Gmail Google connector (google-oauth.ts) uses.
 *
 * Tokens live in the SHARED HIVE ENV (~/.hivemindos/.env), NOT the brain vault:
 * env keys replicate to every machine automatically (hive-env-add tailnet sync
 * + collector pull-reconcile). Keys:
 *   GOOGLE_CLOUD_OAUTH_REFRESH_TOKEN / GOOGLE_CLOUD_OAUTH_ACCOUNT_EMAIL
 *
 * The baked-in client id below ships with HivemindOS. To wire a real Google
 * "Desktop app" client, replace GOOGLE_CLOUD_OAUTH_CLIENT_ID_DEFAULT (or set
 * the GOOGLE_CLOUD_OAUTH_CLIENT_ID env var, which overrides it). A client
 * secret is optional — set GOOGLE_CLOUD_OAUTH_CLIENT_SECRET only if the client
 * requires one; PKCE otherwise covers the exchange.
 */

/**
 * Baked-in Google Cloud "Desktop app" OAuth client id shipped with HivemindOS.
 * Overridable via the GOOGLE_CLOUD_OAUTH_CLIENT_ID env var. Replace this
 * placeholder with a real desktop client id to ship the connector connected
 * out of the box.
 */
// The sentinel that means "no client baked in yet" — compared against by
// googleCloudOAuthClientReady(). Keep this distinct from the default below so
// baking a real id into the default still reads as "ready".
const GOOGLE_CLOUD_OAUTH_CLIENT_ID_PLACEHOLDER = "REPLACE_WITH_HIVEMINDOS_GOOGLE_CLOUD_CLIENT_ID";
const GOOGLE_CLOUD_OAUTH_CLIENT_ID_DEFAULT = "259019272643-f8j74casb2etr012fr3bi8gcg5kibsia.apps.googleusercontent.com";

const OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_CALLBACK_PATH = "/api/integrations/google-cloud/oauth/callback";
const OAUTH_SCOPE = "openid email https://www.googleapis.com/auth/cloud-platform";
const LOGIN_FLOW_TTL_MS = 10 * 60_000;

// Last-resort fixed signing key so state HMAC never throws when neither the
// client secret nor the device token is set. It is NOT a secret — the state
// only carries a PKCE verifier (a public-ish OAuth nonce), and Google still
// enforces the code_verifier ↔ code_challenge binding on the exchange. Prefer
// the device token; this is only a floor to keep signing from crashing.
const STATE_SIGNING_KEY_FALLBACK = "hivemindos-google-cloud-oauth-state-v1";

/** The effective client id: env override wins, else the baked-in default. */
export function googleCloudOAuthClientId(): string {
  return (process.env[GOOGLE_CLOUD_CLIENT_ID_ENV]?.trim() || GOOGLE_CLOUD_OAUTH_CLIENT_ID_DEFAULT).trim();
}

/** Optional client secret (env only). Empty when the client uses pure PKCE. */
export function googleCloudOAuthClientSecret(): string {
  return process.env[GOOGLE_CLOUD_CLIENT_SECRET_ENV]?.trim() || "";
}

/**
 * True once a usable client id is baked in or supplied via env — i.e. the
 * default placeholder has been replaced or overridden. When false, the connect
 * flow can only render a "client not configured yet" message.
 */
export function googleCloudOAuthClientReady(): boolean {
  const clientId = googleCloudOAuthClientId();
  return Boolean(clientId) && clientId !== GOOGLE_CLOUD_OAUTH_CLIENT_ID_PLACEHOLDER;
}

function base64Url(buffer: Buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The server-side key that signs the state. Prefer the client secret when set
 * (some Desktop clients require one), else the stable server-side dashboard
 * device token, else a fixed non-empty app constant so createHmac never throws.
 */
function stateSigningKey(): string {
  return (
    googleCloudOAuthClientSecret()
    || process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN?.trim()
    || STATE_SIGNING_KEY_FALLBACK
  );
}

/**
 * Sign the PKCE verifier into a self-contained, tamper-evident state:
 *   payload = base64url(JSON.stringify({ v: code_verifier, n: nonce, t: Date.now() }))
 *   sig     = base64url(hmacSha256(payload, STATE_SIGNING_KEY))
 *   state   = `${payload}.${sig}`
 * No server-side session is kept, so the flow survives HMR / restarts.
 */
function createGoogleCloudState(codeVerifier: string): string {
  const payload = base64Url(
    Buffer.from(JSON.stringify({ v: codeVerifier, n: base64Url(randomBytes(16)), t: Date.now() })),
  );
  const sig = base64Url(createHmac("sha256", stateSigningKey()).update(payload).digest());
  return `${payload}.${sig}`;
}

/**
 * Recompute + timing-safe-compare the HMAC and enforce the 10-minute age bound.
 * Returns the extracted PKCE verifier, or null when the state is invalid,
 * tampered, malformed, or expired.
 */
function verifyGoogleCloudState(state: string): { verifier: string } | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = base64Url(createHmac("sha256", stateSigningKey()).update(payload).digest());
  const sigBuffer = new Uint8Array(Buffer.from(sig));
  const expectedBuffer = new Uint8Array(Buffer.from(expected));
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      v?: string;
      t?: number;
    };
    if (typeof parsed.v !== "string" || !parsed.v) return null;
    if (typeof parsed.t !== "number" || Date.now() - parsed.t > LOGIN_FLOW_TTL_MS) return null;
    return { verifier: parsed.v };
  } catch {
    return null;
  }
}

/** The app's own callback URL (this app's origin), rebuilt per request. */
function googleCloudRedirectUri(request: NextRequest): string {
  return new URL(OAUTH_CALLBACK_PATH, localCallbackOrigin(request)).toString();
}

export async function googleCloudOAuthConfigured(): Promise<boolean> {
  const refresh = await hiveEnvValue(GOOGLE_CLOUD_REFRESH_TOKEN_ENV).catch(() => "");
  return Boolean(refresh);
}

export async function googleCloudOAuthStatus() {
  const [refresh, accountEmail] = await Promise.all([
    hiveEnvValue(GOOGLE_CLOUD_REFRESH_TOKEN_ENV).catch(() => ""),
    hiveEnvValue(GOOGLE_CLOUD_ACCOUNT_EMAIL_ENV).catch(() => ""),
  ]);
  return {
    connected: Boolean(refresh),
    accountEmail: accountEmail || null,
    clientReady: googleCloudOAuthClientReady(),
  };
}

/**
 * Build the Google authorize URL for the persistent-callback flow. The PKCE
 * verifier is minted here and carried in the signed `state`, so there is no
 * server-side session to lose. Returns `missing` (non-empty) when the client
 * isn't configured, so callers can render the "not configured" page.
 */
export function googleCloudAuthorizeUrl(request: NextRequest): { authorizeUrl: string; missing: string[] } {
  if (!googleCloudOAuthClientReady()) {
    return { authorizeUrl: "", missing: [GOOGLE_CLOUD_CLIENT_ID_ENV] };
  }
  const clientId = googleCloudOAuthClientId();
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = createGoogleCloudState(verifier);

  const authorizeUrl = `${OAUTH_AUTHORIZE_URL}?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: googleCloudRedirectUri(request),
    scope: OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    // A refresh token is only returned with offline access + a forced consent.
    access_type: "offline",
    prompt: "consent",
  }).toString()}`;

  return { authorizeUrl, missing: [] };
}

async function exchangeToken(body: Record<string, string>) {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;
  if (!response.ok || !data?.access_token) {
    const detail = data?.error_description || data?.error;
    // Never surface the raw token endpoint body — only the sanitized reason.
    throw new Error(detail || `Google OAuth token endpoint returned HTTP ${response.status}.`);
  }
  return data;
}

/** Best-effort account email from a fresh access token (userinfo). */
async function googleCloudAccountEmail(accessToken: string): Promise<string> {
  try {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) return "";
    const payload = (await response.json()) as { email?: string };
    return payload.email ?? "";
  } catch {
    return "";
  }
}

async function persistTokens(data: { access_token: string; refresh_token?: string }) {
  if (!data.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions, then connect again.",
    );
  }
  const accountEmail = await googleCloudAccountEmail(data.access_token);
  // Values travel to hive-env-add over stdin (never logged). hive-env-add
  // deletes a key on an empty value, so only include the email when present.
  const values: Record<string, string> = { [GOOGLE_CLOUD_REFRESH_TOKEN_ENV]: data.refresh_token };
  if (accountEmail) values[GOOGLE_CLOUD_ACCOUNT_EMAIL_ENV] = accountEmail;
  await writeSharedHiveEnvValues(values);
}

/**
 * Complete the persistent-callback flow: verify the signed state, recover the
 * PKCE verifier, exchange the authorization code, and persist the refresh token
 * (+ account email) to the shared hive env. The redirect_uri passed to the
 * token endpoint MUST match the one used at authorize time — both are rebuilt
 * from localCallbackOrigin(request) so they stay identical.
 *
 * Throws a sanitized human-readable Error on any failure (never leaks a token).
 */
export async function exchangeGoogleCloudCode(
  code: string,
  state: string,
  request: NextRequest,
): Promise<void> {
  if (!googleCloudOAuthClientReady()) {
    throw new Error("The Google Cloud OAuth client is not configured.");
  }
  if (!code) throw new Error("The OAuth callback carried no authorization code.");
  const verified = verifyGoogleCloudState(state);
  if (!verified) {
    throw new Error("The sign-in session expired or did not match this app. Start the Google Cloud connection again.");
  }

  const clientSecret = googleCloudOAuthClientSecret();
  const tokens = await exchangeToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: googleCloudRedirectUri(request),
    client_id: googleCloudOAuthClientId(),
    code_verifier: verified.verifier,
    // Client secret is optional under PKCE; only send it when set.
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  });
  await persistTokens(tokens as { access_token: string; refresh_token?: string });
}

/**
 * Exchange the stored shared Google Cloud refresh token for a fresh access
 * token, using the baked-in (or env-overridden) Google Cloud OAuth client.
 * Request-free (reads the shared hive env directly) so server callers outside a
 * request can use it. Throws a human-readable Error when the account isn't
 * connected or Google refuses. The client_id is required; the client_secret is
 * only sent when set (PKCE-issued refresh tokens refresh without a secret).
 */
export async function mintGoogleCloudAccessToken(): Promise<string> {
  const clientId = googleCloudOAuthClientId();
  const clientSecret = googleCloudOAuthClientSecret();
  const refreshToken = await hiveEnvValue(GOOGLE_CLOUD_REFRESH_TOKEN_ENV);
  if (!googleCloudOAuthClientReady()) throw new Error("The Google Cloud OAuth client is not configured.");
  if (!refreshToken) throw new Error("No Google Cloud account is connected.");

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
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
