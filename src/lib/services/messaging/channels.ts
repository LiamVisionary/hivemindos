import { constants } from "fs";
import { access, mkdir, readFile, rename, writeFile } from "fs/promises";
import { existsSync, statSync } from "fs";
import { createHash } from "crypto";
import { homedir } from "@/lib/home-dir";
import { dirname, isAbsolute, join, sep } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AgentRuntime } from "@/lib/types/agent-runtime";
import { canonicalLocalCollectorUrl, isLocalCollectorUrl, normalizeCollectorUrl } from "@/lib/services/local-collector-url";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type {
  HiveMessagingChannel,
  HiveMessagingChannelDraft,
  HiveMessagingCredentialKind,
  HiveMessagingDirectoryEntry,
  HiveMessagingProvider,
  HiveMessagingSendResult,
  HiveMessagingSettings,
} from "@/lib/types/messaging-channels";

const execFileAsync = promisify(execFile);

const MESSAGING_FILE = "messaging-channels.json";
const VALID_PROVIDERS = new Set<HiveMessagingProvider>(["telegram", "discord", "imessage", "slack", "webhook"]);
const VALID_CREDENTIAL_KINDS = new Set<HiveMessagingCredentialKind>(["env-bot-token", "env-webhook-url", "macos-messages"]);
const SECRET_TEXT_RE = /\b([A-Za-z0-9_-]*(?:token|secret|key|signature|webhook)[A-Za-z0-9_-]*)=([^\s,;]+)/gi;
const URL_SECRET_RE = /([?&](?:access_token|api[_-]?key|auth[_-]?token|token|signature|sig)=)([^&#\s]+)/gi;
const RUNTIME_DISCOVERY_TIMEOUT_MS = 6_000;
const RUNTIME_SEND_TIMEOUT_MS = 30_000;

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
  settingsFile: string;
  updatedAt: string;
};

export const PROVIDER_COPY: Record<HiveMessagingProvider, {
  label: string;
  credentialKind: HiveMessagingCredentialKind;
  credentialEnvHint: string;
  targetHint: string;
  messageLimit: number;
}> = {
  telegram: {
    label: "Telegram",
    credentialKind: "env-bot-token",
    credentialEnvHint: "TELEGRAM_BOT_TOKEN",
    targetHint: "chat id, or chat_id:thread_id for topics",
    messageLimit: 4096,
  },
  discord: {
    label: "Discord",
    credentialKind: "env-webhook-url",
    credentialEnvHint: "DISCORD_WEBHOOK_URL",
    targetHint: "webhook target; optional thread id",
    messageLimit: 2000,
  },
  imessage: {
    label: "iMessage",
    credentialKind: "macos-messages",
    credentialEnvHint: "",
    targetHint: "phone number, email, or Messages handle",
    messageLimit: 4000,
  },
  slack: {
    label: "Slack",
    credentialKind: "env-bot-token",
    credentialEnvHint: "SLACK_BOT_TOKEN",
    targetHint: "conversation id such as C..., G..., or D...",
    messageLimit: 4000,
  },
  webhook: {
    label: "Webhook",
    credentialKind: "env-webhook-url",
    credentialEnvHint: "HIVE_MESSAGE_WEBHOOK_URL",
    targetHint: "optional route, topic, or channel id sent in payload metadata",
    messageLimit: 8000,
  },
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
  const channels = mergeMessagingChannels(storedChannels, runtimeChannels);
  return {
    channels,
    directory: formatMessagingDirectory(channels),
    settingsFile: storage.settingsFile,
    updatedAt: settings.updatedAt,
  };
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
  const limitedMessage = limitMessage(message, PROVIDER_COPY[channel.provider].messageLimit);
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

export function parseMessagingTarget(provider: HiveMessagingProvider, targetRef: string) {
  const trimmed = targetRef.trim();
  if (!trimmed) return { chatId: "", threadId: undefined };
  if (provider === "telegram" || provider === "discord") {
    const match = /^(-?\d+)(?::(\d+))?$/.exec(trimmed);
    if (match) return { chatId: match[1], threadId: match[2] };
  }
  if (provider === "slack") {
    const match = /^([CGDU][A-Z0-9]{8,})(?::([^\s:]+))?$/.exec(trimmed);
    if (match) return { chatId: match[1], threadId: match[2] };
  }
  const [chatId, threadId] = trimmed.split(":", 2);
  return { chatId: chatId.trim(), threadId: threadId?.trim() || undefined };
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
        targetRef: `${provider}:${chatId}${threadId ? `:${threadId}` : ""}`,
      });
    }
  }
  return targets;
}

function normalizeHermesProvider(provider: string): HiveMessagingProvider | "" {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "telegram" || normalized === "discord" || normalized === "slack") return normalized;
  return "";
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
      targetRef: channel.delivery?.targetRef || hermesTargetRef(channel),
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
  const providerCopy = PROVIDER_COPY[target.provider];
  return {
    id: runtimeChannelId(agent, target.provider, target.targetRef),
    provider: target.provider,
    label: `${providerCopy.label} ${target.name}`,
    agentId,
    agentName,
    enabled: true,
    defaultForAgent: false,
    credentialKind: providerCopy.credentialKind,
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

function hermesTargetRef(channel: HiveMessagingChannel) {
  return `${channel.provider}:${channel.target.chatId}${channel.target.threadId ? `:${channel.target.threadId}` : ""}`;
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
  const copy = PROVIDER_COPY[provider];
  const targetText = input.target?.chatId ?? current?.target.chatId ?? "";
  const parsedTarget = parseMessagingTarget(provider, targetText);
  const credentialKind = normalizeCredentialKind(input.credentialKind ?? current?.credentialKind ?? copy.credentialKind);
  const label = (input.label ?? current?.label ?? `${copy.label} channel`).trim();
  const agentId = (input.agentId ?? current?.agentId ?? "queen-bee").trim() || "queen-bee";
  const agentName = (input.agentName ?? current?.agentName ?? "Queen Bee").trim() || "Queen Bee";
  if (!label) throw new Error("Messaging channel label is required.");
  if (!parsedTarget.chatId && provider !== "webhook") throw new Error(`${copy.label} target is required.`);
  if (credentialKind !== "macos-messages" && !(input.credentialEnvKey ?? current?.credentialEnvKey ?? "").trim()) {
    throw new Error(`${copy.label} needs a credential env key name.`);
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
    credentialEnvKey: credentialKind === "macos-messages" ? undefined : cleanEnvKey(input.credentialEnvKey ?? current?.credentialEnvKey ?? copy.credentialEnvHint),
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

async function sendToProvider(channel: HiveMessagingChannel, message: string): Promise<HiveMessagingSendResult> {
  if (channel.delivery?.kind === "hermes-send") return sendHermesChannel(channel, message);
  if (channel.provider === "telegram") return sendTelegram(channel, message);
  if (channel.provider === "discord") return sendDiscordWebhook(channel, message);
  if (channel.provider === "slack") return sendSlack(channel, message);
  if (channel.provider === "imessage") return sendIMessage(channel, message);
  if (channel.provider === "webhook") return sendGenericWebhook(channel, message);
  throw new Error(`Unsupported messaging provider: ${channel.provider}`);
}

async function sendHermesChannel(channel: HiveMessagingChannel, message: string) {
  const targetRef = channel.delivery?.targetRef || hermesTargetRef(channel);
  if (!targetRef) throw new Error("Hermes messaging target is missing.");
  const collectorUrl = normalizeCollectorUrl(channel.delivery?.collectorUrl);
  if (collectorUrl && !isLocalCollectorUrl(collectorUrl)) {
    const response = await fetch(`${collectorUrl}/messaging-channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send",
        targetRef,
        message,
        agent: {
          id: channel.agentId,
          name: channel.agentName,
          runtime: "hermes",
          localDataDir: channel.delivery?.agentLocalDataDir,
        },
      }),
      signal: AbortSignal.timeout(RUNTIME_SEND_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; providerMessageId?: string } | null;
    if (!response.ok || !payload?.ok) throw new Error(redactError(payload?.error || `Remote Hermes send failed: ${response.statusText}`));
    return sent(channel, "Sent via Hermes.", payload.providerMessageId);
  }
  const { stdout } = await execFileAsync(await resolveHermesBin(), ["send", "--to", targetRef, "--json", message], {
    timeout: RUNTIME_SEND_TIMEOUT_MS,
    maxBuffer: 1_500_000,
    env: hermesCommandEnv({ localDataDir: channel.delivery?.agentLocalDataDir }),
  });
  const payload = JSON.parse(stdout || "{}") as { ok?: boolean; id?: string; message_id?: string | number; error?: string };
  if (payload.ok === false) throw new Error(redactError(payload.error || "Hermes send failed."));
  return sent(channel, "Sent via Hermes.", payload.id ?? (payload.message_id ? String(payload.message_id) : undefined));
}

async function sendTelegram(channel: HiveMessagingChannel, message: string) {
  const token = envCredential(channel);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: channel.target.chatId,
      message_thread_id: channel.target.threadId ? Number(channel.target.threadId) : undefined,
      text: message,
      disable_web_page_preview: true,
    }),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(redactError(`Telegram send failed: ${payload?.description || response.statusText}`));
  return sent(channel, "Sent via Telegram.", payload.result?.message_id ? String(payload.result.message_id) : undefined);
}

async function sendDiscordWebhook(channel: HiveMessagingChannel, message: string) {
  const webhookUrl = envCredential(channel);
  const url = new URL(webhookUrl);
  if (channel.target.threadId) url.searchParams.set("thread_id", channel.target.threadId);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message, allowed_mentions: { parse: [] } }),
  });
  if (!response.ok) throw new Error(redactError(`Discord send failed: ${await response.text().catch(() => response.statusText)}`));
  return sent(channel, "Sent via Discord webhook.");
}

async function sendSlack(channel: HiveMessagingChannel, message: string) {
  const token = envCredential(channel);
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: channel.target.chatId,
      thread_ts: channel.target.threadId,
      text: message,
    }),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; ts?: string; error?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(redactError(`Slack send failed: ${payload?.error || response.statusText}`));
  return sent(channel, "Sent via Slack.", payload.ts);
}

async function sendGenericWebhook(channel: HiveMessagingChannel, message: string) {
  const webhookUrl = envCredential(channel);
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      target: channel.target.chatId,
      threadId: channel.target.threadId,
      agentId: channel.agentId,
      agentName: channel.agentName,
      channelId: channel.id,
      channelLabel: channel.label,
    }),
  });
  if (!response.ok) throw new Error(redactError(`Webhook send failed: ${await response.text().catch(() => response.statusText)}`));
  return sent(channel, "Sent via webhook.");
}

async function sendIMessage(channel: HiveMessagingChannel, message: string) {
  if (process.platform !== "darwin") throw new Error("iMessage delivery is only available on macOS with Messages signed in.");
  const script = [
    "on run argv",
    "tell application \"Messages\"",
    "set targetBuddy to item 1 of argv",
    "set targetMessage to item 2 of argv",
    "set targetService to 1st service whose service type = iMessage",
    "set targetRecipient to buddy targetBuddy of targetService",
    "send targetMessage to targetRecipient",
    "end tell",
    "end run",
  ].join("\n");
  await execFileAsync("osascript", ["-e", script, channel.target.chatId, message], { timeout: 15_000 });
  return sent(channel, "Sent via Messages.");
}

function envCredential(channel: HiveMessagingChannel) {
  const key = cleanEnvKey(channel.credentialEnvKey || "");
  if (!key) throw new Error(`${PROVIDER_COPY[channel.provider].label} credential env key is missing.`);
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is not set in the server environment.`);
  return value;
}

function sent(channel: HiveMessagingChannel, message: string, providerMessageId?: string): HiveMessagingSendResult {
  return {
    ok: true,
    channelId: channel.id,
    provider: channel.provider,
    message,
    providerMessageId,
    sentAt: new Date().toISOString(),
  };
}

function limitMessage(message: string, maxLength: number) {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, Math.max(0, maxLength - 80))}\n\n[truncated by HivemindOS messaging channel limit]`;
}

async function resolveHermesBin() {
  if (process.env.HERMES_BIN) return process.env.HERMES_BIN;
  const candidates = [
    join(homedir(), ".local", "bin", "hermes"),
    "/usr/local/bin/hermes",
    "/opt/homebrew/bin/hermes",
    "/usr/bin/hermes",
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try the next standard install location
    }
  }
  return "hermes";
}

function hermesCommandEnv(agent: Pick<MessagingRuntimeAgent, "localDataDir"> = {}) {
  const home = expandHome(agent.localDataDir ?? "");
  return {
    ...process.env,
    ...(home ? { HERMES_HOME: home } : {}),
  };
}

function expandHome(path: string) {
  return path.trim().replace(/^~(?=$|\/)/, homedir());
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
    channels: channels.sort((left, right) => left.agentName.localeCompare(right.agentName) || left.label.localeCompare(right.label)),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, path);
}

function normalizeProvider(value: string): HiveMessagingProvider {
  const provider = value.trim().toLowerCase() as HiveMessagingProvider;
  if (!VALID_PROVIDERS.has(provider)) throw new Error(`Unsupported messaging provider: ${value}`);
  return provider;
}

function normalizeCredentialKind(value: string): HiveMessagingCredentialKind {
  const kind = value.trim().toLowerCase() as HiveMessagingCredentialKind;
  if (!VALID_CREDENTIAL_KINDS.has(kind)) throw new Error(`Unsupported credential kind: ${value}`);
  return kind;
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

function redactError(value: string) {
  return value
    .replace(URL_SECRET_RE, (_match, prefix) => `${prefix}***`)
    .replace(SECRET_TEXT_RE, (_match, key) => `${key}=***`)
    .slice(0, 500);
}
