import { constants } from "fs";
import { access } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { homedir } from "@/lib/home-dir";
import { join } from "path";
import { assertFleetCollectorUrl, isLocalCollectorUrl, normalizeCollectorUrl } from "@/lib/services/local-collector-url";
import type {
  HiveMessagingChannel,
  HiveMessagingSendResult,
} from "@/lib/types/messaging-channels";
import {
  getProviderMeta,
  messagingTargetRef,
  requiredCredentialEnv,
} from "@/lib/services/messaging/provider-matrix";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";

const execFileAsync = promisify(execFile);

const SECRET_TEXT_RE = /\b([A-Za-z0-9_-]*(?:token|secret|key|signature|webhook|password)[A-Za-z0-9_-]*)=([^\s,;]+)/gi;
const URL_SECRET_RE = /([?&](?:access_token|api[_-]?key|auth[_-]?token|token|signature|sig|password)=)([^&#\s]+)/gi;
const RUNTIME_SEND_TIMEOUT_MS = 30_000;

export type ChannelCredentialStatus = {
  configured: boolean;
  label: string;
  missing: string[];
};

/**
 * Deliver a message through the channel's provider. Bridged (read-only) Hermes
 * channels and configured `hermes-runtime` providers go through the Hermes CLI;
 * every other provider is a direct native send. Throws an honest, redacted error
 * when a credential is missing or the upstream rejects the send.
 */
export async function sendToProvider(channel: HiveMessagingChannel, message: string): Promise<HiveMessagingSendResult> {
  if (channel.delivery?.kind === "hermes-send") return sendBridgedHermes(channel, message);
  const meta = getProviderMeta(channel.provider);
  if (meta.deliveryStrategy === "hermes") return sendConfiguredHermes(channel, message);
  switch (channel.provider) {
    case "telegram": return sendTelegram(channel, message);
    case "discord": return sendDiscordWebhook(channel, message);
    case "slack": return sendSlack(channel, message);
    case "imessage": return sendIMessage(channel, message);
    case "webhook": return sendGenericWebhook(channel, message);
    case "googlechat": return sendGoogleChat(channel, message);
    case "mattermost": return sendMattermost(channel, message);
    case "teams": return sendTeams(channel, message);
    case "feishu": return sendFeishu(channel, message);
    case "dingtalk": return sendDingTalk(channel, message);
    case "wecom": return sendWecom(channel, message);
    case "matrix": return sendMatrix(channel, message);
    case "line": return sendLine(channel, message);
    case "ntfy": return sendNtfy(channel, message);
    case "homeassistant": return sendHomeAssistant(channel, message);
    case "sms": return sendTwilioSms(channel, message);
    case "whatsapp": return sendWhatsApp(channel, message);
    default: throw new Error(`Unsupported messaging provider: ${channel.provider}`);
  }
}

/**
 * Resolve whether a channel can deliver right now, for the UI's "Needs key"
 * state. `isPresent` decides whether an env key is set — the caller passes a
 * checker that consults BOTH process.env and the shared hive env (where
 * HivemindOS credentials primarily live), so a channel configured the
 * documented way is not falsely flagged "Needs key".
 */
export function channelCredentialStatus(
  channel: HiveMessagingChannel,
  hermesAvailable: boolean,
  isPresent: (key: string) => boolean,
): ChannelCredentialStatus {
  if (channel.readOnly) {
    return { configured: true, label: channel.source?.label ? `Managed by ${channel.source.label}` : "Managed by Hermes", missing: [] };
  }
  const meta = getProviderMeta(channel.provider);
  if (meta.credentialKind === "macos-messages") {
    const configured = process.platform === "darwin";
    return {
      configured,
      label: "macOS Messages (local)",
      missing: configured ? [] : ["macOS Messages (this machine is not macOS)"],
    };
  }
  if (meta.credentialKind === "hermes-runtime") {
    return {
      configured: hermesAvailable,
      label: "Managed by Hermes runtime",
      missing: hermesAvailable ? [] : ["Hermes runtime"],
    };
  }
  const required = requiredCredentialEnv(channel.provider, channel.credentialEnvKey);
  const missing = required.filter((key) => !isPresent(key));
  return {
    configured: missing.length === 0,
    label: (channel.credentialEnvKey || meta.credentialEnvHint || "—").trim() || "—",
    missing,
  };
}

let hermesAvailableCache: { at: number; value: Promise<boolean> } | null = null;
const HERMES_AVAILABLE_TTL_MS = 60_000;

/**
 * Best-effort check for a usable local Hermes binary, cached for a short TTL so
 * a Hermes installed after server boot surfaces within a minute (not never)
 * while list requests avoid re-probing the filesystem on every call.
 */
export function hermesBinAvailable(): Promise<boolean> {
  const now = Date.now();
  if (!hermesAvailableCache || now - hermesAvailableCache.at > HERMES_AVAILABLE_TTL_MS) {
    hermesAvailableCache = {
      at: now,
      value: (async () => {
        if (process.env.HERMES_BIN) {
          return access(process.env.HERMES_BIN, constants.X_OK).then(() => true).catch(() => false);
        }
        for (const candidate of hermesBinCandidates()) {
          try {
            await access(candidate, constants.X_OK);
            return true;
          } catch {
            // try the next standard install location
          }
        }
        return false;
      })(),
    };
  }
  return hermesAvailableCache.value;
}

export async function resolveHermesBin() {
  if (process.env.HERMES_BIN) return process.env.HERMES_BIN;
  for (const candidate of hermesBinCandidates()) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try the next standard install location
    }
  }
  return "hermes";
}

function hermesBinCandidates() {
  return [
    join(homedir(), ".local", "bin", "hermes"),
    "/usr/local/bin/hermes",
    "/opt/homebrew/bin/hermes",
    "/usr/bin/hermes",
  ];
}

export function hermesCommandEnv(agent: { localDataDir?: string } = {}) {
  const home = expandHome(agent.localDataDir ?? "");
  return {
    ...process.env,
    ...(home ? { HERMES_HOME: home } : {}),
  };
}

// ---------------------------------------------------------------------------
// Hermes-delivered paths
// ---------------------------------------------------------------------------

async function sendConfiguredHermes(channel: HiveMessagingChannel, message: string) {
  if (!(await hermesBinAvailable())) {
    throw new Error(`${getProviderMeta(channel.provider).label} needs the Hermes runtime installed to deliver. Install Hermes or bridge this platform from a Hermes agent.`);
  }
  const targetRef = messagingTargetRef(channel.provider, channel.target.chatId, channel.target.threadId);
  return runHermesSend(targetRef, message, channel);
}

async function sendBridgedHermes(channel: HiveMessagingChannel, message: string) {
  const targetRef = channel.delivery?.targetRef || messagingTargetRef(channel.provider, channel.target.chatId, channel.target.threadId);
  if (!targetRef) throw new Error("Hermes messaging target is missing.");
  const collectorUrl = normalizeCollectorUrl(channel.delivery?.collectorUrl);
  if (collectorUrl && !isLocalCollectorUrl(collectorUrl)) {
    // SSRF guard: refuse to POST the message to any host outside the fleet.
    assertFleetCollectorUrl(collectorUrl);
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
  return runHermesSend(targetRef, message, { ...channel, delivery: channel.delivery });
}

async function runHermesSend(
  targetRef: string,
  message: string,
  channel: HiveMessagingChannel,
): Promise<HiveMessagingSendResult> {
  const { stdout } = await execFileAsync(await resolveHermesBin(), ["send", "--to", targetRef, "--json", message], {
    timeout: RUNTIME_SEND_TIMEOUT_MS,
    maxBuffer: 1_500_000,
    env: hermesCommandEnv({ localDataDir: channel.delivery?.agentLocalDataDir }),
  }).catch((error: unknown) => {
    throw new Error(redactError(error instanceof Error ? error.message : "Hermes send failed."));
  });
  let payload: { ok?: boolean; id?: string; message_id?: string | number; error?: string };
  try {
    payload = JSON.parse(stdout.trim() || "{}");
  } catch {
    throw new Error(redactError("Hermes send returned unparseable output."));
  }
  if (payload.ok === false) throw new Error(redactError(payload.error || "Hermes send failed."));
  return sent(channel, "Sent via Hermes.", payload.id ?? (payload.message_id ? String(payload.message_id) : undefined));
}

// ---------------------------------------------------------------------------
// Native provider sends
// ---------------------------------------------------------------------------

async function sendTelegram(channel: HiveMessagingChannel, message: string) {
  const token = await envCredential(channel);
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
  const url = new URL(await envCredential(channel));
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
  const token = await envCredential(channel);
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: channel.target.chatId, thread_ts: channel.target.threadId, text: message }),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; ts?: string; error?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(redactError(`Slack send failed: ${payload?.error || response.statusText}`));
  return sent(channel, "Sent via Slack.", payload.ts);
}

async function sendGenericWebhook(channel: HiveMessagingChannel, message: string) {
  const response = await fetch(await envCredential(channel), {
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

async function sendGoogleChat(channel: HiveMessagingChannel, message: string) {
  const url = new URL(await envCredential(channel));
  const body: { text: string; thread?: { threadKey: string } } = { text: message };
  if (channel.target.chatId) {
    // The thread key belongs in the body (thread.threadKey); the deprecated
    // standalone threadKey query param is ignored and would silently start a
    // new thread. messageReplyOption stays a query param.
    url.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
    body.thread = { threadKey: channel.target.chatId };
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(redactError(`Google Chat send failed: ${await response.text().catch(() => response.statusText)}`));
  return sent(channel, "Sent via Google Chat.");
}

async function sendMattermost(channel: HiveMessagingChannel, message: string) {
  const response = await fetch(await envCredential(channel), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(channel.target.chatId ? { text: message, channel: channel.target.chatId } : { text: message }),
  });
  if (!response.ok) throw new Error(redactError(`Mattermost send failed: ${await response.text().catch(() => response.statusText)}`));
  return sent(channel, "Sent via Mattermost.");
}

async function sendTeams(channel: HiveMessagingChannel, message: string) {
  const response = await fetch(await envCredential(channel), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
  if (!response.ok) throw new Error(redactError(`Microsoft Teams send failed: ${await response.text().catch(() => response.statusText)}`));
  return sent(channel, "Sent via Microsoft Teams.");
}

async function sendFeishu(channel: HiveMessagingChannel, message: string) {
  const response = await fetch(await envCredential(channel), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg_type: "text", content: { text: message } }),
  });
  const payload = await response.json().catch(() => null) as { code?: number; StatusCode?: number; msg?: string } | null;
  const code = payload?.code ?? payload?.StatusCode ?? 0;
  if (!response.ok || code !== 0) throw new Error(redactError(`Feishu send failed: ${payload?.msg || response.statusText}`));
  return sent(channel, "Sent via Feishu.");
}

async function sendDingTalk(channel: HiveMessagingChannel, message: string) {
  const response = await fetch(await envCredential(channel), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content: message } }),
  });
  const payload = await response.json().catch(() => null) as { errcode?: number; errmsg?: string } | null;
  if (!response.ok || (payload?.errcode ?? 0) !== 0) throw new Error(redactError(`DingTalk send failed: ${payload?.errmsg || response.statusText}`));
  return sent(channel, "Sent via DingTalk.");
}

async function sendWecom(channel: HiveMessagingChannel, message: string) {
  const response = await fetch(await envCredential(channel), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content: message } }),
  });
  const payload = await response.json().catch(() => null) as { errcode?: number; errmsg?: string } | null;
  if (!response.ok || (payload?.errcode ?? 0) !== 0) throw new Error(redactError(`WeCom send failed: ${payload?.errmsg || response.statusText}`));
  return sent(channel, "Sent via WeCom.");
}

async function sendMatrix(channel: HiveMessagingChannel, message: string) {
  const token = await envCredential(channel);
  const homeserver = (await resolveEnvSecret("MATRIX_HOMESERVER_URL", "Matrix")).replace(/\/+$/, "");
  const roomId = await resolveMatrixRoomId(homeserver, token, channel.target.chatId);
  const txnId = `hivemind-${Date.now()}-${process.pid}`;
  const url = `${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "m.text", body: message }),
  });
  const payload = await response.json().catch(() => null) as { event_id?: string; error?: string } | null;
  if (!response.ok || !payload?.event_id) throw new Error(redactError(`Matrix send failed: ${payload?.error || response.statusText}`));
  return sent(channel, "Sent via Matrix.", payload.event_id);
}

async function resolveMatrixRoomId(homeserver: string, token: string, target: string) {
  if (!target.startsWith("#")) return target;
  const response = await fetch(`${homeserver}/_matrix/client/v3/directory/room/${encodeURIComponent(target)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => null) as { room_id?: string; error?: string } | null;
  if (!response.ok || !payload?.room_id) throw new Error(redactError(`Matrix room lookup failed: ${payload?.error || response.statusText}`));
  return payload.room_id;
}

async function sendLine(channel: HiveMessagingChannel, message: string) {
  const token = await envCredential(channel);
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: channel.target.chatId, messages: [{ type: "text", text: message }] }),
  });
  if (!response.ok) throw new Error(redactError(`LINE send failed: ${await response.text().catch(() => response.statusText)}`));
  return sent(channel, "Sent via LINE.");
}

async function sendNtfy(channel: HiveMessagingChannel, message: string) {
  const base = (await envCredential(channel)).replace(/\/+$/, "");
  const url = channel.target.chatId ? `${base}/${encodeURIComponent(channel.target.chatId)}` : base;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: message,
  });
  if (!response.ok) throw new Error(redactError(`ntfy send failed: ${await response.text().catch(() => response.statusText)}`));
  return sent(channel, "Sent via ntfy.");
}

async function sendHomeAssistant(channel: HiveMessagingChannel, message: string) {
  const response = await fetch(await envCredential(channel), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, target: channel.target.chatId || undefined }),
  });
  if (!response.ok) throw new Error(redactError(`Home Assistant send failed: ${await response.text().catch(() => response.statusText)}`));
  return sent(channel, "Sent via Home Assistant.");
}

async function sendTwilioSms(channel: HiveMessagingChannel, message: string) {
  const authToken = await envCredential(channel);
  const sid = await resolveEnvSecret("TWILIO_ACCOUNT_SID", "SMS");
  const from = await resolveEnvSecret("TWILIO_FROM_NUMBER", "SMS");
  const body = new URLSearchParams({ To: channel.target.chatId, From: from, Body: message });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await response.json().catch(() => null) as { sid?: string; message?: string } | null;
  if (!response.ok || !payload?.sid) throw new Error(redactError(`SMS send failed: ${payload?.message || response.statusText}`));
  return sent(channel, "Sent via SMS.", payload.sid);
}

async function sendWhatsApp(channel: HiveMessagingChannel, message: string) {
  const token = await envCredential(channel);
  const phoneNumberId = await resolveEnvSecret("WHATSAPP_PHONE_NUMBER_ID", "WhatsApp");
  const response = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: channel.target.chatId, type: "text", text: { preview_url: false, body: message } }),
  });
  const payload = await response.json().catch(() => null) as { messages?: Array<{ id?: string }>; error?: { message?: string } } | null;
  if (!response.ok || !payload?.messages?.length) throw new Error(redactError(`WhatsApp send failed: ${payload?.error?.message || response.statusText}`));
  return sent(channel, "Sent via WhatsApp.", payload.messages[0]?.id);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function envCredential(channel: HiveMessagingChannel) {
  const meta = getProviderMeta(channel.provider);
  const key = (channel.credentialEnvKey || meta.credentialEnvHint || "").trim();
  return resolveEnvSecret(key, meta.label);
}

// Resolves through the shared hive env service (process.env first, then
// ~/.hivemindos/.env) so a credential set the documented way actually delivers.
async function resolveEnvSecret(key: string, providerLabel: string) {
  if (!key) throw new Error(`${providerLabel} credential env key is missing.`);
  const value = (await hiveEnvValue(key)).trim();
  if (!value) throw new Error(`${key} is not set in the shared hive env or server environment.`);
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

function expandHome(path: string) {
  return path.trim().replace(/^~(?=$|\/)/, homedir());
}

export function redactError(value: string) {
  return value
    .replace(URL_SECRET_RE, (_match, prefix) => `${prefix}***`)
    .replace(SECRET_TEXT_RE, (_match, key) => `${key}=***`)
    // Signed-webhook params not covered by URL_SECRET_RE's allowlist.
    .replace(/([?&](?:sign|access[_-]?key|secret)=)([^&#\s]+)/gi, (_match, prefix) => `${prefix}***`)
    // URL userinfo: https://user:secret@host
    .replace(/(https?:\/\/[^/\s:@]+:)[^@\s/]+@/gi, (_match, prefix) => `${prefix}***@`)
    // Telegram bot token embedded in the API path: /bot<id>:<token>/
    .replace(/\/bot\d+:[A-Za-z0-9_-]+/gi, "/bot***")
    // Discord/Slack webhook token as the last path segment of /webhooks/<id>/<token>
    .replace(/(\/webhooks\/\d+\/)[A-Za-z0-9_.-]+/gi, "$1***")
    // Bare provider token shapes (Slack xox*, Matrix syt_, Bearer headers)
    .replace(/\bxox[baprs]-[A-Za-z0-9-]+/gi, "xox***")
    .replace(/\bsyt_[A-Za-z0-9_]+/gi, "syt_***")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1***")
    .slice(0, 500);
}
