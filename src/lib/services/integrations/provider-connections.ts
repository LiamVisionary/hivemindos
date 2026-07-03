import type { ConnectionProviderKey, ConnectionProviderStatus, ConnectionsPayload } from "@/lib/types/integrations";
import { readSharedAgentEnv, removeSharedAgentEnv, saveSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";

type VerifyResult = { ok: boolean; account?: string; error?: string };

type ProviderSpec = {
  key: ConnectionProviderKey;
  label: string;
  detail: string;
  /** Env key that holds the account credential; presence means "connected". */
  tokenEnvKey: string;
  /** Short instructions shown next to the token field. */
  tokenHint: string;
  tokenPlaceholder: string;
  verify: (token: string, sharedEnv: Record<string, string>) => Promise<VerifyResult>;
};

const VERIFY_TIMEOUT_MS = 6_000;
const USER_AGENT = "hivemindos-connections";

export const GOOGLE_CLIENT_ID_ENV = "GOOGLE_OAUTH_CLIENT_ID";
export const GOOGLE_CLIENT_SECRET_ENV = "GOOGLE_OAUTH_CLIENT_SECRET";
export const GOOGLE_REFRESH_TOKEN_ENV = "GOOGLE_OAUTH_REFRESH_TOKEN";

const PROVIDERS: ProviderSpec[] = [
  {
    key: "github",
    label: "GitHub",
    detail: "Code, issues, pull requests, and releases.",
    tokenEnvKey: "GH_GLOBAL",
    tokenHint: "GitHub → Settings → Developer settings → Personal access tokens.",
    tokenPlaceholder: "ghp_... or github_pat_...",
    verify: verifyGitHub,
  },
  {
    key: "linear",
    label: "Linear",
    detail: "Tasks, projects, and triage queues.",
    tokenEnvKey: "LINEAR_API_KEY",
    tokenHint: "Linear → Settings → Security & access → Personal API keys.",
    tokenPlaceholder: "lin_api_...",
    verify: verifyLinear,
  },
  {
    key: "slack",
    label: "Slack",
    detail: "Channels, mentions, and approval messages.",
    tokenEnvKey: "SLACK_BOT_TOKEN",
    tokenHint: "Slack app → OAuth & Permissions → Bot User OAuth Token.",
    tokenPlaceholder: "xoxb-...",
    verify: verifySlack,
  },
  {
    key: "notion",
    label: "Notion",
    detail: "Docs, project pages, and task databases.",
    tokenEnvKey: "NOTION_API_KEY",
    tokenHint: "notion.so/profile/integrations → New integration → Internal integration secret.",
    tokenPlaceholder: "ntn_... or secret_...",
    verify: verifyNotion,
  },
  {
    key: "google",
    label: "Google",
    detail: "Drive, Gmail, and Calendar context.",
    tokenEnvKey: GOOGLE_REFRESH_TOKEN_ENV,
    tokenHint: "Connect with your Google account. One-time: paste an OAuth client (Desktop app type) from console.cloud.google.com.",
    tokenPlaceholder: "",
    verify: verifyGoogle,
  },
];

export function connectionProvider(key: string) {
  return PROVIDERS.find((provider) => provider.key === key);
}

export async function readConnectionsPayload(): Promise<ConnectionsPayload> {
  const sharedEnv = await readSharedAgentEnv();
  const providers = await Promise.all(PROVIDERS.map((provider) => providerStatus(provider, sharedEnv)));
  return { ok: true, providers };
}

export async function saveProviderToken(providerKey: string, token: string): Promise<{ account?: string }> {
  const provider = connectionProvider(providerKey);
  if (!provider) throw new Error(`Unknown provider: ${providerKey}`);
  if (provider.key === "google") throw new Error("Google connects through sign-in, not a pasted token.");
  const clean = token.trim();
  if (clean.length < 8 || /\s/.test(clean)) throw new Error("That does not look like a valid token.");
  const sharedEnv = await readSharedAgentEnv();
  const result = await provider.verify(clean, sharedEnv);
  if (!result.ok) throw new Error(result.error || `${provider.label} rejected the token.`);
  await saveSharedAgentEnv(provider.tokenEnvKey, clean);
  return { account: result.account };
}

export async function disconnectProvider(providerKey: string) {
  const provider = connectionProvider(providerKey);
  if (!provider) throw new Error(`Unknown provider: ${providerKey}`);
  await removeSharedAgentEnv(provider.tokenEnvKey);
}

export async function saveGoogleOAuthClient(clientId: string, clientSecret: string) {
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (!id || !secret) throw new Error("Both the client ID and client secret are required.");
  if (/\s/.test(id) || /\s/.test(secret)) throw new Error("Client credentials cannot contain spaces.");
  await saveSharedAgentEnv(GOOGLE_CLIENT_ID_ENV, id);
  await saveSharedAgentEnv(GOOGLE_CLIENT_SECRET_ENV, secret);
}

async function providerStatus(provider: ProviderSpec, sharedEnv: Record<string, string>): Promise<ConnectionProviderStatus> {
  const token = sharedEnvValue(provider.tokenEnvKey, sharedEnv);
  const base: ConnectionProviderStatus = {
    key: provider.key,
    label: provider.label,
    detail: provider.detail,
    connected: Boolean(token),
    verified: false,
    tokenHint: provider.tokenHint,
    tokenPlaceholder: provider.tokenPlaceholder,
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

async function apiCheck(run: () => Promise<VerifyResult>): Promise<VerifyResult> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/abort|timeout/i.test(message)) return { ok: false, error: "The provider did not answer in time. Check the network and try again." };
    return { ok: false, error: message };
  }
}
