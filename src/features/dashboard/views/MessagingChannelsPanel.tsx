"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Bot, Check, MessageSquare, PlugZap, RefreshCcw, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";
import type {
  HiveMessagingChannel,
  HiveMessagingChannelDraft,
  HiveMessagingDirectoryEntry,
  HiveMessagingProvider,
} from "@/lib/types/messaging-channels";

type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;

type MessagingChannelsPayload = {
  ok?: boolean;
  error?: string;
  channels?: HiveMessagingChannel[];
  directory?: HiveMessagingDirectoryEntry[];
  settingsFile?: string;
  updatedAt?: string;
};

type AgentOption = Pick<AgentProfile, "id" | "name" | "runtime" | "beeRole">;

type MessagingChannelsPanelProps = {
  active: boolean;
  displayAgents: AgentProfile[];
  fleetClass: ClassNameBuilder;
  sharedVault: SharedVaultConfig;
};

const PROVIDERS: Array<{
  id: HiveMessagingProvider;
  label: string;
  credentialKind: HiveMessagingChannel["credentialKind"];
  envHint: string;
  targetPlaceholder: string;
}> = [
  { id: "telegram", label: "Telegram", credentialKind: "env-bot-token", envHint: "TELEGRAM_BOT_TOKEN", targetPlaceholder: "123456789 or -1001234567890:42" },
  { id: "discord", label: "Discord", credentialKind: "env-webhook-url", envHint: "DISCORD_WEBHOOK_URL", targetPlaceholder: "optional thread id" },
  { id: "imessage", label: "iMessage", credentialKind: "macos-messages", envHint: "", targetPlaceholder: "+15551234567 or name@example.com" },
  { id: "slack", label: "Slack", credentialKind: "env-bot-token", envHint: "SLACK_BOT_TOKEN", targetPlaceholder: "C0123456789" },
  { id: "webhook", label: "Webhook", credentialKind: "env-webhook-url", envHint: "HIVE_MESSAGE_WEBHOOK_URL", targetPlaceholder: "alerts or optional route" },
];

const QUEEN_BEE_AGENT: AgentOption = {
  id: "queen-bee",
  name: "Queen Bee",
  runtime: "hermes",
  beeRole: "queen",
};

function defaultDraft(agent: AgentOption = QUEEN_BEE_AGENT): Required<Pick<HiveMessagingChannelDraft, "provider" | "label" | "agentId" | "agentName" | "enabled" | "defaultForAgent" | "credentialKind" | "credentialEnvKey">> & { target: { chatId: string; threadId: string; displayName: string } } {
  const provider = PROVIDERS[0];
  return {
    provider: provider.id,
    label: `${provider.label} for ${agent.name}`,
    agentId: agent.id,
    agentName: agent.name,
    enabled: true,
    defaultForAgent: true,
    credentialKind: provider.credentialKind,
    credentialEnvKey: provider.envHint,
    target: { chatId: "", threadId: "", displayName: "" },
  };
}

function providerCopy(providerId: HiveMessagingProvider) {
  return PROVIDERS.find((provider) => provider.id === providerId) ?? PROVIDERS[0];
}

function providerLabel(providerId: HiveMessagingProvider) {
  return providerCopy(providerId).label;
}

export function MessagingChannelsPanel({ active, displayAgents, fleetClass, sharedVault }: MessagingChannelsPanelProps) {
  const [channels, setChannels] = useState<HiveMessagingChannel[]>([]);
  const [directory, setDirectory] = useState<HiveMessagingDirectoryEntry[]>([]);
  const [settingsFile, setSettingsFile] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [status, setStatus] = useState("");
  const agentOptions = useMemo(() => {
    const unique = new Map<string, AgentOption>();
    unique.set(QUEEN_BEE_AGENT.id, QUEEN_BEE_AGENT);
    for (const agent of displayAgents) unique.set(agent.id, agent);
    return [...unique.values()];
  }, [displayAgents]);
  const [selectedAgentId, setSelectedAgentId] = useState(QUEEN_BEE_AGENT.id);
  const selectedAgent = agentOptions.find((agent) => agent.id === selectedAgentId) ?? QUEEN_BEE_AGENT;
  const [draft, setDraft] = useState(defaultDraft(QUEEN_BEE_AGENT));

  const requestBody = useCallback((extra: Record<string, unknown> = {}) => ({
    vaultPath: sharedVault.vaultPath,
    brainServicesFolder: sharedVault.brainServicesFolder,
    ...extra,
  }), [sharedVault.brainServicesFolder, sharedVault.vaultPath]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (sharedVault.vaultPath) params.set("vaultPath", sharedVault.vaultPath);
    if (sharedVault.brainServicesFolder) params.set("brainServicesFolder", sharedVault.brainServicesFolder);
    const response = await fetch(`/api/messaging-channels?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    const data = await response?.json().catch(() => null) as MessagingChannelsPayload | null;
    setLoading(false);
    if (!response?.ok || !data?.ok) {
      setStatus(data?.error ?? "Could not load messaging channels.");
      return;
    }
    setChannels(data.channels ?? []);
    setDirectory(data.directory ?? []);
    setSettingsFile(data.settingsFile ?? "");
    setStatus((data.channels ?? []).length ? `${data.channels?.length ?? 0} messaging channel${data.channels?.length === 1 ? "" : "s"}` : "No messaging channels yet.");
  }, [sharedVault.brainServicesFolder, sharedVault.vaultPath]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [active, refresh]);

  function selectAgent(agent: AgentOption) {
    setSelectedAgentId(agent.id);
    setDraft((current) => ({
      ...current,
      agentId: agent.id,
      agentName: agent.name,
      label: current.label === `${providerLabel(current.provider)} for ${current.agentName}` ? `${providerLabel(current.provider)} for ${agent.name}` : current.label,
    }));
  }

  function updateProvider(providerId: HiveMessagingProvider) {
    const provider = providerCopy(providerId);
    setDraft((current) => ({
      ...current,
      provider: provider.id,
      label: current.label === `${providerLabel(current.provider)} for ${current.agentName}` ? `${provider.label} for ${current.agentName}` : current.label,
      credentialKind: provider.credentialKind,
      credentialEnvKey: provider.envHint,
    }));
  }

  async function saveDraft() {
    setSaving("save");
    const response = await fetch("/api/messaging-channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody({ channel: draft })),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as MessagingChannelsPayload | null;
    setSaving("");
    if (!response?.ok || !data?.ok) {
      setStatus(data?.error ?? "Could not save messaging channel.");
      return;
    }
    setChannels(data.channels ?? []);
    setDirectory(data.directory ?? []);
    setStatus("Messaging channel saved.");
    setDraft(defaultDraft(selectedAgent));
  }

  async function patchChannel(channel: HiveMessagingChannel, patch: Partial<HiveMessagingChannel>) {
    setSaving(channel.id);
    const response = await fetch("/api/messaging-channels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody({ channel: { ...channel, ...patch } })),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as MessagingChannelsPayload | null;
    setSaving("");
    if (!response?.ok || !data?.ok) {
      setStatus(data?.error ?? "Could not update messaging channel.");
      return;
    }
    setChannels(data.channels ?? []);
    setDirectory(data.directory ?? []);
    setStatus("Messaging channel updated.");
  }

  async function deleteChannel(channel: HiveMessagingChannel) {
    setSaving(channel.id);
    const response = await fetch("/api/messaging-channels", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody({ id: channel.id })),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as MessagingChannelsPayload | null;
    setSaving("");
    if (!response?.ok || !data?.ok) {
      setStatus(data?.error ?? "Could not delete messaging channel.");
      return;
    }
    setChannels(data.channels ?? []);
    setDirectory(data.directory ?? []);
    setStatus("Messaging channel removed.");
  }

  async function testChannel(channel: HiveMessagingChannel) {
    setSaving(`test:${channel.id}`);
    const response = await fetch("/api/messaging-channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody({
        action: "test",
        channelId: channel.id,
        message: `HivemindOS test from ${channel.agentName} via ${channel.label}.`,
      })),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string; result?: { message?: string } } | null;
    setSaving("");
    if (!response?.ok || !data?.ok) {
      setStatus(data?.error ?? "Could not send test message.");
      void refresh();
      return;
    }
    setStatus(data.result?.message ?? "Test message sent.");
    void refresh();
  }

  if (!active) return null;

  const activeProvider = providerCopy(draft.provider);
  const channelsByAgent = new Map(agentOptions.map((agent) => [agent.id, channels.filter((channel) => channel.agentId === agent.id)]));

  return (
    <section className={fleetClass("taskPanel", "tabPanel")}>
      <div className={fleetClass("taskPanelHeader")}>
        <div>
          <p className="eyebrow">Hive messaging</p>
          <h2>Messaging Channels</h2>
          <p>Queen Bee is the default handoff point. Add direct channels for worker agents when a channel should bypass orchestration.</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()} disabled={loading}>
          {loading ? <RefreshCcw aria-hidden="true" className="animate-spin" /> : <RefreshCcw aria-hidden="true" />}
          Refresh
        </Button>
      </div>

      {status ? <p className="mt-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] px-3 py-2 text-xs text-[var(--foreground)]">{status}</p> : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)]">
        <section className="grid content-start gap-4 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
          <div className="grid gap-3">
            <div>
              <p className="eyebrow">Agent</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {agentOptions.map((agent) => {
                  const count = channelsByAgent.get(agent.id)?.length ?? 0;
                  const selected = selectedAgentId === agent.id;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => selectAgent(agent)}
                      className={`flex min-h-20 items-center gap-3 rounded-md border p-3 text-left transition ${selected ? "border-[rgba(94,234,212,0.42)] bg-[rgba(20,184,166,0.12)]" : "border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.28)] hover:border-[rgba(94,234,212,0.28)]"}`}
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-[rgba(94,234,212,0.22)] bg-[rgba(20,184,166,0.08)]">
                        {agent.beeRole === "queen" ? <Image src={beeRoleIconPath("queen")} alt="" width={26} height={26} unoptimized /> : <Bot aria-hidden="true" className="h-5 w-5 text-[var(--accent-strong)]" />}
                      </span>
                      <span className="min-w-0">
                        <strong className="block text-sm text-[var(--foreground)]">{agent.name}</strong>
                        <span className="block text-xs text-[var(--muted)]">{agent.id === "queen-bee" ? "orchestrator" : agent.runtime}</span>
                        <span className="mt-1 block text-xs text-[var(--accent-strong)]">{count} channel{count === 1 ? "" : "s"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 rounded-md border border-[rgba(94,234,212,0.16)] bg-[rgba(20,184,166,0.06)] p-3">
              <p className="eyebrow">New channel</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-xs text-[var(--muted)]">
                  Provider
                  <select
                    value={draft.provider}
                    onChange={(event) => updateProvider(event.target.value as HiveMessagingProvider)}
                    className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.78)] px-2 py-2 text-sm text-[var(--foreground)]"
                  >
                    {PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-xs text-[var(--muted)]">
                  Label
                  <input
                    value={draft.label}
                    onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                    className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.78)] px-2 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
                  />
                </label>
                {draft.credentialKind !== "macos-messages" ? (
                  <label className="grid gap-1 text-xs text-[var(--muted)]">
                    Credential env key
                    <input
                      value={draft.credentialEnvKey}
                      onChange={(event) => setDraft((current) => ({ ...current, credentialEnvKey: event.target.value }))}
                      placeholder={activeProvider.envHint}
                      className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.78)] px-2 py-2 font-mono text-sm text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
                    />
                  </label>
                ) : null}
                <label className="grid gap-1 text-xs text-[var(--muted)]">
                  Target
                  <input
                    value={draft.target.chatId}
                    onChange={(event) => setDraft((current) => ({ ...current, target: { ...current.target, chatId: event.target.value } }))}
                    placeholder={activeProvider.targetPlaceholder}
                    className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.78)] px-2 py-2 font-mono text-sm text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
                  />
                </label>
                <label className="grid gap-1 text-xs text-[var(--muted)]">
                  Display name
                  <input
                    value={draft.target.displayName}
                    onChange={(event) => setDraft((current) => ({ ...current, target: { ...current.target, displayName: event.target.value } }))}
                    placeholder={`${activeProvider.label} home`}
                    className="rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.78)] px-2 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
                  />
                </label>
                <label className="flex min-h-10 items-center gap-2 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.32)] px-3 text-sm text-[var(--foreground)]">
                  <input type="checkbox" checked={draft.defaultForAgent} onChange={(event) => setDraft((current) => ({ ...current, defaultForAgent: event.target.checked }))} />
                  Default for {selectedAgent.name}
                </label>
              </div>
              <Button type="button" size="sm" className="w-fit" onClick={() => void saveDraft()} disabled={saving === "save"}>
                {saving === "save" ? <RefreshCcw aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
                Save channel
              </Button>
            </div>
          </div>
        </section>

        <section className="grid content-start gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Directory</p>
              <h3 className="m-0 text-base font-bold">Configured targets</h3>
            </div>
            {settingsFile ? <code className="max-w-full break-all text-xs text-[var(--muted)]">{settingsFile}</code> : null}
          </div>
          <div className="grid gap-3">
            {channels.map((channel) => (
              <article key={channel.id} className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow">{providerLabel(channel.provider)} · {channel.agentName}</p>
                    <h4 className="m-0 break-words text-base font-bold text-[var(--foreground)]">{channel.label}</h4>
                    <p className="m-0 mt-1 break-all font-mono text-xs text-[var(--muted)]">
                      {channel.provider}:{channel.target.chatId}{channel.target.threadId ? `:${channel.target.threadId}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${channel.enabled ? "border-[rgba(94,234,212,0.22)] text-[var(--accent-strong)]" : "border-[rgba(148,163,184,0.18)] text-[var(--muted)]"}`}>
                    {channel.enabled ? "enabled" : "paused"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => void testChannel(channel)} disabled={Boolean(saving)}>
                    {saving === `test:${channel.id}` ? <RefreshCcw aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
                    Test
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void patchChannel(channel, { enabled: !channel.enabled })} disabled={saving === channel.id}>
                    <PlugZap aria-hidden="true" />
                    {channel.enabled ? "Pause" : "Enable"}
                  </Button>
                  <Button type="button" size="sm" variant={channel.defaultForAgent ? "default" : "secondary"} onClick={() => void patchChannel(channel, { defaultForAgent: true })} disabled={saving === channel.id || channel.defaultForAgent}>
                    <MessageSquare aria-hidden="true" />
                    Default
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void deleteChannel(channel)} disabled={saving === channel.id}>
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                </div>
                {channel.lastTestAt ? (
                  <p className="m-0 text-xs text-[var(--muted)]">
                    Last test: {new Date(channel.lastTestAt).toLocaleString()} · {channel.lastTestStatus === "ok" ? "ok" : channel.lastTestMessage || "error"}
                  </p>
                ) : null}
              </article>
            ))}
            {channels.length ? null : (
              <div className="rounded-md border border-dashed border-[rgba(148,163,184,0.22)] p-6 text-center text-sm text-[var(--muted)]">
                No messaging channels configured.
              </div>
            )}
          </div>

          {directory.length ? (
            <div className="grid gap-2 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.32)] p-3">
              <p className="eyebrow">Hermes-style targets</p>
              {directory.map((entry) => (
                <code key={entry.id} className="break-all rounded-sm bg-[rgba(10,14,21,0.55)] px-2 py-1 text-xs text-[var(--foreground)]">
                  {entry.provider}:{entry.name}
                </code>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
