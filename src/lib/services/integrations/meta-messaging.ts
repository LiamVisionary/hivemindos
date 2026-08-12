import "server-only";

import { createHash } from "node:crypto";

import {
  readSharedAgentEnv,
  removeSharedAgentEnv,
  saveSharedAgentEnvValues,
  sharedEnvValue,
} from "@/lib/services/integrations/shared-env";
import {
  META_MESSAGING_DIRECTORY_ENV,
  META_MESSAGING_LEGACY_TOKEN_ENV,
} from "@/lib/services/integrations/provider-connection-env";

export type MetaMessagingSurface = "instagram" | "facebook";

export type MetaMessagingConnection = {
  id: string;
  surface: MetaMessagingSurface;
  businessAccountId: string;
  label: string;
  username?: string;
  tokenEnvKey: string;
  createdAt: string;
  updatedAt: string;
};

export type MetaMessagingOAuthAsset = {
  surface: MetaMessagingSurface;
  businessAccountId: string;
  label: string;
  username?: string;
  accessToken: string;
};

export type MetaMessagingManualConnectionInput = {
  surface: MetaMessagingSurface;
  businessAccountId: string;
  label: string;
  accessToken: string;
};

export type MetaMessagingConnectionStatus = MetaMessagingConnection & {
  verified: boolean;
  error?: string;
};

const GRAPH_API_VERSION = "v23.0";
const VERIFY_TIMEOUT_MS = 6_000;
const MAX_CONNECTIONS = 50;

function cleanText(value: unknown, max = 180): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function connectionId(surface: MetaMessagingSurface, businessAccountId: string): string {
  return `meta-messaging:${surface}:${businessAccountId}`;
}

function tokenEnvKey(id: string): string {
  const digest = createHash("sha256").update(id).digest("hex").slice(0, 20).toUpperCase();
  return `META_MESSAGING_${digest}_TOKEN`;
}

async function verifyMetaAsset(
  surface: MetaMessagingSurface,
  businessAccountId: string,
  accessToken: string,
): Promise<{ label?: string; username?: string }> {
  const fields = surface === "instagram" ? "id,username,name" : "id,name";
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(businessAccountId)}?fields=${encodeURIComponent(fields)}`,
    {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "hivemindos-connections" },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    },
  );
  const payload = await response.json().catch(() => null) as {
    id?: string;
    name?: string;
    username?: string;
    error?: { message?: string };
  } | null;
  if (!response.ok || payload?.id !== businessAccountId) {
    throw new Error(payload?.error?.message || `Meta returned HTTP ${response.status}.`);
  }
  return {
    label: cleanText(payload.username) || cleanText(payload.name) || undefined,
    username: cleanText(payload.username) || undefined,
  };
}

function normalizeConnection(value: unknown): MetaMessagingConnection | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const surface = raw.surface === "instagram" || raw.surface === "facebook" ? raw.surface : null;
  const businessAccountId = cleanText(raw.businessAccountId, 96);
  const label = cleanText(raw.label);
  const savedTokenEnvKey = cleanText(raw.tokenEnvKey, 128);
  if (!surface || !businessAccountId || !label || !/^[A-Z][A-Z0-9_]+$/.test(savedTokenEnvKey)) return null;
  const expectedId = connectionId(surface, businessAccountId);
  const rawCreatedAt = cleanText(raw.createdAt, 64);
  const rawUpdatedAt = cleanText(raw.updatedAt, 64);
  const createdAt = Number.isFinite(Date.parse(rawCreatedAt)) ? new Date(rawCreatedAt).toISOString() : new Date(0).toISOString();
  const updatedAt = Number.isFinite(Date.parse(rawUpdatedAt)) ? new Date(rawUpdatedAt).toISOString() : createdAt;
  return {
    id: expectedId,
    surface,
    businessAccountId,
    label,
    username: cleanText(raw.username) || undefined,
    tokenEnvKey: savedTokenEnvKey,
    createdAt,
    updatedAt,
  };
}

export function parseMetaMessagingDirectory(value: string): MetaMessagingConnection[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const byId = new Map<string, MetaMessagingConnection>();
  for (const entry of parsed.slice(0, MAX_CONNECTIONS)) {
    const connection = normalizeConnection(entry);
    if (connection) byId.set(connection.id, connection);
  }
  return [...byId.values()];
}

export function readMetaMessagingDirectoryFromEnv(sharedEnv: Record<string, string>): MetaMessagingConnection[] {
  return parseMetaMessagingDirectory(sharedEnvValue(META_MESSAGING_DIRECTORY_ENV, sharedEnv));
}

export async function saveMetaMessagingOAuthAssets(assets: MetaMessagingOAuthAsset[]): Promise<MetaMessagingConnection[]> {
  const sharedEnv = await readSharedAgentEnv();
  const current = readMetaMessagingDirectoryFromEnv(sharedEnv);
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  const now = new Date().toISOString();
  const values: Record<string, string> = {};

  for (const asset of assets.slice(0, MAX_CONNECTIONS)) {
    const surface = asset.surface === "instagram" || asset.surface === "facebook" ? asset.surface : null;
    const businessAccountId = cleanText(asset.businessAccountId, 96);
    const label = cleanText(asset.label);
    const accessToken = cleanText(asset.accessToken, 8_192);
    if (!surface || !businessAccountId || !label || accessToken.length < 16 || /\s/.test(accessToken)) continue;
    const id = connectionId(surface, businessAccountId);
    const existing = byId.get(id);
    const envKey = existing?.tokenEnvKey || tokenEnvKey(id);
    values[envKey] = accessToken;
    byId.set(id, {
      id,
      surface,
      businessAccountId,
      label,
      username: cleanText(asset.username) || undefined,
      tokenEnvKey: envKey,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  const connections = [...byId.values()].slice(0, MAX_CONNECTIONS);
  if (!connections.length) throw new Error("Meta returned no Facebook Pages or linked Instagram professional accounts that HivemindOS can manage.");
  values[META_MESSAGING_DIRECTORY_ENV] = JSON.stringify(connections);
  await saveSharedAgentEnvValues(values);
  return connections;
}

/** Self-hosted/BYOK setup when the official hosted Meta OAuth app is unavailable. */
export async function saveMetaMessagingManualConnection(
  input: MetaMessagingManualConnectionInput,
): Promise<MetaMessagingConnection[]> {
  const surface = input.surface === "instagram" || input.surface === "facebook" ? input.surface : null;
  const businessAccountId = cleanText(input.businessAccountId, 96);
  const accessToken = cleanText(input.accessToken, 8_192);
  const fallbackLabel = cleanText(input.label);
  if (!surface) throw new Error("Inbox type must be instagram or facebook.");
  if (!/^\d{3,96}$/.test(businessAccountId)) throw new Error("Enter the numeric Instagram business account or Facebook Page ID.");
  if (accessToken.length < 16 || /\s/.test(accessToken)) throw new Error("Enter a valid Meta Page access token.");
  const identity = await verifyMetaAsset(surface, businessAccountId, accessToken);
  return saveMetaMessagingOAuthAssets([{
    surface,
    businessAccountId,
    accessToken,
    label: identity.label || fallbackLabel || `${surface === "instagram" ? "Instagram" : "Facebook"} ${businessAccountId}`,
    username: identity.username,
  }]);
}

export async function disconnectMetaMessaging(): Promise<void> {
  const sharedEnv = await readSharedAgentEnv();
  const tokenKeys = readMetaMessagingDirectoryFromEnv(sharedEnv).map((connection) => connection.tokenEnvKey);
  for (const key of [...new Set([...tokenKeys, META_MESSAGING_DIRECTORY_ENV, META_MESSAGING_LEGACY_TOKEN_ENV])]) {
    await removeSharedAgentEnv(key);
  }
}

export async function metaMessagingConnectionStatuses(
  sharedEnv?: Record<string, string>,
): Promise<MetaMessagingConnectionStatus[]> {
  const env = sharedEnv ?? await readSharedAgentEnv();
  const connections = readMetaMessagingDirectoryFromEnv(env);
  return Promise.all(connections.map(async (connection): Promise<MetaMessagingConnectionStatus> => {
    const token = sharedEnvValue(connection.tokenEnvKey, env);
    if (!token) return { ...connection, verified: false, error: `${connection.tokenEnvKey} is missing.` };
    try {
      const payload = await verifyMetaAsset(connection.surface, connection.businessAccountId, token);
      return {
        ...connection,
        label: payload.label || connection.label,
        username: payload.username || connection.username,
        verified: true,
      };
    } catch (error) {
      return { ...connection, verified: false, error: error instanceof Error ? error.message : "Meta verification failed." };
    }
  }));
}

export async function verifyMetaMessagingDirectory(
  directory: string,
  sharedEnv: Record<string, string>,
): Promise<{ ok: boolean; account?: string; error?: string }> {
  if (!parseMetaMessagingDirectory(directory).length) return { ok: false, error: "No Meta messaging accounts are connected." };
  const statuses = await metaMessagingConnectionStatuses(sharedEnv);
  const verified = statuses.filter((entry) => entry.verified);
  if (!verified.length) return { ok: false, error: statuses[0]?.error || "No Meta messaging account passed its live check." };
  const failed = statuses.length - verified.length;
  const account = verified.length === 1
    ? `${verified[0].label} · ${verified[0].surface === "instagram" ? "Instagram" : "Facebook"}`
    : `${verified.length} accounts${failed ? ` · ${failed} need attention` : ""}`;
  return { ok: true, account, error: failed ? `${failed} Meta messaging account${failed === 1 ? " needs" : "s need"} attention.` : undefined };
}
