import { constants } from "fs";
import { access, mkdir, readFile, rename, writeFile } from "fs/promises";
import { existsSync, statSync } from "fs";
import { createHash } from "crypto";
import { dirname, isAbsolute, join, sep } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AgentRuntime } from "@/lib/types/agent-runtime";
import { canonicalLocalCollectorUrl, isFleetCollectorUrl, isLocalCollectorUrl, normalizeCollectorUrl } from "@/lib/services/local-collector-url";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import {
  getProviderMeta,
  isMessagingProvider,
  MESSAGING_PROVIDER_META,
  messagingTargetRef,
  parseMessagingTarget,
} from "@/lib/services/messaging/provider-matrix";
import {
  channelCredentialStatus,
  hermesBinAvailable,
  hermesCommandEnv,
  resolveHermesBin,
  sendToProvider,
} from "@/lib/services/messaging/senders";
import { readSharedHiveEnvValues } from "@/lib/services/shared-hive-env";
import { DEFAULT_QUEEN_BEE_NAME } from "@/lib/config/queen-bee-personality";
import type {
  HiveMessagingChannel,
  HiveMessagingChannelDraft,
  HiveMessagingCredentialKind,
  HiveMessagingDirectoryEntry,
  HiveMessagingProvider,
  HiveMessagingProviderMeta,
  HiveMessagingRunState,
  HiveMessagingSendResult,
  HiveMessagingSettings,
} from "@/lib/types/messaging-channels";

const execFileAsync = promisify(execFile);

const MESSAGING_FILE = "messaging-channels.json";
const VALID_CREDENTIAL_KINDS = new Set<HiveMessagingCredentialKind>([
  "env-bot-token",
  "env-webhook-url",
  "env-access-token",
  "env-multi",
  "macos-messages",
  "hermes-runtime",
]);
const RUNTIME_DISCOVERY_TIMEOUT_MS = 6_000;

type MessagingStorageOptions = {
  vaultPath?: string | null;
  brainServicesFolder?: string | null;
  includeRuntimeChannels?: boolean;
  runtimeAgents?: MessagingRuntimeAgent[];
};

type SendOptions = MessagingStorageOptions & {
  channelId: string;
  message: string;
};

export type MessagingRuntimeAgent = {
  id?: string;
  name?: string;
  runtime?: AgentRuntime | string;
  agentId?: string;
  localDataDir?: string;
  machineName?: string;
  telemetryUrl?: string;
  collectorCapabilities?: {
    runtimes?: string[];
  };
};

export type MessagingChannelsResult = {
  channels: HiveMessagingChannel[];
  directory: HiveMessagingDirectoryEntry[];
  providers: HiveMessagingProviderMeta[];
  settingsFile: string;
  updatedAt: string;
};

export function resolveMessagingStorage(options: MessagingStorageOptions = {}) {
  const vaultRoot = resolveObsidianVaultPath(options.vaultPath ?? undefined, { requireWritable: true });
  const folder = safeVaultFolder(options.brainServicesFolder) || DEFAULT_SHARED_VAULT.brainServicesFolder;
  const root = join(vaultRoot, folder, "Messaging Channels");
  return {
    vaultRoot,
    folder,
    root,
    settingsFile: join(root, MESSAGING_FILE),
  };
}

export async function listMessagingChannels(options: MessagingStorageOptions = {}): Promise<MessagingChannelsResult> {
  const storage = resolveMessagingStorage(options);
  await ensureMessagingRoot(storage);
  const settings = await readSettings(storage.settingsFile);
  const storedChannels = settings.channels.map(normalizeStoredChannel).filter(Boolean) as HiveMessagingChannel[];
  const runtimeChannels = options.includeRuntimeChannels
    ? await discoverRuntimeMessagingChannels(options.runtimeAgents ?? [])
    : [];
  const merged = mergeMessagingChannels(storedChannels, runtimeChannels);
  const channels = await enrichChannels(merged);
  return {
    channels,
    directory: formatMessagingDirectory(channels),
    providers: MESSAGING_PROVIDER_META,
    settingsFile: storage.settingsFile,
    updatedAt: settings.updatedAt,
  };
}

/** Stamp each channel with credential status, delivery strategy, and run state for the UI. */
async function enrichChannels(channels: HiveMessagingChannel[]): Promise<HiveMessagingChannel[]> {
  const hermesAvailable = await hermesBinAvailable().catch(() => false);
  // A credential counts as configured if it is set in either process.env or the
  // shared hive env (~/.hivemindos/.env), matching hiveEnvValue's precedence, so
  // channels configured the documented way are not falsely flagged "Needs key".
  const sharedEnv = await readSharedHiveEnvValues().catch(() => ({} as Record<string, string>));
  const isPresent = (key: string) => Boolean(process.env[key]?.trim() || sharedEnv[key]?.trim());
  return channels.map((channel) => {
    const status = channelCredentialStatus(channel, hermesAvailable, isPresent);
    const meta = getProviderMeta(channel.provider);
    return {
      ...channel,
      credentialConfigured: status.configured,
      credentialLabel: status.label,
      missingCredentials: status.missing,
      deliveryStrategy: channel.readOnly ? "hermes" : meta.deliveryStrategy,
      runState: runStateFor(channel, status.configured),
    };
  });
}

function runStateFor(channel: HiveMessagingChannel, credentialConfigured: boolean): HiveMessagingRunState {
  if (channel.readOnly) return "live";
  if (!channel.enabled) return "paused";
  if (!credentialConfigured) return "attention";
  return "enabled";
}

export async function upsertMessagingChannel(input: HiveMessagingChannelDraft & { id?: string }, options: MessagingStorageOptions = {}) {
  const storage = resolveMessagingStorage(options);
  await ensureMessagingRoot(storage);
  const settings = await readSettings(storage.settingsFile);
  const current = input.id ? settings.channels.find((channel) => channel.id === input.id) : undefined;
  const next = normalizeChannelDraft(input, current);
  const channels = settings.channels.filter((channel) => channel.id !== next.id);
  if (next.defaultForAgent) {
    for (const channel of channels) {
      if (channel.agentId === next.agentId) channel.defaultForAgent = false;
    }
  }
  channels.push(next);
  await writeSettings(storage.settingsFile, channels);
  return listMessagingChannels(options);
}

export async function deleteMessagingChannel(id: string, options: MessagingStorageOptions = {}) {
  if (!id.trim()) throw new Error("Messaging channel id is required.");
  const storage = resolveMessagingStorage(options);
  await ensureMessagingRoot(storage);
  const settings = await readSettings(storage.settingsFile);
  await writeSettings(storage.settingsFile, settings.channels.filter((channel) => channel.id !== id));
  return listMessagingChannels(options);
}

export async function sendHiveMessage(options: SendOptions): Promise<HiveMessagingSendResult> {
  const message = options.message.trim();
  if (!message) throw new Error("Message is required.");
  const { channels } = await listMessagingChannels(options);
  const channel = channels.find((item) => item.id === options.channelId);
  if (!channel) throw new Error("Messaging channel was not found.");
  if (!channel.enabled) throw new Error(`${channel.label} is disabled.`);
  const limitedMessage = limitMessage(message, getProviderMeta(channel.provider).messageLimit);
  const result = await sendToProvider(channel, limitedMessage);
  if (channel.readOnly) return result;
  const storage = resolveMessagingStorage(options);
  const settings = await readSettings(storage.settingsFile);
  const nextChannels = settings.channels.map((item) => item.id === channel.id ? {
    ...item,
    lastTestAt: result.sentAt,
    lastTestStatus: result.ok ? "ok" as const : "error" as const,
    lastTestMessage: result.message,
    updatedAt: new Date().toISOString(),
  } : item);
  await writeSettings(storage.settingsFile, nextChannels);
  return result;
}

type HermesSendTarget = {
  provider: HiveMessagingProvider;
  chatId: string;
  threadId?: string;
  name: string;
  type: string;
  targetRef: string;
};

function mergeMessagingChannels(storedChannels: HiveMessagingChannel[], runtimeChannels: HiveMessagingChannel[]) {
  const channels = new Map<string, HiveMessagingChannel>();
  for (const channel of storedChannels) channels.set(channel.id, withVaultSource(channel));
  for (const channel of runtimeChannels) {
    if (!channels.has(channel.id)) channels.set(channel.id, channel);
  }
  return [...channels.values()];
}

function withVaultSource(channel: HiveMessagingChannel): HiveMessagingChannel {
  return {
    ...channel,
    source: channel.source ?? { kind: "vault", label: "Shared vault" },
    delivery: channel.delivery ?? { kind: "provider" },
  };
}

async function discoverRuntimeMessagingChannels(agents: MessagingRuntimeAgent[]) {
  const representatives = hermesAgentRepresentatives(agents);
  const discovered = await Promise.all(representatives.map(discoverHermesAgentChannels));
  return discovered.flat();
}

function hermesAgentRepresentatives(agents: MessagingRuntimeAgent[]) {
  const hermesAgents = agents.filter(isHermesMessagingAgent);
  const candidates = hermesAgents.length
    ? hermesAgents
    : [{
        id: "hermes-local",
        name: "Hermes",
        runtime: "hermes",
        agentId: "local-hermes",
        localDataDir: "~/.hermes",
        machineName: "This Mac",
      }];
  const byCollector = new Map<string, MessagingRuntimeAgent[]>();
  for (const agent of candidates) {
    const key = normalizeCollectorUrl(agent.telemetryUrl) || "local";
    byCollector.set(key, [...(byCollector.get(key) ?? []), agent]);
  }
  return [...byCollector.values()].map((group) =>
    group.find((agent) => agent.agentId === "local-hermes")
    ?? group.find((agent) => /^hermes$/i.test(agent.name ?? ""))
    ?? group[0],
  ).filter((agent): agent is MessagingRuntimeAgent => Boolean(agent));
}

function isHermesMessagingAgent(agent: MessagingRuntimeAgent) {
  const runtime = String(agent.runtime ?? "").toLowerCase();
  return runtime === "hermes" || (agent.collectorCapabilities?.runtimes ?? []).includes("hermes");
}

async function discoverHermesAgentChannels(agent: MessagingRuntimeAgent) {
  const collectorUrl = await canonicalLocalCollectorUrl(agent);
  if (collectorUrl && !isLocalCollectorUrl(collectorUrl)) {
    // SSRF guard: only fetch a client-supplied collector URL when it targets a
    // known fleet host (loopback / Tailscale node / *.local), never an
    // arbitrary internal host. Non-fleet hosts contribute no runtime channels.
    if (!isFleetCollectorUrl(collectorUrl)) return [];
    return discoverRemoteHermesChannels(agent, collectorUrl);
  }
  return discoverLocalHermesChannels(agent);
}

async function discoverRemoteHermesChannels(agent: MessagingRuntimeAgent, collectorUrl: string) {
  try {
    const response = await fetch(`${collectorUrl}/messaging-channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", agent: runtimeAgentPayload(agent) }),
      signal: AbortSignal.timeout(RUNTIME_DISCOVERY_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => null) as { channels?: HiveMessagingChannel[] } | null;
    return (payload?.channels ?? []).map((channel) => runtimeChannelForAgent(channel, agent, collectorUrl));
  } catch {
    return [];
  }
}

async function discoverLocalHermesChannels(agent: MessagingRuntimeAgent) {
  try {
    const { stdout } = await execFileAsync(await resolveHermesBin(), ["send", "-l", "--json"], {
      timeout: RUNTIME_DISCOVERY_TIMEOUT_MS,
      maxBuffer: 1_500_000,
      env: hermesCommandEnv(agent),
    });
    return parseHermesSendTargets(stdout).map((target) => hermesTargetChannel(agent, target));
  } catch {
    return [];
  }
}

function parseHermesSendTargets(raw: string): HermesSendTarget[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const platforms = (parsed as { platforms?: unknown }).platforms;
  if (!platforms || typeof platforms !== "object" || Array.isArray(platforms)) return [];
  const targets: HermesSendTarget[] = [];
  for (const [providerText, entries] of Object.entries(platforms)) {
    const provider = normalizeHermesProvider(providerText);
    if (!provider || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      const chatId = String(record.id ?? record.chat_id ?? "").trim();
      if (!chatId) continue;
      const threadId = String(record.thread_id ?? record.threadId ?? "").trim() || undefined;
      targets.push({
        provider,
        chatId,
        threadId,
        name: String(record.name ?? record.display_name ?? record.displayName ?? chatId).trim() || chatId,
        type: String(record.type ?? "channel").trim() || "channel",
        targetRef: messagingTargetRef(provider, chatId, threadId),
      });
    }
  }
  return targets;
}

function normalizeHermesProvider(provider: string): HiveMessagingProvider | "" {
  const normalized = provider.trim().toLowerCase();
  return isMessagingProvider(normalized) ? normalized : "";
}

function runtimeChannelForAgent(channel: HiveMessagingChannel, agent: MessagingRuntimeAgent, collectorUrl: string): HiveMessagingChannel {
  return {
    ...channel,
    id: channel.id || runtimeChannelId(agent, channel.provider, `${channel.target.chatId}:${channel.target.threadId ?? ""}`),
    agentId: channel.agentId || agent.id || agent.agentId || "hermes",
    agentName: channel.agentName || agent.name || "Hermes",
    readOnly: true,
    source: {
      kind: "hermes",
      label: "Hermes",
      machineName: channel.source?.machineName || agent.machineName,
      collectorUrl,
      runtime: "hermes",
    },
    delivery: {
      kind: "hermes-send",
      targetRef: channel.delivery?.targetRef || messagingTargetRef(channel.provider, channel.target.chatId, channel.target.threadId),
      collectorUrl,
      machineName: channel.delivery?.machineName || agent.machineName,
      agentLocalDataDir: channel.delivery?.agentLocalDataDir || agent.localDataDir,
    },
  };
}

function hermesTargetChannel(agent: MessagingRuntimeAgent, target: HermesSendTarget): HiveMessagingChannel {
  const now = new Date().toISOString();
  const agentId = agent.id || agent.agentId || "hermes";
  const agentName = agent.name || "Hermes";
  const meta = getProviderMeta(target.provider);
  return {
    id: runtimeChannelId(agent, target.provider, target.targetRef),
    provider: target.provider,
    label: `${meta.label} ${target.name}`,
    agentId,
    agentName,
    enabled: true,
    defaultForAgent: false,
    credentialKind: meta.credentialKind,
    credentialEnvKey: undefined,
    target: {
      chatId: target.chatId,
      threadId: target.threadId,
      displayName: target.name,
    },
    createdAt: now,
    updatedAt: now,
    readOnly: true,
    source: {
      kind: "hermes",
      label: "Hermes",
      machineName: agent.machineName,
      collectorUrl: normalizeCollectorUrl(agent.telemetryUrl) || undefined,
      runtime: "hermes",
    },
    delivery: {
      kind: "hermes-send",
      targetRef: target.targetRef,
      collectorUrl: normalizeCollectorUrl(agent.telemetryUrl) || undefined,
      machineName: agent.machineName,
      agentLocalDataDir: agent.localDataDir,
    },
  };
}

function runtimeChannelId(agent: MessagingRuntimeAgent, provider: HiveMessagingProvider, targetRef: string) {
  const machine = agent.machineName || agent.telemetryUrl || "local";
  const owner = agent.id || agent.agentId || agent.name || "hermes";
  const hash = createHash("sha256").update([machine, owner, provider, targetRef].join("\n")).digest("hex").slice(0, 16);
  return `hermes-${hash}`;
}

function normalizeChannelDraft(input: HiveMessagingChannelDraft & { id?: string }, current?: HiveMessagingChannel): HiveMessagingChannel {
  const now = new Date().toISOString();
  const provider = normalizeProvider(input.provider ?? current?.provider ?? "telegram");
  const meta = getProviderMeta(provider);
  const credentialKind = meta.credentialKind;
  const targetText = input.target?.chatId ?? current?.target.chatId ?? "";
  const parsedTarget = parseMessagingTarget(provider, targetText);
  const label = (input.label ?? current?.label ?? `${meta.label} channel`).trim();
  const agentId = (input.agentId ?? current?.agentId ?? "queen-bee").trim() || "queen-bee";
  const agentName = (input.agentName ?? current?.agentName ?? DEFAULT_QUEEN_BEE_NAME).trim() || DEFAULT_QUEEN_BEE_NAME;
  const envManaged = credentialKind === "macos-messages" || credentialKind === "hermes-runtime";
  if (!label) throw new Error("Messaging channel label is required.");
  if (!parsedTarget.chatId && meta.targetRequired) throw new Error(`${meta.label} target is required.`);
  if (!envManaged && !(input.credentialEnvKey ?? current?.credentialEnvKey ?? meta.credentialEnvHint ?? "").trim()) {
    throw new Error(`${meta.label} needs a credential env key name.`);
  }
  return {
    id: input.id?.trim() || current?.id || channelId(`${agentId}-${provider}-${label}`),
    provider,
    label,
    agentId,
    agentName,
    enabled: input.enabled ?? current?.enabled ?? true,
    defaultForAgent: input.defaultForAgent ?? current?.defaultForAgent ?? false,
    credentialKind,
    credentialEnvKey: envManaged ? undefined : cleanEnvKey(input.credentialEnvKey ?? current?.credentialEnvKey ?? meta.credentialEnvHint),
    target: {
      chatId: parsedTarget.chatId || current?.target.chatId || "",
      threadId: input.target?.threadId?.trim() || parsedTarget.threadId || current?.target.threadId,
      displayName: input.target?.displayName?.trim() || current?.target.displayName || label,
    },
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    lastTestAt: current?.lastTestAt,
    lastTestStatus: current?.lastTestStatus,
    lastTestMessage: current?.lastTestMessage,
  };
}

function normalizeStoredChannel(channel: HiveMessagingChannel) {
  try {
    return normalizeChannelDraft(channel, channel);
  } catch {
    return null;
  }
}

function formatMessagingDirectory(channels: HiveMessagingChannel[]): HiveMessagingDirectoryEntry[] {
  return channels
    .map((channel) => ({
      id: channel.id,
      name: channel.target.displayName || channel.label,
      provider: channel.provider,
      agentId: channel.agentId,
      agentName: channel.agentName,
      type: channel.target.threadId ? "thread" : "channel",
      enabled: channel.enabled,
      defaultForAgent: channel.defaultForAgent,
      threadId: channel.target.threadId,
    }))
    .sort((left, right) => left.agentName.localeCompare(right.agentName) || left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name));
}

function limitMessage(message: string, maxLength: number) {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, Math.max(0, maxLength - 80))}\n\n[truncated by HivemindOS messaging channel limit]`;
}

function runtimeAgentPayload(agent: MessagingRuntimeAgent) {
  return {
    id: agent.id,
    name: agent.name,
    runtime: agent.runtime,
    agentId: agent.agentId,
    localDataDir: agent.localDataDir,
    machineName: agent.machineName,
  };
}

async function ensureMessagingRoot(storage: ReturnType<typeof resolveMessagingStorage>) {
  if (!statSync(storage.vaultRoot).isDirectory()) throw new Error("Vault path is not a directory.");
  await access(storage.vaultRoot, constants.R_OK | constants.W_OK);
  await mkdir(storage.root, { recursive: true, mode: 0o700 });
  if (!existsSync(storage.settingsFile)) await writeSettings(storage.settingsFile, []);
}

async function readSettings(path: string): Promise<HiveMessagingSettings> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as Partial<HiveMessagingSettings>;
    return {
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return { channels: [], updatedAt: new Date().toISOString() };
  }
}

async function writeSettings(path: string, channels: HiveMessagingChannel[]) {
  const settings: HiveMessagingSettings = {
    channels: channels
      .map(stripComputedFields)
      .sort((left, right) => left.agentName.localeCompare(right.agentName) || left.label.localeCompare(right.label)),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, path);
}

/** Never persist the read-time computed fields into the settings file. */
function stripComputedFields(channel: HiveMessagingChannel): HiveMessagingChannel {
  const { credentialConfigured, credentialLabel, missingCredentials, deliveryStrategy, runState, ...persisted } = channel;
  void credentialConfigured; void credentialLabel; void missingCredentials; void deliveryStrategy; void runState;
  return persisted;
}

function normalizeProvider(value: string): HiveMessagingProvider {
  const provider = value.trim().toLowerCase();
  if (!isMessagingProvider(provider)) throw new Error(`Unsupported messaging provider: ${value}`);
  return provider;
}

// Kept for callers that persist an explicit credential kind; the effective kind
// is always derived from the provider matrix in normalizeChannelDraft.
export function isValidCredentialKind(value: string): value is HiveMessagingCredentialKind {
  return VALID_CREDENTIAL_KINDS.has(value as HiveMessagingCredentialKind);
}

function cleanEnvKey(value: string) {
  const key = value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
  if (key && !/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error("Credential env key must be a valid environment variable name.");
  return key;
}

function channelId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `message-channel-${Date.now().toString(36)}`;
}

function safeVaultFolder(folder?: string | null) {
  const value = folder?.trim();
  if (!value) return "";
  if (isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error("Messaging channels folder must be a relative path inside the shared vault.");
  }
  return value.split(/[\\/]+/).filter(Boolean).join(sep);
}
