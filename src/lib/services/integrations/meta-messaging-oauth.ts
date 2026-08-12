import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { homedir } from "@/lib/home-dir";
import { saveMetaMessagingOAuthAssets, type MetaMessagingOAuthAsset } from "@/lib/services/integrations/meta-messaging";
import { META_MESSAGING_OAUTH_CLIENT_ID_ENV } from "@/lib/services/integrations/provider-connection-env";

const META_OAUTH_CLIENT_ID_PLACEHOLDER = "REPLACE_WITH_HIVEMINDOS_META_CLIENT_ID";
const META_OAUTH_CLIENT_ID_DEFAULT = META_OAUTH_CLIENT_ID_PLACEHOLDER;
const META_AUTHORIZE_URL = "https://www.facebook.com/v23.0/dialog/oauth";
const OAUTH_BROKER_URL_DEFAULT = "https://hivemindos-google-oauth-exchange.hivemindos.workers.dev";
const META_CALLBACK_PATH = "/meta/callback";
const META_SCOPE = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_messages",
].join(",");
const FLOW_TTL_MS = 10 * 60_000;

export function metaMessagingOAuthClientId(): string {
  return (process.env[META_MESSAGING_OAUTH_CLIENT_ID_ENV]?.trim() || META_OAUTH_CLIENT_ID_DEFAULT).trim();
}

export function metaMessagingOAuthClientReady(): boolean {
  const clientId = metaMessagingOAuthClientId();
  return Boolean(clientId) && clientId !== META_OAUTH_CLIENT_ID_PLACEHOLDER;
}

function brokerUrl(): string {
  return (
    process.env.META_MESSAGING_OAUTH_BROKER_URL?.trim()
    || process.env.GOOGLE_CLOUD_OAUTH_EXCHANGE_URL?.trim()
    || OAUTH_BROKER_URL_DEFAULT
  ).replace(/\/+$/, "");
}

function redirectUri(): string {
  return `${brokerUrl()}${META_CALLBACK_PATH}`;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const HIVE_DIR = join(homedir(), ".hivemindos");
const PENDING_FILE = join(HIVE_DIR, "meta-messaging-oauth-pending.json");
type PendingFlow = { pollSecret: string; created: number };
type PendingStore = Record<string, PendingFlow>;

function writePending(store: PendingStore): void {
  try {
    mkdirSync(HIVE_DIR, { recursive: true });
    writeFileSync(PENDING_FILE, JSON.stringify(store), { mode: 0o600 });
  } catch {
    // A failed local write makes this one flow expire without exposing secrets.
  }
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
  for (const [sid, flow] of Object.entries(store)) {
    if (!flow || typeof flow.created !== "number" || flow.created < cutoff) {
      delete store[sid];
      changed = true;
    }
  }
  if (changed) writePending(store);
  return store;
}

export async function startMetaMessagingConnect(): Promise<{ authorizeUrl: string; flowId: string; missing: string[] }> {
  if (!metaMessagingOAuthClientReady()) {
    return { authorizeUrl: "", flowId: "", missing: [META_MESSAGING_OAUTH_CLIENT_ID_ENV] };
  }
  const sid = base64Url(randomBytes(32));
  const pollSecret = base64Url(randomBytes(32));
  const pollHash = base64Url(createHash("sha256").update(pollSecret).digest());
  const clientId = metaMessagingOAuthClientId();
  const callback = redirectUri();
  const response = await fetch(`${brokerUrl()}/meta/start`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sid, poll_hash: pollHash, client_id: clientId, redirect_uri: callback }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !data?.ok) throw new Error(data?.error || `Could not start Meta sign-in (HTTP ${response.status}).`);

  const store = readPending();
  store[sid] = { pollSecret, created: Date.now() };
  writePending(store);
  const authorizeUrl = `${META_AUTHORIZE_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    response_type: "code",
    scope: META_SCOPE,
    state: sid,
  }).toString()}`;
  return { authorizeUrl, flowId: sid, missing: [] };
}

export type MetaMessagingPollStatus = "pending" | "connected" | "expired" | "error";

export async function pollMetaMessagingConnect(flowId: string): Promise<{ status: MetaMessagingPollStatus; error?: string }> {
  const store = readPending();
  const pending = store[flowId];
  if (!pending) return { status: "expired" };
  const forget = () => {
    delete store[flowId];
    writePending(store);
  };
  const response = await fetch(`${brokerUrl()}/meta/result`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sid: flowId, poll_secret: pending.pollSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    status?: string;
    assets?: MetaMessagingOAuthAsset[];
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
  forget();
  if (!Array.isArray(data.assets) || !data.assets.length) return { status: "error", error: "Meta returned no manageable messaging accounts." };
  await saveMetaMessagingOAuthAssets(data.assets);
  return { status: "connected" };
}
