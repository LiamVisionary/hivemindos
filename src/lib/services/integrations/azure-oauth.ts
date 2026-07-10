import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "@/lib/home-dir";
import { join } from "node:path";

import { writeSharedHiveEnvValues } from "@/lib/services/hive-env-write";
import { readSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";
import {
  AZURE_ACCOUNT_EMAIL_ENV,
  AZURE_OAUTH_CLIENT_ID_ENV,
  AZURE_REFRESH_TOKEN_ENV,
  AZURE_TENANT_ID_ENV,
} from "@/lib/services/integrations/provider-connection-env";

// Public client metadata may ship in HivemindOS. AZURE_CLIENT_SECRET never does:
// it exists only in the hosted OAuth broker.
const AZURE_OAUTH_CLIENT_ID_DEFAULT = "4399c52c-8cde-41fe-bea8-634bed72fd13";
const AZURE_OAUTH_CLIENT_ID_PLACEHOLDER = "REPLACE_WITH_HIVEMINDOS_AZURE_CLIENT_ID";
const AZURE_AUTHORIZE_ORIGIN = "https://login.microsoftonline.com";
const AZURE_TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AZURE_SCOPE = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://management.azure.com/user_impersonation",
].join(" ");
const OAUTH_BROKER_URL_DEFAULT = "https://hivemindos-google-oauth-exchange.hivemindos.workers.dev";
const AZURE_CALLBACK_PATH = "/azure/callback";
const FLOW_TTL_MS = 10 * 60_000;

const HIVE_DIR = join(homedir(), ".hivemindos");
const PENDING_FILE = join(HIVE_DIR, "azure-oauth-pending.json");

type PendingFlow = { pollSecret: string; created: number };
type PendingStore = Record<string, PendingFlow>;

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function readPending(): PendingStore {
  let store: PendingStore;
  try {
    store = JSON.parse(readFileSync(PENDING_FILE, "utf8")) as PendingStore;
  } catch {
    return {};
  }
  const cutoff = Date.now() - FLOW_TTL_MS;
  let changed = false;
  for (const [flowId, flow] of Object.entries(store)) {
    if (!flow || typeof flow.created !== "number" || flow.created < cutoff) {
      delete store[flowId];
      changed = true;
    }
  }
  if (changed) writePending(store);
  return store;
}

function writePending(store: PendingStore): void {
  try {
    mkdirSync(HIVE_DIR, { recursive: true });
    writeFileSync(PENDING_FILE, JSON.stringify(store), { mode: 0o600 });
  } catch {
    // The next poll reports expired if the local handoff cannot be persisted.
  }
}

export function azureOAuthClientId(): string {
  return (process.env[AZURE_OAUTH_CLIENT_ID_ENV]?.trim() || AZURE_OAUTH_CLIENT_ID_DEFAULT).trim();
}

export function azureOAuthClientReady(): boolean {
  const clientId = azureOAuthClientId();
  return Boolean(clientId) && clientId !== AZURE_OAUTH_CLIENT_ID_PLACEHOLDER;
}

function azureBrokerUrl(): string {
  return (
    process.env.AZURE_OAUTH_BROKER_URL?.trim()
    || process.env.GOOGLE_CLOUD_OAUTH_EXCHANGE_URL?.trim()
    || OAUTH_BROKER_URL_DEFAULT
  ).replace(/\/+$/, "");
}

function azureRedirectUri(): string {
  return `${azureBrokerUrl()}${AZURE_CALLBACK_PATH}`;
}

function azureAuthority(tenantIdInput?: string): string {
  const tenantId = tenantIdInput?.trim() || "";
  if (!tenantId) return "common";
  if (!AZURE_TENANT_ID.test(tenantId)) throw new Error("Azure tenantId must be a Microsoft Entra tenant UUID.");
  return tenantId;
}

export async function startAzureConnect(tenantIdInput?: string): Promise<{ authorizeUrl: string; flowId: string; missing: string[] }> {
  if (!azureOAuthClientReady()) {
    return { authorizeUrl: "", flowId: "", missing: [AZURE_OAUTH_CLIENT_ID_ENV] };
  }

  const sharedEnv = await readSharedAgentEnv();
  const authority = azureAuthority(tenantIdInput || sharedEnvValue(AZURE_TENANT_ID_ENV, sharedEnv));
  const flowId = base64Url(randomBytes(32));
  const pollSecret = base64Url(randomBytes(32));
  const pollHash = base64Url(createHash("sha256").update(pollSecret).digest());
  const nonce = base64Url(randomBytes(24));
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const clientId = azureOAuthClientId();
  const redirectUri = azureRedirectUri();

  const response = await fetch(`${azureBrokerUrl()}/azure/start`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sid: flowId,
      poll_hash: pollHash,
      client_id: clientId,
      redirect_uri: redirectUri,
      authority,
      nonce,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Could not start Microsoft sign-in (HTTP ${response.status}).`);
  }

  const store = readPending();
  store[flowId] = { pollSecret, created: Date.now() };
  writePending(store);

  const authorizeUrl = `${AZURE_AUTHORIZE_ORIGIN}/${authority}/oauth2/v2.0/authorize?${new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: AZURE_SCOPE,
    state: flowId,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString()}`;
  return { authorizeUrl, flowId, missing: [] };
}

export type AzurePollStatus = "pending" | "connected" | "expired" | "error";

export async function pollAzureConnect(flowId: string): Promise<{ status: AzurePollStatus; error?: string }> {
  const store = readPending();
  const pending = store[flowId];
  if (!pending) return { status: "expired" };
  const forget = () => {
    delete store[flowId];
    writePending(store);
  };

  const response = await fetch(`${azureBrokerUrl()}/azure/result`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sid: flowId, poll_secret: pending.pollSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    status?: string;
    refresh_token?: string;
    account?: string;
    tenant_id?: string;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok) {
    forget();
    return { status: "error", error: data?.error || `Sign-in check failed (HTTP ${response.status}).` };
  }
  if (data.status === "pending") return { status: "pending" };
  if (data.status === "expired") {
    forget();
    return { status: "expired" };
  }
  if (data.status === "error") {
    forget();
    return { status: "error", error: data.error };
  }

  const refreshToken = data.refresh_token?.trim() || "";
  forget();
  if (!refreshToken) return { status: "error", error: "Microsoft returned no refresh token." };
  await writeSharedHiveEnvValues({
    [AZURE_REFRESH_TOKEN_ENV]: refreshToken,
    ...(data.account ? { [AZURE_ACCOUNT_EMAIL_ENV]: data.account } : {}),
    ...(data.tenant_id ? { [AZURE_TENANT_ID_ENV]: data.tenant_id } : {}),
  });
  return { status: "connected" };
}

export async function mintAzureAccessToken(refreshTokenInput?: string): Promise<string> {
  const sharedEnv = await readSharedAgentEnv();
  const refreshToken = refreshTokenInput?.trim() || sharedEnvValue(AZURE_REFRESH_TOKEN_ENV, sharedEnv);
  if (!refreshToken) throw new Error(`Connect Microsoft Azure first (${AZURE_REFRESH_TOKEN_ENV} is missing).`);
  const tenantId = sharedEnvValue(AZURE_TENANT_ID_ENV, sharedEnv);

  const response = await fetch(`${azureBrokerUrl()}/azure/refresh`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: azureOAuthClientId(),
      refresh_token: refreshToken,
      ...(tenantId ? { tenant_id: azureAuthority(tenantId) } : {}),
      scope: AZURE_SCOPE,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    access_token?: string;
    refresh_token?: string;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok || !data.access_token) {
    throw new Error(data?.error || `Microsoft token refresh failed (HTTP ${response.status}).`);
  }
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await writeSharedHiveEnvValues({ [AZURE_REFRESH_TOKEN_ENV]: data.refresh_token });
  }
  return data.access_token;
}
