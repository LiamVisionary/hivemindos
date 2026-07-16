import type { ConnectionProviderKey, ConnectionProviderStatus, ConnectionsPayload } from "@/lib/types/integrations";
import { readSharedAgentEnv, removeSharedAgentEnv, saveSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";
import { clawbankMe } from "@/lib/services/clawbank";
import { monidBalance, monidBalanceLabel } from "@/lib/services/integrations/monid";
import {
  CONNECTOR_MANIFESTS,
  type ConnectorManifest,
} from "@/lib/services/integrations/connector-manifests";
import {
  GOOGLE_CLOUD_MANAGE_SCOPE,
  googleCloudGrantedScopes,
  googleCloudOAuthClientReady,
  mintGoogleCloudAccessToken,
} from "@/lib/services/integrations/google-cloud-oauth";
import { slackOAuthClientReady } from "@/lib/services/integrations/slack-oauth";
import { azureOAuthClientReady, mintAzureAccessToken } from "@/lib/services/integrations/azure-oauth";
import {
  AZURE_ACCOUNT_EMAIL_ENV,
  AZURE_TENANT_ID_ENV,
  GOOGLE_CLIENT_ID_ENV,
  GOOGLE_CLIENT_SECRET_ENV,
  GOOGLE_CLOUD_ACCOUNT_EMAIL_ENV,
  GOOGLE_CLOUD_CLIENT_ID_ENV,
  GOOGLE_CLOUD_CLIENT_SECRET_ENV,
  GOOGLE_CLOUD_REFRESH_TOKEN_ENV,
  GOOGLE_REFRESH_TOKEN_ENV,
} from "@/lib/services/integrations/provider-connection-env";
import { normalizeProviderSetupFields, providerSetupFieldEnv } from "@/lib/services/integrations/provider-setup-fields";

export {
  GOOGLE_CLIENT_ID_ENV,
  GOOGLE_CLIENT_SECRET_ENV,
  GOOGLE_REFRESH_TOKEN_ENV,
  GOOGLE_CLOUD_CLIENT_ID_ENV,
  GOOGLE_CLOUD_CLIENT_SECRET_ENV,
  GOOGLE_CLOUD_REFRESH_TOKEN_ENV,
  GOOGLE_CLOUD_ACCOUNT_EMAIL_ENV,
} from "@/lib/services/integrations/provider-connection-env";

type VerifyResult = { ok: boolean; account?: string; error?: string };

type ProviderSpec = ConnectorManifest & {
  verify: (token: string, sharedEnv: Record<string, string>) => Promise<VerifyResult>;
};

const VERIFY_TIMEOUT_MS = 6_000;
const USER_AGENT = "hivemindos-connections";

const VERIFY_BY_PROVIDER: Record<ConnectionProviderKey, ProviderSpec["verify"]> = {
  github: verifyGitHub,
  linear: verifyLinear,
  slack: verifySlack,
  notion: verifyNotion,
  google: verifyGoogle,
  "google-cloud": verifyGoogleCloud,
  azure: verifyAzure,
  posthog: verifyPostHog,
  plausible: verifyPlausible,
  calcom: verifyCalcom,
  shopify: verifyShopify,
  medusa: verifyMedusa,
  monid: verifyMonid,
  clawbank: verifyClawBank,
};

const PROVIDERS: ProviderSpec[] = CONNECTOR_MANIFESTS.map((manifest) => ({
  ...manifest,
  verify: VERIFY_BY_PROVIDER[manifest.key],
}));

export function connectionProvider(key: string) {
  return PROVIDERS.find((provider) => provider.key === key);
}

export async function readConnectionsPayload(): Promise<ConnectionsPayload> {
  const sharedEnv = await readSharedAgentEnv();
  const providers = await Promise.all(PROVIDERS.map((provider) => providerStatus(provider, sharedEnv)));
  return { ok: true, providers };
}

export async function saveProviderToken(providerKey: string, token: string, rawFields?: unknown): Promise<{ account?: string }> {
  const provider = connectionProvider(providerKey);
  if (!provider) throw new Error(`Unknown provider: ${providerKey}`);
  if (provider.key === "google") throw new Error("Google connects through sign-in, not a pasted token.");
  if (provider.key === "google-cloud") throw new Error("Google Cloud connects through sign-in, not a pasted token.");
  if (provider.key === "azure") throw new Error("Microsoft Azure connects through sign-in, not a pasted token.");
  const clean = token.trim();
  if (clean.length < 8 || /\s/.test(clean)) throw new Error("That does not look like a valid token.");
  const sharedEnv = await readSharedAgentEnv();
  const fields = normalizeProviderSetupFields(provider.key, rawFields);
  const fieldEnv = providerSetupFieldEnv(provider.key, fields);
  const result = await provider.verify(clean, { ...sharedEnv, ...fieldEnv });
  if (!result.ok) throw new Error(result.error || `${provider.label} rejected the token.`);
  for (const [key, value] of Object.entries(fieldEnv)) await saveSharedAgentEnv(key, value);
  await saveSharedAgentEnv(provider.auth.tokenEnvKey, clean);
  return { account: result.account };
}

export async function disconnectProvider(providerKey: string) {
  const provider = connectionProvider(providerKey);
  if (!provider) throw new Error(`Unknown provider: ${providerKey}`);
  const sharedEnv = await readSharedAgentEnv();
  // Remove the canonical key plus any legacy alias that is actually set —
  // otherwise a provider with an old-name credential stays "connected".
  const keys = [provider.auth.tokenEnvKey, ...(provider.auth.tokenEnvAliases ?? []).filter((alias) => sharedEnvValue(alias, sharedEnv))];
  keys.push(...(provider.auth.setupFields ?? []).map((field) => field.envKey));
  if (provider.key === "azure") keys.push(AZURE_ACCOUNT_EMAIL_ENV, AZURE_TENANT_ID_ENV);
  for (const key of keys) await removeSharedAgentEnv(key);
}

export async function saveGoogleOAuthClient(clientId: string, clientSecret: string) {
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (!id || !secret) throw new Error("Both the client ID and client secret are required.");
  if (/\s/.test(id) || /\s/.test(secret)) throw new Error("Client credentials cannot contain spaces.");
  await saveSharedAgentEnv(GOOGLE_CLIENT_ID_ENV, id);
  await saveSharedAgentEnv(GOOGLE_CLIENT_SECRET_ENV, secret);
}

export async function saveGoogleCloudOAuthClient(clientId: string, clientSecret: string) {
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (!id || !secret) throw new Error("Both the client ID and client secret are required.");
  if (/\s/.test(id) || /\s/.test(secret)) throw new Error("Client credentials cannot contain spaces.");
  await saveSharedAgentEnv(GOOGLE_CLOUD_CLIENT_ID_ENV, id);
  await saveSharedAgentEnv(GOOGLE_CLOUD_CLIENT_SECRET_ENV, secret);
}

async function providerStatus(provider: ProviderSpec, sharedEnv: Record<string, string>): Promise<ConnectionProviderStatus> {
  const token = [provider.auth.tokenEnvKey, ...(provider.auth.tokenEnvAliases ?? [])]
    .map((key) => sharedEnvValue(key, sharedEnv))
    .find(Boolean) ?? "";
  const base: ConnectionProviderStatus = {
    key: provider.key,
    label: provider.label,
    detail: provider.detail,
    connected: Boolean(token),
    verified: false,
    tokenHint: provider.auth.tokenHint,
    tokenPlaceholder: provider.auth.tokenPlaceholder,
    authMode: provider.auth.mode,
    credentialKeys: [
      provider.auth.tokenEnvKey,
      ...(provider.auth.tokenEnvAliases ?? []),
      ...(provider.auth.oauthClientEnvKeys ?? []),
    ],
    operations: provider.operations.map((operation) => operation.id),
    setupFields: provider.auth.setupFields?.map(({ id, label, placeholder, hint, required }) => ({ id, label, placeholder, hint, required })),
    oauthReady: providerOAuthReady(provider.key, sharedEnv),
    checkedAt: new Date().toISOString(),
  };
  if (!token) return base;
  const result = await provider.verify(token, sharedEnv);
  return {
    ...base,
    verified: result.ok,
    account: result.account,
    error: result.ok ? undefined : result.error,
  };
}

function providerOAuthReady(key: ConnectionProviderKey, sharedEnv: Record<string, string>) {
  if (key === "github") {
    return Boolean(
      (sharedEnvValue("GITHUB_OAUTH_CLIENT_ID", sharedEnv) || sharedEnvValue("GH_OAUTH_CLIENT_ID", sharedEnv)) &&
      (sharedEnvValue("GITHUB_OAUTH_CLIENT_SECRET", sharedEnv) || sharedEnvValue("GH_OAUTH_CLIENT_SECRET", sharedEnv)),
    );
  }
  if (key === "google") {
    return Boolean(sharedEnvValue(GOOGLE_CLIENT_ID_ENV, sharedEnv) && sharedEnvValue(GOOGLE_CLIENT_SECRET_ENV, sharedEnv));
  }
  if (key === "google-cloud") {
    // Desktop-app model: the OAuth client is baked into HivemindOS (or supplied
    // via the GOOGLE_CLOUD_OAUTH_CLIENT_ID env var), so google-cloud is always
    // OAuth-ready once the client id is non-placeholder — no pasted client.
    return googleCloudOAuthClientReady();
  }
  if (key === "slack") {
    // PKCE public-client model: the Slack client id is baked into HivemindOS (or
    // supplied via SLACK_OAUTH_CLIENT_ID), so slack is OAuth-ready once the id is
    // non-placeholder — no pasted client, no client secret.
    return slackOAuthClientReady();
  }
  if (key === "azure") return azureOAuthClientReady();
  return false;
}

async function verifyGitHub(token: string): Promise<VerifyResult> {
  return apiCheck(async () => {
    const response = await fetch("https://api.github.com/user", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: `GitHub rejected the token (HTTP ${response.status}).` };
    const user = await response.json() as { login?: string };
    return { ok: true, account: user.login };
  });
}

async function verifyLinear(token: string): Promise<VerifyResult> {
  return apiCheck(async () => {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ query: "{ viewer { name displayName email } }" }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: `Linear rejected the key (HTTP ${response.status}).` };
    const payload = await response.json() as { data?: { viewer?: { name?: string; displayName?: string; email?: string } }; errors?: Array<{ message?: string }> };
    const viewer = payload.data?.viewer;
    if (!viewer) return { ok: false, error: payload.errors?.[0]?.message || "Linear rejected the key." };
    return { ok: true, account: viewer.displayName || viewer.name || viewer.email };
  });
}

async function verifySlack(token: string): Promise<VerifyResult> {
  return apiCheck(async () => {
    const response = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    const payload = await response.json() as { ok?: boolean; user?: string; team?: string; error?: string };
    if (!payload.ok) return { ok: false, error: `Slack rejected the token${payload.error ? ` (${payload.error})` : ""}.` };
    return { ok: true, account: [payload.user, payload.team].filter(Boolean).join(" @ ") };
  });
}

async function verifyNotion(token: string): Promise<VerifyResult> {
  return apiCheck(async () => {
    const response = await fetch("https://api.notion.com/v1/users/me", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: `Notion rejected the token (HTTP ${response.status}).` };
    const payload = await response.json() as { name?: string; bot?: { workspace_name?: string } };
    return { ok: true, account: payload.bot?.workspace_name || payload.name };
  });
}

async function verifyGoogle(refreshToken: string, sharedEnv: Record<string, string>): Promise<VerifyResult> {
  const clientId = sharedEnvValue(GOOGLE_CLIENT_ID_ENV, sharedEnv);
  const clientSecret = sharedEnvValue(GOOGLE_CLIENT_SECRET_ENV, sharedEnv);
  if (!clientId || !clientSecret) return { ok: false, error: "The Google OAuth client is missing, so the saved account cannot be refreshed." };
  return apiCheck(async () => {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null) as { access_token?: string; error?: string; error_description?: string } | null;
    if (!response.ok || !payload?.access_token) {
      return { ok: false, error: payload?.error_description || payload?.error || `Google rejected the saved account (HTTP ${response.status}).` };
    }
    const account = await googleAccountEmail(payload.access_token);
    return { ok: true, account: account || "Google account" };
  });
}

async function googleAccountEmail(accessToken: string) {
  try {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return "";
    const payload = await response.json() as { email?: string };
    return payload.email ?? "";
  } catch {
    return "";
  }
}

// Google Cloud uses the DESKTOP-app model: the OAuth client is baked into
// HivemindOS (or supplied via GOOGLE_CLOUD_OAUTH_CLIENT_ID), and its refresh
// tokens are PKCE-issued (client secret optional). So verification mints an
// access token through the canonical minter — the same baked-in client +
// optional-secret path the rest of the connector uses — rather than a pasted
// client id/secret from the shared env.
async function verifyGoogleCloud(_refreshToken: string): Promise<VerifyResult> {
  if (!googleCloudOAuthClientReady()) {
    return { ok: false, error: "The Google Cloud OAuth client is not configured, so the saved account cannot be refreshed." };
  }
  return apiCheck(async () => {
    const accessToken = await mintGoogleCloudAccessToken();
    // Granular consent: if the user unticked the Cloud Platform box on the
    // consent screen, Google still issues a token (openid/email only), so the
    // refresh above succeeds — but every budget/quota-cap call would 403 later.
    // Catch it here so the card shows an actionable "reconnect and tick the box"
    // error instead of a silent half-connection. Fails OPEN (see helper).
    const scopes = await googleCloudGrantedScopes(accessToken);
    if (scopes && !scopes.split(/\s+/).includes(GOOGLE_CLOUD_MANAGE_SCOPE)) {
      return {
        ok: false,
        error:
          'Signed in, but Google Cloud management access wasn’t granted. Reconnect and tick the box for "See, edit, configure, and delete your Google Cloud data" so HivemindOS can set your budgets and caps.',
      };
    }
    const account = await googleAccountEmail(accessToken);
    return { ok: true, account: account || "Google Cloud account" };
  });
}

async function verifyAzure(refreshToken: string, sharedEnv: Record<string, string>): Promise<VerifyResult> {
  if (!azureOAuthClientReady()) {
    return { ok: false, error: "The HivemindOS Azure OAuth client is not configured." };
  }
  return apiCheck(async () => {
    const accessToken = await mintAzureAccessToken(refreshToken);
    const response = await fetch("https://management.azure.com/subscriptions?api-version=2022-12-01", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false, error: `Azure Resource Manager rejected the saved account (HTTP ${response.status}).` };
    }
    const account = sharedEnvValue(AZURE_ACCOUNT_EMAIL_ENV, sharedEnv) || "Microsoft account";
    return { ok: true, account };
  });
}

// PostHog personal API keys are region-bound (US vs EU cloud). We can't run a real
// HogQL query at connect time (the project id is per-company, not part of this shared
// key), so identity is verified via /api/users/@me/. Confirmed live (2026-07-04): an
// invalid key returns HTTP 401 `authentication_failed` on both clouds; a genuine key
// returns 200 (identity) or 403 when it's scoped without user:read. Try US then EU
// before declaring the key bad.
const POSTHOG_VERIFY_HOSTS = ["https://us.posthog.com", "https://eu.posthog.com"];

async function verifyPostHog(token: string): Promise<VerifyResult> {
  return apiCheck(async () => {
    const lastError = "PostHog rejected the key (HTTP 401).";
    for (const host of POSTHOG_VERIFY_HOSTS) {
      const response = await fetch(`${host}/api/users/@me/`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      // 401 = wrong cloud or bad key — try the other region before giving up.
      if (response.status === 401) continue;
      // 403 = authenticated but the key lacks user:read — still a genuine key.
      if (response.status === 403) return { ok: true };
      if (!response.ok) return { ok: false, error: `PostHog rejected the key (HTTP ${response.status}).` };
      const user = (await response.json().catch(() => null)) as { email?: string; first_name?: string } | null;
      return { ok: true, account: user?.email || user?.first_name };
    }
    return { ok: false, error: lastError };
  });
}

// Plausible's Stats API can't validate a key without a site_id (which is per-company
// here), and it conflates "bad key" with "no access to this site" — both return 401
// when a site_id is present (confirmed live 2026-07-04). So the only honest connect-time
// check is reachability: hit the Stats API WITHOUT a site_id and confirm we reached
// Plausible. A present bearer there returns 400 "Missing site ID"; a missing/empty one
// returns 401 "Missing API key". The key's real per-site validity is proven when a
// company's Analytics tab runs a query. (This means "verified" for Plausible attests
// connectivity, not that the specific key is live — the copy above says so.)
async function verifyPlausible(token: string, sharedEnv: Record<string, string>): Promise<VerifyResult> {
  return apiCheck(async () => {
    const baseUrl = sharedEnvValue("PLAUSIBLE_BASE_URL", sharedEnv) || "https://plausible.io";
    const response = await fetch(`${baseUrl}/api/v1/stats/aggregate?metrics=visitors`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (response.status === 401) return { ok: false, error: payload?.error || "Plausible rejected the request." };
    if (response.status >= 500) return { ok: false, error: `Plausible is unavailable (HTTP ${response.status}).` };
    return { ok: true };
  });
}

async function verifyCalcom(token: string, sharedEnv: Record<string, string>): Promise<VerifyResult> {
  return apiCheck(async () => {
    const baseUrl = (sharedEnvValue("CALCOM_API_BASE_URL", sharedEnv) || "https://api.cal.com/v2").replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/me`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: `Cal.com rejected the API key (HTTP ${response.status}).` };
    const payload = await response.json().catch(() => null) as { data?: { username?: string; email?: string; name?: string } } | null;
    const account = payload?.data?.username || payload?.data?.email || payload?.data?.name;
    return { ok: true, account };
  });
}

async function verifyShopify(token: string, sharedEnv: Record<string, string>): Promise<VerifyResult> {
  return apiCheck(async () => {
    const shopDomain = sharedEnvValue("SHOPIFY_STORE_DOMAIN", sharedEnv);
    if (!shopDomain) return { ok: false, error: "Shopify store domain is required." };
    const response = await fetch(`https://${shopDomain}/admin/api/2026-07/graphql.json`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ query: "{ shop { name myshopifyDomain } }" }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null) as { data?: { shop?: { name?: string; myshopifyDomain?: string } }; errors?: Array<{ message?: string }> } | null;
    if (!response.ok || !payload?.data?.shop) {
      return { ok: false, error: payload?.errors?.[0]?.message || `Shopify rejected the connection (HTTP ${response.status}).` };
    }
    return { ok: true, account: payload.data.shop.name || payload.data.shop.myshopifyDomain };
  });
}

async function verifyMedusa(token: string, sharedEnv: Record<string, string>): Promise<VerifyResult> {
  return apiCheck(async () => {
    const baseUrl = (sharedEnvValue("MEDUSA_API_BASE_URL", sharedEnv) || "http://127.0.0.1:9000").replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/store/regions?limit=1`, {
      cache: "no-store",
      headers: {
        "x-publishable-api-key": token,
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null) as { regions?: Array<{ name?: string }>; message?: string } | null;
    if (!response.ok) return { ok: false, error: payload?.message || `Medusa rejected the connection (HTTP ${response.status}).` };
    return { ok: true, account: payload?.regions?.[0]?.name || new URL(baseUrl).host };
  });
}

async function verifyMonid(token: string): Promise<VerifyResult> {
  return apiCheck(async () => {
    const balance = await monidBalance(token);
    return { ok: true, account: monidBalanceLabel(balance.data) };
  });
}

// ClawBank verification reuses the canonical service client (normalized
// envelope + error mapping) instead of a hand-rolled fetch. `clawbankMe(token)`
// checks the supplied token against live GET /api/v1/me.
async function verifyClawBank(token: string): Promise<VerifyResult> {
  return apiCheck(async () => {
    const me = await clawbankMe(token);
    if (!me.ok) return { ok: false, error: me.error || `ClawBank rejected the token (HTTP ${me.status}).` };
    const wallet = me.data?.wallet?.address;
    return { ok: true, account: me.data?.email || (wallet ? `wallet ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : undefined) };
  });
}

async function apiCheck(run: () => Promise<VerifyResult>): Promise<VerifyResult> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/abort|timeout/i.test(message)) return { ok: false, error: "The provider did not answer in time. Check the network and try again." };
    return { ok: false, error: message };
  }
}
