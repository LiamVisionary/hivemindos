import type {
  HiveMessagingCapability,
  HiveMessagingProvider,
  HiveMessagingProviderMeta,
} from "@/lib/types/messaging-channels";

/**
 * Canonical messaging-provider matrix — the single source of truth for every
 * outbound platform HivemindOS can address. Behaviour that varies by provider
 * (credential shape, target format, capabilities, how a message is delivered)
 * lives here as matrix rows, never as scattered conditionals.
 *
 * `deliveryStrategy`:
 *  - "native" — HivemindOS posts directly (a single/few env credentials + fetch
 *    or a local macOS bridge). Fully functional with only the listed env vars.
 *  - "hermes" — delivered through a local Hermes runtime (`hermes send`). Real
 *    when Hermes is installed and configured for that platform; otherwise the
 *    send returns an honest, actionable error. These platforms need a daemon or
 *    heavier setup that Hermes already manages.
 *
 * Capabilities mirror the Hermes platform matrix (text is universal and omitted;
 * the chips describe what the platform itself can carry, not that a given send
 * ships every media type).
 */
export const PROVIDER_MATRIX: Record<HiveMessagingProvider, HiveMessagingProviderMeta> = {
  telegram: {
    id: "telegram",
    label: "Telegram",
    mono: "TG",
    color: "#26A5E4",
    credentialKind: "env-bot-token",
    credentialEnvHint: "TELEGRAM_BOT_TOKEN",
    additionalEnv: [],
    targetHint: "chat id, or chat_id:thread_id for topics",
    targetRequired: true,
    capabilities: ["images", "files", "voice", "threads", "typing", "streaming"],
    deliveryStrategy: "native",
    messageLimit: 4096,
    docsNote: "Bot token from @BotFather; the bot must be a member of the chat.",
  },
  discord: {
    id: "discord",
    label: "Discord",
    mono: "DC",
    color: "#5865F2",
    credentialKind: "env-webhook-url",
    credentialEnvHint: "DISCORD_WEBHOOK_URL",
    additionalEnv: [],
    targetHint: "optional thread id",
    targetRequired: false,
    capabilities: ["images", "files", "voice", "threads", "reactions", "typing", "streaming"],
    deliveryStrategy: "native",
    messageLimit: 2000,
    docsNote: "Channel → Integrations → Webhooks. The URL encodes the channel.",
  },
  slack: {
    id: "slack",
    label: "Slack",
    mono: "SL",
    color: "#36C5F0",
    credentialKind: "env-bot-token",
    credentialEnvHint: "SLACK_BOT_TOKEN",
    additionalEnv: [],
    targetHint: "conversation id such as C…, G…, or D…",
    targetRequired: true,
    capabilities: ["images", "files", "voice", "threads", "reactions", "typing", "streaming"],
    deliveryStrategy: "native",
    messageLimit: 4000,
    docsNote: "Bot token (xoxb-…) with chat:write; invite the bot to the channel.",
  },
  imessage: {
    id: "imessage",
    label: "iMessage",
    mono: "iM",
    color: "#0B84FF",
    credentialKind: "macos-messages",
    credentialEnvHint: "",
    additionalEnv: [],
    targetHint: "phone number, email, or Messages handle",
    targetRequired: true,
    capabilities: [],
    deliveryStrategy: "native",
    messageLimit: 4000,
    docsNote: "Sends through the local macOS Messages app (this Mac must be signed in).",
  },
  webhook: {
    id: "webhook",
    label: "Webhook",
    mono: "WH",
    color: "#e7b45c",
    credentialKind: "env-webhook-url",
    credentialEnvHint: "HIVE_MESSAGE_WEBHOOK_URL",
    additionalEnv: [],
    targetHint: "optional route, topic, or channel id sent in the payload",
    targetRequired: false,
    capabilities: [],
    deliveryStrategy: "native",
    messageLimit: 8000,
    docsNote: "POSTs a JSON envelope with the message and channel metadata.",
  },
  googlechat: {
    id: "googlechat",
    label: "Google Chat",
    mono: "GC",
    color: "#1A73E8",
    credentialKind: "env-webhook-url",
    credentialEnvHint: "GOOGLE_CHAT_WEBHOOK_URL",
    additionalEnv: [],
    targetHint: "optional thread key",
    targetRequired: false,
    capabilities: ["images", "files", "threads", "typing"],
    deliveryStrategy: "native",
    messageLimit: 4000,
    docsNote: "Space → Manage webhooks. The URL encodes the space.",
  },
  mattermost: {
    id: "mattermost",
    label: "Mattermost",
    mono: "MM",
    color: "#1E6FE0",
    credentialKind: "env-webhook-url",
    credentialEnvHint: "MATTERMOST_WEBHOOK_URL",
    additionalEnv: [],
    targetHint: "optional channel override",
    targetRequired: false,
    capabilities: ["images", "files", "voice", "threads", "typing", "streaming"],
    deliveryStrategy: "native",
    messageLimit: 4000,
    docsNote: "Incoming webhook URL from Integrations. Target overrides the channel.",
  },
  teams: {
    id: "teams",
    label: "Microsoft Teams",
    mono: "MT",
    color: "#6264A7",
    credentialKind: "env-webhook-url",
    credentialEnvHint: "TEAMS_WEBHOOK_URL",
    additionalEnv: [],
    targetHint: "optional — the webhook encodes the channel",
    targetRequired: false,
    capabilities: ["images", "threads", "typing"],
    deliveryStrategy: "native",
    messageLimit: 4000,
    docsNote: "Incoming Webhook / Workflow URL for the channel.",
  },
  feishu: {
    id: "feishu",
    label: "Feishu / Lark",
    mono: "FL",
    color: "#3370FF",
    credentialKind: "env-webhook-url",
    credentialEnvHint: "FEISHU_WEBHOOK_URL",
    additionalEnv: [],
    targetHint: "optional — the bot webhook encodes the chat",
    targetRequired: false,
    capabilities: ["images", "files", "voice", "threads", "reactions", "typing", "streaming"],
    deliveryStrategy: "native",
    messageLimit: 4000,
    docsNote: "Custom-bot webhook URL for the group.",
  },
  dingtalk: {
    id: "dingtalk",
    label: "DingTalk",
    mono: "DT",
    color: "#3296FA",
    credentialKind: "env-webhook-url",
    credentialEnvHint: "DINGTALK_WEBHOOK_URL",
    additionalEnv: [],
    targetHint: "optional — the robot webhook encodes the chat",
    targetRequired: false,
    capabilities: ["images", "files", "reactions", "streaming"],
    deliveryStrategy: "native",
    messageLimit: 4000,
    docsNote: "Custom-robot webhook URL (with keyword or signed secret in the URL).",
  },
  wecom: {
    id: "wecom",
    label: "WeCom",
    mono: "WC",
    color: "#2F91FF",
    credentialKind: "env-webhook-url",
    credentialEnvHint: "WECOM_WEBHOOK_URL",
    additionalEnv: [],
    targetHint: "optional — the group bot webhook encodes the chat",
    targetRequired: false,
    capabilities: ["images", "files", "voice"],
    deliveryStrategy: "native",
    messageLimit: 4000,
    docsNote: "WeCom group-robot webhook URL.",
  },
  matrix: {
    id: "matrix",
    label: "Matrix",
    mono: "MX",
    color: "#0DBD8B",
    credentialKind: "env-access-token",
    credentialEnvHint: "MATRIX_ACCESS_TOKEN",
    additionalEnv: ["MATRIX_HOMESERVER_URL"],
    targetHint: "room id such as !abc:server or #room:server",
    targetRequired: true,
    capabilities: ["images", "files", "voice", "threads", "reactions", "typing", "streaming"],
    deliveryStrategy: "native",
    messageLimit: 4000,
    docsNote: "Access token + MATRIX_HOMESERVER_URL (e.g. https://matrix.org).",
  },
  line: {
    id: "line",
    label: "LINE",
    mono: "LN",
    color: "#06C755",
    credentialKind: "env-access-token",
    credentialEnvHint: "LINE_CHANNEL_TOKEN",
    additionalEnv: [],
    targetHint: "user, group, or room id",
    targetRequired: true,
    capabilities: ["images", "files", "typing"],
    deliveryStrategy: "native",
    messageLimit: 5000,
    docsNote: "Messaging API channel access token; target is a push recipient id.",
  },
  ntfy: {
    id: "ntfy",
    label: "ntfy",
    mono: "NF",
    color: "#317f6f",
    credentialKind: "env-webhook-url",
    credentialEnvHint: "NTFY_URL",
    additionalEnv: [],
    targetHint: "optional topic (appended to the base URL)",
    targetRequired: false,
    capabilities: [],
    deliveryStrategy: "native",
    messageLimit: 4000,
    docsNote: "Full topic URL (e.g. https://ntfy.sh/my-topic), or a base URL plus a target topic.",
  },
  homeassistant: {
    id: "homeassistant",
    label: "Home Assistant",
    mono: "HA",
    color: "#18BCF2",
    credentialKind: "env-webhook-url",
    credentialEnvHint: "HASS_WEBHOOK_URL",
    additionalEnv: [],
    targetHint: "optional — the webhook encodes the automation",
    targetRequired: false,
    capabilities: [],
    deliveryStrategy: "native",
    messageLimit: 4000,
    docsNote: "Webhook trigger URL (/api/webhook/<id>) for a notify automation.",
  },
  sms: {
    id: "sms",
    label: "SMS (Twilio)",
    mono: "SM",
    color: "#7C8AA5",
    credentialKind: "env-multi",
    credentialEnvHint: "TWILIO_AUTH_TOKEN",
    additionalEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_FROM_NUMBER"],
    targetHint: "+15551234567",
    targetRequired: true,
    capabilities: [],
    deliveryStrategy: "native",
    messageLimit: 1600,
    docsNote: "Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and a TWILIO_FROM_NUMBER.",
  },
  whatsapp: {
    id: "whatsapp",
    label: "WhatsApp",
    mono: "WA",
    color: "#25D366",
    credentialKind: "env-multi",
    credentialEnvHint: "WHATSAPP_TOKEN",
    additionalEnv: ["WHATSAPP_PHONE_NUMBER_ID"],
    targetHint: "+15551234567",
    targetRequired: true,
    capabilities: ["images", "files", "typing", "streaming"],
    deliveryStrategy: "native",
    messageLimit: 4096,
    docsNote: "Cloud API token + WHATSAPP_PHONE_NUMBER_ID; recipient must have opted in.",
  },
  signal: {
    id: "signal",
    label: "Signal",
    mono: "SG",
    color: "#3A76F0",
    credentialKind: "hermes-runtime",
    credentialEnvHint: "",
    additionalEnv: [],
    targetHint: "+15551234567",
    targetRequired: true,
    capabilities: ["images", "files", "typing", "streaming"],
    deliveryStrategy: "hermes",
    messageLimit: 4000,
    docsNote: "Delivered through the Hermes runtime (signal-cli account).",
  },
  email: {
    id: "email",
    label: "Email",
    mono: "@",
    color: "#EA6A4B",
    credentialKind: "hermes-runtime",
    credentialEnvHint: "",
    additionalEnv: [],
    targetHint: "ops@example.com",
    targetRequired: true,
    capabilities: ["images", "files", "threads"],
    deliveryStrategy: "hermes",
    messageLimit: 100000,
    docsNote: "Delivered through the Hermes runtime (SMTP configured in Hermes).",
  },
  bluebubbles: {
    id: "bluebubbles",
    label: "BlueBubbles",
    mono: "BB",
    color: "#1982FC",
    credentialKind: "hermes-runtime",
    credentialEnvHint: "",
    additionalEnv: [],
    targetHint: "+15551234567 or handle",
    targetRequired: true,
    capabilities: ["images", "files", "reactions", "typing"],
    deliveryStrategy: "hermes",
    messageLimit: 4000,
    docsNote: "Delivered through the Hermes runtime (BlueBubbles server).",
  },
  weixin: {
    id: "weixin",
    label: "Weixin",
    mono: "WX",
    color: "#07C160",
    credentialKind: "hermes-runtime",
    credentialEnvHint: "",
    additionalEnv: [],
    targetHint: "openid",
    targetRequired: true,
    capabilities: ["images", "files", "voice", "typing", "streaming"],
    deliveryStrategy: "hermes",
    messageLimit: 4000,
    docsNote: "Delivered through the Hermes runtime (WeChat official account).",
  },
  qq: {
    id: "qq",
    label: "QQ",
    mono: "QQ",
    color: "#12B7F5",
    credentialKind: "hermes-runtime",
    credentialEnvHint: "",
    additionalEnv: [],
    targetHint: "group or user id",
    targetRequired: true,
    capabilities: ["images", "files", "voice", "typing"],
    deliveryStrategy: "hermes",
    messageLimit: 4000,
    docsNote: "Delivered through the Hermes runtime (QQ bot).",
  },
  yuanbao: {
    id: "yuanbao",
    label: "Yuanbao",
    mono: "YB",
    color: "#4B6EF5",
    credentialKind: "hermes-runtime",
    credentialEnvHint: "",
    additionalEnv: [],
    targetHint: "session id",
    targetRequired: true,
    capabilities: ["images", "files", "voice", "typing", "streaming"],
    deliveryStrategy: "hermes",
    messageLimit: 4000,
    docsNote: "Delivered through the Hermes runtime.",
  },
  wecomcallback: {
    id: "wecomcallback",
    label: "WeCom Callback",
    mono: "WK",
    color: "#6E7B91",
    credentialKind: "hermes-runtime",
    credentialEnvHint: "",
    additionalEnv: [],
    targetHint: "callback route",
    targetRequired: true,
    capabilities: [],
    deliveryStrategy: "hermes",
    messageLimit: 4000,
    docsNote: "Delivered through the Hermes runtime (WeCom callback app).",
  },
};

export const MESSAGING_PROVIDER_META: HiveMessagingProviderMeta[] = Object.values(PROVIDER_MATRIX);

export const VALID_MESSAGING_PROVIDERS: ReadonlySet<HiveMessagingProvider> = new Set(
  Object.keys(PROVIDER_MATRIX) as HiveMessagingProvider[],
);

export function isMessagingProvider(value: string): value is HiveMessagingProvider {
  return VALID_MESSAGING_PROVIDERS.has(value as HiveMessagingProvider);
}

export function getProviderMeta(provider: HiveMessagingProvider): HiveMessagingProviderMeta {
  return PROVIDER_MATRIX[provider] ?? PROVIDER_MATRIX.webhook;
}

/** Every env var a channel of this provider needs before it can deliver. */
export function requiredCredentialEnv(
  provider: HiveMessagingProvider,
  credentialEnvKey?: string,
): string[] {
  const meta = getProviderMeta(provider);
  if (meta.credentialKind === "macos-messages" || meta.credentialKind === "hermes-runtime") {
    return [];
  }
  const primary = (credentialEnvKey || meta.credentialEnvHint).trim();
  const keys = new Set<string>();
  if (primary) keys.add(primary);
  for (const extra of meta.additionalEnv) keys.add(extra);
  return [...keys];
}

/**
 * Provider-aware target parsing. Only Telegram/Discord/Slack pack a thread id
 * after a colon — every other platform (Matrix rooms like `!room:server`, LINE
 * ids, phone numbers, emails) keeps the whole string as the chat id so colons in
 * the identifier survive.
 */
export function parseMessagingTarget(provider: HiveMessagingProvider, targetRef: string) {
  const trimmed = targetRef.trim();
  if (!trimmed) return { chatId: "", threadId: undefined as string | undefined };
  if (provider === "telegram" || provider === "discord") {
    const match = /^(-?\d+)(?::(\d+))?$/.exec(trimmed);
    if (match) return { chatId: match[1], threadId: match[2] };
  }
  if (provider === "slack") {
    const match = /^([CGDU][A-Z0-9]{8,})(?::([^\s:]+))?$/.exec(trimmed);
    if (match) return { chatId: match[1], threadId: match[2] };
  }
  return { chatId: trimmed, threadId: undefined };
}

/** Compact provider-scoped target reference, e.g. `telegram:-100…:42`. */
export function messagingTargetRef(provider: HiveMessagingProvider, chatId: string, threadId?: string) {
  return `${provider}:${chatId}${threadId ? `:${threadId}` : ""}`;
}

export function providerCapabilityLabels(provider: HiveMessagingProvider): string[] {
  const LABELS: Record<HiveMessagingCapability, string> = {
    text: "Text",
    images: "Images",
    files: "Files",
    voice: "Voice",
    threads: "Threads",
    reactions: "Reactions",
    typing: "Typing",
    streaming: "Streaming",
  };
  return getProviderMeta(provider).capabilities.map((cap) => LABELS[cap]);
}
