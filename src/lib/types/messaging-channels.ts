export type HiveMessagingProvider = "telegram" | "discord" | "imessage" | "slack" | "webhook";

export type HiveMessagingCredentialKind =
  | "env-bot-token"
  | "env-webhook-url"
  | "macos-messages";

export type HiveMessagingChannelTarget = {
  chatId: string;
  threadId?: string;
  displayName?: string;
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
  lastTestAt?: string;
  lastTestStatus?: "ok" | "error";
  lastTestMessage?: string;
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
