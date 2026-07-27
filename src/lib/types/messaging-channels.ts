export type HiveMessagingProvider =
  // Natively delivered (HivemindOS posts directly with a single/few env credentials)
  | "telegram"
  | "discord"
  | "slack"
  | "imessage"
  | "webhook"
  | "googlechat"
  | "mattermost"
  | "teams"
  | "feishu"
  | "dingtalk"
  | "wecom"
  | "matrix"
  | "line"
  | "ntfy"
  | "homeassistant"
  | "sms"
  | "whatsapp"
  // Delivered through a local Hermes runtime (heavier setup / needs a daemon)
  | "signal"
  | "email"
  | "bluebubbles"
  | "weixin"
  | "qq"
  | "yuanbao"
  | "wecomcallback";

export type HiveMessagingCredentialKind =
  /** Single secret env var (bot token). */
  | "env-bot-token"
  /** Single env var holding an incoming-webhook URL. */
  | "env-webhook-url"
  /** Single access-token env var, usually paired with fixed additional env vars. */
  | "env-access-token"
  /** Several fixed env vars are required (e.g. Twilio SID + token + from). */
  | "env-multi"
  /** Local macOS Messages.app — no env var, darwin only. */
  | "macos-messages"
  /** Delivered through the local Hermes runtime; credentials live in Hermes' own env. */
  | "hermes-runtime";

export type HiveMessagingCapability =
  | "text"
  | "images"
  | "files"
  | "voice"
  | "threads"
  | "reactions"
  | "typing"
  | "streaming";

export type HiveMessagingDeliveryStrategy = "native" | "hermes";

export type HiveMessagingChannelSourceKind = "vault" | "hermes";

export type HiveMessagingChannelTarget = {
  chatId: string;
  threadId?: string;
  displayName?: string;
};

export type HiveMessagingChannelSource = {
  kind: HiveMessagingChannelSourceKind;
  label: string;
  machineName?: string;
  collectorUrl?: string;
  runtime?: string;
};

export type HiveMessagingChannelDelivery = {
  kind: "provider" | "hermes-send";
  targetRef?: string;
  collectorUrl?: string;
  machineName?: string;
  agentLocalDataDir?: string;
};

export type HiveMessagingChannel = {
  id: string;
  provider: HiveMessagingProvider;
  label: string;
  agentId: string;
  agentName: string;
  enabled: boolean;
  defaultForAgent: boolean;
  credentialKind: HiveMessagingCredentialKind;
  credentialEnvKey?: string;
  target: HiveMessagingChannelTarget;
  createdAt: string;
  updatedAt: string;
  readOnly?: boolean;
  source?: HiveMessagingChannelSource;
  delivery?: HiveMessagingChannelDelivery;
  lastTestAt?: string;
  lastTestStatus?: "ok" | "error";
  lastTestMessage?: string;
  // ---- Computed at read time (not persisted) ----
  /** Whether every env credential this channel needs is actually set on the server. */
  credentialConfigured?: boolean;
  /** Human label for the credential ("TELEGRAM_BOT_TOKEN", "macOS Messages", "Managed by Hermes"). */
  credentialLabel?: string;
  /** Env var names still missing (empty when configured). */
  missingCredentials?: string[];
  /** How this channel delivers, resolved from the provider matrix. */
  deliveryStrategy?: HiveMessagingDeliveryStrategy;
  /** Runtime lifecycle state derived for the UI. */
  runState?: HiveMessagingRunState;
};

/** UI-facing lifecycle bucket derived from enabled/readOnly/credentialConfigured. */
export type HiveMessagingRunState = "live" | "enabled" | "paused" | "attention";

export type HiveMessagingProviderMeta = {
  id: HiveMessagingProvider;
  label: string;
  /** 2–3 character monogram for the provider tile. */
  mono: string;
  /** Brand-ish accent color for the provider tile. */
  color: string;
  credentialKind: HiveMessagingCredentialKind;
  /** Primary env var name offered as the editable default in the New-channel modal. */
  credentialEnvHint: string;
  /** Extra env vars that must also be set (IDs / secondary secrets), not user-editable here. */
  additionalEnv: string[];
  /** Placeholder / hint for the target field. */
  targetHint: string;
  /** Whether a target/recipient is required to save. */
  targetRequired: boolean;
  capabilities: HiveMessagingCapability[];
  deliveryStrategy: HiveMessagingDeliveryStrategy;
  messageLimit: number;
  /** One-line setup note surfaced under the provider picker. */
  docsNote?: string;
};

export type HiveMessagingChannelDraft = {
  provider?: HiveMessagingProvider;
  label?: string;
  agentId?: string;
  agentName?: string;
  enabled?: boolean;
  defaultForAgent?: boolean;
  credentialKind?: HiveMessagingCredentialKind;
  credentialEnvKey?: string;
  target?: Partial<HiveMessagingChannelTarget>;
};

export type HiveMessagingDirectoryEntry = {
  id: string;
  name: string;
  provider: HiveMessagingProvider;
  agentId: string;
  agentName: string;
  type: string;
  enabled: boolean;
  defaultForAgent: boolean;
  threadId?: string;
};

export type HiveMessagingSettings = {
  channels: HiveMessagingChannel[];
  updatedAt: string;
};

export type HiveMessagingSendResult = {
  ok: boolean;
  channelId: string;
  provider: HiveMessagingProvider;
  message: string;
  providerMessageId?: string;
  sentAt?: string;
};
